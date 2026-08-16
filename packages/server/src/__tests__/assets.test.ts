/**
 * Integration tests for the asset upload and serving routes.
 *
 * REQ-AST-006..008: upload endpoint — valid roundtrip, oversize rejection,
 *   type-forged file rejection, SVG with script rejection.
 * REQ-AST-011 / REQ-AST-029: permission checks (PLAYER cannot upload; GM only deletes).
 * REQ-AST-019: static serving with cache headers.
 * REQ-SEC-042: path traversal blocked in 4 variants.
 *
 * Uses real SQLite + Fastify inject() (no TCP sockets).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import FormData from "form-data";

import { openDatabase, applyMigrations } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { registerAssetRoutes } from "../assets/routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-assets-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Magic-byte test fixtures
// ---------------------------------------------------------------------------

/** Valid PNG: minimal 1×1 white pixel */
const PNG_BYTES = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52, // IHDR length + type
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01, // 1×1 px
  0x08,
  0x02,
  0x00,
  0x00,
  0x00,
  0x90,
  0x77,
  0x53, // bit depth, color type...
  0xde,
  0x00,
  0x00,
  0x00,
  0x0c,
  0x49,
  0x44,
  0x41, // IDAT
  0x54,
  0x08,
  0xd7,
  0x63,
  0xf8,
  0xcf,
  0xc0,
  0x00,
  0x00,
  0x00,
  0x02,
  0x00,
  0x01,
  0xe2,
  0x21,
  0xbc,
  0x33,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e, // IEND
  0x44,
  0xae,
  0x42,
  0x60,
  0x82,
]);

/** Valid JPEG signature bytes (FF D8 FF E0 ...) */
const JPEG_BYTES = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0x00,
  0x10,
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00,
  0x01,
  0x01,
  0x00,
  0x00,
  0x01,
  0x00,
  0x01,
  0x00,
  0x00,
  ...Buffer.alloc(50, 0x00), // padding to make it look more real
  0xff,
  0xd9, // EOI
]);

/** Valid WebP signature (RIFF....WEBP) */
const WEBP_BYTES = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46, // RIFF
  0x24,
  0x00,
  0x00,
  0x00, // file size (little-endian)
  0x57,
  0x45,
  0x42,
  0x50, // WEBP
  0x56,
  0x50,
  0x38,
  0x4c, // VP8L
  0x18,
  0x00,
  0x00,
  0x00,
  ...Buffer.alloc(24, 0x00),
]);

/** Valid SVG */
const SVG_CLEAN = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
  "utf8",
);

/** SVG containing a <script> tag — must be rejected/sanitized */
const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>',
  "utf8",
);

/** EXE header disguised as a JPEG (wrong magic bytes) */
const EXE_AS_JPEG = Buffer.from([
  0x4d,
  0x5a,
  0x90,
  0x00, // MZ — Windows PE header
  0xff,
  0xd8,
  0xff,
  0xe0, // fake JPEG bytes after the real magic
  ...Buffer.alloc(20, 0x00),
]);

// ---------------------------------------------------------------------------
// Test context
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  assetsDir: string;
  fastify: FastifyInstance;
  gmToken: string;
  playerToken: string;
  trustedToken: string;
  /** Authenticated GM user ID (used for asset query-token tests). */
  gmUserId: string;
  /** World HMAC secret (injected into routes as `secret`). */
  secret: Uint8Array;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  const db = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(db.raw, dbPath);
  const authService = new AuthService(db.raw, secret, "test-world");

  // Create users
  const { user: gm, password: gmPass } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player",
    role: Role.PLAYER,
    password: "p-pass",
  });
  const { user: trusted } = await authService.createUser({
    name: "Trusted",
    role: Role.TRUSTED,
    password: "t-pass",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: "test-world", title: "Test", systemId: "stub" },
  });
  registerAssetRoutes(fastify, {
    authService,
    assetsDir,
    maxUploadBytes: 1024 * 1024,
    secret,
  });
  await fastify.ready();

  // Login helpers
  async function loginFor(id: string, pass: string): Promise<string> {
    const resp = await fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: id, password: pass },
    });
    const body = resp.json() as { ok: boolean; accessToken: string };
    return body.accessToken;
  }

  const gmToken = await loginFor(gm.id, gmPass);
  const playerToken = await loginFor(player.id, "p-pass");
  const trustedToken = await loginFor(trusted.id, "t-pass");

  return {
    dataDir,
    assetsDir,
    fastify,
    gmToken,
    playerToken,
    trustedToken,
    gmUserId: gm.id,
    secret,
  };
}

// ---------------------------------------------------------------------------
// Upload helper
// ---------------------------------------------------------------------------

async function uploadFile(
  fastify: FastifyInstance,
  token: string,
  fileBuffer: Buffer,
  filename: string,
  contentType = "application/octet-stream",
) {
  const form = new FormData();
  form.append("file", fileBuffer, { filename, contentType });
  const headers = {
    ...form.getHeaders(),
    authorization: `Bearer ${token}`,
  };
  return fastify.inject({
    method: "POST",
    url: "/api/assets/upload",
    headers,
    payload: form.getBuffer(),
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
  await ctx.fastify.close();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/assets/upload", () => {
  it("uploads a valid PNG and returns path, digest, mime_type", async () => {
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "token.png", "image/png");
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["mime_type"]).toBe("image/png");
    expect(typeof body["path"]).toBe("string");
    expect(typeof body["digest"]).toBe("string");
    expect((body["digest"] as string).length).toBe(64);
    // File should exist on disk
    expect(existsSync(join(ctx.assetsDir, body["path"] as string))).toBe(true);
  });

  it("uploads a valid JPEG", async () => {
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, JPEG_BYTES, "photo.jpg", "image/jpeg");
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    expect(body["mime_type"]).toBe("image/jpeg");
  });

  it("uploads a valid WebP", async () => {
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, WEBP_BYTES, "map.webp", "image/webp");
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    expect(body["mime_type"]).toBe("image/webp");
  });

  it("accepts a clean SVG and stores it", async () => {
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, SVG_CLEAN, "icon.svg", "image/svg+xml");
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    expect(body["mime_type"]).toBe("image/svg+xml");
    // SVG file should exist
    expect(existsSync(join(ctx.assetsDir, body["path"] as string))).toBe(true);
  });

  it("accepts SVG with script tag — strips script, stores sanitized version", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      SVG_WITH_SCRIPT,
      "bad.svg",
      "image/svg+xml",
    );
    // Upload should succeed (sanitized, not rejected)
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    // Read the stored file — must NOT contain <script
    const storedPath = join(ctx.assetsDir, body["path"] as string);
    const { readFileSync } = await import("node:fs");
    const stored = readFileSync(storedPath, "utf8");
    expect(stored.toLowerCase()).not.toContain("<script");
    expect(stored.toLowerCase()).not.toContain("alert(1)");
  });

  it("rejects an EXE file masquerading as a JPEG (wrong magic bytes)", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      EXE_AS_JPEG,
      "malware.jpg",
      "image/jpeg",
    );
    expect(resp.statusCode).toBe(415);
    const body = resp.json() as Record<string, unknown>;
    expect(body["code"]).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects an upload that exceeds the size limit", async () => {
    // Build a buffer slightly larger than 1 MB limit (maxUploadBytes = 1 MB in test ctx)
    // We need a buffer with valid PNG magic bytes but oversized
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(1024 * 1024 + 1, 0xaa)]);
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, oversized, "big.png", "image/png");
    expect(resp.statusCode).toBe(413);
    const body = resp.json() as Record<string, unknown>;
    expect(body["code"]).toBe("FILE_TOO_LARGE");
  });

  it("returns 403 when a PLAYER attempts to upload", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.playerToken,
      PNG_BYTES,
      "token.png",
      "image/png",
    );
    expect(resp.statusCode).toBe(403);
    const body = resp.json() as Record<string, unknown>;
    expect(body["code"]).toBe("PERMISSION_DENIED");
  });

  it("returns 401 when no token is provided", async () => {
    const form = new FormData();
    form.append("file", PNG_BYTES, { filename: "token.png", contentType: "image/png" });
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/upload",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });
    expect(resp.statusCode).toBe(401);
  });

  it("TRUSTED user can upload", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.trustedToken,
      PNG_BYTES,
      "icon.png",
      "image/png",
    );
    expect(resp.statusCode).toBe(201);
  });

  it("returns deduplicated=true on second upload of identical content", async () => {
    // First upload
    const resp1 = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "first.png", "image/png");
    expect(resp1.statusCode).toBe(201);
    const body1 = resp1.json() as Record<string, unknown>;
    expect(body1["deduplicated"]).toBe(false);

    // Second upload — same bytes, different filename
    const resp2 = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "second.png", "image/png");
    expect(resp2.statusCode).toBe(200);
    const body2 = resp2.json() as Record<string, unknown>;
    expect(body2["deduplicated"]).toBe(true);
    // Both should report the same digest
    expect(body2["digest"]).toBe(body1["digest"]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/assets/:name
// ---------------------------------------------------------------------------

describe("DELETE /api/assets/:name", () => {
  it("GM can delete an existing asset", async () => {
    // Upload first
    const upload = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "tok.png", "image/png");
    const { path: assetName } = upload.json() as { path: string };

    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/assets/${assetName}`,
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json<{ ok: boolean }>()["ok"]).toBe(true);
    // File should be gone
    expect(existsSync(join(ctx.assetsDir, assetName))).toBe(false);
  });

  it("returns 404 for non-existent asset", async () => {
    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: "/api/assets/nonexistent.png",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(del.statusCode).toBe(404);
  });

  it("PLAYER cannot delete (403)", async () => {
    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: "/api/assets/any.png",
      headers: { authorization: `Bearer ${ctx.playerToken}` },
    });
    expect(del.statusCode).toBe(403);
  });

  it("TRUSTED cannot delete (403)", async () => {
    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: "/api/assets/any.png",
      headers: { authorization: `Bearer ${ctx.trustedToken}` },
    });
    expect(del.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /assets/* — static serving + path traversal
// ---------------------------------------------------------------------------

describe("GET /assets/* — static serving", () => {
  it("serves an uploaded file with correct headers", async () => {
    // Upload a PNG
    const upload = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "map.png", "image/png");
    const { path: assetName } = upload.json() as { path: string };

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: `/assets/${assetName}`,
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toContain("image/png");
    expect(resp.headers["x-content-type-options"]).toBe("nosniff");
    // Content-addressed filename → immutable cache
    expect(resp.headers["cache-control"]).toContain("immutable");
  });

  it("returns 404 JSON for missing asset (REQ-AST-023)", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/assets/missing-file-12345678.png",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(resp.statusCode).toBe(404);
    const body = resp.json() as Record<string, unknown>;
    expect(body["error"]).toBe("asset_not_found");
  });

  it("blocks ../ path traversal attempt", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/assets/../../world.db",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect([400, 404]).toContain(resp.statusCode);
  });

  it("blocks %2e%2e encoded traversal", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/assets/%2e%2e%2fworld.db",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect([400, 404]).toContain(resp.statusCode);
  });

  it("blocks backslash traversal attempt", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/assets/..%5cworld.db",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect([400, 404]).toContain(resp.statusCode);
  });

  it("blocks null byte in path", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/assets/valid.png%00evil",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect([400, 404]).toContain(resp.statusCode);
  });

  it("serves Range request with 206 partial content", async () => {
    // Upload a valid file first
    const upload = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "range.png", "image/png");
    const { path: assetName } = upload.json() as { path: string };

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: `/assets/${assetName}`,
      headers: {
        authorization: `Bearer ${ctx.gmToken}`,
        range: "bytes=0-7",
      },
    });
    expect(resp.statusCode).toBe(206);
    expect(resp.headers["content-range"]).toMatch(/^bytes 0-7\//);
    expect(resp.headers["accept-ranges"]).toBe("bytes");
    // Should return exactly 8 bytes
    expect(resp.rawPayload.length).toBe(8);
  });

  it("returns 401 when serving without auth", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/assets/any.png",
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/assets — list
// ---------------------------------------------------------------------------

describe("GET /api/assets", () => {
  it("returns empty list when no assets uploaded", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json() as { ok: boolean; assets: unknown[] };
    expect(body["ok"]).toBe(true);
    expect(Array.isArray(body["assets"])).toBe(true);
  });

  it("lists uploaded assets after upload", async () => {
    await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "a.png", "image/png");

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    const body = resp.json() as { ok: boolean; assets: Array<{ name: string; mime_type: string }> };
    expect(body["assets"].length).toBeGreaterThanOrEqual(1);
    expect(body["assets"][0]["mime_type"]).toBe("image/png");
  });

  it("returns 403 for PLAYER", async () => {
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${ctx.playerToken}` },
    });
    expect(resp.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/assets/token + query-token serving
// Fix for: PIXI Assets.load() / <img> tags GET without Authorization header
// ---------------------------------------------------------------------------

describe("POST /api/assets/token + GET /assets/* with query-token", () => {
  it("issues a query-token for an authenticated user", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/token",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(typeof body["token"]).toBe("string");
    expect(typeof body["exp"]).toBe("number");
    expect(body["exp"] as number).toBeGreaterThan(Date.now());
  });

  it("returns 401 for unauthenticated token request", async () => {
    const resp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/token",
    });
    expect(resp.statusCode).toBe(401);
  });

  it("serves an asset using query-token (no Authorization header)", async () => {
    // Upload a PNG first
    const upload = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "qt.png", "image/png");
    const { path: assetName } = upload.json() as { path: string };

    // Obtain a query-token via the token endpoint
    const tokenResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/token",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    const { token, exp } = tokenResp.json() as { token: string; exp: number };

    // Serve the asset WITHOUT Authorization header — only query params
    const resp = await ctx.fastify.inject({
      method: "GET",
      url: `/assets/${assetName}?at=${token}&ae=${String(exp)}&au=${ctx.gmUserId}`,
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toContain("image/png");
    expect(resp.rawPayload.length).toBeGreaterThan(0);
  });

  it("returns 401 when query-token is expired", async () => {
    // Build an expired token by back-dating exp by 10 minutes.
    //
    // T025: this has to use the CURRENT signer (`issueBrowseGrant`), not the
    // superseded `issueAssetToken`. A token in the old format is rejected for
    // being unrecognisable, which would make this test pass without ever
    // exercising the expiry check it is named after.
    const { issueBrowseGrant } = await import("../assets/asset-grant.js");
    const pastMs = Date.now() - 10 * 60 * 1000;
    const { token, exp } = issueBrowseGrant(ctx.gmUserId, ctx.secret, pastMs);

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: `/assets/any.png?at=${token}&ae=${String(exp)}&au=${ctx.gmUserId}`,
    });
    expect(resp.statusCode).toBe(401);
  });

  it("returns 401 when query-token signature is tampered", async () => {
    const tokenResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/token",
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    const { exp } = tokenResp.json() as { token: string; exp: number };

    const resp = await ctx.fastify.inject({
      method: "GET",
      url: `/assets/any.png?at=deadbeef00000000deadbeef00000000&ae=${String(exp)}&au=${ctx.gmUserId}`,
    });
    expect(resp.statusCode).toBe(401);
  });
});
