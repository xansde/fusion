/**
 * Tests for the SEA client-dist extraction module (M6/B3 — REQ-DST-002).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packDirectory } from "../native-loader.js";
import {
  ensureClientDistExtracted,
  clientDistRuntimeDir,
  CLIENT_DIST_ASSET_KEY,
} from "../sea-assets.js";

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("ensureClientDistExtracted", () => {
  it("extracts the packed client dist to <dataDir>/runtime/<version>/client-dist/", async () => {
    const distSrc = makeTempDir("fusion-client-dist-src-");
    mkdirSync(join(distSrc, "assets-client"), { recursive: true });
    writeFileSync(join(distSrc, "index.html"), "<html>fake shell</html>");
    writeFileSync(join(distSrc, "assets-client", "app.js"), "console.log('hi')");
    const archive = packDirectory(distSrc);

    const dataDir = makeTempDir("fusion-sea-assets-datadir-");
    const destDir = await ensureClientDistExtracted({
      dataDir,
      version: "1.0.0",
      getRawAsset: (key) => {
        expect(key).toBe(CLIENT_DIST_ASSET_KEY);
        return toArrayBuffer(archive);
      },
    });

    expect(destDir).toBe(clientDistRuntimeDir(dataDir, "1.0.0"));
    expect(existsSync(join(destDir, "index.html"))).toBe(true);
    expect(existsSync(join(destDir, "assets-client", "app.js"))).toBe(true);
  });

  it("is a cache-hit no-op when the sidecar hash already matches", async () => {
    const distSrc = makeTempDir("fusion-client-dist-src2-");
    writeFileSync(join(distSrc, "index.html"), "<html>fake shell</html>");
    const archive = packDirectory(distSrc);
    const dataDir = makeTempDir("fusion-sea-assets-datadir2-");

    const options = {
      dataDir,
      version: "1.0.0",
      getRawAsset: () => toArrayBuffer(archive),
    };
    const destDir = await ensureClientDistExtracted(options);
    const firstMtime = statSync(join(destDir, "index.html")).mtimeMs;

    await ensureClientDistExtracted(options);
    const secondMtime = statSync(join(destDir, "index.html")).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });
});
