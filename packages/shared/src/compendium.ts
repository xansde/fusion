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
// PackManifest — the pack.json descriptor
// REQ-CMP-003, REQ-CMP-004, REQ-CMP-040
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
  /** Document name. */
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

/** compendium:search — search/filter the index of a pack. */
export const CompendiumSearchPayloadSchema = z.object({
  packId: z.string(),
  /** Substring search on name (case + accent insensitive). */
  text: z.string().optional(),
  /** Equality/range filters on indexFields. */
  filters: z
    .record(
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
    )
    .optional(),
});

export type CompendiumSearchPayload = z.infer<typeof CompendiumSearchPayloadSchema>;

/** compendium:get — load the full document for a UUID. */
export const CompendiumGetPayloadSchema = z.object({
  /** Compendium UUID: "Compendium.<packId>.<DocType>.<docId>" */
  uuid: z.string(),
});

export type CompendiumGetPayload = z.infer<typeof CompendiumGetPayloadSchema>;

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
 * Accent-insensitive, case-insensitive match against `name`.
 * REQ-CMP-013.
 */
export function matchesTextSearch(entry: PackIndexEntry, query: string): boolean {
  if (!query) return true;
  const normalized = normalizeSearchText(query);
  return normalizeSearchText(entry.name).includes(normalized);
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
