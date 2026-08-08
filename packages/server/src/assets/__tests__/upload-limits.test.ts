/**
 * Unit tests for the per-kind upload limits (wi-mapa-som-01).
 *
 * These lock the NUMBERS (spec 20 REQ-AST-008) and the clamping rule that lets
 * a caller-supplied global ceiling (`maxUploadBytes`) coexist with a per-kind
 * cap. The route integration tests exercise the wiring; this file exercises the
 * arithmetic, so the real constants can be asserted without moving 20 MB
 * through a multipart request.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_BYTES_BY_KIND,
  MAX_UPLOAD_BYTES_GLOBAL,
  kindOfMime,
  effectiveCapForKind,
} from "../upload-limits.js";

const MB = 1024 * 1024;

describe("MAX_BYTES_BY_KIND", () => {
  it("keeps images at the 20 MB the server already used", () => {
    expect(MAX_BYTES_BY_KIND.image).toBe(20 * MB);
  });

  it("gives audio the 100 MB from spec 20 (REQ-AST-008)", () => {
    expect(MAX_BYTES_BY_KIND.audio).toBe(100 * MB);
  });
});

describe("MAX_UPLOAD_BYTES_GLOBAL", () => {
  it("is the largest per-kind cap, so multipart never cuts a legal upload", () => {
    const largest = Math.max(...Object.values(MAX_BYTES_BY_KIND));
    expect(MAX_UPLOAD_BYTES_GLOBAL).toBe(largest);
    expect(MAX_UPLOAD_BYTES_GLOBAL).toBe(100 * MB);
  });
});

describe("kindOfMime", () => {
  it("maps every allowed image mime to image", () => {
    expect(kindOfMime("image/png")).toBe("image");
    expect(kindOfMime("image/jpeg")).toBe("image");
    expect(kindOfMime("image/webp")).toBe("image");
    expect(kindOfMime("image/svg+xml")).toBe("image");
  });

  it("maps mp3 and ogg to audio", () => {
    expect(kindOfMime("audio/mpeg")).toBe("audio");
    expect(kindOfMime("audio/ogg")).toBe("audio");
  });

  it("returns null for anything outside the allowlist", () => {
    expect(kindOfMime("audio/wav")).toBeNull();
    expect(kindOfMime("video/mp4")).toBeNull();
    expect(kindOfMime("application/octet-stream")).toBeNull();
  });
});

describe("effectiveCapForKind", () => {
  it("uses the per-kind cap when the global ceiling is higher", () => {
    expect(effectiveCapForKind("image", MAX_UPLOAD_BYTES_GLOBAL)).toBe(20 * MB);
    expect(effectiveCapForKind("audio", MAX_UPLOAD_BYTES_GLOBAL)).toBe(100 * MB);
  });

  it("clamps to the global ceiling when the caller lowered it", () => {
    // This is the existing assets.test.ts context: maxUploadBytes = 1 MB.
    expect(effectiveCapForKind("image", 1 * MB)).toBe(1 * MB);
    expect(effectiveCapForKind("audio", 1 * MB)).toBe(1 * MB);
  });

  it("honours a per-kind override below both", () => {
    expect(effectiveCapForKind("image", MAX_UPLOAD_BYTES_GLOBAL, { image: 4096 })).toBe(4096);
    // An untouched kind keeps its default.
    expect(effectiveCapForKind("audio", MAX_UPLOAD_BYTES_GLOBAL, { image: 4096 })).toBe(100 * MB);
  });

  it("never lets a per-kind override exceed the global ceiling", () => {
    expect(effectiveCapForKind("audio", 1 * MB, { audio: 500 * MB })).toBe(1 * MB);
  });
});
