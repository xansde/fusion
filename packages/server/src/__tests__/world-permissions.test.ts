/**
 * G104 (Fase 9 — Aba Configurações, Permissões) — configurable Permissions
 * table for REQ-USR-008/009, replacing the hardcoded role floors doc-
 * handlers.ts used for a subset of its create gates (REQ-CFG-040..042).
 *
 * Two of the gates were literally hardcoded to "TRUSTED+" with a comment
 * naming the simplification (JournalEntry's generic create floor, and
 * embedded Token create on a Scene); four more (`ACTOR_CREATE`,
 * `ITEM_CREATE`, `TABLE_CREATE`, `PLAYLIST_CREATE`) were hardcoded to the
 * ASSISTANT+ `isPrivileged` threshold via `GM_ONLY_CREATE_DELETE` — which is
 * already REQ-USR-008's own default for all four, so wiring them through
 * `world-permissions.ts` changes no default behaviour.
 *
 * Coverage:
 *   - Pure module: defaults match today's hardcoded behaviour; an override
 *     is honoured; an invalid/out-of-range override falls back to the
 *     default instead of opening the gate wider (REQ-USR-008/009).
 *   - doc:create JournalEntry: PLAYER refused / TRUSTED accepted by default
 *     (JOURNAL_CREATE default TRUSTED); GM lowering the floor to PLAYER via
 *     `fusion.permissions` lets a PLAYER through (REQ-CFG-040/041/042).
 *   - doc:create Item: TRUSTED refused by default (ITEM_CREATE default
 *     ASSISTANT, matching `GM_ONLY_CREATE_DELETE`'s current behaviour); GM
 *     lowering the floor to TRUSTED lets a TRUSTED user through while PLAYER
 *     stays refused (REQ-CFG-040/041/042).
 *   - Embedded doc:create Token on a Scene: PLAYER with OWNER access to the
 *     scene still refused by default (TOKEN_CREATE default TRUSTED); GM
 *     lowering the floor to PLAYER lets that PLAYER through.
 *   - REQ-CFG-073: a permission-table write refused by the server (non-GM)
 *     leaves the previously configured floor in force — neither wider nor
 *     narrower than what the GM last set.
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
import { UserRole } from "../documents/ownership.js";
import {
  DEFAULT_PERMISSION_MIN_ROLE,
  PERMISSIONS_SETTING_KEY,
  resolvePermissionMinRole,
  validatePermissionOverrides,
  type PermissionsStoreSource,
} from "../documents/world-permissions.js";

// ---------------------------------------------------------------------------
// Pure module tests (REQ-USR-008/009) — no socket, no store.
// ---------------------------------------------------------------------------

function storeWithPermissions(value: unknown): PermissionsStoreSource {
  return {
    getAll: () => [{ _id: "aaaaaaaaaaaaaaaa", key: PERMISSIONS_SETTING_KEY, value }],
  };
}

const EMPTY_STORE: PermissionsStoreSource = { getAll: () => [] };

describe("world-permissions module (REQ-USR-008/009)", () => {
  it("defaults match today's hardcoded doc-handlers.ts behaviour", () => {
    expect(DEFAULT_PERMISSION_MIN_ROLE.ACTOR_CREATE).toBe(UserRole.ASSISTANT_GM);
    expect(DEFAULT_PERMISSION_MIN_ROLE.ITEM_CREATE).toBe(UserRole.ASSISTANT_GM);
    expect(DEFAULT_PERMISSION_MIN_ROLE.TABLE_CREATE).toBe(UserRole.ASSISTANT_GM);
    expect(DEFAULT_PERMISSION_MIN_ROLE.PLAYLIST_CREATE).toBe(UserRole.ASSISTANT_GM);
    expect(DEFAULT_PERMISSION_MIN_ROLE.JOURNAL_CREATE).toBe(UserRole.TRUSTED);
    expect(DEFAULT_PERMISSION_MIN_ROLE.TOKEN_CREATE).toBe(UserRole.TRUSTED);
  });

  it("resolves the default when no fusion.permissions Setting exists", () => {
    expect(resolvePermissionMinRole(EMPTY_STORE, "JOURNAL_CREATE")).toBe(UserRole.TRUSTED);
  });

  it("honours a valid GM override (REQ-USR-009)", () => {
    const store = storeWithPermissions({ JOURNAL_CREATE: UserRole.PLAYER });
    expect(resolvePermissionMinRole(store, "JOURNAL_CREATE")).toBe(UserRole.PLAYER);
  });

  it("falls back to the default for an out-of-range override (REQ-CFG-073)", () => {
    const store = storeWithPermissions({ JOURNAL_CREATE: 99 });
    expect(resolvePermissionMinRole(store, "JOURNAL_CREATE")).toBe(UserRole.TRUSTED);
  });

  it("falls back to the default when the Setting value is not a plain object", () => {
    const store = storeWithPermissions("not-an-object");
    expect(resolvePermissionMinRole(store, "ITEM_CREATE")).toBe(UserRole.ASSISTANT_GM);
  });

  it("validatePermissionOverrides rejects unknown keys and out-of-range roles", () => {
    const errors = validatePermissionOverrides({
      JOURNAL_CREATE: UserRole.PLAYER,
      SHOW_CURSOR: UserRole.PLAYER,
      ITEM_CREATE: 99,
    });
    expect(errors.some((e) => e.includes("SHOW_CURSOR"))).toBe(true);
    expect(errors.some((e) => e.includes("ITEM_CREATE"))).toBe(true);
    expect(errors).toHaveLength(2);
  });

  it("validatePermissionOverrides accepts a well-formed override map", () => {
    expect(validatePermissionOverrides({ TOKEN_CREATE: UserRole.PLAYER })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Socket-level integration (real doc:create over the wire, real Setting
// persistence) — mirrors setting-gamemaster-gate.test.ts's infra.
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-world-permissions-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  trustedToken: string;
  playerUserId: string;
  trustedUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "world_permissions_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "PermsPlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const { user: trusted } = await authService.createUser({
    name: "PermsTrusted",
    role: Role.TRUSTED,
    password: "trusted-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
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
      worldTitle: "World Permissions World",
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
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    trustedToken: trustedLogin.accessToken,
    playerUserId: player.id,
    trustedUserId: trusted.id,
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

describe("configurable Permissions gate doc:create (REQ-CFG-040..042)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let trusted: ClientSocket;
  // One `fusion.permissions` Setting document for the whole describe block
  // (REQ-CFG-071 — the Permissões section edits a single settings row, it
  // does not create a new one per changed permission). Created lazily by the
  // first test that needs to configure an override, then reused via
  // doc:update by every later test — mirrors how a real GM session would
  // edit the same row repeatedly from the Permissões seção.
  let settingId: string | null = null;

  async function setOverrides(value: Record<string, number>): Promise<void> {
    if (settingId === null) {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Setting",
        data: [{ key: PERMISSIONS_SETTING_KEY, value }],
      });
      expect(ack["ok"]).toBe(true);
      settingId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
      return;
    }
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Setting",
      updates: [{ _id: settingId, diff: { value } }],
    });
    expect(ack["ok"]).toBe(true);
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    trusted = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    gm.connect();
    player.connect();
    trusted.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player), waitForConnect(trusted)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    trusted?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // JOURNAL_CREATE — was literally hardcoded "TRUSTED+" in doc-handlers.ts.
  // -------------------------------------------------------------------------

  describe("JournalEntry (JOURNAL_CREATE, default TRUSTED)", () => {
    it("PLAYER is refused by default (REQ-USR-008 default TRUSTED)", async () => {
      const ack = await sendOp(player, "doc:create", {
        documentType: "JournalEntry",
        data: [{ name: "Player Journal Attempt" }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("TRUSTED is accepted by default (REQ-USR-008 default TRUSTED)", async () => {
      const ack = await sendOp(trusted, "doc:create", {
        documentType: "JournalEntry",
        data: [{ name: "Trusted Journal Default" }],
      });
      expect(ack["ok"]).toBe(true);
    });

    it("GM lowering JOURNAL_CREATE to PLAYER via fusion.permissions lets PLAYER through (REQ-CFG-040/041/042)", async () => {
      await setOverrides({ JOURNAL_CREATE: UserRole.PLAYER });

      const ack = await sendOp(player, "doc:create", {
        documentType: "JournalEntry",
        data: [{ name: "Player Journal After Lowering Floor" }],
      });
      expect(ack["ok"]).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ITEM_CREATE — was hardcoded to the ASSISTANT+ `isPrivileged` threshold
  // via GM_ONLY_CREATE_DELETE (REQ-USR-008 default ASSISTANT, unchanged).
  // -------------------------------------------------------------------------

  describe("Item (ITEM_CREATE, default ASSISTANT)", () => {
    it("TRUSTED is refused by default (REQ-USR-008 default ASSISTANT)", async () => {
      const ack = await sendOp(trusted, "doc:create", {
        documentType: "Item",
        data: [{ name: "Trusted Item Attempt" }],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("GM lowering ITEM_CREATE to TRUSTED lets TRUSTED through while PLAYER stays refused (REQ-CFG-040/041/042)", async () => {
      // Overwrite the SAME Setting row the JournalEntry block already wrote
      // (see setOverrides) with both overrides combined — a real GM editing
      // the Permissões section updates one row per world, not one per key.
      await setOverrides({ JOURNAL_CREATE: UserRole.PLAYER, ITEM_CREATE: UserRole.TRUSTED });

      const trustedAck = await sendOp(trusted, "doc:create", {
        documentType: "Item",
        data: [{ name: "Trusted Item After Lowering Floor" }],
      });
      expect(trustedAck["ok"]).toBe(true);

      const playerAck = await sendOp(player, "doc:create", {
        documentType: "Item",
        data: [{ name: "Player Item Still Refused" }],
      });
      expect(playerAck["ok"]).toBe(false);
      expect(playerAck["code"]).toBe("PERMISSION_DENIED");
    });
  });
});

// ---------------------------------------------------------------------------
// TOKEN_CREATE — embedded create, separate world so scene/ownership setup
// does not interact with the doc:create suite above.
// ---------------------------------------------------------------------------

describe("configurable Permissions gate on embedded Token create (TOKEN_CREATE, REQ-CFG-040..042)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let sceneId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);

    // Scene owned by PLAYER (parent-ownership check) and put on air (a scene
    // not on air does not exist for a non-privileged requester, REQ-CEN-071).
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Token Perms Scene", ownership: { default: 0, [ctx.playerUserId]: 3 } }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const activateAck = await sendOp(gm, "world:activeScene", { sceneId });
    expect(activateAck["ok"]).toBe(true);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  it("PLAYER with OWNER access to the scene is refused by default (TOKEN_CREATE default TRUSTED)", async () => {
    const ack = await sendOp(player, "doc:create", {
      documentType: "Token",
      data: [{ name: "Player Token Attempt" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("GM lowering TOKEN_CREATE to PLAYER lets that PLAYER (still OWNER of the scene) through", async () => {
    const settingAck = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [{ key: PERMISSIONS_SETTING_KEY, value: { TOKEN_CREATE: UserRole.PLAYER } }],
    });
    expect(settingAck["ok"]).toBe(true);

    const ack = await sendOp(player, "doc:create", {
      documentType: "Token",
      data: [{ name: "Player Token After Lowering Floor" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REQ-CFG-073 — a refused permission-table write keeps the previous value.
// ---------------------------------------------------------------------------

describe("REQ-CFG-073 — refused permission write keeps the previous configured floor", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let trusted: ClientSocket;
  let settingId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    trusted = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    gm.connect();
    player.connect();
    trusted.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player), waitForConnect(trusted)]);

    // GM lowers ITEM_CREATE to TRUSTED — the "previous value" the refused
    // write below must not be able to move.
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [{ key: PERMISSIONS_SETTING_KEY, value: { ITEM_CREATE: UserRole.TRUSTED } }],
    });
    expect(createAck["ok"]).toBe(true);
    settingId = (createAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    trusted?.disconnect();
    await teardown(ctx);
  });

  it("PLAYER cannot widen the permissions table by updating the Setting (REQ-CFG-070/073)", async () => {
    const ack = await sendOp(player, "doc:update", {
      documentType: "Setting",
      updates: [{ _id: settingId, diff: { value: { ITEM_CREATE: UserRole.PLAYER } } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("the previous floor (TRUSTED) is still what's enforced after the refused write (REQ-CFG-073)", async () => {
    // PLAYER still refused — the rejected write above did not widen the gate.
    const playerAck = await sendOp(player, "doc:create", {
      documentType: "Item",
      data: [{ name: "Player Item After Refused Widening" }],
    });
    expect(playerAck["ok"]).toBe(false);
    expect(playerAck["code"]).toBe("PERMISSION_DENIED");

    // TRUSTED still allowed — the GM's actual write from beforeAll held.
    const trustedAck = await sendOp(trusted, "doc:create", {
      documentType: "Item",
      data: [{ name: "Trusted Item Still Allowed" }],
    });
    expect(trustedAck["ok"]).toBe(true);
  });
});
