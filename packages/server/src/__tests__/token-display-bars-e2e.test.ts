/**
 * REQ-CNV-089 end to end: `displayBars` survives the REAL wire paths, not just
 * the schemas in isolation.
 *
 * `tokenDisplayBarsSurvives.test.ts` parses the two schemas directly, which
 * proves the field is DECLARED. It cannot prove the field crosses the socket,
 * the deep-merge engine and SQLite and comes back — and that is precisely where
 * `grid` was lost (docs/lessons.md): the schema was fine, the write path was
 * not. The two production paths are asymmetric, and only one of them is
 * obviously dangerous:
 *
 *   - CREATE: `doc:create` with `documentType: "Token"` + `parent: Scene`
 *     validates each token with the STRICT `TokenDocumentSchema`, which drops
 *     every undeclared key.
 *   - UPDATE: the token config dialog sends a SCENE `doc:update` with a
 *     `tokens.<id>.<field>` dot-path (see TokenConfigDialog.svelte), so the
 *     field travels through the deep-merge engine and `SceneSchema.tokens`,
 *     a loose record today.
 *
 * A field can therefore be accepted on update and erased on create — the exact
 * shape of "it worked when I edited it, it was gone after a reload".
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
import { PROTOCOL_VERSION, tokenDiffPath } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "display_bars_world";
  const dataDir = join(
    tmpdir(),
    `fusion-display-bars-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
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
      worldTitle: "Display Bars World",
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

  return { dataDir, fusionDb, bootResult, port, worldId, gmToken: gmLogin.accessToken };
}

function connectClient(ctx: Ctx): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: { token: ctx.gmToken, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
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
 * Reconnect from scratch and read the scene out of the join snapshot — the
 * only reading that proves the value came back out of SQLite rather than out
 * of the handler's own return value.
 */
async function sceneFromFreshSnapshot(ctx: Ctx, sceneId: string): Promise<Record<string, unknown>> {
  const socket = connectClient(ctx);
  const scene = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("no resync:full arrived"));
    }, 8000);
    socket.on("op", (env: Record<string, unknown>) => {
      if (env["type"] !== "resync:full") return;
      clearTimeout(timer);
      const payload = env["payload"] as { snapshot?: Record<string, unknown> | null };
      const documents = payload.snapshot?.["documents"] as
        | Record<string, Record<string, unknown>[]>
        | undefined;
      const found = (documents?.["Scene"] ?? []).find((s) => s["_id"] === sceneId);
      if (!found) {
        reject(new Error(`scene ${sceneId} absent from snapshot`));
        return;
      }
      resolve(found);
    });
    socket.once("connect_error", reject);
    socket.connect();
  });
  socket.disconnect();
  return scene;
}

function tokensOf(scene: Record<string, unknown>): Record<string, unknown>[] {
  const tokens = scene["tokens"];
  return Array.isArray(tokens) ? (tokens as Record<string, unknown>[]) : [];
}

// ---------------------------------------------------------------------------

describe("displayBars survives the real wire paths (REQ-CNV-089)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let sceneId = "";

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx);
    gm.connect();
    await new Promise<void>((resolve, reject) => {
      gm.once("connect", resolve);
      gm.once("connect_error", reject);
    });

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Sala das barras" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("the CREATE path keeps a non-default displayBars and its bar attribute", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [
        {
          name: "Goblin",
          x: 100,
          y: 100,
          bar1: { attribute: "attributes.hp" },
          displayBars: "hoverAll",
        },
      ],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(true);

    const created = (
      (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0];
    expect(created?.["displayBars"]).toBe("hoverAll");

    // ...and again out of persistence, on a connection that never saw the ack.
    const scene = await sceneFromFreshSnapshot(ctx, sceneId);
    const token = tokensOf(scene).find((t) => t["name"] === "Goblin");
    expect(token?.["displayBars"]).toBe("hoverAll");
    expect(token?.["bar1"]).toEqual({ attribute: "attributes.hp" });
  }, 30000);

  it("the CREATE path back-fills the default for a token that omits it", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "Sem barras", x: 300, y: 300 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(true);

    const scene = await sceneFromFreshSnapshot(ctx, sceneId);
    const token = tokensOf(scene).find((t) => t["name"] === "Sem barras");
    expect(token?.["displayBars"]).toBe("observer");
  }, 30000);

  it("the UPDATE path (the embedded Token doc:update) persists it", async () => {
    const before = await sceneFromFreshSnapshot(ctx, sceneId);
    const tokenId = tokensOf(before).find((t) => t["name"] === "Goblin")?.["_id"] as string;
    expect(typeof tokenId).toBe("string");

    // Exactly the payload tokenController.updateToken builds — the shape the
    // token drag and the tile panel already use.
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { displayBars: "never", bar1: { attribute: "resources.focus" } },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const after = await sceneFromFreshSnapshot(ctx, sceneId);
    const token = tokensOf(after).find((t) => t["_id"] === tokenId);
    expect(token?.["displayBars"]).toBe("never");
    expect(token?.["bar1"]).toEqual({ attribute: "resources.focus" });
    // The rest of the token must not be collateral damage of the merge.
    expect(token?.["name"]).toBe("Goblin");
    expect(token?.["x"]).toBe(100);
  }, 30000);

  it("a Scene doc:update with tokens.<id>.<field> dot-paths is NOT a wire format", async () => {
    // The dialog used to save this way and silently never persisted anything:
    // the deep-merge engine turns `tokens` into an object keyed by id, and
    // SceneSchema rejects the op. Asserted here so nobody "simplifies"
    // tokenController back into a Scene diff — `tokenDiffPath` is for the
    // client's own optimistic merge, not for the socket.
    const before = await sceneFromFreshSnapshot(ctx, sceneId);
    const tokenId = tokensOf(before).find((t) => t["name"] === "Goblin")?.["_id"] as string;

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { [tokenDiffPath(tokenId, "displayBars")]: "always" } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");

    // ...and nothing was written.
    const after = await sceneFromFreshSnapshot(ctx, sceneId);
    expect(tokensOf(after).find((t) => t["_id"] === tokenId)?.["displayBars"]).toBe("never");
  }, 30000);

  it("rejects a displayBars level outside the five canonical ones (DEC-CNV-15)", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "Inválido", x: 0, y: 0, displayBars: "owner" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  }, 30000);
});
