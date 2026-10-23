/**
 * G056 — a hidden combatant never leaves the server towards a non-privileged
 * socket, by ANY emission path.
 *
 * REQ-CBA-082 [MVP]: "Participante com `hidden: true` NÃO DEVE ser entregue a
 * usuário sem papel privilegiado — nem em snapshot, nem em broadcast, nem em
 * replay —, pela redação única do servidor" (specs/40-aba-combate.md §5.9,
 * sustained by REQ-DOC-058 / REQ-SEC-020 / REQ-CBT-031).
 *
 * The existing `combat-redaction-m2c.test.ts` proves the combat:* handlers
 * redact their own three paths. THIS file closes the other half of the same
 * requirement: the GENERIC document path also carries whole Combat bodies —
 * a `doc:update` on a Combat, and every embedded Combatant op, broadcast
 * `{ documentType: "Combat", documents: [fullCombat] }` — plus the ack echoed
 * back to the requester and the `combat:turnChange` event a player receives.
 *
 * Every assertion below inspects the PAYLOAD a PLAYER socket actually received,
 * never the screen and never an internal helper.
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

// ---------------------------------------------------------------------------
// Harness (mirrors combat-redaction-m2c.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cba082-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerUserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "cba082-world";

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
    worldInfo: { id: worldId, title: "CBA-082 World", systemId: "stub" },
  });
  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
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

function waitForEnvelope(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for envelope")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

function waitForType(socket: ClientSocket, type: string, timeoutMs = 5000) {
  return waitForEnvelope(socket, (env) => env["type"] === type, timeoutMs);
}

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

/** Every combatant body reachable inside an arbitrary payload, by shape. */
function collectCombatantsDeep(value: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectCombatantsDeep(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const obj = value as Record<string, unknown>;
  const combatants = obj["combatants"];
  if (Array.isArray(combatants)) {
    for (const c of combatants as Record<string, unknown>[]) out.push(c);
  }
  for (const nested of Object.values(obj)) {
    if (nested && typeof nested === "object") collectCombatantsDeep(nested, out);
  }
  return out;
}

/**
 * Assert that nothing in a payload a player received names the hidden
 * combatant: neither the combatant body, nor its id, nor its token id.
 */
function expectNoHiddenLeak(
  payload: unknown,
  hidden: { combatantId: string; tokenId: string },
): void {
  const combatants = collectCombatantsDeep(payload);
  expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
  const serialized = JSON.stringify(payload ?? null);
  expect(serialized).not.toContain(hidden.combatantId);
  expect(serialized).not.toContain(hidden.tokenId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(
  "REQ-CBA-082 — participante oculto não sai no payload do jogador",
  { timeout: 30000 },
  () => {
    let ctx: TestContext;
    let gmSocket: ClientSocket;

    beforeEach(async () => {
      ctx = await buildTestContext();
      gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();
    });

    afterEach(async () => {
      gmSocket.disconnect();
      await teardown(ctx);
    });

    interface Fixture {
      combatId: string;
      pcCombatantId: string;
      npcCombatantId: string;
      npcTokenId: string;
    }

    /**
     * One encounter with a visible PC the player owns and a HIDDEN NPC.
     * `hiddenActiveFirst` gives the hidden NPC the higher initiative so it is the
     * active combatant once the encounter starts.
     */
    async function setupCombatWithHidden(
      opts: { hiddenActiveFirst?: boolean } = {},
    ): Promise<Fixture> {
      const sceneAck = await sendOp(gmSocket, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Arena", width: 1000, height: 1000 }],
      });
      const sceneId = (
        (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
      )[0]!["_id"] as string;

      const pcAck = await sendOp(gmSocket, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "Visible PC",
            type: "character",
            ownership: { default: 0, [ctx.playerUserId]: 3 },
          },
        ],
      });
      const pcActorId = (
        (pcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
      )[0]!["_id"] as string;

      const npcAck = await sendOp(gmSocket, "doc:create", {
        documentType: "Actor",
        data: [{ name: "Hidden NPC", type: "npc", ownership: { default: 0 } }],
      });
      const npcActorId = (
        (npcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
      )[0]!["_id"] as string;

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const pcInit = opts.hiddenActiveFirst ? 10 : 20;
      const npcInit = opts.hiddenActiveFirst ? 20 : 10;

      const pcAddAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-pc",
        actorId: pcActorId,
        hidden: false,
        initiative: pcInit,
      });
      const pcCombatantId = (
        (pcAddAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const npcTokenId = "t-hidden-npc";
      const npcAddAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: npcTokenId,
        actorId: npcActorId,
        hidden: true,
        initiative: npcInit,
      });
      const npcCombatantId = (
        (npcAddAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      return { combatId, pcCombatantId, npcCombatantId, npcTokenId };
    }

    /**
     * Connect a PLAYER socket. The initial sync envelope (`resync:full` on a
     * fresh join, `resync:delta` when `lastSeq` is supplied) is captured BEFORE
     * `connect()` — the server pushes it the moment the handshake completes, so
     * a listener attached afterwards would miss it.
     */
    async function connectPlayer(
      auth: Record<string, unknown> = {},
    ): Promise<{ socket: ClientSocket; sync: Promise<Record<string, unknown>> }> {
      const socket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
        ...auth,
      });
      const sync = waitForEnvelope(
        socket,
        (env) => env["type"] === "resync:full" || env["type"] === "resync:delta",
      );
      // Mark the promise as handled: tests that do not care about the initial
      // sync must not produce an unhandled rejection when it times out.
      void sync.catch(() => undefined);
      socket.connect();
      await waitForConnect(socket);
      return { socket, sync };
    }

    // -------------------------------------------------------------------------
    // Path 1 — snapshot (join / full resync)
    // -------------------------------------------------------------------------

    it("snapshot: o join do jogador não traz o participante oculto (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden();

      const { socket: playerSocket, sync } = await connectPlayer();
      const snapshotEnv = await sync;
      expect(snapshotEnv["type"]).toBe("resync:full");

      const snapshot = (snapshotEnv["payload"] as Record<string, unknown>)["snapshot"];
      const documents = (snapshot as Record<string, unknown>)["documents"] as Record<
        string,
        unknown[]
      >;
      const combats = (documents["Combat"] ?? []) as Record<string, unknown>[];

      // The encounter itself is shared world state — it must still arrive.
      expect(combats.length).toBe(1);
      expect((combats[0]!["combatants"] as unknown[]).length).toBe(1);
      expectNoHiddenLeak(snapshotEnv["payload"], fx);

      playerSocket.disconnect();
    });

    // -------------------------------------------------------------------------
    // Path 2 — live broadcast
    // -------------------------------------------------------------------------

    it("broadcast combat:*: o combat:updated do jogador não traz o participante oculto (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden();
      const { socket: playerSocket } = await connectPlayer();
      await drain();

      const updatedP = waitForEnvelope(
        playerSocket,
        (env) =>
          env["type"] === "combat:updated" &&
          Array.isArray(
            (
              (env["payload"] as Record<string, unknown>)["diff"] as
                | Record<string, unknown>
                | undefined
            )?.["combatants"],
          ),
      );
      // Any GM write that rewrites the combatants array republishes the whole
      // roster inside the diff — the hidden NPC included, before redaction.
      await sendOp(gmSocket, "combat:setInitiative", {
        combatId: fx.combatId,
        combatantId: fx.pcCombatantId,
        value: 5,
      });

      const updated = await updatedP;
      expectNoHiddenLeak(updated["payload"], fx);

      playerSocket.disconnect();
    });

    it("broadcast doc:update: o corpo de Combat pelo caminho genérico é redigido para o jogador (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden();
      const { socket: playerSocket } = await connectPlayer();
      await drain();

      const playerOpP = waitForEnvelope(
        playerSocket,
        (env) =>
          env["type"] === "doc:update" &&
          (env["payload"] as Record<string, unknown>)["documentType"] === "Combat",
      );
      const gmOpP = waitForEnvelope(
        gmSocket,
        (env) =>
          env["type"] === "doc:update" &&
          (env["payload"] as Record<string, unknown>)["documentType"] === "Combat",
      );

      // The generic document path — NOT combat:* — carries the whole Combat body.
      await sendOp(gmSocket, "doc:update", {
        documentType: "Combat",
        updates: [{ _id: fx.combatId, diff: { round: 3 } }],
      });

      const playerOp = await playerOpP;
      expectNoHiddenLeak(playerOp["payload"], fx);

      // The GM, by contrast, keeps seeing the hidden combatant.
      const gmOp = await gmOpP;
      const gmCombat = (
        (gmOp["payload"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
      )[0]!;
      expect((gmCombat["combatants"] as Record<string, unknown>[]).length).toBe(2);
      expect(
        (gmCombat["combatants"] as Record<string, unknown>[]).some((c) => c["hidden"] === true),
      ).toBe(true);

      playerSocket.disconnect();
    });

    // -------------------------------------------------------------------------
    // Path 3 — delta replay from the op buffer
    // -------------------------------------------------------------------------

    it("replay: o delta resync do jogador não traz o participante oculto, nem pelo doc:update de Combat (REQ-CBA-082)", async () => {
      // Baseline seq while the player is connected, then it goes away.
      const { socket: player1, sync: sync1 } = await connectPlayer();
      const snap1 = await sync1;
      const baselineSeq = snap1["seq"] as number;
      player1.disconnect();
      await drain();

      // While the player is away the GM builds the encounter, starts it, and
      // touches the Combat through the generic document path too.
      const fx = await setupCombatWithHidden({ hiddenActiveFirst: true });
      await sendOp(gmSocket, "combat:beginCombat", { combatId: fx.combatId });
      await sendOp(gmSocket, "doc:update", {
        documentType: "Combat",
        updates: [{ _id: fx.combatId, diff: { round: 4 } }],
      });
      await drain();

      const { socket: player2, sync: sync2 } = await connectPlayer({ lastSeq: baselineSeq });
      const deltaEnv = await sync2;
      expect(deltaEnv["type"]).toBe("resync:delta");

      const ops = (deltaEnv["payload"] as Record<string, unknown>)["ops"] as Record<
        string,
        unknown
      >[];
      // The replay must actually carry the Combat ops — otherwise the assertion
      // below would pass vacuously.
      const combatOps = ops.filter((op) => {
        const type = op["type"] as string;
        const payload = op["payload"] as Record<string, unknown> | null;
        return (
          type === "combat:created" ||
          type === "combat:updated" ||
          (type === "doc:update" && payload?.["documentType"] === "Combat")
        );
      });
      expect(combatOps.length).toBeGreaterThan(0);
      expect(
        ops.some(
          (op) =>
            op["type"] === "doc:update" &&
            (op["payload"] as Record<string, unknown>)["documentType"] === "Combat",
        ),
      ).toBe(true);

      for (const op of ops) expectNoHiddenLeak(op["payload"], fx);

      player2.disconnect();
    });

    // -------------------------------------------------------------------------
    // The ack echoed back to the requester (combat:*)
    // -------------------------------------------------------------------------

    it("ack de combat:*: o eco para o jogador não traz o participante oculto (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden();
      const { socket: playerSocket } = await connectPlayer();
      await drain();

      // Every combatant already has an initiative, so this resolves to zero
      // targets and the handler echoes the combat document straight back.
      const ack = await sendOp(playerSocket, "combat:rollInitiative", { combatId: fx.combatId });
      expect(ack["ok"]).toBe(true);

      const result = ack["result"] as Record<string, unknown>;
      const combat = result["combat"] as Record<string, unknown>;
      expect((combat["combatants"] as unknown[]).length).toBe(1);
      expectNoHiddenLeak(ack, fx);

      // Same op from the GM keeps the hidden combatant in the ack.
      const gmAck = await sendOp(gmSocket, "combat:rollInitiative", { combatId: fx.combatId });
      const gmCombat = (gmAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      expect((gmCombat["combatants"] as unknown[]).length).toBe(2);

      playerSocket.disconnect();
    });

    // -------------------------------------------------------------------------
    // The ack echoed back to the requester (GENERIC document path)
    //
    // The two shapes below are the ones the `combat:*` ack never exercises: a
    // Combat body reaching the requester under `documents[]` (embedded
    // Combatant update) and under `parent` (embedded Combatant delete). Both
    // are reachable by a PLAYER — the embedded permission check authorizes the
    // combatant whose `actorId` points at an actor the player OWNS.
    // -------------------------------------------------------------------------

    it("ack de doc:update embutido de Combatant: o Combat que volta em documents[] é redigido (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden();
      const { socket: playerSocket } = await connectPlayer();
      await drain();

      // The player owns the actor behind their own combatant, so this embedded
      // update is authorized — and it republishes the WHOLE parent Combat,
      // hidden NPC included, as `{ documentType: "Combat", documents: [...] }`.
      const ack = await sendOp(playerSocket, "doc:update", {
        documentType: "Combatant",
        updates: [
          {
            _id: fx.pcCombatantId,
            diff: { defeated: true },
            embedded: { type: "Combatant", id: fx.combatId },
          },
        ],
      });
      expect(ack["ok"]).toBe(true);

      const result = ack["result"] as Record<string, unknown>;
      expect(result["documentType"]).toBe("Combat");
      const documents = result["documents"] as Record<string, unknown>[];
      // The ack really carries a Combat body — otherwise the leak assertion
      // below would pass vacuously.
      expect(documents.length).toBe(1);
      expect(documents[0]!["_id"]).toBe(fx.combatId);
      expect((documents[0]!["combatants"] as unknown[]).length).toBe(1);
      expectNoHiddenLeak(ack, fx);

      // The same op from the GM keeps the hidden combatant in the ack — proof
      // that the body carries the full roster before redaction.
      const gmAck = await sendOp(gmSocket, "doc:update", {
        documentType: "Combatant",
        updates: [
          {
            _id: fx.pcCombatantId,
            diff: { defeated: false },
            embedded: { type: "Combatant", id: fx.combatId },
          },
        ],
      });
      const gmCombat = (
        (gmAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
      )[0]!;
      expect((gmCombat["combatants"] as Record<string, unknown>[]).length).toBe(2);
      expect(
        (gmCombat["combatants"] as Record<string, unknown>[]).some((c) => c["hidden"] === true),
      ).toBe(true);

      playerSocket.disconnect();
    });

    it("ack de doc:delete embutido de Combatant: o Combat que volta em parent é redigido (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden();
      const { socket: playerSocket } = await connectPlayer();
      await drain();

      // Embedded delete echoes `{ documentType: "Combatant", ids, parent }` —
      // the parent being the whole Combat, hidden NPC included.
      const ack = await sendOp(playerSocket, "doc:delete", {
        documentType: "Combatant",
        ids: [fx.pcCombatantId],
        parent: { type: "Combat", id: fx.combatId },
      });
      expect(ack["ok"]).toBe(true);

      const result = ack["result"] as Record<string, unknown>;
      expect(result["documentType"]).toBe("Combatant");
      const parent = result["parent"] as Record<string, unknown>;
      expect(parent["_id"]).toBe(fx.combatId);
      // Own combatant gone + hidden NPC redacted away — the player is left
      // with an empty roster, never with the hidden participant.
      expect((parent["combatants"] as unknown[]).length).toBe(0);
      expectNoHiddenLeak(ack, fx);

      // The hidden NPC was NOT deleted — it is still in the stored encounter,
      // which the GM keeps seeing. So the empty roster above is redaction, not
      // an encounter that happened to be empty.
      const gmAck = await sendOp(gmSocket, "doc:update", {
        documentType: "Combat",
        updates: [{ _id: fx.combatId, diff: { round: 2 } }],
      });
      const gmCombatants = (
        (
          (gmAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
        )[0]!["combatants"] as Record<string, unknown>[]
      ).filter((c) => c["hidden"] === true);
      expect(gmCombatants.length).toBe(1);
      expect(gmCombatants[0]!["_id"]).toBe(fx.npcCombatantId);

      playerSocket.disconnect();
    });

    // -------------------------------------------------------------------------
    // combat:turnChange delivered to the player
    // -------------------------------------------------------------------------

    it("combat:turnChange: a vez de um participante oculto não identifica ninguém para o jogador (REQ-CBA-082)", async () => {
      const fx = await setupCombatWithHidden({ hiddenActiveFirst: true });
      const { socket: playerSocket } = await connectPlayer();
      await drain();

      const turnChangeP = waitForType(playerSocket, "combat:turnChange");
      await sendOp(gmSocket, "combat:beginCombat", { combatId: fx.combatId });

      const turnChange = await turnChangeP;
      const current = (turnChange["payload"] as Record<string, unknown>)["current"] as Record<
        string,
        unknown
      >;
      // The round still advances for the player — only the identity is masked.
      expect(current["round"]).toBe(1);
      expect(current["combatantId"]).toBeNull();
      expect(current["tokenId"]).toBeNull();
      expectNoHiddenLeak(turnChange["payload"], fx);

      playerSocket.disconnect();
    });
  },
);
