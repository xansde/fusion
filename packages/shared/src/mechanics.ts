/**
 * Mechanics overlay types — grants/unlocks per pack document (T1).
 *
 * Spec: T1 — overlay de MECÂNICAS (mechanics.json por pack).
 *
 * A `mechanics.json` overlay lives alongside `pack.json` in each pack
 * directory and is keyed by document `_id`. It carries STRUCTURED grants and
 * unlocks extracted (deterministically, from the vendor's ChoiceSet/GrantItem
 * rule elements) by tools/translate-packs:
 *
 *   - GRANT (`feat-choice`): a feat that grants the choice of ANOTHER feat of
 *     a given category, with optional filters (traits, class/ancestry slug,
 *     max level). Example: Basic Concoction grants a class feat with the
 *     `alchemist` trait at level ≤ 2. This overlay is designed to REPLACE the
 *     hardcoded `GRANTED_FEAT_CHOICES` table in the client's planVM.ts — the
 *     current entries must match the generated grants 1:1 (parity test in
 *     tools/translate-packs).
 *
 *   - UNLOCK (`ancestry-feat-eligibility`): a feat that EXPANDS eligibility
 *     rather than granting a slot. Example: Adopted Ancestry lets you pick
 *     ancestry feats from another common ancestry — this is a filter relaxation,
 *     not a new choice slot.
 *
 * The overlay NEVER mutates the source `documents.json`; the server attaches
 * the matched entry to the served document as `doc.mechanics` (see
 * CompendiumService.getDocument). EN document data always remains the source of
 * truth. `sourceHash` (over the doc's rule elements) lets tools/translate-packs
 * regenerate incrementally: only docs whose rules changed are re-extracted.
 *
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or
 * systems/*. This module is pure Zod schemas + inferred types.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Grant category + provenance
// ---------------------------------------------------------------------------

/**
 * The category of feat that a grant lets the user choose. Mirrors the pf2e
 * `item:category:*` predicate used in the vendor's ChoiceSet filters.
 */
export const GrantCategorySchema = z.enum([
  "class",
  "ancestry",
  "skill",
  "general",
  "archetype",
]);

export type GrantCategory = z.infer<typeof GrantCategorySchema>;

/**
 * Where a grant/unlock entry came from. `rule-element` is the deterministic
 * primary source (ChoiceSet/GrantItem preserved in the doc); `llm` is a T2
 * LLM extraction; `curated` is a hand-authored override.
 */
export const MechanicsSourceSchema = z.enum(["rule-element", "llm", "curated"]);

export type MechanicsSource = z.infer<typeof MechanicsSourceSchema>;

// ---------------------------------------------------------------------------
// Grant — a feat-choice slot conceded by a feat
// ---------------------------------------------------------------------------

/**
 * Filters narrowing which feats are eligible for a granted choice. All fields
 * optional — an empty object means "any feat of the grant's category".
 *
 * Only LITERAL predicates become filter fields with `confidence: 1.0`. Dynamic
 * predicates (e.g. `{actor|system.details.ancestry.trait}`) are preserved
 * verbatim in `levelExpr`/left for T2 with reduced confidence — never silently
 * dropped.
 */
export const GrantFiltersSchema = z.object({
  /** Required trait(s), e.g. ["alchemist"] — the eligible feat must have them. */
  traits: z.array(z.string()).optional(),
  /** Restrict to a class, e.g. "fighter". */
  classSlug: z.string().optional(),
  /** Restrict to an ancestry, e.g. "elf". */
  ancestrySlug: z.string().optional(),
  /** Literal max level filter, from a `{lte:["item:level", N]}` predicate. */
  maxLevel: z.number().int().optional(),
  /**
   * Non-literal level expression (e.g. "item:level:1") preserved verbatim for
   * T2 when the level predicate is not a simple `lte` literal.
   */
  levelExpr: z.string().optional(),
});

export type GrantFilters = z.infer<typeof GrantFiltersSchema>;

/**
 * A grant of a feat-choice: this feat lets the character choose `count` feats
 * of `category`, narrowed by `filters`.
 */
export const FeatChoiceGrantSchema = z.object({
  kind: z.literal("feat-choice"),
  category: GrantCategorySchema,
  /** How many feats the choice grants (defaults to 1). */
  count: z.number().int().min(1).default(1),
  filters: GrantFiltersSchema,
  /** i18n key for the sub-slot's label (e.g. "...Plan.SlotLabel.grantedFeat.basicConcoction"). */
  labelKey: z.string().optional(),
  source: MechanicsSourceSchema,
  /** 1.0 when every predicate is literal; reduced when dynamic predicates remain. */
  confidence: z.number().min(0).max(1),
});

export type FeatChoiceGrant = z.infer<typeof FeatChoiceGrantSchema>;

// ---------------------------------------------------------------------------
// Fixed-item grant — a SPECIFIC document conceded outright (r15 A2)
//
// Unlike a feat-choice (the player picks a feat matching a filter), a
// fixed-item grant names ONE concrete vendor document to materialize
// automatically — the same shape a Foundry `GrantItem` rule element carries in
// `system.rules`, but recovered here for grants that live ONLY in a document's
// prose. The concrete case: the Magus hybrid studies declare their "Conflux
// Spell" (Starlit Span → Shooting Star, etc.) as
// `<strong>Conflux Spell</strong> @UUID[Compendium.pf2e.spells-srd.Item.<Name>]`
// in the description, with an EMPTY `system.rules` — Foundry itself does not
// automate it. tools/translate-packs extracts the pattern (source: "curated")
// so the client materializer can place the spell in the focus pool.
//
// `vendor`/`name` mirror ParsedGrant in the client's grantMaterializer: the
// materializer maps `vendor` → a Fusion pack slug and resolves `name` there
// (accent/case-insensitive), so a fixed-item grant flows through the SAME
// resolver + idempotency path as a `system.rules` GrantItem.
// ---------------------------------------------------------------------------

export const FixedItemGrantSchema = z.object({
  kind: z.literal("fixed-item"),
  /** Vendor pack segment of the source uuid, e.g. "spells-srd" / "feats-srd". */
  vendor: z.string(),
  /** The referenced document NAME (resolved in the mapped Fusion pack). */
  name: z.string(),
  /** The original @UUID reference, kept for diagnostics/regeneration. */
  uuid: z.string().optional(),
  source: MechanicsSourceSchema,
  /** 1.0 for a literal @UUID reference (the pattern is unambiguous). */
  confidence: z.number().min(0).max(1),
});

export type FixedItemGrant = z.infer<typeof FixedItemGrantSchema>;

/**
 * A grant is either a feat-CHOICE (player picks) or a FIXED-item (a specific
 * document conceded outright). Discriminated on `kind` — existing `feat-choice`
 * entries validate unchanged, so the overlay stays backward-compatible.
 */
export const GrantSchema = z.discriminatedUnion("kind", [
  FeatChoiceGrantSchema,
  FixedItemGrantSchema,
]);

export type Grant = z.infer<typeof GrantSchema>;

// ---------------------------------------------------------------------------
// Unlock — an eligibility expansion conceded by a feat
// ---------------------------------------------------------------------------

/**
 * An unlock EXPANDS eligibility (relaxes a filter) rather than granting a new
 * choice slot. Currently only ancestry-feat eligibility (Adopted Ancestry and
 * kin); the `kind` enum is deliberately extensible.
 */
export const UnlockSchema = z.object({
  kind: z.enum(["ancestry-feat-eligibility"]),
  /** Mechanism slug, e.g. "adopted-ancestry" (derived from the rule-element flag). */
  mechanism: z.string(),
  filters: z.object({
    /** Exclude the character's own ancestry from the expanded pool (Adopted Ancestry). */
    excludeOwnAncestry: z.boolean().optional(),
    /** Restrict the expansion to a single ancestry. */
    ancestrySlug: z.string().optional(),
    /** Restrict the expansion to ancestries of the given rarities. */
    rarity: z.array(z.enum(["common", "uncommon", "rare"])).optional(),
  }),
  source: MechanicsSourceSchema,
  confidence: z.number().min(0).max(1),
});

export type Unlock = z.infer<typeof UnlockSchema>;

// ---------------------------------------------------------------------------
// Mechanics entry + overlay file
// ---------------------------------------------------------------------------

/** The mechanics extracted for one document, keyed by `_id` in the overlay. */
export const MechanicsEntrySchema = z.object({
  /** sha1 over the doc's rule elements (system.rules + unconvertedRules) — regen key. */
  sourceHash: z.string(),
  grants: z.array(GrantSchema).default([]),
  unlocks: z.array(UnlockSchema).default([]),
});

export type MechanicsEntry = z.infer<typeof MechanicsEntrySchema>;

/**
 * The full `mechanics.json` overlay file for one pack. `entries` maps doc
 * `_id` → its extracted grants/unlocks.
 */
export const PackMechanicsOverlaySchema = z.object({
  schemaVersion: z.number().int(),
  packId: z.string(),
  generatedAt: z.string(),
  generator: z.string().optional(),
  entries: z.record(z.string(), MechanicsEntrySchema),
});

export type PackMechanicsOverlay = z.infer<typeof PackMechanicsOverlaySchema>;

/**
 * The mechanics shape attached to a served document / index entry
 * (`doc.mechanics`). Same as MechanicsEntry minus the `sourceHash` (an
 * internal regen detail the UI never needs).
 */
export const DocMechanicsSchema = z.object({
  grants: z.array(GrantSchema).default([]),
  unlocks: z.array(UnlockSchema).default([]),
});

export type DocMechanics = z.infer<typeof DocMechanicsSchema>;
