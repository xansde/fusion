/**
 * tokenSheetWiring.test.ts — the gesture is actually plugged into the app.
 *
 * Spec: 41-token.md REQ-TOK-114 (the gesture must be reachable from the map)
 *
 * This repository has already shipped a TokenInteractionManager that was built,
 * unit-tested and never instantiated by the running app (see #194): dragging a
 * token was "implemented" and dead for weeks, because every test exercised the
 * class and none checked that TableScreen constructed it. A guard on the class
 * alone would repeat that mistake — so this file asserts the WIRING: that the
 * screen hands the manager an `onOpenSheet`, and that the callback reaches the
 * opener instead of stopping at a `TODO`.
 *
 * Comments are stripped first, so prose about the wiring never counts as it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("REQ-TOK-114: the double-click gesture is wired into the table screen", () => {
  const table = source("../../../components/TableScreen.svelte");

  it("the TokenInteractionManager built by the screen receives an onOpenSheet callback", () => {
    const construction = table.slice(table.indexOf("new TokenInteractionManager("));
    expect(construction).toContain("onOpenSheet:");
  });

  it("that callback opens a sheet — it does not stop at a stub", () => {
    const start = table.indexOf("onOpenSheet:");
    const end = table.indexOf("onError:", start);
    expect(start, "onOpenSheet not found").toBeGreaterThan(-1);
    expect(end, "onError (the delimiter after onOpenSheet) not found").toBeGreaterThan(start);
    const callback = table.slice(start, end);

    expect(callback).toContain("openTokenSheet(");
    expect(callback).not.toMatch(/TODO|FIXME|SCAFFOLDING/);
  });

  it("the screen imports the opener it calls", () => {
    expect(table).toContain('from "../lib/sheets/openTokenSheet.js"');
  });
});

describe("REQ-TOK-111: the guard lives with the gesture", () => {
  const manager = source("../../canvas/tokens/TokenInteractionManager.ts");

  it("the manager asks canOpenTokenSheet before calling onOpenSheet", () => {
    const call = manager.indexOf("onOpenSheet?.(");
    expect(call, "onOpenSheet is never called").toBeGreaterThan(-1);
    const guard = manager.lastIndexOf("canOpenTokenSheet(", call);
    expect(guard, "canOpenTokenSheet is not checked before opening").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
  });
});
