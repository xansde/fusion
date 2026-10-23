/**
 * dragEffects.test.ts — the map and the NPC row have to agree on an OPERATION,
 * not only on a MIME type (REQ-NPC-063, REQ-UIF-044/045/046).
 *
 * The defect this file pins (TK042a, roteiro manual de 22–23/08: "não dá pra
 * arrastar NPC pra cena") had nothing to do with the payload. A real browser
 * gesture, instrumented with capture/bubble listeners, showed everything the
 * app is normally asserted on working perfectly:
 *
 *   dragstart/bubble: target=LI.npcs-row types=[application/fusion-actor] effectAllowed=move
 *   dragover/bubble:  types=[application/fusion-actor] dropEffect=copy defaultPrevented=true
 *   dragend:          dropEffect=none          ← and `drop` NEVER fired
 *
 * The row wrote the right MIME, the canvas recognised it and called
 * `preventDefault()` — and Chromium still refused the drop, because a source
 * that allows only "move" cannot complete a drop asking for "copy". The
 * negotiation the HTML spec runs between `effectAllowed` and `dropEffect` is
 * invisible from either component alone: each half reads correct on its own.
 *
 * Hence two levels here:
 *
 *   1. `allowsDropEffect` — the browser's rule written down, exercised as a
 *      table (including the exact pair that failed: move × copy).
 *   2. The CONTRACT between the two components: the values they actually
 *      assign are extracted from their source and run through that rule. This
 *      is deliberately not `expect(source).toContain("copyMove")` — a string
 *      match would pass on a comment and prove nothing about the operation. The
 *      values are resolved (literal or named constant) and then judged by the
 *      rule, so re-hardcoding an incompatible effect on either side fails here,
 *      which is what a regression of TK042a would look like.
 *
 * What only a real browser can prove (a drop actually firing, a token actually
 * created) is covered by the roteiro `npc-drag-canvas.spec.ts` of the local
 * `tutorial-e2e` skill — this file is the cheap guard that runs in CI.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  allowsDropEffect,
  CANVAS_DROP_EFFECT,
  NPC_DRAG_EFFECT_ALLOWED,
  NPC_FOLDER_DROP_EFFECT,
  type DropEffect,
} from "../dragEffects.js";

/** Source with every comment removed, so prose ABOUT an assignment is never read as one. */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body of a named function, from its declaration to the next one. */
function functionBody(text: string, name: string, nextName: string): string {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${nextName}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  expect(end, `${nextName} (the delimiter after ${name}) not found`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** The exported constants, by name, so a named assignment resolves to its value. */
const NAMED_EFFECTS: Readonly<Record<string, string>> = {
  CANVAS_DROP_EFFECT,
  NPC_DRAG_EFFECT_ALLOWED,
  NPC_FOLDER_DROP_EFFECT,
};

/**
 * The value a snippet assigns to `dataTransfer.<property>` — a string literal
 * as-is, a named constant resolved through `NAMED_EFFECTS`. An unknown name
 * fails loudly instead of silently passing.
 */
function assignedEffect(snippet: string, property: "effectAllowed" | "dropEffect"): string {
  const match = new RegExp(`\\.${property}\\s*=\\s*(?:"([^"]+)"|([A-Za-z_$][\\w$]*))`).exec(
    snippet,
  );
  expect(match, `no assignment to dataTransfer.${property} found`).not.toBeNull();
  const literal = match?.[1];
  if (literal !== undefined) return literal;
  const name = match?.[2] ?? "";
  const resolved = NAMED_EFFECTS[name];
  expect(
    resolved,
    `dataTransfer.${property} is assigned from ${name}, which this test cannot resolve`,
  ).toBeDefined();
  return resolved ?? "";
}

describe("HTML5 drag operation negotiation (the rule the browser applies)", () => {
  const cases: readonly [string, DropEffect, boolean][] = [
    // The exact pair that broke TK042a: the row allowed only a move, the map asked to copy.
    ["move", "copy", false],
    ["move", "move", true],
    ["copy", "copy", true],
    ["copy", "move", false],
    ["copyMove", "copy", true],
    ["copyMove", "move", true],
    ["copyMove", "link", false],
    ["all", "copy", true],
    ["uninitialized", "copy", true],
    ["none", "copy", false],
  ];

  for (const [effectAllowed, dropEffect, expected] of cases) {
    it(`effectAllowed="${effectAllowed}" ${expected ? "allows" : "refuses"} dropEffect="${dropEffect}"`, () => {
      expect(allowsDropEffect(effectAllowed, dropEffect)).toBe(expected);
    });
  }

  it('dropEffect "none" is never a drop — it is the browser saying the drop cannot happen', () => {
    expect(allowsDropEffect("all", "none")).toBe(false);
  });
});

describe("REQ-NPC-063 / REQ-UIF-046: the NPC row and the map agree on an operation", () => {
  it("the effect the row allows lets the canvas complete the drop it asks for", () => {
    const panel = source("../../../components/npcs/NpcsPanel.svelte");
    const table = source("../../../components/TableScreen.svelte");

    const rowAllows = assignedEffect(
      functionBody(panel, "onNpcDragStart", "onFolderDragOver"),
      "effectAllowed",
    );
    const canvasAsks = assignedEffect(
      functionBody(table, "handleCanvasDragOver", "handleCanvasDrop"),
      "dropEffect",
    ) as DropEffect;

    expect(
      allowsDropEffect(rowAllows, canvasAsks),
      `the row declares effectAllowed="${rowAllows}" and the canvas asks for dropEffect="${canvasAsks}": ` +
        "the browser resolves that to no operation at all and never fires `drop`",
    ).toBe(true);
  });

  it("REQ-NPC-028/029: and the same drag still completes on a folder, which moves instead of copying", () => {
    const panel = source("../../../components/npcs/NpcsPanel.svelte");

    const rowAllows = assignedEffect(
      functionBody(panel, "onNpcDragStart", "onFolderDragOver"),
      "effectAllowed",
    );
    const folderAsks = assignedEffect(
      functionBody(panel, "onFolderDragOver", "onFolderDragLeave"),
      "dropEffect",
    ) as DropEffect;

    expect(
      allowsDropEffect(rowAllows, folderAsks),
      `the row declares effectAllowed="${rowAllows}" but the folder asks for dropEffect="${folderAsks}"`,
    ).toBe(true);
  });
});
