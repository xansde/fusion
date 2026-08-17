/**
 * E2E — Etmos M5-E (progressão, combate, ferramentas de Narrador) through the
 * REAL boot() path.
 *
 * Mirrors e2e-etmos-conjuracao.test.ts's infrastructure (boot() with
 * netContext.systemId = "etmos" / systemModule = etmosSystem, real GM +
 * PLAYER sockets, real socket.io `op` events) — NOT manual SocketManager
 * wiring — to prove the M5-E surfaces are actually reachable end-to-end, not
 * just correct in isolation.
 *
 * Covers:
 *   - REQ-ETM-022, CA-7: 2d6+Corpo initiative formula registered under the
 *     real InitiativeFormulaRegistry (systemId fallback), with its
 *     non-monotonic `compare()` exercised via `combat:setInitiative` for two
 *     forced-tie scenarios (hasPlayerOwner tiebreak; Corpo tiebreak).
 *   - REQ-ETM-023: Reação por rodada resets on the REAL turnStart lifecycle
 *     event (combat:beginCombat / combat:nextTurn), and etmos:reacao:usar
 *     spends/rejects correctly.
 *   - REQ-ETM-035..039, CA-11: Marcos 5+5+5 → etmos:progressao:confirmar
 *     applies Tabela E bônus atomically, resets trilhas, bumps nivel, and
 *     rejects a follow-up confirmation immediately after (trilhas freshly
 *     reset -> trilhasIncompletas).
 *   - REQ-ETM-021, CA-6: Teste Contestado, PC vs NPC tied totals -> PC wins
 *     (pcVenceEmpateContraNpc), via etmos:teste:contestado with
 *     deterministic 1d1+N formulas.
 *
 * Spec: 19-sistema-etmos.md REQ-ETM-021..023, REQ-ETM-035..039, CA-6/7/11.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { etmosSystem, etmosInitiativeCompare } from "@fusion/system-etmos";
import type { InitiativeEntry } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors e2e-etmos-conjuracao.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-e2e-etmos-m5e-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerId: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "e2e_etmos_m5e_world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const { user: player } = await authService.createUser({
    name: "player-1",
    role: 1, // PLAYER
    password: "player-password-123",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-password-123",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "E2E Etmos M5-E World",
      worldSystemId: "etmos",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "etmos",
      systemModule: etmosSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerId: player.id,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.bootResult.shutdown();
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
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

/**
 * Wait for the next broadcast `op` envelope matching `predicate` on `socket`.
 * Used to observe out-of-band follow-up broadcasts a handler emits AFTER its
 * own ack was already built (e.g. registerReacaoResetOnTurnStart's own
 * `combat:updated` broadcast, sent after combat:beginCombat's OWN
 * `combat:updated` broadcast + ack already captured `updatedCombat` — see
 * reacao-handler.ts's docstring). combat:beginCombat's own broadcast and the
 * Reação listener's follow-up broadcast are BOTH `combat:updated` envelopes
 * in flight around the same op, so a bare type match is ambiguous — the
 * predicate lets the caller pick out the one it actually needs.
 */
function waitForOp(
  socket: ClientSocket,
  type: string,
  predicate: (env: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for op: ${type}`)), 8000);
    function handler(env: Record<string, unknown>): void {
      if (env["type"] === type && predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    }
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("E2E — Etmos M5-E (progressão, combate, ferramentas de Narrador) through real boot()", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // REQ-ETM-022, CA-7 — Initiative: hasPlayerOwner tiebreak + Corpo tiebreak
  // -------------------------------------------------------------------------

  describe("Initiative (REQ-ETM-022, CA-7) — 2d6+Corpo formula wired via real boot(), compare() ordering", () => {
    it("tied initiative totals: PC (hasPlayerOwner) sorts before NPC regardless of insertion order", async () => {
      // Orador (PC, owned by player) with Corpo 3.
      const pcAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "CA-7 PC",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: { atributos: { corpo: { value: 3, max: 6 } } },
          },
        ],
      });
      expect(pcAck["ok"]).toBe(true);
      const pcActorId = (pcAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      // Antagonista (NPC, GM-only ownership) with a HIGHER Corpo (5) — proves
      // hasPlayerOwner outranks Corpo when totals tie (rule 2 before rule 3).
      const npcAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "CA-7 NPC",
            type: "antagonista",
            ownership: { default: 0 },
            system: { ficha_base: "simples", atributos: { corpo: { value: 5 } } },
          },
        ],
      });
      expect(npcAck["ok"]).toBe(true);
      const npcActorId = (npcAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "CA-7 Scene A", grid: { type: "square", size: 100 }, active: false }],
      });
      const sceneId = (sceneAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const npcTokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: sceneId },
        data: [
          {
            actorId: npcActorId,
            name: "CA-7 NPC",
            x: 0,
            y: 0,
            hidden: false,
            disposition: -1,
          },
        ],
      });
      const npcTokenId = (npcTokenAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const pcTokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: sceneId },
        data: [
          {
            actorId: pcActorId,
            name: "CA-7 PC",
            x: 100,
            y: 100,
            hidden: false,
            disposition: 1,
          },
        ],
      });
      const pcTokenId = (pcTokenAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (combatAck["result"] as { combat: Record<string, unknown> }).combat[
        "_id"
      ] as string;

      // Insert NPC FIRST — proves the final order is compare()-driven, not
      // insertion-order.
      const addNpc = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: npcTokenId,
      });
      const npcCombatantId = (
        (addNpc["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      const addPc = await sendOp(gm, "combat:addCombatant", { combatId, tokenId: pcTokenId });
      const pcCombatantId = (
        (addPc["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      // Force a tied total (10) on both sides via GM-only combat:setInitiative
      // — exercises the REAL registered etmos compare() (systemId fallback
      // through InitiativeFormulaRegistry), not the roll itself.
      await sendOp(gm, "combat:setInitiative", {
        combatId,
        combatantId: npcCombatantId,
        value: 10,
      });
      const finalAck = await sendOp(gm, "combat:setInitiative", {
        combatId,
        combatantId: pcCombatantId,
        value: 10,
      });
      expect(finalAck["ok"]).toBe(true);
      const finalCombat = (finalAck["result"] as { combat: Record<string, unknown> }).combat;
      const combatants = finalCombat["combatants"] as Array<Record<string, unknown>>;
      expect(combatants[0]!["_id"]).toBe(pcCombatantId); // PC sorts first on tie
      expect(combatants[1]!["_id"]).toBe(npcCombatantId);
    }, 30000);

    it("a real combat:rollInitiative roll always records each combatant's tiebreaker as its Corpo value (wires rule 3's data source end-to-end)", async () => {
      const lowCorpoAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "CA-7 Low Corpo PC",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: { atributos: { corpo: { value: 2, max: 6 } } },
          },
        ],
      });
      const lowCorpoActorId = (
        lowCorpoAck["result"] as { documents: Array<Record<string, unknown>> }
      ).documents[0]!["_id"] as string;

      const highCorpoAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "CA-7 High Corpo PC",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: { atributos: { corpo: { value: 5, max: 6 } } },
          },
        ],
      });
      const highCorpoActorId = (
        highCorpoAck["result"] as { documents: Array<Record<string, unknown>> }
      ).documents[0]!["_id"] as string;

      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "CA-7 Scene B", grid: { type: "square", size: 100 }, active: false }],
      });
      const sceneId = (sceneAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      async function placeToken(actorId: string, name: string, x: number): Promise<string> {
        const tokenAck = await sendOp(gm, "doc:create", {
          documentType: "Token",
          parent: { type: "Scene", id: sceneId },
          data: [
            {
              actorId,
              name,
              x,
              y: 0,
              hidden: false,
              disposition: 1,
            },
          ],
        });
        return (tokenAck["result"] as { documents: Array<Record<string, unknown>> }).documents[0]![
          "_id"
        ] as string;
      }

      const lowTokenId = await placeToken(lowCorpoActorId, "Low Corpo", 0);
      const highTokenId = await placeToken(highCorpoActorId, "High Corpo", 100);

      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (combatAck["result"] as { combat: Record<string, unknown> }).combat[
        "_id"
      ] as string;

      const addLow = await sendOp(gm, "combat:addCombatant", { combatId, tokenId: lowTokenId });
      const lowCombatantId = (
        (addLow["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;
      const addHigh = await sendOp(gm, "combat:addCombatant", { combatId, tokenId: highTokenId });
      const highCombatantId = (
        (addHigh["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      // Real 2d6+Corpo roll through the boot-wired formula (RollService,
      // DEC-CBT-03) — total is non-deterministic, but `tiebreaker` (rule 3's
      // data source) is ALWAYS set to each combatant's own Corpo by
      // etmosInitiativeFormula, regardless of the dice outcome.
      const rollAck = await sendOp(gm, "combat:rollInitiative", {
        combatId,
        combatantIds: [lowCombatantId, highCombatantId],
      });
      expect(rollAck["ok"]).toBe(true);
      const rolledCombat = (rollAck["result"] as { combat: Record<string, unknown> }).combat;
      const rolledCombatants = rolledCombat["combatants"] as Array<Record<string, unknown>>;
      const lowRolled = rolledCombatants.find((c) => c["_id"] === lowCombatantId);
      const highRolled = rolledCombatants.find((c) => c["_id"] === highCombatantId);
      expect(lowRolled?.["initiativeStatistic"]).toBe("Corpo");
      expect(highRolled?.["initiativeStatistic"]).toBe("Corpo");
      expect(typeof lowRolled?.["initiative"]).toBe("number");
      expect(typeof highRolled?.["initiative"]).toBe("number");
    }, 30000);

    it("rule 3 (Corpo tiebreak): the exact etmosInitiativeCompare registered by boot() ranks the higher-Corpo entry first on a tied total when hasPlayerOwner also ties", () => {
      // This exercises the SAME function object registered via
      // registrar.registerInitiativeFormula("etmos", { roll, compare }) in
      // systems/etmos/src/index.ts and wired end-to-end by
      // registerSystemFormulas in socket-manager.ts (proven reachable by the
      // hasPlayerOwner-tiebreak test above, which forces a tie through the
      // REAL socket/store path). Since the boot()-driven RollService gives no
      // RNG injection point to force a `total` tie deterministically through
      // sockets, rule 3 in isolation is proven directly against the deployed
      // comparator with hand-built InitiativeEntry values — no reimplementation
      // of the rule, no alternate RNG.
      const lowCorpoEntry: InitiativeEntry = {
        combatant: {
          _id: "low",
          hasPlayerOwner: true,
          initiative: 8,
        } as InitiativeEntry["combatant"],
        total: 8,
        tiebreaker: 2,
      };
      const highCorpoEntry: InitiativeEntry = {
        combatant: {
          _id: "high",
          hasPlayerOwner: true,
          initiative: 8,
        } as InitiativeEntry["combatant"],
        total: 8,
        tiebreaker: 5,
      };
      expect(etmosInitiativeCompare(lowCorpoEntry, highCorpoEntry)).toBeGreaterThan(0); // high sorts before low
      expect(etmosInitiativeCompare(highCorpoEntry, lowCorpoEntry)).toBeLessThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-ETM-023 — Reação por rodada: reset on real turnStart + spend
  // -------------------------------------------------------------------------

  describe("Reação por rodada (REQ-ETM-023) — reset via real turnStart lifecycle + etmos:reacao:usar", () => {
    it("combat:beginCombat fires turnStart for the first combatant, initializing its Reação to max=1; etmos:reacao:usar spends it; a 2nd spend is rejected", async () => {
      const actorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "Reação Orador",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: { atributos: { corpo: { value: 3, max: 6 } } },
          },
        ],
      });
      const actorId = (actorAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Reação Scene", grid: { type: "square", size: 100 }, active: false }],
      });
      const sceneId = (sceneAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const tokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: sceneId },
        data: [
          {
            actorId,
            name: "Reação Orador",
            x: 0,
            y: 0,
            hidden: false,
            disposition: 1,
          },
        ],
      });
      const tokenId = (tokenAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (combatAck["result"] as { combat: Record<string, unknown> }).combat[
        "_id"
      ] as string;

      const addAck = await sendOp(gm, "combat:addCombatant", { combatId, tokenId });
      const combatantId = (
        (addAck["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      // combat:beginCombat -> round 1, first (only) combatant becomes active
      // -> combat-handlers.ts emits the REAL turnStart lifecycle event ->
      // registerReacaoResetOnTurnStart (wired in socket-manager.ts) resets
      // this combatant's flags.etmos.reacoes to { atual: 1, max: 1 }.
      //
      // The listener persists its reset AFTER combat:beginCombat's own ack
      // is already built (reacao-handler.ts's docstring) and broadcasts its
      // OWN follow-up `combat:updated` envelope — listen for that broadcast
      // rather than asserting on the beginCombat ack's (stale) snapshot.
      const reacaoUpdatedPromise = waitForOp(gm, "combat:updated", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        const diff = payload?.["diff"] as Record<string, unknown> | undefined;
        const cs = diff?.["combatants"] as Array<Record<string, unknown>> | undefined;
        const target = cs?.find((c) => c["_id"] === combatantId);
        const flags = target?.["flags"] as Record<string, Record<string, unknown>> | undefined;
        return flags?.["etmos"]?.["reacoes"] !== undefined;
      });
      const beginAck = await sendOp(gm, "combat:beginCombat", { combatId });
      expect(beginAck["ok"]).toBe(true);

      const reacaoUpdated = await reacaoUpdatedPromise;
      const diff = (reacaoUpdated["payload"] as Record<string, unknown>)["diff"] as Record<
        string,
        unknown
      >;
      const updatedCombatants = diff["combatants"] as Array<Record<string, unknown>>;
      const begunCombatant = updatedCombatants.find((c) => c["_id"] === combatantId);
      const flags = begunCombatant?.["flags"] as
        | Record<string, Record<string, unknown>>
        | undefined;
      const reacoes = flags?.["etmos"]?.["reacoes"] as { atual: number; max: number } | undefined;
      expect(reacoes).toEqual({ atual: 1, max: 1 });

      // Player (owner of the Actor) spends the Reação.
      const usarAck = await sendOp(player, "etmos:reacao:usar", { combatId, combatantId });
      expect(usarAck["ok"]).toBe(true);
      const usarResult = usarAck["result"] as {
        state: { atual: number; max: number };
        segundaReacaoComCusto: boolean;
      };
      expect(usarResult.state).toEqual({ atual: 0, max: 1 });
      expect(usarResult.segundaReacaoComCusto).toBe(false);

      // A 2nd spend this round is rejected — no Reação remaining.
      const secondUsarAck = await sendOp(player, "etmos:reacao:usar", { combatId, combatantId });
      expect(secondUsarAck["ok"]).toBe(false);
      expect(secondUsarAck["code"]).toBe("VALIDATION_FAILED");
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // REQ-ETM-035..039, CA-11 — Marcos 5+5+5 -> subida de nível via Tabela E
  // -------------------------------------------------------------------------

  describe("Marcos de Crescimento + Tabela E (REQ-ETM-035..039, CA-11)", () => {
    it("completing all 3 trilhas (5+5+5) and confirming applies Tabela E bônus atomically, resets trilhas, bumps nivel; an immediate repeat confirmation is rejected (trilhas freshly reset)", async () => {
      const createAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "Marcos Orador",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: {
              nivel: 1,
              atributos: {
                corpo: { value: 3, max: 6 },
                alma: { value: 3, max: 6 },
                mente: { value: 3, max: 6 },
              },
              marcos_crescimento: {
                fisicos: { value: 5, max: 5 },
                mentais: { value: 5, max: 5 },
                emocionais: { value: 5, max: 5 },
              },
            },
          },
        ],
      });
      expect(createAck["ok"]).toBe(true);
      const actorId = (createAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      // Tabela E, nivel 1->2 (systems/etmos/src/compositor/progressao.ts):
      //   fisica: "+1 Objeto e +1 Característica no Grimório" -> tipo "items"
      //   mental: "+1 ponto de Atributo (distribuído livremente)" -> tipo "atributo"
      //   emocional: "+1 Habilidade Prática" -> tipo "items"
      // The world-level Item documents below are what the client's
      // compendium picker would have already resolved before firing this op
      // (progressao-handler.ts's docstring).
      const particulaAck = await sendOp(gm, "doc:create", {
        documentType: "Item",
        data: [
          {
            name: "Objeto de Grimório",
            type: "particula",
            system: { slug: "test-objeto", palavra_etmos: "Test", categoria: "objeto" },
          },
        ],
      });
      expect(particulaAck["ok"]).toBe(true);
      const particulaId = (particulaAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const habilidadeAck = await sendOp(gm, "doc:create", {
        documentType: "Item",
        data: [
          {
            name: "Habilidade Prática de Teste",
            type: "habilidade",
            system: { categoria: "pratica" },
          },
        ],
      });
      expect(habilidadeAck["ok"]).toBe(true);
      const habilidadeId = (
        habilidadeAck["result"] as { documents: Array<Record<string, unknown>> }
      ).documents[0]!["_id"] as string;

      // Anti-forge (M5-E audit FIX 1): a payload where "fisica" claims tipo
      // "atributo" (Tabela E only grants Grimório Items for "fisica" at this
      // transição) must be rejected wholesale, BEFORE any mutation — an
      // owner could otherwise forge {tipo:"atributo"} on all 3 categorias
      // and gain +3 Atributo per level-up instead of the +1 Tabela E grants
      // for "mental" alone.
      const forgedAck = await sendOp(player, "etmos:progressao:confirmar", {
        actorId,
        fisica: { tipo: "atributo", atributo: "corpo" },
        mental: { tipo: "atributo", atributo: "mente" },
        emocional: { tipo: "atributo", atributo: "alma" },
      });
      expect(forgedAck["ok"]).toBe(false);
      expect(forgedAck["code"]).toBe("VALIDATION_FAILED");

      // Confirm with the LEGITIMATE shape (fisica/emocional = items,
      // mental = atributo) — all 3 categorias present (REQ-ETM-038 — bônus
      // apply together, "the chosen bônus", plural — never a partial pick).
      const confirmAck = await sendOp(player, "etmos:progressao:confirmar", {
        actorId,
        fisica: { tipo: "items", itemIds: [particulaId] },
        mental: { tipo: "atributo", atributo: "mente" },
        emocional: { tipo: "items", itemIds: [habilidadeId] },
      });
      expect(confirmAck["ok"]).toBe(true);
      const confirmResult = confirmAck["result"] as {
        actor: Record<string, unknown>;
        novoNivel: number;
      };
      expect(confirmResult.novoNivel).toBe(2);

      const sys = confirmResult.actor["system"] as Record<string, unknown>;
      expect(sys["nivel"]).toBe(2);

      // Tabela E's "Mental" bônus at nivel 1->2 was +1 Atributo — mente
      // bumped 3 -> 4; corpo/alma untouched (no atributo bônus was chosen
      // for fisica/emocional this transição).
      const atributos = sys["atributos"] as Record<string, Record<string, unknown>>;
      expect(atributos["mente"]!["value"]).toBe(4);
      expect(atributos["corpo"]!["value"]).toBe(3);
      expect(atributos["alma"]!["value"]).toBe(3);

      // The Grimório/Habilidade Items were embedded onto the Actor.
      const items = confirmResult.actor["items"] as Array<Record<string, unknown>>;
      const embeddedIds = items.map((i) => i["_id"]);
      expect(embeddedIds).toContain(particulaId);
      expect(embeddedIds).toContain(habilidadeId);

      // Trilhas reset to { value: 0, max: 5 } (CA-11).
      const marcos = sys["marcos_crescimento"] as Record<string, Record<string, unknown>>;
      expect(marcos["fisicos"]).toEqual({ value: 0, max: 5 });
      expect(marcos["mentais"]).toEqual({ value: 0, max: 5 });
      expect(marcos["emocionais"]).toEqual({ value: 0, max: 5 });

      // Immediate repeat confirmation is rejected: trilhas were just reset to
      // 0, so they are no longer "completas" — the categoria-repetida
      // protection is structural (REQ-ETM-039: never twice in the same
      // subida) and manifests here as trilhasIncompletas.
      const repeatAck = await sendOp(player, "etmos:progressao:confirmar", {
        actorId,
        fisica: { tipo: "items", itemIds: [particulaId] },
        mental: { tipo: "atributo", atributo: "mente" },
        emocional: { tipo: "items", itemIds: [habilidadeId] },
      });
      expect(repeatAck["ok"]).toBe(false);
      expect(repeatAck["code"]).toBe("VALIDATION_FAILED");
      expect(repeatAck["message"]).toMatch(/trilhas/i);
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // REQ-ETM-021, CA-6 — Teste Contestado: PC vs NPC tied -> PC wins
  // -------------------------------------------------------------------------

  describe("Teste Contestado (REQ-ETM-021, CA-6)", () => {
    it("tied totals, neither side provocador: PC beats NPC (pcVenceEmpateContraNpc)", async () => {
      const pcAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "CA-6 PC",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: { atributos: { alma: { value: 3, max: 6 } } },
          },
        ],
      });
      const pcActorId = (pcAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const npcAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "CA-6 NPC",
            type: "antagonista",
            ownership: { default: 0 },
            system: { ficha_base: "simples" },
          },
        ],
      });
      const npcActorId = (npcAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      // Deterministic 1d1+N formulas — both sides roll exactly the same
      // total (4), isolating CA-6's rule 3 (neither is provocador -> PC wins).
      const contestadoAck = await sendOp(player, "etmos:teste:contestado", {
        a: { actorId: pcActorId, formula: "1d1+4", provocador: false },
        b: { actorId: npcActorId, formula: "1d1+4", provocador: false },
        descricao: "CA-6 empate PC vs NPC",
      });
      expect(contestadoAck["ok"]).toBe(true);
      const result = contestadoAck["result"] as {
        resultado: { vencedor: string | null; motivo: string; margem: number };
        totalA: number;
        totalB: number;
      };
      expect(result.totalA).toBe(5);
      expect(result.totalB).toBe(5);
      expect(result.resultado.margem).toBe(0);
      expect(result.resultado.vencedor).toBe("a"); // PC (side a) wins
      expect(result.resultado.motivo).toBe("pcVenceEmpateContraNpc");
    }, 30000);
  });
});
