/**
 * G105 — creating a user creates its blank character in the same gesture,
 * and the rest of the Usuários section's server contract (REQ-CFG-050..054).
 *
 * Covers:
 *   REQ-USR-025, REQ-USR-025a, REQ-USR-025b, REQ-USR-025c, REQ-USR-025d
 *   REQ-CFG-050, REQ-CFG-051, REQ-CFG-051a, REQ-CFG-052, REQ-CFG-053,
 *   REQ-CFG-054
 *
 * Uses real SQLite databases in temp directories and Fastify's `inject()`
 * for in-process HTTP testing — no real TCP sockets, no port allocation
 * needed (fastify.inject never listens on a real port).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { Database as Db } from "better-sqlite3";

import { openDatabase, applyMigrations } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import type { UserPublic } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { DocumentStore } from "../documents/store.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-usr-char-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  db: Db;
  authService: AuthService;
  documents: DocumentStore;
  fastify: FastifyInstance;
  gmUser: { id: string; password: string };
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
  const documents = new DocumentStore({ db });

  const { user: gmPublic, password: gmPassword } = await authService.bootstrapGm();

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test World", systemId: "stub" },
  });
  await fastify.ready();

  return {
    dataDir,
    db,
    authService,
    documents,
    fastify,
    gmUser: { id: gmPublic.id, password: gmPassword },
  };
}

async function login(fastify: FastifyInstance, userId: string, password: string): Promise<string> {
  const resp = await fastify.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { userId, password },
  });
  expect(resp.statusCode).toBe(200);
  return resp.json<{ accessToken: string }>().accessToken;
}

interface LoginResult {
  accessToken: string;
  refreshCookie: string;
}

async function loginWithCookie(
  fastify: FastifyInstance,
  userId: string,
  password: string,
): Promise<LoginResult> {
  const resp = await fastify.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { userId, password },
  });
  expect(resp.statusCode).toBe(200);
  const cookies = resp.headers["set-cookie"] as unknown as string | string[];
  const raw = Array.isArray(cookies) ? cookies.join("; ") : String(cookies);
  const match = /fusion_refresh=([^;]+)/.exec(raw);
  if (!match?.[1]) throw new Error("no refresh cookie set");
  return {
    accessToken: resp.json<{ accessToken: string }>().accessToken,
    refreshCookie: match[1],
  };
}

/** All Actor documents whose flags.fusion.playerId points at this user. */
function actorsForPlayer(documents: DocumentStore, userId: string): Record<string, unknown>[] {
  return documents.getAll("actors").filter((doc) => {
    const flags = doc["flags"] as Record<string, unknown> | undefined;
    const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
    return fusion?.["playerId"] === userId;
  });
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
  vi.restoreAllMocks();
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
// REQ-USR-025 / REQ-USR-025a / REQ-USR-025b / REQ-CFG-051 — the character is
// born with the user, non-privileged roles only.
// ---------------------------------------------------------------------------

describe("POST /api/users — creating a non-privileged user creates its character (REQ-USR-025, REQ-CFG-051)", () => {
  it("PLAYER: nasce um Actor character com o novo usuário como OWNER (REQ-USR-025, REQ-USR-025a)", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Aldric", role: Role.PLAYER },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ ok: boolean; user: UserPublic }>();
    const newUserId = body.user.id;

    const actors = actorsForPlayer(ctx.documents, newUserId);
    expect(actors).toHaveLength(1);
    const actor = actors[0]!;

    // REQ-USR-025b: subtype "character", name derived from the user's name,
    // no game-system fields filled in.
    expect(actor["type"]).toBe("character");
    expect(actor["name"]).toBe("Aldric");
    expect(actor["system"]).toEqual({});

    // REQ-USR-025a: default=none, only the new user is OWNER — an exception
    // to "the GM who created it becomes OWNER" (REQ-DOC-029), because the
    // intended owner is the new user, not the GM performing the creation.
    const ownership = actor["ownership"] as Record<string, number>;
    expect(ownership["default"]).toBe(OwnershipLevel.NONE);
    expect(ownership[newUserId]).toBe(OwnershipLevel.OWNER);
    expect(ownership[ctx.gmUser.id]).toBeUndefined();
  });

  it("TRUSTED também é papel não privilegiado e ganha personagem (DEC-USR-01, REQ-USR-025)", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Bethina", role: Role.TRUSTED },
    });
    expect(resp.statusCode).toBe(201);
    const newUserId = resp.json<{ user: UserPublic }>().user.id;

    expect(actorsForPlayer(ctx.documents, newUserId)).toHaveLength(1);
  });

  it("ASSISTANT (privilegiado) não ganha personagem (REQ-USR-025)", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Cassio", role: Role.ASSISTANT },
    });
    expect(resp.statusCode).toBe(201);
    const newUserId = resp.json<{ user: UserPublic }>().user.id;

    expect(actorsForPlayer(ctx.documents, newUserId)).toHaveLength(0);
    expect(ctx.documents.getAll("actors")).toHaveLength(0);
  });

  it("GAMEMASTER (privilegiado) não ganha personagem (REQ-USR-025)", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Dagna", role: Role.GAMEMASTER },
    });
    expect(resp.statusCode).toBe(201);
    const newUserId = resp.json<{ user: UserPublic }>().user.id;

    expect(actorsForPlayer(ctx.documents, newUserId)).toHaveLength(0);
  });

  it("a resposta de criação não expõe o ator nem nada além do usuário — nenhuma ficha/janela é implicada (REQ-CFG-051a)", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Elowen", role: Role.PLAYER },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(["ok", "user"]);
  });
});

// ---------------------------------------------------------------------------
// REQ-USR-025c — user + character is a single atomic gesture.
// ---------------------------------------------------------------------------

describe("criar usuário + personagem é atômico (REQ-USR-025c)", () => {
  it("se a criação do Actor falhar, o usuário não é persistido", async () => {
    const createSpy = vi.spyOn(DocumentStore.prototype, "create").mockImplementation(() => {
      throw new Error("simulated Actor creation failure");
    });

    await expect(ctx.authService.createUser({ name: "Faelan", role: Role.PLAYER })).rejects.toThrow(
      "simulated Actor creation failure",
    );

    createSpy.mockRestore();

    // The user row must not have survived the rolled-back transaction.
    expect(ctx.authService.listUsers().some((u) => u.name === "Faelan")).toBe(false);
    // No orphan Actor was left behind either.
    expect(ctx.documents.getAll("actors")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-USR-025d — no other admin action creates or removes a character.
// ---------------------------------------------------------------------------

describe("nenhuma outra ação de administração cria ou remove personagem (REQ-USR-025d)", () => {
  it("editar (mudar papel), resetar senha, desativar e kickar preservam o único Actor existente", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const createResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Galahad", role: Role.PLAYER },
    });
    const userId = createResp.json<{ user: UserPublic }>().user.id;
    const actorIdBefore = actorsForPlayer(ctx.documents, userId)[0]!["_id"];

    // Editar: muda de PLAYER para TRUSTED — continua não privilegiado, ainda
    // assim NÃO cria um segundo personagem.
    await ctx.fastify.inject({
      method: "PATCH",
      url: `/api/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: Role.TRUSTED },
    });

    // Resetar senha
    await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${userId}/reset-password`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    // Desativar
    await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Kick
    await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${userId}/kick`,
      headers: { authorization: `Bearer ${token}` },
    });

    const actorsAfter = actorsForPlayer(ctx.documents, userId);
    expect(actorsAfter).toHaveLength(1);
    expect(actorsAfter[0]!["_id"]).toBe(actorIdBefore);
  });
});

// ---------------------------------------------------------------------------
// REQ-CFG-050 — the Usuários section lists name, role, color, active state.
// ---------------------------------------------------------------------------

describe("GET /api/users lista nome, papel, cor e estado (REQ-CFG-050)", () => {
  it("cada linha traz name/role/color/active", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Hilde", role: Role.PLAYER, color: "#123456" },
    });

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ users: UserPublic[] }>();
    const hilde = body.users.find((u) => u.name === "Hilde");
    expect(hilde).toBeDefined();
    expect(hilde).toMatchObject({
      name: "Hilde",
      role: Role.PLAYER,
      color: "#123456",
      active: true,
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-CFG-052 — editing happens through PATCH /api/users/:id (name, role,
// color, avatar, active) — the server-side half of "campos empilhados"; the
// gaveta-vs-janela placement is a client concern, not testable here.
// ---------------------------------------------------------------------------

describe("PATCH /api/users/:id edita os cinco campos (REQ-CFG-052)", () => {
  it("aceita e persiste name, role, color, avatar e active num único PATCH", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const createResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Ivor", role: Role.PLAYER },
    });
    const userId = createResp.json<{ user: UserPublic }>().user.id;

    const patchResp = await ctx.fastify.inject({
      method: "PATCH",
      url: `/api/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ivor the Bold",
        role: Role.TRUSTED,
        color: "#654321",
        avatar: "/assets/ivor.png",
        active: true,
      },
    });
    expect(patchResp.statusCode).toBe(200);
    const patched = patchResp.json<{ user: UserPublic & { avatar: string | null } }>().user;
    expect(patched.name).toBe("Ivor the Bold");
    expect(patched.role).toBe(Role.TRUSTED);
    expect(patched.color).toBe("#654321");
    expect(patched.avatar).toBe("/assets/ivor.png");
    expect(patched.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REQ-CFG-053 — the reset password is shown once and is not recoverable.
// ---------------------------------------------------------------------------

describe("reset de senha é exibido uma vez e não é recuperável depois (REQ-CFG-053)", () => {
  it("a senha volta só na resposta do reset, nunca em GET /api/users, e um segundo reset gera outra senha", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const createResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Joan", role: Role.PLAYER },
    });
    const userId = createResp.json<{ user: UserPublic }>().user.id;

    const firstReset = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${userId}/reset-password`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(firstReset.statusCode).toBe(200);
    const firstPassword = firstReset.json<{ password: string }>().password;
    expect(typeof firstPassword).toBe("string");
    expect(firstPassword.length).toBeGreaterThan(0);

    // Not recoverable: GET /api/users never carries a password field.
    const listResp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
    });
    const users = listResp.json<{ users: Record<string, unknown>[] }>().users;
    for (const u of users) {
      expect(u).not.toHaveProperty("password");
      expect(u).not.toHaveProperty("password_hash");
    }

    // Resetting again yields a fresh, different password — the old one is gone.
    const secondReset = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${userId}/reset-password`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const secondPassword = secondReset.json<{ password: string }>().password;
    expect(secondPassword).not.toBe(firstPassword);
  });
});

// ---------------------------------------------------------------------------
// REQ-CFG-054 — kick and deactivate are immediate, single-call actions on
// the server; the nominal confirmation ("Tirar <nome> da mesa?") is a client
// gate in front of that single call — the server-testable slice is that
// neither action requires a second confirming request to take effect.
// ---------------------------------------------------------------------------

describe("desconectar e desativar agem de imediato em uma única chamada (REQ-CFG-054)", () => {
  it("kick revoga a sessão (refresh cookie) com uma única chamada, sem passo extra de confirmação", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const createResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Kian", role: Role.PLAYER, password: "kian-pass" },
    });
    const userId = createResp.json<{ user: UserPublic }>().user.id;
    const kianSession = await loginWithCookie(ctx.fastify, userId, "kian-pass");

    const kickResp = await ctx.fastify.inject({
      method: "POST",
      url: `/api/users/${userId}/kick`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(kickResp.statusCode).toBe(200);

    // The single kick call already revoked the refresh session — no second
    // "confirm" request against the server was needed for it to take effect.
    const refreshAfterKick = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: `fusion_refresh=${kianSession.refreshCookie}` },
    });
    expect(refreshAfterKick.statusCode).toBe(401);
  });

  it("desativar age de imediato com uma única chamada: login seguinte é recusado", async () => {
    const token = await login(ctx.fastify, ctx.gmUser.id, ctx.gmUser.password);

    const createResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Liora", role: Role.PLAYER, password: "liora-pass" },
    });
    const userId = createResp.json<{ user: UserPublic }>().user.id;

    const deactivateResp = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deactivateResp.statusCode).toBe(200);

    const loginAfterDeactivate = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId, password: "liora-pass" },
    });
    expect(loginAfterDeactivate.statusCode).toBe(403);
  });
});
