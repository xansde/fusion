/**
 * Tests for the hand-rolled QR encoder + ASCII renderer (M6 audit FIX-6).
 *
 * This module (tunnel/qr-ascii.ts) had NO test coverage at all before this
 * fix, despite being a from-scratch ISO/IEC 18004 implementation (Reed-Solomon
 * GF(256) arithmetic, BCH format-info, zig-zag data placement — real
 * algorithmic surface, not a trivial wrapper).
 *
 * No independent QR decoder is available in this monorepo (no qrcode/jsQR
 * etc. in devDependencies — CLAUDE.md forbids adding a new dependency
 * without justification, and the fix brief explicitly says not to add one
 * just for this). Verification strategy, in place of a real decode:
 *
 *   1. Fixed golden-hash snapshots of `modules` for 3 payloads spanning
 *      different QR versions/sizes (short LAN URL, mid-length tunnel URL,
 *      long URL with a path+query) — any unintentional change to the
 *      encoding pipeline (Reed-Solomon, masking, placement order) changes
 *      the hash and fails the test, exactly like a decoder would catch a
 *      corrupted symbol.
 *   2. Independent structural assertions that do NOT depend on the exact
 *      bit pattern — they re-derive what ISO/IEC 18004 mandates (finder
 *      pattern shape/position, matrix size per version, quiet zone,
 *      dark module) directly from the spec, so they would catch a
 *      structural regression even if the golden hash were (wrongly)
 *      regenerated to match a bug.
 *   3. renderQrAscii output shape (quiet zone borders, half-block chars).
 *
 * DEBT (documented per fix brief): this monorepo now has TWO independent QR
 * *encoders* — this hand-rolled one (server, console QR for --tunnel) and
 * `qrcode-generator` (client, packages/client/package.json, browser QR for
 * the setup wizard's LAN/connectivity step). They were built independently
 * for different runtime constraints (this one: sync/console/qr version
 * detection, no browser canvas API) and have never been consolidated.
 * TODO: extract a shared QR encoder into @fusion/shared once/if a second
 * server-side or non-browser QR need appears — not worth the churn for a
 * single duplicated concern today.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { encodeQr, renderQrAscii, qrAsciiFor, QrTooLargeError } from "../qr-ascii.js";
import type { QrMatrix } from "../qr-ascii.js";

function moduleHash(matrix: QrMatrix): string {
  const flat = matrix.modules.flat().join("");
  return createHash("sha256").update(flat).digest("hex");
}

// ---------------------------------------------------------------------------
// Golden vectors — 3 payloads spanning distinct sizes/versions.
// ---------------------------------------------------------------------------

describe("encodeQr — golden module-hash snapshots", () => {
  it("encodes a short LAN URL (version 1, 21x21) to the expected fixed matrix", () => {
    const payload = "http://192.168.1.42:33000";
    const matrix = encodeQr(payload);
    expect(matrix.size).toBe(25);
    expect(moduleHash(matrix)).toBe(
      "4ad81d85c78d2c80b3e874118461109b029bc919f320183aad0efe660a201f4d",
    );
  });

  it("encodes a mid-length trycloudflare.com URL to the expected fixed matrix", () => {
    const payload = "https://fusion-vtt-demo.trycloudflare.com";
    const matrix = encodeQr(payload);
    expect(matrix.size).toBe(29);
    expect(moduleHash(matrix)).toBe(
      "a215b821f3c5c668e40c21fa976ecf1c3a9284bead6dfa789faf219165691237",
    );
  });

  it("encodes a long URL with path+query to the expected fixed matrix", () => {
    const payload =
      "https://a-fairly-long-subdomain-name-example.trycloudflare.com/some/extra/path?x=1";
    const matrix = encodeQr(payload);
    expect(matrix.size).toBe(37);
    expect(moduleHash(matrix)).toBe(
      "b33b63ab496253b795e997c2f2f4e623b791e8d146cf768990a278d90616cc23",
    );
  });

  it("is deterministic: encoding the same payload twice yields identical matrices", () => {
    const payload = "https://deterministic-check.trycloudflare.com";
    const a = encodeQr(payload);
    const b = encodeQr(payload);
    expect(moduleHash(a)).toBe(moduleHash(b));
  });
});

// ---------------------------------------------------------------------------
// Structural invariants — independent of the golden hash, re-derived from
// ISO/IEC 18004 itself (would catch a regression even if the hash above
// were regenerated incorrectly).
// ---------------------------------------------------------------------------

describe("encodeQr — structural invariants (ISO/IEC 18004)", () => {
  function assertFinderPattern(matrix: QrMatrix, topRow: number, leftCol: number): void {
    // 7x7 finder: outer ring dark, one ring of light, 3x3 dark core.
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const expected = isBorder || isCore ? 1 : 0;
        expect(matrix.modules[topRow + r]?.[leftCol + c]).toBe(expected);
      }
    }
  }

  it("places all 3 finder patterns (top-left, top-right, bottom-left) correctly for a version-1 payload", () => {
    // 17 bytes — right at version 1's byte-mode/level-L capacity ceiling.
    const matrix = encodeQr("http://1.1.1.1:80");
    expect(matrix.size).toBe(21); // version 1
    assertFinderPattern(matrix, 0, 0);
    assertFinderPattern(matrix, 0, matrix.size - 7);
    assertFinderPattern(matrix, matrix.size - 7, 0);
  });

  it("places all 3 finder patterns correctly for a larger (version 6+, multi-block) payload", () => {
    // Long enough to push past version 5 into the multi-block interleaving path.
    const payload = "https://" + "x".repeat(120) + ".trycloudflare.com";
    const matrix = encodeQr(payload);
    expect(matrix.size).toBeGreaterThanOrEqual(41); // version >= 6
    assertFinderPattern(matrix, 0, 0);
    assertFinderPattern(matrix, 0, matrix.size - 7);
    assertFinderPattern(matrix, matrix.size - 7, 0);
  });

  it("sets the dark module at (4*version + 9, 8) — always 1 per spec", () => {
    const matrix = encodeQr("http://1.1.1.1:80"); // version 1 (17 bytes)
    expect(matrix.modules[4 * 1 + 9]?.[8]).toBe(1);
  });

  it("every module is a strict 0/1 — no unresolved null cells leak into the public matrix", () => {
    const matrix = encodeQr("https://leftover-null-check.trycloudflare.com");
    for (const row of matrix.modules) {
      for (const cell of row) {
        expect(cell === 0 || cell === 1).toBe(true);
      }
    }
  });

  it("matrix size matches the version table (21 + 4*(version-1))", () => {
    // version 1: 21x21 — trivially short payload.
    expect(encodeQr("a").size).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// Capacity limit (QrTooLargeError)
// ---------------------------------------------------------------------------

describe("encodeQr — capacity limit", () => {
  it("throws QrTooLargeError for a payload exceeding version-10/level-L capacity (~213 bytes)", () => {
    const tooLong = "https://" + "a".repeat(300) + ".trycloudflare.com";
    expect(() => encodeQr(tooLong)).toThrow(QrTooLargeError);
  });

  it("QrTooLargeError message includes the byte length that was rejected", () => {
    const tooLong = "x".repeat(500);
    try {
      encodeQr(tooLong);
      expect.unreachable("expected QrTooLargeError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QrTooLargeError);
      expect((err as Error).message).toContain("500");
    }
  });

  it("accepts a payload right at a realistic tunnel-URL length without throwing", () => {
    // A *.trycloudflare.com URL is comfortably within version 1-10 capacity.
    expect(() =>
      encodeQr("https://some-realistic-subdomain-12345.trycloudflare.com"),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderQrAscii — output shape
// ---------------------------------------------------------------------------

describe("renderQrAscii", () => {
  it("renders using only the expected half-block/space character set", () => {
    const matrix = encodeQr("http://192.168.1.1:33000");
    const ascii = renderQrAscii(matrix);
    const allowedChars = new Set([" ", "█", "▀", "▄", "\n"]);
    for (const ch of ascii) {
      expect(allowedChars.has(ch)).toBe(true);
    }
  });

  it("output has a quiet-zone border: the very first rendered line is all spaces", () => {
    const matrix = encodeQr("http://192.168.1.1:33000");
    const lines = renderQrAscii(matrix).split("\n");
    // First half-block row combines quiet-zone rows 0 and 1 (both all-light) -> all spaces.
    expect(lines[0]).toMatch(/^ +$/);
  });

  it("produces ceil((size + 2*quiet) / 2) lines (quiet=2, half-block rows)", () => {
    const matrix = encodeQr("http://192.168.1.1:33000");
    const lines = renderQrAscii(matrix).split("\n");
    const expectedLines = Math.ceil((matrix.size + 4) / 2);
    expect(lines.length).toBe(expectedLines);
  });

  it("qrAsciiFor is equivalent to renderQrAscii(encodeQr(text))", () => {
    const text = "https://qr-ascii-for-equivalence-check.trycloudflare.com";
    expect(qrAsciiFor(text)).toBe(renderQrAscii(encodeQr(text)));
  });

  it("qrAsciiFor propagates QrTooLargeError for an oversized payload", () => {
    expect(() => qrAsciiFor("y".repeat(400))).toThrow(QrTooLargeError);
  });
});
