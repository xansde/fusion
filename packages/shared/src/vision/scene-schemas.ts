/**
 * Zod schemas for Wall and AmbientLight embedded documents, plus token
 * vision/light subdocuments.
 *
 * These schemas live in packages/shared so both the server (CRUD validation,
 * movement collision) and the client (canvas render) share the exact same types.
 *
 * Spec: 07-visao-iluminacao-fog.md — §Modelo de dados
 * REQ-VIS-001..004: Wall with independent restrictions, directionality, door
 * REQ-VIS-040..041: AmbientLight and TokenLight
 * REQ-VIS-060: TokenVision parameters
 * REQ-VIS-106: types must live in packages/shared
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Wall — embedded in Scene
// REQ-VIS-001: independent move/sight/light/sound restrictions
// REQ-VIS-002: RestrictionMode per dimension; move only none/normal [MVP]
// REQ-VIS-003: WallDirection
// REQ-VIS-004: doorType + doorState
// ---------------------------------------------------------------------------

/** Restriction mode for sight/light/sound dimensions [MVP]. */
export const RestrictionModeSchema = z.enum(["none", "normal", "limited"]);

/** Move restriction — only none/normal (no limited for move). */
export const MoveRestrictionSchema = z.enum(["none", "normal"]);

/** Wall direction relative to a→b orientation. */
export const WallDirectionSchema = z.enum(["both", "left", "right"]);

/** Door type. */
export const DoorTypeSchema = z.enum(["none", "door", "secret"]);

/** Door state. */
export const DoorStateSchema = z.enum(["closed", "open", "locked"]);

/** 2-D point schema (scene pixel coordinates). */
export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * WallDocument — embedded in Scene.walls[].
 *
 * Persisted exactly as these fields; the "preset" (normal/terrain/etc.) is
 * purely a UI convenience that expands into these four restriction fields on
 * save.
 *
 * REQ-VIS-001: four independent restrictions
 * REQ-VIS-003: directionality
 * REQ-VIS-004: door type + state
 */
export const WallDocumentSchema = z.object({
  /** Unique 16-char nanoid within the scene's walls collection. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /** Endpoint A in scene pixel coordinates. */
  a: PointSchema,

  /** Endpoint B in scene pixel coordinates. */
  b: PointSchema,

  /** Movement restriction: none = open passage, normal = solid wall. */
  move: MoveRestrictionSchema.default("normal"),

  /** Sight restriction. */
  sight: RestrictionModeSchema.default("normal"),

  /** Light restriction. */
  light: RestrictionModeSchema.default("normal"),

  /** Sound restriction. */
  sound: RestrictionModeSchema.default("normal"),

  /**
   * Directionality relative to the a→b orientation.
   * "both" = restricts from either side (default).
   * "left"/"right" = one-way restriction (CA-17, REQ-VIS-003).
   */
  dir: WallDirectionSchema.default("both"),

  /**
   * Door type.
   * "none" = plain wall (no door controls rendered).
   * "door" = interactive door (players can open/close).
   * "secret" = GM-only door (invisible to players — CA-16, REQ-VIS-005).
   */
  doorType: DoorTypeSchema.default("none"),

  /**
   * Door state.
   * When "open", the wall does NOT restrict any dimension (REQ-VIS-004).
   * When "locked", only GM can change state (REQ-VIS-007).
   */
  doorState: DoorStateSchema.default("closed"),

  /**
   * [V2] Threshold in pixels for proximity/reverse_proximity modes.
   * Not used in MVP; reserved for future use.
   */
  threshold: z.number().optional(),

  /**
   * [V2] Gradual attenuation for proximity walls.
   */
  attenuation: z.boolean().optional(),
});

export type WallDocument = z.infer<typeof WallDocumentSchema>;

/** Factory: minimal valid WallDocument with defaults. */
export function defaultWallDocument(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): WallDocument {
  return WallDocumentSchema.parse({ _id: id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
}

// ---------------------------------------------------------------------------
// LightAnimation — [V2] animation config for lights
// Included here so AmbientLightDocument can reference it; render is client-only.
// REQ-VIS-047 [V2]
// ---------------------------------------------------------------------------

export const LightAnimationSchema = z.object({
  /** Animation type identifier, e.g. "torch", "pulse", "chroma". */
  type: z.string(),
  /** Speed 0–10. */
  speed: z.number().min(0).max(10).default(5),
  /** Intensity 0–10. */
  intensity: z.number().min(0).max(10).default(5),
  /** Reverse the animation direction. */
  reverse: z.boolean().default(false),
});

export type LightAnimation = z.infer<typeof LightAnimationSchema>;

// ---------------------------------------------------------------------------
// AmbientLightDocument — embedded in Scene.lights[]
// REQ-VIS-040: position, bright/dim radii, color, intensity, angle, enabled
// REQ-VIS-047 [V2]: animation
// ---------------------------------------------------------------------------

/**
 * AmbientLightDocument — embedded in Scene.lights[].
 *
 * Radii (bright/dim) are in grid units; conversion to pixels happens at
 * render time using the scene's grid.size (spec REQ-VIS-040).
 */
export const AmbientLightDocumentSchema = z
  .object({
    /** Unique 16-char nanoid within the scene's lights collection. */
    _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

    /** X position in scene pixel coordinates. */
    x: z.number(),

    /** Y position in scene pixel coordinates. */
    y: z.number(),

    /**
     * Bright light radius in grid units.
     * 0 = no bright area (only dim if dim > 0).
     */
    brightRadius: z.number().min(0).default(0),

    /**
     * Dim (penumbra) light radius in grid units.
     * Must be >= brightRadius; the bright area is nested inside dim.
     */
    dimRadius: z.number().min(0).default(5),

    /**
     * Angle of emission in degrees.
     * 360 = full circle (default); < 360 = directional (cone) light.
     */
    angle: z.number().min(0).max(360).default(360),

    /**
     * Rotation/orientation of the emission cone in degrees.
     * 0 = east (right), clockwise. Ignored when angle = 360.
     */
    rotation: z.number().default(0),

    /** Light color as CSS hex string (#rrggbb). */
    color: z.string().default("#ffffff"),

    /**
     * Color intensity 0–1.
     * 0 = no tint (white/neutral), 1 = full color saturation.
     */
    intensity: z.number().min(0).max(1).default(0.5),

    /**
     * Whether bright→dim transition is gradual (smooth gradient) or abrupt.
     * true = gradual (default); false = hard edge.
     */
    gradual: z.boolean().default(true),

    /**
     * [V2] When false, light ignores walls (passes through everything).
     * Default true = constrained by walls of light dimension.
     */
    constrainedByWalls: z.boolean().default(true),

    /**
     * [V2] Luminosity multiplier. Negative values create darkness sources.
     */
    luminosity: z.number().default(1),

    /**
     * [V2] Animation configuration.
     */
    animation: LightAnimationSchema.optional(),

    /** Whether this light source is active. */
    enabled: z.boolean().default(true),
  })
  .refine((l) => l.dimRadius >= l.brightRadius, {
    message: "dimRadius must be >= brightRadius",
    path: ["dimRadius"],
  });

export type AmbientLightDocument = z.infer<typeof AmbientLightDocumentSchema>;

/** Factory: minimal valid AmbientLightDocument with defaults. */
export function defaultAmbientLightDocument(
  id: string,
  x: number,
  y: number,
): AmbientLightDocument {
  return AmbientLightDocumentSchema.parse({ _id: id, x, y });
}

// ---------------------------------------------------------------------------
// TokenVision — vision parameters embedded in a Token
// REQ-VIS-060: enabled, range, angle, visionMode
// ---------------------------------------------------------------------------

/** Vision mode identifiers (MVP: basic, darkvision). [V2]: monochromatic, tremorsense. */
export const VisionModeIdSchema = z.enum(["basic", "darkvision", "monochromatic", "tremorsense"]);

export type VisionModeId = z.infer<typeof VisionModeIdSchema>;

/** Detection mode identifiers. [MVP]: sight. [V2]: see-invisibility, sense-invisibility, feel-tremor. */
export const DetectionModeIdSchema = z.enum([
  "sight",
  "see-invisibility",
  "sense-invisibility",
  "feel-tremor",
]);

export type DetectionModeId = z.infer<typeof DetectionModeIdSchema>;

/** A single detection mode entry on a token. */
export const DetectionModeEntrySchema = z.object({
  id: DetectionModeIdSchema,
  /** Range in grid units; null = unlimited within scene bounds. */
  range: z.number().positive().nullable().default(null),
  enabled: z.boolean().default(true),
});

export type DetectionModeEntry = z.infer<typeof DetectionModeEntrySchema>;

/** Default detection modes: sight enabled, unlimited range. */
const DEFAULT_DETECTION_MODES: Array<{ id: DetectionModeId; range: null; enabled: boolean }> = [
  { id: "sight", range: null, enabled: true },
];

/**
 * Vision configuration subdocument for a Token.
 * REQ-VIS-060: enabled flag, range, angle, visionMode, detectionModes.
 */
export const TokenVisionSchema = z.object({
  /** Whether this token has vision at all. */
  enabled: z.boolean().default(false),

  /**
   * Sight range in grid units.
   * null = unlimited (sees the entire visible area within scene bounds).
   */
  range: z.number().positive().nullable().default(null),

  /** Cone angle in degrees. 360 = full circle (default). */
  angle: z.number().min(0).max(360).default(360),

  /** Vision mode controlling the appearance of the visible area. */
  visionMode: VisionModeIdSchema.default("basic"),

  /** Active detection modes. Must include "sight" for standard vision. */
  detectionModes: z.array(DetectionModeEntrySchema).default(() => [...DEFAULT_DETECTION_MODES]),
});

export type TokenVision = z.infer<typeof TokenVisionSchema>;

// ---------------------------------------------------------------------------
// TokenLight — light emission parameters embedded in a Token
// REQ-VIS-041: token emits light with same parameters as AmbientLight
// ---------------------------------------------------------------------------

/**
 * Light emission configuration for a Token.
 * Mirrors AmbientLightDocument but without _id/x/y (position comes from token).
 */
export const TokenLightSchema = z
  .object({
    /** Bright radius in grid units. */
    brightRadius: z.number().min(0).default(0),

    /** Dim radius in grid units. */
    dimRadius: z.number().min(0).default(0),

    /** Emission angle in degrees (360 = full circle). */
    angle: z.number().min(0).max(360).default(360),

    /** Light color as CSS hex string (#rrggbb). */
    color: z.string().default("#ffffff"),

    /** Color intensity 0–1. */
    intensity: z.number().min(0).max(1).default(0.5),

    /** Smooth bright→dim gradient. */
    gradual: z.boolean().default(true),

    /** [V2] Animation configuration. */
    animation: LightAnimationSchema.optional(),

    /** Whether the token's light emission is active. */
    enabled: z.boolean().default(false),
  })
  .refine((l) => l.dimRadius >= l.brightRadius, {
    message: "dimRadius must be >= brightRadius",
    path: ["dimRadius"],
  });

export type TokenLight = z.infer<typeof TokenLightSchema>;
