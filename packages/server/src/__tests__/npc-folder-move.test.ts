/**
 * npc-folder-move.test.ts — moving a non-playable between folders, on the wire
 * (spec 42 §5.3, G071).
 *
 * REQ-NPC-028 asks for two gestures in the client; both end in the SAME server
 * operation, an ordinary `doc:update` of the actor's `folder`. What this file
 * proves is the half the client cannot: that the server really stores the new
 * folder, that it tells every client on the same delta pipe (RNF-NPC-04 — nobody
 * has to reload), and above all that REQ-NPC-029's "Sem pasta" is a real
 * destination — `folder: null` must be WRITTEN, not merged away, or an actor
 * dropped there would keep pointing at the folder it just left.
 *
 * Everything is asserted on the payload the socket carries and on a fresh join
 * snapshot, never on a client-side view.
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
}

let ctx: Ctx;
let gmSocket: ClientSocket;

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

/** Everything the server currently holds, read through a fresh GM join. */
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

async function createFolder(name: string, parentId: string | null): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Folder",
    data: [{ name, type: "Actor", parentId, sort: 0 }],
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  return docs[0]!["_id"] as string;
}

async function createNpc(name: string, folderId: string | null): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type: "npc", folder: folderId, ownership: { default: 0 }, flags: {} }],
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  return docs[0]!["_id"] as string;
}

/** The single actor as the server hands it out on a fresh join. */
async function storedActor(actorId: string): Promise<Record<string, unknown> | undefined> {
  const world = await readWorld(ctx.gmToken);
  return (world["Actor"] ?? []).find((doc) => doc["_id"] === actorId);
}

async function moveActor(actorId: string, folder: string | null): Promise<Record<string, unknown>> {
  return sendOp(gmSocket, "doc:update", {
    documentType: "Actor",
    updates: [{ _id: actorId, diff: { folder } }],
  });
}

beforeAll(async () => {
  const worldId = "npc-move-world";
  const dataDir = makeTempDir(worldId);
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

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
      worldTitle: "NPC Move World",
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
  };

  gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
  gmSocket.connect();
  await waitForConnect(gmSocket);
}, 30_000);

afterAll(async () => {
  gmSocket?.disconnect();
  if (!ctx) return;
  await ctx.bootResult.shutdown();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REQ-NPC-028: the move both gestures ask for is one ordinary doc:update", () => {
  it("REQ-NPC-028: the actor lands in the destination folder, and nothing else changes", async () => {
    const bosque = await createFolder("Bosque", null);
    const taverna = await createFolder("Taverna", null);
    const lobo = await createNpc("Lobo", bosque);

    const ack = await moveActor(lobo, taverna);
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const stored = await storedActor(lobo);
    expect(stored?.["folder"]).toBe(taverna);
    // The move is a move: the actor itself was not rewritten.
    expect(stored?.["name"]).toBe("Lobo");
    expect(stored?.["type"]).toBe("npc");
  });

  it("REQ-NPC-028: every client is told on the delta pipe, so no list is reloaded", async () => {
    const origem = await createFolder("Origem", null);
    const destino = await createFolder("Destino", null);
    const urso = await createNpc("Urso", origem);

    const seen: Record<string, unknown>[] = [];
    const listener = (env: Record<string, unknown>): void => {
      seen.push(env);
    };
    gmSocket.on("op", listener);

    expect((await moveActor(urso, destino))["ok"]).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    gmSocket.off("op", listener);

    const update = seen.find(
      (env) =>
        env["type"] === "doc:update" &&
        (env["payload"] as Record<string, unknown>)["documentType"] === "Actor",
    );
    expect(update).toBeDefined();
    const docs = (update!["payload"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    // RNF-NPC-04: the new folder arrives as a delta, not as a reason to refetch.
    expect(docs.some((doc) => doc["_id"] === urso && doc["folder"] === destino)).toBe(true);
  });
});

describe('REQ-NPC-029: "Sem pasta" is a destination the server really writes', () => {
  it("REQ-NPC-029: moving out of every folder stores a literal null", async () => {
    const pasta = await createFolder("Pasta", null);
    const guarda = await createNpc("Guarda", pasta);
    expect((await storedActor(guarda))?.["folder"]).toBe(pasta);

    const ack = await moveActor(guarda, null);
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const stored = await storedActor(guarda);
    // Not the old id, and not an absent key: the actor belongs to no folder.
    expect(stored?.["folder"]).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(stored ?? {}, "folder")).toBe(true);
  });

  it("REQ-NPC-029: an actor with no folder can be moved into one, and back again", async () => {
    const abrigo = await createFolder("Abrigo", null);
    const errante = await createNpc("Errante", null);

    expect((await moveActor(errante, abrigo))["ok"]).toBe(true);
    expect((await storedActor(errante))?.["folder"]).toBe(abrigo);

    expect((await moveActor(errante, null))["ok"]).toBe(true);
    expect((await storedActor(errante))?.["folder"]).toBeNull();
  });
});
