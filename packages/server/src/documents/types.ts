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
  FolderDocumentSchema,
  InitialViewSchema,
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
  /**
   * Initial camera position/zoom, applied when the scene goes on air
   * (REQ-CNV-068, REQ-CEN-046). Null = fit the scene to the viewport.
   * Declared in the canonical model (`@fusion/shared` SceneDocumentSchema) but
   * missing here, so every write silently dropped it and the client had nothing
   * to apply. Same shape as the shared schema — one definition, imported.
   */
  initialView: InitialViewSchema.default(null),
  // Embedded collections stored as JSON arrays
  tokens: z.array(z.record(z.string(), z.unknown())).default(() => []),
  /** Walls with typed schema (spec 07 M2-A). */
  walls: z.array(WallDocumentSchema).default(() => []),
  /** Ambient lights with typed schema (spec 07 M2-A). */
  lights: z.array(AmbientLightDocumentSchema).default(() => []),
  sounds: z.array(z.record(z.string(), z.unknown())).default(() => []),
  tiles: z.array(z.record(z.string(), z.unknown())).default(() => []),
  drawings: z.array(z.record(z.string(), z.unknown())).default(() => []),
  templates: z.array(z.record(z.string(), z.unknown())).default(() => []),
  notes: z.array(z.record(z.string(), z.unknown())).default(() => []),
});

/**
 * JournalEntry — with embedded pages.
 */
export const JournalEntrySchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  ownership: BaseDocumentSchema.shape.ownership,
  folder: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  pages: z.array(z.record(z.string(), z.unknown())).default(() => []),
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
 *
 * The shape is the canonical one from `@fusion/shared` (spec 42 / REQ-NPC-020
 * gave the client a real folder tree, so the client needs the same definition).
 * Re-exported rather than re-declared: two copies of a document schema drift,
 * and the one that drifts silently is always the one nobody validates against.
 */
export const FolderSchema = FolderDocumentSchema;

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
export type JournalEntryDocument = z.infer<typeof JournalEntrySchema>;
export type MacroDocument = z.infer<typeof MacroSchema>;
export type RollTableDocument = z.infer<typeof RollTableSchema>;
export type PlaylistDocument = z.infer<typeof PlaylistSchema>;
export type ChatMessageDocument = z.infer<typeof ChatMessageSchema>;
export type CombatDocument = z.infer<typeof CombatSchema>;
export type UserDocument = z.infer<typeof UserSchema>;
export type FolderDocument = z.infer<typeof FolderSchema>;
export type SettingDocument = z.infer<typeof SettingSchema>;
