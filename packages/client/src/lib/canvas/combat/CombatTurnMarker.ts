/**
 * CombatTurnMarker.ts — PIXI combat turn marker overlay.
 *
 * Renders an animated ring/halo on the "controls" layer to indicate which
 * token is currently taking their turn in combat.
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-050..052, §DEC-CBT-08
 *
 * Design:
 *   - Drawn as a Graphics ring in the "controls" layer (above tokens, not a
 *     separate token so it doesn't interfere with selection).
 *   - Position tracks the active token's (x, y) in scene coordinates.
 *   - Animates a pulsing alpha so the marker is visually distinct.
 *   - When the active token changes, the ring jumps to the new position
 *     (no tweening in MVP; smooth tween would require sceneLoader access
 *     to token coordinates which changes per tick).
 *   - Color is parametrizable (default: golden 0xFFD700).
 *
 * Usage:
 *   const marker = new CombatTurnMarker(controlsLayer, gridSize);
 *   // Each frame:
 *   marker.tick(deltaMs);
 *   // When active token changes:
 *   marker.setActiveToken(tokenX, tokenY, gridSize);
 *   // When combat ends or tracker is empty:
 *   marker.hide();
 *   // Cleanup:
 *   marker.destroy();
 *
 * REQ-CBT-050: visual marker on the active token.
 * REQ-CBT-051: color parametrizable (default golden).
 * REQ-CBT-052: marker moves with the active combatant on turn change.
 */

import { Graphics, type Container } from "pixi.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Combat turn marker configuration. */
export interface CombatTurnMarkerConfig {
  /** Ring color (hex number). Default: 0xFFD700 (golden). */
  color?: number;
  /** Ring thickness in pixels. Default: 4. */
  thickness?: number;
  /** Pulse period in milliseconds. Default: 1200. */
  pulsePeriod?: number;
  /** Alpha range [min, max] for pulse. Default: [0.55, 1.0]. */
  alphaRange?: [number, number];
}

const DEFAULT_COLOR = 0xffd700;
const DEFAULT_THICKNESS = 4;
const DEFAULT_PULSE_PERIOD = 1200;
const DEFAULT_ALPHA_MIN = 0.55;
const DEFAULT_ALPHA_MAX = 1.0;

// ---------------------------------------------------------------------------
// CombatTurnMarker
// ---------------------------------------------------------------------------

export class CombatTurnMarker {
  private _graphics: Graphics;
  private _parent: Container;

  // Config
  private _color: number;
  private _thickness: number;
  private _pulsePeriod: number;
  private _alphaMin: number;
  private _alphaMax: number;

  // Animation state
  private _time = 0;

  // Current position/size
  private _x = 0;
  private _y = 0;
  private _gridSize = 100;

  // Visibility
  private _visible = false;

  constructor(parent: Container, gridSize: number, config: CombatTurnMarkerConfig = {}) {
    this._parent = parent;
    this._gridSize = gridSize;
    this._color = config.color ?? DEFAULT_COLOR;
    this._thickness = config.thickness ?? DEFAULT_THICKNESS;
    this._pulsePeriod = config.pulsePeriod ?? DEFAULT_PULSE_PERIOD;
    this._alphaMin = config.alphaRange?.[0] ?? DEFAULT_ALPHA_MIN;
    this._alphaMax = config.alphaRange?.[1] ?? DEFAULT_ALPHA_MAX;

    this._graphics = new Graphics();
    this._graphics.label = "combatTurnMarker";
    this._graphics.eventMode = "none";
    this._graphics.visible = false;
    this._parent.addChild(this._graphics);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Move the marker to the given token position (scene coordinates).
   * The marker is shown if it was hidden.
   *
   * @param tokenX    Token x in scene pixels (top-left of the token footprint).
   * @param tokenY    Token y in scene pixels.
   * @param gridSize  Current grid cell size (determines ring radius).
   */
  setActiveToken(tokenX: number, tokenY: number, gridSize: number): void {
    this._x = tokenX;
    this._y = tokenY;
    this._gridSize = gridSize;
    this._visible = true;
    this._graphics.visible = true;
    this._redraw();
  }

  /**
   * Hide the marker (combat not started, ended, or no active token).
   */
  hide(): void {
    this._visible = false;
    this._graphics.visible = false;
  }

  /**
   * Advance the pulse animation.
   * Call from the FusionCanvas ticker.
   *
   * @param deltaMs  Frame delta in milliseconds.
   */
  tick(deltaMs: number): void {
    if (!this._visible) return;
    this._time = (this._time + deltaMs) % (this._pulsePeriod * 2);
    const t = this._time / this._pulsePeriod;
    const phase = t <= 1 ? t : 2 - t; // triangle wave [0..1..0]
    const alpha = this._alphaMin + (this._alphaMax - this._alphaMin) * phase;
    this._graphics.alpha = alpha;
  }

  /**
   * Update the grid size (e.g. scene changed config).
   * Redraws if the marker is visible.
   */
  setGridSize(gridSize: number): void {
    this._gridSize = gridSize;
    if (this._visible) this._redraw();
  }

  /**
   * Update the ring color.
   * Redraws if the marker is visible.
   */
  setColor(color: number): void {
    this._color = color;
    if (this._visible) this._redraw();
  }

  /**
   * Destroy the marker and remove it from the parent container.
   * Safe to call multiple times.
   */
  destroy(): void {
    this._graphics.destroy();
    // Graphics.destroy() removes itself from the parent automatically in PIXI v8.
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Redraw the ring at the current position and grid size.
   *
   * The ring is centered on the token footprint center. For a 1-cell token,
   * center = (x + gridSize/2, y + gridSize/2).
   */
  private _redraw(): void {
    const g = this._graphics;
    g.clear();

    const cx = this._x + this._gridSize / 2;
    const cy = this._y + this._gridSize / 2;
    const radius = this._gridSize / 2 + this._thickness;

    g.circle(cx, cy, radius);
    g.stroke({ color: this._color, width: this._thickness, alpha: 1.0 });

    // Outer glow ring (subtler)
    g.circle(cx, cy, radius + this._thickness);
    g.stroke({ color: this._color, width: 1, alpha: 0.35 });
  }
}
