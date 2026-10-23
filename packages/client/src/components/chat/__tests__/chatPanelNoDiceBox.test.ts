/**
 * chatPanelNoDiceBox.test.ts — the dice-box leaves the panel (plan G040).
 *
 * RNF-ACH-03 [MVP] (DEC-ACH-12, spec 38 §4): the chat panel MUST NOT host a 3D dice canvas
 * NOR load the corresponding code. Two different promises live in that sentence, and this
 * file proves both, because proving only the first would let the second rot:
 *
 *   1. nothing on screen — no canvas host, no "3D dice" switch in the "⋯" menu;
 *   2. nothing fetched — opening the tab must not pull the dice-box code, which in a Vite
 *      build means the panel's chunk must not depend on it, neither by a static import
 *      (same chunk / eager sibling) nor by a dynamic `import()` fired on open (a lazy chunk
 *      requested the moment the reader switches to Chat).
 *
 * Point 2 is checked in two complementary ways: a module-load spy (the mock factory of
 * `diceBoxBridge` / `@3d-dice/dice-box` records the fact of being evaluated, and importing
 * and rendering the panel must leave it un-evaluated) and a walk over the panel's static
 * import graph (no module reachable from ChatPanel names the dice-box, by static import or
 * by `import()`), which is the shape Rollup reads when it decides the chunks.
 *
 * The bridge itself stays in the repository, switched off, per DEC-ACH-12 — this task
 * unplugs it, it does not delete it.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { render } from "svelte/server";

// The two module ids the panel must never pull in. The factories are only ever evaluated
// if something imports them, so an empty `loaded` list is the evidence.
const { loaded } = vi.hoisted(() => ({ loaded: [] as string[] }));

vi.mock("../../../lib/chat/diceBoxBridge.js", () => {
  loaded.push("lib/chat/diceBoxBridge");
  return {
    animateRoll: (): Promise<void> => Promise.resolve(),
    setDiceBoxEnabled: (): void => undefined,
    isDiceBoxEnabled: (): boolean => false,
  };
});

vi.mock("@3d-dice/dice-box", () => {
  loaded.push("@3d-dice/dice-box");
  return { default: class FakeDiceBox {} };
});

import ChatPanel from "../ChatPanel.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";

import type { Socket } from "socket.io-client";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "../../..");
const PANEL = resolve(CLIENT_SRC, "components/chat/ChatPanel.svelte");
const BRIDGE = resolve(CLIENT_SRC, "lib/chat/diceBoxBridge.ts");

/** The panel never touches the socket during a server render. */
const socket = {} as unknown as Socket;

function installStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
      key: (i: number): string | null => [...store.keys()][i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
}

function renderPanel(isGm = false): string {
  installStorage();
  const { body, head } = render(ChatPanel, {
    props: { socket, worldId: "world-abc", userId: "user-1", isGm },
  });
  return `${head}${body}`;
}

// ---------------------------------------------------------------------------
// Static import graph — what Rollup reads when it lays out the chunks
// ---------------------------------------------------------------------------

const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

/** Resolve a relative (or `$lib/`-aliased) specifier the way Vite does for `.js` endings. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("$lib/")) return null;
  const base = spec.startsWith("$lib/")
    ? resolve(CLIENT_SRC, "lib", spec.slice("$lib/".length))
    : resolve(dirname(fromFile), spec);
  const candidates = base.endsWith(".js")
    ? [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".svelte.ts"), base]
    : [base, `${base}.ts`, `${base}.svelte.ts`, resolve(base, "index.ts")];
  return candidates.find(isFile) ?? null;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

interface GraphFile {
  readonly path: string;
  /** Every specifier this module imports, static or dynamic, exactly as written. */
  readonly specifiers: readonly string[];
  /** The subset that is not a path into this package. */
  readonly bareImports: readonly string[];
}

/** Every module reachable from `entry` by static import or by `import()`. */
function walkImportGraph(entry: string): GraphFile[] {
  const seen = new Set<string>();
  const queue = [entry];
  const files: GraphFile[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    const specifiers: string[] = [];
    const bare: string[] = [];
    for (const match of source.matchAll(SPECIFIER)) {
      const spec = match[1];
      if (spec === undefined) continue;
      specifiers.push(spec);
      const target = resolveSpecifier(file, spec);
      if (target === null) bare.push(spec);
      else queue.push(target);
    }
    files.push({ path: file, specifiers, bareImports: bare });
  }

  return files;
}

// ---------------------------------------------------------------------------

describe("RNF-ACH-03: o painel não hospeda canvas de dado 3D", () => {
  it("does not draw a dice canvas host, for a player or for the GAMEMASTER", () => {
    for (const body of [renderPanel(false), renderPanel(true)]) {
      expect(body).not.toContain('id="dice-canvas"');
      expect(body).not.toContain("dice-canvas");
      expect(body).not.toContain("<canvas");
    }
  });

  it("no longer offers the 3D dice switch in the ⋯ menu", () => {
    const body = renderPanel(true);
    expect(body).not.toContain('data-action="dice3d"');
    expect(body).not.toContain('role="menuitemcheckbox"');
    // The menu still exists — only that one entry left it.
    expect(body).toContain('data-action="favorites"');
  });

  it("keeps the panel's own bands intact — the removal costs nothing else", () => {
    const body = renderPanel(true);
    expect(body).toContain('type="search"');
    expect(body).toContain("chat-input__textarea");
  });
});

describe("RNF-ACH-03: abrir a aba não carrega o código do dice-box", () => {
  it("evaluates neither the bridge nor @3d-dice/dice-box when the panel is imported and rendered", () => {
    renderPanel(true);
    renderPanel(false);
    expect(loaded).toEqual([]);
  });

  it("never reaches the dice-box from the panel's static import graph", () => {
    const graph = walkImportGraph(PANEL);

    expect(graph.length).toBeGreaterThan(3);
    expect(graph.map((f) => f.path)).not.toContain(BRIDGE);
    for (const file of graph) {
      expect(file.bareImports).not.toContain("@3d-dice/dice-box");
    }
  });

  it("fires no dynamic import() of the dice-box on open either", () => {
    // A lazy chunk requested at mount would still be "loading the code when the tab
    // opens", which is exactly what RNF-ACH-03 forbids. `SPECIFIER` captures the target
    // of `import(...)` just like a static `from "..."`, so a dynamic pull would show up
    // here — prose about the dice-box would not, and must not fail the test.
    for (const file of walkImportGraph(PANEL)) {
      for (const spec of file.specifiers) {
        expect(spec, `${file.path} imports it`).not.toMatch(/3d-dice|diceBox/i);
      }
    }
  });

  it("stops calling setRollAnimator — the store's animator slot stays empty (DEC-ACH-12)", () => {
    const panelSource = readFileSync(PANEL, "utf8");
    // The panel used to register an animator on mount purely to drive the dice canvas.
    expect(panelSource).not.toMatch(/setRollAnimator\s*\(/);
    expect(panelSource).not.toMatch(/animateRoll\s*\(/);
  });
});

describe("DEC-ACH-12: a dependência fica no repositório, desligada", () => {
  it("keeps lib/chat/diceBoxBridge.ts on disk — the wiring was cut, not the file", () => {
    expect(existsSync(BRIDGE)).toBe(true);
  });
});
