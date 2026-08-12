/**
 * Document type definitions and registry.
 *
 * Registers a Zod schema for each primary document type supported in the MVP.
 * The system field is accepted as a passthrough (z.record) for now — typed
 * schemas per (documentType, subtype) are registered by the system API (M3).
 *
 * REQ-DOC-012: engine schema per type in packages/shared (base).
 * REQ-DOC-013: system passthrough when no schema registered.
 * REQ-DOC-018: MVP primary document types.
 *
 * Table-to-type mapping (matches migration 001 table names from spec 03):
 *   actors          → Actor
 *   items           → Item
 *   scenes          → Scene
 *   journal_entries → JournalEntry
 *   macros          → Macro
 *   roll_tables     → RollTable
 *   playlists       → Playlist
 *   chat_messages   → ChatMessage
 *   combats         → Combat
 *   users           → User
 *   folders         → Folder
 *   settings        → Setting
 */

import { z } from "zod";
import {
  BaseDocumentSchema,
  WallDocumentSchema,
  AmbientLightDocumentSchema,
  CombatDocumentSchema,
  GridConfigSchema,
  TileDocumentSchema,
  NoteDocumentSchema,
  RegionMapDocumentSchema,
  JournalEntryPageSchema,
} from "@fusion/shared";
import type { DocumentTable } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

/** Zod schema for a document type. */
export type DocumentSchema = z.ZodTypeAny;

/**
 * Registry mapping DocumentTable → Zod schema.
 * Schemas validate the full document (engine fields + passthrough system).
 */
const schemaRegistry = new Map<DocumentTable, DocumentSchema>();

/** Register a schema for a table. Can be called multiple times (last wins). */
export function registerDocumentSchema(table: DocumentTable, schema: DocumentSchema): void {
  schemaRegistry.set(table, schema);
}

/**
 * Get the registered schema for a table.
 * Falls back to BaseDocumentSchema if none is registered.
 */
export function getDocumentSchema(table: DocumentTable): DocumentSchema {
  return schemaRegistry.get(table) ?? BaseDocumentSchema;
}

// ---------------------------------------------------------------------------
// Per-type schemas (engine-level, MVP)
// REQ-DOC-018
// ---------------------------------------------------------------------------

/**
 * Actor — typed document (has type + system passthrough).
 * REQ-DOC-023: Actor supports subtype and typed system.
 *
 * `items` holds the Actor's embedded Item documents (e.g. weapons, feats,
 * conditions, SF2e augmentations). Without an explicit field here, Zod's
 * default strip-unknown-keys behavior on `.extend()` (no `.passthrough()`)
 * silently discards any `items` array written by handleEmbeddedCreate /
 * handleEmbeddedUpdate on every validateDocument() round-trip — found via
 * the SF2e augmentation slot-limit test (REQ-SF2-024), which requires
 * `items` to actually persist across doc:create calls. Mirrors the
 * `tokens: z.array(...)` pattern already used by SceneSchema below.
 */
export const ActorSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  type: z.string().default("base"),
  img: z.string().nullable().optional(),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  system: z.record(z.string(), z.unknown()).default(() => ({})),
  items: z.array(z.record(z.string(), z.unknown())).default(() => []),
});

/**
 * Item — typed document.
 */
export const ItemSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  type: z.string().default("base"),
  img: z.string().nullable().optional(),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  system: z.record(z.string(), z.unknown()).default(() => ({})),
});

/**
 * Scene — spatial document with embedded collections.
 * M2-A: walls and lights are now typed using shared WallDocumentSchema and
 * AmbientLightDocumentSchema. Perception fields (darkness, globalLight, etc.)
 * added per spec 07.
 */
export const SceneSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  active: z.boolean().default(false),
  navigation: z.boolean().default(true),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  width: z.number().int().nonnegative().default(4000),
  height: z.number().int().nonnegative().default(3000),
  padding: z.number().nonnegative().default(0.25),
  background: z.string().nullable().optional(),
  backgroundColor: z.string().default("#999999"),
  /**
   * Grid configuration. Declared here — with the SHARED schema, not a second
   * copy of it — because `.extend()` strips every undeclared key: without this
   * line the server silently dropped the entire grid on every write, so the
   * GM's cell size never survived a save and the scene reloaded at the default
   * 100px. The `scene.grid?.size ?? 100` guards scattered through the canvas
   * code are the symptom of exactly that; this is the cause.
   */
  grid: GridConfigSchema.default(() => ({
    type: "square" as const,
    size: 100,
    distance: 5,
    units: "ft",
    color: "#000000",
    alpha: 0.2,
  })),
  /** Calibrated grid origin in scene px; null aligns the grid to the padding. */
  gridOffsetX: z.number().finite().nullable().default(null),
  gridOffsetY: z.number().finite().nullable().default(null),
  /** Token vision enabled (spec 07 REQ-VIS-085). */
  tokenVision: z.boolean().default(false),
  /** Fog of war enabled (spec 07 REQ-VIS-085). */
  fogEnabled: z.boolean().default(false),
  /** Darkness level 0–1 (spec 07 REQ-VIS-044). */
  darkness: z.number().min(0).max(1).default(0),
  /** Global illumination flag (spec 07 REQ-VIS-044). */
  globalLight: z.boolean().default(true),
  /** Darkness threshold above which GI is suppressed (spec 07 REQ-VIS-044). */
  globalLightThreshold: z.number().min(0).max(1).default(0.5),
  // Embedded collections stored as JSON arrays
  tokens: z.array(z.record(z.string(), z.unknown())).default(() => []),
  /** Walls with typed schema (spec 07 M2-A). */
  walls: z.array(WallDocumentSchema).default(() => []),
  /** Ambient lights with typed schema (spec 07 M2-A). */
  lights: z.array(AmbientLightDocumentSchema).default(() => []),
  sounds: z.array(z.record(z.string(), z.unknown())).default(() => []),
  /** Extra images the scene is composed from, typed via the shared schema. */
  tiles: z.array(TileDocumentSchema).default(() => []),
  drawings: z.array(z.record(z.string(), z.unknown())).default(() => []),
  templates: z.array(z.record(z.string(), z.unknown())).default(() => []),
  /**
   * Map pins, typed via the shared schema — NOT a second copy. Each note
   * carries its own ownership (REQ-DOC-056) and is redacted per viewer in
   * `net/redaction.ts` (REQ-DOC-058). A field this schema does not declare is
   * silently dropped on every write, which is how `grid` once vanished from
   * every scene (see docs/lessons.md).
   */
  notes: z.array(NoteDocumentSchema).default(() => []),
});

/**
 * RegionMap — the picture the table consults, with pins on it (DEC-MREG-08).
 *
 * Declared by importing the shared schema rather than re-declaring the fields,
 * for the reason in CLAUDE.md: `.extend()` without `.passthrough()` silently
 * drops any field the server does not know about, so a second copy of the
 * shape here would erase every pin the moment the two drifted. `pins` is
 * listed for exactly that reason — the same trap that once deleted `grid` from
 * every scene.
 */
export const RegionMapSchema = RegionMapDocumentSchema;

/**
 * JournalEntry — with embedded pages.
 *
 * `pages` used to be `z.array(z.record(z.string(), z.unknown()))`: a page could
 * be anything, which meant it could not be REDACTED, because redaction has to
 * know where a page keeps its ownership. The quest board rests entirely on
 * that field (DEC-HUB-04), so the page now carries the shared schema —
 * imported, never re-declared, for the reason in CLAUDE.md: `.extend()`
 * without `.passthrough()` silently drops what it does not know, and a second
 * copy of the shape here would erase every page the moment the two drifted.
 */
export const JournalEntrySchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  pages: z.array(JournalEntryPageSchema).default(() => []),
});

/**
 * Macro — script or chat macro.
 */
export const MacroSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  type: z.enum(["script", "chat"]).default("script"),
  img: z.string().nullable().optional(),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  scope: z.enum(["global", "actors"]).default("global"),
  command: z.string().default(""),
});

/**
 * RollTable — random result tables.
 */
export const RollTableSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  img: z.string().nullable().optional(),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  description: z.string().default(""),
  formula: z.string().default(""),
  replacement: z.boolean().default(true),
  displayRoll: z.boolean().default(true),
  results: z.array(z.record(z.string(), z.unknown())).default(() => []),
});

/**
 * Playlist — audio playlist with embedded sounds.
 */
export const PlaylistSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  mode: z.number().int().default(0),
  playing: z.boolean().default(false),
  fade: z.number().nullable().optional(),
  sounds: z.array(z.record(z.string(), z.unknown())).default(() => []),
});

/**
 * ChatMessage — typed (subtype selects system schema).
 *
 * WARNING — this is a SECOND, DIVERGENT copy of the shared `ChatMessageSchema`
 * (`@fusion/shared`, packages/shared/src/chat/types.ts). It carries fields the
 * shared one does not (`author`, `style`, `flavor`, `system`) and lacks fields
 * the shared one requires (`worldId`, a typed `speaker`). Because `.extend()`
 * is used WITHOUT `.passthrough()`, any field missing here is silently dropped
 * on every write that goes through the DocumentStore.
 *
 * That is why the chat subsystem does NOT use the DocumentStore for messages:
 * chat-handler.ts and etmos/conjuracao-handlers.ts write `chat_messages` with
 * raw SQL against the shared shape. Fields added to the shared schema are
 * mirrored here anyway, so a future DocumentStore write cannot quietly erase
 * them (see CLAUDE.md — this is exactly how `grid` disappeared from scenes).
 */
export const ChatMessageSchema = BaseDocumentSchema.extend({
  type: z.string().default("base"),
  author: z.string(),
  timestamp: z.number().int().nonnegative(),
  style: z.number().int().default(0),
  content: z.string().default(""),
  flavor: z.string().nullable().optional(),
  speaker: z.record(z.string(), z.unknown()).default(() => ({})),
  rolls: z.array(z.unknown()).default(() => []),
  whisper: z.array(z.string()).default(() => []),
  blind: z.boolean().default(false),
  /** GM reveal audit stamp — REQ-CHT-047. Absent = never revealed. */
  revealedAt: z.number().int().nonnegative().optional(),
  /** GM reveal audit stamp — REQ-CHT-047. Absent = never revealed. */
  revealedBy: z.string().optional(),
  sound: z.string().nullable().optional(),
  system: z.record(z.string(), z.unknown()).default(() => ({})),
});

/**
 * Combat — combat tracker with embedded combatants.
 *
 * Uses the full CombatDocumentSchema from @fusion/shared (M2-C).
 * The shared schema is the authoritative definition; BaseDocumentSchema _stats
 * is layered on by the DocumentStore separately — we use z.intersection to
 * keep compatibility with the existing passthrough approach while accepting the
 * full combat shape.
 *
 * NOTE: The DocumentStore strips _stats from input and adds it back internally,
 * so we allow passthrough for unknown fields that the store may inject.
 */
export const CombatSchema = CombatDocumentSchema.passthrough();

/**
 * User — server user account.
 */
export const UserSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  role: z.number().int().min(0).max(4).default(1),
  passwordHash: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  color: z.string().default("#ffffff"),
  characterId: z.string().nullable().optional(),
  hotbar: z.record(z.string(), z.string()).default(() => ({})),
});

/**
 * Folder — organizes other documents.
 */
export const FolderSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  type: z.string(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  sorting: z.enum(["a", "m"]).default("m"),
  color: z.string().nullable().optional(),
});

/**
 * Setting — key-value store for world/user settings.
 */
export const SettingSchema = BaseDocumentSchema.extend({
  key: z.string().min(1),
  value: z.unknown(),
});

// ---------------------------------------------------------------------------
// Register all built-in schemas
// ---------------------------------------------------------------------------

registerDocumentSchema("actors", ActorSchema);
registerDocumentSchema("items", ItemSchema);
registerDocumentSchema("scenes", SceneSchema);
registerDocumentSchema("region_maps", RegionMapSchema);
registerDocumentSchema("journal_entries", JournalEntrySchema);
registerDocumentSchema("macros", MacroSchema);
registerDocumentSchema("roll_tables", RollTableSchema);
registerDocumentSchema("playlists", PlaylistSchema);
registerDocumentSchema("chat_messages", ChatMessageSchema);
registerDocumentSchema("combats", CombatSchema);
registerDocumentSchema("users", UserSchema);
registerDocumentSchema("folders", FolderSchema);
registerDocumentSchema("settings", SettingSchema);

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ActorDocument = z.infer<typeof ActorSchema>;
export type ItemDocument = z.infer<typeof ItemSchema>;
export type SceneDocument = z.infer<typeof SceneSchema>;
export type RegionMapDocument = z.infer<typeof RegionMapSchema>;
export type JournalEntryDocument = z.infer<typeof JournalEntrySchema>;
export type MacroDocument = z.infer<typeof MacroSchema>;
export type RollTableDocument = z.infer<typeof RollTableSchema>;
export type PlaylistDocument = z.infer<typeof PlaylistSchema>;
export type ChatMessageDocument = z.infer<typeof ChatMessageSchema>;
export type CombatDocument = z.infer<typeof CombatSchema>;
export type UserDocument = z.infer<typeof UserSchema>;
export type FolderDocument = z.infer<typeof FolderSchema>;
export type SettingDocument = z.infer<typeof SettingSchema>;
