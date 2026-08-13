/**
 * Map pins reveal per player — through a real server, real sockets, real auth.
 *
 * The unit test next door (note-redaction.test.ts) proves the redaction
 * function is correct. It cannot prove the emission paths CALL it, and that is
 * the failure this project has already paid for once: a rule asserted only
 * where it is defined is a rule nobody has walked through (see issue #48 — a
 * sweep that checked the derivation against its own table while 60 defects
 * lived under it).
 *
 * So this walks the two paths a player actually receives a scene through:
 *
 *   1. the JOIN SNAPSHOT — what a player sees when they open the table
 *   2. the LIVE BROADCAST — what lands mid-session when the GM reveals
 *
 * and asserts the thing that matters at the table: two players connected to
 * the same world, looking at the same map, receive different pins.
 *
 * REQ-DOC-056/057/058, REQ-MREG-005/006/009.
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
import { PROTOCOL_VERSION, OwnershipLevel } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  tobiasId: string;
  tobiasToken: string;
  comedorToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "note_reveal_world";
  const dataDir = join(
    tmpdir(),
    `fusion-note-reveal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: tobias } = await authService.createUser({
    name: "Tobias",
    role: Role.PLAYER,
    password: "tobias-pass",
  });
  const { user: comedor } = await authService.createUser({
    name: "Comedor",
    role: Role.PLAYER,
    password: "comedor-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const tobiasLogin = await authService.login({
    userId: tobias.id,
    password: "tobias-pass",
    ip: "127.0.0.1",
  });
  const comedorLogin = await authService.login({
    userId: comedor.id,
    password: "comedor-pass",
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
      worldTitle: "Note Reveal World",
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

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    tobiasId: tobias.id,
    tobiasToken: tobiasLogin.accessToken,
    comedorToken: comedorLogin.accessToken,
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

/**
 * Join as this user and return the pins their JOIN SNAPSHOT carries.
 *
 * A fresh connection is the honest way to read a snapshot: it is exactly what
 * a player's client does when they open the table, and it exercises
 * `buildSnapshot` for that userId rather than a test-only shortcut.
 */
async function snapshotNotes(
  ctx: Ctx,
  token: string,
  sceneId: string,
): Promise<Record<string, unknown>[]> {
  const socket = connectClient(ctx.port, ctx.worldId, token);
  const arrived = new Promise<Record<string, unknown>[]>((resolve, reject) => {
    socket.on("op", (env: Record<string, unknown>) => {
      if (env["type"] !== "resync:full") return;
      const payload = env["payload"] as Record<string, unknown>;
      const snap = payload["snapshot"] as Record<string, unknown> | null;
      if (!snap) return;
      const documents = snap["documents"] as Record<string, unknown[]>;
      const scenes = (documents["Scene"] ?? []) as Record<string, unknown>[];
      const scene = scenes.find((s) => s["_id"] === sceneId);
      resolve((scene?.["notes"] ?? []) as Record<string, unknown>[]);
    });
    setTimeout(() => {
      reject(new Error("Timeout waiting for join snapshot"));
    }, 8000);
  });
  socket.connect();
  await waitForConnect(socket);
  try {
    return await arrived;
  } finally {
    socket.disconnect();
  }
}

/** Wait for the next doc op that carries the scene, and return its pins. */
function nextSceneOpNotes(
  socket: ClientSocket,
  sceneId: string,
): Promise<Record<string, unknown>[]> {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const onOp = (env: Record<string, unknown>): void => {
      const type = env["type"];
      if (type !== "doc:update" && type !== "doc:create") return;
      const payload = env["payload"] as Record<string, unknown> | undefined;
      if (payload?.["documentType"] !== "Scene") return;
      const docs = (payload["documents"] ?? []) as Record<string, unknown>[];
      const scene = docs.find((d) => d["_id"] === sceneId);
      if (!scene) return;
      socket.off("op", onOp);
      resolve((scene["notes"] ?? []) as Record<string, unknown>[]);
    };
    socket.on("op", onOp);
    setTimeout(() => {
      socket.off("op", onOp);
      reject(new Error("Timeout waiting for scene op"));
    }, 8000);
  });
}

describe("map pins reveal per player", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let tobias: ClientSocket;
  let comedor: ClientSocket;
  let sceneId = "";
  let rumourPinId = "";

  beforeAll(async () => {
    ctx = await buildCtx();

    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    tobias = connectClient(ctx.port, ctx.worldId, ctx.tobiasToken);
    tobias.connect();
    await waitForConnect(tobias);

    comedor = connectClient(ctx.port, ctx.worldId, ctx.comedorToken);
    comedor.connect();
    await waitForConnect(comedor);

    // A region map: gridless, kilometres, no fog — the preset of REQ-MREG-001.
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [
        {
          name: "Vale de Godford",
          width: 4000,
          height: 3000,
          grid: { type: "gridless", size: 100, distance: 4, units: "km" },
          tokenVision: false,
          ownership: { default: OwnershipLevel.OBSERVER },
          flags: { fusion: { mapScale: "region" } },
        },
      ],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    tobias.disconnect();
    comedor.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("the GM drops a pin and it is born hidden from every player", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Note",
      data: [{ x: 1200, y: 850, text: "Ruínas de Godford", icon: "/assets/icons/ruin.webp" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(true);
    rumourPinId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    expect(await snapshotNotes(ctx, ctx.tobiasToken, sceneId)).toHaveLength(0);
  });

  it("a player may not place a pin of their own", async () => {
    const ack = await sendOp(tobias, "doc:create", {
      documentType: "Note",
      data: [{ x: 10, y: 10, text: "atalho que eu inventei" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(false);
  });

  it("revealing as a rumour reaches that player live — position only", async () => {
    const landed = nextSceneOpNotes(tobias, sceneId);

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Note",
      updates: [
        {
          _id: rumourPinId,
          diff: {
            ownership: { default: OwnershipLevel.NONE, [ctx.tobiasId]: OwnershipLevel.LIMITED },
          },
          embedded: { type: "Note", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const notes = await landed;
    expect(notes).toHaveLength(1);
    expect(notes[0]!["x"]).toBe(1200);
    expect(notes[0]!["y"]).toBe(850);
    // The rumour is a position and nothing else (REQ-DOC-057).
    expect(notes[0]!["text"]).toBeNull();
    expect(notes[0]!["icon"]).toBeNull();
    expect(notes[0]!["entryId"]).toBeNull();
  });

  it("the other player at the same table receives nothing at all", async () => {
    expect(await snapshotNotes(ctx, ctx.comedorToken, sceneId)).toHaveLength(0);
  });

  it("the rumour survives a reconnect: the snapshot is redacted too", async () => {
    const notes = await snapshotNotes(ctx, ctx.tobiasToken, sceneId);

    expect(notes).toHaveLength(1);
    expect(notes[0]!["text"]).toBeNull();
  });

  it("promoting to observer hands over the whole pin", async () => {
    const landed = nextSceneOpNotes(tobias, sceneId);

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Note",
      updates: [
        {
          _id: rumourPinId,
          diff: {
            ownership: { default: OwnershipLevel.NONE, [ctx.tobiasId]: OwnershipLevel.OBSERVER },
          },
          embedded: { type: "Note", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const notes = await landed;
    expect(notes).toHaveLength(1);
    expect(notes[0]!["text"]).toBe("Ruínas de Godford");
    expect(notes[0]!["icon"]).toBe("/assets/icons/ruin.webp");
  });

  it("the GM always sees the authored pin", async () => {
    const notes = await snapshotNotes(ctx, ctx.gmToken, sceneId);

    expect(notes).toHaveLength(1);
    expect(notes[0]!["text"]).toBe("Ruínas de Godford");
  });
});
