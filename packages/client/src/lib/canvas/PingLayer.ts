/**
 * PingLayer.ts — draws map pings (local and remote).
 *
 * Spec: 04-rede-e-sincronizacao.md (presence:ping ephemeral, REQ-NET-041)
 * Spec: 06-canvas-e-renderizacao.md (pings are ephemeral canvas overlays)
 *
 * Lives in the "controls" layer (InterfaceGroup), which follows the camera:
 * a ping marks a place on the MAP, so it has to pan and zoom with it. (The
 * layers.ts comment files pings under the screen-fixed OverlayGroup; that
 * grouping is for the cursor-style overlay and there is no public getter for
 * it. A ping anchored to the screen would drift off its target on any pan,
 * which is the opposite of what it is for.)
 *
 * Like the ruler, every piece of the ping existed since M1-E except the two
 * that a person can perceive: nothing drew it and nothing fired it. This is
 * the drawing half.
 */

import { Container, Graphics } from "pixi.js";
import type { MapPing } from "../presence/types.js";

/** Outer radius the ripple reaches, as a multiple of the grid cell. */
const MAX_RADIUS_CELLS = 0.9;
/** Radius used when the scene has no usable grid size. */
const FALLBACK_CELL_PX = 100;
/** How many ripples chase each other outward. */
const RING_COUNT = 3;
/** Fraction of the total duration between one ripple and the next. */
const RING_STAGGER = 0.18;
const RING_WIDTH = 4;

/** One ripple, resolved for a single frame. */
export interface PingRing {
  /** Distance from the ping center, in scene pixels. */
  radius: number;
  /** 0 = invisible, 1 = fully opaque. */
  alpha: number;
}

/**
 * Resolve the ripples of one ping at a given moment.
 *
 * Pure, so the animation can be asserted without a GPU. Each ring starts
 * later than the last, expands linearly to `maxRadius` and fades as it goes;
 * rings that have not started yet or have already finished are omitted.
 *
 * @param elapsedMs  Time since the ping was created.
 * @param durationMs Total lifetime of the ping.
 * @param maxRadius  Outer radius in scene pixels.
 */
export function pingRings(elapsedMs: number, durationMs: number, maxRadius: number): PingRing[] {
  if (durationMs <= 0 || elapsedMs < 0 || elapsedMs >= durationMs) return [];

  const rings: PingRing[] = [];
  const progress = elapsedMs / durationMs;

  for (let i = 0; i < RING_COUNT; i++) {
    const local = progress - i * RING_STAGGER;
    // Not born yet, or already gone.
    if (local <= 0 || local >= 1) continue;
    rings.push({
      radius: maxRadius * local,
      // Fade out over the ring's own life, not the ping's, so late rings do
      // not pop out of existence while still large and bright.
      alpha: 1 - local,
    });
  }

  return rings;
}

/**
 * Renders every live ping as an expanding ripple.
 *
 * Redraws from scratch each frame it is called: pings are few (rate-limited
 * server-side) and short-lived, so reconciling per-ping Graphics would cost
 * more than the clear.
 */
export class PingLayer {
  private _root: Container;
  private _graphics: Graphics;
  private _destroyed = false;
  private _cellPx: number;
  /** True when the last render drew nothing — lets the caller skip work. */
  private _empty = true;

  constructor(parent: Container, cellPx: number = FALLBACK_CELL_PX) {
    this._cellPx = cellPx > 0 ? cellPx : FALLBACK_CELL_PX;
    this._root = new Container();
    this._root.label = "pings";
    this._root.eventMode = "none"; // never steals a click from a token
    this._graphics = new Graphics();
    this._graphics.eventMode = "none";
    this._root.addChild(this._graphics);
    parent.addChild(this._root);
  }

  /** True when nothing was drawn on the last render. */
  get isEmpty(): boolean {
    return this._empty;
  }

  /**
   * Redraw every ping for the current moment.
   *
   * @param pings Live pings (local and remote alike — the store holds both,
   *              because the server echoes the ping back to its sender).
   * @param now   Current wall clock, matching `MapPing.startedAtMs`.
   */
  render(pings: Iterable<MapPing>, now: number): void {
    if (this._destroyed) return;

    this._graphics.clear();
    let drew = false;

    const maxRadius = this._cellPx * MAX_RADIUS_CELLS;

    for (const ping of pings) {
      const color = parseColor(ping.color);
      for (const ring of pingRings(now - ping.startedAtMs, ping.durationMs, maxRadius)) {
        this._graphics
          .circle(ping.x, ping.y, ring.radius)
          .stroke({ width: RING_WIDTH, color, alpha: ring.alpha });
        drew = true;
      }
    }

    this._empty = !drew;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    // See GridCalibrationLayer: the parent layer may have destroyed this
    // container already, and PIXI throws on a second destroy.
    if (!this._root.destroyed) this._root.destroy({ children: true });
  }
}

/**
 * CSS hex (`#rrggbb`) to a PIXI color number, falling back to the ping default
 * rather than throwing on a malformed color from the wire.
 */
function parseColor(css: string): number {
  const parsed = Number.parseInt(css.replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : 0xffaa00;
}
