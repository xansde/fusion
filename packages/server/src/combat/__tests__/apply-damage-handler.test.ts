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
  ApplyDamageOptions,
  RollDamageAnswer,
  RollDamageInput,
  RollResolution,
  RollResolutionInput,
} from "@fusion/system-api";
import type { RollDamageFlag } from "@fusion/shared";

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
/** A hardcoded "resistance 3" this fake applies ONLY to `type: "cold"` — a
 * sentinel no other test in this file uses (ALQ-F1-10's `computeByType`
 * `resistanceApplied` regression test below, plus the B2 multiplier ×
 * resistance crossing tests, are the only callers). Every other type is
 * untouched (raw amount, matching every pre-existing test's expectation of
 * a game-rule-free "subtract the summed amount" double). Value picked to
 * match the onda-5 review's own probe numbers (`.fusion-build/alquimista/
 * onda-5/REVISAO.md` B3/B2: "resistência 3 real + botão ½"). */
const FAKE_COLD_RESISTANCE = 3;

/**
 * B2 fix (onda-5 adversarial review): scale ONLY (multiplier ½/×2, or a
 * basicSave degree) — the fake's own resistance is applied SEPARATELY,
 * after this, in `makeFakeActorMechanics`. Deliberately mirrors the generic
 * d20 vocabulary `ApplyDamageOptions.basicSave.degree` already documents
 * elsewhere in this file (the B3 tests) — not a pf2e-specific formula, but
 * the same shape the real satellite pipeline uses (`scaleInstanceAmount`,
 * `systems/pf2e/src/actions/damage.ts`), which is exactly what this fake
 * needs to reproduce to exercise `computeByType`'s corrected
 * `resistanceApplied` derivation (it now reads the breakdown's
 * `step: "input"` POST-scale baseline, never the raw amount).
 */
function scaleFakeAmount(amount: number, opts: ApplyDamageOptions): number {
  if (opts.basicSave) {
    switch (opts.basicSave.degree) {
      case "CriticalSuccess":
        return 0;
      case "Success":
        return Math.floor(amount / 2);
      case "CriticalFailure":
        return amount * 2;
      default:
        return amount;
    }
  }
  if (opts.multiplier !== undefined) return Math.floor(amount * opts.multiplier);
  return amount;
}

function makeFakeActorMechanics(instancesLog: ResolvedDamageInstance[][]): ActorMechanics {
  return {
    applyDamage(actor, instances, opts): ActorMechanicsPatch {
      instancesLog.push([...instances]);
      const system = actor["system"] as { attributes?: { hp?: { value?: number } } } | undefined;
      const currentHp = system?.attributes?.hp?.value ?? 0;
      const breakdown: ActorMechanicsPatch["breakdown"] = [];
      const finalAmounts = instances.map((i) => {
        const scaled = scaleFakeAmount(i.amount, opts);
        // B2 fix fixture: a `step: "input"` entry with the POST-scale,
        // PRE-resistance amount — same convention the real pf2e
        // `applyDamagePipeline` uses (Step 1, `damage.ts`) — immediately
        // before the `step === type` bridge below, so `computeByType` can
        // pair them and derive `resistanceApplied` from the reduction the
        // fake's resistance (not the scale) actually caused.
        breakdown.push({ step: "input", label: `${i.type} input`, amount: scaled });
        const final = i.type === "cold" ? Math.max(0, scaled - FAKE_COLD_RESISTANCE) : scaled;
        // ALQ-F1-10 regression fixture: `step === type` (the real pf2e
        // `damage.ts` convention this task's fix made `computeByType` rely
        // on) with the FINAL (post-scale, post-fake-resistance) amount —
        // see `computeByType`'s own doc comment in actor-mechanics-service.ts.
        breakdown.push({ step: i.type, label: i.type, amount: final });
        return final;
      });
      const totalDamage = finalAmounts.reduce((sum, amount) => sum + amount, 0);
      const newHp = Math.max(0, currentHp - totalDamage);
      return {
        diff: { system: { attributes: { hp: { value: newHp } } } },
        embeddedCreate: [],
        embeddedDelete: [],
        breakdown,
        flags: { droppedToZero: newHp === 0, dead: newHp === 0, dyingChanged: false },
      };
    },
    applyCondition() {
      throw new Error("applyCondition is not exercised by this suite (ALQ-F1-09)");
    },
  };
}

/**
 * #225 (REQ-SYS-166): the fake system's derivation of a damage roll's components. Keys, never game rules:
 * `damage:<type>` is a plain component of that type; `strikeDamage:sword` a cold-iron magical slashing
 * strike; a `spell` card named "Bola de Fogo" a fire spell. Anything else proves nothing (`null`).
 *
 * REQ-SYS-167: each answer also vouches for the formulas the system itself derives for that source — the
 * sword rolls `1d8+4` (`(1d8+4)*2` on a critical hit), the fireball `6d6`, and a `damage:<type>` key the
 * handful of formulas this suite rolls with it. A player's roll whose formula is not one of them records
 * no components.
 */
const SWORD_DAMAGE: RollDamageFlag = {
  source: { kind: "strike", label: "Espada de ferro frio", itemId: "sword" },
  components: [{ type: "slashing", traits: ["magical"], materials: ["cold-iron"] }],
};
const SWORD_FORMULAS = { normal: ["1d8+4"], critical: ["(1d8+4)*2"] };
const FAKE_DAMAGE_FORMULAS = [
  "2d6+4",
  "1d4",
  "1d6",
  "1d6+2",
  "1d8",
  "1d6+1",
  "2d6",
  "2d6[fire]+1",
  "30d6",
];

function fakeDamageComponents(input: RollDamageInput): RollDamageAnswer | null {
  if (input.actor["_id"] !== CASTER_ACTOR_ID && input.actor["_id"] !== T1_ACTOR_ID) return null;
  const key = input.statistic;
  if (key === "strikeDamage:sword") return { ...SWORD_DAMAGE, formulas: SWORD_FORMULAS };
  if (key?.startsWith("damage:") === true) {
    return {
      source: { kind: "test", label: key },
      components: [{ type: key.slice(7) }],
      formulas: { normal: FAKE_DAMAGE_FORMULAS },
    };
  }
  if (input.card?.kind === "spell" && input.card.name === "Bola de Fogo") {
    return {
      source: { kind: "spell", label: "Bola de Fogo" },
      components: [{ type: "fire", traits: ["fire", "magical"] }],
      formulas: { normal: ["6d6"] },
    };
  }
  return null;
}

/**
 * The fake's conditional modifier (REQ-SYS-167, the situational modifier the UI allows): a roll whose
 * context names the `test-prey` selector gets a +2 circumstance bonus the SERVER appends to the formula.
 */
function fakeResolve(input: RollResolutionInput): RollResolution {
  if (!input.rollContext.selectors.includes("test-prey")) {
    return { modifiers: [], total: 0, notes: [] };
  }
  return {
    modifiers: [{ slug: "prey", label: "Presa", type: "circumstance", value: 2 }],
    total: 2,
    notes: [],
  };
}

/** `flags` of a damage roll that names the fake's `damage:<type>` statistic for the caster (#225). */
function damageFlags(type: string): { fusion: { statistic: { actorId: string; key: string } } } {
  return { fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: `damage:${type}` } } };
}

function makeSystemModule(
  hookLog: string[],
  instancesLog: ResolvedDamageInstance[][],
): SystemModule {
  return defineSystem({ ...VALID_MANIFEST }, (r) => {
    r.registerActorMechanics(makeFakeActorMechanics(instancesLog));
    r.registerRollResolver({
      resolve: fakeResolve,
      damageComponents: fakeDamageComponents,
    });
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
    setTimeout(() => reject(new Error("connect timeout")), 15_000);
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

/** `flags.fusion.damage` of a stored chat message, as the SERVER wrote it (#225). */
function readStoredDamageFlag(db: FusionDatabase, messageId: string): unknown {
  const row = db.raw.prepare(`SELECT data FROM chat_messages WHERE id = ?`).get(messageId) as {
    data: string;
  };
  const msg = JSON.parse(row.data) as { flags?: { fusion?: Record<string, unknown> } };
  return msg.flags?.fusion?.["damage"];
}

/** Insert a chat message exactly as the server would have stored it (a card, a graded attack). */
function seedChatMessage(db: FusionDatabase, msg: Record<string, unknown>): void {
  const now = Date.now();
  const speaker = msg["speaker"] as { userId: string };
  const stored = { timestamp: now, whisper: [], blind: false, ...msg };
  db.raw
    .prepare(
      `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(msg["_id"], JSON.stringify(stored), now, speaker.userId, now, now);
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
        flags: damageFlags("fire"),
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
        flags: damageFlags("fire"),
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
        flags: damageFlags("fire"),
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
        flags: damageFlags("fire"),
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
        flags: damageFlags("cold"),
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
        flags: damageFlags("fire"),
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

  // B2 fix (onda-5 adversarial review, `.fusion-build/alquimista/onda-5/
  // REVISAO.md`): `resistanceApplied` used to be `rawTotal - final`, so any
  // scale (multiplier ½/×2, basicSave degree) got mislabeled as resistance.
  // The three cases below are the exact crossing the review flagged as
  // uncovered — deterministic GM `amount` (no dice) so the expected numbers
  // match the review's own probe table (raw 10) precisely.
  it("B2: botão ½ sem resistência não fabrica resistanceApplied", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const ack = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", amount: 10 }],
        targetTokenIds: [T1_TOKEN_ID],
        multiplier: 0.5,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      const targets = (ack["result"] as { targets: Array<Record<string, unknown>> }).targets;
      const byType = targets[0]?.["byType"] as Array<Record<string, unknown>>;
      // Old bug: raw(10) - final(5) = 5 -> fabricated "(resistência 5)".
      expect(byType).toEqual([{ type: "fire", amount: 5 }]);
      expect(byType[0]).not.toHaveProperty("resistanceApplied");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP - 5);
    } finally {
      gmSocket.disconnect();
    }
  });

  it("B2: botão ½ combinado com resistência 3 real reporta só a resistência (3), não a escala (8)", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const ack = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "cold", amount: 10 }],
        targetTokenIds: [T1_TOKEN_ID],
        multiplier: 0.5,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      const targets = (ack["result"] as { targets: Array<Record<string, unknown>> }).targets;
      const byType = targets[0]?.["byType"] as Array<Record<string, unknown>>;
      // raw 10 -> scaled 5 (½) -> final 2 (resistance 3). Old bug:
      // raw(10) - final(2) = 8. Correct: scaled(5) - final(2) = 3.
      expect(byType).toEqual([
        { type: "cold", amount: 2, resistanceApplied: FAKE_COLD_RESISTANCE },
      ]);
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP - 2);
    } finally {
      gmSocket.disconnect();
    }
  });

  it("B2: basicSave CriticalSuccess (0×) não fabrica resistanceApplied", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const ack = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", amount: 10 }],
        targetTokenIds: [T1_TOKEN_ID],
        basicSave: { degree: "CriticalSuccess" },
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      const targets = (ack["result"] as { targets: Array<Record<string, unknown>> }).targets;
      const byType = targets[0]?.["byType"] as Array<Record<string, unknown>>;
      // Old bug: raw(10) - final(0) = 10 -> fabricated "(resistência 10)".
      expect(byType).toEqual([{ type: "fire", amount: 0 }]);
      expect(byType[0]).not.toHaveProperty("resistanceApplied");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
    } finally {
      gmSocket.disconnect();
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
        flags: damageFlags("fire"),
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

  it("B2: reaplicar a mesma (messageId, rollIndex) por um jogador é FORBIDDEN e não reaplica o dano", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: damageFlags("fire"),
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

  it("B2: jogador não reaplica a mesma rolagem no mesmo alvo trocando o multiplicador (×1 e depois ½ ou ×2)", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: damageFlags("fire"),
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      const source = { messageId: rollMsg._id, rollIndex: 0 };

      const first = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source }],
      });
      expect(first["ok"], JSON.stringify(first)).toBe(true);
      const hpAfterFirst = readActorHp(ctx.fusionDb, T1_ACTOR_ID);

      const half = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source }],
        multiplier: 0.5,
      });
      expect(half["ok"]).toBe(false);
      expect(half["code"]).toBe("FORBIDDEN");
      const basicSave = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source }],
        basicSave: { degree: "Failure" },
      });
      expect(basicSave["ok"]).toBe(false);
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(hpAfterFirst);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("B2: jogador não cura duas vezes com a mesma rolagem (Curar ×1 e depois ×½)", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d8+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: {
          fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" } },
        },
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      const source = { messageId: rollMsg._id, rollIndex: 0 };

      const heal = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "healing", source }],
      });
      expect(heal["ok"], JSON.stringify(heal)).toBe(true);
      const callsAfterHeal = ctx.instancesLog.length;
      const halfHeal = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "healing", source }],
        multiplier: 0.5,
      });
      expect(halfHeal["ok"]).toBe(false);
      expect(halfHeal["code"]).toBe("FORBIDDEN");
      expect(ctx.instancesLog.length).toBe(callsAfterHeal);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("B2: GM aplica a mesma rolagem com outro multiplicador (correção de mesa)", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const rollAck = await sendOp(gmSocket, "chat:send", {
        content: "/roll 1d6+1",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: damageFlags("fire"),
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      const source = { messageId: rollMsg._id, rollIndex: 0 };
      const first = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(first["ok"], JSON.stringify(first)).toBe(true);
      const half = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source }],
        targetTokenIds: [T1_TOKEN_ID],
        multiplier: 0.5,
      });
      expect(half["ok"], JSON.stringify(half)).toBe(true);
    } finally {
      gmSocket.disconnect();
    }
  });

  it("B2: GM continua podendo reaplicar a mesma chave (correção de mesa)", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const rollAck = await sendOp(gmSocket, "chat:send", {
        content: "/roll 1d6+1",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: damageFlags("fire"),
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
        flags: damageFlags("fire"),
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

  it("#225: traits/materials/category forjados por um jogador não chegam à mecânica; o GM os mantém", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: damageFlags("fire"),
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const damageAck = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [
          {
            type: "fire",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            category: "precision",
            traits: ["magical"],
            materials: ["cold-iron"],
          },
        ],
      });
      expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);
      const received = ctx.instancesLog.at(-1)?.[0];
      expect(received?.type).toBe("fire");
      expect(received?.traits).toBeUndefined();
      expect(received?.materials).toBeUndefined();
      expect(received?.category).toBeUndefined();
    } finally {
      playerSocket.disconnect();
    }

    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const gmAck = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [
          {
            type: "fire",
            amount: 5,
            category: "precision",
            traits: ["magical"],
            materials: ["cold-iron"],
          },
        ],
        targetTokenIds: [T2_TOKEN_ID],
      });
      expect(gmAck["ok"], JSON.stringify(gmAck)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({
        category: "precision",
        traits: ["magical"],
        materials: ["cold-iron"],
      });
    } finally {
      gmSocket.disconnect();
    }
  });

  it("#225: o tipo de dano de um jogador tem de bater com o tipo anotado na rolagem gravada", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6[fire]+1",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: damageFlags("fire"),
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      const flavors = JSON.stringify(rollMsg.rolls?.[0]);
      expect(flavors).toContain("fire");

      const forged = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "force", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(forged["ok"], JSON.stringify(forged)).toBe(false);
      expect(forged["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);

      const honest = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(honest["ok"], JSON.stringify(honest)).toBe(true);
    } finally {
      playerSocket.disconnect();
    }
  });

  // -------------------------------------------------------------------------
  // #225 (REQ-SYS-142 passo 2b, REQ-SYS-166): the damage roll records its own
  // components server-side (`flags.fusion.damage`, derived by the system from
  // the item/strike/spell); `actor:applyDamage` rereads them.
  // -------------------------------------------------------------------------

  it("#225 REQ-SYS-166: a rolagem de dano grava no servidor os componentes derivados pelo sistema; o jogador aplica tipo/traits/materiais gravados e o tipo forjado é recusado", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d8+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: { fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" } } },
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toEqual(SWORD_DAMAGE);

      const forged = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(forged["ok"]).toBe(false);
      expect(forged["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);

      const honest = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [
          {
            type: "slashing",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            amount: 999,
            category: "precision",
            traits: ["silver"],
            materials: ["adamantine"],
          },
        ],
      });
      expect(honest["ok"], JSON.stringify(honest)).toBe(true);
      expect(ctx.instancesLog.at(-1)).toEqual([
        {
          type: "slashing",
          amount: rollMsg.rolls?.[0]?.total,
          traits: ["magical"],
          materials: ["cold-iron"],
          critical: false,
          nonlethal: false,
        },
      ]);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("#225: 'untyped' do jogador (card sem tipo) vale o componente principal gravado; Curar mantém o modo do botão", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const roll = async (): Promise<ChatMessageLike> => {
        const ack = await sendOp(playerSocket, "chat:send", {
          content: "/roll 1d8+4",
          worldId: ctx.worldId,
          speakerActorId: CASTER_ACTOR_ID,
          flags: {
            fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" } },
          },
        });
        return (ack["result"] as { message: ChatMessageLike }).message;
      };

      const untypedMsg = await roll();
      const untyped = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "untyped", source: { messageId: untypedMsg._id, rollIndex: 0 } }],
      });
      expect(untyped["ok"], JSON.stringify(untyped)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({
        type: "slashing",
        materials: ["cold-iron"],
      });

      const healMsg = await roll();
      const heal = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "healing", source: { messageId: healMsg._id, rollIndex: 0 } }],
      });
      expect(heal["ok"], JSON.stringify(heal)).toBe(true);
      const healed = ctx.instancesLog.at(-1)?.[0];
      expect(healed?.type).toBe("healing");
      expect(healed?.materials).toBeUndefined();
      expect(healed?.traits).toBeUndefined();
    } finally {
      playerSocket.disconnect();
    }
  });

  it("#225: o cliente não grava flags.fusion.damage — um componente forjado no chat:send é descartado e o jogador não aplica a rolagem", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: {
          fusion: {
            damage: {
              source: { kind: "strike", label: "forjado" },
              components: [{ type: "force", materials: ["cold-iron"] }],
            },
          },
        },
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toBeUndefined();

      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "force", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("FORBIDDEN");
      expect(String(ack["message"])).toContain("no damage components recorded");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("#225: rolagem legada/livre sem componentes gravados (só anotação [fire] no texto) — jogador recusado com erro claro; o GM aplica com o payload", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 2d6[fire]+1",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const player = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(player["ok"]).toBe(false);
      expect(player["code"]).toBe("FORBIDDEN");
      expect(String(player["message"])).toContain("no damage components recorded");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);

      const gm = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [
          {
            type: "fire",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            materials: ["silver"],
          },
        ],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(gm["ok"], JSON.stringify(gm)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({ type: "fire", materials: ["silver"] });
      expect(STARTING_HP - readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(rollMsg.rolls?.[0]?.total);
    } finally {
      playerSocket.disconnect();
      gmSocket.disconnect();
    }
  });

  it("#225: o GM que não manda traits/materiais herda os componentes gravados; o que ele manda prevalece", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d8+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: { fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" } } },
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const inherited = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "untyped", source: { messageId: rollMsg._id, rollIndex: 0 } }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(inherited["ok"], JSON.stringify(inherited)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({
        type: "slashing",
        traits: ["magical"],
        materials: ["cold-iron"],
      });

      const overridden = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [
          {
            type: "fire",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            materials: ["silver"],
          },
        ],
        targetTokenIds: [T2_TOKEN_ID],
      });
      expect(overridden["ok"], JSON.stringify(overridden)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({ type: "fire", materials: ["silver"] });
    } finally {
      playerSocket.disconnect();
      gmSocket.disconnect();
    }
  });

  it("#225: a rolagem de dano feita a partir de um card de magia grava os componentes da magia do próprio ator", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardAck = await sendOp(playerSocket, "chat:send", {
        content: "Bola de Fogo",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: {
          pf2e: {
            abilityCard: {
              kind: "spell",
              casterActorId: CASTER_ACTOR_ID,
              name: "Bola de Fogo",
              rank: 3,
              damageFormula: "6d6",
              damageType: "fire",
            },
          },
        },
      });
      expect(cardAck["ok"], JSON.stringify(cardAck)).toBe(true);
      const card = (cardAck["result"] as { message: ChatMessageLike }).message;

      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 6d6",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: { parentMessageId: card._id },
      });
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toEqual({
        source: { kind: "spell", label: "Bola de Fogo" },
        components: [{ type: "fire", traits: ["fire", "magical"] }],
      });

      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({
        type: "fire",
        traits: ["fire", "magical"],
      });
    } finally {
      playerSocket.disconnect();
    }
  });

  it("#225: um statistic que nomeia o ator de outro dono não gera componentes (o jogador não pega emprestada a arma alheia)", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d8",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: { fusion: { statistic: { actorId: T1_ACTOR_ID, key: "strikeDamage:sword" } } },
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toBeUndefined();
    } finally {
      playerSocket.disconnect();
    }
  });

  it("#225: mensagem de outro usuário — rolagem que o GM fez falando como o personagem do jogador não é aplicável pelo jogador", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      await sendOp(gmSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(gmSocket, "chat:send", {
        content: "/roll 1d8+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: { fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" } } },
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;

      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "slashing", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
    } finally {
      playerSocket.disconnect();
      gmSocket.disconnect();
    }
  });

  it("#225: rolagem cega — os componentes ficam gravados no servidor, não vão ao jogador, e a aplicação usa os gravados", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 1d8+4",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        rollMode: "blindroll",
        flags: { fusion: { statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" } } },
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (
        rollAck["result"] as {
          message: ChatMessageLike & { flags?: { fusion?: Record<string, unknown> } };
        }
      ).message;
      expect(rollMsg.flags?.fusion?.["damage"]).toBeUndefined();
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toEqual(SWORD_DAMAGE);

      const forged = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "fire", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(forged["ok"]).toBe(false);
      expect(forged["code"]).toBe("FORBIDDEN");

      const honest = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "slashing", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(honest["ok"], JSON.stringify(honest)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]).toMatchObject({
        type: "slashing",
        materials: ["cold-iron"],
      });
    } finally {
      playerSocket.disconnect();
    }
  });

  it("#225: crítico — o dano de um Golpe cujo ataque o servidor graduou como sucesso crítico grava critical, e a mecânica recebe critical mesmo com o jogador mandando false", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      // The strike card and the attack the server graded under it, as the server stores them.
      const cardId = "strikeCard000001";
      seedChatMessage(ctx.fusionDb, {
        _id: cardId,
        type: "text",
        content: "Espada",
        speaker: { userId: ctx.playerId, actorId: CASTER_ACTOR_ID, alias: "Alquimista" },
        flags: {
          pf2e: {
            abilityCard: {
              kind: "strike",
              casterActorId: CASTER_ACTOR_ID,
              name: "Espada",
              damageFormula: "1d8+4",
              damageStatistic: "strikeDamage:sword",
            },
          },
        },
      });
      seedChatMessage(ctx.fusionDb, {
        _id: "strikeAttack0001",
        type: "roll",
        content: "",
        speaker: { userId: ctx.playerId, actorId: CASTER_ACTOR_ID, alias: "Alquimista" },
        rolls: [{ total: 30, degreeOfSuccess: "criticalSuccess" }],
        flags: {
          pf2e: { checkContext: { kind: "attack", mapIndex: 0 } },
          fusion: {
            parentMessageId: cardId,
            targetSnapshot: [{ tokenId: T1_TOKEN_ID, actorId: T1_ACTOR_ID, sceneId: SCENE_ID }],
          },
        },
      });

      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll (1d8+4)*2",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
        flags: {
          parentMessageId: cardId,
          fusion: {
            rollContext: {
              actorId: CASTER_ACTOR_ID,
              selectors: ["strike-damage", "damage"],
              options: ["action:strike"],
            },
          },
        },
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toEqual({
        ...SWORD_DAMAGE,
        critical: true,
      });

      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [
          {
            type: "slashing",
            source: { messageId: rollMsg._id, rollIndex: 0 },
            critical: false,
          },
        ],
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(ctx.instancesLog.at(-1)?.[0]?.critical).toBe(true);
    } finally {
      playerSocket.disconnect();
    }
  });

  // -------------------------------------------------------------------------
  // REQ-SYS-167 (lane dano-formula): the AMOUNT of a player's damage roll is the formula the system derives
  // -------------------------------------------------------------------------

  /** The sword's strike card and the attack the server graded under it with `degree`, as the server stores them. */
  function seedSwordCard(degree: string): string {
    const cardId = "swordCard0000001";
    seedChatMessage(ctx.fusionDb, {
      _id: cardId,
      type: "text",
      content: "Espada",
      speaker: { userId: ctx.playerId, actorId: CASTER_ACTOR_ID, alias: "Alquimista" },
      flags: {
        pf2e: {
          abilityCard: {
            kind: "strike",
            casterActorId: CASTER_ACTOR_ID,
            name: "Espada",
            damageFormula: "1d8+4",
            critDamageFormula: "(1d8+4)*2",
            damageStatistic: "strikeDamage:sword",
          },
        },
      },
    });
    seedChatMessage(ctx.fusionDb, {
      _id: "swordAttack00001",
      type: "roll",
      content: "",
      speaker: { userId: ctx.playerId, actorId: CASTER_ACTOR_ID, alias: "Alquimista" },
      rolls: [{ total: 25, degreeOfSuccess: degree }],
      flags: {
        pf2e: { checkContext: { kind: "attack", mapIndex: 0 } },
        fusion: {
          parentMessageId: cardId,
          targetSnapshot: [{ tokenId: T1_TOKEN_ID, actorId: T1_ACTOR_ID, sceneId: SCENE_ID }],
        },
      },
    });
    return cardId;
  }

  /** The card's damage button op (`buildDamageRollOp`), with `formula` in place of the card's own. */
  function swordDamageOp(
    cardId: string,
    formula: string,
    extra: { selectors?: string[]; rollMode?: string } = {},
  ): Record<string, unknown> {
    return {
      content: `/roll ${formula}`,
      worldId: ctx.worldId,
      speakerActorId: CASTER_ACTOR_ID,
      ...(extra.rollMode !== undefined ? { rollMode: extra.rollMode } : {}),
      flags: {
        parentMessageId: cardId,
        fusion: {
          rollContext: {
            actorId: CASTER_ACTOR_ID,
            selectors: extra.selectors ?? ["strike-damage", "damage"],
            options: ["action:strike"],
          },
          statistic: { actorId: CASTER_ACTOR_ID, key: "strikeDamage:sword" },
        },
      },
    };
  }

  it("REQ-SYS-167: jogador forja a fórmula sob o card de Golpe (/r 50d6 aninhado) — a rolagem sai livre, sem componentes, e não é aplicável", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardId = seedSwordCard("success");
      const rollAck = await sendOp(playerSocket, "chat:send", swordDamageOp(cardId, "50d6"));
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toBeUndefined();

      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "slashing", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("REQ-SYS-167: a fórmula que o sistema deriva passa (espaços e rótulo não importam) e o jogador aplica o total rolado", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardId = seedSwordCard("success");
      const rollAck = await sendOp(
        playerSocket,
        "chat:send",
        swordDamageOp(cardId, "1d8 + 4 # Dano"),
      );
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toEqual(SWORD_DAMAGE);

      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "slashing", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(STARTING_HP - readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(rollMsg.rolls?.[0]?.total);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("REQ-SYS-167: crítico não graduado — a fórmula dobrada por conta própria não grava componentes", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardId = seedSwordCard("success");
      const doubled = await sendOp(playerSocket, "chat:send", swordDamageOp(cardId, "(1d8+4)*2"));
      expect(doubled["ok"], JSON.stringify(doubled)).toBe(true);
      const doubledMsg = (doubled["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, doubledMsg._id as string)).toBeUndefined();
    } finally {
      playerSocket.disconnect();
    }
  });

  it("REQ-SYS-167: crítico graduado — (1d8+4)*2 grava critical; (1d8+4)*3 não grava componentes", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardId = seedSwordCard("criticalSuccess");
      const crit = await sendOp(playerSocket, "chat:send", swordDamageOp(cardId, "(1d8+4)*2"));
      expect(crit["ok"], JSON.stringify(crit)).toBe(true);
      const critMsg = (crit["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, critMsg._id as string)).toEqual({
        ...SWORD_DAMAGE,
        critical: true,
      });

      const tripled = await sendOp(playerSocket, "chat:send", swordDamageOp(cardId, "(1d8+4)*3"));
      expect(tripled["ok"], JSON.stringify(tripled)).toBe(true);
      const tripledMsg = (tripled["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, tripledMsg._id as string)).toBeUndefined();
    } finally {
      playerSocket.disconnect();
    }
  });

  it("REQ-SYS-167: modificador situacional — o servidor soma o bônus condicional à fórmula derivada; o jogador que soma o bônus por conta própria não grava componentes", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardId = seedSwordCard("success");
      const selectors = ["strike-damage", "damage", "test-prey"];
      const honest = await sendOp(
        playerSocket,
        "chat:send",
        swordDamageOp(cardId, "1d8+4", { selectors }),
      );
      expect(honest["ok"], JSON.stringify(honest)).toBe(true);
      const honestMsg = (
        honest["result"] as { message: ChatMessageLike & { rolls?: Array<{ formula?: string }> } }
      ).message;
      expect(honestMsg.rolls?.[0]?.formula?.replace(/\s+/g, "")).toBe("1d8+4+2");
      expect(readStoredDamageFlag(ctx.fusionDb, honestMsg._id as string)).toEqual(SWORD_DAMAGE);

      const selfAdded = await sendOp(
        playerSocket,
        "chat:send",
        swordDamageOp(cardId, "1d8+4+2", { selectors }),
      );
      expect(selfAdded["ok"], JSON.stringify(selfAdded)).toBe(true);
      const selfAddedMsg = (selfAdded["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, selfAddedMsg._id as string)).toBeUndefined();
    } finally {
      playerSocket.disconnect();
    }
  });

  it("REQ-SYS-167: o GM continua livre — a fórmula dele sob o card grava os componentes e ele aplica o total", async () => {
    const gmSocket = await connectSocket(ctx.port, ctx.worldId, ctx.gmToken);
    try {
      const cardId = seedSwordCard("success");
      const rollAck = await sendOp(gmSocket, "chat:send", swordDamageOp(cardId, "3d8+10"));
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toEqual(SWORD_DAMAGE);

      const ack = await sendOp(gmSocket, "actor:applyDamage", {
        instances: [{ type: "slashing", source: { messageId: rollMsg._id, rollIndex: 0 } }],
        targetTokenIds: [T1_TOKEN_ID],
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(STARTING_HP - readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(rollMsg.rolls?.[0]?.total);
    } finally {
      gmSocket.disconnect();
    }
  });

  it("REQ-SYS-167: rolagem cega — a fórmula forjada também não grava componentes, e a honesta grava sem mandar ao jogador", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const cardId = seedSwordCard("success");
      const forged = await sendOp(
        playerSocket,
        "chat:send",
        swordDamageOp(cardId, "50d6", { rollMode: "blindroll" }),
      );
      expect(forged["ok"], JSON.stringify(forged)).toBe(true);
      const forgedMsg = (forged["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, forgedMsg._id as string)).toBeUndefined();
      const apply = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "slashing", source: { messageId: forgedMsg._id, rollIndex: 0 } }],
      });
      expect(apply["ok"]).toBe(false);
      expect(apply["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);

      const honest = await sendOp(
        playerSocket,
        "chat:send",
        swordDamageOp(cardId, "1d8+4", { rollMode: "blindroll" }),
      );
      expect(honest["ok"], JSON.stringify(honest)).toBe(true);
      const honestMsg = (
        honest["result"] as {
          message: ChatMessageLike & { flags?: { fusion?: Record<string, unknown> } };
        }
      ).message;
      expect(honestMsg.flags?.fusion?.["damage"]).toBeUndefined();
      expect(readStoredDamageFlag(ctx.fusionDb, honestMsg._id as string)).toEqual(SWORD_DAMAGE);
    } finally {
      playerSocket.disconnect();
    }
  });

  it("REQ-SYS-167: rolagem livre do jogador (/r sem card nem statistic) continua permitida, mas não é aplicável como dano", async () => {
    const playerSocket = await connectSocket(ctx.port, ctx.worldId, ctx.playerToken);
    try {
      await sendOp(playerSocket, "combat:target", { tokenId: T1_TOKEN_ID, targeted: true });
      const rollAck = await sendOp(playerSocket, "chat:send", {
        content: "/roll 50d6",
        worldId: ctx.worldId,
        speakerActorId: CASTER_ACTOR_ID,
      });
      expect(rollAck["ok"], JSON.stringify(rollAck)).toBe(true);
      const rollMsg = (rollAck["result"] as { message: ChatMessageLike }).message;
      expect(readStoredDamageFlag(ctx.fusionDb, rollMsg._id as string)).toBeUndefined();
      const ack = await sendOp(playerSocket, "actor:applyDamage", {
        instances: [{ type: "untyped", source: { messageId: rollMsg._id, rollIndex: 0 } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("FORBIDDEN");
      expect(readActorHp(ctx.fusionDb, T1_ACTOR_ID)).toBe(STARTING_HP);
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
        flags: damageFlags("fire"),
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
        flags: damageFlags("fire"),
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
        flags: damageFlags("fire"),
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
