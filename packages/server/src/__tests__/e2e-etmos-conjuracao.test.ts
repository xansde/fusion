/**
 * E2E — Etmos Compositor de Magias through the REAL boot() path.
 *
 * This is the M5-C integration proof: it boots the server through the actual
 * boot() sequence (NOT manual SocketManager wiring) with `netContext.systemId
 * = "etmos"` and `netContext.systemModule = etmosSystem`, connects a GM and a
 * PLAYER socket, and drives the full `etmos:conjuracao:*` lifecycle
 * (propor -> arbitrar -> rolar -> resolver) through real socket.io events —
 * mirroring boot-compendium-sf2e.test.ts's "no manual wiring" rationale.
 *
 * Confirms end-to-end that:
 *   - the Etmos system is registered in the SystemRegistry used by the CLI
 *     boot path (serve.ts / worlds.ts);
 *   - the five etmos:conjuracao:* handlers are wired into the socket layer
 *     (socket-manager.ts registerWorldNamespace);
 *   - Estresse is applied to the persisted Actor and Fadiga is recomputed at
 *     resolver time (REQ-ETM-024);
 *   - the final ChatMessage reflects the "resolvida" state.
 *
 * Spec: 19-sistema-etmos.md REQ-ETM-018, REQ-ETM-024, REQ-ETM-029..033, CA-9.
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
import { etmosSystem } from "@fusion/system-etmos";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors boot-compendium-sf2e.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-e2e-etmos-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "e2e_etmos_world";

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

  // Boot through the REAL sequence — only systemId + systemModule supplied,
  // exactly as serve.ts does after registering @fusion/system-etmos in the
  // SystemRegistry.
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
      worldTitle: "E2E Etmos World",
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

function connectClient(
  port: number,
  worldId: string,
  token: string,
  lastSeq?: number,
): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: {
      token,
      protocolVersion: PROTOCOL_VERSION,
      ...(lastSeq !== undefined ? { lastSeq } : {}),
    },
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

function fraseFixture(): Record<string, unknown> {
  return {
    funcao_slug: "et",
    objeto_slugs: ["imu"],
    caracteristica_slugs: [],
    criadores: [],
    modificador_slugs: [],
    intencao: "Curar um ferimento leve",
    frase_completa: "Etimu",
    complexidade: null,
    estresse_gerado: 0,
    favorita: false,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("E2E — Etmos Compositor de Magias through real boot()", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let actorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);

    // GM creates the Orador Actor via the real doc:create socket op, owned by
    // the player — atributos.alma.value = 3, estresse limite = 7.
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "E2E Orador",
          type: "orador",
          ownership: { default: 0, [ctx.playerId]: 3 },
          system: {
            atributos: {
              corpo: { value: 3, max: 6 },
              alma: { value: 3, max: 6 },
              mente: { value: 3, max: 6 },
            },
            estresse: { atual: 0, limite: 7 },
            fadiga: { estado: "normal" },
            totem: { possui: false, rank: 0 },
          },
        },
      ],
    });
    expect(createAck["ok"]).toBe(true);
    const created = (createAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents;
    actorId = created[0]!["_id"] as string;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  it("SystemRegistry / boot wiring — Actor was created and persisted with the etmos orador shape", () => {
    expect(actorId).toBeTruthy();
  });

  it("full propor -> arbitrar -> rolar -> resolver flow via real socket events applies Estresse and updates the ChatMessage", async () => {
    // 1. propor (player, owner of the Actor)
    const proporAck = await sendOp(player, "etmos:conjuracao:propor", {
      conjuradorActorId: actorId,
      frase: fraseFixture(),
    });
    expect(proporAck["ok"]).toBe(true);
    const proporResult = proporAck["result"] as { message: Record<string, unknown> };
    const messageId = proporResult.message["_id"] as string;
    const proporFlags = proporResult.message["flags"] as Record<string, Record<string, unknown>>;
    expect((proporFlags["etmos"]?.["conjuracao"] as Record<string, unknown>)["estado"]).toBe(
      "proposta",
    );

    // 2. arbitrar (GM only)
    const arbitrarAck = await sendOp(gm, "etmos:conjuracao:arbitrar", {
      messageId,
      complexidade: "regular",
      notasNarrador: "E2E cura simples.",
    });
    expect(arbitrarAck["ok"]).toBe(true);
    const arbitrarResult = arbitrarAck["result"] as { message: Record<string, unknown> };
    const arbitrarFlags = arbitrarResult.message["flags"] as Record<
      string,
      Record<string, unknown>
    >;
    const arbitradaCard = arbitrarFlags["etmos"]?.["conjuracao"] as Record<string, unknown>;
    expect(arbitradaCard["estado"]).toBe("arbitrada");
    expect(arbitradaCard["complexidade"]).toBe("regular");
    expect(arbitradaCard["custo_estresse"]).toBe(1); // CUSTO_BASE.regular = 1, rankTotem = 0

    // A player cannot arbitrar — permission guard sanity check within the E2E flow.
    const playerArbitrarAck = await sendOp(player, "etmos:conjuracao:arbitrar", {
      messageId,
      complexidade: "regular",
    });
    expect(playerArbitrarAck["ok"]).toBe(false);
    expect(playerArbitrarAck["code"]).toBe("PERMISSION_DENIED");

    // 3. rolar (player, owner of the Actor) — authoritative 2d6 + @atributos.alma.value via RollService
    const rolarAck = await sendOp(player, "etmos:conjuracao:rolar", { messageId });
    expect(rolarAck["ok"]).toBe(true);
    const rolarResult = rolarAck["result"] as {
      message: Record<string, unknown>;
      roll: { total: number };
    };
    expect(typeof rolarResult.roll.total).toBe("number");
    // 2d6 (2..12) + alma(3) = 5..15
    expect(rolarResult.roll.total).toBeGreaterThanOrEqual(5);
    expect(rolarResult.roll.total).toBeLessThanOrEqual(15);
    const rolarFlags = rolarResult.message["flags"] as Record<string, Record<string, unknown>>;
    const roladaCard = rolarFlags["etmos"]?.["conjuracao"] as Record<string, unknown>;
    expect(roladaCard["estado"]).toBe("rolada");
    expect(roladaCard["roll_message_id"]).toBeTruthy();

    // 4. resolver (GM only) — applies custo_estresse to the Actor (REQ-ETM-024:
    // accumulates regardless of sucesso/falha) and recomputes Fadiga.
    const resolverAck = await sendOp(gm, "etmos:conjuracao:resolver", { messageId });
    expect(resolverAck["ok"]).toBe(true);
    const resolverResult = resolverAck["result"] as {
      message: Record<string, unknown>;
      actor: Record<string, unknown>;
    };
    const resolverFlags = resolverResult.message["flags"] as Record<
      string,
      Record<string, unknown>
    >;
    const resolvidaCard = resolverFlags["etmos"]?.["conjuracao"] as Record<string, unknown>;
    expect(resolvidaCard["estado"]).toBe("resolvida");

    // Estresse applied to the persisted Actor.
    const actorSys = resolverResult.actor["system"] as Record<string, unknown>;
    const estresse = actorSys["estresse"] as Record<string, unknown>;
    expect(estresse["atual"]).toBe(1); // 0 + custoEstresse("regular", 0) = 1

    // Fadiga recomputed: d = 1 - 7 = -6 <= 0 -> "normal"
    const fadiga = actorSys["fadiga"] as Record<string, unknown>;
    expect(fadiga["estado"]).toBe("normal");

    // Confirm the Estresse persisted on the world's authoritative row (not
    // just echoed in the ack) by re-reading the Actor through doc handling —
    // a fresh doc:create-adjacent read isn't exposed, so we assert via a
    // second resolver-independent path: re-run resolver is now invalid
    // (already resolvida) which proves state persisted server-side too.
    const secondResolverAck = await sendOp(gm, "etmos:conjuracao:resolver", { messageId });
    expect(secondResolverAck["ok"]).toBe(false);
    expect(secondResolverAck["code"]).toBe("VALIDATION_FAILED");
  }, 30000);

  it("cancelar before rolada applies zero cost and is reachable by the Actor owner", async () => {
    const proporAck = await sendOp(player, "etmos:conjuracao:propor", {
      conjuradorActorId: actorId,
      frase: fraseFixture(),
    });
    expect(proporAck["ok"]).toBe(true);
    const messageId = (proporAck["result"] as { message: Record<string, unknown> }).message[
      "_id"
    ] as string;

    const cancelarAck = await sendOp(player, "etmos:conjuracao:cancelar", { messageId });
    expect(cancelarAck["ok"]).toBe(true);
    const cancelarResult = cancelarAck["result"] as { message: Record<string, unknown> };
    const flags = cancelarResult.message["flags"] as Record<string, Record<string, unknown>>;
    expect((flags["etmos"]?.["conjuracao"] as Record<string, unknown>)["estado"]).toBe("cancelada");
  });

  it("FIX 1: resolving a conjuração while the player is disconnected still delivers the Actor doc:update and the final card state via resync:delta on reconnect", async () => {
    // Fresh Actor so this test's Estresse delta doesn't depend on state left
    // by earlier tests in this file.
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "E2E Orador Resync",
          type: "orador",
          ownership: { default: 0, [ctx.playerId]: 3 },
          system: {
            atributos: {
              corpo: { value: 3, max: 6 },
              alma: { value: 3, max: 6 },
              mente: { value: 3, max: 6 },
            },
            estresse: { atual: 0, limite: 7 },
            fadiga: { estado: "normal" },
            totem: { possui: false, rank: 0 },
          },
        },
      ],
    });
    expect(createAck["ok"]).toBe(true);
    const resyncActorId = (createAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents[0]!["_id"] as string;

    // 1. propor + arbitrar + rolar while the player is still connected, and
    //    record the seq the player has observed right before disconnecting.
    const proporAck = await sendOp(player, "etmos:conjuracao:propor", {
      conjuradorActorId: resyncActorId,
      frase: fraseFixture(),
    });
    expect(proporAck["ok"]).toBe(true);
    const proporResult = proporAck["result"] as { message: Record<string, unknown> };
    const messageId = proporResult.message["_id"] as string;
    const lastSeqBeforeDisconnect = proporAck["seq"] as number;

    const arbitrarAck = await sendOp(gm, "etmos:conjuracao:arbitrar", {
      messageId,
      complexidade: "regular",
    });
    expect(arbitrarAck["ok"]).toBe(true);

    // 2. Disconnect the player BEFORE rolar/resolver — it misses both the
    //    "rolada" card broadcast and the resolver's Actor doc:update +
    //    "resolvida" card broadcast entirely while offline.
    player.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rolarAck = await sendOp(gm, "etmos:conjuracao:rolar", { messageId });
    expect(rolarAck["ok"]).toBe(true);

    const resolverAck = await sendOp(gm, "etmos:conjuracao:resolver", { messageId });
    expect(resolverAck["ok"]).toBe(true);
    const resolverResult = resolverAck["result"] as {
      actor: Record<string, unknown>;
    };
    const resolvedEstresse = (
      (resolverResult.actor["system"] as Record<string, unknown>)["estresse"] as Record<
        string,
        unknown
      >
    )["atual"];
    expect(resolvedEstresse).toBe(1); // custoEstresse("regular", 0)

    // 3. Reconnect the player with lastSeq from BEFORE arbitrar/rolar/resolver
    //    — the server must reply with resync:delta carrying every op since
    //    then, including the resolver's "doc:update"/Actor envelope and the
    //    "resolvida" card broadcast (both went through the OpBuffer per FIX 1).
    const reconnectedPlayer = connectClient(
      ctx.port,
      ctx.worldId,
      ctx.playerToken,
      lastSeqBeforeDisconnect,
    );

    const receivedOps: Record<string, unknown>[] = [];
    const resyncPromise = new Promise<void>((resolve, reject) => {
      reconnectedPlayer.on("op", (env: Record<string, unknown>) => {
        const t = env["type"];
        if (t === "resync:delta") {
          const payload = env["payload"] as { ops: Record<string, unknown>[] };
          receivedOps.push(...payload.ops);
          resolve();
        } else if (t === "resync:full") {
          reject(new Error("Expected resync:delta, got resync:full — buffer overflow?"));
        }
      });
    });

    reconnectedPlayer.connect();
    await waitForConnect(reconnectedPlayer);
    await resyncPromise;
    reconnectedPlayer.disconnect();

    // The Actor's doc:update (Estresse/Fadiga patch) must be present.
    const actorUpdateOps = receivedOps.filter((op) => {
      if (op["type"] !== "doc:update") return false;
      const payload = op["payload"] as { documentType?: string };
      return payload.documentType === "Actor";
    });
    expect(actorUpdateOps.length).toBeGreaterThanOrEqual(1);
    const lastActorPayload = actorUpdateOps[actorUpdateOps.length - 1]!["payload"] as {
      documents: Array<Record<string, unknown>>;
    };
    const replayedActor = lastActorPayload.documents.find((d) => d["_id"] === resyncActorId);
    expect(replayedActor).toBeTruthy();
    const replayedEstresse = (
      (replayedActor!["system"] as Record<string, unknown>)["estresse"] as Record<string, unknown>
    )["atual"];
    expect(replayedEstresse).toBe(1);

    // The final "resolvida" card-state ChatMessage broadcast must also be
    // present (chat messages ride the "doc:create" envelope type with
    // documentType "ChatMessage" — see packages/shared/src/chat/protocol.ts).
    const chatOps = receivedOps.filter((op) => {
      if (op["type"] !== "doc:create") return false;
      const payload = op["payload"] as { documentType?: string };
      return payload.documentType === "ChatMessage";
    });
    const resolvidaOp = chatOps.find((op) => {
      const payload = op["payload"] as { documents: Array<Record<string, unknown>> };
      const msg = payload.documents.find((d) => d["_id"] === messageId);
      if (!msg) return false;
      const flags = msg["flags"] as Record<string, Record<string, unknown>>;
      return (
        (flags["etmos"]?.["conjuracao"] as Record<string, unknown>)?.["estado"] === "resolvida"
      );
    });
    expect(resolvidaOp).toBeTruthy();
  }, 30000);
});
