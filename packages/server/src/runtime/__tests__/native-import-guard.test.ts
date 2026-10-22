/**
 * Regression guard for #285: under the SEA executable, a top-level VALUE import
 * of a native addon (`import Database from "better-sqlite3"`) becomes a bare
 * `require()` in the esbuild bundle, which Node's SEA loader rejects with
 * ERR_UNKNOWN_BUILTIN_MODULE before native-loader.ts can redirect it. Native
 * addons must be loaded through `createRequire` (db/connection.ts,
 * auth/crypto.ts) or imported as types only. This scans the server sources so
 * the mistake fails in `pnpm test` instead of only in the (manual) release smoke.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const NATIVE_SPECIFIERS = ["better-sqlite3", "@node-rs/argon2"];
// Dev-only tooling that never enters the SEA bundle.
const EXCLUDED_DIRS = new Set(["__tests__", "scripts"]);

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDED_DIRS.has(name)) listSources(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Matches a value import/export/re-export (anything that is not `import type`). */
function valueImportRegex(specifier: string): RegExp {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/@-]/g, String.raw`\$&`);
  return new RegExp(
    String.raw`^\s*(?:import\s+(?!type\b)[^;]*?from\s*|export\s+(?!type\b)[^;]*?from\s*|import\s*)["']${escaped}["']`,
    "m",
  );
}

describe("native addons are never value-imported in the SEA bundle graph (#285)", () => {
  const files = listSources(SRC_ROOT);

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const specifier of NATIVE_SPECIFIERS) {
    it(`no static value import of "${specifier}" outside type-only imports`, () => {
      const re = valueImportRegex(specifier);
      const offenders = files
        .filter((file) => re.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")))
        .map((file) => relative(SRC_ROOT, file));
      expect(offenders).toEqual([]);
    });
  }
});
