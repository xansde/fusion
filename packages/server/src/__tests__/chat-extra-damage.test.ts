/**
 * BHR-F4-09 — the Apoio's extra damage reaches the roll the SERVER makes (REQ-PET-119, REQ-CHT-064), through the
 * real chat handler: the card, the graded attack under it, the live target, the damage roll that nests under the
 * card.
 *
 * The rule (Player Core, the bear's Support Benefit), as the tests assert it:
 *   - the owner's Strike that hits a creature within the bear's reach deals an extra 1d8 slashing;
 *   - a miss adds nothing, and neither does a target 30 feet from the bear;
 *   - the extra damage is the bear's, so a critical hit does not double it.
 *
 * The test system below is written for this file (no pf2e import): its resolver NAMES the dice for a Strike's
 * damage roll, exactly the contract of `RollResolution.extraDamage`; the pf2e side is
 * `systems/pf2e/src/__tests__/supportExtraDamage.test.ts`.
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
import { PROTOCOL_VERSION } from "@fusion/shared";
import { defineSystem } from "@fusion/system-api";
import type { SystemModule } from "@fusion/system-api";
import { reserveFreePort } from "./helpers/ports.js";

const SCENE_ID = "extraDmgScene0001";
const OWNER_ACTOR_ID = "ownerActor000001";
const BEAR_ACTOR_ID = "bearActor0000001";
const BEAR_TOKEN_ID = "bearToken0000001";
const FOE_ACTOR_ID = "foeActor00000001";
const FOE_TOKEN_ID = "foeToken00000001";
const SQUARE = 100;
const FOE_AC = 15;

/** Where the foe stands, in squares from the bear; a test moves it. */
const world = { foeSquares: 1, bearReach: 5, condBonus: 0, outcomeNotes: false };

function buildTestSystem(): SystemModule {
  return defineSystem(
    {
      id: "extra-damage-test",
      title: "Extra damage test",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: {},
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      r.registerRollResolver({
        resolve(input) {
          const damage = input.rollContext.selectors.includes("strike-damage");
          const bear = (input.companions ?? [])[0];
          // A conditional modifier of the Strike's damage (a flat bonus against a marked target, say) and the notes that
          // only apply on one degree of the attack (a debilitating strike on a hit, a bonus on a critical).
          const conditional = damage && world.condBonus !== 0;
          return {
            modifiers: conditional
              ? [{ slug: "cond", label: "Condicional", type: "untyped", value: world.condBonus }]
              : [],
            total: conditional ? world.condBonus : 0,
            notes:
              damage && world.outcomeNotes
                ? [
                    {
                      selector: "strike-damage",
                      title: "Só no acerto",
                      text: "x",
                      outcome: ["success"],
                      sourceItemId: "it1",
                      slug: "on-hit",
                    },
                    {
                      selector: "strike-damage",
                      title: "Só no crítico",
                      text: "y",
                      outcome: ["criticalSuccess"],
                      sourceItemId: "it2",
                      slug: "on-crit",
                    },
                  ]
                : [],
            ...(damage && bear !== undefined
              ? {
                  extraDamage: [
                    {
                      slug: "support-bear",
                      label: "Apoio do urso",
                      count: 1,
                      die: "d8",
                      damageType: "slashing",
                      doubleOnCrit: false,
                      gate: {
                        withinReachOf: "companion" as const,
                        companionActorId: bear["_id"] as string,
                        reachFeet: world.bearReach,
                      },
                    },
                  ],
                }
              : {}),
          };
        },
      });
    },
  );
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  worldId: string;
  playerToken: string;
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
    grid: { size: SQUARE, distance: 5, type: "square" },
    tokens: [
      { _id: BEAR_TOKEN_ID, name: "Urso", actorId: BEAR_ACTOR_ID, x: 0, y: 0, hidden: false },
      {
        _id: FOE_TOKEN_ID,
        name: "Javali",
        actorId: FOE_ACTOR_ID,
        x: world.foeSquares * SQUARE,
        y: 0,
        hidden: false,
      },
    ],
  };
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(SCENE_ID, JSON.stringify(scene), "Floresta", now, now);

  const size = { traits: { size: { value: "med" } } };
  insertActor(db, OWNER_ACTOR_ID, "Dono", {
    ownership: { default: 0, [playerId]: 3 },
    system: { ...size },
  });
  insertActor(db, BEAR_ACTOR_ID, "Urso", {
    ownership: { default: 0, [playerId]: 3 },
    system: {
      ...size,
      companionKind: "animalCompanion",
      masterActorId: OWNER_ACTOR_ID,
      companion: { typeSlug: "bear", stage: "young", active: true },
    },
  });
  insertActor(db, FOE_ACTOR_ID, "Javali", {
    ownership: { default: 0 },
    system: { ...size, attributes: { ac: { value: FOE_AC } } },
  });
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = join(
    tmpdir(),
    `fusion-extra-damage-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-extra-damage-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Flavio",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  seed(fusionDb, player.id);
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Extra damage", systemId: "extra-damage-test" },
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
    systemId: "extra-damage-test",
    systemModule: buildTestSystem(),
  });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });
  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    worldId,
    playerToken: playerLogin.accessToken,
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

interface Ack {
  ok?: boolean;
  result?: { message?: Message };
}

function sendOp(socket: ClientSocket, type: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Ack);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

interface Message {
  _id: string;
  rolls?: {
    formula: string;
    total: number;
    degreeOfSuccess?: string;
    terms: { type: string; total: number }[];
  }[];
  flags?: {
    fusion?: {
      extraDamage?: { dice: string; summary: string; slug: string }[];
      rollNotes?: { title: string; text: string }[];
    };
  };
}

/** The dice terms of the message's first roll, as "count" of dice rolled in total. */
function diceTerms(msg: Message): number {
  return (msg.rolls?.[0]?.terms ?? []).filter((t) => t.type === "dice").length;
}

describe("BHR-F4-09 — Apoio do urso: o dano extra entra na rolagem de dano do servidor", () => {
  let ctx: TestContext;
  let player: ClientSocket;

  async function boot(foeSquares: number): Promise<void> {
    world.foeSquares = foeSquares;
    world.bearReach = 5;
    ctx = await buildTestContext();
    player = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const ack = await sendOp(player, "combat:target", { tokenId: FOE_TOKEN_ID, targeted: true });
    expect(ack.ok).toBe(true);
  }

  beforeEach(() => {
    world.foeSquares = 1;
    world.condBonus = 0;
    world.outcomeNotes = false;
  });

  afterEach(async () => {
    player.disconnect();
    await teardown(ctx);
  });

  /** The degree the server graded on the last attack of `strike`. */
  let lastDegree: string | undefined;

  /** The card announcement, then the attack under it; returns the card id. */
  async function strike(attackFormula: string): Promise<string> {
    const card = await sendOp(player, "chat:send", {
      content: "Dono ataca",
      worldId: ctx.worldId,
      speakerActorId: OWNER_ACTOR_ID,
    });
    const cardId = card.result?.message?._id;
    if (cardId === undefined) throw new Error("no card id");
    const attack = await sendOp(player, "chat:send", {
      content: `/r ${attackFormula} # Golpe`,
      worldId: ctx.worldId,
      speakerActorId: OWNER_ACTOR_ID,
      target: { tokenId: FOE_TOKEN_ID },
      flags: {
        parentMessageId: cardId,
        checkContext: { kind: "attack", targetTokenId: FOE_TOKEN_ID, mapIndex: 0 },
      },
    });
    expect(attack.ok, JSON.stringify(attack)).toBe(true);
    lastDegree = attack.result?.message?.rolls?.[0]?.degreeOfSuccess;
    return cardId;
  }

  /** A natural 1 or 20 moves the degree a step, so a given degree cannot be fixed by the dice alone: roll again until the server grades it so. */
  async function strikeUntil(degree: string, formula = "1d20+5"): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt++) {
      // The chat takes 5 messages per second per user: past the first miss, wait out the window.
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1_100));
      const cardId = await strike(formula);
      if (lastDegree === degree) return cardId;
    }
    throw new Error(`never graded ${degree}`);
  }

  async function damage(
    cardId: string,
    formula = "1d4+2",
    extra: Record<string, unknown> = {},
  ): Promise<Message> {
    const ack = await sendOp(player, "chat:send", {
      content: `/r ${formula} # Dano`,
      worldId: ctx.worldId,
      speakerActorId: OWNER_ACTOR_ID,
      flags: {
        parentMessageId: cardId,
        fusion: {
          rollContext: {
            actorId: OWNER_ACTOR_ID,
            selectors: ["strike-damage", "damage"],
            options: ["action:strike"],
          },
        },
      },
      ...extra,
    });
    expect(ack.ok).toBe(true);
    const msg = ack.result?.message;
    if (msg === undefined) throw new Error("no damage message");
    return msg;
  }

  it("golpe que acerta alvo a 5 pés do urso: o dano ganha +1d8 e o card anota o Apoio", async () => {
    await boot(1);
    const card = await strike("1d20+30");
    const msg = await damage(card);
    expect(diceTerms(msg)).toBe(2); // 1d4 do golpe + 1d8 do Apoio
    expect(msg.rolls?.[0]?.formula).toContain("1d8");
    expect(msg.flags?.fusion?.extraDamage).toEqual([
      expect.objectContaining({
        slug: "support-bear",
        dice: "1d8",
        summary: "Apoio do urso: +1d8 de dano cortante",
      }),
    ]);
    expect(msg.flags?.fusion?.rollNotes).toEqual([
      expect.objectContaining({ title: "Apoio do urso", text: "+1d8 de dano cortante" }),
    ]);
  });

  it("alvo a 30 pés do urso: o Golpe acerta e o dano NÃO ganha o Apoio", async () => {
    await boot(6);
    const card = await strike("1d20+30");
    const msg = await damage(card);
    expect(diceTerms(msg)).toBe(1);
    expect(msg.flags?.fusion?.extraDamage).toBeUndefined();
  });

  it("golpe que erra: nada soma, mesmo com o alvo ao alcance do urso", async () => {
    await boot(1);
    const card = await strike("1d20-30");
    expect(lastDegree).toMatch(/failure/i);
    const msg = await damage(card);
    expect(diceTerms(msg)).toBe(1);
    expect(msg.flags?.fusion?.extraDamage).toBeUndefined();
  });

  it("rolagem de dano solta, sem o card do golpe acertado, não ganha o Apoio", async () => {
    await boot(1);
    const msg = await damage("nonexistentcard");
    expect(diceTerms(msg)).toBe(1);
    expect(msg.flags?.fusion?.extraDamage).toBeUndefined();
  });

  it("acerto crítico: o dano do urso não dobra (continua 1d8 mesmo com a fórmula crítica do golpe)", async () => {
    await boot(1);
    // A natural 20 with a huge bonus is a critical success against AC 15 (10 or more above).
    const card = await strikeUntil("criticalSuccess", "1d20+40");
    expect(lastDegree).toBe("criticalSuccess");
    const msg = await damage(card, "(1d4+2)*2");
    expect(msg.rolls?.[0]?.formula).toContain("1d8");
    expect(msg.rolls?.[0]?.formula).not.toContain("2d8");
    expect(msg.flags?.fusion?.extraDamage).toEqual([expect.objectContaining({ dice: "1d8" })]);
  });

  // PF2e remaster (Player Core, critical hits): on a critical hit ALL the damage of the Strike is doubled, the
  // conditional modifiers included. The bear's Support is a separate damage and is not (above).
  it("acerto crítico: o modificador condicional de dano dobra junto com o golpe (+2 vira +4)", async () => {
    await boot(6); // out of the bear's reach: only the conditional modifier is in play
    world.condBonus = 2;
    const card = await strikeUntil("criticalSuccess", "1d20+40");
    expect(lastDegree).toBe("criticalSuccess");
    const msg = await damage(card, "(1d4+2)*2");
    expect(msg.rolls?.[0]?.formula).toMatch(/\(1d4\+2\)\*2 \+ 4(?!\d)/);
  });

  it("acerto comum: o modificador condicional entra uma vez só (+2)", async () => {
    await boot(6);
    world.condBonus = 2;
    const card = await strikeUntil("success");
    expect(lastDegree).toBe("success");
    const msg = await damage(card, "1d4+2");
    expect(msg.rolls?.[0]?.formula).toMatch(/1d4\+2 \+ 2(?!\d)/);
  });

  it("acerto crítico com bônus condicional negativo: a penalidade também dobra", async () => {
    await boot(6);
    world.condBonus = -1;
    const card = await strikeUntil("criticalSuccess", "1d20+40");
    const msg = await damage(card, "(1d4+2)*2");
    expect(msg.rolls?.[0]?.formula).toMatch(/\(1d4\+2\)\*2 - 2(?!\d)/);
  });

  // The damage roll has no degree of its own: a note that applies on one degree is judged by the degree of the
  // attack the server graded under the same card (the proof the Apoio already uses).
  it("nota de dano com `outcome`: vale o grau do ataque que o servidor graduou no mesmo card (acerto)", async () => {
    await boot(6);
    world.outcomeNotes = true;
    const card = await strikeUntil("success");
    expect(lastDegree).toBe("success");
    const msg = await damage(card);
    expect((msg.flags?.fusion?.rollNotes as { title: string }[]).map((n) => n.title)).toEqual([
      "Só no acerto",
    ]);
  });

  it("nota de dano com `outcome`: vale o grau do ataque que o servidor graduou no mesmo card (crítico)", async () => {
    await boot(6);
    world.outcomeNotes = true;
    const card = await strikeUntil("criticalSuccess", "1d20+40");
    expect(lastDegree).toBe("criticalSuccess");
    const msg = await damage(card, "(1d4+2)*2");
    expect((msg.flags?.fusion?.rollNotes as { title: string }[]).map((n) => n.title)).toEqual([
      "Só no crítico",
    ]);
  });

  it("nota de dano com `outcome`, sem ataque graduado sob o card: comportamento antigo (a nota some)", async () => {
    await boot(6);
    world.outcomeNotes = true;
    const msg = await damage("nonexistentcard");
    expect(msg.flags?.fusion?.rollNotes).toEqual([]);
  });
});
