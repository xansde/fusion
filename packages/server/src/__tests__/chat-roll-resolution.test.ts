/**
 * BHR-F2-05 (imports ALQ-F4-09) — the roll's context is resolved on the server.
 *
 * Spec 52 REQ-BHR-051..053, REQ-BHR-069/070; plan of the Alquimista §2.8;
 * DF-16/DF-17 ("contexto de rolagem vai no op; notas, grau e ajustes
 * resolvidos no servidor").
 *
 * The rule, as the tests assert it:
 *   - a modifier conditioned on `target:mark:<slug>` counts ONLY when the single
 *     target in the roll's `targetSnapshot` carries that mark (read from the
 *     mark source the server owns — `TokenMark`, BHR-F3-06, injected here);
 *   - the server re-derives the rolling actor before resolving: a stale
 *     `system.derived` on the stored row is never what the bonus is read from;
 *   - whatever the client puts in the payload beyond the roll's DESCRIPTION is
 *     ignored: a forged `target:*` option, a forged `rollNotes`, an actor the
 *     player does not own (DF-17);
 *   - `onRollResolved` runs ONCE per roll, with the degree the server graded and
 *     the targets of the snapshot;
 *   - notes are filtered by the graded degree and never reach a non-privileged
 *     viewer of a blind roll.
 *
 * The test system below is written for this file (no pf2e import): its resolver
 * enters the target's options with the `target:` prefix, exactly the contract
 * agreed with BHR-F2-02.
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

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import type { TokenMarkSource } from "../chat/roll-resolution.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { defineSystem } from "@fusion/system-api";
import type { RollResolvedEvent, SystemModule } from "@fusion/system-api";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Fixture ids
// ---------------------------------------------------------------------------

const SCENE_ID = "resolveScene0001";
const HUNTER_ACTOR_ID = "hunterActor00001";
const PREY_TOKEN_ID = "preyToken0000001";
const PREY_ACTOR_ID = "preyActor0000001";
const OTHER_TOKEN_ID = "otherToken000001";
const OTHER_ACTOR_ID = "otherActor000001";
const STRANGER_ACTOR_ID = "strangerActor001";

/** The prey's AC — the attack is graded against it (REQ-ACH-070). */
const PREY_AC = 15;
/** The bonus the hunter's AUTHORED data gives against marked prey (re-derived into system.derived). */
const PREY_BONUS = 2;
/** A stale value left in the stored `system.derived` — never what the server reads. */
const STALE_DERIVED_BONUS = 99;

// ---------------------------------------------------------------------------
// Test system: a derive step + a resolver + an onRollResolved listener
// ---------------------------------------------------------------------------

const hookCalls: RollResolvedEvent[] = [];

function buildTestSystem(): SystemModule {
  return defineSystem(
    {
      id: "roll-resolution-test",
      title: "Roll resolution test",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: {},
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      // Re-derivation: system.derived.preyBonus mirrors the authored system.preyBonus.
      r.derive({
        id: "test.preyBonus",
        documentType: "Actor",
        subtypes: ["character"],
        phase: "derived",
        reads: ["system.preyBonus"],
        writes: ["system.derived.preyBonus"],
        run(doc) {
          const sys = doc["system"] as Record<string, unknown>;
          const derived = (sys["derived"] ?? {}) as Record<string, unknown>;
          derived["preyBonus"] = sys["preyBonus"];
          sys["derived"] = derived;
        },
      });
      r.registerRollResolver({
        resolve(input) {
          if (input.rollContext.options.includes("action:boom")) throw new Error("resolver bug");
          const options = new Set<string>(input.rollContext.options);
          for (const o of input.target?.options ?? []) options.add(`target:${o}`);
          const derived = (input.actor["system"] as Record<string, unknown>)["derived"] as
            | Record<string, unknown>
            | undefined;
          const bonus = typeof derived?.["preyBonus"] === "number" ? derived["preyBonus"] : 0;
          const attack = input.rollContext.selectors.includes("attack-roll");
          const hit =
            attack &&
            input.target !== null &&
            options.has("target:mark:hunted-prey") &&
            bonus !== 0;
          // A modifier the actor would own only with a feat the client could forge.
          const featHit =
            attack &&
            input.target !== null &&
            options.has("feat:x") &&
            options.has("target:mark:hunted-prey");
          const mods = [
            ...(hit
              ? [
                  {
                    slug: "prey-bonus",
                    label: "Contra a presa",
                    type: "circumstance",
                    value: bonus,
                  },
                ]
              : []),
            ...(featHit ? [{ slug: "feat-x", label: "Talento X", type: "untyped", value: 7 }] : []),
          ];
          return {
            modifiers: mods,
            total: mods.reduce((a, m) => a + m.value, 0),
            notes: attack
              ? [
                  { selector: "attack-roll", title: "Sempre", text: "", sourceItemId: "feat1" },
                  {
                    selector: "attack-roll",
                    title: "No acerto",
                    text: "",
                    outcome: ["success", "criticalSuccess"],
                    sourceItemId: "feat1",
                  },
                  {
                    selector: "attack-roll",
                    title: "No erro",
                    text: "",
                    outcome: ["failure", "criticalFailure"],
                    sourceItemId: "feat1",
                  },
                ]
              : [],
          };
        },
      });
      r.onRollResolved("test.capture", (e) => {
        hookCalls.push(e);
      });
    },
  );
}

/** Mark source injected in place of `TokenMark` (BHR-F3-06): the hunter marked the prey token. */
const marks = { preyMarked: false };
const markSource: TokenMarkSource = {
  marksOn({ rollerActorId, targetTokenId }) {
    return marks.preyMarked && rollerActorId === HUNTER_ACTOR_ID && targetTokenId === PREY_TOKEN_ID
      ? ["hunted-prey"]
      : [];
  },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerId: string;
  port: number;
}

function insertActor(db: FusionDatabase, id: string, name: string, doc: Record<string, unknown>) {
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      JSON.stringify({ _id: id, name, type: "character", ...doc }),
      name,
      "character",
      now,
      now,
    );
}

function seed(db: FusionDatabase, playerId: string): void {
  const now = Date.now();
  const scene = {
    _id: SCENE_ID,
    name: "Floresta",
    active: true,
    tokens: [
      { _id: PREY_TOKEN_ID, name: "Javali", actorId: PREY_ACTOR_ID, hidden: false },
      { _id: OTHER_TOKEN_ID, name: "Lobo", actorId: OTHER_ACTOR_ID, hidden: false },
    ],
  };
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(SCENE_ID, JSON.stringify(scene), "Floresta", now, now);

  insertActor(db, HUNTER_ACTOR_ID, "Caçador", {
    ownership: { default: 0, [playerId]: 3 },
    system: { preyBonus: PREY_BONUS, derived: { preyBonus: STALE_DERIVED_BONUS } },
  });
  // Same bonus in its data, but the player does NOT own it.
  insertActor(db, STRANGER_ACTOR_ID, "Estranho", {
    ownership: { default: 0 },
    system: { preyBonus: PREY_BONUS },
  });
  insertActor(db, PREY_ACTOR_ID, "Javali", {
    ownership: { default: 0 },
    system: { attributes: { ac: { value: PREY_AC } } },
  });
  insertActor(db, OTHER_ACTOR_ID, "Lobo", {
    ownership: { default: 0 },
    system: { attributes: { ac: { value: PREY_AC } } },
  });
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = join(
    tmpdir(),
    `fusion-roll-resolution-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-roll-resolution-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Flavio",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  seed(fusionDb, player.id);

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Roll resolution", systemId: "roll-resolution-test" },
  });

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    systemId: "roll-resolution-test",
    systemModule: buildTestSystem(),
    tokenMarkSource: markSource,
  });

  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerId: player.id,
    port,
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

function sendOp(
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

interface TermLike {
  type: string;
  total: number;
}
interface MessageLike {
  _id?: string;
  content?: string;
  rolls?: { total: number; terms: TermLike[]; degreeOfSuccess?: string }[];
  flags?: {
    fusion?: {
      rollContext?: { actorId: string; options: string[] };
      rollNotes?: { title: string }[];
      conditionalModifiers?: { slug: string; value: number }[];
    };
  };
}

function nextChatMessage(socket: ClientSocket, timeoutMs = 3000): Promise<MessageLike> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:create") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "ChatMessage") return;
      socket.off("op", handler);
      resolve((payload.documents?.[0] ?? {}) as MessageLike);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no chat doc:create broadcast"));
    }, timeoutMs);
  });
}

/** What the server added beyond the dice: total − the dice terms. */
function flatPart(msg: MessageLike): number {
  const roll = msg.rolls?.[0];
  if (!roll) throw new Error("message has no roll");
  const dice = roll.terms.filter((t) => t.type === "dice").reduce((a, t) => a + t.total, 0);
  return roll.total - dice;
}

function attackPayload(
  worldId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    content: "/r 1d20+5 # Golpe",
    worldId,
    speakerActorId: HUNTER_ACTOR_ID,
    target: { tokenId: PREY_TOKEN_ID },
    flags: {
      fusion: {
        rollContext: {
          actorId: HUNTER_ACTOR_ID,
          selectors: ["attack-roll"],
          options: ["action:strike"],
        },
      },
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BHR-F2-05 — rolagem resolvida no servidor (RollNotes + onRollResolved)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    hookCalls.length = 0;
    marks.preyMarked = false;
    ctx = await buildTestContext();
    [gmSocket, playerSocket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  async function targetPrey(): Promise<void> {
    const ack = await sendOp(playerSocket, "combat:target", {
      tokenId: PREY_TOKEN_ID,
      targeted: true,
    });
    expect(ack["ok"]).toBe(true);
  }

  it("modificador condicionado a target:mark:hunted-prey soma só quando o alvo da targetSnapshot está marcado", async () => {
    await targetPrey();

    // Unmarked: the base formula only.
    const first = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", attackPayload(ctx.worldId));
    expect(flatPart(await first)).toBe(5);

    // Marked: +2, read from the RE-DERIVED actor (the stale derived 99 is never used).
    marks.preyMarked = true;
    const second = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", attackPayload(ctx.worldId));
    const msg = await second;
    expect(flatPart(msg)).toBe(5 + PREY_BONUS);
    expect(msg.flags?.fusion?.conditionalModifiers).toEqual([
      expect.objectContaining({ slug: "prey-bonus", value: PREY_BONUS }),
    ]);
    expect(msg.flags?.fusion?.rollContext?.actorId).toBe(HUNTER_ACTOR_ID);
  });

  it("sem payload.target resolvido, o modificador de alvo não soma mesmo com marca e alvo mirado", async () => {
    marks.preyMarked = true;
    await targetPrey();
    const payload = attackPayload(ctx.worldId);
    delete payload["target"];
    const next = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", payload);
    expect(flatPart(await next)).toBe(5);
  });

  it("B1: mira a presa marcada e ataca outro token — sem bônus contra a presa (uma fonte de alvo só)", async () => {
    marks.preyMarked = true;
    await targetPrey();
    const next = nextChatMessage(gmSocket);
    await sendOp(
      playerSocket,
      "chat:send",
      attackPayload(ctx.worldId, { target: { tokenId: OTHER_TOKEN_ID } }),
    );
    const msg = await next;
    expect(flatPart(msg)).toBe(5);
    expect(msg.flags?.fusion?.conditionalModifiers ?? []).toEqual([]);
  });

  it("B1: o bônus resolve contra o MESMO alvo que gradua o ataque (payload.target marcado, mira em outro)", async () => {
    marks.preyMarked = true;
    await sendOp(playerSocket, "combat:target", { tokenId: OTHER_TOKEN_ID, targeted: true });
    const next = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", attackPayload(ctx.worldId));
    const msg = await next;
    expect(flatPart(msg)).toBe(5 + PREY_BONUS);
    expect(msg.rolls?.[0]?.degreeOfSuccess).toBeDefined();
  });

  it("I2: opções feat:/effect: vindas do cliente não ligam condicional; action:* passa", async () => {
    marks.preyMarked = true;
    await targetPrey();
    const next = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", {
      ...attackPayload(ctx.worldId),
      flags: {
        fusion: {
          rollContext: {
            actorId: HUNTER_ACTOR_ID,
            selectors: ["attack-roll"],
            options: ["action:strike", "feat:x", "effect:x", "self:effect:x"],
          },
        },
      },
    });
    const msg = await next;
    expect(flatPart(msg)).toBe(5 + PREY_BONUS);
    expect(msg.flags?.fusion?.rollContext?.options).toEqual(["action:strike"]);
  });

  it("payload forjado é ignorado: opção target:* do cliente, rollNotes forjadas e ator alheio (DF-17)", async () => {
    await targetPrey();

    const forged = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", {
      ...attackPayload(ctx.worldId),
      flags: {
        fusion: {
          rollContext: {
            actorId: HUNTER_ACTOR_ID,
            selectors: ["attack-roll"],
            options: ["action:strike", "target:mark:hunted-prey"],
          },
          rollNotes: [{ selector: "attack-roll", title: "FORJADA", text: "", sourceItemId: "x" }],
          conditionalModifiers: [{ slug: "forjado", label: "x", type: "untyped", value: 10 }],
        },
      },
    });
    const msg = await forged;
    expect(flatPart(msg)).toBe(5);
    expect(msg.flags?.fusion?.conditionalModifiers ?? []).toEqual([]);
    expect(msg.flags?.fusion?.rollContext?.options).toEqual(["action:strike"]);
    expect((msg.flags?.fusion?.rollNotes ?? []).map((n) => n.title)).not.toContain("FORJADA");

    // An actor the player does not own: no resolution at all, no hook.
    marks.preyMarked = true;
    hookCalls.length = 0;
    const stranger = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", {
      ...attackPayload(ctx.worldId),
      flags: {
        fusion: {
          rollContext: { actorId: STRANGER_ACTOR_ID, selectors: ["attack-roll"], options: [] },
        },
      },
    });
    const strangerMsg = await stranger;
    expect(flatPart(strangerMsg)).toBe(5);
    expect(strangerMsg.flags?.fusion?.rollContext).toBeUndefined();
    expect(hookCalls).toHaveLength(0);
  });

  it("onRollResolved dispara uma vez por rolagem, com o grau do servidor e os alvos; notas filtradas pelo grau", async () => {
    await targetPrey();
    const next = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", attackPayload(ctx.worldId));
    const msg = await next;

    expect(hookCalls).toHaveLength(1);
    const call = hookCalls[0];
    const degree = msg.rolls?.[0]?.degreeOfSuccess;
    expect(degree).toBeDefined();
    expect(call?.degree).toBe(degree);
    expect(call?.targets).toEqual([
      { tokenId: PREY_TOKEN_ID, actorId: PREY_ACTOR_ID, sceneId: SCENE_ID },
    ]);
    expect(call?.rollContext.actorId).toBe(HUNTER_ACTOR_ID);
    expect(call?.message._id).toBe(msg._id);

    const titles = (msg.flags?.fusion?.rollNotes ?? []).map((n) => n.title);
    const hit = degree === "success" || degree === "criticalSuccess";
    expect(titles).toContain("Sempre");
    expect(titles.includes("No acerto")).toBe(hit);
    expect(titles.includes("No erro")).toBe(!hit);

    // A plain roll with no context resolves nothing and fires nothing.
    const plain = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", { content: "/r 1d20+5", worldId: ctx.worldId });
    await plain;
    expect(hookCalls).toHaveLength(1);
  });

  it("I-5: o evento onRollResolved leva as opções de alvo que o servidor resolveu (marca da presa), e só elas", async () => {
    await targetPrey();

    const unmarked = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", attackPayload(ctx.worldId));
    await unmarked;
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]?.targetOptions ?? []).not.toContain("mark:hunted-prey");

    marks.preyMarked = true;
    const marked = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", attackPayload(ctx.worldId));
    await marked;
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[1]?.targetOptions).toContain("mark:hunted-prey");
  });

  it("resolvedor do sistema que lança não derruba a rolagem: sai sem contexto e sem ouvinte", async () => {
    marks.preyMarked = true;
    await targetPrey();
    const next = nextChatMessage(gmSocket);
    const ack = await sendOp(playerSocket, "chat:send", {
      ...attackPayload(ctx.worldId),
      flags: {
        fusion: {
          rollContext: {
            actorId: HUNTER_ACTOR_ID,
            selectors: ["attack-roll"],
            options: ["action:boom"],
          },
        },
      },
    });
    expect(ack["ok"]).toBe(true);
    const msg = await next;
    expect(flatPart(msg)).toBe(5);
    expect(msg.flags?.fusion?.rollContext).toBeUndefined();
    expect(hookCalls).toHaveLength(0);
  });

  it("rolagem cega: as notas e os modificadores não chegam ao jogador, o Mestre vê", async () => {
    marks.preyMarked = true;
    await targetPrey();
    const toGm = nextChatMessage(gmSocket);
    const toPlayer = nextChatMessage(playerSocket);
    const ack = await sendOp(playerSocket, "chat:send", {
      ...attackPayload(ctx.worldId),
      rollMode: "blindroll",
    });

    const gmMsg = await toGm;
    expect((gmMsg.flags?.fusion?.rollNotes ?? []).length).toBeGreaterThan(0);
    expect(gmMsg.flags?.fusion?.conditionalModifiers).toHaveLength(1);

    const playerMsg = await toPlayer;
    expect(playerMsg.flags?.fusion?.rollNotes).toBeUndefined();
    expect(playerMsg.flags?.fusion?.conditionalModifiers).toBeUndefined();
    const ackMsg = (ack["result"] as { message: MessageLike }).message;
    expect(ackMsg.flags?.fusion?.rollNotes).toBeUndefined();
    expect(ackMsg.flags?.fusion?.conditionalModifiers).toBeUndefined();
  });
});
