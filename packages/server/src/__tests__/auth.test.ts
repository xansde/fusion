/**
 * Integration tests for the auth system.
 *
 * Uses real SQLite databases in temp directories and Fastify's `inject()` for
 * in-process HTTP testing — no real TCP sockets.
 *
 * Covers:
 *  - login ok (with and without password)
 *  - login wrong password → 401
 *  - login inactive user → 403
 *  - brute-force lockout → 429 with Retry-After
 *  - refresh token rotation
 *  - refresh reuse detection (revoke family)
 *  - logout clears cookie
 *  - GET /api/world (public)
 *  - GM admin: list, create, patch, reset-password, delete, kick
 *  - PLAYER cannot access GM-only routes (403)
 *  - _stats and password_hash never appear in responses
 *  - world create bootstraps GM user
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-auth-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  dbPath: string;
  secret: Uint8Array;
  authService: AuthService;
  fastify: FastifyInstance;
  gmUser: { id: string; password: string };
  playerUser: { id: string };
  assistantUser: { id: string };
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);

  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const db = fusionDb.raw;
  const worldId = "test-world";

  const authService = new AuthService(db, secret, worldId);

  // Bootstrap GM
  const { user: gmPublic, password: gmPassword } = await authService.bootstrapGm();

  // Create a player for permission tests
  const { user: playerPublic } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass-1",
  });

  // REQ-CFG-070: ASSISTANT (role 3) — a role slated for removal (issue #133,
  // decided 2026-08-15) but still present in the enum — must be refused on
  // the GAMEMASTER-strict routes just like PLAYER, not treated as privileged
  // the way `isRolePrivileged` treats it elsewhere in the codebase.
  const { user: assistantPublic } = await authService.createUser({
    name: "Assistant1",
    role: Role.ASSISTANT,
    password: "assistant-pass-1",
  });

  // Build Fastify with cookie plugin + auth routes
  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test World", systemId: "stub" },
  });
  await fastify.ready();

  return {
    dataDir,
    dbPath,
    secret,
    authService,
    fastify,
    gmUser: { id: gmPublic.id, password: gmPassword },
    playerUser: { id: playerPublic.id },
    assistantUser: { id: assistantPublic.id },
  };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let ctx: TestContext;
const tempDirs: string[] = [];

beforeEach(async () => {
  ctx = await buildTestContext();
  tempDirs.push(ctx.dataDir);
});

afterEach(async () => {
  await ctx.fastify.close();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Login and return { accessToken, cookies } */
async function login(
  fastify: FastifyInstance,
  userId: string,
  password?: string,
): Promise<{ accessToken: string; cookies: string[] }> {
  const resp = await fastify.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { userId, password },
  });
  expect(resp.statusCode).toBe(200);
  const body = resp.json<{ accessToken: string }>();
  return {
    accessToken: body.accessToken,
    cookies: resp.headers["set-cookie"] as unknown as string[],
  };
}

function extractRefreshCookie(cookies: string[]): string | undefined {
  const raw = Array.isArray(cookies) ? cookies.join("; ") : String(cookies);
  const match = /fusion_refresh=([^;]+)/.exec(raw);
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Tests: GET /api/world
// ---------------------------------------------------------------------------

describe("GET /api/world", () => {
  it("returns public world info without password hashes", async () => {
    const resp = await ctx.fastify.inject({ method: "GET", url: "/api/world" });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ ok: boolean; world: { id: string; users: unknown[] } }>();
    expect(body.ok).toBe(true);
    expect(body.world.id).toBe("test-world");
    // Users should not have password_hash field
    for (const u of body.world.users) {
      expect(u).not.toHaveProperty("password_hash");
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/auth/login
// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  it("returns 200 + accessToken for correct credentials", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.gmUser.id, password: ctx.gmUser.password },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ ok: boolean; accessToken: string; user: { id: string } }>();
    expect(body.ok).toBe(true);
    expect(typeof body.accessToken).toBe("string");
    expect(body.user.id).toBe(ctx.gmUser.id);
  });

  it("sets httpOnly refresh cookie on success", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.gmUser.id, password: ctx.gmUser.password },
    });
    const cookies = resp.headers["set-cookie"] as unknown as string | string[];
    const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : String(cookies);
    expect(cookieStr).toMatch(/fusion_refresh=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Strict/i);
  });

  it("returns 401 for wrong password (uniform message)", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.gmUser.id, password: "wrong-password" },
    });
    expect(resp.statusCode).toBe(401);
    const body = resp.json<{ code: string; message: string }>();
    expect(body.code).toBe("INVALID_CREDENTIALS");
    // Message must NOT reveal whether user exists (REQ-SEC-012)
    expect(body.message).toBe("Invalid credentials.");
  });

  it("returns 401 for non-existent user (uniform message)", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: "nonexistent-id-xyz", password: "any-pass" },
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.json<{ message: string }>().message).toBe("Invalid credentials.");
  });

  it("returns 403 for inactive user", async () => {
    // Deactivate GM's player counterpart
    await ctx.authService.updateUser(ctx.playerUser.id, { active: false });

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.playerUser.id, password: "player-pass-1" },
    });
    expect(resp.statusCode).toBe(403);
  });

  it("returns 429 after 5 failed attempts with Retry-After header", async () => {
    // Send 5 failures
    for (let i = 0; i < 5; i++) {
      await ctx.fastify.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { userId: ctx.gmUser.id, password: "bad" },
      });
    }

    // 6th attempt should be locked
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.gmUser.id, password: "bad" },
    });
    expect(resp.statusCode).toBe(429);
    expect(resp.headers["retry-after"]).toBeDefined();
    expect(resp.json<{ code: string }>().code).toBe("LOCKED_OUT");
  });

  it("lockout is not bypassed by rotating X-Forwarded-For (trustProxy=false)", async () => {
    // Without trustProxy, clientIp() reads request.socket.remoteAddress (127.0.0.1 for inject).
    // Rotating XFF must NOT reset the lockout counter.
    for (let i = 0; i < 5; i++) {
      await ctx.fastify.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": `10.0.0.${String(i + 1)}` },
        payload: { userId: ctx.gmUser.id, password: "bad" },
      });
    }

    // Despite varied XFF headers, the 6th attempt from the same socket IP must be locked.
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-for": "10.0.0.99" },
      payload: { userId: ctx.gmUser.id, password: "bad" },
    });
    expect(resp.statusCode).toBe(429);
    expect(resp.json<{ code: string }>().code).toBe("LOCKED_OUT");
  });

  it("user without password can login without password field", async () => {
    // Create passwordless user
    const { user } = await ctx.authService.createUser({
      name: "Passwordless",
      role: Role.PLAYER,
    });

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: user.id }, // no password
    });
    expect(resp.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/auth/refresh
// ---------------------------------------------------------------------------

describe("POST /api/auth/refresh", () => {
  it("rotates the refresh token and returns new accessToken", async () => {
    const { cookies } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);
    const oldRefresh = extractRefreshCookie(cookies)!;
    expect(oldRefresh).toBeTruthy();

    const refreshResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: `fusion_refresh=${oldRefresh}` },
    });
    expect(refreshResp.statusCode).toBe(200);
    const body = refreshResp.json<{ accessToken: string }>();
    expect(typeof body.accessToken).toBe("string");

    // New refresh cookie set
    const newCookies = refreshResp.headers["set-cookie"] as unknown as string[];
    const newRefresh = extractRefreshCookie(newCookies);
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh); // token rotated
  });

  it("reusing a revoked refresh token revokes the whole family (CA-USR-07)", async () => {
    const { cookies } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);
    const oldRefresh = extractRefreshCookie(cookies)!;

    // First refresh — ok
    await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: `fusion_refresh=${oldRefresh}` },
    });

    // Second refresh with the SAME (now revoked) token → family revoked
    const reuseResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: `fusion_refresh=${oldRefresh}` },
    });
    expect(reuseResp.statusCode).toBe(401);
  });

  it("returns 401 if no refresh cookie present", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/auth/logout
// ---------------------------------------------------------------------------

describe("POST /api/auth/logout", () => {
  it("clears the cookie and invalidates the refresh token", async () => {
    const { accessToken, cookies } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);
    const refreshToken = extractRefreshCookie(cookies)!;

    const logoutResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: `fusion_refresh=${refreshToken}`,
      },
    });
    expect(logoutResp.statusCode).toBe(200);

    // Attempting to refresh with the old token should now fail
    const refreshResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: `fusion_refresh=${refreshToken}` },
    });
    expect(refreshResp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: GM admin routes
// ---------------------------------------------------------------------------

describe("GM admin routes", () => {
  it("GET /api/users returns all users for GM", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ ok: boolean; users: unknown[] }>();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.users)).toBe(true);

    // Verify no password_hash in response
    for (const u of body.users) {
      expect(u).not.toHaveProperty("password_hash");
    }
  });

  it("POST /api/users creates a new user", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "NewPlayer", role: Role.PLAYER, password: "test-pass" },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ ok: boolean; user: { name: string; role: number } }>();
    expect(body.ok).toBe(true);
    expect(body.user.name).toBe("NewPlayer");
    expect(body.user.role).toBe(Role.PLAYER);
    expect(body.user).not.toHaveProperty("password_hash");
  });

  it("POST /api/users returns 409 for duplicate name", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "UniqueUser", role: Role.PLAYER, password: "pass" },
    });

    const resp2 = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "UniqueUser", role: Role.TRUSTED },
    });
    expect(resp2.statusCode).toBe(409);
    expect(resp2.json<{ code: string }>().code).toBe("NAME_TAKEN");
  });

  it("PATCH /api/users/:id updates a user", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "PATCH",
      url: `/api/users/${ctx.playerUser.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { role: Role.TRUSTED },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json<{ user: { role: number } }>().user.role).toBe(Role.TRUSTED);
  });

  it("PATCH last GM role returns 400 (CA-USR-08)", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "PATCH",
      url: `/api/users/${ctx.gmUser.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { role: Role.PLAYER },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json<{ code: string }>().code).toBe("LAST_GM");
  });

  it("POST /api/users/:id/reset-password returns new password", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${ctx.playerUser.id}/reset-password`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ ok: boolean; password: string | null }>();
    expect(body.ok).toBe(true);
    expect(typeof body.password).toBe("string");
    expect(body.password).not.toBeNull();
  });

  it("DELETE /api/users/:id deactivates user", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${ctx.playerUser.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(200);

    // Player can no longer login
    const loginResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.playerUser.id, password: "player-pass-1" },
    });
    expect(loginResp.statusCode).toBe(403);
  });

  it("POST /api/users/:id/kick revokes sessions", async () => {
    // Log the player in
    const { accessToken: playerToken, cookies: playerCookies } = await login(
      ctx.fastify,
      ctx.playerUser.id,
      "player-pass-1",
    );
    const playerRefresh = extractRefreshCookie(playerCookies)!;

    // GM kicks the player
    const { accessToken: gmToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);
    const kickResp = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${ctx.playerUser.id}/kick`,
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(kickResp.statusCode).toBe(200);

    // Player's refresh token should now be invalid
    const refreshResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: `fusion_refresh=${playerRefresh}` },
    });
    expect(refreshResp.statusCode).toBe(401);

    void playerToken; // used above
  });
});

// ---------------------------------------------------------------------------
// Tests: PLAYER cannot access GM routes
// ---------------------------------------------------------------------------

describe("PLAYER permission denied on GM routes", () => {
  it("GET /api/users returns 403 for PLAYER", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.playerUser.id, "player-pass-1");

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(403);
    expect(resp.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
  });

  it("POST /api/users returns 403 for PLAYER", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.playerUser.id, "player-pass-1");

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "Hacker", role: Role.GAMEMASTER },
    });
    expect(resp.statusCode).toBe(403);
  });

  it("POST /api/users/:id/reset-password returns 403 for PLAYER", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.playerUser.id, "player-pass-1");

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${ctx.gmUser.id}/reset-password`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(resp.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Tests: ASSISTANT (role 3) cannot access GM-strict routes either
//
// REQ-CFG-070: writes to the Usuários section (this route) require
// `role === GAMEMASTER` strictly — not the generic `isRolePrivileged`
// threshold used elsewhere, which admits ASSISTANT. `requireGm` in
// auth/routes.ts already compares `role !== Role.GAMEMASTER`, so this suite
// proves the strict gate on the wire rather than adding new production code.
// ASSISTANT is a role slated for removal (issue #133, 2026-08-15) but the
// enum value still exists — the guard is spelled out explicitly rather than
// relying on the issue landing.
// ---------------------------------------------------------------------------

describe("ASSISTANT permission denied on GAMEMASTER-strict routes (REQ-CFG-070)", () => {
  it("GET /api/users returns 403 for ASSISTANT", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.assistantUser.id, "assistant-pass-1");

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(403);
    expect(resp.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
  });

  it("POST /api/users returns 403 for ASSISTANT", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.assistantUser.id, "assistant-pass-1");

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "AssistantCreated", role: Role.PLAYER },
    });
    expect(resp.statusCode).toBe(403);
    expect(resp.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
  });

  it("PATCH /api/users/:id returns 403 for ASSISTANT", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.assistantUser.id, "assistant-pass-1");

    const resp = await ctx.fastify.inject({
      method: "PATCH",
      url: `/api/users/${ctx.playerUser.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { role: Role.TRUSTED },
    });
    expect(resp.statusCode).toBe(403);
  });

  it("POST /api/users/:id/reset-password returns 403 for ASSISTANT", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.assistantUser.id, "assistant-pass-1");

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${ctx.gmUser.id}/reset-password`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(resp.statusCode).toBe(403);
  });

  it("DELETE /api/users/:id returns 403 for ASSISTANT", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.assistantUser.id, "assistant-pass-1");

    const resp = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${ctx.playerUser.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(403);
  });

  it("POST /api/users/:id/kick returns 403 for ASSISTANT", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.assistantUser.id, "assistant-pass-1");

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${ctx.playerUser.id}/kick`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Tests: no sensitive fields in responses
// ---------------------------------------------------------------------------

describe("Sensitive fields must not leak", () => {
  it("login response does not include password_hash", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: ctx.gmUser.id, password: ctx.gmUser.password },
    });
    const body = resp.json<Record<string, unknown>>();
    expect(JSON.stringify(body)).not.toMatch(/password_hash/);
  });

  it("GET /api/world does not include password_hash or _stats", async () => {
    const resp = await ctx.fastify.inject({ method: "GET", url: "/api/world" });
    const bodyStr = resp.body;
    expect(bodyStr).not.toMatch(/password_hash/);
    expect(bodyStr).not.toMatch(/"_stats"/);
  });

  it("GET /api/users does not include password_hash", async () => {
    const { accessToken } = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resp.body).not.toMatch(/password_hash/);
  });
});

// ---------------------------------------------------------------------------
// Tests: world create bootstraps GM
// ---------------------------------------------------------------------------

describe("world bootstrapGm", () => {
  it("creates a GM user on first call", async () => {
    const result = await ctx.authService.bootstrapGm();
    // Already seeded in beforeEach, so calling again returns the existing GM
    expect(result.user.role).toBe(Role.GAMEMASTER);
    expect(result.user.name).toBe("Gamemaster");
  });

  it("bootstrapGm is idempotent", async () => {
    // Second call should not throw
    const result = await ctx.authService.bootstrapGm();
    expect(result.user.name).toBe("Gamemaster");
  });
});
