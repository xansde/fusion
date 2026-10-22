/**
 * Guard: nothing outside the socket handshake reads the access token as a SNAPSHOT.
 *
 * The JWT lives 15 minutes and nothing renews it in the background. A caller that
 * reads `fusionApi.getToken()` and hands it to a raw `fetch` (asset grant mint,
 * file picker, users admin…) sends a dead token once the session is older than
 * that, and the request comes back 401 — the "asset-grant 401 after ~20 min"
 * seen in a long session: portraits fall back to initials, the ambient track goes
 * silent, the file picker cannot list. `getFreshToken()` refreshes first when the
 * token is expired or about to be; every such caller must use it.
 *
 * The socket is the one legitimate snapshot reader: its handshake is answered
 * right after a reconnect, and its own auth-error path refreshes.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Files allowed to call `fusionApi.getToken()` (path relative to `src/`, posix). */
const ALLOWED = new Set(["lib/api.ts", "lib/session.svelte.ts"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|svelte)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("access token freshness guard", () => {
  it("only the socket wiring reads the token snapshot; every other caller asks for a fresh one", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file).split(sep).join("/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(join(SRC, rel), "utf8").includes("fusionApi.getToken()"));
    expect(offenders).toEqual([]);
  });

  it("session.svelte.ts reads the snapshot only to hand it to the socket", () => {
    const text = readFileSync(join(SRC, "lib/session.svelte.ts"), "utf8");
    const uses = text.split("\n").filter((line) => line.includes("fusionApi.getToken()"));
    expect(uses).toHaveLength(1);
  });
});
