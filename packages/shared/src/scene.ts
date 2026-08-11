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
import {
  WallDocumentSchema,
  AmbientLightDocumentSchema,
  TokenVisionSchema,
  TokenLightSchema,
} from "./vision/scene-schemas.js";

// ---------------------------------------------------------------------------
// GridConfig Zod schema
// (GridConfig is defined as a plain TS interface in grid/types.ts;
//  we re-declare it as a Zod schema here to use inside SceneDocumentSchema)
// ---------------------------------------------------------------------------

export const GridConfigSchema = z.object({
  /** Grid type: square, hex, or gridless. REQ-CNV-014. */
  type: z.enum(["square", "hex", "gridless"]).default("square"),

  /**
   * Cell size in pixels. Minimum 50 px. REQ-CNV-017.
   * Square: side length. Hex: flat-to-flat width (pointy) or height (flat).
   */
  size: z.number().int().min(50).default(100),

  /**
   * In-game distance represented by one cell (e.g. 5).
   *
   * Defaulted, like `type`/`size`/`units`, because a caller that sends only
   * the field it cares about ({ size: 140 }, say) is stating a cell size, not
   * declining to have a distance. Before the server validated grids at all
   * this was moot — the whole grid was dropped on the floor. Now that it is
   * enforced, rejecting the partial object would turn "your cell size was
   * ignored" into "your scene would not save", which is not an improvement.
   */
  distance: z.number().positive().default(5),

  /** Unit label (e.g. "ft", "m"). */
  units: z.string().default("ft"),

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
// TokenDisplayMode — who sees the token's resource bars
// REQ-CNV-089 / REQ-CNV-031, decided in DEC-CNV-15 (spec 06)
// ---------------------------------------------------------------------------

/**
 * The five canonical visibility levels for a token overlay (resource bars
 * today; nameplate and status icons follow the same ladder — REQ-CNV-031).
 *
 * `observer` is the ownership-gated level and it means OBSERVER (2) **or more**
 * on the token's Actor, never OWNER: reading a companion's HP does not require
 * the right to edit their sheet. There is deliberately no "owner" level — the
 * spec prose used to say "dono", which named nothing in this codebase.
 *
 * The cut itself is enforced on the SERVER (the Actor never reaches a user who
 * may not see it — REQ-NET-096); this field only says what the client draws
 * with data it legitimately holds.
 */
export const TokenDisplayModeSchema = z.enum([
  /** Nobody sees the bars, GM included. */
  "never",
  /** OBSERVER+ on the token's Actor (or a privileged role) sees them. */
  "observer",
  /** Same cut as `observer`, but only while the pointer hovers the token. */
  "hoverObserver",
  /** Anyone sees them while hovering, regardless of ownership. */
  "hoverAll",
  /** Anyone sees them at all times, regardless of ownership. */
  "always",
]);

export type TokenDisplayMode = z.infer<typeof TokenDisplayModeSchema>;

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
   * Does this token SHARE the world Actor, or does it own its own copy of it?
   * REQ-DOC-031 / REQ-DOC-032 / REQ-DOC-033.
   *
   * `true` (linked) — the token IS the Actor. Damage taken by the token is
   * damage taken by the Actor, and every other linked token of that Actor
   * shows it. This is what a player character wants: one sheet, one hit-point
   * pool, however many tokens.
   *
   * `false` (unlinked) — the token carries an `actorDelta` and the actor it
   * plays with is reconstructed from base + delta. This is what six skeletons
   * out of one "Esqueleto" Actor want: killing the third leaves the other
   * five untouched.
   *
   * The default is `true` because it is the only value that leaves every token
   * ALREADY PERSISTED behaving exactly as before — those tokens have no such
   * field, and Zod fills the default on every read. `false` as the default
   * would silently re-interpret the whole existing world. The GM-facing
   * default for NEWLY created tokens is a different question, answered at
   * creation time by REQ-DOC-061.
   */
  actorLink: z.boolean().default(true),

  /**
   * This token's private difference from the base Actor — REQ-DOC-033.
   *
   * A merge patch over the Actor's fields (`name`, `img`, `system`, and an
   * integral replacement of `items`/`effects` when present), never a mini
   * Actor with its own embedded collections — DEC-DOC-08 rejects Foundry's
   * `EmbeddedCollectionDelta` explicitly. Shapeless because `system` belongs
   * to the game system, not to the engine.
   *
   * Meaningful only when `actorLink === false`; a linked token's delta is
   * ignored by `effectiveTokenActor` rather than being an error, so flipping
   * a token back to unlinked restores what it had.
   *
   * Reconstruction lives in `actor-delta.ts` (`applyActorDelta`) — one
   * implementation for server and client, never two.
   */
  actorDelta: z.record(z.string(), z.unknown()).default(() => ({})),

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
   * Primary attribute bar. Defaults to HP so a freshly placed token already
   * shows a truthful bar (REQ-CNV-090) — `displayBars` still decides who sees
   * it. A system that stores HP elsewhere overrides per token via the config.
   * Spec 02 §TokenData.bar1.
   */
  bar1: TokenBarConfigSchema.default({ attribute: "attributes.hp" }),

  /**
   * Secondary attribute bar.
   * Spec 02 §TokenData.bar2.
   */
  bar2: TokenBarConfigSchema.default({ attribute: null }),

  /**
   * Who may see this token's resource bars (REQ-CNV-089, DEC-CNV-15).
   *
   * Defaults to `observer`: the party sees each other's HP without the GM
   * configuring anything, while a monster the players do not observe keeps its
   * bar to itself. The server is what makes that true — it does not emit the
   * Actor to a user below LIMITED at all (REQ-NET-096) — so this field is the
   * display policy, not the security boundary.
   */
  displayBars: TokenDisplayModeSchema.default("observer"),

  /**
   * Namespaced arbitrary data per namespace.
   * Structure: { [namespace]: { [key]: value } }
   * REQ-DOC-009.
   */
  flags: FlagsSchema.default(() => ({})),

  /**
   * Vision configuration for this token.
   * REQ-VIS-060: enabled, range, angle, visionMode, detectionModes.
   * Render on client only; server uses enabled/range for movement validation context.
   */
  vision: TokenVisionSchema.default(() => TokenVisionSchema.parse({})),

  /**
   * Light emission configuration for this token.
   * REQ-VIS-041: token emits light with same parameters as AmbientLight.
   * Position comes from token x/y; render on client only.
   */
  light: TokenLightSchema.default(() => TokenLightSchema.parse({})),
});

export type TokenDocument = z.infer<typeof TokenDocumentSchema>;

/** Factory: build a minimal valid TokenDocument with defaults. */
export function defaultTokenDocument(id: string): TokenDocument {
  return TokenDocumentSchema.parse({ _id: id });
}

// ---------------------------------------------------------------------------
// Note — a map pin, with its own ownership (REQ-DOC-056/057, REQ-CNV-057/058)
// ---------------------------------------------------------------------------

/**
 * A Note is a pin on the map: a village, a ruin, a dungeon entrance.
 *
 * It is the **second exception** to REQ-DOC-025 (embedded documents inherit the
 * parent's ownership — the first is JournalEntryPage). A pin carries its own
 * ownership map because its visibility is per-player and that is the whole
 * point of it: the same ruin is nothing to one character, a rumour to another
 * ("they say something walks the road to Godford") and a named place to a third
 * who has been there.
 *
 * Two rules are not negotiable, both from REQ-DOC-056/057:
 *
 *  1. **Every pin is born hidden** (`ownership.default = NONE`). Revealing is a
 *     deliberate act. A pin that defaults to visible hands the map away the
 *     instant the GM drops it while preparing the session.
 *  2. **`none` is absence of payload, `limited` is a redacted payload.** The
 *     player at `none` never receives the note; the player at `limited`
 *     receives position and nothing else — no name, no icon, no tooltip, no
 *     `entryId`/`pageId`, no content flags. Enforced server-side in
 *     `redaction.ts` (REQ-DOC-058); this schema only defines the shape.
 *
 * `global: true` is the escape hatch for landmarks nobody is meant to discover
 * (the capital, the mountain range): it reads as `observer` for everyone.
 */
export const NoteDocumentSchema = z.object({
  /** Unique 16-character nanoid ID within the Scene's notes collection. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /** Soft reference to the JournalEntry this pin opens. */
  entryId: z.string().nullable().default(null),

  /** Soft reference to a specific page of that entry. */
  pageId: z.string().nullable().default(null),

  /** Position in scene pixel coordinates. */
  x: z.number().default(0),
  y: z.number().default(0),

  /** Elevation, for scenes that stack floors. */
  elevation: z.number().default(0),

  /** Icon path/URL; null falls back to the engine's neutral pin. */
  icon: z.string().nullable().default(null),

  /** Icon size in scene pixels. */
  iconSize: z.number().positive().default(40),

  /** Tooltip override; null uses the linked entry's name. */
  text: z.string().nullable().default(null),

  /** Label typography. */
  fontFamily: z.string().default("Signika"),
  fontSize: z.number().positive().default(24),
  textColor: z.string().nullable().default(null),

  /** Label anchor relative to the icon (see REQ-CNV-057). */
  textAnchor: z.number().int().default(1),

  /** Visible to everyone regardless of ownership — reads as `observer`. */
  global: z.boolean().default(false),

  /**
   * Per-user reveal state. Default `{ default: NONE }` — born hidden.
   * REQ-DOC-025 exception, REQ-DOC-056.
   */
  ownership: OwnershipSchema.default(() => defaultOwnership()),

  /** Namespaced flags: `flags.fusion.portal = { sceneId }` lives here. */
  flags: FlagsSchema.default(() => ({})),
});

export type NoteDocument = z.infer<typeof NoteDocumentSchema>;

/** Factory: build a minimal valid NoteDocument with defaults (born hidden). */
export function defaultNoteDocument(id: string): NoteDocument {
  return NoteDocumentSchema.parse({ _id: id });
}

// ---------------------------------------------------------------------------
// Tile — an image the scene is composed from (REQ-CNV-003, spec 06)
// ---------------------------------------------------------------------------

/**
 * A Tile is an extra image placed on the scene beyond its background.
 *
 * A scene is rarely one picture. The same room gets a "before" and an "after",
 * a trapdoor is revealed halfway through the fight, the upper floor covers the
 * lower one until the party climbs. Modelling that as several images the GM
 * shows and hides is enough to cover all of it, and stays out of the way of
 * the background, which remains the single image that defines the scene's
 * extent.
 *
 * Tiles render in the canvas's `tiles` layer — above the background, below the
 * tokens — in `sort` order.
 */
export const TileDocumentSchema = z.object({
  /** Unique 16-character nanoid ID within the Scene's tiles collection. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /** Label shown in the GM's layer list. Not rendered on the canvas. */
  name: z.string().default(""),

  /**
   * Path or URL to the image, same convention as Token.texture and
   * Scene.background: a `/assets/<name>` path resolved to a signed URL at
   * load time, or an external URL.
   */
  texture: z.string().nullable().default(null),

  /** Top-left corner in scene pixel coordinates. */
  x: z.number().default(0),
  y: z.number().default(0),

  /** Rendered size in scene pixels. */
  width: z.number().positive().default(1000),
  height: z.number().positive().default(1000),

  /** Rotation in degrees, clockwise, about the tile's center. */
  rotation: z.number().default(0),

  /** Opacity, 0–1. */
  alpha: z.number().min(0).max(1).default(1),

  /**
   * Hidden from players — this is the "when it appears" control.
   *
   * Redacted server-side exactly like a hidden token: a player's client never
   * receives the tile at all, not even to skip drawing it. Otherwise the map
   * of the floor below would be one devtools panel away, and a GM who hid it
   * would have been told it was hidden.
   */
  hidden: z.boolean().default(false),

  /** Stacking order among tiles; higher draws on top. */
  sort: z.number().int().default(0),
});

export type TileDocument = z.infer<typeof TileDocumentSchema>;

/** Factory: build a minimal valid TileDocument with defaults. */
export function defaultTileDocument(id: string): TileDocument {
  return TileDocumentSchema.parse({ _id: id });
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

  /**
   * Where the grid starts, in scene pixels — the top-left corner of cell (0,0).
   *
   * Null means "align to the padding border", which is what every scene did
   * before calibration existed and remains the sensible default for a map
   * drawn to fit. A map image with its own grid baked in almost never starts
   * exactly on that border, so calibration writes the measured origin here.
   *
   * Kept OUT of GridConfig on purpose: `grid` describes the grid itself (how
   * big a cell is, what a cell means, how it looks), while this says where
   * this particular scene puts it — the same separation the SquareGrid
   * constructor already draws by taking `origin` apart from `config`.
   *
   * Normally normalized to [0, grid.size), since the grid repeats.
   */
  gridOffsetX: z.number().finite().nullable().default(null),
  gridOffsetY: z.number().finite().nullable().default(null),

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

  /**
   * Whether fog of war is enabled for this scene.
   * REQ-VIS-085: when false, all players see the entire map.
   */
  fogEnabled: z.boolean().default(false),

  /**
   * Scene darkness level (0–1).
   * 0 = fully lit, 1 = pitch dark. Controls GI threshold and visual atmosphere.
   * REQ-VIS-044.
   */
  darkness: z.number().min(0).max(1).default(0),

  /**
   * Global illumination flag.
   * When true and darkness < globalLightThreshold, the whole explored area
   * counts as at least dim/bright (no light sources needed).
   * REQ-VIS-044, REQ-VIS-045.
   */
  globalLight: z.boolean().default(true),

  /**
   * Darkness level above which global illumination is suppressed (0–1).
   * When scene.darkness >= this value, globalLight is effectively off.
   * REQ-VIS-044.
   */
  globalLightThreshold: z.number().min(0).max(1).default(0.5),

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
   * Embedded walls.
   * REQ-VIS-001: walls with independent move/sight/light/sound restrictions.
   * REQ-VIS-004: door type and state.
   * Spec 07 §Modelo de dados, M2-A.
   */
  walls: z.array(WallDocumentSchema).default(() => []),

  /**
   * Embedded ambient light sources.
   * REQ-VIS-040: position, radii, color, angle, enabled.
   * Spec 07 §REQ-VIS-040, M2-A.
   */
  lights: z.array(AmbientLightDocumentSchema).default(() => []),

  /**
   * Embedded ambient sounds.
   * Full SoundData schema is defined in spec 13 (M2); placeholder here.
   */
  sounds: z.array(z.unknown()).default(() => []),

  /**
   * Embedded tiles — the extra images a scene is built from.
   * See {@link TileDocumentSchema}.
   */
  tiles: z.array(TileDocumentSchema).default(() => []),

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
   * Typed: each pin carries its own ownership (REQ-DOC-056) and is redacted
   * per viewer server-side (REQ-DOC-058).
   */
  notes: z.array(NoteDocumentSchema).default(() => []),
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
