/**
 * BaseDocument — common fields shared by all Fusion Documents.
 *
 * REQ-DOC-007: Every primary Document must carry _id, _stats, flags,
 * ownership (when applicable), folder, sort.
 * REQ-DOC-008: _stats is written server-side only.
 * REQ-DOC-009: flags follow flags.<namespace>.<key>.
 * REQ-DOC-027: ownership levels NONE/LIMITED/OBSERVER/OWNER + INHERIT.
 */

import { z } from "zod";
import { FUSION_VERSION } from "./version.js";

// ---------------------------------------------------------------------------
// Ownership levels
// ---------------------------------------------------------------------------

/**
 * Numeric ownership levels, aligned with Foundry VTT conventions.
 * INHERIT (-1) means "resolve from parent Folder".
 */
export enum OwnershipLevel {
  INHERIT = -1,
  NONE = 0,
  LIMITED = 1,
  OBSERVER = 2,
  OWNER = 3,
}

export const OwnershipLevelSchema = z.nativeEnum(OwnershipLevel);

/**
 * Ownership map for a document.
 * Key "default" is the fallback for users not explicitly listed.
 * Other keys are userId strings.
 */
export const OwnershipSchema = z
  .record(z.string(), OwnershipLevelSchema)
  .refine((val) => "default" in val, {
    message: "ownership must have a 'default' key",
  });

export type Ownership = z.infer<typeof OwnershipSchema>;

/** Build a default ownership map (only GM can see, no one else). */
export function defaultOwnership(): Ownership {
  return { default: OwnershipLevel.NONE };
}

// ---------------------------------------------------------------------------
// Document stats (_stats) — server-managed
// ---------------------------------------------------------------------------

/**
 * Audit/version metadata for a document.
 * All fields are written by the server; client values are ignored (REQ-DOC-008, D9).
 */
export const DocumentStatsSchema = z.object({
  /** Unix timestamp (ms) when the document was first created. */
  createdTime: z.number().int().nonnegative(),

  /** Unix timestamp (ms) of the last modification. */
  modifiedTime: z.number().int().nonnegative(),

  /**
   * Monotonically increasing write counter for this document.
   * Starts at 1 on creation, increments by 1 on every successful update.
   * Used for optimistic-concurrency (STALE_WRITE) checks:
   *   client sends expectedVersion = version it last saw;
   *   server rejects if _stats.version !== expectedVersion.
   * This is the canonical version field — do NOT use modifiedTime for
   * concurrency checks (timestamps are not monotonic across updates within
   * the same millisecond and live in a different numeric space).
   */
  version: z.number().int().positive().default(1),

  /** UserId of the last modifier. */
  lastModifiedBy: z.string().nullable(),

  /** UserId of the creator. */
  createdBy: z.string().nullable(),

  /** Engine version at the time of last modification (e.g., "0.1.0"). */
  coreVersion: z.string(),

  /** System id active when the document was last modified (e.g., "pf2e"). */
  systemId: z.string().nullable(),

  /** System version at the time of last modification. */
  systemVersion: z.string().nullable(),

  /**
   * Engine schema version of this document's data.
   * Used by the migration engine (REQ-DOC-046).
   *
   * Design note (D10): spec 02 line 556 defines a single `schemaVersion` field,
   * but the implementation splits it into engineSchemaVersion + systemSchemaVersion
   * to allow independent versioning of engine and system schemas (D10 decision).
   * WorldManifest.schemaVersion remains a singular field (tracks the DB schema
   * version, not per-document). Consistency between these naming conventions
   * should be reviewed when implementing spec 06+ (migration engine).
   */
  engineSchemaVersion: z.number().int().nonnegative(),

  /**
   * System-specific schema version.
   * Managed by the system API (REQ-DOC-047).
   * See D10 design note on engineSchemaVersion above.
   */
  systemSchemaVersion: z.number().int().nonnegative().nullable(),
});

export type DocumentStats = z.infer<typeof DocumentStatsSchema>;

/** Build default _stats for a newly created document. */
export function defaultStats(coreVersion: string = FUSION_VERSION): DocumentStats {
  const now = Date.now();
  return {
    createdTime: now,
    modifiedTime: now,
    version: 1,
    lastModifiedBy: null,
    createdBy: null,
    coreVersion,
    systemId: null,
    systemVersion: null,
    engineSchemaVersion: 1,
    systemSchemaVersion: null,
  };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/**
 * Flags are arbitrary namespaced data: flags.<namespace>.<key>.
 * Namespaces "core" and "world" are reserved for the engine.
 * REQ-DOC-009
 */
export const FlagsSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export type Flags = z.infer<typeof FlagsSchema>;

// ---------------------------------------------------------------------------
// BaseDocument schema
// ---------------------------------------------------------------------------

/**
 * Fields shared by every primary Document.
 * Individual document types extend this with their own fields.
 *
 * REQ-DOC-007
 */
export const BaseDocumentSchema = z.object({
  /** Unique 16-character nanoid identifier. REQ-DOC-001. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /**
   * Server-managed audit metadata. Written exclusively by the server.
   * REQ-DOC-008, D9.
   */
  _stats: DocumentStatsSchema,

  /**
   * Display name of the document (optional on types that do not have a name,
   * e.g. ChatMessage, Setting).
   */
  name: z.string().optional(),

  /**
   * Subtype discriminator, used in documents that support multiple subtypes
   * (Actor, Item, etc.) to select the matching `system` schema.
   * REQ-DOC-023.
   */
  type: z.string().optional(),

  /**
   * ID of the Folder that contains this document.
   * Soft reference — may point to a non-existent folder after deletion.
   * REQ-DOC-011 (D11).
   */
  folder: z.string().nullable().optional(),

  /**
   * Sort order within the folder/collection.
   * Lower values appear first. Default 0.
   */
  sort: z.number().int().default(0),

  /**
   * Per-document permission overrides.
   * Key "default" is mandatory. Other keys are userIds.
   * REQ-DOC-027.
   */
  ownership: OwnershipSchema.default(() => defaultOwnership()),

  /**
   * Namespaced arbitrary data.
   * Structure: { [namespace]: { [key]: value } }
   * REQ-DOC-009.
   */
  flags: FlagsSchema.default(() => ({})),

  /**
   * System-specific data blob.
   * Schema is determined by the system API based on (documentType, subtype).
   * REQ-DOC-013.
   */
  system: z.record(z.string(), z.unknown()).optional(),
});

export type BaseDocument = z.infer<typeof BaseDocumentSchema>;

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective ownership level for a given userId on a document.
 *
 * Resolution order (REQ-DOC-028):
 *   1. If userId is null/undefined → OwnershipLevel.NONE
 *   2. If explicit entry for userId → use it (unless INHERIT)
 *   3. Fall back to "default"
 *   4. INHERIT → caller must resolve via folder hierarchy
 *
 * Note: GM override (always OWNER) is not implemented here — it belongs in
 * the permission enforcement layer (ver 05-usuarios-e-permissoes.md).
 */
export function getUserLevel(
  ownership: Ownership,
  userId: string | null | undefined,
): OwnershipLevel {
  if (!userId) return OwnershipLevel.NONE;

  const explicit = ownership[userId];
  if (explicit !== undefined && explicit !== OwnershipLevel.INHERIT) {
    return explicit;
  }

  const def = ownership["default"];
  return def ?? OwnershipLevel.NONE;
}

/**
 * Test whether a user has at least a minimum ownership level.
 * REQ-DOC-030.
 */
export function testUserLevel(
  ownership: Ownership,
  userId: string | null | undefined,
  min: OwnershipLevel,
): boolean {
  return getUserLevel(ownership, userId) >= min;
}

// ---------------------------------------------------------------------------
// DocumentTable type (matches DB table names)
// ---------------------------------------------------------------------------

/**
 * Valid SQLite table names for primary Documents.
 * fog_explorations and cards_collections are [V2].
 * REQ-DOC-022.
 */
export type DocumentTable =
  | "actors"
  | "items"
  | "scenes"
  | "region_maps"
  | "journal_entries"
  | "macros"
  | "roll_tables"
  | "playlists"
  | "chat_messages"
  | "combats"
  | "users"
  | "folders"
  | "settings";

export const DOCUMENT_TABLES: ReadonlySet<DocumentTable> = new Set<DocumentTable>([
  "actors",
  "items",
  "scenes",
  "region_maps",
  "journal_entries",
  "macros",
  "roll_tables",
  "playlists",
  "chat_messages",
  "combats",
  "users",
  "folders",
  "settings",
]);

// ---------------------------------------------------------------------------
// Persistence types (shared between server DB layer and client)
// ---------------------------------------------------------------------------

/**
 * A row as stored in and returned from the SQLite database.
 * The `data` field is the JSON-serialized full Document.
 */
export interface DocumentRow {
  id: string;
  data: string; // JSON-serialized Document
  created_at: number; // Unix ms
  updated_at: number; // Unix ms
}

/**
 * Schema migration record stored in the schema_migrations table.
 */
export interface SchemaMigration {
  version: number;
  applied_at: number; // Unix ms
  description: string;
}

/**
 * World lock file contents.
 * Written to worlds/<slug>/world.lock on open, deleted on close.
 * REQ-PER-009 (DEC-PER-06).
 */
export interface WorldLock {
  pid: number;
  started_at: string; // ISO 8601
}

/**
 * Metadata manifest for a World, stored as world.json.
 * REQ-PER-010.
 */
export interface WorldManifest {
  /** Slug unique identifier (kebab/snake, immutable after creation). */
  id: string;
  /** Human-readable world title. */
  title: string;
  /** System id (e.g., "pf2e"). */
  system: string;
  /** System version at last open. */
  systemVersion: string;
  /** Fusion engine version at last open. */
  fusionVersion: string;
  /** Current schema version of world.db. */
  schemaVersion: number;
  /** Plain text or Markdown description (max 2000 chars). */
  description: string;
  /** Path relative to the world folder for the cover image. */
  coverImage?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp of last successful open. */
  lastOpenedAt: string;
  /** Total play time in seconds. */
  playTime: number;
  compatibility: {
    minimumFusion: string;
  };
}

/**
 * A backup entry describing a backup file.
 * REQ-PER-024..027.
 */
export interface BackupEntry {
  filename: string;
  type: "auto" | "manual" | "pre-delete" | "pre-restore" | "pre-migration" | "pre-update";
  timestamp: number; // Unix ms
  sizeBytes: number;
  path: string;
}

/**
 * Options for creating a new World.
 * REQ-PER-013.
 */
export interface CreateWorldOptions {
  title: string;
  system: string;
  description?: string;
  coverImage?: string;
  /** Auto-generated from title if omitted. */
  slug?: string;
}
