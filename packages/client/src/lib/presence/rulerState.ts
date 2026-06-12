/**
 * Ruler state machine — pure, testable.
 *
 * The ruler tool lets a user draw a measurement path with waypoints.
 * The state transitions are:
 *
 *   idle → measuring (R key down or toolbar button, then drag)
 *   measuring → measuring (Ctrl+click adds a waypoint)
 *   measuring → idle (key/button release or Escape)
 *
 * Distance is computed using squareMeasurePath from @fusion/shared.
 *
 * M1-E: spec 06-canvas-e-renderizacao.md (ruler with grid measurement)
 * spec 04-rede-e-sincronizacao.md (ruler:update / ruler:clear ephemeral)
 */

import { squareMeasurePath } from "@fusion/shared";
import type { DiagonalRule } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RulerMode = "idle" | "measuring";

export interface RulerConfig {
  /** Grid cell size in pixels. */
  gridSize: number;
  /** In-game distance per cell (e.g. 5 for 5 ft per square). */
  gridDistance: number;
  /** Diagonal movement rule. */
  diagonalRule: DiagonalRule;
  /** Grid x offset in pixels. */
  offsetX: number;
  /** Grid y offset in pixels. */
  offsetY: number;
  /** Label unit string (e.g. "ft"). */
  units: string;
}

export interface RulerSnapshot {
  mode: RulerMode;
  /** Ordered waypoints in scene coordinates. */
  waypoints: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Current cursor position being tracked (the "live" endpoint before committing).
   * May be undefined if not in measuring mode.
   */
  livePoint: { x: number; y: number } | null;
  /** Computed total distance (all waypoints + livePoint if present). */
  totalDistance: number;
  /** Distance label string (e.g. "35 ft"). */
  distanceLabel: string;
}

// ---------------------------------------------------------------------------
// Pure ruler state
// ---------------------------------------------------------------------------

export class RulerStateMachine {
  private _mode: RulerMode = "idle";
  private _waypoints: Array<{ x: number; y: number }> = [];
  private _livePoint: { x: number; y: number } | null = null;
  private _config: RulerConfig;

  constructor(config: RulerConfig) {
    this._config = config;
  }

  get mode(): RulerMode {
    return this._mode;
  }

  get waypoints(): ReadonlyArray<{ x: number; y: number }> {
    return this._waypoints;
  }

  get livePoint(): { x: number; y: number } | null {
    return this._livePoint;
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  /**
   * Start measuring from an origin point.
   * Transitions: idle → measuring.
   */
  startMeasuring(origin: { x: number; y: number }): void {
    this._mode = "measuring";
    this._waypoints = [origin];
    this._livePoint = { ...origin };
  }

  /**
   * Update the live endpoint while dragging.
   * Only valid in measuring mode; no-op otherwise.
   */
  updateLive(point: { x: number; y: number }): void {
    if (this._mode !== "measuring") return;
    this._livePoint = { ...point };
  }

  /**
   * Add a waypoint (Ctrl+click while measuring).
   * The current live point becomes a committed waypoint and the ruler continues.
   */
  addWaypoint(point: { x: number; y: number }): void {
    if (this._mode !== "measuring") return;
    this._waypoints.push({ ...point });
    this._livePoint = { ...point };
  }

  /**
   * Clear and return to idle.
   * Transitions: any → idle.
   */
  clear(): void {
    this._mode = "idle";
    this._waypoints = [];
    this._livePoint = null;
  }

  // ---------------------------------------------------------------------------
  // Computed snapshot
  // ---------------------------------------------------------------------------

  /**
   * Compute the current display snapshot (pure — no side effects).
   */
  snapshot(): RulerSnapshot {
    const { gridSize, gridDistance, diagonalRule, offsetX, offsetY, units } = this._config;

    // Build the measurement path: committed waypoints + live point
    const path = [...this._waypoints];
    if (this._livePoint) {
      path.push(this._livePoint);
    }

    const totalDistance =
      path.length >= 2
        ? squareMeasurePath(path, gridSize, gridDistance, diagonalRule, offsetX, offsetY)
        : 0;

    const distanceLabel = totalDistance > 0 ? `${totalDistance.toFixed(0)} ${units}` : "";

    return {
      mode: this._mode,
      waypoints: [...this._waypoints],
      livePoint: this._livePoint,
      totalDistance,
      distanceLabel,
    };
  }

  /** Update the grid config (e.g. when a new scene loads). */
  updateConfig(config: RulerConfig): void {
    this._config = config;
  }

  /**
   * Return all waypoints including the live point for broadcast.
   * Used to build the presence:ruler payload.
   */
  broadcastWaypoints(): ReadonlyArray<{ x: number; y: number }> {
    const pts = [...this._waypoints];
    if (this._livePoint) pts.push(this._livePoint);
    return pts;
  }
}

// ---------------------------------------------------------------------------
// Distance label formatting
// ---------------------------------------------------------------------------

/**
 * Format a distance value into a display string.
 *
 * @param distance   Distance in game units
 * @param units      Unit label (e.g. "ft", "m")
 * @param decimals   Number of decimal places (default 0)
 */
export function formatDistance(distance: number, units: string, decimals = 0): string {
  if (distance <= 0) return `0 ${units}`;
  return `${distance.toFixed(decimals)} ${units}`;
}
