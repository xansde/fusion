/**
 * base.css declares only tokens somebody reads (ui-acabamento, 22/10/2026).
 *
 * ui-fundacao added 24 aliases ("--fusion-color-text", "--fusion-warn"…) for components written
 * against names nobody had declared; the UI lanes then migrated every component to the canonical
 * names, and the aliases were left with no reader. A token nobody reads is a second name for the
 * same colour waiting for the next component to pick the wrong one — so every custom property
 * base.css declares must be read somewhere (client, its prototypes, or the satellite's sheets).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE_CSS = join(CLIENT, "src/styles/base.css");
const SATELLITE = join(CLIENT, "../../external/fusion-systems-2e");

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(svelte|ts|css|html)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("base.css tokens", () => {
  it("every declared --fusion-* token is read somewhere", () => {
    const css = readFileSync(BASE_CSS, "utf8");
    const declared = new Set([...css.matchAll(/(--fusion-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    const corpus = [
      ...files(join(CLIENT, "src")),
      ...files(join(CLIENT, "prototypes")),
      ...files(join(SATELLITE, "sheets")),
      ...files(join(SATELLITE, "systems")),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const read = new Set([...corpus.matchAll(/var\(\s*(--fusion-[a-z0-9-]+)/g)].map((m) => m[1]!));
    // TS reads a token by name (getPropertyValue("--fusion-x") / canvas helpers).
    const named = new Set(
      [...corpus.matchAll(/["'`](--fusion-[a-z0-9-]+)["'`]/g)].map((m) => m[1]!),
    );
    const unread = [...declared].filter((name) => !read.has(name) && !named.has(name)).sort();
    expect(unread).toEqual([]);
  });
});
