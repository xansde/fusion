/**
 * cost.test.ts — `actionBarCostToken`, the adapter between the bar's structured cost and
 * the client's existing `formatActionCost` (BAR-F1-02, Q-BAR-06, D-15).
 *
 * The bar declares its cost as `ActionBarCost` (pure data, no locale) and shows it with
 * `formatActionCost(actionBarCostToken(cost), locale)`, so the glyph table and the labels
 * live in ONE place (`lib/compendium/documentDetails.ts`). These tests therefore run the
 * REAL formatter instead of restating its table.
 *
 * The cost is display only (D-15): nothing here counts, spends or blocks an action.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatActionCost } from "$lib/compendium/documentDetails.js";
import { actionBarCostToken } from "../cost.js";
import type { ActionBarCost } from "../types.js";

/** What the slot would show for `cost`: the token run through the real formatter. */
function shown(cost: ActionBarCost, locale: "pt-BR" | "en" = "pt-BR") {
  return formatActionCost(actionBarCostToken(cost), locale);
}

describe("actionBarCostToken — the token the existing formatter understands", () => {
  const table: Array<[string, ActionBarCost, string]> = [
    ["1 action", { kind: "action", count: 1 }, "1"],
    ["2 actions", { kind: "action", count: 2 }, "2"],
    ["3 actions", { kind: "action", count: 3 }, "3"],
    ["reaction", { kind: "reaction" }, "reaction"],
    ["free action", { kind: "free" }, "free"],
    ["activity of 1 to 3 actions", { kind: "activity", unit: "action", min: 1, max: 3 }, "1 to 3"],
    ["activity of 2 to 3 actions", { kind: "activity", unit: "action", min: 2, max: 3 }, "2 to 3"],
    ["activity of 2 actions, no max", { kind: "activity", unit: "action", min: 2 }, "2"],
    ["activity with max equal to min", { kind: "activity", unit: "action", min: 2, max: 2 }, "2"],
    ["activity of 1 minute", { kind: "activity", unit: "minute", min: 1 }, "1 minute"],
    ["activity of 10 minutes", { kind: "activity", unit: "minute", min: 10 }, "10 minutes"],
    ["activity of 1 hour", { kind: "activity", unit: "hour", min: 1 }, "1 hour"],
    ["activity of 2 hours", { kind: "activity", unit: "hour", min: 2 }, "2 hours"],
    ["activity of 1 day", { kind: "activity", unit: "day", min: 1 }, "1 day"],
    ["activity of 3 days", { kind: "activity", unit: "day", min: 3 }, "3 days"],
    [
      "time range uses an en dash, which the action-range parser cannot swallow",
      { kind: "activity", unit: "minute", min: 1, max: 2 },
      "1–2 minutes",
    ],
  ];

  it.each(table)("%s", (_name, cost, token) => {
    expect(actionBarCostToken(cost)).toBe(token);
  });

  it.each([
    ["passive", { kind: "passive" }],
    ["none", { kind: "none" }],
  ] as Array<[string, ActionBarCost]>)("%s has no seal: null", (_name, cost) => {
    expect(actionBarCostToken(cost)).toBeNull();
  });
});

describe("actionBarCostToken through the real formatActionCost (pt-BR)", () => {
  const table: Array<[string, ActionBarCost, string, string, boolean]> = [
    ["1 action", { kind: "action", count: 1 }, "◆", "1 ação", false],
    ["2 actions", { kind: "action", count: 2 }, "◆◆", "2 ações", false],
    ["3 actions", { kind: "action", count: 3 }, "◆◆◆", "3 ações", false],
    ["reaction", { kind: "reaction" }, "⟳", "reação", false],
    ["free action", { kind: "free" }, "◇", "ação livre", false],
    [
      "activity of 1 to 3 actions",
      { kind: "activity", unit: "action", min: 1, max: 3 },
      "◆ a ◆◆◆",
      "1 a 3 ações",
      false,
    ],
    [
      "activity of 2 to 3 actions",
      { kind: "activity", unit: "action", min: 2, max: 3 },
      "◆◆ a ◆◆◆",
      "2 a 3 ações",
      false,
    ],
    [
      "activity with max equal to min collapses to the single glyph",
      { kind: "activity", unit: "action", min: 2, max: 2 },
      "◆◆",
      "2 ações",
      false,
    ],
    [
      "activity of 2 actions without max is the single glyph",
      { kind: "activity", unit: "action", min: 2 },
      "◆◆",
      "2 ações",
      false,
    ],
    [
      "activity in minutes is text without a glyph",
      { kind: "activity", unit: "minute", min: 10 },
      "",
      "10 minutos",
      true,
    ],
    [
      "activity of one minute is singular",
      { kind: "activity", unit: "minute", min: 1 },
      "",
      "1 minuto",
      true,
    ],
    [
      "activity in hours is text without a glyph",
      { kind: "activity", unit: "hour", min: 1 },
      "",
      "1 hora",
      true,
    ],
    [
      "activity in days is text without a glyph",
      { kind: "activity", unit: "day", min: 2 },
      "",
      "2 dias",
      true,
    ],
    [
      "a time range is text, never read as an action range",
      { kind: "activity", unit: "minute", min: 1, max: 2 },
      "",
      "1–2 minutos",
      true,
    ],
  ];

  it.each(table)("%s", (_name, cost, icons, label, isText) => {
    expect(shown(cost)).toEqual({ icons, label, isText });
  });
});

describe("actionBarCostToken through the real formatActionCost (en)", () => {
  it("shows the glyphs and the English labels", () => {
    expect(shown({ kind: "action", count: 2 }, "en")).toEqual({
      icons: "◆◆",
      label: "2 actions",
      isText: false,
    });
    expect(shown({ kind: "activity", unit: "action", min: 1, max: 3 }, "en")).toEqual({
      icons: "◆ to ◆◆◆",
      label: "1 to 3 actions",
      isText: false,
    });
    expect(shown({ kind: "reaction" }, "en")).toEqual({
      icons: "⟳",
      label: "reaction",
      isText: false,
    });
    expect(shown({ kind: "activity", unit: "minute", min: 10 }, "en")).toEqual({
      icons: "",
      label: "10 minutes",
      isText: true,
    });
  });
});

describe("ActionBarCost has the shape of the Alchemist plan's cost (Q-BAR-06)", () => {
  /**
   * `ActionCost` of ALQ-F7-02 (docs/design/alquimista/tasks.md §2.11), restated: that plan keeps its
   * own type in the satellite, and the core never imports it. A value of that shape must still be
   * accepted by the bar WITHOUT a conversion — structural typing. The two assignments below are
   * the proof (checked by the typecheck, in both directions).
   */
  type AlchemistActionCost =
    | { kind: "action"; count: 1 | 2 | 3 }
    | { kind: "reaction" }
    | { kind: "free" }
    | { kind: "activity"; min: number; max?: number; unit: "action" | "minute" | "hour" | "day" }
    | { kind: "passive" }
    | { kind: "none" };

  it("accepts a value of that shape without conversion, and the other way round", () => {
    const fromAlchemist: AlchemistActionCost = { kind: "activity", min: 1, max: 3, unit: "action" };
    const asBarCost: ActionBarCost = fromAlchemist;
    const backToAlchemist: AlchemistActionCost = asBarCost;

    expect(actionBarCostToken(asBarCost)).toBe("1 to 3");
    expect(backToAlchemist).toBe(fromAlchemist);
  });
});

describe("one ActionCost in the client (Q-BAR-06)", () => {
  /** Every `.ts` / `.svelte` file under `packages/client/src`, test folders excluded. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
      const path = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        return dirent.name === "node_modules" || dirent.name === "__tests__"
          ? []
          : sourceFiles(path);
      }
      return /\.(ts|svelte)$/.test(dirent.name) ? [path] : [];
    });
  }

  it("is declared only by the compendium: the bar's own type is ActionBarCost", () => {
    const srcRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const declaration = /export\s+(?:interface|type)\s+ActionCost\b/;

    const declaring = sourceFiles(srcRoot)
      .filter((file) => declaration.test(readFileSync(file, "utf8")))
      .map((file) => relative(srcRoot, file).split(sep).join("/"));

    expect(declaring).toEqual(["lib/compendium/documentDetails.ts"]);
  });
});
