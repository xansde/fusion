/**
 * planColumn-variant-rules.test.ts — REQ-CFG-033/REQ-MCL-004 (spec 37 DEC-CFG-08,
 * spec 30 DEC-MCL-09, G103): the character sheet lost the free-archetype and
 * multiclass-by-class-levels toggles. Their only surface now is the
 * Configurações tab's Mundo section (WorldSection.svelte, REQ-CFG-032).
 *
 * `PlanColumn.svelte` is not mounted here (no `.svelte` component in this repo
 * is — see clientPrefs.test.ts's structural pattern, which this mirrors): the
 * write path's ABSENCE is a source-level guarantee, not a click that never
 * happens to fire in one test run. `planVM.ts`'s `setFreeArchetype`/
 * `setClassLevelsVariant` op builders still exist and are still covered by
 * their own tests (planVM.test.ts, class-levels-plan.test.ts) — REQ-CFG-033
 * is about the FICHA not offering a control, not about deleting the pure op
 * builder a future caller could still use; what this file proves is that the
 * sheet component itself never calls them anymore.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relativeToThisFile: string): string {
  const path = fileURLToPath(new URL(relativeToThisFile, import.meta.url));
  return readFileSync(path, "utf-8");
}

describe("REQ-CFG-033: PlanColumn.svelte no longer writes a variant rule", () => {
  const source = readSource("../PlanColumn.svelte");

  it("never calls the free-archetype or multiclass-by-levels op builders", () => {
    expect(source).not.toMatch(/\bsetFreeArchetype\s*\(/);
    expect(source).not.toMatch(/\bsetClassLevelsVariant\s*\(/);
  });

  it("does not even import the two write-side op builders (read-side getClassLevelsVariant is still legitimate — it only drives level-up's class-picking flow)", () => {
    expect(source).not.toMatch(/\bsetFreeArchetype\b/);
    expect(source).not.toMatch(/\bsetClassLevelsVariant\b/);
    // The READ is fine to keep — REQ-CFG-033 removes the CONTROL, not the
    // sheet's ability to know the mundo-derived state it is rendering.
    expect(source).toMatch(/\bgetClassLevelsVariant\b/);
  });

  it("renders no checkbox/toggle labelled for either variant rule (the i18n keys the old toggles used are gone from the markup)", () => {
    expect(source).not.toMatch(/FUSION\.Sheet\.Plan\.FreeArchetypeToggle/);
    expect(source).not.toMatch(/FUSION\.Sheet\.Plan\.ClassLevelsToggle/);
  });
});

describe("REQ-CFG-033: the removed i18n keys have no other reader", () => {
  it("no .svelte/.ts source under components/ or lib/ references the retired toggle keys", () => {
    // A deliberately narrow, dependency-free scan (no glob lib pulled in for
    // one assertion): walk the app's own source root and fail if either
    // retired key resurfaces anywhere.
    const rootA = fileURLToPath(new URL("../../../../../", import.meta.url)); // packages/client/src
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        const full = `${dir}/${entry}`;
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else if (entry.endsWith(".svelte") || entry.endsWith(".ts")) {
          const text = readFileSync(full, "utf-8");
          if (/FUSION\.Sheet\.Plan\.(FreeArchetypeToggle|ClassLevelsToggle)/.test(text)) {
            offenders.push(full);
          }
        }
      }
    }

    walk(rootA);
    expect(offenders).toEqual([]);
  });
});
