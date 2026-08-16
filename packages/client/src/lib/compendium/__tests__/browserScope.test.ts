/**
 * browserScope.test.ts — the two modes of the compendium panel, and the scope
 * that decides which one is on screen (spec 43, G091).
 *
 * The panel has no mode switch: the body IS a function of (scope, text, facets).
 * These tests exercise that function and the four gestures that move the scope
 * around — open a pack, widen the same search back to the whole collection, go
 * back to the shelf, and type — as pure transitions, with no component mounted.
 *
 * Covers REQ-CPD-010, REQ-CPD-011, REQ-CPD-012, REQ-CPD-013, REQ-CPD-014,
 * REQ-CPD-015. REQ-CPD-016 (the search bar lives outside the scrolling area)
 * and REQ-CPD-017 (switching mode never changes the drawer's width) are facts
 * about the rendered panel and are asserted in
 * `components/compendium/__tests__/CompendiumBrowser.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  backToShelf,
  bodyMode,
  buildScopedSearchQuery,
  canWidenToWholeCollection,
  clearFacet,
  describeScope,
  hasActiveFacets,
  initialBrowserScope,
  openPack,
  setFacet,
  setSearch,
  widenToWholeCollection,
  type BrowserScopeState,
} from "../browserScope.js";

const SPELLS = { id: "pf2e.spells-core", label: "Magias" };

/** Root scope, "fogo" typed, nothing else. */
function rootSearching(text = "fogo"): BrowserScopeState {
  return setSearch(initialBrowserScope(), text);
}

describe("browserScope — the mode is derived, never chosen", () => {
  it("REQ-CPD-010: only two body modes exist, and both come out of the state", () => {
    // Exhaustive over the state space that matters: scope × (text, facet).
    const states: BrowserScopeState[] = [
      initialBrowserScope(),
      rootSearching(),
      setFacet(initialBrowserScope(), "rarity", "rare"),
      openPack(initialBrowserScope(), SPELLS),
      setSearch(openPack(initialBrowserScope(), SPELLS), "fogo"),
    ];

    for (const state of states) {
      expect(["shelf", "results"]).toContain(bodyMode(state));
    }
  });

  it("REQ-CPD-011: root scope with an empty search and no facet is the shelf", () => {
    expect(bodyMode(initialBrowserScope())).toBe("shelf");
    // Whitespace is not a search — it would flip the body for a stray space.
    expect(bodyMode(setSearch(initialBrowserScope(), "   "))).toBe("shelf");
  });

  it("REQ-CPD-012: at root, typed text OR an active facet gives the aggregated result", () => {
    expect(bodyMode(rootSearching())).toBe("results");

    const faceted = setFacet(initialBrowserScope(), "documentType", "Actor");
    expect(hasActiveFacets(faceted.facets)).toBe(true);
    expect(bodyMode(faceted)).toBe("results");

    // And a level range counts as a facet just like the rest.
    expect(bodyMode(setFacet(initialBrowserScope(), "maxLevel", 5))).toBe("results");
  });

  it("REQ-CPD-011/012: erasing the text puts the shelf back", () => {
    const back = setSearch(rootSearching(), "");
    expect(bodyMode(back)).toBe("shelf");
  });

  it("REQ-CPD-012: removing the last facet individually puts the shelf back", () => {
    const faceted = setFacet(setFacet(initialBrowserScope(), "rarity", "rare"), "maxLevel", 5);
    const oneLeft = clearFacet(faceted, "rarity");
    expect(bodyMode(oneLeft)).toBe("results");
    expect(bodyMode(clearFacet(oneLeft, "maxLevel"))).toBe("shelf");
  });

  it("REQ-CPD-013: opening a pack moves the scope and clears the typed text", () => {
    const opened = openPack(rootSearching("goblin"), SPELLS);

    expect(opened.scope).toEqual({ kind: "pack", packId: SPELLS.id, packLabel: SPELLS.label });
    expect(opened.search).toBe("");
    // The pack index is a listing, not the shelf.
    expect(bodyMode(opened)).toBe("results");
  });

  it("REQ-CPD-013: opening a pack drops a source facet that the scope now supersedes", () => {
    const withSource = setFacet(initialBrowserScope(), "packId", "pf2e.bestiary-core");
    const opened = openPack(withSource, SPELLS);

    expect(opened.facets.packId).toBeUndefined();
  });

  it("REQ-CPD-014: with a pack open, the search is confined to that pack", () => {
    const inPack = setSearch(openPack(initialBrowserScope(), SPELLS), "fogo");

    const query = buildScopedSearchQuery(inPack);
    expect(query.packId).toBe(SPELLS.id);
    expect(query.text).toBe("fogo");
  });

  it("REQ-CPD-014: at root the same search names no pack — it is the whole collection", () => {
    expect(buildScopedSearchQuery(rootSearching()).packId).toBeUndefined();
  });

  it("REQ-CPD-014: widening keeps the typed text and takes the scope back to root", () => {
    const inPack = setFacet(
      setSearch(openPack(initialBrowserScope(), SPELLS), "fogo"),
      "maxLevel",
      3,
    );

    expect(canWidenToWholeCollection(inPack)).toBe(true);

    const widened = widenToWholeCollection(inPack);
    expect(widened.scope.kind).toBe("root");
    expect(widened.search).toBe("fogo");
    expect(widened.facets.maxLevel).toBe(3);
    // Same text, wider net: still the aggregated result, never the shelf.
    expect(bodyMode(widened)).toBe("results");
    expect(buildScopedSearchQuery(widened).packId).toBeUndefined();
  });

  it("REQ-CPD-014: there is nothing to widen when the scope is already the whole collection", () => {
    expect(canWidenToWholeCollection(rootSearching())).toBe(false);
    expect(canWidenToWholeCollection(initialBrowserScope())).toBe(false);
  });

  it("REQ-CPD-015: the scope is always describable, with a way back from a pack", () => {
    const root = describeScope(initialBrowserScope());
    expect(root.packLabel).toBeNull();
    expect(root.canGoBack).toBe(false);
    expect(root.labelKey).toBe("FUSION.Compendium.Scope.All");

    const inPack = describeScope(openPack(initialBrowserScope(), SPELLS));
    expect(inPack.packLabel).toBe("Magias");
    expect(inPack.canGoBack).toBe(true);
    expect(inPack.labelKey).toBe("FUSION.Compendium.Scope.Pack");
  });

  it("REQ-CPD-015: the way back lands on the shelf, not on a leftover search", () => {
    const messy = setFacet(
      setSearch(openPack(initialBrowserScope(), SPELLS), "fogo"),
      "rarity",
      "rare",
    );

    const back = backToShelf(messy);
    expect(back.scope.kind).toBe("root");
    expect(back.search).toBe("");
    expect(hasActiveFacets(back.facets)).toBe(false);
    expect(bodyMode(back)).toBe("shelf");
  });

  it("REQ-CPD-010: every transition returns a new state — nothing is mutated in place", () => {
    const before = initialBrowserScope();
    const after = setSearch(before, "fogo");

    expect(before.search).toBe("");
    expect(after).not.toBe(before);
    expect(openPack(before, SPELLS)).not.toBe(before);
    expect(before.scope.kind).toBe("root");
  });
});
