/**
 * Knowledge as the NPCs tab meets it, over the real socket (spec 42 §5.9, G077).
 *
 * Covers REQ-NPC-070 (the counts a row shows exist only where the knowledge map is
 * delivered — the Mestre's payload, never a player's), REQ-NPC-071 (no path from
 * this tab writes knowledge: `doc:update` on the flag is refused) and REQ-NPC-073
 * (an edit made in the "Quem conhece quem" window propagates as a DELTA to each
 * affected user, whichever tab opened the window — it is the same
 * `actor:setKnowledge` op either way).
 *
 * Every assertion reads the ACK or the broadcast PAYLOAD the socket actually
 * received, never a screen. The subject is an actor of THIS tab: subtype `npc`,
 * filed in a `Folder`.
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
import { PROTOCOL_VERSION, KnowledgeState, readKnowledgeMap } from "@fusion/shared";
import type { KnowledgeMap } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  // Data dir lives in the OS temp dir, never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-npc-knowledge-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "npc_knowledge_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "NpcKnowledgePlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "NPC Knowledge World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e",
      systemModule: pf2eSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  return {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerId: player.id,
  };
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for op: ${type}`));
    }, 8000);
  });
}

interface OpEnvelope {
  type: string;
  seq?: number;
  payload: {
    documentType?: string;
    documents?: Record<string, unknown>[];
  };
}

function collectOps(socket: ClientSocket): OpEnvelope[] {
  const ops: OpEnvelope[] = [];
  socket.on("op", (envelope: OpEnvelope) => ops.push(envelope));
  return ops;
}

async function waitForOp(
  ops: readonly OpEnvelope[],
  match: (envelope: OpEnvelope) => boolean,
  what: string,
): Promise<OpEnvelope> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const found = ops.find(match);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function docsOf(ack: Record<string, unknown>): Record<string, unknown>[] {
  const result = ack["result"] as { documents?: Record<string, unknown>[] } | undefined;
  return result?.documents ?? [];
}

function mapOf(doc: Record<string, unknown> | undefined): KnowledgeMap {
  return readKnowledgeMap(doc);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("NPCs tab and knowledge — REQ-NPC-070/071/073 over the real socket (G077)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let playerOps: OpEnvelope[];

  let characterId: string;
  let npcId: string;
  let folderId: string;

  async function create(documentType: string, data: Record<string, unknown>): Promise<string> {
    const ack = await sendOp(gm, "doc:create", { documentType, data: [data] });
    expect(ack["ok"]).toBe(true);
    const id = docsOf(ack)[0]?.["_id"];
    if (typeof id !== "string") throw new Error(`${documentType} create returned no _id`);
    return id;
  }

  function readFromStore(actorId: string): Record<string, unknown> {
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as
      | { data: string }
      | undefined;
    if (!row) throw new Error(`Actor ${actorId} not found in world.db`);
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);
    playerOps = collectOps(player);

    characterId = await create("Actor", {
      name: "Fofurinha",
      type: "character",
      ownership: { default: 0, [ctx.playerId]: 3 },
    });
    folderId = await create("Folder", { name: "Aldeia", type: "Actor", parentId: null, sort: 0 });
    // An actor of THIS tab: a non-playable, filed in a folder of the tree.
    npcId = await create("Actor", {
      name: "Ferreiro",
      type: "npc",
      folder: folderId,
      ownership: { default: 0 },
    });
  }, 40000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-070 — the counts exist only where the map is delivered
  // -------------------------------------------------------------------------

  it("REQ-NPC-070: the Mestre's payload carries the map the row counts from", async () => {
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: npcId, exceptions: { [characterId]: KnowledgeState.Known } }],
    });
    expect(ack["ok"]).toBe(true);

    const stored = mapOf(readFromStore(npcId));
    expect(stored.exceptions[characterId]).toBe(KnowledgeState.Known);

    // What the Mestre's own socket got back is the whole document, map included:
    // that map, resolved over the table's characters, IS "2 conhecem, 1 entreviu".
    const returned = docsOf(ack).find((doc) => doc["_id"] === npcId);
    expect(mapOf(returned).exceptions[characterId]).toBe(KnowledgeState.Known);
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-073 — the edit propagates as a delta to each affected user
  // -------------------------------------------------------------------------

  it("REQ-NPC-073: raising knowledge reaches the affected user as a delta, with no reload", async () => {
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: npcId, exceptions: { [characterId]: KnowledgeState.Glimpsed } }],
    });
    expect(ack["ok"]).toBe(true);
    const seq = ack["seq"] as number;

    // No `resync:request` was sent and no page was reloaded: the delta travels the
    // same doc:update pipe as every other change, carrying the ack's own seq. The
    // op is `actor:setKnowledge` whichever tab's footer opened the window
    // (REQ-NPC-072), so this is the propagation both doors produce.
    const envelope = await waitForOp(
      playerOps,
      (e) => e.type === "doc:update" && e.seq === seq,
      "the knowledge delta on the player's socket",
    );
    expect(envelope.payload.documentType).toBe("Actor");
    expect((envelope.payload.documents ?? []).map((doc) => doc["_id"])).toContain(npcId);
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-071 — nothing this tab can send alters knowledge
  // -------------------------------------------------------------------------

  it("REQ-NPC-071: a doc:update on the knowledge flag is refused, and the map is untouched", async () => {
    const before = mapOf(readFromStore(npcId));

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: npcId,
          diff: { flags: { fusion: { knowledge: { general: 2, exceptions: {} } } } },
        },
      ],
    });

    expect(ack["ok"]).toBe(false);
    expect(mapOf(readFromStore(npcId))).toEqual(before);
  });

  it("REQ-NPC-071: a player cannot move knowledge about a non-playable at all", async () => {
    const before = mapOf(readFromStore(npcId));

    const ack = await sendOp(player, "actor:setKnowledge", {
      updates: [{ actorId: npcId, general: KnowledgeState.Known }],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(mapOf(readFromStore(npcId))).toEqual(before);
  });
});
