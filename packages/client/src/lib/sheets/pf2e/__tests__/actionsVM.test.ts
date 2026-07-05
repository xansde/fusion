/**
 * actionsVM.test.ts — headless unit tests for the Actions tab VM helpers.
 *
 * Mirrors the pure-VM test shape used across lib/sheets/pf2e. Covers:
 *   - shape-robust cost/group resolution (flattened scalar AND {value} wrapper)
 *   - row construction from pack index entries and embedded actor items
 *   - merge + dedupe (embedded/character action wins over same-slug pack action)
 *   - filtering (group toggles, cost filter, accent/case-insensitive search)
 *   - sorting (character actions first, then alphabetical)
 *   - load-error classification
 */

import { describe, it, expect } from "vitest";
import type { PackIndexEntry } from "@fusion/shared";
import { SocketUnavailableError } from "../../../compendium/compendiumApi.js";
import {
  resolveActionCost,
  resolveActionGroup,
  slugFromName,
  rowFromIndexEntry,
  rowFromEmbeddedItem,
  mergeActionRows,
  filterActionRows,
  sortActionRows,
  defaultFilterState,
  classifyLoadError,
  paginate,
  buildEmbeddedDetailsDoc,
  descriptionHtmlOf,
  ACTIONS_PAGE_SIZE,
  type ActionRow,
  type ActionCostFilter,
} from "../actionsVM.js";
import type { ActionGroup } from "../actionCategories.js";

// ---------------------------------------------------------------------------
// resolveActionCost — both shapes
// ---------------------------------------------------------------------------

describe("resolveActionCost()", () => {
  it("reads a flattened actionType/actions (post-transform pack shape)", () => {
    expect(resolveActionCost({ actionType: "action", actions: 1 }).kind).toBe("1");
    expect(resolveActionCost({ actionType: "action", actions: 2 }).kind).toBe("2");
    expect(resolveActionCost({ actionType: "action", actions: 3 }).kind).toBe("3");
    expect(resolveActionCost({ actionType: "reaction", actions: null }).kind).toBe("reaction");
    expect(resolveActionCost({ actionType: "free", actions: null }).kind).toBe("free");
    expect(resolveActionCost({ actionType: "passive" }).kind).toBe("passive");
  });

  it("reads the nested {value} vendor wrapper shape", () => {
    expect(resolveActionCost({ actionType: { value: "action" }, actions: { value: 2 } }).kind).toBe("2");
    expect(resolveActionCost({ actionType: { value: "reaction" }, actions: { value: null } }).kind).toBe(
      "reaction",
    );
  });

  it("maps kinds to the expected glyphs", () => {
    expect(resolveActionCost({ actionType: "action", actions: 1 }).glyphs).toBe("◆");
    expect(resolveActionCost({ actionType: "action", actions: 2 }).glyphs).toBe("◆◆");
    expect(resolveActionCost({ actionType: "action", actions: 3 }).glyphs).toBe("◆◆◆");
    expect(resolveActionCost({ actionType: "reaction" }).glyphs).toBe("⟳");
    expect(resolveActionCost({ actionType: "free" }).glyphs).toBe("◇");
    expect(resolveActionCost({ actionType: "passive" }).glyphs).toBe("");
  });

  it("falls back to unknown when nothing usable is present", () => {
    expect(resolveActionCost({}).kind).toBe("unknown");
    expect(resolveActionCost({ actionType: "action" }).kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// resolveActionGroup — folder axis, then mechanical axis, then other
// ---------------------------------------------------------------------------

describe("resolveActionGroup()", () => {
  it("prefers system.fusionCategory (the real importer-written field)", () => {
    const doc = { system: { category: "offensive", fusionCategory: "skill" } };
    expect(resolveActionGroup(doc)).toBe<ActionGroup>("skill");
  });

  it("maps every fusionCategory value the actions-core pack actually ships", () => {
    expect(resolveActionGroup({ system: { fusionCategory: "class" } })).toBe<ActionGroup>("class");
    expect(resolveActionGroup({ system: { fusionCategory: "archetype" } })).toBe<ActionGroup>("archetype");
    expect(resolveActionGroup({ system: { fusionCategory: "ancestry" } })).toBe<ActionGroup>("ancestry");
    expect(resolveActionGroup({ system: { fusionCategory: "heritage" } })).toBe<ActionGroup>("ancestry");
    expect(resolveActionGroup({ system: { fusionCategory: "background" } })).toBe<ActionGroup>("background");
    expect(resolveActionGroup({ system: { fusionCategory: "basic" } })).toBe<ActionGroup>("basic");
    expect(resolveActionGroup({ system: { fusionCategory: "skill" } })).toBe<ActionGroup>("skill");
    expect(resolveActionGroup({ system: { fusionCategory: "equipment" } })).toBe<ActionGroup>("equipment");
    expect(resolveActionGroup({ system: { fusionCategory: "exploration" } })).toBe<ActionGroup>("exploration");
    expect(resolveActionGroup({ system: { fusionCategory: "downtime" } })).toBe<ActionGroup>("downtime");
    expect(resolveActionGroup({ system: { fusionCategory: "spells" } })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({ system: { fusionCategory: "stamina" } })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({ system: { fusionCategory: "mythic" } })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({ system: { fusionCategory: "familiar" } })).toBe<ActionGroup>("other");
  });

  it("falls back to a re-injected legacy folder field (flags.fusion.actionFolder)", () => {
    const doc = { system: { category: "offensive" }, flags: { fusion: { actionFolder: "skill" } } };
    expect(resolveActionGroup(doc)).toBe<ActionGroup>("skill");
  });

  it("reads a system-level folder field too", () => {
    expect(resolveActionGroup({ system: { actionFolder: "class" } })).toBe<ActionGroup>("class");
  });

  it("falls back to the mechanical system.category axis", () => {
    expect(resolveActionGroup({ system: { category: "offensive" } })).toBe<ActionGroup>("basic");
    expect(resolveActionGroup({ system: { category: "interaction" } })).toBe<ActionGroup>("basic");
  });

  it("falls back to 'other' when nothing resolves", () => {
    expect(resolveActionGroup({ system: {} })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({})).toBe<ActionGroup>("other");
  });
});

// ---------------------------------------------------------------------------
// slugFromName
// ---------------------------------------------------------------------------

describe("slugFromName()", () => {
  it("kebab-cases and strips accents", () => {
    expect(slugFromName("Raise a Shield")).toBe("raise-a-shield");
    expect(slugFromName("Sense Motive")).toBe("sense-motive");
    expect(slugFromName("Açúcar Doce")).toBe("acucar-doce");
  });

  it("trims leading/trailing separators", () => {
    expect(slugFromName("  Fly!  ")).toBe("fly");
  });
});

// ---------------------------------------------------------------------------
// rowFromIndexEntry
// ---------------------------------------------------------------------------

function packEntry(name: string, index: Record<string, unknown>): PackIndexEntry {
  return {
    _id: slugFromName(name),
    uuid: `Compendium.pf2e.actions-core.Item.${slugFromName(name)}`,
    name,
    img: null,
    type: "action",
    index,
  };
}

describe("rowFromIndexEntry()", () => {
  it("builds a pack row from flattened index fields", () => {
    const entry = packEntry("Seek", {
      "system.actionType": "action",
      "system.actions": 1,
      "system.category": "interaction",
      "system.traits.value": ["concentrate", "secret"],
    });
    const row = rowFromIndexEntry(entry);
    expect(row.name).toBe("Seek");
    expect(row.slug).toBe("seek");
    expect(row.uuid).toBe(entry.uuid);
    expect(row.cost.kind).toBe("1");
    expect(row.traits).toEqual(["concentrate", "secret"]);
    expect(row.fromCharacter).toBe(false);
    expect(row.group).toBe<ActionGroup>("basic"); // via mechanical axis
  });

  it("reads system.fusionCategory from the index (real actions-core shape)", () => {
    const entry = packEntry("Anadi Venom", {
      "system.actionType": "action",
      "system.actions": 1,
      "system.category": "offensive",
      "system.fusionCategory": "ancestry",
      "system.traits.value": ["anadi"],
    });
    const row = rowFromIndexEntry(entry);
    expect(row.group).toBe<ActionGroup>("ancestry"); // folder axis wins over mechanical
  });

  it("builds a pack row from nested {value} index fields", () => {
    const entry = packEntry("Aid", {
      "system.actionType.value": "reaction",
      "system.actions.value": null,
      "system.traits.value": [],
    });
    const row = rowFromIndexEntry(entry);
    expect(row.cost.kind).toBe("reaction");
    expect(row.cost.glyphs).toBe("⟳");
  });
});

// ---------------------------------------------------------------------------
// rowFromEmbeddedItem
// ---------------------------------------------------------------------------

describe("rowFromEmbeddedItem()", () => {
  it("surfaces an embedded feat that is itself an action", () => {
    const item = {
      _id: "abc123",
      type: "feat",
      name: "Bon Mot",
      system: { actionType: "action", actions: 1, slug: "bon-mot", traits: { value: ["auditory"] } },
    };
    const row = rowFromEmbeddedItem(item);
    expect(row).not.toBeNull();
    expect(row?.fromCharacter).toBe(true);
    expect(row?.slug).toBe("bon-mot");
    expect(row?.key).toBe("embedded:abc123");
    expect(row?.uuid).toBeNull();
    expect(row?.cost.kind).toBe("1");
  });

  it("surfaces an embedded action-type item with a reaction cost", () => {
    const item = {
      _id: "r1",
      type: "action",
      name: "Attack of Opportunity",
      system: { actionType: "reaction", actions: null, traits: { value: [] } },
    };
    expect(rowFromEmbeddedItem(item)?.cost.kind).toBe("reaction");
  });

  it("returns null for a passive feat (not an action)", () => {
    const item = { _id: "p1", type: "feat", name: "Toughness", system: { actionType: "passive" } };
    expect(rowFromEmbeddedItem(item)).toBeNull();
  });

  it("returns null for non-action-bearing item types", () => {
    const item = { _id: "w1", type: "weapon", name: "Longsword", system: { actionType: "action" } };
    expect(rowFromEmbeddedItem(item)).toBeNull();
  });

  it("derives a slug from the name when system.slug is absent", () => {
    const item = { _id: "x", type: "action", name: "Raise a Shield", system: { actionType: "action", actions: 1 } };
    expect(rowFromEmbeddedItem(item)?.slug).toBe("raise-a-shield");
  });
});

// ---------------------------------------------------------------------------
// mergeActionRows — dedupe, embedded wins
// ---------------------------------------------------------------------------

describe("mergeActionRows()", () => {
  it("dedupes by slug with the embedded (character) row winning", () => {
    const pack = [
      packEntry("Raise a Shield", { "system.actionType": "action", "system.actions": 1 }),
      packEntry("Seek", { "system.actionType": "action", "system.actions": 1 }),
    ];
    const embedded = [
      {
        _id: "ras",
        type: "action",
        name: "Raise a Shield",
        system: { actionType: "action", actions: 1 },
      },
    ];
    const merged = mergeActionRows(pack, embedded);
    const raise = merged.filter((r) => r.slug === "raise-a-shield");
    expect(raise).toHaveLength(1);
    expect(raise[0]?.fromCharacter).toBe(true);
    expect(raise[0]?.key).toBe("embedded:ras");
    // Seek stays as the pack row.
    expect(merged.find((r) => r.slug === "seek")?.fromCharacter).toBe(false);
  });

  it("ignores embedded items that are not actions", () => {
    const embedded = [{ _id: "t", type: "feat", name: "Toughness", system: { actionType: "passive" } }];
    const merged = mergeActionRows([packEntry("Seek", { "system.actionType": "action", "system.actions": 1 })], embedded);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Seek");
  });

  it("keeps a character-only action with no matching pack row", () => {
    const embedded = [
      { _id: "s1", type: "feat", name: "Spellstrike", system: { actionType: "action", actions: 2, slug: "spellstrike" } },
    ];
    const merged = mergeActionRows([], embedded);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.fromCharacter).toBe(true);
    expect(merged[0]?.cost.kind).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// paginate — the "show more" arithmetic (r12 blocker: list capped at 60)
// ---------------------------------------------------------------------------

describe("paginate()", () => {
  const many = Array.from({ length: 521 }, (_, i) => i); // 521 actions in the pack

  it("caps the visible slice at PAGE_SIZE and flags there is more", () => {
    const p = paginate(many, ACTIONS_PAGE_SIZE);
    expect(ACTIONS_PAGE_SIZE).toBe(60);
    expect(p.visible).toHaveLength(60);
    expect(p.hasMore).toBe(true);
    expect(p.remaining).toBe(521 - 60);
  });

  it("reveals the next page when visibleCount is incremented (button works)", () => {
    const p1 = paginate(many, ACTIONS_PAGE_SIZE);
    const p2 = paginate(many, ACTIONS_PAGE_SIZE * 2);
    expect(p2.visible).toHaveLength(120);
    expect(p2.remaining).toBeLessThan(p1.remaining);
    expect(p2.hasMore).toBe(true);
  });

  it("lets the user reach EVERY row across successive increments", () => {
    let visibleCount = ACTIONS_PAGE_SIZE;
    let guard = 0;
    while (paginate(many, visibleCount).hasMore && guard < 100) {
      visibleCount += ACTIONS_PAGE_SIZE;
      guard += 1;
    }
    const final = paginate(many, visibleCount);
    expect(final.hasMore).toBe(false);
    expect(final.remaining).toBe(0);
    expect(final.visible).toHaveLength(many.length); // all 521 reachable
  });

  it("shows all rows and hides 'show more' when count >= length", () => {
    const p = paginate([1, 2, 3], 60);
    expect(p.visible).toEqual([1, 2, 3]);
    expect(p.hasMore).toBe(false);
    expect(p.remaining).toBe(0);
  });

  it("clamps a negative visibleCount to zero", () => {
    const p = paginate(many, -10);
    expect(p.visible).toHaveLength(0);
    expect(p.hasMore).toBe(true);
    expect(p.remaining).toBe(521);
  });

  it("handles an empty list", () => {
    const p = paginate<number>([], 60);
    expect(p.visible).toEqual([]);
    expect(p.hasMore).toBe(false);
    expect(p.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildEmbeddedDetailsDoc — character actions render their OWN description
// ---------------------------------------------------------------------------

describe("descriptionHtmlOf()", () => {
  it("passes through a flattened string description", () => {
    expect(descriptionHtmlOf({ description: "<p>Hit them.</p>" })).toBe("<p>Hit them.</p>");
  });

  it("unwraps the vendor {value} description wrapper", () => {
    expect(descriptionHtmlOf({ description: { value: "<p>Cast it.</p>" } })).toBe("<p>Cast it.</p>");
  });

  it("returns empty string when the description is missing or non-textual", () => {
    expect(descriptionHtmlOf({})).toBe("");
    expect(descriptionHtmlOf({ description: 42 })).toBe("");
    expect(descriptionHtmlOf({ description: { value: null } })).toBe("");
  });
});

describe("buildEmbeddedDetailsDoc()", () => {
  it("builds a panel doc from an embedded item, preserving name/type/system", () => {
    const item = {
      _id: "abc",
      type: "feat",
      name: "Bon Mot",
      system: {
        actionType: "action",
        actions: 1,
        description: "<p>Sling an insult.</p>",
        traits: { value: ["auditory"] },
      },
    };
    const doc = buildEmbeddedDetailsDoc(item);
    expect(doc).not.toBeNull();
    expect(doc?.["name"]).toBe("Bon Mot");
    expect(doc?.["type"]).toBe("feat");
    const system = doc?.["system"] as Record<string, unknown>;
    expect(system["description"]).toBe("<p>Sling an insult.</p>"); // string, panel-sanitizable
    expect(system["actions"]).toBe(1); // mechanical fields preserved for the panel
  });

  it("normalizes a {value}-wrapped description to a plain string", () => {
    const doc = buildEmbeddedDetailsDoc({
      _id: "x",
      type: "action",
      name: "Spellstrike",
      system: { description: { value: "<p>Channel a spell.</p>" } },
    });
    expect((doc?.["system"] as Record<string, unknown>)["description"]).toBe("<p>Channel a spell.</p>");
  });

  it("does not mutate the original item's system object", () => {
    const item = { _id: "y", type: "action", name: "Foo", system: { description: { value: "<p>x</p>" } } };
    buildEmbeddedDetailsDoc(item);
    // Original wrapper is untouched (we clone system before normalizing).
    expect(item.system.description).toEqual({ value: "<p>x</p>" });
  });

  it("falls back to defaults for a description-less item and empty system", () => {
    const doc = buildEmbeddedDetailsDoc({ _id: "z", type: "action", name: "Bare" });
    expect((doc?.["system"] as Record<string, unknown>)["description"]).toBe("");
  });

  it("returns null for a non-record input", () => {
    expect(buildEmbeddedDetailsDoc(null)).toBeNull();
    expect(buildEmbeddedDetailsDoc(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterActionRows
// ---------------------------------------------------------------------------

function row(partial: Partial<ActionRow> & { name: string; slug: string; group: ActionGroup }): ActionRow {
  return {
    key: partial.key ?? partial.slug,
    uuid: partial.uuid ?? null,
    slug: partial.slug,
    name: partial.name,
    group: partial.group,
    cost: partial.cost ?? { kind: "1", glyphs: "◆" },
    traits: partial.traits ?? [],
    fromCharacter: partial.fromCharacter ?? false,
  };
}

describe("filterActionRows()", () => {
  const rows: ActionRow[] = [
    row({ name: "Seek", slug: "seek", group: "basic", cost: { kind: "1", glyphs: "◆" } }),
    row({ name: "Demoralize", slug: "demoralize", group: "skill", cost: { kind: "1", glyphs: "◆" } }),
    row({ name: "Aid", slug: "aid", group: "basic", cost: { kind: "reaction", glyphs: "⟳" } }),
    row({ name: "Battle Medicine", slug: "battle-medicine", group: "skill", cost: { kind: "1", glyphs: "◆" } }),
    row({ name: "Investigate", slug: "investigate", group: "exploration", cost: { kind: "unknown", glyphs: "" } }),
  ];

  it("shows all rows with the default filter state", () => {
    expect(filterActionRows(rows, defaultFilterState())).toHaveLength(rows.length);
  });

  it("hides rows whose group is disabled", () => {
    const f = defaultFilterState();
    f.groups.delete("skill");
    const out = filterActionRows(rows, f);
    expect(out.map((r) => r.slug)).not.toContain("demoralize");
    expect(out.map((r) => r.slug)).not.toContain("battle-medicine");
  });

  it("applies a cost filter (reaction only)", () => {
    const f = defaultFilterState();
    f.costs = new Set<ActionCostFilter>(["reaction"]);
    const out = filterActionRows(rows, f);
    expect(out.map((r) => r.slug)).toEqual(["aid"]);
  });

  it("excludes unknown/passive cost rows when any cost filter is active", () => {
    const f = defaultFilterState();
    f.costs = new Set<ActionCostFilter>(["1"]);
    const out = filterActionRows(rows, f);
    expect(out.map((r) => r.slug)).not.toContain("investigate");
  });

  it("searches by name accent/case-insensitively", () => {
    const f = defaultFilterState();
    f.search = "SEEK";
    expect(filterActionRows(rows, f).map((r) => r.slug)).toEqual(["seek"]);
    const f2 = defaultFilterState();
    f2.search = "medicine";
    expect(filterActionRows(rows, f2).map((r) => r.slug)).toEqual(["battle-medicine"]);
  });
});

// ---------------------------------------------------------------------------
// sortActionRows
// ---------------------------------------------------------------------------

describe("sortActionRows()", () => {
  it("floats character actions to the top, then sorts alphabetically", () => {
    const rows: ActionRow[] = [
      row({ name: "Zephyr", slug: "zephyr", group: "basic" }),
      row({ name: "Alpha", slug: "alpha", group: "basic" }),
      row({ name: "Beta", slug: "beta", group: "class", fromCharacter: true }),
      row({ name: "Aardvark", slug: "aardvark", group: "class", fromCharacter: true }),
    ];
    const sorted = sortActionRows(rows);
    expect(sorted.map((r) => r.name)).toEqual(["Aardvark", "Beta", "Alpha", "Zephyr"]);
  });
});

// ---------------------------------------------------------------------------
// classifyLoadError
// ---------------------------------------------------------------------------

describe("classifyLoadError()", () => {
  it("maps SocketUnavailableError to not-connected", () => {
    expect(classifyLoadError(new SocketUnavailableError())).toBe("not-connected");
  });

  it("maps any other error to load", () => {
    expect(classifyLoadError(new Error("boom"))).toBe("load");
    expect(classifyLoadError("nope")).toBe("load");
  });
});
