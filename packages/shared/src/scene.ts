/**
 * Scene and Token document schemas.
 *
 * REQ-DOC-012: Zod schemas with derived TypeScript types.
 * REQ-DOC-021: Scene must contain EmbeddedCollections: tokens, walls, lights,
 *              sounds, tiles, drawings, templates, notes.
 * REQ-DOC-018: Scene is a primary Document.
 * REQ-DOC-019: Token is embedded in Scene.
 *
 * Spec references:
 *  - 02-modelo-de-dados.md  — Scene/Token fields, ownership, actorDelta
 *  - 06-canvas-e-renderizacao.md — SceneConfig, GridConfig, initialView
 *  - 05-usuarios-e-permissoes.md — ownership levels
 */

import { z } from "zod";
import {
  BaseDocumentSchema,
  OwnershipSchema,
  FlagsSchema,
  defaultOwnership,
  defaultStats,
} from "./document.js";
import { type GridConfig } from "./grid/types.js";

// ---------------------------------------------------------------------------
// GridConfig Zod schema
// (GridConfig is defined as a plain TS interface in grid/types.ts;
//  we re-declare it as a Zod schema here to use inside SceneDocumentSchema)
// ---------------------------------------------------------------------------

export const GridConfigSchema = z.object({
  /** Grid type: square, hex, or gridless. REQ-CNV-014. */
  type: z.enum(["square", "hex", "gridless"]),

  /**
   * Cell size in pixels. Minimum 50 px. REQ-CNV-017.
   * Square: side length. Hex: flat-to-flat width (pointy) or height (flat).
   */
  size: z.number().int().min(50),

  /** In-game distance represented by one cell (e.g. 5). */
  distance: z.number().positive(),

  /** Unit label (e.g. "ft", "m"). */
  units: z.string(),

  /** Grid line color as CSS hex string. */
  color: z.string().default("#000000"),

  /** Grid line opacity (0–1). */
  alpha: z.number().min(0).max(1).default(1),

  /** Hex-specific options. Required when type === "hex". */
  hex: z
    .object({
      orientation: z.enum(["pointy", "flat"]),
      parity: z.enum(["odd", "even"]),
    })
    .optional(),

  /**
   * Diagonal movement rule. Only applies to square grids.
   * REQ-CNV-019. PF2e default: "alternating_1" (5-10-5). REQ-CNV-020.
   */
  diagonalRule: z
    .enum([
      "equidistant",
      "exact",
      "approximate",
      "rectilinear",
      "alternating_1",
      "alternating_2",
      "illegal",
    ])
    .optional(),
});

export type GridConfigZod = z.infer<typeof GridConfigSchema>;
// Structural compatibility note:
// GridConfigZod is compatible with GridConfig when hex is present.
// The `hex` field is optional in both, so GridConfigZod satisfies GridConfig
// when hex is provided. We don't do a compile-time cast because
// exactOptionalPropertyTypes makes `T | undefined` assignable only when
// the target type also marks the property as `| undefined`.
// The GridStrategy interface consumes GridConfig at runtime;
// GridConfigZod values are safe to pass as GridConfig arguments.
export type { GridConfig };

// ---------------------------------------------------------------------------
// Disposition — token attitude toward other characters
// Spec 02, TokenData.disposition
// ---------------------------------------------------------------------------

/** Token disposition values (hostile / neutral / friendly). */
export const DispositionSchema = z.union([
  z.literal(-1), // hostile
  z.literal(0), // neutral
  z.literal(1), // friendly
]);

export type Disposition = z.infer<typeof DispositionSchema>;

// ---------------------------------------------------------------------------
// TokenBarConfig — attribute bar placeholder (M1-C will refine)
// ---------------------------------------------------------------------------

/**
 * Configuration for a token attribute bar.
 * `attribute` is a dot-path into the actor's system data (e.g. "attributes.hp").
 * M1-C will expand this to support derived attributes.
 */
export const TokenBarConfigSchema = z.object({
  /** Dot-path attribute key, or null if the bar is disabled. */
  attribute: z.string().nullable().default(null),
});

export type TokenBarConfig = z.infer<typeof TokenBarConfigSchema>;

// ---------------------------------------------------------------------------
// TokenDocument — embedded in Scene
// Spec 02 §TokenData, Spec 06 §Tokens
// REQ-DOC-019: Token is embedded; ownership inherits from actor (REQ-DOC-025)
// ---------------------------------------------------------------------------

/**
 * Token ownership policy (spec 02, D7 + REQ-DOC-025):
 *
 * Tokens are embedded documents and do NOT carry their own ownership map
 * (REQ-DOC-025 — embedded docs inherit from parent, except JournalPage).
 * For visibility/interaction purposes, the effective ownership is derived
 * from the referenced Actor (when actorId is set) or treated as GM-only.
 *
 * This schema therefore omits an `ownership` field.
 * The server-side permission layer (05-usuarios-e-permissoes.md) is
 * responsible for resolving token visibility by looking up the Actor's
 * ownership map.
 */
export const TokenDocumentSchema = z.object({
  /** Unique 16-character nanoid ID within the Scene's tokens collection. REQ-DOC-001. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /** Display name on the canvas (may differ from Actor name). */
  name: z.string().default(""),

  /**
   * Soft reference to the base Actor document.
   * Null for "anonymous" tokens without an actor backing.
   * REQ-DOC-031.
   */
  actorId: z.string().nullable().default(null),

  /**
   * Path or URL to the token artwork texture.
   * Null renders a placeholder silhouette.
   * M1-E (asset upload) will enforce valid asset paths; for now any string
   * or null is accepted.
   */
  texture: z.string().nullable().default(null),

  /**
   * X position of the token's top-left corner in scene pixel coordinates.
   * World-space pixels; not snapped — snapping is handled by the canvas layer.
   */
  x: z.number().default(0),

  /**
   * Y position of the token's top-left corner in scene pixel coordinates.
   */
  y: z.number().default(0),

  /**
   * Token footprint width in grid cells.
   * 1 = one-cell-wide token (e.g. medium creature in PF2e).
   * Must be at least 0.5.
   */
  width: z.number().min(0.5).default(1),

  /**
   * Token footprint height in grid cells.
   * Must be at least 0.5.
   */
  height: z.number().min(0.5).default(1),

  /** Rotation angle in degrees (0 = facing right/east, clockwise). */
  rotation: z.number().min(0).max(360).default(0),

  /**
   * Elevation of the token in scene units (feet or meters depending on gridUnits).
   * Used for overhead tile occlusion and future 3D-ish distance calculations.
   */
  elevation: z.number().default(0),

  /**
   * Whether the token is hidden from non-GM users.
   * Hidden tokens are still visible to GMs (dimmed indicator).
   */
  hidden: z.boolean().default(false),

  /** Token disposition: -1 hostile, 0 neutral, 1 friendly. */
  disposition: DispositionSchema.default(0),

  /**
   * Primary attribute bar (e.g. HP).
   * Spec 02 §TokenData.bar1.
   */
  bar1: TokenBarConfigSchema.default({ attribute: null }),

  /**
   * Secondary attribute bar.
   * Spec 02 §TokenData.bar2.
   */
  bar2: TokenBarConfigSchema.default({ attribute: null }),

  /**
   * Namespaced arbitrary data per namespace.
   * Structure: { [namespace]: { [key]: value } }
   * REQ-DOC-009.
   */
  flags: FlagsSchema.default(() => ({})),
});

export type TokenDocument = z.infer<typeof TokenDocumentSchema>;

/** Factory: build a minimal valid TokenDocument with defaults. */
export function defaultTokenDocument(id: string): TokenDocument {
  return TokenDocumentSchema.parse({ _id: id });
}

// ---------------------------------------------------------------------------
// SceneDocument — primary Document
// Spec 02 §SceneDocument, Spec 06 §SceneConfig
// REQ-DOC-018: Scene is a primary Document with _id, _stats, flags, ownership.
// REQ-DOC-021: EmbeddedCollections: tokens, walls, lights, sounds, tiles,
//              drawings, templates, notes.
// ---------------------------------------------------------------------------

/**
 * Initial camera view when the scene is activated.
 * Null = fit scene to viewport. REQ-CNV-068.
 */
export const InitialViewSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    /** Scale factor (zoom level). 1 = 100%, 0.5 = 50%, 2 = 200%. */
    scale: z.number().positive(),
  })
  .nullable();

export type InitialView = z.infer<typeof InitialViewSchema>;

/**
 * SceneDocument Zod schema.
 *
 * Extends BaseDocument with:
 *  - Canvas dimensions and grid configuration (from SceneConfig / spec 06)
 *  - EmbeddedCollections as arrays (persisted as JSON in the parent row — spec 03 Q1)
 *
 * Design notes:
 *  - `active` indicates the scene currently displayed on the canvas.
 *    Only one scene is active at a time; the server enforces this.
 *  - EmbeddedCollections other than `tokens` (walls, lights, sounds, tiles,
 *    drawings, templates, notes) are represented as `z.array(z.unknown())`
 *    because their full schemas belong to canvas/vision specs (06, 07) and
 *    are not yet defined in M1-B. They will be typed in M1-C/M2 as the
 *    respective embedded schemas are added.
 *  - `system` is absent on Scene (spec 02 table: Scene has no system blob).
 *  - `background` accepts a path/URL string or null (M1-E will validate asset
 *    paths; for now any string is valid per the M1-B scope note).
 */
export const SceneDocumentSchema = BaseDocumentSchema.omit({
  // Scene does NOT use the optional `type` discriminator or `system` blob.
  // Omit the generic BaseDocument fields and re-declare precisely.
  type: true,
  system: true,
}).extend({
  // --- Identity / display ---

  /** Human-readable scene name (shown in nav bar). */
  name: z.string().default("New Scene"),

  /**
   * Whether this is the currently active scene.
   * The server flips this atomically when GM activates a scene.
   */
  active: z.boolean().default(false),

  /** Ownership map. Default: only GMs see new scenes. REQ-DOC-027. */
  ownership: OwnershipSchema.default(() => defaultOwnership()),

  /** Soft reference to the containing Folder. */
  folder: z.string().nullable().optional(),

  // --- Canvas dimensions (REQ-CNV-064) ---

  /** Scene width in pixels (excluding padding area). */
  width: z.number().int().positive().default(4000),

  /** Scene height in pixels (excluding padding area). */
  height: z.number().int().positive().default(4000),

  /**
   * Padding around the scene as a fraction of dimensions.
   * E.g. 0.25 adds 25% of width/height as empty border on each side.
   * REQ-CNV-066.
   */
  padding: z.number().min(0).max(0.5).default(0.25),

  // --- Background (REQ-CNV-065) ---

  /**
   * Path or URL to the background map image.
   * Null = solid backgroundColor canvas.
   * M1-E will enforce valid asset paths.
   */
  background: z.string().nullable().default(null),

  /** CSS color for the canvas background when no background image is set. */
  backgroundColor: z.string().default("#000000"),

  // --- Grid (REQ-CNV-067) ---

  /** Grid configuration (type, size, color, diagonal rule, etc.). */
  grid: GridConfigSchema.default(() => ({
    type: "square" as const,
    size: 100,
    distance: 5,
    units: "ft",
    color: "#000000",
    alpha: 0.2,
  })),

  // --- Initial view (REQ-CNV-068) ---

  /**
   * Initial camera position/zoom when the scene is activated.
   * Null = fit scene to viewport.
   */
  initialView: InitialViewSchema.default(null),

  // --- Vision / fog toggles (spec 07 placeholders) ---

  /**
   * Whether token vision is enabled.
   * When false, all players see the entire scene (no fog of war).
   */
  tokenVision: z.boolean().default(false),

  // --- Navigation ---

  /** Whether this scene appears in the navigation bar. */
  navigation: z.boolean().default(true),

  /** Override display name in the navigation bar. Null = use `name`. */
  navName: z.string().nullable().default(null),

  /** Path/URL to a thumbnail image (auto-generated by the server). */
  thumb: z.string().nullable().default(null),

  // --- Soft references ---

  /** Playlist to auto-play when this scene is activated. */
  playlistId: z.string().nullable().default(null),

  /** Journal entry linked to this scene. */
  journalId: z.string().nullable().default(null),

  // -------------------------------------------------------------------------
  // EmbeddedCollections (REQ-DOC-021)
  // Persisted as JSON within the Scene row (spec 03 Q1 / DEC-PER-02).
  // -------------------------------------------------------------------------

  /**
   * Embedded tokens.
   * Fully typed via TokenDocumentSchema.
   */
  tokens: z.array(TokenDocumentSchema).default(() => []),

  /**
   * Embedded walls (blocking geometry for vision/movement).
   * Full WallData schema is defined in spec 07 (M2); placeholder here.
   */
  walls: z.array(z.unknown()).default(() => []),

  /**
   * Embedded ambient lights.
   * Full LightData schema is defined in spec 07 (M2); placeholder here.
   */
  lights: z.array(z.unknown()).default(() => []),

  /**
   * Embedded ambient sounds.
   * Full SoundData schema is defined in spec 13 (M2); placeholder here.
   */
  sounds: z.array(z.unknown()).default(() => []),

  /**
   * Embedded tiles (underfoot / overhead map elements).
   * Full TileData schema is defined in spec 06 (M2); placeholder here.
   */
  tiles: z.array(z.unknown()).default(() => []),

  /**
   * Embedded freehand drawings and shapes.
   * Full DrawingData schema is defined in spec 06 (M2); placeholder here.
   */
  drawings: z.array(z.unknown()).default(() => []),

  /**
   * Embedded measured templates (AoE shapes).
   * Full TemplateData schema is defined in spec 06 (M2); placeholder here.
   */
  templates: z.array(z.unknown()).default(() => []),

  /**
   * Embedded map notes / pins (linked to JournalEntries).
   * Full NoteData schema is defined in spec 06 (M2); placeholder here.
   */
  notes: z.array(z.unknown()).default(() => []),
});

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;

/** Factory: build a valid SceneDocument with all defaults populated. */
export function defaultSceneDocument(id: string, name = "New Scene"): SceneDocument {
  return SceneDocumentSchema.parse({
    _id: id,
    _stats: defaultStats(),
    name,
  });
}

// ---------------------------------------------------------------------------
// Token diff path helpers (spec 04, REQ-NET-021 + M1-C token movement)
// ---------------------------------------------------------------------------

/**
 * Type-safe token embedded diff path builder.
 *
 * The server uses dot-path notation for diffs on embedded documents:
 *   `tokens.<tokenId>.<field>` → update a specific field on a specific token.
 *
 * This is the format consumed by the server's deep-merge engine when
 * processing `doc:update` payloads with `embedded.type = "Token"`.
 *
 * Usage:
 *   tokenDiffPath("abc1234567890123", "x")
 *   // → "tokens.abc1234567890123.x"
 *
 * M1-C (token drag): use this to build minimal move diffs:
 *   { [tokenDiffPath(id, "x")]: 200, [tokenDiffPath(id, "y")]: 300 }
 *
 * Typed field keys prevent typos at compile time.
 */
export type TokenDiffField = keyof Omit<TokenDocument, "_id">;

export function tokenDiffPath(tokenId: string, field: TokenDiffField): string {
  return `tokens.${tokenId}.${field}`;
}

/**
 * Build a minimal move diff payload for a token.
 * Used by both the server (applying moves) and the client (optimistic updates).
 *
 * @param tokenId - The 16-char token _id.
 * @param x - New x position in scene pixels.
 * @param y - New y position in scene pixels.
 * @param rotation - Optional new rotation in degrees.
 * @returns A DocumentDiff record with dot-path keys.
 */
export function buildTokenMoveDiff(
  tokenId: string,
  x: number,
  y: number,
  rotation?: number,
): Record<string, number> {
  const diff: Record<string, number> = {
    [tokenDiffPath(tokenId, "x")]: x,
    [tokenDiffPath(tokenId, "y")]: y,
  };
  if (rotation !== undefined) {
    diff[tokenDiffPath(tokenId, "rotation")] = rotation;
  }
  return diff;
}
