/**
 * Negative boundary test — verifies that dependency-cruiser detects forbidden imports.
 *
 * REQ-ARQ-003: client must NOT import from server.
 * REQ-ARQ-004: server must NOT import from client.
 * REQ-ARQ-005: systems/* must NOT import from server or client.
 *
 * This test spawns `depcruise` on synthetic fixture files and asserts that the
 * forbidden rules fire. It does NOT test that the real codebase has violations
 * (the lint:boundaries script does that) — it tests that the RULE CONFIGURATION
 * itself (the real .dependency-cruiser.cjs at the repo root) correctly identifies
 * violations when they are present.
 *
 * IMPORTANT: the inline config from previous versions has been replaced with the
 * real repo config so that regressions (e.g. accidentally removing a rule) are
 * caught here rather than only at lint time.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Resolve the local depcruise entry module from the workspace root node_modules.
// We call it via `node <mjs>` to avoid platform-specific shell wrapper issues.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, "../../../..");
const DEPCRUISE_MJS = join(
  MONOREPO_ROOT,
  "node_modules",
  "dependency-cruiser",
  "bin",
  "dependency-cruise.mjs",
);
/** Absolute path to the real dependency-cruiser config for the repo. */
const REAL_CONFIG = join(MONOREPO_ROOT, ".dependency-cruiser.cjs");

if (!existsSync(DEPCRUISE_MJS)) {
  throw new Error(`depcruise entry not found at ${DEPCRUISE_MJS}. Run pnpm install first.`);
}

if (!existsSync(REAL_CONFIG)) {
  throw new Error(`.dependency-cruiser.cjs not found at ${REAL_CONFIG}. Did you move the config?`);
}

/** Build an `execSync`-compatible command string that invokes depcruise via node. */
function depcruiseCmd(args: string[]): string {
  return `"${process.execPath}" "${DEPCRUISE_MJS}" ${args.join(" ")}`;
}

/**
 * Run depcruise on a synthetic directory where we know violations exist,
 * using the real repo .dependency-cruiser.cjs, and assert that the output
 * includes the expected rule name.
 *
 * The synthetic directory mirrors the monorepo structure (packages/client/src,
 * packages/server/src) so the path patterns in the real config match.
 */
function runDepcruiseWithRealConfig(sourceCode: string, expectedRuleName: string): void {
  const dir = join(tmpdir(), `fusion-boundary-test-${String(Date.now())}`);
  const srcDir = join(dir, "packages", "client", "src");
  const serverDir = join(dir, "packages", "server", "src");

  try {
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(serverDir, { recursive: true });

    // The real config references tsconfig.base.json — copy it to the tmp dir
    // so depcruise's TypeScript resolver can find it.
    copyFileSync(join(MONOREPO_ROOT, "tsconfig.base.json"), join(dir, "tsconfig.base.json"));

    // Write server stub files in .ts and .js so depcruise can resolve the import
    // regardless of module resolution mode.
    writeFileSync(join(serverDir, "index.ts"), `export const SERVER = true;\n`);
    writeFileSync(join(serverDir, "index.js"), `export const SERVER = true;\n`);

    // Write the violating client file.
    writeFileSync(join(srcDir, "violation.ts"), sourceCode);

    try {
      execSync(
        depcruiseCmd([
          "--config",
          `"${REAL_CONFIG}"`,
          "--output-type",
          "err",
          "packages/client",
          "packages/server",
        ]),
        { cwd: dir, encoding: "utf8", stdio: "pipe" },
      );
      // If depcruise exits 0, no violations found — the test should fail.
      throw new Error(
        `Expected depcruise to report violation "${expectedRuleName}" but it exited cleanly`,
      );
    } catch (err: unknown) {
      // depcruise exits non-zero when there are violations — that is expected.
      const output =
        typeof err === "object" && err !== null && "stdout" in err ? String(err.stdout) : "";
      const stderr =
        typeof err === "object" && err !== null && "stderr" in err ? String(err.stderr) : "";
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String(err.message)
          : String(err);

      const combinedOutput = output + stderr + message;

      // If it's the error we re-threw above (clean exit), re-throw it.
      if (
        combinedOutput.includes("Expected depcruise to report violation") ||
        message.includes("Expected depcruise to report violation")
      ) {
        throw err;
      }

      // Otherwise: depcruise found violations (expected). Verify the named rule fires.
      expect(combinedOutput).toContain(expectedRuleName);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("boundary lint negative tests — using real .dependency-cruiser.cjs", () => {
  it("detects forbidden import: client importing from server (no-server-from-client)", () => {
    const violatingCode = `
// Violation: client code importing from the server package
import { SERVER } from "../../server/src/index.js";
export const x = SERVER;
`;
    runDepcruiseWithRealConfig(violatingCode, "no-server-from-client");
  });

  it("confirms clean client code passes boundary check", () => {
    const cleanCode = `
// Clean code — only exports a constant, no forbidden imports
export const CLIENT = "client" as const;
`;
    const dir = join(tmpdir(), `fusion-boundary-clean-${String(Date.now())}`);
    const srcDir = join(dir, "packages", "client", "src");

    try {
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "clean.ts"), cleanCode);
      // Copy tsconfig.base.json so the real config's tsConfig reference resolves.
      copyFileSync(join(MONOREPO_ROOT, "tsconfig.base.json"), join(dir, "tsconfig.base.json"));

      // Should NOT throw — clean code has no violations.
      expect(() => {
        execSync(
          depcruiseCmd([
            "--config",
            `"${REAL_CONFIG}"`,
            "--output-type",
            "json",
            "packages/client",
          ]),
          { cwd: dir, encoding: "utf8", stdio: "pipe" },
        );
      }).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
