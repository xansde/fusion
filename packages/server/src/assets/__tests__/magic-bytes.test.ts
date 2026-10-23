/**
 * Magic-byte detection tests (wi-mapa-som-01).
 *
 * The audio formats this item adds — MP3 (both framings) and OGG — plus the two
 * traps the design named: WAV must stay rejected (it shares the RIFF prefix
 * with WebP) and JPEG must never be mistaken for an MP3 frame sync.
 */

import { describe, it, expect } from "vitest";
import { detectType, ALLOWED_TYPES } from "../magic-bytes.js";

// --- fixtures --------------------------------------------------------------

/** OGG container: "OggS" + version + header type. */
const OGG_BYTES = Buffer.from([
  0x4f,
  0x67,
  0x67,
  0x53,
  0x00,
  0x02,
  0x00,
  0x00,
  ...Buffer.alloc(24, 0x00),
]);

/** MP3 with an ID3v2 tag: "ID3" + version + flags + size. */
const MP3_ID3_BYTES = Buffer.from([
  0x49,
  0x44,
  0x33,
  0x03,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x21,
  ...Buffer.alloc(20, 0x00),
]);

/** MP3 without a tag: raw frame sync FF FB (0xFB & 0xE0 === 0xE0). */
const MP3_SYNC_BYTES = Buffer.from([0xff, 0xfb, 0x90, 0x00, ...Buffer.alloc(28, 0x00)]);

/** WAV: RIFF....WAVE — same first four bytes as WebP. */
const WAV_BYTES = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46,
  0x24,
  0x00,
  0x00,
  0x00,
  0x57,
  0x41,
  0x56,
  0x45,
  ...Buffer.alloc(20, 0x00),
]);

/** WebP: RIFF....WEBP — the other half of the RIFF pair. */
const WEBP_BYTES = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46,
  0x24,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
  ...Buffer.alloc(20, 0x00),
]);

/** JPEG: FF D8 FF E0 — the byte that must not read as an MP3 frame sync. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(28, 0x00)]);

// --- tests -----------------------------------------------------------------

describe("ALLOWED_TYPES", () => {
  it("declares mp3 and ogg with their canonical extensions", () => {
    expect(ALLOWED_TYPES["audio/mpeg"]).toBe(".mp3");
    expect(ALLOWED_TYPES["audio/ogg"]).toBe(".ogg");
  });

  it("still declares the four image types", () => {
    expect(ALLOWED_TYPES["image/png"]).toBe(".png");
    expect(ALLOWED_TYPES["image/jpeg"]).toBe(".jpg");
    expect(ALLOWED_TYPES["image/webp"]).toBe(".webp");
    expect(ALLOWED_TYPES["image/svg+xml"]).toBe(".svg");
  });

  it("does not declare wav", () => {
    expect(ALLOWED_TYPES["audio/wav"]).toBeUndefined();
  });
});

describe("detectType — audio", () => {
  it("detects an OGG container", () => {
    expect(detectType(OGG_BYTES)).toEqual({ mime: "audio/ogg", ext: ".ogg" });
  });

  it("detects an MP3 that carries an ID3 tag", () => {
    expect(detectType(MP3_ID3_BYTES)).toEqual({ mime: "audio/mpeg", ext: ".mp3" });
  });

  it("detects an MP3 that starts straight at a frame sync", () => {
    expect(detectType(MP3_SYNC_BYTES)).toEqual({ mime: "audio/mpeg", ext: ".mp3" });
  });
});

describe("detectType — the RIFF pair", () => {
  it("rejects WAV (out of scope for this item, by decision)", () => {
    expect(detectType(WAV_BYTES)).toBeNull();
  });

  it("keeps detecting WebP, which shares the RIFF prefix", () => {
    expect(detectType(WEBP_BYTES)).toEqual({ mime: "image/webp", ext: ".webp" });
  });
});

describe("detectType — no regression on images", () => {
  it("does not read a JPEG as an MP3 frame sync", () => {
    expect(detectType(JPEG_BYTES)).toEqual({ mime: "image/jpeg", ext: ".jpg" });
  });

  it("still detects SVG text", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
    expect(detectType(svg)).toEqual({ mime: "image/svg+xml", ext: ".svg" });
  });

  it("still returns null for an unknown binary", () => {
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00]))).toBeNull();
  });
});
