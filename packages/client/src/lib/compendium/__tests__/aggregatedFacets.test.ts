/**
 * aggregatedFacets.test.ts — the facets of §5.4 (spec 43).
 *
 * REQ-CPD-033 [MVP]: facets of document type, level range and rarity, plus a
 * **source** facet that appears when the result comes from more than one pack.
 * REQ-CPD-034 [MVP]: facets combine with each other and with the text, and each
 * active facet is removable individually.
 *
 * The level and rarity halves travel to the server through
 * `buildSearchAllPayload` (tested in `compendiumBrowser.test.ts`); what is
 * tested here is the half the payload has no field for — document type and
 * source — plus the vocabulary that lets an active facet be seen and taken off.
 */

import { describe, expect, it } from "vitest";

import {
  applyAggregatedFacets,
  describeActiveFacets,
  documentTypeChoices,
  packDocumentTypeChoices,
  rarityChoices,
  sourceChoices,
} from "../aggregatedFacets.js";
import type { AggregatedSearchResult } from "../compendiumBrowser.js";
import { clearFacet, initialBrowserScope, setFacet } from "../browserScope.js";

function line(uuid: string, packId: string, packLabel: string, documentType: string) {
  return {
    entry: { _id: uuid, uuid, name: uuid, type: "npc" } as never,
    packId,
    packLabel,
    documentType,
  };
}

/** Two document types, three packs — enough for every facet to bite. */
function answer(): AggregatedSearchResult {
  return {
    groups: [
      {
        documentType: "Actor",
        total: 30,
        lines: [
          line("a1", "pf2e.bestiary", "Bestiário", "Actor"),
          line("a2", "pf2e.bestiary", "Bestiário", "Actor"),
          line("a3", "world.npcs", "NPCs do mundo", "Actor"),
        ],
        omitted: 27,
        packs: [
          { packId: "pf2e.bestiary", label: "Bestiário", matched: 28 },
          { packId: "world.npcs", label: "NPCs do mundo", matched: 2 },
        ],
      },
      {
        documentType: "Item",
        total: 2,
        lines: [line("i1", "pf2e.spells", "Magias", "Item")],
        omitted: 1,
        packs: [{ packId: "pf2e.spells", label: "Magias", matched: 2 }],
      },
    ],
  };
}

describe("the choices the panel offers (REQ-CPD-033)", () => {
  it("REQ-CPD-033: the document-type facet offers only types the seat can see", () => {
    const choices = documentTypeChoices([
      { documentType: "Item" },
      { documentType: "Actor" },
      { documentType: "Item" },
    ]);

    expect(choices.map((c) => c.value)).toEqual(["Actor", "Item"]);
    // Each one names itself by key, so the drawer never prints a raw type.
    expect(choices[0]?.labelKey).toBe("FUSION.Compendium.DocType.Actor");
  });

  it("REQ-CPD-033: a player's facet cannot name a type only a gm pack has", () => {
    // The packs handed in are already the audience-filtered ones (REQ-CPD-071),
    // so a bestiary the player never received contributes no "Actor" choice.
    const playerPacks = [{ documentType: "Item" }, { documentType: "JournalEntry" }];

    expect(documentTypeChoices(playerPacks).map((c) => c.value)).toEqual(["Item", "JournalEntry"]);
  });

  it("REQ-CPD-033: the rarity facet is the generic ladder, not a system-declared filter", () => {
    expect(rarityChoices().map((c) => c.value)).toEqual(["common", "uncommon", "rare", "unique"]);
  });

  // A040 — the document-type facet only hid itself inside a pack because the
  // panel hardcoded root-only, not because a pack could never offer a choice.
  // `PackManifest.documentType` is one value per pack (REQ-CMP-001), so this
  // is what makes it disappear inside a pack in practice: not a scope check,
  // but a real "there is no second type to filter by".
  it("REQ-CPD-033: no open pack offers no document-type choice at all", () => {
    expect(packDocumentTypeChoices(null)).toEqual([]);
  });

  it("REQ-CPD-033: an open pack offers only its OWN type, named by key", () => {
    const choices = packDocumentTypeChoices({ documentType: "Actor" });

    expect(choices).toEqual([{ value: "Actor", labelKey: "FUSION.Compendium.DocType.Actor" }]);
  });

  // "One pack, one type" is not a fact this function can fail to uphold: its
  // return is always `[]` or a one-element array literal (see
  // aggregatedFacets.ts `packDocumentTypeChoices`), so asserting
  // `.length <= 1` here would compare the output with its own construction —
  // circular, and infallible regardless of any real regression. What A040
  // actually changed is the PANEL's guard that reads this choice count to
  // decide whether to render the select; that behavior is covered where it
  // lives, on the template's own wiring:
  // `CompendiumBrowser.test.ts` → "inside a pack, the document-type facet
  // reads the OPEN PACK's own choices, not the shelf's" (REQ-CPD-033).

  it("REQ-CPD-033: the source facet lists the packs the ANSWER came from", () => {
    const sources = sourceChoices(answer());

    expect(sources.map((c) => c.value).sort()).toEqual([
      "pf2e.bestiary",
      "pf2e.spells",
      "world.npcs",
    ]);
    expect(sources.find((c) => c.value === "pf2e.spells")?.label).toBe("Magias");
  });

  it("REQ-CPD-033: one pack in the answer is not a source facet — there is nothing to choose", () => {
    const single: AggregatedSearchResult = {
      groups: [
        {
          documentType: "Item",
          total: 1,
          lines: [line("i1", "pf2e.spells", "Magias", "Item")],
          omitted: 0,
          packs: [{ packId: "pf2e.spells", label: "Magias", matched: 1 }],
        },
      ],
    };

    expect(sourceChoices(single)).toHaveLength(1);
    expect(sourceChoices(null)).toEqual([]);
  });
});

describe("an active facet is visible and comes off alone (REQ-CPD-034)", () => {
  it("REQ-CPD-034: every facet in force gets a chip of its own", () => {
    let state = initialBrowserScope();
    state = setFacet(state, "documentType", "Actor");
    state = setFacet(state, "rarity", "rare");
    state = setFacet(state, "minLevel", 5);
    state = setFacet(state, "maxLevel", 9);
    state = setFacet(state, "packId", "pf2e.bestiary");

    const chips = describeActiveFacets(state.facets, { sources: sourceChoices(answer()) });

    expect(chips.map((c) => c.facet)).toEqual([
      "documentType",
      "rarity",
      "minLevel",
      "maxLevel",
      "packId",
    ]);
    // The two ends of the range are two decisions, so they are two chips.
    expect(chips.find((c) => c.facet === "minLevel")?.valueText).toBe("5");
    expect(chips.find((c) => c.facet === "maxLevel")?.valueText).toBe("9");
    // The source chip says the pack's LABEL, not its id.
    expect(chips.find((c) => c.facet === "packId")?.valueText).toBe("Bestiário");
  });

  it("REQ-CPD-034: taking one chip off leaves the others exactly as they were", () => {
    let state = initialBrowserScope();
    state = setFacet(state, "minLevel", 5);
    state = setFacet(state, "rarity", "rare");

    const after = clearFacet(state, "minLevel");
    const chips = describeActiveFacets(after.facets);

    expect(chips.map((c) => c.facet)).toEqual(["rarity"]);
    expect(after.facets.rarity).toBe("rare");
  });

  it("REQ-CPD-034: a source chip whose pack left the answer still names something removable", () => {
    const state = setFacet(initialBrowserScope(), "packId", "pf2e.gone");
    const chips = describeActiveFacets(state.facets, { sources: sourceChoices(answer()) });

    expect(chips).toHaveLength(1);
    expect(chips[0]?.valueText).toBe("pf2e.gone");
  });

  it("REQ-CPD-034: no facet, no chips", () => {
    expect(describeActiveFacets(initialBrowserScope().facets)).toEqual([]);
  });
});

describe("applying the two facets the payload has no field for", () => {
  it("REQ-CPD-033: the document-type facet keeps only that type's group", () => {
    const filtered = applyAggregatedFacets(answer(), { documentType: "Item" });

    expect(filtered.groups.map((g) => g.documentType)).toEqual(["Item"]);
    // The server's own count survives untouched — nothing was recounted.
    expect(filtered.groups[0]?.total).toBe(2);
    expect(filtered.groups[0]?.omitted).toBe(1);
  });

  it("REQ-CPD-033: the source facet keeps that pack's lines, in every group", () => {
    const filtered = applyAggregatedFacets(answer(), { packId: "pf2e.bestiary" });

    expect(filtered.groups.map((g) => g.documentType)).toEqual(["Actor"]);
    expect(filtered.groups[0]?.lines.map((l) => l.entry.uuid)).toEqual(["a1", "a2"]);
  });

  it("REQ-CPD-032: under a source facet the group still says how many it hid, truthfully", () => {
    const filtered = applyAggregatedFacets(answer(), { packId: "pf2e.bestiary" });
    const group = filtered.groups[0];

    // 28 matched in that pack, 2 of them drawn — the tally is the server's, so
    // the notice never degrades into "what happened to survive truncation".
    expect(group?.total).toBe(28);
    expect(group?.omitted).toBe(26);
    expect(group?.packs).toEqual([{ packId: "pf2e.bestiary", label: "Bestiário", matched: 28 }]);
  });

  it("REQ-CPD-034: type and source combine — both apply, neither cancels the other", () => {
    const filtered = applyAggregatedFacets(answer(), {
      documentType: "Actor",
      packId: "world.npcs",
    });

    expect(filtered.groups).toHaveLength(1);
    expect(filtered.groups[0]?.lines.map((l) => l.entry.uuid)).toEqual(["a3"]);
    expect(filtered.groups[0]?.total).toBe(2);
  });

  it("REQ-CPD-036: a facet that matches nothing empties the body instead of lying", () => {
    const filtered = applyAggregatedFacets(answer(), { packId: "pf2e.nowhere" });

    expect(filtered.groups).toEqual([]);
  });

  it("no facet of this kind means the answer is handed through untouched", () => {
    const original = answer();

    expect(applyAggregatedFacets(original, { minLevel: 5 })).toBe(original);
  });
});
