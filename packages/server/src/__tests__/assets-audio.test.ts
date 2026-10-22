/**
 * Integration tests for audio uploads and the per-kind size cap (wi-mapa-som-01).
 *
 * Lives apart from assets.test.ts because that suite pins a 1 MB GLOBAL ceiling
 * (`maxUploadBytes`) for every request, which would mask the per-kind cap this
 * item introduces. Here the global ceiling stays at its default and the per-kind
 * caps are lowered through `maxBytesByKind`, so the cap-by-type behaviour is
 * exercised without pushing 20 MB through a multipart request.
 *
 * REQ-AST-007 (magic bytes) / REQ-AST-008 (size limits).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import FormData from "form-data";

import { openDatabase, applyMigrations } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { registerAssetRoutes } from "../assets/routes.js";

// ---------------------------------------------------------------------------
// Per-kind caps used by this suite (tiny, so payloads stay cheap).
// The real 20 MB / 100 MB numbers are asserted in
// assets/__tests__/upload-limits.test.ts.
// ---------------------------------------------------------------------------

const IMAGE_CAP = 4096;
const AUDIO_CAP = 16384;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** PNG signature + IHDR opening — enough for detectType. */
const PNG_HEAD = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** MP3 with an ID3v2 tag. */
const MP3_ID3_HEAD = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]);

/** MP3 starting straight at a frame sync (FF FB). */
const MP3_SYNC_HEAD = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

/** OGG container header. */
const OGG_HEAD = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);

/** WAV: RIFF....WAVE — must stay rejected. */
const WAV_HEAD = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

/**
 * Pad a header out to `total` bytes with a per-call filler byte, so two files
 * of the same size never share a digest (the route deduplicates by content).
 */
let fillerSeed = 0;
function sized(head: Buffer, total: number): Buffer {
  fillerSeed = (fillerSeed + 1) % 251;
  return Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), fillerSeed + 1)]);
}

// ---------------------------------------------------------------------------
// Test context
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  assetsDir: string;
  fastify: FastifyInstance;
  gmToken: string;
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-assets-audio-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
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

  const { user: gm, password: gmPass } = await authService.bootstrapGm();

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: "test-world", title: "Test", systemId: "stub" },
  });
  registerAssetRoutes(fastify, {
    authService,
    assetsDir,
    // Global ceiling left at the default; only the per-kind caps are lowered.
    maxBytesByKind: { image: IMAGE_CAP, audio: AUDIO_CAP },
    secret,
  });
  await fastify.ready();

  const loginResp = await fastify.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { userId: gm.id, password: gmPass },
  });
  const gmToken = (loginResp.json() as { accessToken: string }).accessToken;

  return { dataDir, assetsDir, fastify, gmToken };
}

async function uploadFile(
  fastify: FastifyInstance,
  token: string,
  fileBuffer: Buffer,
  filename: string,
  contentType = "application/octet-stream",
) {
  const form = new FormData();
  form.append("file", fileBuffer, { filename, contentType });
  return fastify.inject({
    method: "POST",
    url: "/api/assets/upload",
    headers: { ...form.getHeaders(), authorization: `Bearer ${token}` },
    payload: form.getBuffer(),
  });
}

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestContext();
});

afterEach(async () => {
  await ctx.fastify.close();
  try {
    rmSync(ctx.dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// ---------------------------------------------------------------------------
// Accepted formats
// ---------------------------------------------------------------------------

describe("POST /api/assets/upload — audio formats", () => {
  it("stores an MP3 with an ID3 tag as audio/mpeg", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(MP3_ID3_HEAD, 512),
      "tavern-loop.mp3",
      "audio/mpeg",
    );
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    expect(body["mime_type"]).toBe("audio/mpeg");
    expect(String(body["path"])).toMatch(/\.mp3$/);
  });

  it("stores an MP3 without a tag (raw frame sync) as audio/mpeg", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(MP3_SYNC_HEAD, 512),
      "combat.mp3",
      "audio/mpeg",
    );
    expect(resp.statusCode).toBe(201);
    expect((resp.json() as Record<string, unknown>)["mime_type"]).toBe("audio/mpeg");
  });

  it("stores an OGG as audio/ogg", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(OGG_HEAD, 512),
      "rain.ogg",
      "audio/ogg",
    );
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as Record<string, unknown>;
    expect(body["mime_type"]).toBe("audio/ogg");
    expect(String(body["path"])).toMatch(/\.ogg$/);
  });

  it("rejects a WAV with 415 — WebP keeps the RIFF prefix to itself", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(WAV_HEAD, 512),
      "ambient.wav",
      "audio/wav",
    );
    expect(resp.statusCode).toBe(415);
    expect((resp.json() as Record<string, unknown>)["code"]).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects an MP3 extension carrying foreign bytes (client validation is UX only)", async () => {
    const notAudio = Buffer.from([0x4d, 0x5a, 0x90, 0x00, ...Buffer.alloc(64, 0x00)]);
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, notAudio, "virus.mp3", "audio/mpeg");
    expect(resp.statusCode).toBe(415);
  });
});

// ---------------------------------------------------------------------------
// The item, in one pair: same size, different verdict by kind
// ---------------------------------------------------------------------------

describe("POST /api/assets/upload — cap is per kind", () => {
  const overImage = IMAGE_CAP + 1;

  it("rejects an image above the image cap", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(PNG_HEAD, overImage),
      "huge.png",
      "image/png",
    );
    expect(resp.statusCode).toBe(413);
    const body = resp.json() as Record<string, unknown>;
    expect(body["code"]).toBe("FILE_TOO_LARGE");
    expect(String(body["message"])).toMatch(/image/i);
  });

  it("accepts audio of the very same size, because audio has its own cap", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(MP3_ID3_HEAD, overImage),
      "long-track.mp3",
      "audio/mpeg",
    );
    expect(resp.statusCode).toBe(201);
  });

  it("rejects audio above the audio cap, naming the kind", async () => {
    const resp = await uploadFile(
      ctx.fastify,
      ctx.gmToken,
      sized(OGG_HEAD, AUDIO_CAP + 1),
      "epic.ogg",
      "audio/ogg",
    );
    expect(resp.statusCode).toBe(413);
    const body = resp.json() as Record<string, unknown>;
    expect(body["code"]).toBe("FILE_TOO_LARGE");
    expect(String(body["message"])).toMatch(/audio/i);
  });
});
