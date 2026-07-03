/**
 * Unit tests for admin/desktop-shortcut.ts (REQ-DST-016/017, M6/B2).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDesktopShortcut, resolveWindowsDesktopDir } from "../desktop-shortcut.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-desktop-shortcut-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createDesktopShortcut", () => {
  it("writes a .bat file on win32 with the exe path, data dir, and port", () => {
    const desktopDir = makeTempDir();

    const result = createDesktopShortcut(
      {
        dataDir: "C:\\Users\\gm\\Documents\\FusionVTT",
        port: 33000,
        execPath: "C:\\Program Files\\Fusion\\fusion-server.exe",
        desktopDirOverride: desktopDir,
      },
      "win32",
    );

    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(desktopDir, "Fusion VTT.bat"));
    expect(existsSync(result.path!)).toBe(true);

    const content = readFileSync(result.path!, "utf8");
    expect(content).toContain("fusion-server.exe");
    expect(content).toContain("FusionVTT");
    expect(content).toContain("33000");
    expect(content).toContain("http://localhost:33000");
  });

  it("is idempotent — a second call overwrites the same file", () => {
    const desktopDir = makeTempDir();
    const params = {
      dataDir: "C:\\data",
      port: 33000,
      execPath: "C:\\fusion.exe",
      desktopDirOverride: desktopDir,
    };

    createDesktopShortcut(params, "win32");
    const second = createDesktopShortcut({ ...params, port: 33001 }, "win32");

    expect(second.ok).toBe(true);
    const content = readFileSync(second.path!, "utf8");
    expect(content).toContain("33001");
  });

  it("refuses on non-Windows platforms with a clear message", () => {
    const desktopDir = makeTempDir();
    const result = createDesktopShortcut(
      {
        dataDir: "/home/gm/FusionVTT",
        port: 33000,
        execPath: "/usr/bin/fusion",
        desktopDirOverride: desktopDir,
      },
      "linux",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Windows/i);
  });

  it("reports failure clearly when the Desktop folder does not exist", () => {
    const missingDir = join(tmpdir(), `fusion-missing-desktop-${String(Date.now())}`);
    const result = createDesktopShortcut(
      {
        dataDir: "C:\\data",
        port: 33000,
        execPath: "C:\\fusion.exe",
        desktopDirOverride: missingDir,
      },
      "win32",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  it("resolveWindowsDesktopDir returns a path ending in Desktop", () => {
    expect(resolveWindowsDesktopDir()).toMatch(/Desktop$/);
  });
});
