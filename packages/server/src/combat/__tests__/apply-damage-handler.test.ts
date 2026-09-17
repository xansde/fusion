/**
 * `actor:applyDamage` handler + `ActorMechanicsService` — task ALQ-F1-08.
 *
 * End-to-end over the REAL socket transport (boot → connect → op → ack/
 * broadcast — same harness style as chat-target-snapshot-redaction.test.ts),
 * per this task's own instruction to prove the full path (evento → serviço →
 * pipeline → estado do ator), not just the isolated unit — `applyDamagePipeline`
 * existing without a caller was the onda's headline open finding.
 *
 * A FAKE system (`defineSystem`) registers `ActorMechanics.applyDamage` and
 * one `onDamageApplied` hook — this suite asserts the CORE's permission/
 * anti-cheat/redaction behaviour (REQ-SYS-142), never a game rule, so it
 * cannot be circular against any pack.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142. Plan: docs/design/alquimista/
 * tasks.md §2.1, task ALQ-F1-08 (D-02, D-04).
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
import { SocketManager } from "../../net/socket-manager.js";
import { reserveFreePort, listeningPort } from "../../__tests__/helpers/ports.js";
import { PROTOCOL_VERSION, OwnershipLevel, defaultStats } from "@fusion/shared";
import { defineSystem } from "@fusion/system-api";
import type {
  SystemModule,
  ActorMechanics,
  ActorMechanicsPatch,
  ResolvedDamageInstance,
} from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Fixture ids
// ---------------------------------------------------------------------------

const CASTER_ACTOR_ID = "casterActor00001";
const T1_ACTOR_ID = "target1Actor0001";
const T2_ACTOR_ID = "target2Actor0001";
const T3_ACTOR_ID = "target3Actor0001"; // an actor the caster never targeted
const T4_ACTOR_ID = "target4Actor0001"; // hidden token — I1 (onda-4 review)
const T1_TOKEN_ID = "target1Token0001";
const T2_TOKEN_ID = "target2Token0001";
const T3_TOKEN_ID = "target3Token0001";
const T4_TOKEN_ID = "target4Token0001";
const T4_NAME = "Assassino Sombrio";
const SCENE_ID = "applyDmgScene001";
const STARTING_HP = 30;

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
// Fake ActorMechanics — a pure "subtract the summed amount from hp" rule.
// Deliberately NOT a pf2e rule: this suite asserts the CORE's permission/
// anti-cheat/redaction behaviour, never IWR/dying/etc, so it can never be
// circular against a pack (the r22 "#48" lesson).
// ---------------------------------------------------------------------------

/**
 * `instancesLog` captures the RAW `ResolvedDamageInstance[]` this mechanic
 * received on every call — used by the B3 tests (critical/nonlethal reread)
 * to assert what the core actually handed the mechanic, since this fake
 * mechanic's own hp math never looks at `critical`/`nonlethal` (it is a pure
 * "subtract the summed amount" rule, deliberately game-rule-free — see the
 * suite header). `flags.dead` is `true` exactly when this hit drops the
 * target to 0 — a generic, non-pf2e-specific test double just detailed
 * enough to exercise the CORE's own I4 (REQ-CBT-059) defeated-marking.
 */
/** A hardcoded "resistance 1" this fake applies ONLY to `type: "cold"` — a
 * sentinel no other test in this file uses (ALQ-F1-10's `computeByType`
 * `resistanceApplied` regression test below is the only caller). Every
 * other type is untouched (raw amount, matching every pre-existing test's
 * expectation of a game-rule-free "subtract the summed amount" double). */
const FAKE_COLD_RESISTANCE = 1;

function makeFakeActorMechanics(instancesLog: ResolvedDamageInstance[][]): ActorMechanics {
  return {
    applyDamage(actor, instances, _opts): ActorMechanicsPatch {
      instancesLog.push([...instances]);
      const system = actor["system"] as { attributes?: { hp?: { value?: number } } } | undefined;
      const currentHp = system?.attributes?.hp?.value ?? 0;
      const finalAmounts = instances.map((i) =>
        i.type === "cold" ? Math.max(0, i.amount - FAKE_COLD_RESISTANCE) : i.amount,
      );
      const totalDamage = finalAmounts.reduce((sum, amount) => sum + amount, 0);
      const newHp = Math.max(0, currentHp - totalDamage);
      return {
        diff: { system: { attributes: { hp: { value: newHp } } } },
        embeddedCreate: [],
        embeddedDelete: [],
        // ALQ-F1-10 regression fixture: `step === type` (the real pf2e
        // `damage.ts` convention this task's fix made `computeByType` rely
        // on) with the FINAL (post-fake-resistance) amount — see
        // `computeByType`'s own doc comment in actor-mechanics-service.ts.
        breakdown: instances.map((i, idx) => ({
          step: i.type,
          label: i.type,
          amount: finalAmounts[idx] ?? i.amount,
        })),
        flags: { droppedToZero: newHp === 0, dead: newHp === 0, dyingChanged: false },
      };
    },
    applyCondition() {
      throw new Error("applyCondition is not exercised by this suite (ALQ-F1-09)");
    },
  };
}

function makeSystemModule(
  hookLog: string[],
  instancesLog: ResolvedDamageInstance[][],
): SystemModule {
  return defineSystem({ ...VALID_MANIFEST }, (r) => {
    r.registerActorMechanics(makeFakeActorMechanics(instancesLog));
    r.onDamageApplied("test-log", (e) => {
      hookLog.push(e.target.actorId);
    });
  });
}

// ---------------------------------------------------------------------------
// Test harness (same shape as chat-target-snapshot-redaction.test.ts; users
// are created BEFORE actors are seeded so the caster's ownership map can name
// the real player id — compendium-import-to-actor.test.ts's own pattern)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-apply-damage-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
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
  instancesLog: ResolvedDamageInstance[][];
}

function seedActorsAndScene(db: FusionDatabase, casterOwnerId: string): void {
  const now = Date.now();
  const makeActor = (id: string, name: string, ownership: Record<string, number>) => ({
    _id: id,
    name,
    type: "npc",
    ownership,
    system: { attributes: { hp: { value: STARTING_HP, max: STARTING_HP, temp: 0 } } },
    // DocumentStore.update() (`_updateInTxn` → `buildUpdateStats`) reads
    // `existing._stats.version` unconditionally — a raw-seeded row without
    // `_stats` crashes the very first `actor:applyDamage` write.
    _stats: defaultStats(),
  });

  const caster = makeActor(CASTER_ACTOR_ID, "Alquimista", {
    default: OwnershipLevel.NONE,
    [casterOwnerId]: OwnershipLevel.OWNER,
  });
  const t1 = makeActor(T1_ACTOR_ID, "Goblin 1", { default: OwnershipLevel.NONE });
  const t2 = makeActor(T2_ACTOR_ID, "Goblin 2", { default: OwnershipLevel.NONE });
  const t3 = makeActor(T3_ACTOR_ID, "Goblin 3 (nao alvo)", { default: OwnershipLevel.NONE });
  const t4 = makeActor(T4_ACTOR_ID, T4_NAME, { default: OwnershipLevel.NONE });

  for (const actor of [caster, t1, t2, t3, t4]) {
    db.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(actor._id, JSON.stringify(actor), actor.name, actor.type, now, now);
  }

  const scene = {
    _id: SCENE_ID,
    name: "Covil",
    active: true,
    tokens: [
      { _id: T1_TOKEN_ID, name: "Goblin 1", actorId: T1_ACTOR_ID, hidden: false },
      { _id: T2_TOKEN_ID, name: "Goblin 2", actorId: T2_ACTOR_ID, hidden: false },
      { _id: T3_TOKEN_ID, name: "Goblin 3 (nao alvo)", actorId: T3_ACTOR_ID, hidden: false },
      // I1 (onda-4 review): hidden from every non-GM socket, no seenBy exception.
      { _id: T4_TOKEN_ID, name: T4_NAME, actorId: T4_ACTOR_ID, hidden: true },
    ],
  };
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(SCENE_ID, JSON.stringify(scene), "Covil", now, now);
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-apply-damage-world";

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

  // Actors seeded AFTER the users exist, so the caster's ownership map names
  // the real player id (compendium-import-to-actor.test.ts's own pattern).
  seedActorsAndScene(fusionDb, player.id);

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
    worldInfo: { id: worldId, title: "Test Apply Damage World", systemId: "test-system" },
  });

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });

  const hookLog: string[] = [];
  const instancesLog: ResolvedDamageInstance[][] = [];
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    systemId: "test-system",
    systemModule: makeSystemModule(hookLog, instancesLog),
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
    instancesLog,
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

interface ChatMessageLike {
  _id?: string;
  rolls?: Array<{ total?: number }>;
  flags?: { fusion?: { damageApplied?: unknown } };
}

/**
 * Waits for the next `doc:create` broadcast carrying a ChatMessage whose
 * `flags.fusion.damageApplied` is set — the `actor:damageApplied` summary.
 * Filtering (rather than resolving on the first ChatMessage) matters because
 * a `chat:send` roll broadcast to a DIFFERENT socket than the one whose ack
 * we awaited is NOT guaranteed to have already arrived by the time a test
 * attaches this listener (two independent WS connections): resolving on
 * "next ChatMessage" unconditionally could race against it and hand back the
 * roll instead of the summary.
 */
function nextDamageAppliedMessage(
  socket: ClientSocket,
  timeoutMs = 3000,
): Promise<ChatMessageLike> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:create") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "ChatMessage") return;
      const msg = (payload.documents?.[0] ?? {}) as ChatMessageLike;
      if (msg.flags?.fusion?.damageApplied === undefined) return;
      socket.off("op", handler);
      resolve(msg);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no actor:damageApplied doc:create broadcast"));
    }, timeoutMs);
  });
}

function readActorHp(db: FusionDatabase, actorId: string): number {
  const row = db.raw.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as {
    data: string;
  };
  const actor = JSON.parse(row.data) as { system?: { attributes?: { hp?: { value?: number } } } };
  const value = actor.system?.attributes?.hp?.value;
  if (typeof value !== "number") throw new Error(`actor ${actorId} has no numeric hp`);
  return value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("actor:applyDamage — ActorMechanicsService (ALQ-F1-08, REQ-SYS-142)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  }, 15_000);

  afterEach(async () => {
    await teardown(ctx);
  });

  it("mensagem com snapshot [T1,T2]: o dono do caster aplica o total GRAVADO a ambos, ignorando amount e targetTokenIds forjados", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      await sendOp(playerSocket, "combat:target", { tokenId: T2_TOKEN_ID, targeted: true });

      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      const rollTotal = rollMsg.rolls?.[0]?.total;
      expect(typeof rollTotal).toBe("number");

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [
          {
            type: "fire",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            // Anti-cheat probe: with `source` present the amount is ALWAYS
            // reread from the recorded roll (step 2) — this forged `amount`
            // must be ignored for every caller, privileged or not.
            amount: 999,
          },
        ],
        // Anti-cheat probe: a non-privileged caller's targetTokenIds override
        // must be ignored — targets come from the snapshot instead.
        targetTokenIds: [T3_TOKEN_ID],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

      const t1Hp = readActorHp(ctx.fusionDb, T1_ACTOR_ID);
      const t2Hp = readActorHp(ctx.fusionDb, T2_ACTOR_ID);
      const t3Hp = readActorHp(ctx.fusionDb, T3_ACTOR_ID);

      expect(STARTING_HP - t1Hp).toBe(rollTotal);
      expect(STARTING_HP - t2Hp).toBe(rollTotal);
      // targetTokenIds override from a non-privileged caller must be ignored.
      expect(t3Hp).toBe(STARTING_HP);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("mensagem sem snapshot (sem alvo vivo no momento da rolagem) → FORBIDDEN para o jogador", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"]).toBe(false);
      expect(damageAck["code"]).toBe("FORBIDDEN");
    } finally {
      playerSocket.disconnect();
    }
  });

  it("amount manual sem source: FORBIDDEN de jogador, aceito de GM (com targetTokenIds)", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const playerAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", amount: 10 }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(playerAck["ok"]).toBe(false);
      expect(playerAck["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);

      const gmAck = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", amount: 5 }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(gmAck["ok"], JSON.stringify(gmAck)).toBe(true);
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP - 5);
    } finally {
      playerSocket.disconnect();
      gmSocket.disconnect();
    }
  });

  it("jogador que NÃO é dono do ator que rolou → FORBIDDEN", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const player2Socket = await connectSocket(ctx.port, ctx.worldId, ctx.player2Token);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d6",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(player2Socket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"]).toBe(false);
      expect(damageAck["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
    } finally {
      playerSocket.disconnect();
      player2Socket.disconnect();
    }
  });

  it("resumo: GM recebe PV antes/depois; socket de jogador (autor e observador) recebe só o dano causado", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    const observerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.player2Token);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d6+2",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const gmSeen = nextDamageAppliedMessage(gmSocket);
      const observerSeen = nextDamageAppliedMessage(observerSocket);

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

      // The ack to the (non-privileged) caller carries no hp.
      const ackTargets = (damageAck["result"] as { targets: Array<Record<string, unknown>> })
        .targets;
      for (const t of ackTargets) {
        expect(t["hpBefore"]).toBeUndefined();
        expect(t["hpAfter"]).toBeUndefined();
      }

      const [gmMsg, observerMsg] = await Promise.all([gmSeen, observerSeen]);

      const gmTargets = (
        gmMsg.flags?.fusion?.damageApplied as { targets: Array<Record<string, unknown>> }
      ).targets;
      expect(gmTargets[0]?.["hpBefore"]).toBe(STARTING_HP);
      expect(typeof gmTargets[0]?.["hpAfter"]).toBe("number");

      const observerTargets = (
        observerMsg.flags?.fusion?.damageApplied as { targets: Array<Record<string, unknown>> }
      ).targets;
      for (const t of observerTargets) {
        expect(t["hpBefore"]).toBeUndefined();
        expect(t["hpAfter"]).toBeUndefined();
        expect(t["deathCondition"]).toBeUndefined();
      }
      expect(observerTargets[0]?.["total"]).toBe(gmTargets[0]?.["total"]);
    } finally {
      playerSocket.disconnect();
      gmSocket.disconnect();
      observerSocket.disconnect();
    }
  });

  it("ALQ-F1-10 regressão: byType carrega resistanceApplied quando o mecanismo emite step===type com o total FINAL (pós-IWR); sem redução, resistanceApplied some", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });

      // "cold" carries the fake's hardcoded resistance 1 (FAKE_COLD_RESISTANCE).
      const coldRollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d6+2",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const coldRollMsg = (coldRollAck["result"] as { message: ChatMessageLike }).message;
      const coldRollTotal = coldRollMsg.rolls?.[0]?.total;
      expect(typeof coldRollTotal).toBe("number");

      const coldAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "cold", source: { messageId: coldRollMsg._id, rollIndex: 0 } }],
      });
      expect(coldAck["ok"], JSON.stringify(coldAck)).toBe(true);
      const coldTargets = (coldAck["result"] as { targets: Array<Record<string, unknown>> })
        .targets;
      const coldByType = coldTargets[0]?.["byType"] as Array<Record<string, unknown>>;
      expect(coldByType).toEqual([
        {
          type: "cold",
          amount: (coldRollTotal as number) - FAKE_COLD_RESISTANCE,
          resistanceApplied: FAKE_COLD_RESISTANCE,
        },
      ]);

      // "fire" carries no reduction in the fake — resistanceApplied absent
      // (undefined, matching every pre-existing test's byType expectation).
      const fireRollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d6+2",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const fireRollMsg = (fireRollAck["result"] as { message: ChatMessageLike }).message;
      const fireRollTotal = fireRollMsg.rolls?.[0]?.total;

      const fireAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: fireRollMsg._id, rollIndex: 0 } }],
      });
      expect(fireAck["ok"], JSON.stringify(fireAck)).toBe(true);
      const fireTargets = (fireAck["result"] as { targets: Array<Record<string, unknown>> })
        .targets;
      const fireByType = fireTargets[0]?.["byType"] as Array<Record<string, unknown>>;
      expect(fireByType).toEqual([{ type: "fire", amount: fireRollTotal }]);
      expect(fireByType[0]).not.toHaveProperty("resistanceApplied");
    } finally {
      playerSocket.disconnect();
    }
  });

  it("onDamageApplied dispara exatamente uma vez por alvo", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      await sendOp(playerSocket, "combat:target", { tokenId: T2_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d8",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

      expect(ctx.hookLog.filter((id) => id === T1_ACTOR_ID)).toHaveLength(1);
      expect(ctx.hookLog.filter((id) => id === T2_ACTOR_ID)).toHaveLength(1);
      expect(ctx.hookLog).toHaveLength(2);
    } finally {
      playerSocket.disconnect();
    }
  });

  // -------------------------------------------------------------------------
  // Onda-4 adversarial review fixes — B1, B2, B3, I1, I4
  // (.fusion-build/alquimista/onda-4/REVISAO.md)
  // -------------------------------------------------------------------------

  it("B1: selfActorId ignora a checagem de dono da mensagem de origem — curar/aplicar a partir da rolagem de um ator que o jogador não possui é FORBIDDEN", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      // The GM rolls "damage" whose speaker is T1 — an NPC the player does
      // NOT own. Before the fix, selfActorId's branch never checked this.
      const gmRollAck = await sendOp(gmSocket, "chat:send", {
        content: "/roll 3d6+10",
        worldId: ctx.worldId,
        speakerActorId: T1_ACTOR_ID,
      });
      expect(gmRollAck["ok"], JSON.stringify(gmRollAck)).toBe(true);
      const gmRollMsg = (gmRollAck["result"] as { message: ChatMessageLike }).message;

      const beforeHp = readActorHp(ctx.fusionDb, CASTER_ACTOR_ID);
      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        selfActorId: CASTER_ACTOR_ID,
        instances: [{ type: "healing", source: { messageId: gmRollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"]).toBe(false);
      expect(damageAck["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, CASTER_ACTOR_ID)).toBe(beforeHp);
    } finally {
      playerSocket.disconnect();
      gmSocket.disconnect();
    }
  });

  it("B2: reaplicar a mesma (messageId, rollIndex, multiplier) por um jogador é FORBIDDEN e não reaplica o dano", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const first = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(first["ok"], JSON.stringify(first)).toBe(true);
      const hpAfterFirst = readActorHp(ctx.fusionDb, T1_ACTOR_ID);
      expect(hpAfterFirst).toBeLessThan(STARTING_HP);

      const second = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(second["ok"]).toBe(false);
      expect(second["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(hpAfterFirst);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("B2: GM continua podendo reaplicar a mesma chave (correção de mesa)", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const rollAck = await sendOp(gmSocket, "chat:send", {
        content: "/roll 1d6+1",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const first = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(first["ok"], JSON.stringify(first)).toBe(true);
      const second = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(second["ok"], JSON.stringify(second)).toBe(true);
    } finally {
      gmSocket.disconnect();
    }
  });

  it("B3: critical/nonlethal forjados por um jogador são ignorados — servidor relê/deriva da rolagem gravada", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      // No target/AC and no save checkContext → this roll never gets a
      // degreeOfSuccess recorded, so it is definitely not a critical success.
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [
          {
            type: "fire",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            critical: true,
            nonlethal: true,
          },
        ],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

      const received = ctx.instancesLog.at(-1)?.[0];
      expect(received?.critical).toBe(false);
      expect(received?.nonlethal).toBe(false);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("B3: multiplier 2 de um jogador sem crítico registrado na rolagem é FORBIDDEN", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
        multiplier: 2,
      });
      expect(damageAck["ok"]).toBe(false);
      expect(damageAck["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("B3: GM continua podendo enviar critical/multiplier livremente (privilegiado não é afetado)", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const gmAck = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", amount: 5, critical: true, nonlethal: true }],
        targetTokenIds: [T2_TOKEN_ID],
        multiplier: 2,
      });
      expect(gmAck["ok"], JSON.stringify(gmAck)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({ critical: true, nonlethal: true });
    } finally {
      gmSocket.disconnect();
    }
  });

  it("I1: nome/tokenId/actorId de token oculto não vazam no card actor:damageApplied para socket não-GM", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    const observerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.player2Token);
    try {
      const observerSeen = nextDamageAppliedMessage(observerSocket);

      const damageAck = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", amount: 12 }],
        // T1 visible, T4 hidden — both real placed tokens.
        targetTokenIds: [T1_TOKEN_ID, T4_TOKEN_ID],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

      // GM's own ack still names the hidden target fully (privileged).
      const ackTargets = (damageAck["result"] as { targets: Array<Record<string, unknown>> })
        .targets;
      expect(ackTargets).toHaveLength(2);
      expect(ackTargets.some((t) => t["actorId"] === T4_ACTOR_ID && t["name"] === T4_NAME)).toBe(
        true,
      );

      const observerMsg = await observerSeen;
      const observerTargets = (
        observerMsg.flags?.fusion?.damageApplied as { targets: Array<Record<string, unknown>> }
      ).targets;
      expect(observerTargets).toHaveLength(1);
      expect(observerTargets[0]?.["actorId"]).toBe(T1_ACTOR_ID);
      expect(observerTargets.some((t) => t["actorId"] === T4_ACTOR_ID)).toBe(false);
      expect(observerMsg.content ?? "").toContain("Goblin 1");
      expect(observerMsg.content ?? "").not.toContain(T4_NAME);
    } finally {
      gmSocket.disconnect();
      observerSocket.disconnect();
    }
  });

  it("I1: selfActorId sem token no cenário não é derrubado do card (ausência de token != token oculto)", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const observerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.player2Token);
    try {
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const observerSeen = nextDamageAppliedMessage(observerSocket);
      // CASTER_ACTOR_ID has no placed token anywhere in SCENE_ID's fixture.
      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        selfActorId: CASTER_ACTOR_ID,
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

      const observerMsg = await observerSeen;
      const observerTargets = (
        observerMsg.flags?.fusion?.damageApplied as { targets: Array<Record<string, unknown>> }
      ).targets;
      expect(observerTargets.some((t) => t["actorId"] === CASTER_ACTOR_ID)).toBe(true);
    } finally {
      playerSocket.disconnect();
      observerSocket.disconnect();
    }
  });

  it("I4: flags.dead marca o combatente como defeated no encontro ativo da cena (REQ-CBT-059)", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const createAck = await sendOp(gmSocket, "combat:create", { sceneId: SCENE_ID });
      expect(createAck["ok"], JSON.stringify(createAck)).toBe(true);
      const combatId = (createAck["result"] as { combat: { _id: string } }).combat._id;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: T1_TOKEN_ID,
      });
      expect(addAck["ok"], JSON.stringify(addAck)).toBe(true);

      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      // 30d6 is guaranteed >= 30 (STARTING_HP) — deterministically drops T1 to 0.
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 30d6",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(0);

      const combatRow = ctx.fusionDb.raw
        .prepare(`SELECT data FROM combats WHERE id = ?`)
        .get(combatId) as { data: string };
      const combat = JSON.parse(combatRow.data) as {
        combatants: Array<{ actorId: string; defeated: boolean }>;
      };
      const t1Combatant = combat.combatants.find((c) => c.actorId === T1_ACTOR_ID);
      expect(t1Combatant?.defeated).toBe(true);
    } finally {
      gmSocket.disconnect();
      playerSocket.disconnect();
    }
  });

  it("sem mecânica registrada (systemModule sem actorMechanics) → NOT_SUPPORTED sem escrever nada", async () => {
    // Second, independent context whose fake system registers NO ActorMechanics.
    const dataDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");
    const worldId = "test-apply-damage-nosys";
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
    seedActorsAndScene(fusionDb, player.id);
    const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

    const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
    await fastify.register(fastifyCookie);
    registerAuthRoutes(fastify, {
      authService,
      worldInfo: { id: worldId, title: "No-mechanics world", systemId: "test-system" },
    });
    const socketManager = new SocketManager({
      httpServer: fastify.server,
      logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
      origin: "*",
    });
    // No registerActorMechanics call at all.
    const bareSystem = defineSystem({ ...VALID_MANIFEST }, () => {});
    socketManager.registerWorldNamespace({
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      systemId: "test-system",
      systemModule: bareSystem,
    });
    const port = await reserveFreePort();
    await fastify.listen({ port, host: "127.0.0.1" });

    try {
      const gmSocket = await connectSocket(port, worldId, gmLogin.accessToken);
      try {
        const ack = await sendOp(gmSocket, "actor:applyDamage", {
          instances: [{ type: "fire", amount: 3 }],
          targetTokenIds: [T1_TOKEN_ID],
        });
        expect(ack["ok"]).toBe(false);
        expect(ack["code"]).toBe("NOT_SUPPORTED");
        expect(readActorHp(fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
      } finally {
        gmSocket.disconnect();
      }
    } finally {
      await socketManager.close();
      await fastify.close();
      fusionDb.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
