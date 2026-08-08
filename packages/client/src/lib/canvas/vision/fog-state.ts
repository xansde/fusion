/**
 * fog-state.ts — Pure (no PIXI) fog-of-war accumulation module.
 *
 * Spec: 07-visao-iluminacao-fog.md
 * REQ-VIS-080: three visual states (unexplored / explored-out-of-sight / visible)
 * REQ-VIS-081: currently-visible = union of vision polygons (ephemeral, not persisted)
 * REQ-VIS-082: explored = accumulated union via Clipper2
 * REQ-VIS-083: throttled persistence via fog:update
 * REQ-VIS-084: load from server via fog:get on scene activation
 * REQ-VIS-086/087: apply fog:wasReset — discard local state immediately
 *
 * Design:
 *   - The client accumulates exploration as a FogShape (Clipper2 union).
 *   - On each vision update, unionFogMany() merges all current vision polygons
 *     into the accumulated shape.
 *   - A dirty-flag tracks uncommitted changes; persistence is debounced
 *     (PERSIST_DEBOUNCE_MS after last change AND on beforeunload/scene switch).
 *   - The server is "dumb storage": it stores and returns the shape verbatim.
 *   - GM users bypass all fog state (isFogActive = false → no accumulation).
 *   - No PIXI, no DOM (except beforeunload registration via window).
 *
 * This module owns the fog geometry. The LightingRenderer reads the FogShape
 * and the current vision polygon from this module to compose the three visual
 * states onto the canvas.
 */

import {
  emptyFog,
  isFogEmpty,
  unionFogMany,
  serializeFog,
  deserializeFog,
  type FogShape,
  type FogRing,
  type FogUpdatePayload,
  type FogGetPayload,
  type FogGetResponsePayload,
  type FogWasResetPayload,
} from "@fusion/shared";
import type { VisibilityPolygon } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds to wait after the last vision update before persisting. */
export const PERSIST_DEBOUNCE_MS = 3_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callback used to send a fog:update to the server (throttled).
 * The socket layer wraps socket.emit("op", { type: "fog:update", payload });
 */
export type FogPersistFn = (payload: FogUpdatePayload) => void;

/**
 * Callback used to request fog from server on scene load (fog:get).
 */
export type FogGetFn = (payload: FogGetPayload) => Promise<FogGetResponsePayload>;

/**
 * The full fog state exposed to the LightingRenderer for rendering.
 * Immutable snapshot for one render frame.
 */
export interface FogRenderState {
  /** Accumulated explored area for this (user, scene). */
  explored: FogShape;
  /**
   * Current vision ring (flat [x0,y0,...]) used to punch the "currently visible"
   * window through the fog. Empty array when no vision.
   */
  currentVisionRings: FogRing[];
  /** Whether fog is active for this user (false for GM — renders nothing). */
  fogActive: boolean;
  /** Scene ID this state belongs to. */
  sceneId: string;
}

// ---------------------------------------------------------------------------
// FogState
// ---------------------------------------------------------------------------

/**
 * Stateful manager for fog-of-war accumulation and persistence.
 *
 * Lifecycle:
 *   1. Construct with (sceneId, userId, isGm, persistFn, getFn).
 *   2. Call load() once when the scene activates.
 *   3. Call updateVision(polygons) each time the vision state changes.
 *   4. Call getRenderState() each frame to get data for the renderer.
 *   5. Call persistNow() when switching scenes / beforeunload.
 *   6. Call destroy() to clean up timers and listeners.
 *
 * Reset flow (fog:wasReset):
 *   Call applyReset(payload) — checks if this user is targeted, and if so,
 *   clears local state immediately (pending debounce is also cancelled).
 */
export class FogState {
  private _sceneId: string;
  private _userId: string;
  private _isGm: boolean;

  /** Accumulated explored shape for this (user, scene). */
  private _explored: FogShape = emptyFog();

  /** Most recent set of vision rings (flat arrays). */
  private _currentVisionRings: FogRing[] = [];

  /** True if explored has changed since the last persist. */
  private _dirty = false;

  /** Debounce timer handle. */
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Callback to send fog:update to the server. */
  private _persistFn: FogPersistFn;

  /** Callback to retrieve fog from the server. */
  private _getFn: FogGetFn;

  /** Whether a load() is in progress (prevents duplicate loads). */
  private _loading = false;

  /** Bound beforeunload handler (stored for removal). */
  private _beforeUnloadHandler: (() => void) | null = null;

  constructor(
    sceneId: string,
    userId: string,
    isGm: boolean,
    persistFn: FogPersistFn,
    getFn: FogGetFn,
  ) {
    this._sceneId = sceneId;
    this._userId = userId;
    this._isGm = isGm;
    this._persistFn = persistFn;
    this._getFn = getFn;

    if (!isGm && typeof window !== "undefined") {
      // Flush on page unload so no exploration is lost
      this._beforeUnloadHandler = () => {
        this.persistNow();
      };
      window.addEventListener("beforeunload", this._beforeUnloadHandler);
    }
  }

  // ---------------------------------------------------------------------------
  // Public — scene lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load stored exploration for this (user, scene) from the server.
   * Call once when the scene becomes active.
   * REQ-VIS-084: server returns the persisted shape (or null = fully unexplored).
   */
  async load(): Promise<void> {
    if (this._isGm || this._loading) return;
    this._loading = true;
    try {
      const response = await this._getFn({ sceneId: this._sceneId });
      if (response.shape !== null) {
        const result = deserializeFog(response.shape);
        if (result.ok) {
          this._explored = result.value;
        } else {
          // Corrupt data — start fresh (safer than crashing)
          console.warn(
            `[FogState] Deserialization failed for scene ${this._sceneId}: ${result.error}`,
          );
          this._explored = emptyFog();
        }
      } else {
        this._explored = emptyFog();
      }
      this._dirty = false;
    } catch (err) {
      // Network error — start with empty fog; will persist on next update
      console.warn("[FogState] load() failed — starting fresh:", err);
      this._explored = emptyFog();
    } finally {
      this._loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Public — vision update
  // ---------------------------------------------------------------------------

  /**
   * Called each time the user's vision state changes.
   * Converts VisibilityPolygon[] → FogRings and unions into explored.
   *
   * For GM: no-op (GM has no fog).
   *
   * @param polygons - Current vision polygons from VisionStateResult.
   */
  updateVision(polygons: VisibilityPolygon[]): void {
    if (this._isGm) return;

    // Convert vision polygon vertices to flat FogRings
    const rings: FogRing[] = polygons
      .map((p) => visibilityPolygonToRing(p))
      .filter((r): r is FogRing => r !== null);

    this._currentVisionRings = rings;

    if (rings.length === 0) return;

    // Union new visibility into explored shape
    const prev = this._explored;
    const next = unionFogMany(prev, rings);

    // Only mark dirty if something actually changed.
    // unionFogMany always returns a new object; we detect no-op by comparing
    // totalVertices (union can only add area, so equal count = no new area).
    if (next.totalVertices !== prev.totalVertices) {
      this._explored = next;
      this._markDirty();
    }
  }

  // ---------------------------------------------------------------------------
  // Public — reset handling
  // ---------------------------------------------------------------------------

  /**
   * Apply a fog:wasReset broadcast from the server.
   * REQ-VIS-087: discard all local state immediately, even uncommitted.
   */
  applyReset(payload: FogWasResetPayload): void {
    if (payload.sceneId !== this._sceneId) return;

    const affected =
      payload.target === "all" ||
      (typeof payload.target === "object" && payload.target.userId === this._userId);

    if (!affected) return;

    // Cancel any pending debounce (do NOT send stale data after reset)
    this._cancelDebounce();

    // Clear local state
    this._explored = emptyFog();
    this._currentVisionRings = [];
    this._dirty = false;
  }

  // ---------------------------------------------------------------------------
  // Public — render state
  // ---------------------------------------------------------------------------

  /**
   * Return the current state for the renderer.
   * Called every frame — should be cheap (no computation, just read).
   */
  getRenderState(): FogRenderState {
    return {
      explored: this._explored,
      currentVisionRings: this._currentVisionRings,
      // A FogState only exists for players in scenes with fog on — the creation
      // policy lives in TableScreen._createOrchestrator + sceneReloadKey.ts
      // (REQ-VIS-085) — so `!isGm` is true by construction here.
      fogActive: !this._isGm,
      sceneId: this._sceneId,
    };
  }

  // ---------------------------------------------------------------------------
  // Public — persistence
  // ---------------------------------------------------------------------------

  /**
   * Flush pending fog state to the server immediately.
   * Call on scene switch, logout, or beforeunload.
   */
  persistNow(): void {
    if (!this._dirty || this._isGm || isFogEmpty(this._explored)) return;

    this._cancelDebounce();
    this._sendPersist();
  }

  // ---------------------------------------------------------------------------
  // Public — teardown
  // ---------------------------------------------------------------------------

  /**
   * Clean up timers and event listeners.
   * Safe to call multiple times.
   */
  destroy(): void {
    this._cancelDebounce();
    if (this._beforeUnloadHandler && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal — dirty / debounce
  // ---------------------------------------------------------------------------

  private _markDirty(): void {
    this._dirty = true;
    this._schedulePersist();
  }

  private _schedulePersist(): void {
    this._cancelDebounce();
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      if (this._dirty) this._sendPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private _cancelDebounce(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  private _sendPersist(): void {
    if (!this._dirty || isFogEmpty(this._explored)) return;
    const payload: FogUpdatePayload = {
      sceneId: this._sceneId,
      shape: serializeFog(this._explored),
    };
    try {
      this._persistFn(payload);
      this._dirty = false;
    } catch (err) {
      // Persist failed — keep dirty so the next debounce retries
      console.warn("[FogState] persist failed:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Exposed for testing
  // ---------------------------------------------------------------------------

  /** Current explored shape (read-only for tests). */
  get explored(): FogShape {
    return this._explored;
  }

  /** True when there are unsaved changes. */
  get isDirty(): boolean {
    return this._dirty;
  }

  /** The scene ID this manager tracks. */
  get sceneId(): string {
    return this._sceneId;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a VisibilityPolygon ({vertices: {x,y}[]}) to a FogRing
 * (flat [x0,y0,x1,y1,...]).
 * Returns null if the polygon has fewer than 3 vertices.
 */
export function visibilityPolygonToRing(poly: VisibilityPolygon): FogRing | null {
  if (poly.vertices.length < 3) return null;
  const ring: number[] = [];
  for (const v of poly.vertices) {
    ring.push(v.x, v.y);
  }
  return ring;
}

/**
 * Test whether a point (px, py) is inside any polygon of a FogShape.
 * Uses the ray-casting algorithm (point-in-polygon).
 * Useful for: checking if a token position has been explored.
 */
export function pointInFog(shape: FogShape, px: number, py: number): boolean {
  for (const poly of shape.polygons) {
    if (ringContainsPoint(poly.outer, px, py)) {
      // Check it is not inside a hole
      let inHole = false;
      for (const hole of poly.holes) {
        if (ringContainsPoint(hole, px, py)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/**
 * Ray-casting point-in-ring test.
 * Works for arbitrary simple polygons (convex and concave).
 */
function ringContainsPoint(ring: FogRing, px: number, py: number): boolean {
  let inside = false;
  const n = ring.length >> 1;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring[i * 2] as number;
    const yi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const yj = ring[j * 2 + 1] as number;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}
