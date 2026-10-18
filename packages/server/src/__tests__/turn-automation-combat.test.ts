/**
 * PF2e turn automation, end to end: advancing a turn in a real combat (real sockets, the REAL pf2e system, the real
 * hook services) runs persistent damage + the DC 15 flat check and the frightened decay at the end of the turn, the
 * dying recovery check at the start of the next one, and the effect expiry by the round of the turn that ENDS.
 *
 * The dice are deterministic: the global dice-roller engine is replaced right before each turn advance, and each value
 * is the face minus one (the library's engine convention, see chat-attack-degree.test.ts).
 *
 * Port: reserved via helpers/ports.ts (never a literal).
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
import { NumberGenerator } from "@dice-roller/rpg-dice-roller";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-turn-auto-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  gmToken: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "turn-auto-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Turn Auto World", systemId: pf2eSystem.manifest.id },
  });
  await fastify.listen({ port: await reserveFreePort(), host: "127.0.0.1" });
  const port = listeningPort(fastify);

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    systemModule: pf2eSystem,
  });

  return { dataDir, fusionDb, fastify, socketManager, port, worldId, gmToken: gmLogin.accessToken };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function resultOf(ack: Record<string, unknown>): Record<string, unknown> {
  return ack["result"] as Record<string, unknown>;
}

function firstDocId(ack: Record<string, unknown>): string {
  return (resultOf(ack)["documents"] as Record<string, unknown>[])[0]!["_id"] as string;
}

/** Next dice faces, consumed in roll order (the engine takes face - 1); anything beyond the script rolls a 10. */
function scriptDice(faces: number[]): void {
  const queue = faces.map((f) => f - 1);
  (NumberGenerator as unknown as { generator: { engine: { next(): number } } }).generator.engine = {
    next: () => queue.shift() ?? 9,
  };
}

let itemCounter = 0;
function condition(slug: string, value?: number, system: Record<string, unknown> = {}) {
  itemCounter += 1;
  return {
    _id: `condItem${String(itemCounter).padStart(8, "0")}`,
    name: slug,
    type: "condition",
    system: { slug, ...(value !== undefined ? { value } : {}), ...system },
  };
}

const persistentFire = () =>
  condition("persistent-damage", undefined, {
    fusion: { data: { instance: { formula: "1d6", type: "fire" } } },
  });

describe("PF2e turn automation (real combat)", { timeout: 60000 }, () => {
  let ctx: TestContext;
  let gm: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
    await drain();
  });

  afterEach(async () => {
    gm.disconnect();
    await teardown(ctx);
  });

  async function createActor(name: string, items: unknown[], hp = 20) {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name, type: "npc", ownership: { default: 2 } }],
    });
    expect(ack["ok"]).toBe(true);
    const id = firstDocId(ack);
    ctx.fusionDb.raw
      .prepare(
        "UPDATE actors SET data = json_set(json_set(data, '$.items', json(?)), '$.system', json(?)) WHERE id = ?",
      )
      .run(
        JSON.stringify(items),
        JSON.stringify({ attributes: { hp: { value: hp, max: 20, temp: 0 } } }),
        id,
      );
    return id;
  }

  function actorDoc(actorId: string): { items: Record<string, unknown>[]; hp: number } {
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as {
      data: string;
    };
    const doc = JSON.parse(row.data) as {
      items?: Record<string, unknown>[];
      system?: { attributes?: { hp?: { value?: number } } };
    };
    return { items: doc.items ?? [], hp: doc.system?.attributes?.hp?.value ?? -1 };
  }

  function slugs(actorId: string): string[] {
    return actorDoc(actorId).items.map((i) => {
      const sys = (i["system"] ?? {}) as { slug?: string; value?: number };
      return sys.value !== undefined ? `${String(sys.slug)}:${String(sys.value)}` : String(sys.slug);
    });
  }

  function cards(): { content: string; type: string }[] {
    return (
      ctx.fusionDb.raw.prepare("SELECT data FROM chat_messages ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data) as { content: string; type: string });
  }

  async function startCombat(actorIds: string[]) {
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Cena", width: 1000, height: 1000 }],
    });
    const sceneId = firstDocId(sceneAck);
    const combatAck = await sendOp(gm, "combat:create", { sceneId });
    const combatId = (resultOf(combatAck)["combat"] as Record<string, unknown>)["_id"] as string;
    let initiative = 30;
    for (const actorId of actorIds) {
      await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: `t-${actorId}`,
        actorId,
        initiative,
      });
      initiative -= 10;
    }
    const begin = await sendOp(gm, "combat:beginCombat", { combatId });
    expect(begin["ok"]).toBe(true);
    return combatId;
  }

  it("end of A's turn: persistent 1d6 fire + DC 15 check + frightened 2 -> 1; start of B's turn: dying recovery", async () => {
    const a = await createActor("Alvo A", [condition("frightened", 2), persistentFire()]);
    const b = await createActor("Alvo B", [condition("dying", 1), condition("unconscious")], 0);
    const c = await createActor("Alvo C", []);
    const combatId = await startCombat([a, b, c]);
    const cardsBefore = cards().length;

    // d6 = 4 (damage), d20 = 15 (flat check, success), d20 = 11 (B's recovery vs DC 11, success)
    scriptDice([4, 15, 11]);
    const next = await sendOp(gm, "combat:nextTurn", { combatId });
    expect(next["ok"]).toBe(true);

    // A: took 4 fire, the persistent condition ended, frightened dropped to 1.
    expect(actorDoc(a).hp).toBe(16);
    expect(slugs(a)).toEqual(["frightened:1"]);
    // B: left dying, still unconscious, wounded 1.
    expect(slugs(b).sort()).toEqual(["unconscious", "wounded:1"]);

    const fresh = cards().slice(cardsBefore);
    const text = fresh.map((card) => card.content);
    expect(text.some((t) => t.includes("Dano persistente") && t.includes("sofre 4 de fogo"))).toBe(true);
    expect(text.some((t) => t.includes("Teste simples CD 15: 15"))).toBe(true);
    expect(text.some((t) => t.includes("Amedrontado de") && t.includes("de 2 para 1"))).toBe(true);
    expect(text.some((t) => t.includes("Teste de recuperação") && t.includes("ferido 1"))).toBe(true);
    // The dice themselves are real roll cards from the server.
    expect(fresh.filter((card) => card.type === "roll")).toHaveLength(3);
  });

  it("a fatal recovery check kills and marks the combatant defeated", async () => {
    const a = await createActor("Alvo A", []);
    const b = await createActor("Alvo B", [condition("dying", 3), condition("unconscious")], 0);
    const combatId = await startCombat([a, b]);

    scriptDice([5]); // 5 vs DC 13 = failure -> dying 4 = dead
    expect((await sendOp(gm, "combat:nextTurn", { combatId }))["ok"]).toBe(true);
    expect(slugs(b)).toContain("dead");
    expect(slugs(b).some((s) => s.startsWith("dying"))).toBe(false);
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM combats WHERE id = ?").get(combatId) as {
      data: string;
    };
    const combatants = (
      JSON.parse(row.data) as { combatants: { actorId: string; defeated?: boolean }[] }
    ).combatants;
    expect(combatants.find((cb) => cb.actorId === b)?.defeated).toBe(true);
    expect(cards().some((card) => card.content.includes("morre"))).toBe(true);
  });

  it("a failed DC 15 check keeps the persistent damage for the next turn", async () => {
    const a = await createActor("Alvo A", [persistentFire()]);
    const b = await createActor("Alvo B", []);
    const combatId = await startCombat([a, b]);
    scriptDice([2, 14]); // 2 damage, 14 < 15
    await sendOp(gm, "combat:nextTurn", { combatId });
    expect(actorDoc(a).hp).toBe(18);
    expect(slugs(a)).toEqual(["persistent-damage"]);
  });

  it("the world setting OFF stops all of it", async () => {
    const setting = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [{ key: `${pf2eSystem.manifest.id}:automation.turn`, value: false }],
    });
    expect(setting["ok"]).toBe(true);
    const a = await createActor("Alvo A", [condition("frightened", 2)]);
    const b = await createActor("Alvo B", [condition("dying", 1)], 0);
    const combatId = await startCombat([a, b]);
    const cardsBefore = cards().length;
    scriptDice([11]);
    await sendOp(gm, "combat:nextTurn", { combatId });
    expect(slugs(a)).toEqual(["frightened:2"]);
    expect(slugs(b)).toEqual(["dying:1"]);
    expect(cards()).toHaveLength(cardsBefore);
  });

  it("an effect 'until the end of your next turn' survives the end of the owner's turn when the round wraps", async () => {
    const a = await createActor("Alvo A", []);
    const b = await createActor("Dono (ultimo da ordem)", []);
    const effect = {
      _id: "effectWrap000001",
      type: "effect",
      name: "Efeito de teste",
      system: {
        slug: "effect-wrap-test",
        duration: { value: 1, unit: "round" },
        fusion: {
          expiry: { on: "turn-end", ownerActorId: b },
          startedAt: { combatId: null, round: 1 },
        },
      },
    };
    ctx.fusionDb.raw
      .prepare("UPDATE actors SET data = json_set(data, '$.items', json(?)) WHERE id = ?")
      .run(JSON.stringify([effect]), a);
    const combatId = await startCombat([a, b]);

    await sendOp(gm, "combat:nextTurn", { combatId }); // A ends (round 1), B starts
    expect(actorDoc(a).items).toHaveLength(1);
    await sendOp(gm, "combat:nextTurn", { combatId }); // B ends: persisted round is already 2, but the turn was round 1
    expect(actorDoc(a).items).toHaveLength(1);
    await sendOp(gm, "combat:nextTurn", { combatId }); // A ends (round 2)
    expect(actorDoc(a).items).toHaveLength(1);
    await sendOp(gm, "combat:nextTurn", { combatId }); // B ends (round 2): elapsed 1 >= 1, gone
    expect(actorDoc(a).items).toHaveLength(0);
  });
});
