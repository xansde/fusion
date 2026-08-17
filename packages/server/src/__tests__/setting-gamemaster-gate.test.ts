/**
 * G106 (Fase 9 — Aba Configurações) — Setting document writes require
 * GAMEMASTER strictly (REQ-CFG-070, REQ-CFG-071), not the generic
 * `isRolePrivileged` threshold used everywhere else in doc-handlers.ts —
 * that threshold also admits ASSISTANT (role 3), a role slated for removal
 * by decision on 2026-08-15 (issue #133) but still present in the `Role`
 * enum today. Until the issue lands, the Setting path guards explicitly for
 * `role === GAMEMASTER`.
 *
 * Setting is the persistence target the Configurações aba's Mundo,
 * Permissões and Mods sections write through (REQ-CFG-071: world-scope
 * settings — and, per REQ-USR-009, permission overrides — are persisted as
 * `Setting` documents, the only world-config storage mechanism this
 * codebase has today).
 *
 * Drives the real doc:create / doc:update / doc:delete socket handlers
 * end-to-end (boot() + a real socket.io client), following the pattern of
 * expected-version.test.ts — the point is to prove the policy as the wire
 * actually enforces it, not to unit-call buildDoc*Handler directly.
 *
 * Coverage:
 *   - doc:create Setting: PLAYER and ASSISTANT refused, GAMEMASTER accepted
 *     and persisted (REQ-CFG-071).
 *   - doc:update Setting: PLAYER and ASSISTANT refused EVEN when granted
 *     OWNER ownership on the document — proves the guard runs before the
 *     generic ownership check, not that ownership merely happened to be
 *     absent. GAMEMASTER accepted, and the new value is visible in the
 *     store immediately after the ack — no separate "save" step exists on
 *     this path (REQ-CFG-080).
 *   - doc:delete Setting: PLAYER and ASSISTANT refused, GAMEMASTER accepted.
 *   - doc:create/update/delete User: refused for EVERY role, including
 *     GAMEMASTER — `User` is the same physical `users` table `auth/
 *     user-store.ts` uses for login, and the generic path had no guard for it
 *     at all (absent from GM_ONLY_CREATE_DELETE, no forbidden-type entry): a
 *     TRUSTED requester could `doc:create` a `{name, role: 4}` document and
 *     get back a passwordless GAMEMASTER account, joinable with no password
 *     (REQ-USR-018) — reproduced below with a TRUSTED user before the fix
 *     (REQ-USR-025..031, REQ-USR-030). `/api/users` (requireRole GAMEMASTER)
 *     is the one door.
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
import { DocumentStore, DocumentNotFoundError } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors expected-version.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return (() => {
    const dir = join(
      tmpdir(),
      `fusion-setting-gm-gate-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
  assistantToken: string;
  trustedToken: string;
  playerUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "setting_gm_gate_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "SettingGatePlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });
  // ASSISTANT (role 3) — extinct-pending role (issue #133): must be refused
  // by the same guard as PLAYER on Setting writes, unlike everywhere else in
  // doc-handlers.ts where `isRolePrivileged` treats it as privileged.
  const { user: assistant } = await authService.createUser({
    name: "SettingGateAssistant",
    role: Role.ASSISTANT,
    password: "assistant-pass",
  });
  // TRUSTED (role 2) — the role that reproduces the User-forgery finding: it
  // clears the generic TRUSTED+ floor doc:create otherwise uses for types
  // with no dedicated guard, which is exactly what made `documentType:
  // "User"` reachable before GENERIC_PATH_FORBIDDEN_TYPES covered it.
  const { user: trusted } = await authService.createUser({
    name: "SettingGateTrusted",
    role: Role.TRUSTED,
    password: "trusted-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  const assistantLogin = await authService.login({
    userId: assistant.id,
    password: "assistant-pass",
    ip: "127.0.0.1",
  });
  const trustedLogin = await authService.login({
    userId: trusted.id,
    password: "trusted-pass",
    ip: "127.0.0.1",
  });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Setting GM Gate World",
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
    store: new DocumentStore({ db: fusionDb.raw }),
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    assistantToken: assistantLogin.accessToken,
    trustedToken: trustedLogin.accessToken,
    playerUserId: player.id,
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Setting document writes require GAMEMASTER strictly (REQ-CFG-070, REQ-CFG-071)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let assistant: ClientSocket;
  let trusted: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    assistant = connectClient(ctx.port, ctx.worldId, ctx.assistantToken);
    trusted = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    gm.connect();
    player.connect();
    assistant.connect();
    trusted.connect();
    await Promise.all([
      waitForConnect(gm),
      waitForConnect(player),
      waitForConnect(assistant),
      waitForConnect(trusted),
    ]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    assistant?.disconnect();
    trusted?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // doc:create
  // -------------------------------------------------------------------------

  describe("doc:create", () => {
    it("PLAYER is refused (REQ-CFG-070)", async () => {
      const ack = await sendOp(player, "doc:create", {
        documentType: "Setting",
        data: [{ key: "world:test:playerCreate", value: 1 }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
      expect(String(ack["message"])).toContain("Gamemaster");
    });

    it("ASSISTANT (role 3) is refused — not privileged for Setting writes (REQ-CFG-070)", async () => {
      const ack = await sendOp(assistant, "doc:create", {
        documentType: "Setting",
        data: [{ key: "world:test:assistantCreate", value: 1 }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("GAMEMASTER is accepted and persisted as a Setting document (REQ-CFG-071)", async () => {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Setting",
        data: [{ key: "world:test:gmCreate", value: { enabled: true } }],
      });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as { documents: Array<{ _id: string; key: string }> };
      const doc = result.documents[0]!;
      expect(doc.key).toBe("world:test:gmCreate");

      const stored = ctx.store.get("settings", doc._id);
      expect(stored["key"]).toBe("world:test:gmCreate");
      expect(stored["value"]).toEqual({ enabled: true });
    });
  });

  // -------------------------------------------------------------------------
  // doc:update
  // -------------------------------------------------------------------------

  describe("doc:update", () => {
    let settingId: string;

    beforeAll(async () => {
      const createAck = await sendOp(gm, "doc:create", {
        documentType: "Setting",
        data: [{ key: "world:test:updateTarget", value: false }],
      });
      settingId = (createAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

      // Grant the player OWNER ownership directly on the document — proves
      // the strict-GM guard fires BEFORE the generic ownership check below
      // it, rather than the refusal below merely reflecting the player
      // never having ownership in the first place.
      const ownerGrantAck = await sendOp(gm, "doc:update", {
        documentType: "Setting",
        updates: [
          {
            _id: settingId,
            diff: { ownership: { default: 0, [ctx.playerUserId]: 3 } },
          },
        ],
      });
      expect(ownerGrantAck["ok"]).toBe(true);
    });

    it("PLAYER is refused even when granted OWNER ownership on the document (REQ-CFG-070)", async () => {
      const ack = await sendOp(player, "doc:update", {
        documentType: "Setting",
        updates: [{ _id: settingId, diff: { value: true } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("ASSISTANT (role 3) is refused (REQ-CFG-070)", async () => {
      const ack = await sendOp(assistant, "doc:update", {
        documentType: "Setting",
        updates: [{ _id: settingId, diff: { value: true } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("GAMEMASTER is accepted and applies immediately, without a save step (REQ-CFG-080)", async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Setting",
        updates: [{ _id: settingId, diff: { value: true } }],
      });
      expect(ack["ok"]).toBe(true);

      // No separate "commit"/"save" round-trip: the store already reflects
      // the new value the instant the ack comes back.
      const stored = ctx.store.get("settings", settingId);
      expect(stored["value"]).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // doc:delete
  // -------------------------------------------------------------------------

  describe("doc:delete", () => {
    async function createSetting(key: string): Promise<string> {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Setting",
        data: [{ key, value: 1 }],
      });
      return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    }

    it("PLAYER is refused (REQ-CFG-070)", async () => {
      const id = await createSetting("world:test:deleteByPlayer");
      const ack = await sendOp(player, "doc:delete", {
        documentType: "Setting",
        ids: [id],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
      // Never deleted — still there.
      expect(ctx.store.get("settings", id)["key"]).toBe("world:test:deleteByPlayer");
    });

    it("ASSISTANT (role 3) is refused (REQ-CFG-070)", async () => {
      const id = await createSetting("world:test:deleteByAssistant");
      const ack = await sendOp(assistant, "doc:delete", {
        documentType: "Setting",
        ids: [id],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("GAMEMASTER is accepted", async () => {
      const id = await createSetting("world:test:deleteByGm");
      const ack = await sendOp(gm, "doc:delete", {
        documentType: "Setting",
        ids: [id],
      });
      expect(ack["ok"]).toBe(true);
      expect(() => ctx.store.get("settings", id)).toThrow(DocumentNotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // documentType "User" (REQ-USR-025..031, REQ-USR-030) — `TYPE_TO_TABLE` maps
  // it to the SAME `users` table `auth/user-store.ts` reads at login, and the
  // generic path had no guard at all for it (absent from
  // GM_ONLY_CREATE_DELETE — only the generic TRUSTED+ floor stood in the way).
  // Refused for EVERY role, including GAMEMASTER: /api/users is the one door.
  // -------------------------------------------------------------------------

  describe('documentType "User" is not writable through the generic path (REQ-USR-030, REQ-CFG-070)', () => {
    it("TRUSTED cannot forge a passwordless GAMEMASTER account via doc:create (REQ-USR-018, REQ-USR-030)", async () => {
      const ack = await sendOp(trusted, "doc:create", {
        documentType: "User",
        data: [{ name: "ForgedGmByTrusted", role: 4 }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");

      // Nothing was inserted into the real auth table — not just an ack lie.
      const row = ctx.fusionDb.raw
        .prepare("SELECT id FROM users WHERE name = ?")
        .get("ForgedGmByTrusted");
      expect(row).toBeUndefined();
    });

    it("ASSISTANT is refused on doc:create User (REQ-USR-030)", async () => {
      const ack = await sendOp(assistant, "doc:create", {
        documentType: "User",
        data: [{ name: "ForgedByAssistant", role: 1 }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("GAMEMASTER is ALSO refused on doc:create User — /api/users is the one door (REQ-USR-030)", async () => {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "User",
        data: [{ name: "GmViaGenericPath", role: 1 }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("doc:update User is refused for every role, GAMEMASTER included (REQ-USR-030)", async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "User",
        updates: [{ _id: ctx.playerUserId, diff: { role: 4 } }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("doc:delete User is refused for every role, GAMEMASTER included (REQ-USR-030)", async () => {
      const ack = await sendOp(gm, "doc:delete", {
        documentType: "User",
        ids: [ctx.playerUserId],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });
  });
});
