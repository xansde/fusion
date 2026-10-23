/**
 * Tests for tools/release/exe-icon.mjs — packs PNGs into a multi-size .ico and
 * stamps it on the Windows executable BEFORE the SEA blob is injected.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { packIco, readIcoSizes, applyIcon, readExeIconSizes } from "../exe-icon.mjs";

const ICON_SIZES = [16, 24, 32, 48, 64, 256];
const ICO_PATH = fileURLToPath(new URL("../assets/fusion.ico", import.meta.url));

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-exe-icon-test-"));
  cleanupDirs.push(dir);
  return dir;
}

/** Minimal valid PNG header carrying only the IHDR dimensions (packIco reads nothing else). */
function fakePng(size: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(size, 16);
  buf.writeUInt32BE(size, 20);
  return buf;
}

describe("packIco", () => {
  it("writes an ICONDIR with one PNG entry per size, 256 encoded as 0", () => {
    const ico = packIco(ICON_SIZES.map((s) => fakePng(s)));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(ICON_SIZES.length);
    expect(ico[6]).toBe(16);
    expect(ico[6 + 16 * 5]).toBe(0); // 256 -> 0
    expect(readIcoSizes(ico)).toEqual(ICON_SIZES);
  });

  it("rejects a buffer that is not a PNG", () => {
    expect(() => packIco([Buffer.alloc(40)])).toThrow(/PNG/);
  });
});

describe("committed fusion.ico", () => {
  it("carries every required size", () => {
    expect(readIcoSizes(readFileSync(ICO_PATH))).toEqual(ICON_SIZES);
  });
});

describe.skipIf(process.platform !== "win32")("applyIcon", () => {
  it("stamps the icon on a copy of node.exe, keeping it a runnable PE", () => {
    const dir = makeTempDir();
    const exe = join(dir, "host.exe");
    copyFileSync(process.execPath, exe);
    applyIcon(exe, ICO_PATH);
    expect(readExeIconSizes(exe)).toEqual(ICON_SIZES);
    expect(readFileSync(exe).subarray(0, 2).toString("ascii")).toBe("MZ");
  }, 120_000);

  it("refuses a file that is not a PE executable", () => {
    const dir = makeTempDir();
    const bad = join(dir, "bad.exe");
    writeFileSync(bad, "not an exe");
    expect(() => applyIcon(bad, ICO_PATH)).toThrow();
  });
});
