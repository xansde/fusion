/**
 * Route tests for the FilePicker's categories: GET /api/assets carries the effective category,
 * PATCH /api/assets/category is GM-only, and an upload may declare the tab it came from.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import FormData from "form-data";

import { openDatabase, applyMigrations } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { registerAssetRoutes } from "../assets/routes.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 1),
]);

interface Ctx {
  dir: string;
  assetsDir: string;
  fastify: FastifyInstance;
  raw: Database;
  gm: string;
  trusted: string;
  player: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const dir = join(tmpdir(), `fusion-asset-cat-${String(Date.now())}-${Math.random().toString(36).slice(2)}`);
  const assetsDir = join(dir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  const dbPath = join(dir, "world.db");
  const secret = loadOrCreateSecret(dir);
  const db = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(db.raw, dbPath);
  const auth = new AuthService(db.raw, secret, "w");
  const { user: gm, password } = await auth.bootstrapGm();
  const { user: trusted } = await auth.createUser({ name: "T", role: Role.TRUSTED, password: "t-pass" });
  const { user: player } = await auth.createUser({ name: "P", role: Role.PLAYER, password: "p-pass" });
  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, { authService: auth, worldInfo: { id: "w", title: "W", systemId: "stub" } });
  registerAssetRoutes(fastify, { authService: auth, assetsDir, maxUploadBytes: 1024 * 1024, secret, db: db.raw });
  await fastify.ready();
  const login = async (id: string, pass: string): Promise<string> =>
    ((await fastify.inject({ method: "POST", url: "/api/auth/login", payload: { userId: id, password: pass } })).json() as { accessToken: string }).accessToken;
  ctx = {
    dir,
    assetsDir,
    fastify,
    raw: db.raw,
    gm: await login(gm.id, password),
    trusted: await login(trusted.id, "t-pass"),
    player: await login(player.id, "p-pass"),
  };
});

afterEach(async () => {
  await ctx.fastify.close();
  ctx.raw.close();
  try {
    rmSync(ctx.dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function list(token: string): Promise<Array<{ name: string; category: string }>> {
  const r = await ctx.fastify.inject({ method: "GET", url: "/api/assets", headers: auth(token) });
  return (r.json() as { assets: Array<{ name: string; category: string }> }).assets;
}

async function upload(token: string, query: string): Promise<{ status: number; path?: string }> {
  const form = new FormData();
  form.append("file", PNG, { filename: "retrato.png", contentType: "image/png" });
  const r = await ctx.fastify.inject({
    method: "POST",
    url: `/api/assets/upload${query}`,
    headers: { ...form.getHeaders(), ...auth(token) },
    payload: form.getBuffer(),
  });
  return { status: r.statusCode, path: (r.json() as { path?: string }).path };
}

describe("asset categories over HTTP", () => {
  it("lists the derived category of files that predate the registry", async () => {
    writeFileSync(join(ctx.assetsDir, "tema.mp3"), "x");
    writeFileSync(join(ctx.assetsDir, "solto.png"), PNG);
    const byName = Object.fromEntries((await list(ctx.gm)).map((a) => [a.name, a.category]));
    expect(byName).toEqual({ "tema.mp3": "audio", "solto.png": "other" });
  });

  it("the GM moves an asset (even one with no registry row) and the listing follows", async () => {
    writeFileSync(join(ctx.assetsDir, "solto.png"), PNG);
    const r = await ctx.fastify.inject({
      method: "PATCH",
      url: "/api/assets/category",
      headers: auth(ctx.gm),
      payload: { name: "solto.png", category: "items" },
    });
    expect(r.statusCode).toBe(200);
    expect((await list(ctx.gm))[0]?.category).toBe("items");
    // null clears the choice back to the derived one
    await ctx.fastify.inject({
      method: "PATCH",
      url: "/api/assets/category",
      headers: auth(ctx.gm),
      payload: { name: "solto.png", category: null },
    });
    expect((await list(ctx.gm))[0]?.category).toBe("other");
  });

  it("only the GM recategorizes: TRUSTED and PLAYER get 403, the category is untouched", async () => {
    writeFileSync(join(ctx.assetsDir, "solto.png"), PNG);
    for (const t of [ctx.trusted, ctx.player]) {
      const r = await ctx.fastify.inject({
        method: "PATCH",
        url: "/api/assets/category",
        headers: auth(t),
        payload: { name: "solto.png", category: "maps" },
      });
      expect(r.statusCode).toBe(403);
    }
    expect((await list(ctx.gm))[0]?.category).toBe("other");
  });

  it("a PLAYER still cannot list the library (no new leak)", async () => {
    const r = await ctx.fastify.inject({ method: "GET", url: "/api/assets", headers: auth(ctx.player) });
    expect(r.statusCode).toBe(403);
  });

  it("refuses an unknown category, 'icons', a path, and a missing file", async () => {
    writeFileSync(join(ctx.assetsDir, "solto.png"), PNG);
    const patch = (payload: unknown) =>
      ctx.fastify.inject({ method: "PATCH", url: "/api/assets/category", headers: auth(ctx.gm), payload: payload as object });
    expect((await patch({ name: "solto.png", category: "bogus" })).statusCode).toBe(400);
    expect((await patch({ name: "solto.png", category: "icons" })).statusCode).toBe(400);
    expect((await patch({ name: "actionbar-icons/a-11111111.png", category: "maps" })).statusCode).toBe(400);
    expect((await patch({ name: "../x.png", category: "maps" })).statusCode).toBe(400);
    expect((await patch({ name: "nao-existe.png", category: "maps" })).statusCode).toBe(404);
  });

  it("an upload declares its tab with ?category= and the listing shows it", async () => {
    const up = await upload(ctx.gm, "?category=handouts");
    expect(up.status).toBe(201);
    const found = (await list(ctx.gm)).find((a) => a.name === up.path);
    expect(found?.category).toBe("handouts");
  });

  it("an upload without a tab stays derived; unknown or 'icons' tab is a 400", async () => {
    const up = await upload(ctx.gm, "");
    expect(up.status).toBe(201);
    expect((await list(ctx.gm)).find((a) => a.name === up.path)?.category).toBe("other");
    expect((await upload(ctx.gm, "?category=bogus")).status).toBe(400);
    expect((await upload(ctx.gm, "?category=icons")).status).toBe(400);
  });
});
