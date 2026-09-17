/**
 * `item:consume` handler + core service — task ALQ-F2-11.
 *
 * End-to-end over the REAL socket transport (boot → connect → op → ack —
 * same harness style as `combat/__tests__/apply-damage-handler.test.ts`).
 *
 * A FAKE system (`defineSystem`) registers `registerConsumeItem` with a
 * minimal, deliberately-NOT-pf2e-specific plan (charge/quantity bookkeeping
 * per REQ-PF2-224's shape) plus `registerActorMechanics`/`registerConsumeHook`
 * — this suite asserts the CORE's permission/atomicity/hook-ordering
 * behaviour (REQ-SYS-143/144), never a game rule, so it can never be
 * circular against a pack (the r22 "#48" lesson). The PF2e-specific plan
 * (`systems/pf2e/src/actions/consume.ts`) has its own pure unit test in the
 * satellite repo.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-143/144. Plan: docs/design/alquimista/
 * tasks.md §2.6, task ALQ-F2-11.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { AuthService } from "../../auth/service.js";
import { Role } from "../../auth/user-store.js";
import { loadOrCreateSecret } from "../../auth/crypto.js";
import { registerAuthRoutes } from "../../auth/routes.js";
import { SocketManager } from "../socket-manager.js";
import { reserveFreePort, listeningPort } from "../../__tests__/helpers/ports.js";
import { PROTOCOL_VERSION, OwnershipLevel, defaultStats } from "@fusion/shared";
import { defineSystem, ConsumePlanValidationError } from "@fusion/system-api";
import type {
  SystemModule,
  ActorMechanics,
  ActorMechanicsPatch,
  ResolvedDamageInstance,
  ConsumeItemDefinition,
  ConsumePlan,
  DocOp,
  ItemSnapshot,
} from "@fusion/system-api";
import type { ActorApplyDamagePayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixture ids
// ---------------------------------------------------------------------------

const QTY_ACTOR_ID = "qtyActor00000000";
const QTY_ITEM_ID = "qtyItem000000000";
const DESTROY_ACTOR_ID = "destroyActor0000";
const DESTROY_ITEM_ID = "destroyItem00000";
const PERM_ACTOR_ID = "permActor0000000";
const PERM_ITEM_ID = "permItem00000000";
const RACE_ACTOR_ID = "raceActor0000000";
const RACE_ITEM_ID = "raceItem00000000";
const HEAL_ACTOR_ID = "healActor0000000";
const HEAL_ITEM_ID = "healItem00000000";
const HOOK_ACTOR_ID = "hookActor0000000";
const HOOK_ITEM_ID = "hookItem00000000";
const HEAL_MAX_HP = 20;
const HEAL_STARTING_HP = 10;

const VALID_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

// ---------------------------------------------------------------------------
// Fake ActorMechanics — handles "healing" (capped at max) and generic damage
// (clamped at 0). Deliberately NOT a pf2e rule — same discipline as
// apply-damage-handler.test.ts's own fake mechanic.
// ---------------------------------------------------------------------------

function makeFakeActorMechanics(): ActorMechanics {
  return {
    applyDamage(actor, instances, _opts): ActorMechanicsPatch {
      const system = actor["system"] as
        | { attributes?: { hp?: { value?: number; max?: number } } }
        | undefined;
      const currentHp = system?.attributes?.hp?.value ?? 0;
      const maxHp = system?.attributes?.hp?.max ?? currentHp;
      let newHp = currentHp;
      for (const instance of instances as readonly ResolvedDamageInstance[]) {
        newHp =
          instance.type === "healing"
            ? Math.min(maxHp, newHp + instance.amount)
            : Math.max(0, newHp - instance.amount);
      }
      return {
        diff: { system: { attributes: { hp: { value: newHp } } } },
        embeddedCreate: [],
        embeddedDelete: [],
        breakdown: instances.map((i) => ({ step: i.type, label: i.type, amount: i.amount })),
        flags: { droppedToZero: newHp === 0, dead: false, dyingChanged: false },
      };
    },
    applyCondition() {
      throw new Error("applyCondition is not exercised by this suite");
    },
  };
}

// ---------------------------------------------------------------------------
// Fake ConsumeItemDefinition — REQ-PF2-224's shape (uses{value,max,autoDestroy}
// + quantity), game-rule-free (no effects/notes/automation reading).
// ---------------------------------------------------------------------------

function makeFakeConsumeItemDefinition(): ConsumeItemDefinition {
  return {
    appliesTo(item, payload) {
      return payload.mode === "use" && item !== null && item["type"] === "consumable";
    },
    plan(actor, item, _payload, ctx): ConsumePlan {
      const it = item as ItemSnapshot;
      const itemId = it["_id"] as string;
      const system = it["system"] as {
        uses: { value: number; max: number; autoDestroy: boolean };
        quantity: number;
        damage?: { formula: string; kind: string; type: string };
      };
      if (system.uses.value < 1) {
        throw new ConsumePlanValidationError(`item "${itemId}" has no charges left`);
      }
      const writes: DocOp[] = [];
      let quantityLeft = system.quantity;
      let destroyed = false;
      const remaining = system.uses.value - 1;
      if (remaining > 0) {
        writes.push({
          kind: "updateItem",
          itemId,
          diff: { system: { uses: { ...system.uses, value: remaining } } },
        });
      } else if (system.uses.autoDestroy) {
        quantityLeft = system.quantity - 1;
        if (quantityLeft <= 0) {
          destroyed = true;
          writes.push({ kind: "deleteItem", itemId });
        } else {
          writes.push({
            kind: "updateItem",
            itemId,
            diff: {
              system: { uses: { ...system.uses, value: system.uses.max }, quantity: quantityLeft },
            },
          });
        }
      } else {
        writes.push({
          kind: "updateItem",
          itemId,
          diff: { system: { uses: { ...system.uses, value: 0 } } },
        });
      }

      const damage: ActorApplyDamagePayload[] = [];
      if (system.damage) {
        const amount = ctx.roll(system.damage.formula);
        damage.push({
          instances: [
            { type: system.damage.kind === "healing" ? "healing" : system.damage.type, amount },
          ],
          selfActorId: actor["_id"] as string,
        });
      }

      return {
        writes,
        consumed: destroyed
          ? { itemId, quantityLeft: 0, destroyed: true }
          : { itemId, quantityLeft, destroyed: false },
        effects: [],
        damage,
        cards: [{ content: `consumiu item ${itemId}` }],
        notes: [],
      };
    },
  };
}

function makeSystemModule(hookLog: string[]): SystemModule {
  return defineSystem({ ...VALID_MANIFEST }, (r) => {
    r.registerActorMechanics(makeFakeActorMechanics());
    r.registerConsumeItem(makeFakeConsumeItemDefinition());
    r.registerConsumeHook("test-log", (e) => {
      hookLog.push(`${e.actorId}:${e.item?.["_id"] as string}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Test harness — same shape as apply-damage-handler.test.ts.
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-item-consume-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function consumableItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: "Elixir de Teste",
    type: "consumable",
    system: {
      category: "elixir",
      quantity: 2,
      uses: { value: 1, max: 1, autoDestroy: true },
      ...overrides,
    },
  };
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmId: string;
  playerId: string;
  player2Id: string;
  gmToken: string;
  playerToken: string;
  player2Token: string;
  hookLog: string[];
}

function seedActors(db: FusionDatabase, ownerId: string): void {
  const now = Date.now();
  const makeActor = (
    id: string,
    name: string,
    ownership: Record<string, number>,
    items: Record<string, unknown>[],
    hp: { value: number; max: number } = { value: 30, max: 30 },
  ) => ({
    _id: id,
    name,
    type: "npc",
    ownership,
    system: { attributes: { hp: { value: hp.value, max: hp.max, temp: 0 } } },
    items,
    _stats: defaultStats(),
  });

  const ownership = { default: OwnershipLevel.NONE, [ownerId]: OwnershipLevel.OWNER };

  const fixtures = [
    makeActor(QTY_ACTOR_ID, "Alquimista Qty", ownership, [
      consumableItem(QTY_ITEM_ID, { quantity: 2 }),
    ]),
    makeActor(DESTROY_ACTOR_ID, "Alquimista Destroy", ownership, [
      consumableItem(DESTROY_ITEM_ID, { quantity: 1 }),
    ]),
    makeActor(PERM_ACTOR_ID, "Alquimista Perm", ownership, [
      consumableItem(PERM_ITEM_ID, { quantity: 1 }),
    ]),
    makeActor(RACE_ACTOR_ID, "Alquimista Race", ownership, [
      consumableItem(RACE_ITEM_ID, { quantity: 1 }),
    ]),
    makeActor(
      HEAL_ACTOR_ID,
      "Alquimista Heal",
      ownership,
      [
        consumableItem(HEAL_ITEM_ID, {
          quantity: 1,
          damage: { formula: "100", kind: "healing", type: "untyped" },
        }),
      ],
      { value: HEAL_STARTING_HP, max: HEAL_MAX_HP },
    ),
    makeActor(HOOK_ACTOR_ID, "Alquimista Hook", ownership, [
      consumableItem(HOOK_ITEM_ID, { quantity: 1 }),
    ]),
  ];

  for (const actor of fixtures) {
    db.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(actor._id, JSON.stringify(actor), actor.name, actor.type, now, now);
  }
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-item-consume-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });

  seedActors(fusionDb, player.id);

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const player2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test Item Consume World", systemId: "test-system" },
  });

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });

  const hookLog: string[] = [];
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    systemId: "test-system",
    systemModule: makeSystemModule(hookLog),
  });

  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });
  expect(listeningPort(fastify)).toBe(port);

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmId: gm.id,
    playerId: player.id,
    player2Id: player2.id,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    player2Token: player2Login.accessToken,
    hookLog,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectSocket(port: number, worldId: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function emitEnvelope(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const envelope = {
      type,
      ts: Date.now(),
      payload,
      requestId: Math.random().toString(36).slice(2),
    };
    socket.emit("op", envelope, (ack: unknown) => {
      if (!ack || typeof ack !== "object") {
        reject(new Error("No ack"));
        return;
      }
      resolve(ack as Record<string, unknown>);
    });
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

const sendOp = (socket: ClientSocket, type: string, payload: unknown) =>
  emitEnvelope(socket, type, payload);

interface RawActor {
  items?: Record<string, unknown>[];
  system?: { attributes?: { hp?: { value?: number } } };
  _stats?: { version?: number };
}

function readActorRaw(db: FusionDatabase, actorId: string): RawActor {
  const row = db.raw.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as {
    data: string;
  };
  return JSON.parse(row.data) as RawActor;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("item:consume", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  it("quantity:2 com uses{1,1,autoDestroy} → quantity:1 e uses restaurado ao máximo", async () => {
    const socket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const ack = await sendOp(socket, "item:consume", {
        actorId: QTY_ACTOR_ID,
        itemId: QTY_ITEM_ID,
        mode: "use",
        expectedVersion: 1,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      const result = ack["result"] as { consumed: { quantityLeft: number; destroyed: boolean } };
      expect(result.consumed.destroyed).toBe(false);
      expect(result.consumed.quantityLeft).toBe(1);

      const actor = readActorRaw(ctx.fusionDb, QTY_ACTOR_ID);
      const item = actor.items?.find((i) => i["_id"] === QTY_ITEM_ID) as
        | { system: { quantity: number; uses: { value: number; max: number } } }
        | undefined;
      expect(item).toBeDefined();
      expect(item?.system.quantity).toBe(1);
      expect(item?.system.uses.value).toBe(item?.system.uses.max);
    } finally {
      socket.disconnect();
    }
  });

  it("quantity:1 → item apagado (destroyed:true)", async () => {
    const socket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const ack = await sendOp(socket, "item:consume", {
        actorId: DESTROY_ACTOR_ID,
        itemId: DESTROY_ITEM_ID,
        mode: "use",
        expectedVersion: 1,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      const result = ack["result"] as { consumed: { quantityLeft: number; destroyed: boolean } };
      expect(result.consumed.destroyed).toBe(true);
      expect(result.consumed.quantityLeft).toBe(0);

      const actor = readActorRaw(ctx.fusionDb, DESTROY_ACTOR_ID);
      expect(actor.items?.find((i) => i["_id"] === DESTROY_ITEM_ID)).toBeUndefined();
    } finally {
      socket.disconnect();
    }
  });

  it("sem ownership → PERMISSION_DENIED", async () => {
    const socket = await connectSocket(ctx.port, ctx.worldId, ctx.player2Token);
    try {
      const ack = await sendOp(socket, "item:consume", {
        actorId: PERM_ACTOR_ID,
        itemId: PERM_ITEM_ID,
        mode: "use",
        expectedVersion: 1,
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");

      const actor = readActorRaw(ctx.fusionDb, PERM_ACTOR_ID);
      const item = actor.items?.find((i) => i["_id"] === PERM_ITEM_ID) as
        | { system: { quantity: number } }
        | undefined;
      expect(item?.system.quantity).toBe(1); // untouched
    } finally {
      socket.disconnect();
    }
  });

  it("dois consumes concorrentes com quantity:1 → um ok e um CONFLICT", async () => {
    const socketA = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const socketB = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const payload = {
        actorId: RACE_ACTOR_ID,
        itemId: RACE_ITEM_ID,
        mode: "use",
        expectedVersion: 1,
      };
      const [ackA, ackB] = await Promise.all([
        sendOp(socketA, "item:consume", payload),
        sendOp(socketB, "item:consume", payload),
      ]);

      const results = [ackA, ackB];
      const oks = results.filter((r) => r["ok"] === true);
      const conflicts = results.filter((r) => r["ok"] === false && r["code"] === "CONFLICT");
      expect(oks.length, JSON.stringify(results)).toBe(1);
      expect(conflicts.length, JSON.stringify(results)).toBe(1);

      const actor = readActorRaw(ctx.fusionDb, RACE_ACTOR_ID);
      expect(actor.items?.find((i) => i["_id"] === RACE_ITEM_ID)).toBeUndefined();
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });

  it("cura declarada pelo item é rolada e aplicada limitada ao máximo de PV", async () => {
    const socket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const before = readActorRaw(ctx.fusionDb, HEAL_ACTOR_ID);
      expect(before.system?.attributes?.hp?.value).toBe(HEAL_STARTING_HP);

      const ack = await sendOp(socket, "item:consume", {
        actorId: HEAL_ACTOR_ID,
        itemId: HEAL_ITEM_ID,
        mode: "use",
        expectedVersion: 1,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);

      const after = readActorRaw(ctx.fusionDb, HEAL_ACTOR_ID);
      // formula "100" rolls a flat 100 — far past the actor's headroom, so
      // this asserts the CAP, not the roll (this suite is game-rule-free).
      expect(after.system?.attributes?.hp?.value).toBe(HEAL_MAX_HP);
    } finally {
      socket.disconnect();
    }
  });

  it("hook onConsumed (registerConsumeHook) é chamado exatamente uma vez", async () => {
    const socket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const ack = await sendOp(socket, "item:consume", {
        actorId: HOOK_ACTOR_ID,
        itemId: HOOK_ITEM_ID,
        mode: "use",
        expectedVersion: 1,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(ctx.hookLog).toEqual([`${HOOK_ACTOR_ID}:${HOOK_ITEM_ID}`]);
    } finally {
      socket.disconnect();
    }
  });
});
