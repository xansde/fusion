/**
 * aggregatedFacets.ts — the facets of §5.4, as pure data.
 *
 * Spec 43 (`specs/43-aba-compendio.md`) §5.4:
 *
 * - **REQ-CPD-033** [MVP]: the panel must offer facets of document type, level
 *   range and rarity, plus a **source** facet that appears when the result comes
 *   from more than one pack.
 * - **REQ-CPD-034** [MVP]: facets combine with each other and with the text, and
 *   each active facet is removable ON ITS OWN.
 *
 * `browserScope.ts` already owns the state (`CompendiumFacets`) and the
 * transitions (`setFacet`/`clearFacet`). What was missing is everything between
 * that state and a panel: which choices to offer, how to say an active facet out
 * loud so it can be removed, and — for the two facets the server's
 * `compendium:searchAll` payload has no field for — how to apply them.
 *
 * WHY two of them are applied here and not asked of the server: the aggregated
 * payload filters `indexFields` (`CompendiumSearchFiltersSchema`), and neither
 * **document type** nor **source pack** is an index field — both are properties
 * of the PACK. The schema says so on purpose ("There is deliberately no `packId`
 * field: the scope is everything this role can see"). Applying them to the
 * answer is exact rather than approximate, because the server already sends the
 * per-group `total` and the per-pack tally: filtering by source reads the tally
 * for that pack, so the group's count stays the truth and never becomes "what
 * happened to survive truncation".
 *
 * Pure by design — no runes, no DOM, no socket — so the rule is unit-testable in
 * the client's DOM-less Vitest.
 */

import type { AggregatedSearchGroup, AggregatedSearchResult } from "./compendiumBrowser.js";
import { documentTypeLabelKey } from "./compendiumBrowser.js";
import type { CompendiumFacetKey, CompendiumFacets } from "./browserScope.js";

// ---------------------------------------------------------------------------
// Choices the panel offers
// ---------------------------------------------------------------------------

/**
 * One option of a facet control. Either the label is a translated word
 * (`labelKey`) or it is text the pack itself owns (`label`) — a pack's label is
 * content and is never a translation key.
 */
export interface FacetChoice {
  readonly value: string;
  readonly labelKey?: string;
  readonly label?: string;
}

/**
 * The rarity ladder offered by the facet. It is the generic axis REQ-CPD-033
 * names by itself, distinct from the system-declared filters of REQ-CPD-035
 * (traits, subtype) which this panel must never hardcode.
 */
export const RARITY_FACET_VALUES = ["common", "uncommon", "rare", "unique"] as const;

/** i18n key naming a rarity value. */
export function rarityLabelKey(rarity: string): string {
  return `FUSION.Compendium.Rarity.${rarity}`;
}

export function rarityChoices(): FacetChoice[] {
  return RARITY_FACET_VALUES.map((value) => ({ value, labelKey: rarityLabelKey(value) }));
}

/**
 * The document types worth offering: the ones the seat can actually see, read
 * off the packs it was served — so a `gm` pack contributes no type to a player's
 * facet, exactly as it contributes no line to his result (REQ-CPD-071).
 */
export function documentTypeChoices(
  packs: readonly { readonly documentType: string }[],
): FacetChoice[] {
  const seen = new Set<string>();
  for (const pack of packs) seen.add(pack.documentType);
  return [...seen]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((value) => ({ value, labelKey: documentTypeLabelKey(value) }));
}

/**
 * The packs the CURRENT result came from (REQ-CPD-033: the source facet exists
 * only when there is more than one). Reading it off the answer rather than off
 * the shelf is what makes the facet honest: offering "Bestiário" as a source
 * when nothing in the result came from it is a filter that can only empty the
 * list.
 */
export function sourceChoices(result: AggregatedSearchResult | null): FacetChoice[] {
  if (!result) return [];
  const byId = new Map<string, string>();
  for (const group of result.groups) {
    for (const tally of group.packs) byId.set(tally.packId, tally.label);
    // A pack can contribute lines without appearing in the tally of a
    // degraded payload; the lines themselves are the fallback.
    for (const line of group.lines)
      if (!byId.has(line.packId)) byId.set(line.packId, line.packLabel);
  }
  return [...byId.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
    .map(([value, label]) => ({ value, label }));
}

// ---------------------------------------------------------------------------
// Active facets, said out loud so they can be removed one by one (REQ-CPD-034)
// ---------------------------------------------------------------------------

/**
 * One active facet, ready to be drawn as a removable chip. `valueKey` when the
 * value is a word the bundle names, `valueText` when it is a number or a pack's
 * own label.
 */
export interface FacetChip {
  readonly facet: CompendiumFacetKey;
  /** i18n key of the chip itself; takes `{ value }`. */
  readonly labelKey: string;
  readonly valueKey?: string;
  readonly valueText?: string;
}

/**
 * Every facet currently in force, in a stable order. One chip per facet — the
 * two ends of the level range are two chips, because REQ-CPD-034 says each
 * active facet is removable individually and "nível ≥ 5" and "nível ≤ 9" are two
 * decisions.
 *
 * The source chip needs the pack's label, which only the result knows; passing
 * the choices in keeps this function pure and lets it fall back to the raw id
 * when the pack is no longer in the answer.
 */
export function describeActiveFacets(
  facets: CompendiumFacets,
  options: { readonly sources?: readonly FacetChoice[] } = {},
): FacetChip[] {
  const chips: FacetChip[] = [];

  if (facets.documentType !== undefined) {
    chips.push({
      facet: "documentType",
      labelKey: "FUSION.Compendium.Facet.Chip.DocumentType",
      valueKey: documentTypeLabelKey(facets.documentType),
    });
  }
  if (facets.rarity !== undefined) {
    chips.push({
      facet: "rarity",
      labelKey: "FUSION.Compendium.Facet.Chip.Rarity",
      valueKey: rarityLabelKey(facets.rarity),
    });
  }
  if (facets.minLevel !== undefined) {
    chips.push({
      facet: "minLevel",
      labelKey: "FUSION.Compendium.Facet.Chip.MinLevel",
      valueText: String(facets.minLevel),
    });
  }
  if (facets.maxLevel !== undefined) {
    chips.push({
      facet: "maxLevel",
      labelKey: "FUSION.Compendium.Facet.Chip.MaxLevel",
      valueText: String(facets.maxLevel),
    });
  }
  if (facets.packId !== undefined) {
    const packId = facets.packId;
    const known = options.sources?.find((choice) => choice.value === packId);
    chips.push({
      facet: "packId",
      labelKey: "FUSION.Compendium.Facet.Chip.Source",
      valueText: known?.label ?? packId,
    });
  }

  return chips;
}

// ---------------------------------------------------------------------------
// Applying the two facets the payload has no field for
// ---------------------------------------------------------------------------

/**
 * Narrow an aggregated answer by document type and by source pack.
 *
 * Both are exact, not approximate:
 * - **document type** drops whole groups, so every surviving count is the
 *   server's own;
 * - **source** keeps the lines of that pack and rewrites the group's total from
 *   the server's per-pack tally, so `omitted` still names how many matches of
 *   THAT pack the truncation left out (REQ-CPD-032 keeps working under a facet).
 *
 * Text, level and rarity are NOT touched here — those the server already
 * applied through `buildSearchAllPayload`.
 */
export function applyAggregatedFacets(
  result: AggregatedSearchResult,
  facets: CompendiumFacets,
): AggregatedSearchResult {
  const { documentType, packId } = facets;
  if (documentType === undefined && packId === undefined) return result;

  const groups: AggregatedSearchGroup[] = [];
  for (const group of result.groups) {
    if (documentType !== undefined && group.documentType !== documentType) continue;
    if (packId === undefined) {
      groups.push(group);
      continue;
    }

    const lines = group.lines.filter((line) => line.packId === packId);
    const tally = group.packs.find((entry) => entry.packId === packId);
    if (lines.length === 0 && tally === undefined) continue;

    const total = tally?.matched ?? lines.length;
    groups.push({
      documentType: group.documentType,
      total,
      lines,
      omitted: Math.max(0, total - lines.length),
      packs: tally ? [tally] : [],
    });
  }

  return { groups };
}
