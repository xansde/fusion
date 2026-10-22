/**
 * Guard for the `server` project's `isolate: false` (vitest.isolation.ts): a
 * test file that replaces a module-level registry, mocks a module or blocks
 * the worker with spawnSync must run in `server-isolated`, or the files that
 * share its worker inherit its state — failures that move around with file
 * order and look like flakiness.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ISOLATED_TEST_FILES, ISOLATION_PATTERNS } from "../../vitest.isolation";

const SERVER_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...testFiles(p));
    else if (e.name.endsWith(".test.ts") && p.split(sep).includes("__tests__"))
      out.push(relative(SERVER_ROOT, p).split(sep).join("/"));
  }
  return out;
}

describe("server test isolation list", () => {
  const files = testFiles(join(SERVER_ROOT, "src"));

  it("every test file that leaves module-level state behind runs isolated", () => {
    const listed = new Set(ISOLATED_TEST_FILES);
    const missing = files.filter((f) => {
      if (listed.has(f) || f === "src/__tests__/isolation-list.test.ts") return false;
      const src = readFileSync(join(SERVER_ROOT, f), "utf8");
      return ISOLATION_PATTERNS.some((re) => re.test(src));
    });
    expect(missing, "add these to packages/server/vitest.isolation.ts").toEqual([]);
  });

  it("every listed file exists (a stale entry would silently stop matching)", () => {
    expect(ISOLATED_TEST_FILES.filter((f) => !existsSync(join(SERVER_ROOT, f)))).toEqual([]);
  });
});
