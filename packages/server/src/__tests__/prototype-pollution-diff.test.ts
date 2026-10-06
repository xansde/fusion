/**
 * Prototype pollution through client diffs (fix onda 5). `applyDotPathDiff` expands dotted keys from
 * the client into nested objects; a `__proto__`, `constructor` or `prototype` segment — in a dotted
 * key or as a nested object key in the value — must be refused (VALIDATION_FAILED, nothing applied)
 * on every doc:update entry point: primary, embedded Token/Item, and the token update branch.
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
import { DocumentStore } from "../documents/store.js";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors player-familiar-create.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return (() => {
    const dir = join(
      tmpdir(),
      `fusion-proto-pollution-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  })();
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "proto_pollution_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Proto Pollution World",
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
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    // Reads directly from the same underlying DB the handler wrote to —
    // independent of the socket/ack layer under test.
    store: new DocumentStore({ db: fusionDb.raw }),
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
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

async function createActor(socket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(socket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type: "npc", system: {}, ownership: { default: 0 } }],
  });
  if (!ack["ok"]) throw new Error(`Failed to create actor: ${JSON.stringify(ack)}`);
  return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
}

// Parsed from text so `__proto__` is an OWN key, exactly as it arrives from a socket.
const MALICIOUS_DIFFS: Array<[string, string]> = [
  ["dotted __proto__", '{"__proto__.polluted": true}'],
  ["dotted mid-path __proto__", '{"a.__proto__.polluted": true}'],
  ["dotted constructor.prototype", '{"constructor.prototype.polluted": true}'],
  ["dotted prototype", '{"system.prototype.polluted": true}'],
  ["nested __proto__", '{"a": {"__proto__": {"polluted": true}}}'],
  ["nested constructor.prototype", '{"a": {"constructor": {"prototype": {"polluted": true}}}}'],
  ["nested inside an array", '{"a": [{"__proto__": {"polluted": true}}]}'],
  ["dotted key with nested value", '{"system.x": {"__proto__": {"polluted": true}}}'],
];

describe("prototype pollution through doc:update diffs", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let actorId = "";
  let sceneId = "";
  let tokenId = "";

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
    actorId = await createActor(gm, "Target");
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Pollution Scene" }],
    });
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "T", actorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tokens = (
      (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>
    )["tokens"] as Array<{ _id: string }>;
    tokenId = tokens[0]!._id;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  for (const [label, json] of MALICIOUS_DIFFS) {
    it(`primary doc:update refuses ${label}`, async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: actorId, diff: JSON.parse(json) as Record<string, unknown> }],
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(ctx.store.get("actors", actorId), "a")).toBe(
        false,
      );
    });

    it(`embedded Token doc:update refuses ${label}`, async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: tokenId,
            diff: JSON.parse(json) as Record<string, unknown>,
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });
  }

  it("a legitimate dotted and nested diff still applies", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "Renamed", "system.notes": { text: "ok" } } }],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(ctx.store.get("actors", actorId)["name"]).toBe("Renamed");
  });
});
