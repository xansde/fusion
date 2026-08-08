/**
 * vision-state.ts — Pure (no PIXI) vision/lighting computation module.
 *
 * Spec: 07-visao-iluminacao-fog.md
 * REQ-VIS-020: angular sweep per source
 * REQ-VIS-027: caching + invalidation
 * REQ-VIS-040/041: ambient lights + token lights
 * REQ-VIS-060: token vision params
 * REQ-VIS-064: player sees union of controlled tokens; GM sees all
 *
 * This module is pure TypeScript: no PIXI, no DOM. All geometry comes from
 * @fusion/shared. The result (VisionStateResult) is consumed by LightingRenderer
 * to drive PIXI rendering.
 */

import {
  computeVisibilityPolygon,
  wallsBlockingSight,
  wallsBlockingLight,
  type Wall,
  type SceneBounds,
  type VisibilityPolygon,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types consumed from scene documents
// ---------------------------------------------------------------------------

export interface TokenVisionConfig {
  enabled: boolean;
  /** Range in scene pixels (null = unlimited within scene). */
  rangePx: number | null;
  /** Cone angle in degrees (360 = full circle). */
  angle: number;
  /** Cone center rotation in degrees (0 = east, CW). */
  rotation: number;
  visionMode: "basic" | "darkvision";
}

export interface LightConfig {
  id: string;
  x: number;
  y: number;
  /** Bright radius in scene pixels. */
  brightPx: number;
  /** Dim radius in scene pixels (outer). */
  dimPx: number;
  /** Angle of emission in degrees (360 = full). */
  angle: number;
  /** Rotation in degrees (0 = east, CW). */
  rotation: number;
  color: string;
  intensity: number;
  enabled: boolean;
}

export interface TokenSourceConfig {
  /** Token _id (used as source id). */
  id: string;
  x: number;
  y: number;
  vision: TokenVisionConfig;
  light: LightConfig | null;
  /** True if this token is controlled by the local user. */
  controlled: boolean;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface VisionPolygonResult {
  tokenId: string;
  polygon: VisibilityPolygon;
}

export interface LightPolygonResult {
  lightId: string;
  polygon: VisibilityPolygon;
  brightPolygon: VisibilityPolygon;
  color: string;
  intensity: number;
  dimPx: number;
  brightPx: number;
}

/**
 * The computed vision state for the current frame.
 * Consumed by LightingRenderer to draw fog + lighting.
 */
export interface VisionStateResult {
  /**
   * Union polygon of all controlled tokens' vision. Empty array = no vision.
   * For GM: all vertices of the scene bounds (sees everything).
   */
  visionPolygons: VisionPolygonResult[];

  /** All light source polygons (for rendering illumination). */
  lightPolygons: LightPolygonResult[];

  /** True if the local user is GM (no fog mask applied). */
  isGm: boolean;

  /** Scene darkness level 0–1. */
  darkness: number;

  /** Global illumination active. */
  globalLight: boolean;

  /**
   * Scene tokenVision flag (defensive read — see scene.ts / sceneReloadKey.ts).
   * REQ-VIS-085: when false, players see the whole scene — LightingRenderer
   * must not draw the simple vision mask even though isGm is false.
   */
  tokenVision: boolean;
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

function hashWalls(walls: Wall[]): string {
  // Fast hash: XOR of wall ids and door states
  let h = 0;
  for (const w of walls) {
    for (let i = 0; i < w._id.length; i++) {
      h = (h ^ w._id.charCodeAt(i)) * 31;
    }
    // Include door state so opening a door invalidates the cache
    if (w.doorState !== "closed") h ^= 0xdeadbeef;
  }
  return h.toString(16);
}

function sourceHash(token: TokenSourceConfig): string {
  const v = token.vision;
  const rangeStr = v.rangePx !== null ? String(v.rangePx) : "inf";
  const enabledStr = v.enabled ? "1" : "0";
  return `${token.id}:${String(token.x)}:${String(token.y)}:${rangeStr}:${String(v.angle)}:${String(v.rotation)}:${enabledStr}`;
}

function lightHash(l: LightConfig): string {
  const enabledStr = l.enabled ? "1" : "0";
  return `${l.id}:${String(l.x)}:${String(l.y)}:${String(l.brightPx)}:${String(l.dimPx)}:${String(l.angle)}:${String(l.rotation)}:${enabledStr}`;
}

// ---------------------------------------------------------------------------
// VisionStateComputer
// ---------------------------------------------------------------------------

/**
 * Stateful computer for vision/lighting polygons with per-source caching.
 *
 * REQ-VIS-027: invalidate only sources affected by a wall/door/token change.
 * Cache key = hash of (walls) + per-source params. A wall change busts all
 * vision caches; a token move only busts that token's cache.
 */
export class VisionStateComputer {
  private _wallHashSight = "";
  private _wallHashLight = "";
  private _visionCache = new Map<string, VisibilityPolygon>();
  private _lightCache = new Map<
    string,
    { polygon: VisibilityPolygon; bright: VisibilityPolygon }
  >();

  /**
   * Compute the full vision state.
   *
   * @param walls - All walls in the scene (raw typed).
   * @param tokens - All token sources in the scene.
   * @param sceneBounds - Scene bounding rectangle.
   * @param isGm - Whether the local user is GM.
   * @param darkness - Scene darkness level 0–1.
   * @param globalLight - Global illumination active.
   * @param tokenVision - Scene tokenVision flag. REQUIRED and read defensively
   *   at the call site (absent on the scene ⇒ false, like `grid`): a default
   *   here would silently re-arm the issue-#80 blackout on any future caller.
   */
  compute(
    walls: Wall[],
    tokens: TokenSourceConfig[],
    sceneBounds: SceneBounds,
    isGm: boolean,
    darkness: number,
    globalLight: boolean,
    tokenVision: boolean,
  ): VisionStateResult {
    const t0 = performance.now();

    const sightWalls = wallsBlockingSight(walls);
    const lightWalls = wallsBlockingLight(walls);

    const newSightHash = hashWalls(sightWalls);
    const newLightHash = hashWalls(lightWalls);

    // If wall set changed, bust all caches
    if (newSightHash !== this._wallHashSight) {
      this._wallHashSight = newSightHash;
      this._visionCache.clear();
    }
    if (newLightHash !== this._wallHashLight) {
      this._wallHashLight = newLightHash;
      this._lightCache.clear();
    }

    // --- Vision polygons ---
    const visionPolygons: VisionPolygonResult[] = [];

    for (const token of tokens) {
      if (!token.vision.enabled) continue;
      // Only compute for controlled tokens (GM computes nothing — sees all)
      if (!isGm && !token.controlled) continue;

      const key = sourceHash(token);
      let poly = this._visionCache.get(key);

      if (!poly) {
        poly = computeVisibilityPolygon({ x: token.x, y: token.y }, sightWalls, {
          maxRange: token.vision.rangePx,
          angle: token.vision.angle,
          rotation: token.vision.rotation,
          sceneBounds,
          dimension: "sight",
        });
        this._visionCache.set(key, poly);
      }

      visionPolygons.push({ tokenId: token.id, polygon: poly });
    }

    // --- Light polygons (ambient + token lights) ---
    const lightPolygons: LightPolygonResult[] = [];

    // Collect all lights (from tokens + ambient lights via LightConfig)
    const allLights: LightConfig[] = [];
    for (const token of tokens) {
      if (token.light && token.light.enabled) {
        // Token light position = token center (adjust if needed)
        allLights.push({ ...token.light, x: token.x, y: token.y });
      }
    }

    for (const light of allLights) {
      if (!light.enabled) continue;

      const key = lightHash(light);
      let cached = this._lightCache.get(key);

      if (!cached) {
        // Full dim polygon (outer boundary)
        const dimPoly = computeVisibilityPolygon({ x: light.x, y: light.y }, lightWalls, {
          maxRange: light.dimPx,
          angle: light.angle,
          rotation: light.rotation,
          sceneBounds,
          dimension: "light",
        });

        // Bright inner polygon
        const brightPoly = computeVisibilityPolygon({ x: light.x, y: light.y }, lightWalls, {
          maxRange: light.brightPx,
          angle: light.angle,
          rotation: light.rotation,
          sceneBounds,
          dimension: "light",
        });

        cached = { polygon: dimPoly, bright: brightPoly };
        this._lightCache.set(key, cached);
      }

      lightPolygons.push({
        lightId: light.id,
        polygon: cached.polygon,
        brightPolygon: cached.bright,
        color: light.color,
        intensity: light.intensity,
        dimPx: light.dimPx,
        brightPx: light.brightPx,
      });
    }

    const elapsed = performance.now() - t0;
    if (elapsed > 8) {
      console.debug(
        `[VisionState] compute took ${elapsed.toFixed(1)}ms (walls=${String(walls.length)}, tokens=${String(tokens.length)}, lights=${String(allLights.length)})`,
      );
    }

    return {
      visionPolygons,
      lightPolygons,
      isGm,
      darkness,
      globalLight,
      tokenVision,
    };
  }

  /**
   * Compute for ambient (non-token) lights passed externally.
   * Call after compute() or standalone; extends the existing result's lights.
   */
  computeAmbientLights(
    lights: LightConfig[],
    walls: Wall[],
    sceneBounds: SceneBounds,
  ): LightPolygonResult[] {
    const lightWalls = wallsBlockingLight(walls);
    const newLightHash = hashWalls(lightWalls);

    if (newLightHash !== this._wallHashLight) {
      this._wallHashLight = newLightHash;
      this._lightCache.clear();
    }

    const result: LightPolygonResult[] = [];

    for (const light of lights) {
      if (!light.enabled) continue;

      const key = lightHash(light);
      let cached = this._lightCache.get(key);

      if (!cached) {
        const dimPoly = computeVisibilityPolygon({ x: light.x, y: light.y }, lightWalls, {
          maxRange: light.dimPx,
          angle: light.angle,
          rotation: light.rotation,
          sceneBounds,
          dimension: "light",
        });
        const brightPoly = computeVisibilityPolygon({ x: light.x, y: light.y }, lightWalls, {
          maxRange: light.brightPx,
          angle: light.angle,
          rotation: light.rotation,
          sceneBounds,
          dimension: "light",
        });
        cached = { polygon: dimPoly, bright: brightPoly };
        this._lightCache.set(key, cached);
      }

      result.push({
        lightId: light.id,
        polygon: cached.polygon,
        brightPolygon: cached.bright,
        color: light.color,
        intensity: light.intensity,
        dimPx: light.dimPx,
        brightPx: light.brightPx,
      });
    }

    return result;
  }

  /** Invalidate a specific vision source cache entry by token id. */
  invalidateToken(tokenId: string): void {
    for (const key of this._visionCache.keys()) {
      if (key.startsWith(`${tokenId}:`)) {
        this._visionCache.delete(key);
      }
    }
  }

  /** Invalidate a specific light cache entry by light id. */
  invalidateLight(lightId: string): void {
    for (const key of this._lightCache.keys()) {
      if (key.startsWith(`${lightId}:`)) {
        this._lightCache.delete(key);
      }
    }
  }

  /** Clear all caches (e.g. scene reload). */
  clearAll(): void {
    this._visionCache.clear();
    this._lightCache.clear();
    this._wallHashSight = "";
    this._wallHashLight = "";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build TokenVisionConfig from scene token fields.
 * Converts grid-unit range to pixels using the scene grid size.
 */
export function buildTokenVisionConfig(
  tokenData: {
    vision?: {
      enabled?: boolean;
      range?: number | null;
      angle?: number;
      rotation?: number;
      visionMode?: string;
    } | null;
    rotation?: number;
  },
  gridSizePx: number,
): TokenVisionConfig {
  const v = tokenData.vision ?? {};
  const rangeGridUnits = v.range ?? null;
  const rangePx = rangeGridUnits !== null ? rangeGridUnits * gridSizePx : null;
  return {
    enabled: v.enabled ?? false,
    rangePx,
    angle: v.angle ?? 360,
    rotation: tokenData.rotation ?? v.rotation ?? 0,
    visionMode: v.visionMode === "darkvision" ? "darkvision" : "basic",
  };
}

/**
 * Build LightConfig from scene token light fields.
 * Converts grid-unit radii to pixels.
 */
export function buildTokenLightConfig(
  tokenId: string,
  lightData:
    | {
        enabled?: boolean;
        brightRadius?: number;
        dimRadius?: number;
        angle?: number;
        rotation?: number;
        color?: string;
        intensity?: number;
      }
    | null
    | undefined,
  x: number,
  y: number,
  gridSizePx: number,
): LightConfig | null {
  if (!lightData || !lightData.enabled) return null;
  return {
    id: `token-light:${tokenId}`,
    x,
    y,
    brightPx: (lightData.brightRadius ?? 0) * gridSizePx,
    dimPx: (lightData.dimRadius ?? 0) * gridSizePx,
    angle: lightData.angle ?? 360,
    rotation: lightData.rotation ?? 0,
    color: lightData.color ?? "#ffffff",
    intensity: lightData.intensity ?? 1,
    enabled: lightData.enabled ?? false,
  };
}

/**
 * Build LightConfig from an ambient light document.
 * Converts grid-unit radii to pixels.
 */
export function buildAmbientLightConfig(
  light: {
    _id: string;
    x: number;
    y: number;
    brightRadius?: number;
    dimRadius?: number;
    angle?: number;
    rotation?: number;
    color?: string;
    intensity?: number;
    enabled?: boolean;
  },
  gridSizePx: number,
): LightConfig {
  return {
    id: `ambient:${light._id}`,
    x: light.x,
    y: light.y,
    brightPx: (light.brightRadius ?? 0) * gridSizePx,
    dimPx: (light.dimRadius ?? 0) * gridSizePx,
    angle: light.angle ?? 360,
    rotation: light.rotation ?? 0,
    color: light.color ?? "#ffffff",
    intensity: light.intensity ?? 1,
    enabled: light.enabled ?? true,
  };
}

/**
 * Compute the union bounding box of multiple polygons.
 * Used to check if a wall change might affect a cached polygon.
 */
export function polygonBounds(polygon: VisibilityPolygon): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of polygon.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}
