/**
 * Condition front, stage 3b — the core services a system turn hook uses to automate conditions:
 * `ctx.roll` (server-side dice that land in the chat, visible per roll mode), `ctx.getSetting` (a world setting of
 * the active system) and the redaction of a `flags.fusion.conditionTurn` announcement for a hidden combatant.
 *
 * Server integration test over real sockets. The system is a FAKE module (core plumbing only, never a game rule,
 * so it is not circular against the satellite hook, which has its own tests). Port via helpers/ports.ts.
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
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const MANIFEST = {
  id: "test-condition-turn",
  title: "Condition Turn Test",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

/** The hook under test: on turn end, roll (mode from the combatant's `hidden`) and announce, unless the setting is off. */
function buildFakeSystem(): SystemModule {
  return defineSystem({ ...MANIFEST }, (r) => {
    r.onTurnEnd("test.conditionTurn", async ({ combatant }, ctx) => {
      if (ctx.getSetting?.("conditions.automateTurn") === false) return;
      await ctx.roll("1d20", {
        flavor: `Teste de ${combatant.name}`,
        rollMode: combatant.hidden === true ? "gmroll" : "public",
      });
      await ctx.chat({
        content: `${combatant.name}: condição resolvida.`,
        flags: {
          fusion: { conditionTurn: { ...(combatant.hidden === true ? { hidden: true } : {}) } },
        },
      });
    });
  });
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-expiry-owner-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
}

async function buildTestContext(
  systemModule: SystemModule = buildFakeSystem(),
  systemId: string = MANIFEST.id,
): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "expiry-owner-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Expiry Owner World", systemId },
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
    systemModule,
  });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
  };
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

interface Seen {
  type: string;
  docs: Record<string, unknown>[];
}

describe(
  "condition front 3b — ctx.roll, ctx.getSetting, conditionTurn redaction",
  { timeout: 30000 },
  () => {
    let ctx: TestContext;
    let gm: ClientSocket;
    let player: ClientSocket;
    let playerSeen: Seen[];
    let gmSeen: Seen[];

    const record = (into: Seen[]) => (env: Record<string, unknown>) => {
      const payload = env["payload"] as { documents?: Record<string, unknown>[] } | undefined;
      into.push({ type: String(env["type"]), docs: payload?.documents ?? [] });
    };

    beforeEach(async () => {
      ctx = await buildTestContext();
      gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
      player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
      gm.connect();
      player.connect();
      await Promise.all([waitForConnect(gm), waitForConnect(player)]);
      await drain();
      playerSeen = [];
      gmSeen = [];
      player.on("op", record(playerSeen));
      gm.on("op", record(gmSeen));
    });

    afterEach(async () => {
      gm.disconnect();
      player.disconnect();
      await teardown(ctx);
    });

    async function createActor(name: string) {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [{ name, type: "character", ownership: { default: 2 } }],
      });
      expect(ack["ok"]).toBe(true);
      return firstDocId(ack);
    }

    /** Two combatants; the first one (whose turn ENDS on nextTurn) is hidden or not. */
    async function endFirstTurn(hidden: boolean) {
      const firstActor = await createActor("Primeiro");
      const secondActor = await createActor("Segundo");
      const sceneId = firstDocId(
        await sendOp(gm, "doc:create", {
          documentType: "Scene",
          data: [{ name: "Cena", width: 1000, height: 1000 }],
        }),
      );
      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (resultOf(combatAck)["combat"] as Record<string, unknown>)["_id"] as string;
      await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-first",
        actorId: firstActor,
        initiative: 20,
        hidden,
      });
      await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-second",
        actorId: secondActor,
        initiative: 10,
      });
      await sendOp(gm, "combat:beginCombat", { combatId });
      await drain();
      playerSeen.length = 0;
      gmSeen.length = 0;
      const next = await sendOp(gm, "combat:nextTurn", { combatId });
      expect(next["ok"]).toBe(true);
      await drain();
    }

    const chatDocs = (seen: Seen[]) =>
      seen
        .filter((s) => s.type === "doc:create")
        .flatMap((s) => s.docs)
        .filter((d) => d["worldId"] !== undefined);

    it("a public roll reaches everyone, with the server's dice and the flavor", async () => {
      await endFirstTurn(false);
      for (const seen of [gmSeen, playerSeen]) {
        const roll = chatDocs(seen).find((d) => d["type"] === "roll");
        expect(roll).toBeDefined();
        const rolls = roll?.["rolls"] as { total: number; flavor?: string }[];
        expect(rolls[0]?.flavor).toBe("Teste de Primeiro");
        expect(rolls[0]?.total).toBeGreaterThanOrEqual(1);
        expect(rolls[0]?.total).toBeLessThanOrEqual(20);
      }
    });

    it("a hidden combatant's roll (gmroll) reaches the GM and never the player", async () => {
      await endFirstTurn(true);
      expect(chatDocs(gmSeen).some((d) => d["type"] === "roll")).toBe(true);
      expect(chatDocs(playerSeen).some((d) => d["type"] === "roll")).toBe(false);
    });

    it("the conditionTurn announcement of a hidden combatant is cut for the player and whole for the GM", async () => {
      await endFirstTurn(true);
      const gmLine = chatDocs(gmSeen).find((d) => d["type"] === "system");
      expect(gmLine?.["content"]).toBe("Primeiro: condição resolvida.");
      const playerLine = chatDocs(playerSeen).find((d) => d["type"] === "system");
      expect(playerLine?.["content"]).toBe("Uma condição foi resolvida.");
      expect(JSON.stringify(playerSeen)).not.toContain("Primeiro");
    });

    it("a visible combatant's announcement is whole for the player", async () => {
      await endFirstTurn(false);
      const playerLine = chatDocs(playerSeen).find((d) => d["type"] === "system");
      expect(playerLine?.["content"]).toBe("Primeiro: condição resolvida.");
    });

    it("ctx.getSetting reads the stored world setting (off -> the hook stands down)", async () => {
      await sendOp(gm, "doc:create", {
        documentType: "Setting",
        data: [{ key: `${MANIFEST.id}:conditions.automateTurn`, value: false }],
      });
      await endFirstTurn(false);
      expect(chatDocs(gmSeen).some((d) => d["type"] === "roll")).toBe(false);
      expect(chatDocs(gmSeen).some((d) => d["type"] === "system")).toBe(false);
    });
  },
);

// ---------------------------------------------------------------------------
// The real pf2e hook through the real services: the whole chain, from the turn advance to the document.
// ---------------------------------------------------------------------------

describe("condition front 3b — pf2e.conditionTurn end to end", { timeout: 30000 }, () => {
  let ctx: TestContext;
  let gm: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext(pf2eSystem, pf2eSystem.manifest.id);
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
    await drain();
  });

  afterEach(async () => {
    gm.disconnect();
    await teardown(ctx);
  });

  const condition = (
    id: string,
    slug: string,
    value?: number,
    extra: Record<string, unknown> = {},
  ) => ({
    _id: id,
    type: "condition",
    name: slug,
    system: { slug, ...(value !== undefined ? { value } : {}), ...extra },
  });

  function seed(actorId: string, items: Record<string, unknown>[]): void {
    ctx.fusionDb.raw
      .prepare(
        "UPDATE actors SET data = json_set(json_set(data, '$.items', json(?)), '$.system.attributes.hp', json(?)) WHERE id = ?",
      )
      .run(JSON.stringify(items), JSON.stringify({ value: 20, max: 20, temp: 0 }), actorId);
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

  async function setupCombat(items: Record<string, unknown>[]) {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Alvo", type: "character", ownership: { default: 2 } }],
    });
    const actorId = firstDocId(ack);
    const otherId = firstDocId(
      await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [{ name: "Outro", type: "character", ownership: { default: 2 } }],
      }),
    );
    seed(actorId, items);
    const sceneId = firstDocId(
      await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Cena", width: 1000, height: 1000 }],
      }),
    );
    const combatId = (
      resultOf(await sendOp(gm, "combat:create", { sceneId }))["combat"] as Record<string, unknown>
    )["_id"] as string;
    await sendOp(gm, "combat:addCombatant", { combatId, tokenId: "t-a", actorId, initiative: 20 });
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "t-b",
      actorId: otherId,
      initiative: 10,
    });
    await sendOp(gm, "combat:beginCombat", { combatId });
    return { actorId, combatId };
  }

  it("Amedrontado 2 vira Amedrontado 1 no fim do turno da criatura", async () => {
    const { actorId, combatId } = await setupCombat([condition("fr000000000001", "frightened", 2)]);
    const next = await sendOp(gm, "combat:nextTurn", { combatId });
    expect(next["ok"]).toBe(true);
    const frightened = actorDoc(actorId).items.filter(
      (i) => (i["system"] as { slug?: string }).slug === "frightened",
    );
    expect(frightened).toHaveLength(1);
    expect((frightened[0]?.["system"] as { value?: number }).value).toBe(1);
  });

  it("Amedrontado 1 termina no fim do turno", async () => {
    const { actorId, combatId } = await setupCombat([condition("fr000000000002", "frightened", 1)]);
    await sendOp(gm, "combat:nextTurn", { combatId });
    expect(actorDoc(actorId).items).toEqual([]);
  });

  it("dano persistente rola no servidor, aplica pelo fluxo de dano e posta o teste simples", async () => {
    const { actorId, combatId } = await setupCombat([
      condition("pd000000000001", "persistent-damage", undefined, {
        persistent: { formula: "1d1", damageType: "fire" },
      }),
    ]);
    await sendOp(gm, "combat:nextTurn", { combatId });
    // 1d1 always deals 1 (the creature has no fire resistance).
    expect(actorDoc(actorId).hp).toBe(19);
    const rolls = ctx.fusionDb.raw.prepare("SELECT data FROM chat_messages").all() as {
      data: string;
    }[];
    const flavors = rolls.flatMap((r) => {
      const doc = JSON.parse(r.data) as { rolls?: { flavor?: string }[] };
      return (doc.rolls ?? []).map((x) => x.flavor ?? "");
    });
    expect(flavors.some((f) => f.startsWith("Dano persistente (fogo)"))).toBe(true);
    expect(flavors.some((f) => f.startsWith("Teste simples para encerrar"))).toBe(true);
  });

  it("com a opção do mundo desligada nada acontece", async () => {
    await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [{ key: `${pf2eSystem.manifest.id}:conditions.automateTurn`, value: false }],
    });
    const { actorId, combatId } = await setupCombat([condition("fr000000000003", "frightened", 2)]);
    await sendOp(gm, "combat:nextTurn", { combatId });
    const frightened = actorDoc(actorId).items[0]?.["system"] as { value?: number };
    expect(frightened.value).toBe(2);
  });

  it("Morrendo no início do turno: o teste de recuperação é rolado e posta no chat", async () => {
    const { combatId, actorId } = await setupCombat([
      condition("dy000000000001", "dying", 1),
      condition("un000000000001", "unconscious"),
    ]);
    // The dying creature acts second: advance twice (A ends, B starts; B ends, A starts a new round).
    await sendOp(gm, "combat:nextTurn", { combatId });
    await sendOp(gm, "combat:nextTurn", { combatId });
    const rows = ctx.fusionDb.raw.prepare("SELECT data FROM chat_messages").all() as {
      data: string;
    }[];
    const flavors = rows.flatMap((r) =>
      ((JSON.parse(r.data) as { rolls?: { flavor?: string }[] }).rolls ?? []).map(
        (x) => x.flavor ?? "",
      ),
    );
    expect(flavors.some((f) => f.includes("Teste de recuperação") && f.includes("CD 11"))).toBe(
      true,
    );
    const slugs = actorDoc(actorId).items.map((i) => (i["system"] as { slug?: string }).slug);
    // The dying creature rolls a recovery check at each of its turn starts, and the d20 decides each one:
    // Dying can end anywhere in 1..3 (failure +1, success -1, critical failure +2), or be gone with
    // Wounded (recovered), or the creature is dead. All are valid outcomes; the roll above is the proof.
    const dying = actorDoc(actorId).items.find(
      (i) => (i["system"] as { slug?: string }).slug === "dying",
    );
    const dyingValue = (dying?.["system"] as { value?: number } | undefined)?.value;
    expect(
      dyingValue === undefined || (dyingValue >= 1 && dyingValue <= 3) || slugs.includes("dead"),
    ).toBe(true);
  });
});
