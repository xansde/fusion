/**
 * SquareGrid — the square implementation of GridStrategy.
 *
 * Spec: 06-canvas-e-renderizacao.md §D3, §D4, REQ-CNV-014, REQ-CNV-016,
 *       REQ-CNV-018, REQ-CNV-019, REQ-CNV-020.
 *
 * Design (docs/design/wi-mapa-grid-01/arquitetura.md):
 *
 *   D1 — This class is an ADAPTER, not a rewrite. The geometry lives in the
 *        `square*` functions of `math.ts`; this class only wraps them behind
 *        the interface so consumers stop re-assembling loose scalars. Code
 *        written from now on talks to `GridStrategy`, not to `square*`.
 *
 *   D2 — The grid origin offset does NOT live in `GridConfig` (it lives in
 *        `SceneConfig.gridOffsetX/Y`), so it enters through the constructor and
 *        stays internal state. The `GridStrategy` interface is untouched — it
 *        is the contract a future HexGrid must honour.
 *
 *   D5 — `getHighlightCells` covers `FootprintShape` only. `TemplateShape`
 *        belongs to the templates scope and throws rather than silently
 *        returning a wrong answer.
 *
 * No PIXI, no DOM — pure math, testable in the node environment.
 */

import {
  squareCellToPixel,
  squareFootprintCells,
  squareMeasurePath,
  squarePixelToCell,
  squareSnapPoint,
} from "./math.js";
import type {
  CellOffset,
  DiagonalRule,
  FootprintShape,
  GridConfig,
  GridStrategy,
  ScenePoint,
  SnapResolution,
  TemplateShape,
} from "./types.js";

/**
 * Default diagonal rule when a scene's grid config omits one.
 * REQ-CNV-020: PF2e uses 5-10-5 (alternating_1).
 */
export const DEFAULT_DIAGONAL_RULE: DiagonalRule = "alternating_1";

/** Origin of the grid in scene coordinates (top-left of cell 0,0). */
export interface GridOrigin {
  readonly x: number;
  readonly y: number;
}

/** Narrow a highlight shape to a token footprint. */
function isFootprint(shape: TemplateShape | FootprintShape): shape is FootprintShape {
  return "width" in shape && "height" in shape && !("kind" in shape);
}

export class SquareGrid implements GridStrategy {
  readonly config: GridConfig;

  private readonly _offsetX: number;
  private readonly _offsetY: number;

  /**
   * @param config Grid configuration as persisted on the scene.
   * @param origin Grid origin offset in scene pixels (SceneConfig.gridOffsetX/Y).
   *               Defaults to (0, 0).
   */
  constructor(config: GridConfig, origin: GridOrigin = { x: 0, y: 0 }) {
    this.config = config;
    this._offsetX = origin.x;
    this._offsetY = origin.y;
  }

  /** The grid origin this instance was built with (scene pixels). */
  get origin(): GridOrigin {
    return { x: this._offsetX, y: this._offsetY };
  }

  pixelToCell(p: ScenePoint): CellOffset {
    return squarePixelToCell(p.x, p.y, this.config.size, this._offsetX, this._offsetY);
  }

  cellToPixel(c: CellOffset): ScenePoint {
    return squareCellToPixel(c.i, c.j, this.config.size, this._offsetX, this._offsetY);
  }

  getSnappedPoint(p: ScenePoint, resolution: SnapResolution): ScenePoint {
    return squareSnapPoint(p.x, p.y, this.config.size, this._offsetX, this._offsetY, resolution);
  }

  measureDistance(path: ScenePoint[]): number {
    return squareMeasurePath(
      path,
      this.config.size,
      this.config.distance,
      this.config.diagonalRule ?? DEFAULT_DIAGONAL_RULE,
      this._offsetX,
      this._offsetY,
    );
  }

  getHighlightCells(shape: TemplateShape | FootprintShape): CellOffset[] {
    if (!isFootprint(shape)) {
      // D5: templates are out of this milestone's scope. Failing loudly beats
      // returning a footprint-shaped answer for a cone.
      throw new Error(
        "SquareGrid.getHighlightCells: TemplateShape is not supported yet " +
          "(templates scope). Only FootprintShape is implemented.",
      );
    }
    return squareFootprintCells(shape.origin.i, shape.origin.j, shape.width, shape.height);
  }
}
