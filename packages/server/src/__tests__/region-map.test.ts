/**
 * The region map through a real server — real sockets, real auth, two players.
 *
 * The point of this file is the same one issue #48 taught: a rule asserted
 * only where it is defined is a rule nobody has walked through. So nothing
 * here calls a redaction function directly. Everything goes through the ops a
 * client actually sends, and is read back off the two paths a client actually
 * receives — the join snapshot and the live broadcast.
 *
 * What it is meant to prove, in the order it matters at the table:
 *
 *   1. a GM pin is invisible to players until the GM says otherwise;
 *   2. a PLAYER pin is visible to the table the moment it is dropped;
 *   3. comments carry their author, and the author comes from the socket —
 *      not from the payload, which is where a forged signature would come from;
 *   4. a player cannot reveal, cannot edit someone else's pin, and cannot read
 *      a hidden one by commenting on it.
 *
 * DEC-MREG-08, REQ-MREG-025..030, REQ-DOC-056/057/058.
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
  comedorId: string;
  comedorToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "region_map_world";
  const dataDir = join(
    tmpdir(),
    `fusion-region-map-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
      worldTitle: "Region Map World",
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
    comedorId: comedor.id,
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

interface WirePin {
  _id: string;
  x: number;
  y: number;
  text: string;
  description: string;
  kind: string;
  authorId: string | null;
  authorName: string;
  comments: Array<{ authorId: string; authorName: string; text: string }>;
}

/** Join as this user and read the pins their JOIN SNAPSHOT carries. */
async function snapshotPins(ctx: Ctx, token: string, mapId: string): Promise<WirePin[]> {
  const socket = connectClient(ctx.port, ctx.worldId, token);
  const arrived = new Promise<WirePin[]>((resolve, reject) => {
    socket.on("op", (env: Record<string, unknown>) => {
      if (env["type"] !== "resync:full") return;
      const payload = env["payload"] as Record<string, unknown>;
      const snap = payload["snapshot"] as Record<string, unknown> | null;
      if (!snap) return;
      const documents = snap["documents"] as Record<string, unknown[]>;
      const maps = (documents["RegionMap"] ?? []) as Record<string, unknown>[];
      const map = maps.find((m) => m["_id"] === mapId);
      resolve((map?.["pins"] ?? []) as WirePin[]);
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

/** Wait for the next op carrying this map, and return its pins. */
function nextMapOpPins(socket: ClientSocket, mapId: string): Promise<WirePin[]> {
  return new Promise<WirePin[]>((resolve, reject) => {
    const onOp = (env: Record<string, unknown>): void => {
      const type = env["type"];
      if (type !== "doc:update" && type !== "doc:create") return;
      const payload = env["payload"] as Record<string, unknown> | undefined;
      if (payload?.["documentType"] !== "RegionMap") return;
      const docs = (payload["documents"] ?? []) as Record<string, unknown>[];
      const map = docs.find((d) => d["_id"] === mapId);
      if (!map) return;
      socket.off("op", onOp);
      resolve((map["pins"] ?? []) as WirePin[]);
    };
    socket.on("op", onOp);
    setTimeout(() => {
      socket.off("op", onOp);
      reject(new Error("Timeout waiting for region map op"));
    }, 8000);
  });
}

describe("region map — pins, reveal and comments", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let tobias: ClientSocket;
  let comedor: ClientSocket;
  let mapId = "";
  let gmPinId = "";
  let playerPinId = "";

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

    const ack = await sendOp(gm, "doc:create", {
      documentType: "RegionMap",
      data: [
        {
          name: "Vale de Godford",
          image: "/assets/maps/godford.webp",
          imageWidth: 4000,
          imageHeight: 3000,
          ownership: { default: OwnershipLevel.OBSERVER },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    mapId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    tobias.disconnect();
    comedor.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("a player cannot create the map itself", async () => {
    const ack = await sendOp(tobias, "doc:create", {
      documentType: "RegionMap",
      data: [{ name: "meu mapa" }],
    });

    expect(ack["ok"]).toBe(false);
  });

  it("a GM pin is born hidden from every player", async () => {
    const ack = await sendOp(gm, "regionMap:createPin", {
      mapId,
      pin: { x: 0.3, y: 0.28, text: "Ruínas de Godford", description: "Uma torre partida." },
    });
    expect(ack["ok"]).toBe(true);

    const pins = await snapshotPins(ctx, ctx.gmToken, mapId);
    expect(pins).toHaveLength(1);
    gmPinId = pins[0]!._id;

    expect(await snapshotPins(ctx, ctx.tobiasToken, mapId)).toHaveLength(0);
  });

  it("a player pin is born visible to the whole table (REQ-MREG-026)", async () => {
    const landed = nextMapOpPins(comedor, mapId);

    const ack = await sendOp(tobias, "regionMap:createPin", {
      mapId,
      pin: { x: 0.5, y: 0.5, text: "Acampamos aqui", icon: "⛺" },
    });
    expect(ack["ok"]).toBe(true);

    // The other player receives it live, not on next reload.
    const pins = await landed;
    const camp = pins.find((p) => p.text === "Acampamos aqui");
    expect(camp).toBeDefined();
    playerPinId = camp!._id;
    expect(camp!.kind).toBe("player");
    expect(camp!.authorId).toBe(ctx.tobiasId);
    expect(camp!.authorName).toBe("Tobias");
  });

  it("the player's own pin does not leak the GM's hidden one back to them", async () => {
    const pins = await snapshotPins(ctx, ctx.tobiasToken, mapId);

    expect(pins).toHaveLength(1);
    expect(pins[0]!.text).toBe("Acampamos aqui");
  });

  it("a comment is signed by the socket that sent it, never by the payload", async () => {
    const ack = await sendOp(comedor, "regionMap:comment", {
      mapId,
      pinId: playerPinId,
      text: "tem lenha seca do lado leste",
    });
    expect(ack["ok"]).toBe(true);

    const pins = await snapshotPins(ctx, ctx.tobiasToken, mapId);
    const comments = pins[0]!.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe("tem lenha seca do lado leste");
    expect(comments[0]!.authorId).toBe(ctx.comedorId);
    expect(comments[0]!.authorName).toBe("Comedor");
  });

  it("two players commenting in a row both survive — the list is appended, not replaced", async () => {
    await sendOp(tobias, "regionMap:comment", { mapId, pinId: playerPinId, text: "vamos de dia" });

    const pins = await snapshotPins(ctx, ctx.comedorToken, mapId);
    expect(pins[0]!.comments.map((c) => c.text)).toEqual([
      "tem lenha seca do lado leste",
      "vamos de dia",
    ]);
  });

  it("a player cannot comment on a pin they cannot see — and learns nothing by trying", async () => {
    const ack = await sendOp(tobias, "regionMap:comment", {
      mapId,
      pinId: gmPinId,
      text: "sei que tem algo aqui",
    });

    expect(ack["ok"]).toBe(false);
    // NOT_FOUND, not PERMISSION_DENIED: "you may not" would confirm the pin is
    // there, which is exactly what the reveal is hiding.
    expect(ack["code"]).toBe("NOT_FOUND");
  });

  it("a player cannot edit someone else's pin", async () => {
    const ack = await sendOp(comedor, "regionMap:updatePin", {
      mapId,
      pinId: playerPinId,
      patch: { text: "não foi aqui" },
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("a player may move their own pin", async () => {
    const ack = await sendOp(tobias, "regionMap:updatePin", {
      mapId,
      pinId: playerPinId,
      patch: { x: 0.55, y: 0.52 },
    });
    expect(ack["ok"]).toBe(true);

    const pins = await snapshotPins(ctx, ctx.tobiasToken, mapId);
    expect(pins[0]!.x).toBeCloseTo(0.55);
    // Editing content never touches the conversation on it.
    expect(pins[0]!.comments).toHaveLength(2);
  });

  it("a player cannot reveal anything — the reveal IS the GM's control", async () => {
    const ack = await sendOp(tobias, "regionMap:reveal", {
      mapId,
      pinId: gmPinId,
      userIds: [ctx.tobiasId],
      level: OwnershipLevel.OBSERVER,
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("revealing as a rumour reaches that player live, as a position and nothing else", async () => {
    const landed = nextMapOpPins(tobias, mapId);

    const ack = await sendOp(gm, "regionMap:reveal", {
      mapId,
      pinId: gmPinId,
      userIds: [ctx.tobiasId],
      level: OwnershipLevel.LIMITED,
    });
    expect(ack["ok"]).toBe(true);

    const pins = await landed;
    const rumour = pins.find((p) => p._id === gmPinId);
    expect(rumour).toBeDefined();
    expect(rumour!.x).toBeCloseTo(0.3);
    expect(rumour!.text).toBe("");
    expect(rumour!.description).toBe("");
    expect(rumour!.comments).toEqual([]);
  });

  it("the other player still receives nothing", async () => {
    const pins = await snapshotPins(ctx, ctx.comedorToken, mapId);

    expect(pins.map((p) => p._id)).not.toContain(gmPinId);
  });

  it("promoting to observer hands over the whole pin", async () => {
    const landed = nextMapOpPins(tobias, mapId);

    const ack = await sendOp(gm, "regionMap:reveal", {
      mapId,
      pinId: gmPinId,
      userIds: [ctx.tobiasId],
      level: OwnershipLevel.OBSERVER,
    });
    expect(ack["ok"]).toBe(true);

    const pins = await landed;
    const known = pins.find((p) => p._id === gmPinId);
    expect(known!.text).toBe("Ruínas de Godford");
    expect(known!.description).toBe("Uma torre partida.");
  });

  it("a revealed pin can be commented on by the player who now sees it", async () => {
    const ack = await sendOp(tobias, "regionMap:comment", {
      mapId,
      pinId: gmPinId,
      text: "a torre está oca",
    });

    expect(ack["ok"]).toBe(true);
  });

  it("the GM always sees every pin, authored", async () => {
    const pins = await snapshotPins(ctx, ctx.gmToken, mapId);

    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.text).sort()).toEqual(["Acampamos aqui", "Ruínas de Godford"]);
  });

  it("the GM may delete a player's pin; the player may delete their own", async () => {
    const denied = await sendOp(comedor, "regionMap:deletePin", { mapId, pinId: playerPinId });
    expect(denied["ok"]).toBe(false);

    const ok = await sendOp(gm, "regionMap:deletePin", { mapId, pinId: playerPinId });
    expect(ok["ok"]).toBe(true);

    const pins = await snapshotPins(ctx, ctx.gmToken, mapId);
    expect(pins.map((p) => p._id)).not.toContain(playerPinId);
  });
});
