/**
 * browserScope.ts — the scope machine behind the compendium panel.
 *
 * Spec 43 (`specs/43-aba-compendio.md`) §5.2, DEC-CPD-01: the panel has exactly
 * two body modes — the **shelf** and the **search result** — and the mode is a
 * function of the current scope plus what is typed, never of a toggle the user
 * has to find and press (REQ-CPD-010). Obliging someone to pick a mode before
 * they know what they want is charging for a decision they do not have yet.
 *
 * Everything here is pure: state in, new state out, no runes, no DOM, no socket.
 * `CompendiumBrowser.svelte` holds one `$state` of `BrowserScopeState` and calls
 * these transitions; that keeps the rule that decides what the table sees unit
 * testable without mounting a component (the client's Vitest has no DOM).
 *
 * Covers REQ-CPD-010..015. REQ-CPD-016 (the search bar outside the scrolling
 * area) and REQ-CPD-017 (mode never touches the drawer width) are properties of
 * the rendered panel and live in the component.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Where the panel is looking. The root is the whole visible collection; a pack
 * scope confines both the listing and the search to that one pack
 * (REQ-CPD-013/014). `packLabel` travels with the id so the header can name the
 * scope without holding the manifest (REQ-CPD-015).
 */
export type CompendiumScope =
  | { readonly kind: "root" }
  | { readonly kind: "pack"; readonly packId: string; readonly packLabel: string };

/** The two — and only two — bodies the panel can show (REQ-CPD-010). */
export type CompendiumBodyMode = "shelf" | "results";

/**
 * The facets of §5.4, as far as the mode machine cares about them: any of them
 * being set is enough to leave the shelf (REQ-CPD-012), and each one is
 * removable on its own (REQ-CPD-034). `packId` is the **source** facet, which
 * only makes sense at root — opening a pack supersedes it.
 */
export interface CompendiumFacets {
  readonly documentType?: string;
  readonly rarity?: string;
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly packId?: string;
}

/** Keys of {@link CompendiumFacets}, so a facet can be cleared by name. */
export type CompendiumFacetKey = keyof CompendiumFacets;

/** The whole of what decides the body of the panel. */
export interface BrowserScopeState {
  readonly scope: CompendiumScope;
  /** Raw text as typed, never trimmed in place — the box shows what was typed. */
  readonly search: string;
  readonly facets: CompendiumFacets;
}

/** The scope the panel opens on: the whole collection, at rest. */
export const ROOT_SCOPE: CompendiumScope = Object.freeze({ kind: "root" });

/** A fresh state: root scope, nothing typed, no facet (REQ-CPD-011). */
export function initialBrowserScope(): BrowserScopeState {
  return { scope: ROOT_SCOPE, search: "", facets: {} };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** True when at least one facet is set (REQ-CPD-012). */
export function hasActiveFacets(facets: CompendiumFacets): boolean {
  return Object.values(facets).some((value) => value !== undefined);
}

/** True when the panel is looking at the whole collection. */
export function isRootScope(state: BrowserScopeState): boolean {
  return state.scope.kind === "root";
}

/** True when there is something to search for — whitespace alone is not. */
export function hasQuery(state: BrowserScopeState): boolean {
  return state.search.trim().length > 0 || hasActiveFacets(state.facets);
}

/**
 * The body of the panel, derived (REQ-CPD-010).
 *
 * Shelf only at root with nothing asked for (REQ-CPD-011); anything else is a
 * listing: the aggregated result at root (REQ-CPD-012) or the pack's own index
 * once a pack is open (REQ-CPD-013).
 */
export function bodyMode(state: BrowserScopeState): CompendiumBodyMode {
  if (!isRootScope(state)) return "results";
  return hasQuery(state) ? "results" : "shelf";
}

/** Human-facing description of the current scope (REQ-CPD-015). */
export interface ScopeDescription {
  /** i18n key naming the scope in the panel header. */
  readonly labelKey: string;
  /** Pack label when a pack is open, null at root. */
  readonly packLabel: string | null;
  /** Whether the header must offer the way back to the shelf. */
  readonly canGoBack: boolean;
}

export function describeScope(state: BrowserScopeState): ScopeDescription {
  if (state.scope.kind === "pack") {
    return {
      labelKey: "FUSION.Compendium.Scope.Pack",
      packLabel: state.scope.packLabel,
      canGoBack: true,
    };
  }
  return { labelKey: "FUSION.Compendium.Scope.All", packLabel: null, canGoBack: false };
}

/**
 * Whether the "search the whole collection" action applies — only when the
 * search is currently confined to one pack (REQ-CPD-014).
 */
export function canWidenToWholeCollection(state: BrowserScopeState): boolean {
  return state.scope.kind === "pack";
}

/**
 * The query to run for the current state. `packId` is present exactly when the
 * search must be confined to the open pack (REQ-CPD-014); at root it is absent,
 * and the server answers over every visible pack (REQ-CPD-030, DEC-CPD-02).
 */
export interface ScopedSearchQuery {
  readonly packId?: string;
  readonly text?: string;
  readonly facets: CompendiumFacets;
}

export function buildScopedSearchQuery(state: BrowserScopeState): ScopedSearchQuery {
  const text = state.search.trim();
  return {
    ...(state.scope.kind === "pack" ? { packId: state.scope.packId } : {}),
    ...(text.length > 0 ? { text } : {}),
    facets: state.facets,
  };
}

// ---------------------------------------------------------------------------
// Transitions — each returns a new state, none mutates its argument
// ---------------------------------------------------------------------------

/** Type the search box (REQ-CPD-012, REQ-CPD-014). */
export function setSearch(state: BrowserScopeState, search: string): BrowserScopeState {
  return { ...state, search };
}

/**
 * Open a pack: the scope becomes that pack and the typed text is cleared, so the
 * body is the pack's own index rather than a search carried in from elsewhere
 * (REQ-CPD-013). The **source** facet goes with it — naming a pack while a pack
 * is open would be a second, contradictory scope — and so does the **document
 * type** facet: a pack has exactly one type, so keeping it would leave an active
 * facet that the pack body neither draws nor applies, which is precisely the
 * invisible, irremovable filter REQ-CPD-034 forbids.
 */
export function openPack(
  state: BrowserScopeState,
  pack: { readonly id: string; readonly label: string },
): BrowserScopeState {
  const { packId: _droppedPack, documentType: _droppedType, ...rest } = state.facets;
  return {
    scope: { kind: "pack", packId: pack.id, packLabel: pack.label },
    search: "",
    facets: rest,
  };
}

/**
 * Widen the current search to the whole collection: the text and the facets
 * survive, the scope goes back to root (REQ-CPD-014). This is the explicit
 * action the panel offers while a pack is open — not a side effect of typing.
 */
export function widenToWholeCollection(state: BrowserScopeState): BrowserScopeState {
  return { ...state, scope: ROOT_SCOPE };
}

/**
 * The way back the header always offers (REQ-CPD-015). It lands on the shelf,
 * which means dropping the search and the facets too: coming back to a root
 * scope that still shows a result is not "back to the shelf".
 */
export function backToShelf(_state: BrowserScopeState): BrowserScopeState {
  return initialBrowserScope();
}

/** Set one facet (REQ-CPD-012, REQ-CPD-034). */
export function setFacet<K extends CompendiumFacetKey>(
  state: BrowserScopeState,
  key: K,
  value: NonNullable<CompendiumFacets[K]>,
): BrowserScopeState {
  return { ...state, facets: { ...state.facets, [key]: value } };
}

/** Remove one facet without touching the others (REQ-CPD-034). */
export function clearFacet(state: BrowserScopeState, key: CompendiumFacetKey): BrowserScopeState {
  if (state.facets[key] === undefined) return state;
  // Rebuilt without the key rather than deleted: under exactOptionalPropertyTypes
  // an explicit `undefined` is NOT the same as absent, and `hasActiveFacets`
  // reads absence.
  const next = Object.fromEntries(
    Object.entries(state.facets).filter(([name]) => name !== key),
  ) as CompendiumFacets;
  return { ...state, facets: next };
}

/** Remove every facet, leaving the typed text alone. */
export function clearAllFacets(state: BrowserScopeState): BrowserScopeState {
  return hasActiveFacets(state.facets) ? { ...state, facets: {} } : state;
}
