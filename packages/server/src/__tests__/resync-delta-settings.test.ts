/**
 * HJ-RG / I5 (revisao adversarial do core#308) — the `resync:delta` replay must
 * answer to the same Setting allowlist as the live broadcast.
 *
 * Live path (`broadcastToWorld`, doc-handlers.ts): a `Setting` create/update
 * reaches a non-GAMEMASTER socket filtered to `PLAYER_READABLE_SETTING_KEYS`
 * (`isPlayerReadableSettingKey`), and a delete reaches it with empty `ids`
 * (REQ-GAV-034, DEC-CFG-05, REQ-CFG-070/071: GAMEMASTER STRICT — ASSISTANT does
 * not qualify). The replay path buffers the raw envelope, and used to hand it
 * back verbatim, so a player (or an ASSISTANT) who reconnected inside the buffer
 * window read `fusion.permissions` — chave e valor — que o caminho ao vivo
 * recusa. Reconnecting must not become the way to read a Setting the GM keeps
 * private.
 *
 * Drives the real socket handlers (`boot()` + socket.io clients) over BOTH doors
 * the delta leaves through: the reconnect (`auth.lastSeq`, `sendJoinSnapshot`)
 * and the explicit `resync:request` (`buildResyncRequestHandler`).
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

// A key OUTSIDE `PLAYER_READABLE_SETTING_KEYS` (the local part after the first
// ":" is what the allowlist checks) and one INSIDE it (HJ-09).
const PRIVATE_KEY = "fusion:fusion.permissions";
const PRIVATE_VALUE = "MARCADOR-SECRETO-DE-PERMISSAO";
const READABLE_KEY = "pf2e:campaign.trainedSkills";

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  tokens: { gm: string; assistant: string; player: string };
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "resync_delta_settings_world";
  const dataDir = join(
    tmpdir(),
    `fusion-resync-settings-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: assistant } = await authService.createUser({
    name: "ResyncSettingsAssistant",
    role: Role.ASSISTANT,
    password: "assistant-pass",
  });
  const { user: player } = await authService.createUser({
    name: "ResyncSettingsPlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const assistantLogin = await authService.login({
    userId: assistant.id,
    password: "assistant-pass",
    ip: "127.0.0.1",
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
      worldTitle: "Resync Delta Settings World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
    },
  });

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    tokens: {
      gm: gmLogin.accessToken,
      assistant: assistantLogin.accessToken,
      player: playerLogin.accessToken,
    },
  };
}

function connectClient(ctx: Ctx, token: string, lastSeq?: number): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: {
      token,
      protocolVersion: PROTOCOL_VERSION,
      ...(lastSeq === undefined ? {} : { lastSeq }),
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
    const timer = setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** Connect and resolve with the first resync envelope plus the seq the client holds after it. */
async function connectAndSync(
  ctx: Ctx,
  token: string,
  lastSeq?: number,
): Promise<{ socket: ClientSocket; envelope: Record<string, unknown>; seq: number }> {
  const socket = connectClient(ctx, token, lastSeq);
  const synced = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no resync envelope")), 8000);
    socket.on("op", (env: Record<string, unknown>) => {
      if (env["type"] === "resync:full" || env["type"] === "resync:delta") {
        clearTimeout(timer);
        resolve(env);
      }
    });
  });
  socket.connect();
  await waitForConnect(socket);
  const envelope = await synced;
  return { socket, envelope, seq: envelope["seq"] as number };
}

interface SettingTraffic {
  /** `key`s carried by Setting create/update ops. */
  keys: string[];
  /** ids carried by Setting delete ops. */
  deletedIds: string[];
  /** The whole delta, serialized — the sweep that catches a shape this helper does not know. */
  raw: string;
}

function settingTraffic(deltaPayload: Record<string, unknown>): SettingTraffic {
  const ops = deltaPayload["ops"] as Record<string, unknown>[];
  const keys: string[] = [];
  const deletedIds: string[] = [];
  for (const op of ops) {
    const payload = op["payload"] as Record<string, unknown> | undefined;
    if (!payload || payload["documentType"] !== "Setting") continue;
    if (op["type"] === "doc:delete") {
      deletedIds.push(...(payload["ids"] as string[]));
    } else {
      for (const doc of payload["documents"] as Record<string, unknown>[]) {
        keys.push(doc["key"] as string);
      }
    }
  }
  return { keys, deletedIds, raw: JSON.stringify(deltaPayload) };
}

describe("resync:delta replays Setting ops through the live allowlist (I5, REQ-GAV-034)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  /** seq the offline viewers held when they dropped. */
  let heldSeq: number;
  let privateId: string;
  let doomedId: string;
  let readableId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    const initial = await connectAndSync(ctx, ctx.tokens.gm);
    gm = initial.socket;
    heldSeq = initial.seq;

    // Everything below happens while the player and the ASSISTANT are offline.
    const created = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [
        { key: PRIVATE_KEY, value: { floor: PRIVATE_VALUE } },
        { key: "fusion:world.doomed", value: PRIVATE_VALUE },
        { key: READABLE_KEY, value: ["arcana", "occultism"] },
      ],
    });
    expect(created["ok"]).toBe(true);
    const docs = (created["result"] as { documents: Array<{ _id: string; key: string }> })
      .documents;
    privateId = docs.find((d) => d.key === PRIVATE_KEY)!._id;
    doomedId = docs.find((d) => d.key === "fusion:world.doomed")!._id;
    readableId = docs.find((d) => d.key === READABLE_KEY)!._id;

    const updated = await sendOp(gm, "doc:update", {
      documentType: "Setting",
      updates: [{ _id: privateId, diff: { value: { floor: `${PRIVATE_VALUE}-2` } } }],
    });
    expect(updated["ok"]).toBe(true);
    const deleted = await sendOp(gm, "doc:delete", {
      documentType: "Setting",
      ids: [doomedId],
    });
    expect(deleted["ok"]).toBe(true);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  async function deltaViaReconnect(token: string): Promise<Record<string, unknown>> {
    const { socket, envelope } = await connectAndSync(ctx, token, heldSeq);
    socket.disconnect();
    // Must be a genuine delta, not a fall-through to resync:full (which never carries Settings).
    expect(envelope["type"]).toBe("resync:delta");
    return envelope["payload"] as Record<string, unknown>;
  }

  async function deltaViaRequest(token: string): Promise<Record<string, unknown>> {
    const { socket } = await connectAndSync(ctx, token);
    const ack = await sendOp(socket, "resync:request", { lastSeq: heldSeq });
    socket.disconnect();
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { type: string; payload: Record<string, unknown> };
    expect(result.type).toBe("delta");
    return result.payload;
  }

  const doors: Array<[string, (token: string) => Promise<Record<string, unknown>>]> = [
    ["reconnect with lastSeq", (t) => deltaViaReconnect(t)],
    ["resync:request", (t) => deltaViaRequest(t)],
  ];

  describe.each(doors)("via %s", (_label, fetchDelta) => {
    it("PLAYER gets the allowlisted Setting and nothing else", async () => {
      const traffic = settingTraffic(await fetchDelta(ctx.tokens.player));
      expect(traffic.keys).toContain(READABLE_KEY);
      expect(traffic.keys).not.toContain(PRIVATE_KEY);
      expect(traffic.keys).not.toContain("fusion:world.doomed");
      // Deletes are blanked, exactly like the live broadcast.
      expect(traffic.deletedIds).toEqual([]);
      // Sweep: neither the key, the value, nor the ids survive anywhere in the serialized delta.
      expect(traffic.raw).not.toContain("fusion.permissions");
      expect(traffic.raw).not.toContain(PRIVATE_VALUE);
      expect(traffic.raw).not.toContain(privateId);
      expect(traffic.raw).not.toContain(doomedId);
      expect(traffic.raw).toContain(readableId);
    });

    it("ASSISTANT is filtered like a player — Setting is GAMEMASTER-strict, not privileged", async () => {
      const traffic = settingTraffic(await fetchDelta(ctx.tokens.assistant));
      expect(traffic.keys).toContain(READABLE_KEY);
      expect(traffic.keys).not.toContain(PRIVATE_KEY);
      expect(traffic.deletedIds).toEqual([]);
      expect(traffic.raw).not.toContain("fusion.permissions");
      expect(traffic.raw).not.toContain(PRIVATE_VALUE);
      expect(traffic.raw).not.toContain(privateId);
      expect(traffic.raw).not.toContain(doomedId);
    });

    it("GAMEMASTER still receives every Setting op, deletes included", async () => {
      const traffic = settingTraffic(await fetchDelta(ctx.tokens.gm));
      expect(traffic.keys).toEqual(expect.arrayContaining([PRIVATE_KEY, READABLE_KEY]));
      expect(traffic.keys).toContain("fusion:world.doomed");
      expect(traffic.deletedIds).toEqual([doomedId]);
      expect(traffic.raw).toContain(PRIVATE_VALUE);
    });
  });
});
