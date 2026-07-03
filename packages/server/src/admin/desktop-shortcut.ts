/**
 * Windows Desktop shortcut creation (REQ-DST-016/017, M6/B2).
 *
 * Minimal implementation behind an OPTIONAL button in the wizard UI: writes
 * a `.bat` file to the user's Desktop that re-launches the currently-running
 * executable with the same `--data-dir`, then opens the browser at the
 * configured URL. This is deliberately NOT a `.lnk` (Windows shortcut binary
 * format) — generating a real `.lnk` requires either a native COM call
 * (WScript.Shell, not available from Node without a new dependency) or a
 * handcrafted binary `.lnk` writer (fragile, error-prone, high risk for a
 * low-value cosmetic difference). A `.bat` double-clicks and runs identically
 * from the GM's perspective; the icon is generic but REQ-DST-016 lists Start
 * Menu entry / autostart as fuller (V2/optional) capability — this batch
 * ships the minimal "double-click launches the server" version.
 *
 * Only implemented for win32 — REQ-DST-016 is explicitly a Windows
 * requirement. Other platforms return a clear "not supported" result rather
 * than silently writing nothing.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface CreateDesktopShortcutParams {
  /** Data directory to pass via --data-dir so the shortcut opens the same install. */
  dataDir: string;
  /** Port to open in the browser after launch. */
  port: number;
  /**
   * Absolute path to the currently-running executable (process.execPath for
   * a Node SEA binary, or the fusion CLI entry when run via `node`/pnpm in
   * dev). Passed in rather than resolved here so tests can supply a
   * deterministic fake path.
   */
  execPath: string;
  /** Override for tests — defaults to the real Windows Desktop folder. */
  desktopDirOverride?: string;
}

export interface CreateDesktopShortcutResult {
  ok: boolean;
  path?: string;
  message: string;
}

/** Resolve the current user's Desktop folder on Windows. */
export function resolveWindowsDesktopDir(): string {
  return join(homedir(), "Desktop");
}

/**
 * Create `Fusion VTT.bat` on the Desktop. Idempotent — overwrites any
 * previous shortcut written by this function (same filename).
 */
export function createDesktopShortcut(
  params: CreateDesktopShortcutParams,
  os: NodeJS.Platform = platform(),
): CreateDesktopShortcutResult {
  if (os !== "win32") {
    return {
      ok: false,
      message: "Desktop shortcut creation is only supported on Windows (REQ-DST-016).",
    };
  }

  const desktopDir = params.desktopDirOverride ?? resolveWindowsDesktopDir();
  if (!existsSync(desktopDir)) {
    return {
      ok: false,
      message: `Desktop folder not found at "${desktopDir}".`,
    };
  }

  const shortcutPath = join(desktopDir, "Fusion VTT.bat");
  const url = `http://localhost:${String(params.port)}`;

  // @echo off + start the exe detached, then open the default browser at the
  // management URL. `start ""` with an empty title avoids the first quoted
  // argument being misread as the window title (a classic Windows batch
  // gotcha when the target path itself is quoted).
  const script = [
    "@echo off",
    `start "" "${params.execPath}" serve --data-dir "${params.dataDir}" --port ${String(params.port)}`,
    "timeout /t 2 /nobreak >nul",
    `start "" "${url}"`,
    "",
  ].join("\r\n");

  try {
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(shortcutPath, script, "utf8");
    return { ok: true, path: shortcutPath, message: "Desktop shortcut created." };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to write Desktop shortcut: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
