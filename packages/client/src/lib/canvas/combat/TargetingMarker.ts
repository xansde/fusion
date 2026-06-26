/**
 * TargetingMarker.ts — PIXI targeting reticle overlay.
 *
 * Renders a distinct reticle (corner brackets) on the "controls" layer over
 * every token that is currently targeted by a user. Visually different from the
 * combat turn marker (which is a pulsing ring) so the two never get confused.
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-054
 *   "Tokens marcados como alvo DEVEM receber indicador visual no canvas
 *    (retícula ou anel colorido, diferente do turn marker)."
 *
 * Design:
 *   - One Graphics object per targeted token (created lazily, reused, destroyed
 *     when the token is no longer targeted).
 *   - Corner-bracket reticle inscribed in the token footprint.
 *   - Color differs when the LOCAL user is the targeter vs another user
 *     (parametrizable; defaults: local = red, other = orange).
 *   - Position tracks the token sprite's (x, y) in scene coordinates; the marker
 *     lives in the world (controls) layer so it follows camera pan/zoom for free.
 *
 * Usage:
 *   const layer = new TargetingMarkerLayer(controlsLayer);
 *   // each frame, after computing positions:
 *   layer.sync([{ tokenId, x, y, gridSize, byLocalUser }]);
 *   layer.destroy();
 */

import { Graphics, type Container } from "pixi.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TargetingMarkerConfig {
  /** Reticle color when the local user is targeting. Default: 0xff4d4d (red). */
  localColor?: number;
  /** Reticle color when another user is targeting. Default: 0xff9d2e (orange). */
  otherColor?: number;
  /** Bracket stroke thickness in pixels. Default: 3. */
  thickness?: number;
  /** Bracket arm length as a fraction of the cell size. Default: 0.28. */
  armFraction?: number;
}

const DEFAULT_LOCAL_COLOR = 0xff4d4d;
const DEFAULT_OTHER_COLOR = 0xff9d2e;
const DEFAULT_THICKNESS = 3;
const DEFAULT_ARM_FRACTION = 0.28;

/** Per-frame description of one targeted token's screen-space anchor. */
export interface TargetedTokenPosition {
  tokenId: string;
  /** Token top-left x in scene pixels. */
  x: number;
  /** Token top-left y in scene pixels. */
  y: number;
  /** Token footprint size in scene pixels (grid cell size for a 1x1 token). */
  gridSize: number;
  /** Whether the local user is one of the targeters (drives reticle color). */
  byLocalUser: boolean;
}

/** A single corner bracket: three points forming an L (p0 → p1 → p2). */
export interface ReticleBracket {
  readonly points: readonly [number, number, number, number, number, number];
}

/**
 * Compute the four corner-bracket polylines for a reticle inscribed in the
 * token footprint at (x, y) with the given size.
 *
 * Pure geometry — no PIXI. Each bracket is an L-shape of arm length
 * `gridSize * armFraction` hugging one corner of the footprint. Returned in
 * order: top-left, top-right, bottom-right, bottom-left.
 *
 * Exposed for unit testing the reticle geometry independently of PIXI.
 */
export function computeReticleBrackets(
  x: number,
  y: number,
  gridSize: number,
  armFraction: number,
): [ReticleBracket, ReticleBracket, ReticleBracket, ReticleBracket] {
  const arm = gridSize * armFraction;
  const x0 = x;
  const y0 = y;
  const x1 = x + gridSize;
  const y1 = y + gridSize;
  return [
    { points: [x0, y0 + arm, x0, y0, x0 + arm, y0] }, // top-left
    { points: [x1 - arm, y0, x1, y0, x1, y0 + arm] }, // top-right
    { points: [x1, y1 - arm, x1, y1, x1 - arm, y1] }, // bottom-right
    { points: [x0 + arm, y1, x0, y1, x0, y1 - arm] }, // bottom-left
  ];
}

// ---------------------------------------------------------------------------
// TargetingMarkerLayer
// ---------------------------------------------------------------------------

export class TargetingMarkerLayer {
  private _parent: Container;
  private _markers: Map<string, Graphics> = new Map();

  private _localColor: number;
  private _otherColor: number;
  private _thickness: number;
  private _armFraction: number;

  /** Last drawn signature per token, to skip redundant redraws. */
  private _lastSig: Map<string, string> = new Map();

  constructor(parent: Container, config: TargetingMarkerConfig = {}) {
    this._parent = parent;
    this._localColor = config.localColor ?? DEFAULT_LOCAL_COLOR;
    this._otherColor = config.otherColor ?? DEFAULT_OTHER_COLOR;
    this._thickness = config.thickness ?? DEFAULT_THICKNESS;
    this._armFraction = config.armFraction ?? DEFAULT_ARM_FRACTION;
  }

  /**
   * Reconcile the on-screen reticles with the given set of targeted tokens.
   *
   * Creates markers for newly targeted tokens, updates moved ones, and destroys
   * reticles for tokens no longer in the list.
   */
  sync(positions: readonly TargetedTokenPosition[]): void {
    const incoming = new Set<string>();

    for (const p of positions) {
      incoming.add(p.tokenId);
      const sig = `${p.x.toFixed(1)}|${p.y.toFixed(1)}|${p.gridSize.toFixed(1)}|${p.byLocalUser ? "1" : "0"}`;

      let g = this._markers.get(p.tokenId);
      if (!g) {
        g = new Graphics();
        g.label = `targetReticle:${p.tokenId}`;
        g.eventMode = "none";
        this._parent.addChild(g);
        this._markers.set(p.tokenId, g);
      } else if (this._lastSig.get(p.tokenId) === sig) {
        continue; // nothing changed for this token
      }

      this._drawReticle(g, p);
      this._lastSig.set(p.tokenId, sig);
    }

    // Remove reticles for tokens no longer targeted
    for (const [tokenId, g] of this._markers) {
      if (!incoming.has(tokenId)) {
        g.destroy();
        this._markers.delete(tokenId);
        this._lastSig.delete(tokenId);
      }
    }
  }

  /** Remove all reticles. */
  clear(): void {
    for (const g of this._markers.values()) g.destroy();
    this._markers.clear();
    this._lastSig.clear();
  }

  /** Destroy the layer. Safe to call multiple times. */
  destroy(): void {
    this.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _drawReticle(g: Graphics, p: TargetedTokenPosition): void {
    g.clear();

    const color = p.byLocalUser ? this._localColor : this._otherColor;
    const brackets = computeReticleBrackets(p.x, p.y, p.gridSize, this._armFraction);

    // Four corner brackets ("[ ]"-style) inscribed in the token footprint.
    for (const { points } of brackets) {
      const [ax, ay, bx, by, cx, cy] = points;
      g.moveTo(ax, ay).lineTo(bx, by).lineTo(cx, cy);
    }

    g.stroke({ color, width: this._thickness, alpha: 0.95 });
  }
}
