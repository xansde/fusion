/**
 * POST /api/assets/ambient-grant — a PLAYER must be able to open the ambient
 * track the GM chose (it belongs to no document, so the doc-grant mint can't
 * cover it), and ONLY that file.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { registerAssetRoutes } from "../assets/routes.js";
import { persistAmbientTrackState } from "../net/handlers/sound-handlers.js";

interface Ctx {
  dataDir: string;
  fastify: FastifyInstance;
  playerToken: string;
  playerId: string;
  raw: ReturnType<typeof openDatabase>["raw"];
}

let ctx: Ctx;

beforeEach(async () => {
  const dataDir = join(
    tmpdir(),
    `fusion-ambient-grant-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, "tavern.ogg"), Buffer.from("OggS-fake"));
  writeFileSync(join(assetsDir, "secret.ogg"), Buffer.from("OggS-secret"));
  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  const db = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(db.raw, dbPath);
  const authService = new AuthService(db.raw, secret, "w");
  await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "P1",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: "w", title: "W", systemId: "stub" },
  });
  registerAssetRoutes(fastify, { authService, assetsDir, secret, db: db.raw, grantEnforce: true });
  await fastify.ready();
  const login = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  ctx = { dataDir, fastify, playerToken: login.accessToken, playerId: player.id, raw: db.raw };
});

afterEach(async () => {
  await ctx.fastify.close();
  ctx.raw.close();
  try {
    rmSync(ctx.dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const post = (token?: string) =>
  ctx.fastify.inject({
    method: "POST",
    url: "/api/assets/ambient-grant",
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

describe("POST /api/assets/ambient-grant", () => {
  it("requires authentication", async () => {
    expect((await post()).statusCode).toBe(401);
  });

  it("answers track null while the table is silent", async () => {
    const r = await post(ctx.playerToken);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, track: null });
  });

  it("lets a player open the playing track, and nothing else", async () => {
    persistAmbientTrackState(ctx.raw, { src: "tavern.ogg", startedAt: 1 });
    const r = await post(ctx.playerToken);
    const { track } = r.json() as { track: { src: string; exp: number; grant: string } };
    expect(track.src).toBe("tavern.ogg");
    const q = `at=${track.grant}&ae=${String(track.exp)}&au=${ctx.playerId}`;
    const ok = await ctx.fastify.inject({ method: "GET", url: `/assets/tavern.ogg?${q}` });
    expect(ok.statusCode).toBe(200);
    const other = await ctx.fastify.inject({ method: "GET", url: `/assets/secret.ogg?${q}` });
    expect(other.statusCode).not.toBe(200);
  });
});
