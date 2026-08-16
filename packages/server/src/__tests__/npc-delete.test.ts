/**
 * npc-delete.test.ts — excluir um não-jogável (spec 42 §5.7, G075), lado servidor.
 *
 * Cobre REQ-NPC-050 (só papel privilegiado exclui), REQ-NPC-051 (antes de excluir,
 * o que cai junto: presenças por cena, conhecimento e itens da ficha), REQ-NPC-052
 * (recusa enquanto o ator estiver num combate que não terminou, dizendo como
 * destravar), REQ-NPC-053 (excluído, as presenças somem de TODAS as cenas),
 * REQ-NPC-054 (o conhecimento gravado sobre ele deixa de existir) e REQ-NPC-055
 * (esta aba não exclui personagem de jogador, e a consulta dela não responde
 * sobre um).
 *
 * Tudo é afirmado sobre o PAYLOAD que o socket carrega — o ack da operação e o
 * snapshot de um join novo —, nunca sobre uma visão do cliente: o que importa é o
 * que o servidor de fato persistiu e o que ele de fato entrega depois.
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
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `fusion-${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerUserId: string;
}

let ctx: Ctx;
let gmSocket: ClientSocket;
let playerSocket: ClientSocket;

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

/** Collect the resync:full snapshot the server pushes on join. */
function waitForSnapshot(socket: ClientSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for snapshot")), timeoutMs);
    const handler = (env: Record<string, unknown>): void => {
      if (env["type"] === "resync:full") {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

/** Everything the server currently holds, read through a fresh join. */
async function readWorld(token: string): Promise<Record<string, Record<string, unknown>[]>> {
  const socket = connectClient(ctx.port, ctx.worldId, token);
  const snapshotP = waitForSnapshot(socket);
  socket.connect();
  await waitForConnect(socket);
  const env = await snapshotP;
  socket.disconnect();

  const snapshot = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
    string,
    unknown
  >;
  return (snapshot["documents"] ?? {}) as Record<string, Record<string, unknown>[]>;
}

/** Every `op` envelope a socket receives while the returned collector is armed. */
function collectOps(socket: ClientSocket): { ops: Record<string, unknown>[]; stop: () => void } {
  const ops: Record<string, unknown>[] = [];
  const handler = (env: Record<string, unknown>): void => {
    ops.push(env);
  };
  socket.on("op", handler);
  return {
    ops,
    stop: () => {
      socket.off("op", handler);
    },
  };
}

function firstDocId(ack: Record<string, unknown>): string {
  const result = ack["result"] as Record<string, unknown>;
  const docs = result["documents"] as Record<string, unknown>[];
  return docs[0]!["_id"] as string;
}

async function createActor(
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type, ownership: { default: 0 }, flags: {}, ...extra }],
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return firstDocId(ack);
}

async function createScene(name: string): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name, width: 1000, height: 1000 }],
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return firstDocId(ack);
}

async function createToken(sceneId: string, name: string, actorId: string): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Token",
    data: [{ name, actorId, x: 0, y: 0 }],
    parent: { type: "Scene", id: sceneId },
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const parent = (ack["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>;
  const tokens = parent["tokens"] as Record<string, unknown>[];
  const created = [...tokens].reverse().find((t) => t["name"] === name);
  return created!["_id"] as string;
}

async function previewDelete(
  socket: ClientSocket,
  actorId: string,
): Promise<Record<string, unknown>> {
  return sendOp(socket, "actor:deletePreview", { actorId });
}

/** How many tokens of `actorId` stand in every scene the server holds. */
function presencesInWorld(
  world: Record<string, Record<string, unknown>[]>,
  actorId: string,
): number {
  let total = 0;
  for (const scene of world["Scene"] ?? []) {
    const tokens = (scene["tokens"] ?? []) as Record<string, unknown>[];
    total += tokens.filter((t) => t["actorId"] === actorId).length;
  }
  return total;
}

beforeAll(async () => {
  const worldId = "npc-delete-world";
  const dataDir = makeTempDir(worldId);
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const { user: player } = await authService.createUser({
    name: "Tobias",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "NPC Delete World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  ctx = {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
  };

  gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
  gmSocket.connect();
  await waitForConnect(gmSocket);

  playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
  playerSocket.connect();
  await waitForConnect(playerSocket);
}, 30_000);

afterAll(async () => {
  gmSocket?.disconnect();
  playerSocket?.disconnect();
  if (!ctx) return;
  await ctx.bootResult.shutdown();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// REQ-NPC-050 / REQ-NPC-051 — o que cai junto, antes de cair
// ---------------------------------------------------------------------------

describe("REQ-NPC-051: a consulta diz o que a exclusão leva junto", () => {
  it("REQ-NPC-051: presenças por cena, conhecimento gravado e itens da ficha", async () => {
    const praca = await createScene("Praça do Mercado");
    const cripta = await createScene("Cripta");
    const bram = await createActor("Ferreiro Bram", "npc", {
      items: [{ _id: "aaaaaaaaaaaaaaaa", name: "Martelo", type: "equipment" }],
    });
    const tobias = await createActor("Tobias", "character", {
      ownership: { default: 0, [ctx.playerUserId]: 3 },
    });

    await createToken(praca, "Bram na praça", bram);
    await createToken(praca, "Bram no balcão", bram);
    await createToken(cripta, "Bram na cripta", bram);

    const knowledgeAck = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: bram, general: 0, exceptions: { [tobias]: 2 } }],
    });
    expect(knowledgeAck["ok"], JSON.stringify(knowledgeAck)).toBe(true);

    const ack = await previewDelete(gmSocket, bram);
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const preview = ack["result"] as Record<string, unknown>;

    expect(preview["actorId"]).toBe(bram);
    expect(preview["name"]).toBe("Ferreiro Bram");
    expect(preview["type"]).toBe("npc");

    // Quantas presenças, e em quais cenas — e nada da presença individual.
    expect(preview["presenceCount"]).toBe(3);
    const presences = preview["presences"] as Record<string, unknown>[];
    expect(presences).toHaveLength(2);
    const naPraca = presences.find((p) => p["sceneId"] === praca);
    const naCripta = presences.find((p) => p["sceneId"] === cripta);
    expect(naPraca?.["presenceCount"]).toBe(2);
    expect(naPraca?.["sceneName"]).toBe("Praça do Mercado");
    expect(naCripta?.["presenceCount"]).toBe(1);
    expect(JSON.stringify(presences)).not.toContain("tokenId");

    // O conhecimento gravado sobre ele (REQ-CTT-070/072).
    const knowledge = preview["knowledge"] as Record<string, unknown>;
    expect(knowledge["general"]).toBe(0);
    expect(knowledge["exceptionCount"]).toBe(1);
    expect(knowledge["knownBy"]).toBe(1);
    expect(knowledge["glimpsedBy"]).toBe(0);

    // A ficha com seus itens embutidos.
    expect(preview["itemCount"]).toBe(1);

    // Nada bloqueia: não há combate no mundo ainda.
    expect(preview["blockingCombats"]).toEqual([]);
    expect(preview["deletable"]).toBe(true);
  });

  it("REQ-NPC-050: o jogador não recebe a consulta nem consegue excluir", async () => {
    const rato = await createActor("Rato Gigante", "npc");

    const previewAck = await previewDelete(playerSocket, rato);
    expect(previewAck["ok"]).toBe(false);
    expect(previewAck["code"]).toBe("PERMISSION_DENIED");

    const deleteAck = await sendOp(playerSocket, "doc:delete", {
      documentType: "Actor",
      ids: [rato],
    });
    expect(deleteAck["ok"]).toBe(false);
    expect(deleteAck["code"]).toBe("PERMISSION_DENIED");

    // E o ator continua lá.
    const world = await readWorld(ctx.gmToken);
    expect((world["Actor"] ?? []).some((doc) => doc["_id"] === rato)).toBe(true);
  });

  it("REQ-NPC-055: a consulta desta aba não responde sobre personagem de jogador", async () => {
    const pc = await createActor("Fofurinha", "character", {
      ownership: { default: 0, [ctx.playerUserId]: 3 },
    });

    const ack = await previewDelete(gmSocket, pc);
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("player character");
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-052 — combate ativo recusa
// ---------------------------------------------------------------------------

describe("REQ-NPC-052: combate que não terminou recusa a exclusão", () => {
  it("REQ-NPC-052: a recusa nomeia o encontro e diz como destravar", async () => {
    const arena = await createScene("Arena");
    const goblin = await createActor("Goblin Piromaníaco", "npc");
    const tokenId = await createToken(arena, "Goblin", goblin);

    const combatAck = await sendOp(gmSocket, "combat:create", { sceneId: arena });
    expect(combatAck["ok"], JSON.stringify(combatAck)).toBe(true);
    const combat = (combatAck["result"] as Record<string, unknown>)["combat"] as Record<
      string,
      unknown
    >;
    const combatId = combat["_id"] as string;

    const addAck = await sendOp(gmSocket, "combat:addCombatant", {
      combatId,
      tokenId,
      actorId: goblin,
    });
    expect(addAck["ok"], JSON.stringify(addAck)).toBe(true);

    // A consulta já avisa antes de o Mestre confirmar (REQ-NPC-051).
    const previewAck = await previewDelete(gmSocket, goblin);
    expect(previewAck["ok"], JSON.stringify(previewAck)).toBe(true);
    const preview = previewAck["result"] as Record<string, unknown>;
    expect(preview["deletable"]).toBe(false);
    const blocking = preview["blockingCombats"] as Record<string, unknown>[];
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!["combatId"]).toBe(combatId);
    expect(blocking[0]!["sceneId"]).toBe(arena);
    expect(blocking[0]!["sceneName"]).toBe("Arena");
    expect(blocking[0]!["combatantCount"]).toBe(1);

    // E o servidor recusa de verdade, não só na tela.
    const deleteAck = await sendOp(gmSocket, "doc:delete", {
      documentType: "Actor",
      ids: [goblin],
    });
    expect(deleteAck["ok"]).toBe(false);
    expect(deleteAck["code"]).toBe("VALIDATION_FAILED");
    const message = String(deleteAck["message"]);
    expect(message).toContain(combatId);
    // A recusa diz o que fazer para destravar (REQ-CBT-003 / REQ-CBT-006).
    expect(message).toContain("combat:endCombat");
    expect(message).toContain("combat:removeCombatant");

    // Nada foi excluído.
    const world = await readWorld(ctx.gmToken);
    expect((world["Actor"] ?? []).some((doc) => doc["_id"] === goblin)).toBe(true);
    expect(presencesInWorld(world, goblin)).toBe(1);
  });

  it("REQ-NPC-052: um lote com um NPC livre e um em combate não exclui nada", async () => {
    const arena = await createScene("Arena Dupla");
    const preso = await createActor("Ogro Preso", "npc");
    const livre = await createActor("Ogro Livre", "npc");
    const tokenId = await createToken(arena, "Ogro", preso);

    const combatAck = await sendOp(gmSocket, "combat:create", { sceneId: arena });
    const combatId = (
      (combatAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
    )["_id"] as string;
    await sendOp(gmSocket, "combat:addCombatant", { combatId, tokenId, actorId: preso });

    const deleteAck = await sendOp(gmSocket, "doc:delete", {
      documentType: "Actor",
      ids: [livre, preso],
    });
    expect(deleteAck["ok"]).toBe(false);

    const world = await readWorld(ctx.gmToken);
    const actorIds = (world["Actor"] ?? []).map((doc) => doc["_id"]);
    expect(actorIds).toContain(livre);
    expect(actorIds).toContain(preso);
  });

  it("REQ-NPC-052: encerrado o combate, a mesma exclusão passa", async () => {
    const arena = await createScene("Arena Encerrada");
    const lobo = await createActor("Lobo Atroz", "npc");
    const tokenId = await createToken(arena, "Lobo", lobo);

    const combatAck = await sendOp(gmSocket, "combat:create", { sceneId: arena });
    const combatId = (
      (combatAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
    )["_id"] as string;
    await sendOp(gmSocket, "combat:addCombatant", { combatId, tokenId, actorId: lobo });

    const blockedAck = await sendOp(gmSocket, "doc:delete", {
      documentType: "Actor",
      ids: [lobo],
    });
    expect(blockedAck["ok"]).toBe(false);

    const endAck = await sendOp(gmSocket, "combat:endCombat", { combatId });
    expect(endAck["ok"], JSON.stringify(endAck)).toBe(true);

    const previewAck = await previewDelete(gmSocket, lobo);
    expect((previewAck["result"] as Record<string, unknown>)["deletable"]).toBe(true);

    const deleteAck = await sendOp(gmSocket, "doc:delete", {
      documentType: "Actor",
      ids: [lobo],
    });
    expect(deleteAck["ok"], JSON.stringify(deleteAck)).toBe(true);

    const world = await readWorld(ctx.gmToken);
    expect((world["Actor"] ?? []).some((doc) => doc["_id"] === lobo)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-053 / REQ-NPC-054 — o que some junto
// ---------------------------------------------------------------------------

describe("REQ-NPC-053 / REQ-NPC-054: excluído, some de todas as cenas e o conhecimento acaba", () => {
  it("REQ-NPC-053: as presenças somem de TODAS as cenas, com delta e sem recarregar", async () => {
    const taverna = await createScene("Taverna");
    const porao = await createScene("Porão");
    const bandido = await createActor("Bandido Encapuzado", "npc");

    await createToken(taverna, "Bandido A", bandido);
    await createToken(taverna, "Bandido B", bandido);
    await createToken(porao, "Bandido C", bandido);
    // Uma presença de OUTRO ator na mesma cena, que precisa sobreviver.
    const gato = await createActor("Gato da Taverna", "npc");
    await createToken(taverna, "Gato", gato);

    const before = await readWorld(ctx.gmToken);
    expect(presencesInWorld(before, bandido)).toBe(3);

    const collector = collectOps(gmSocket);
    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Actor",
      ids: [bandido],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    collector.stop();

    // O delta das cenas viaja no mesmo cano — ninguém precisa recarregar.
    const sceneUpdates = collector.ops.filter(
      (env) =>
        env["type"] === "doc:update" &&
        (env["payload"] as Record<string, unknown>)["documentType"] === "Scene",
    );
    expect(sceneUpdates.length).toBeGreaterThan(0);
    const updatedScenes = sceneUpdates.flatMap(
      (env) =>
        (env["payload"] as Record<string, unknown>)["documents"] as Record<string, unknown>[],
    );
    expect(updatedScenes.map((s) => s["_id"]).sort()).toEqual([taverna, porao].sort());

    const world = await readWorld(ctx.gmToken);
    expect(presencesInWorld(world, bandido)).toBe(0);
    // A presença do outro ator continua exatamente onde estava.
    expect(presencesInWorld(world, gato)).toBe(1);
  });

  it("REQ-NPC-054: o conhecimento sobre ele deixa de existir, e nada mais o referencia", async () => {
    const beco = await createScene("Beco");
    const informante = await createActor("Informante", "npc");
    const heroi = await createActor("Heroína Vex", "character", {
      ownership: { default: 0, [ctx.playerUserId]: 3 },
    });
    await createToken(beco, "Informante", informante);

    // Regra geral + exceção: os dois lados do modelo (REQ-CTT-070/072).
    const knowledgeAck = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: informante, general: 1, exceptions: { [heroi]: 2 } }],
    });
    expect(knowledgeAck["ok"], JSON.stringify(knowledgeAck)).toBe(true);

    const before = await readWorld(ctx.gmToken);
    const storedBefore = (before["Actor"] ?? []).find((doc) => doc["_id"] === informante);
    expect(JSON.stringify(storedBefore)).toContain("knowledge");

    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Actor",
      ids: [informante],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    // Nenhum documento que o mundo ainda entrega cita o ator excluído — nem um
    // token, nem uma exceção de conhecimento, nem uma pasta.
    const world = await readWorld(ctx.gmToken);
    for (const [documentType, documents] of Object.entries(world)) {
      for (const doc of documents) {
        expect(
          JSON.stringify(doc).includes(informante),
          `${documentType}/${String(doc["_id"])} ainda cita o ator excluído`,
        ).toBe(false);
      }
    }
  });
});
