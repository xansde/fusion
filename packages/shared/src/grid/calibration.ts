/**
 * calibration.ts — derive a square grid from a rectangle drawn over the map.
 *
 * Spec: 06-canvas-e-renderizacao.md (REQ-CNV-017: gridSize configurable, min 50)
 *
 * Why this exists: a battle map is an image someone else drew, with a grid
 * already baked into the pixels at whatever scale their export happened to
 * use. Typing a cell size until the lines happen to agree is guesswork. So
 * the GM instead drags a rectangle over one cell they can see, and this
 * module turns that rectangle into the two numbers the grid needs — the cell
 * size and where the grid starts.
 *
 * Offset matters as much as size: a grid with the right size and the wrong
 * origin is still wrong everywhere, just consistently so.
 *
 * Pure math, no DOM and no PIXI, so the round trip (rectangle → grid → same
 * rectangle) is checkable in a test.
 */

/** A rectangle in scene coordinates. Extents may be negative (backwards drag). */
export interface CalibrationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridCalibration {
  /** True when the rectangle defines a usable grid. */
  ok: boolean;
  /** Cell size in whole pixels. */
  size: number;
  /** Grid origin X, normalized to [0, size). */
  offsetX: number;
  /** Grid origin Y, normalized to [0, size). */
  offsetY: number;
  /**
   * How square the drawn rectangle was: 1 is perfect, lower means the two
   * sides disagreed about the cell size. Surfaced so the UI can warn the GM
   * that the map may not be on a square grid, instead of quietly averaging a
   * bad drag into a plausible-looking number.
   */
  squareness: number;
}

/**
 * Minimum cell size a calibration may produce, mirroring the scene schema's
 * `grid.size` floor (REQ-CNV-017). Below this the grid is unusable and the
 * document would be rejected on save anyway.
 */
export const MIN_CALIBRATION_SIZE = 50;

const FAILED: GridCalibration = { ok: false, size: 0, offsetX: 0, offsetY: 0, squareness: 0 };

/**
 * Turn a drawn rectangle into a square grid configuration.
 *
 * @param rect Rectangle in scene coordinates, covering `cols` × `rows` cells.
 * @param cols How many cells the rectangle spans horizontally (default 1).
 * @param rows How many cells the rectangle spans vertically (default 1).
 */
export function calibrateSquareGrid(
  rect: CalibrationRect,
  cols: number = 1,
  rows: number = 1,
): GridCalibration {
  if (!isFiniteRect(rect)) return FAILED;
  if (!isPositiveInteger(cols) || !isPositiveInteger(rows)) return FAILED;

  // A drag from bottom-right to top-left is the same rectangle; normalize it
  // before any of the math sees a negative extent.
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  const left = Math.min(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);

  const sideFromWidth = width / cols;
  const sideFromHeight = height / rows;
  if (sideFromWidth <= 0 || sideFromHeight <= 0) return FAILED;

  // The grid is square, so the two sides are two measurements of one number.
  // Averaging halves the worst-case error of a slightly off drag; `squareness`
  // carries the disagreement out to the caller rather than hiding it.
  const size = Math.round((sideFromWidth + sideFromHeight) / 2);
  const squareness =
    Math.min(sideFromWidth, sideFromHeight) / Math.max(sideFromWidth, sideFromHeight);

  if (size < MIN_CALIBRATION_SIZE) {
    return { ok: false, size, offsetX: 0, offsetY: 0, squareness };
  }

  // Against the ROUNDED size: the offset has to agree with the grid that will
  // actually be drawn, not with the fractional one we just discarded.
  return {
    ok: true,
    size,
    offsetX: mod(left, size),
    offsetY: mod(top, size),
    squareness,
  };
}

/** Positive modulo — JS `%` keeps the sign of the dividend. */
function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

function isFiniteRect(rect: CalibrationRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
