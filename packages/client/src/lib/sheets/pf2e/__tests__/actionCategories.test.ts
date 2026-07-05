/**
 * actionCategories.test.ts — coverage + integrity tests for the Actions tab
 * category grouping.
 *
 * Two layers (mirrors traitGroups.test.ts):
 *   1. Pure unit tests against the group maps/resolvers with synthetic input.
 *   2. A live coverage check against the real vendor `actions` folder tree
 *      (tools/importer-pf2e/vendor/pf2e/packs/pf2e/actions/*) — guards against
 *      a future vendor bump introducing a new top-level action folder that
 *      silently has no display group (the task's "nenhuma categoria do pack
 *      sem grupo" requirement).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ACTION_GROUPS,
  ACTION_GROUP_ORDER,
  ACTION_GROUP_LABELS,
  GROUP_LABEL_KEYS,
  VENDOR_FOLDER_TO_GROUP,
  KNOWN_VENDOR_FOLDERS,
  MECHANICAL_CATEGORY_TO_GROUP,
  groupFromFolder,
  groupFromMechanicalCategory,
  groupLabel,
  groupLabelKey,
  type ActionGroup,
} from "../actionCategories.js";

// ---------------------------------------------------------------------------
// Part 1 — Map integrity
// ---------------------------------------------------------------------------

describe("action group maps integrity", () => {
  it("every group has a pt-BR label and an i18n key", () => {
    for (const group of ACTION_GROUPS) {
      expect(ACTION_GROUP_LABELS[group], `group ${group} has no label`).toBeTruthy();
      expect(GROUP_LABEL_KEYS[group], `group ${group} has no i18n key`).toMatch(
        /^FUSION\.Sheet\.Actions\.Group\./,
      );
    }
  });

  it("ACTION_GROUP_ORDER lists every group exactly once", () => {
    const sorted = [...ACTION_GROUP_ORDER].sort();
    const expected = [...ACTION_GROUPS].sort();
    expect(sorted).toEqual(expected);
    expect(ACTION_GROUP_ORDER).toHaveLength(ACTION_GROUPS.length);
  });

  it("every vendor-folder mapping targets a declared group", () => {
    for (const [folder, group] of Object.entries(VENDOR_FOLDER_TO_GROUP)) {
      expect(ACTION_GROUPS, `folder ${folder} -> unknown group ${group}`).toContain(group);
    }
  });

  it("every mechanical-category mapping targets a declared group", () => {
    for (const [cat, group] of Object.entries(MECHANICAL_CATEGORY_TO_GROUP)) {
      expect(ACTION_GROUPS, `category ${cat} -> unknown group ${group}`).toContain(group);
    }
  });

  it("groupLabel/groupLabelKey resolve for every group", () => {
    for (const group of ACTION_GROUPS) {
      expect(groupLabel(group)).toBe(ACTION_GROUP_LABELS[group]);
      expect(groupLabelKey(group)).toBe(GROUP_LABEL_KEYS[group]);
    }
  });
});

// ---------------------------------------------------------------------------
// Part 2 — Resolver behavior
// ---------------------------------------------------------------------------

describe("groupFromFolder()", () => {
  it("maps the curated folders to their groups", () => {
    expect(groupFromFolder("basic")).toBe<ActionGroup>("basic");
    expect(groupFromFolder("skill")).toBe<ActionGroup>("skill");
    expect(groupFromFolder("class")).toBe<ActionGroup>("class");
    expect(groupFromFolder("exploration")).toBe<ActionGroup>("exploration");
    expect(groupFromFolder("downtime")).toBe<ActionGroup>("downtime");
    expect(groupFromFolder("equipment")).toBe<ActionGroup>("equipment");
    expect(groupFromFolder("archetype")).toBe<ActionGroup>("archetype");
    expect(groupFromFolder("background")).toBe<ActionGroup>("background");
  });

  it("buckets ancestry AND heritage under the same Ancestralidade group", () => {
    expect(groupFromFolder("ancestry")).toBe<ActionGroup>("ancestry");
    expect(groupFromFolder("heritage")).toBe<ActionGroup>("ancestry");
  });

  it("buckets familiar/spells/stamina/mythic under Outras", () => {
    expect(groupFromFolder("familiar")).toBe<ActionGroup>("other");
    expect(groupFromFolder("spells")).toBe<ActionGroup>("other");
    expect(groupFromFolder("stamina")).toBe<ActionGroup>("other");
    expect(groupFromFolder("mythic")).toBe<ActionGroup>("other");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(groupFromFolder("  BASIC ")).toBe<ActionGroup>("basic");
    expect(groupFromFolder("Class")).toBe<ActionGroup>("class");
  });

  it("returns null for unknown / non-string input", () => {
    expect(groupFromFolder("nope")).toBeNull();
    expect(groupFromFolder(null)).toBeNull();
    expect(groupFromFolder(undefined)).toBeNull();
  });
});

describe("groupFromMechanicalCategory()", () => {
  it("maps the four PF2e mechanical categories to a group", () => {
    expect(groupFromMechanicalCategory("offensive")).not.toBeNull();
    expect(groupFromMechanicalCategory("interaction")).not.toBeNull();
    expect(groupFromMechanicalCategory("defensive")).not.toBeNull();
    expect(groupFromMechanicalCategory("precision")).not.toBeNull();
  });

  it("returns null for classfeature and unknown categories", () => {
    expect(groupFromMechanicalCategory("classfeature")).toBeNull();
    expect(groupFromMechanicalCategory("whatever")).toBeNull();
    expect(groupFromMechanicalCategory(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 3 — Live coverage against the vendor actions folder tree
// ---------------------------------------------------------------------------

describe("Live vendor folder coverage", () => {
  function vendorActionsDir(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(
      here,
      "../../../../../../../tools/importer-pf2e/vendor/pf2e/packs/pf2e/actions",
    );
  }

  it("every top-level vendor action folder maps to a display group", () => {
    const dir = vendorActionsDir();
    if (!existsSync(dir)) {
      // Vendor tree is gitignored/optional in some checkouts — skip rather
      // than fail when it is not present. KNOWN_VENDOR_FOLDERS still guards
      // the curated set below.
      return;
    }

    const folders = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const ungrouped = folders.filter((f) => groupFromFolder(f) === null);
    expect(
      ungrouped,
      `Vendor action folders with no display group: ${ungrouped.join(", ")}`,
    ).toHaveLength(0);
  });

  it("the curated KNOWN_VENDOR_FOLDERS all resolve to a group", () => {
    for (const folder of KNOWN_VENDOR_FOLDERS) {
      expect(groupFromFolder(folder), `folder ${folder} ungrouped`).not.toBeNull();
    }
  });
});
