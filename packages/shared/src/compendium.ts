/**
 * Compendium pack types — shared between server, client and tools.
 *
 * REQ-CMP-001..009, REQ-CMP-012..018
 * Spec: 16-compendiums-e-importacao.md
 *
 * These types describe:
 *   - PackManifest: the pack.json descriptor for each pack.
 *   - PackIndexEntry: a lightweight index entry for lazy browsing.
 *   - PackIndex: the full in-memory index for a pack.
 *   - FusionConversionFlags: flags.fusion fields added by the importer.
 *   - Compendium protocol payloads: for the socket-based browser API.
 *
 * NOTE: buildPackDocUuid and parsePackDocUuid are SEPARATE from the
 * uuid.ts functions — those operate on the full ParsedUuid model. These are
 * simpler string helpers specifically for the compendium browser and service.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// License kinds
// ---------------------------------------------------------------------------

export const LicenseKindSchema = z.enum([
  "ORC",
  "OGL-1.0a",
  "CC-BY-3.0",
  "CC0",
  "proprietary",
  "custom",
]);

export type LicenseKind = z.infer<typeof LicenseKindSchema>;

// ---------------------------------------------------------------------------
// PackLicense — per-pack license block
// ---------------------------------------------------------------------------

export const PackLicenseSchema = z.object({
  /** SPDX-like license identifier. */
  license: LicenseKindSchema,
  /** Human-readable attribution text (authors upstream). */
  attribution: z.string(),
  /** Reserved Material notice (Paizo, etc.). */
  reservedNotice: z.string(),
  /** Source repository URL, e.g. "github.com/foundryvtt/pf2e". */
  sourceRepo: z.string().optional(),
  /** Release of origin, e.g. "v8.2.0". */
  sourceVersion: z.string().optional(),
});

export type PackLicense = z.infer<typeof PackLicenseSchema>;

// ---------------------------------------------------------------------------
// PackSource — origin tracking for imported packs
// ---------------------------------------------------------------------------

export const PackSourceSchema = z.object({
  /** Source repository — null for editorial packs (Etmos). */
  repo: z.string().nullable(),
  /** Release/version from the source repo — null for editorial. */
  version: z.string().nullable(),
  /** Version string of tools/importer-pf2e that generated this pack. */
  importerVersion: z.string(),
});

export type PackSource = z.infer<typeof PackSourceSchema>;

// ---------------------------------------------------------------------------
// PackAudience — who may see the pack at all
// REQ-CMP-004a (spec 16), REQ-CPD-070 (spec 43)
// ---------------------------------------------------------------------------

/**
 * Audience of a pack: WHO can see the shelf, not who can write to a document.
 * It is declared once for the whole pack (DEC-CMP-03/DEC-CPD-04) and is NOT
 * document ownership — deciding it per document would be a second permission
 * system.
 *
 * `"all"` — every user of the world sees the pack.
 * `"gm"`  — only users satisfying the privileged-role predicate see it; for
 *           everybody else the pack must be indistinguishable from a pack that
 *           does not exist (REQ-CMP-010a, REQ-CPD-071, REQ-SEC-020).
 *
 * Declaring the audience is not enforcing it: the enforcement point is the
 * server-side read API (spec 16, REQ-CMP-010a).
 */
export const PackAudienceSchema = z.enum(["all", "gm"]);

export type PackAudience = z.infer<typeof PackAudienceSchema>;

// ---------------------------------------------------------------------------
// PackManifest — the pack.json descriptor
// REQ-CMP-003, REQ-CMP-004, REQ-CMP-004a, REQ-CMP-040
// ---------------------------------------------------------------------------

export const PackManifestSchema = z.object({
  /**
   * Stable pack identifier in the format "<systemId>.<packSlug>".
   * Example: "pf2e.bestiary-core", "etmos.particles".
   */
  id: z.string(),
  /** Human-readable label for the UI. */
  label: z.string(),
  /**
   * Primary document type contained in this pack (one type per pack).
   * REQ-CMP-001.
   */
  documentType: z.enum([
    "Actor",
    "Item",
    "JournalEntry",
    "RollTable",
    "Macro",
    "Scene",
    "Playlist",
  ]),
  /** System that owns this pack ("pf2e" | "sf2e" | "etmos"). */
  systemId: z.string(),
  /**
   * Extra JSON paths to include in the index for filtering.
   * Example: ["system.level.value", "system.traits.value"].
   * REQ-CMP-007.
   */
  indexFields: z.array(z.string()),
  /** License block for this pack. REQ-CMP-004. */
  license: PackLicenseSchema,
  /**
   * Audience of the pack, next to `license`. Optional on input: a pack.json
   * written before this field existed stays valid and stays visible to
   * everyone, because an absent `audience` parses as `"all"` (REQ-CMP-004a,
   * REQ-CPD-070). Parsed manifests therefore always carry a resolved value —
   * readers never have to re-apply the default.
   */
  audience: PackAudienceSchema.default("all"),
  /** Source tracking (where/how this pack was generated). REQ-CMP-040. */
  source: PackSourceSchema,
  /** Total number of documents in the pack. */
  documentCount: z.number().int().min(0),
  /** ISO 8601 timestamp when this pack was generated. */
  generatedAt: z.string(),
  /** Schema version of the pack format (engine). */
  schemaVersion: z.number().int().min(0),
});

export type PackManifest = z.infer<typeof PackManifestSchema>;

// ---------------------------------------------------------------------------
// PackI18nOverlay — pt-BR translation overlay (T1)
// ---------------------------------------------------------------------------

/**
 * One translated document entry in an `i18n.pt-BR.json` overlay.
 *
 * `description` is optional (a name-only translation is valid). `sourceHash`
 * is sha1 over the EN source (`name_EN + "\u0000" + description_EN`) so
 * tools/translate-packs can regenerate incrementally: a matching hash keeps
 * the translation, a diverging hash marks it stale (server falls back to EN
 * until re-translated). EN is ALWAYS the fallback — the overlay never mutates
 * the source `documents.json`.
 */
export const PackI18nEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /**
   * Declares that this doc is name-only ON PURPOSE, even though the EN source
   * carries prose. Without it, "not translated yet" and "has no prose to
   * translate" are the same absent/empty string, and the translation QA gate
   * cannot tell a real gap from a legitimate one (issue #27).
   */
  noDescription: z.boolean().optional(),
  /**
   * Hand-curated pt-BR translation of THIS doc's own `system.prerequisites[].value`
   * entries, index-aligned with the EN array (issue #32). Escape hatch, not the
   * primary translation path: most feat/classFeature prerequisite prose is
   * handled compositionally on the client (rank+skill, subclass-axis option
   * name, or a document-name lookup — see
   * packages/client/src/lib/compendium/prerequisiteTranslation.ts) so writing
   * 626+ near-duplicate strings by hand is unnecessary. Reserved for the rare
   * document whose prerequisite text the compositional renderer and the shared
   * curated vocabulary both fail to resolve. Optional and sparse — absent on
   * (almost) every entry.
   */
  prerequisites: z.array(z.string()).optional(),
  sourceHash: z.string(),
});

export type PackI18nEntry = z.infer<typeof PackI18nEntrySchema>;

/**
 * The full `i18n.pt-BR.json` overlay file for one pack. `entries` maps doc
 * `_id` → its pt-BR translation. `attribution` records the clean-room
 * provenance: a derived (fan-content) translation of the ORC/OGL EN text —
 * NEVER the official BR translation.
 */
export const PackI18nOverlaySchema = z.object({
  schemaVersion: z.number().int(),
  packId: z.string(),
  locale: z.literal("pt-BR"),
  generatedAt: z.string(),
  generator: z.string().optional(),
  attribution: z.string(),
  entries: z.record(z.string(), PackI18nEntrySchema),
});

export type PackI18nOverlay = z.infer<typeof PackI18nOverlaySchema>;

/**
 * The localized shape attached to a served document / index entry
 * (`entry.i18n.ptBR` / `doc.i18n.ptBR`). Same as PackI18nEntry minus the
 * `sourceHash` (an internal regen detail the UI never needs).
 */
export const DocI18nSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** See {@link PackI18nEntrySchema.prerequisites}. Not yet populated by the
   * server (packages/server/src/compendium/service.ts whitelists name/
   * description when building this shape) — reserved for a future round that
   * wires the escape hatch end-to-end; the client's compositional renderer
   * does not depend on this field. */
  prerequisites: z.array(z.string()).optional(),
});

export type DocI18n = z.infer<typeof DocI18nSchema>;

/** Localized fields bag on a served entry/doc, keyed by locale. */
export const LocalizedFieldsSchema = z.object({
  ptBR: DocI18nSchema.optional(),
});

export type LocalizedFields = z.infer<typeof LocalizedFieldsSchema>;

// ---------------------------------------------------------------------------
// PackIndexEntry — lightweight index for lazy browse
// REQ-CMP-007
// ---------------------------------------------------------------------------

export const PackIndexEntrySchema = z.object({
  /** Document _id (nanoid 16 or importer fusionId). */
  _id: z.string(),
  /**
   * Compendium UUID in Fusion format.
   * Pattern: "Compendium.<packId>.<DocType>.<docId>"
   * REQ-CMP-009.
   */
  uuid: z.string(),
  /** Document name (EN — the source-of-truth name; always present). */
  name: z.string(),
  /** Image path (placeholder-mapped by importer). */
  img: z.string().nullable(),
  /** Document subtype (e.g. "weapon", "npc", "spell"). */
  type: z.string().nullable(),
  /**
   * Extra index fields declared in PackManifest.indexFields.
   * Key = JSON path, value = extracted scalar / array.
   */
  index: z.record(z.string(), z.unknown()),
  /**
   * Localized fields overlaid by the server when a translation overlay exists
   * (T1). `undefined` when no overlay entry matched — the UI falls back to
   * `name`. Optional so entries WITHOUT an overlay serialize byte-identically
   * to the pre-T1 shape (no `i18n` key at all).
   */
  i18n: LocalizedFieldsSchema.optional(),
  /**
   * Denormalized pt-BR name for cheap bilingual text search (T1). Mirrors
   * `i18n.ptBR.name`; kept as a flat top-level field so `matchesTextSearch`
   * can match against it without descending into the `i18n` bag. Optional —
   * absent when no translation exists.
   */
  namePt: z.string().optional(),
});

export type PackIndexEntry = z.infer<typeof PackIndexEntrySchema>;

/** The full in-memory index for one pack. */
export interface PackIndex {
  packId: string;
  entries: PackIndexEntry[];
}

// ---------------------------------------------------------------------------
// FusionConversionFlags — flags.fusion per imported document
// REQ-CMP-036
// ---------------------------------------------------------------------------

export interface AssetSubstitution {
  field: string;
  original: string;
  placeholder: string;
}

export interface FusionConversionFlags {
  /** "full" if all rules were converted; "partial" if some are unconverted. */
  conversion: "full" | "partial";
  importerVersion: string;
  sourceVersion: string;
  sourceId: string;
  packName: string;
  /** Original Rule Elements that could not be converted. REQ-CMP-036. */
  unconvertedRules: unknown[];
  /** Art substitutions applied by the importer. REQ-CMP-031. */
  assetSubstitutions: AssetSubstitution[];
}

// ---------------------------------------------------------------------------
// Protocol payloads for compendium socket handlers
// REQ-CMP-010
// ---------------------------------------------------------------------------

/** compendium:list — list all available packs. */
export const CompendiumListPayloadSchema = z.object({
  /** Optional filter by systemId (e.g. "pf2e"). */
  systemId: z.string().optional(),
  /** Optional filter by document type. */
  documentType: z.string().optional(),
});

export type CompendiumListPayload = z.infer<typeof CompendiumListPayloadSchema>;

/** compendium:index — get the index (entries) for a pack. */
export const CompendiumIndexPayloadSchema = z.object({
  packId: z.string(),
});

export type CompendiumIndexPayload = z.infer<typeof CompendiumIndexPayloadSchema>;

/**
 * Equality/range filters over index fields. Shared by the per-pack search
 * (`compendium:search`) and the aggregated one (`compendium:searchAll`) so a
 * facet cannot mean one thing in one scope and another thing in the other
 * (REQ-CMP-014, REQ-CPD-034).
 */
export const CompendiumSearchFiltersSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.object({
      lte: z.number().optional(),
      gte: z.number().optional(),
      contains: z.string().optional(),
    }),
  ]),
);

export type CompendiumSearchFilters = z.infer<typeof CompendiumSearchFiltersSchema>;

/** compendium:search — search/filter the index of a pack. */
export const CompendiumSearchPayloadSchema = z.object({
  packId: z.string(),
  /** Substring search on name (case + accent insensitive). */
  text: z.string().optional(),
  /** Equality/range filters on indexFields. */
  filters: CompendiumSearchFiltersSchema.optional(),
});

export type CompendiumSearchPayload = z.infer<typeof CompendiumSearchPayloadSchema>;

// ---------------------------------------------------------------------------
// compendium:searchAll — one search over EVERY pack the caller can see
// REQ-CPD-030..032 (spec 43), REQ-CMP-013a/013b (spec 16), RNF-CPD-01
// ---------------------------------------------------------------------------

/**
 * How many entries one group carries before the server truncates it
 * (REQ-CPD-032).
 *
 * ANSWER TO Q-CPD-04 (the spec left the number open: "só sai de uso real").
 * 20 is the pick, and this constant is the ONE place it lives — server default,
 * documented ceiling and client expectation all read it from here, so changing
 * the number is a one-line change and never a hunt through call sites.
 *
 * WHY 20: a 300px drawer shows ~8 rows at a time, so 20 is two and a half
 * screens of scrolling inside a single group — enough that the answer is
 * usually in the group, short enough that the truncation notice (and the way
 * back into the pack's own scope) stays reachable without infinite scrolling.
 * It also keeps the aggregated payload bounded: with ~5 document types the
 * worst case is ~100 index entries per response, which is what makes
 * RNF-CPD-01's budget a property of the SERVER's index and not of the wire.
 */
export const COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP = 20;

/**
 * Hard ceiling for a caller-supplied `limitPerGroup`. A request above it is
 * refused by the schema instead of being silently clamped — asking for the
 * whole acervo in one response is exactly the "baixar tudo para buscar" that
 * DEC-CPD-02 forbids, so it should fail loudly rather than half-succeed.
 */
export const COMPENDIUM_SEARCH_ALL_MAX_LIMIT_PER_GROUP = 100;

/**
 * compendium:searchAll — search over all packs VISIBLE TO THE CALLER
 * (REQ-CPD-030, REQ-CMP-013a). There is deliberately no `packId` field: the
 * scope is "everything this role can see", resolved on the server from the
 * authenticated socket role, never from the payload.
 */
export const CompendiumSearchAllPayloadSchema = z.object({
  /** Substring search on either name — EN or pt-BR (REQ-CMP-013b). */
  text: z.string().optional(),
  /** Equality/range filters on indexFields (REQ-CPD-034). */
  filters: CompendiumSearchFiltersSchema.optional(),
  /** Entries per group before truncation. Defaults to
   * {@link COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP}. */
  limitPerGroup: z.number().int().min(1).max(COMPENDIUM_SEARCH_ALL_MAX_LIMIT_PER_GROUP).optional(),
});

export type CompendiumSearchAllPayload = z.infer<typeof CompendiumSearchAllPayloadSchema>;

/**
 * One row of an aggregated result: an ordinary index entry that also NAMES ITS
 * SOURCE (REQ-CPD-031) — the aggregated scope is the one place where a row on
 * screen has no surrounding pack header to inherit its origin from.
 */
export interface CompendiumSearchAllEntry extends PackIndexEntry {
  /** Pack the entry came from (`PackManifest.id`). */
  packId: string;
  /** Human-readable pack label (`PackManifest.label`), so the row can name its
   * source without a second round-trip to `compendium:list`. */
  packLabel: string;
}

/** How many matches one pack contributed to a group (REQ-CPD-032: the truncated
 * group must be able to offer opening THAT pack in its own scope). */
export interface CompendiumSearchAllPackTally {
  packId: string;
  label: string;
  matched: number;
}

/** One document-type group of an aggregated result (REQ-CPD-031). */
export interface CompendiumSearchAllGroup {
  /** `PackManifest.documentType` of every entry in the group. */
  documentType: string;
  /** Matches in the WHOLE group, before truncation (REQ-CPD-031: count per group). */
  total: number;
  /** At most `limitPerGroup` entries (REQ-CPD-032). */
  entries: CompendiumSearchAllEntry[];
  /** True when `total > entries.length`. */
  truncated: boolean;
  /** How many matches were left out — `total - entries.length` (REQ-CPD-032). */
  omitted: number;
  /** Per-pack breakdown of `total`, biggest contributor first. */
  packs: CompendiumSearchAllPackTally[];
}

/** The `compendium:searchAll` ack result. */
export interface CompendiumSearchAllResult {
  /** Groups by document type, biggest first. */
  groups: CompendiumSearchAllGroup[];
  /** Matches across every group, before truncation. */
  totalMatched: number;
  /** The limit actually applied (echoed so the UI never guesses the default). */
  limitPerGroup: number;
  /** How many packs the search covered — i.e. how many the CALLER can see. */
  packsSearched: number;
}

/** compendium:get — load the full document for a UUID. */
export const CompendiumGetPayloadSchema = z.object({
  /** Compendium UUID: "Compendium.<packId>.<DocType>.<docId>" */
  uuid: z.string(),
});

export type CompendiumGetPayload = z.infer<typeof CompendiumGetPayloadSchema>;

/**
 * compendium:i18nBySourceRef — resolve the pt-BR overlay entry for a document
 * by its ORIGIN reference (`flags.fusion.packName` + `flags.fusion.sourceId`),
 * rather than by Fusion pack UUID. This is the read-side counterpart to issue
 * #43: `importToWorld` strips `uuid`/`i18n`/`mechanics` from the world copy to
 * keep it EN-pure (see CompendiumService.importToWorld), but `flags.fusion`
 * (which carries `packName`/`sourceId`) survives — so a client holding a
 * world document (not a compendium browse UUID) can still ask for its
 * translation via this reference instead. See
 * CompendiumService.getI18nBySourceRef for the full resolution rationale.
 */
export const CompendiumI18nBySourceRefPayloadSchema = z.object({
  /** `flags.fusion.packName` — the VENDOR pack key (e.g. "equipment"), NOT the
   * Fusion pack id/directory (curation can remap one vendor pack into several
   * Fusion packs, e.g. `pf2e.weapons-core` + `pf2e.equipment-core` both curate
   * from vendor "equipment"). */
  packName: z.string(),
  /** `flags.fusion.sourceId` — the vendor's raw `_id`, unique within `packName`. */
  sourceId: z.string(),
});

export type CompendiumI18nBySourceRefPayload = z.infer<
  typeof CompendiumI18nBySourceRefPayloadSchema
>;

/** compendium:import — import document(s) from a pack to the world. */
export const CompendiumImportPayloadSchema = z.object({
  /** List of Compendium UUIDs to import. */
  uuids: z.array(z.string()).min(1),
  /** Optional folder ID to place imported documents in. */
  folderId: z.string().optional(),
});

export type CompendiumImportPayload = z.infer<typeof CompendiumImportPayloadSchema>;

export interface CompendiumImportResult {
  /** World _ids of the created documents. */
  created: string[];
  /** Source uuids that failed (with reason). */
  failed: Array<{ uuid: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Pack UUID helpers (simpler than the full parseUuid in uuid.ts)
// REQ-CMP-009
// ---------------------------------------------------------------------------

/**
 * Build a pack document UUID string.
 * Format: "Compendium.<packId>.<DocType>.<docId>"
 *
 * This is a simple string builder for the compendium browser. For the full
 * hierarchical UUID model (including embedded paths), use buildPackDocUuid
 * from uuid.ts.
 */
export function buildPackDocUuid(packId: string, docType: string, docId: string): string {
  return `Compendium.${packId}.${docType}.${docId}`;
}

/**
 * Parse a pack document UUID into its parts.
 * Returns null if the string is not a valid compendium UUID.
 *
 * This is a simple parser for the compendium service. For the full
 * hierarchical UUID model, use parseUuid from uuid.ts.
 */
export function parsePackDocUuid(
  uuid: string,
): { packId: string; docType: string; docId: string } | null {
  const m = /^Compendium\.([^.]+\.[^.]+)\.([^.]+)\.([^.]+)$/.exec(uuid);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { packId: m[1], docType: m[2], docId: m[3] };
}

/**
 * Normalize text for accent-insensitive search.
 * Decomposes combining characters and strips them (NFD normalization).
 * REQ-CMP-013.
 */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Test whether a PackIndexEntry matches a text search query.
 * Accent-insensitive, case-insensitive match against the EN `name` OR the
 * pt-BR `namePt` (bilingual — the user can type either language and find the
 * entry). REQ-CMP-013, T1.
 */
export function matchesTextSearch(entry: PackIndexEntry, query: string): boolean {
  if (!query) return true;
  const normalized = normalizeSearchText(query);
  if (normalizeSearchText(entry.name).includes(normalized)) return true;
  if (entry.namePt !== undefined && normalizeSearchText(entry.namePt).includes(normalized)) {
    return true;
  }
  return false;
}

/**
 * Test whether a PackIndexEntry matches a set of filters.
 * REQ-CMP-014.
 *
 * Filter semantics:
 *   - string/number/boolean: equality.
 *   - string[]: any-of (the index value must be or include one of the strings).
 *   - { lte, gte }: numeric range on the index value.
 *   - { contains }: the index value (array or string) must contain the value.
 */
export function matchesFilters(
  entry: PackIndexEntry,
  filters: CompendiumSearchPayload["filters"],
): boolean {
  if (!filters) return true;

  // Top-level fields available on PackIndexEntry (besides name which is handled by text search)
  const topLevelFields = new Set(["_id", "uuid", "name", "img", "type"]);

  for (const [field, filter] of Object.entries(filters)) {
    // Prefer top-level fields over index fields for known top-level names
    const value: unknown = topLevelFields.has(field)
      ? (entry as unknown as Record<string, unknown>)[field]
      : (entry.index[field] ?? (entry as unknown as Record<string, unknown>)[field]);

    if (typeof filter === "string" || typeof filter === "number" || typeof filter === "boolean") {
      // Equality
      if (Array.isArray(value)) {
        if (!(value as unknown[]).includes(filter)) return false;
      } else {
        if (value !== filter) return false;
      }
    } else if (Array.isArray(filter)) {
      // Any-of
      if (Array.isArray(value)) {
        if (!filter.some((f) => (value as string[]).includes(f))) return false;
      } else {
        if (!filter.includes(value as string)) return false;
      }
    } else if (typeof filter === "object") {
      const { lte, gte, contains } = filter as { lte?: number; gte?: number; contains?: string };
      if (lte !== undefined && typeof value === "number" && value > lte) return false;
      if (gte !== undefined && typeof value === "number" && value < gte) return false;
      if (contains !== undefined) {
        if (Array.isArray(value)) {
          if (!(value as string[]).includes(contains)) return false;
        } else if (typeof value === "string") {
          if (!value.includes(contains)) return false;
        } else {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Filter a PackIndex by text and/or field filters.
 * Returns matching entries (does not mutate the index).
 * REQ-CMP-013, REQ-CMP-014.
 */
export function searchPackIndex(
  entries: PackIndexEntry[],
  query: CompendiumSearchPayload,
): PackIndexEntry[] {
  return entries.filter(
    (e) => matchesTextSearch(e, query.text ?? "") && matchesFilters(e, query.filters),
  );
}
