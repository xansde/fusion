/**
 * GridCalibrationLayer.ts — draws the grid calibration box.
 *
 * Spec: 06-canvas-e-renderizacao.md (REQ-CNV-017, configurable gridSize)
 *
 * Lives in the "controls" layer, above the grid it is about to redefine, and
 * follows the camera: the box has to stay glued to the cell of the map image
 * the GM is aiming at while they zoom in to check the alignment.
 *
 * Handles are drawn at a constant SCREEN size — divided by the camera scale —
 * because a handle that shrinks with the zoom is unusable at exactly the
 * moment the GM zoomed in to be precise.
 */

import { Container, Graphics } from "pixi.js";
import { CORNER_HANDLES, cornerPoint, normalizeRect, type Rect } from "./gridCalibrationRect.js";

const BOX_COLOR = 0x44ddff;
const BAD_COLOR = 0xff6644;
const FILL_ALPHA = 0.12;
/** Half-side of a corner handle, in SCREEN pixels. */
export const HANDLE_SCREEN_RADIUS = 7;
/** Grab radius for hit-testing, in SCREEN pixels — larger than the drawn handle. */
export const HANDLE_GRAB_RADIUS = 12;
const LINE_SCREEN_WIDTH = 2;

export class GridCalibrationLayer {
  private _root: Container;
  private _graphics: Graphics;
  private _destroyed = false;

  constructor(parent: Container) {
    this._root = new Container();
    this._root.label = "grid-calibration";
    this._root.eventMode = "none"; // input is handled at the DOM level
    this._graphics = new Graphics();
    this._graphics.eventMode = "none";
    this._root.addChild(this._graphics);
    parent.addChild(this._root);
  }

  /**
   * Redraw the box.
   *
   * @param rect  The box in scene coordinates, or null to draw nothing.
   * @param scale Camera scale, used to keep strokes and handles a constant
   *              size on screen.
   * @param valid False when the box would not produce a usable grid (too
   *              small); drawn in a warning color rather than silently
   *              refusing on confirm.
   */
  render(rect: Rect | null, scale: number, valid: boolean = true): void {
    if (this._destroyed) return;

    this._graphics.clear();
    if (!rect) return;

    const r = normalizeRect(rect);
    const safeScale = scale > 0 ? scale : 1;
    const lineWidth = LINE_SCREEN_WIDTH / safeScale;
    const handle = HANDLE_SCREEN_RADIUS / safeScale;
    const color = valid ? BOX_COLOR : BAD_COLOR;

    this._graphics
      .rect(r.x, r.y, r.width, r.height)
      .fill({ color, alpha: FILL_ALPHA })
      .stroke({ width: lineWidth, color, alpha: 0.95 });

    // A cross through the middle: lining the center up with the center of a
    // printed cell is easier than judging four corners at once.
    this._graphics
      .moveTo(r.x + r.width / 2, r.y)
      .lineTo(r.x + r.width / 2, r.y + r.height)
      .moveTo(r.x, r.y + r.height / 2)
      .lineTo(r.x + r.width, r.y + r.height / 2)
      .stroke({ width: lineWidth / 2, color, alpha: 0.5 });

    for (const name of CORNER_HANDLES) {
      const p = cornerPoint(r, name);
      this._graphics
        .rect(p.x - handle, p.y - handle, handle * 2, handle * 2)
        .fill({ color, alpha: 0.85 })
        .stroke({ width: lineWidth, color: 0x000000, alpha: 0.6 });
    }
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    // `destroyed` guards the case where the parent layer tore this container
    // down first (scene teardown races the panel unmounting): PIXI throws on a
    // second destroy, and the panel's own cleanup must not be what crashes.
    if (!this._root.destroyed) this._root.destroy({ children: true });
  }
}
