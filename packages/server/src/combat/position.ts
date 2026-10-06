/**
 * Position queries on the server (BHR-F5-01, the cut of GUE-F3-01 that the
 * Bhrotto front consumes): size -> squares, size rank, edge-to-edge distance
 * and adjacency between two tokens.
 *
 * Deliberately NOT here: flanking and cover. The Fighter's full
 * `PositionQuery` (GUE-F3-01) absorbs this module — the exported names
 * (`sizeSideCells`, `sizeRank`, `tokenCells`, `distanceBetween`,
 * `areAdjacent`) are the ones it should keep.
 *
 * PF2e remaster rules this encodes:
 * - space per side: tiny/small/medium 1 square, large 2, huge 3,
 *   gargantuan 4. A tiny creature has a space smaller than a square but
 *   counts as one square for distance;
 * - distance between two creatures goes from the nearest square of one to the
 *   nearest square of the other, with the alternating 5 / 10 / 5 diagonal
 *   rule of the scene's `diagonalRule` (default `alternating_1`);
 * - adjacent = within one square of the other's space, diagonals included.
 *
 * The size vocabulary and rank come from engine-2e (`parseCreatureSize`,
 * `creatureSizeRank`) — the one place that knows the codes; the conversion to
 * squares is the system's `sizeToFootprint`, restated here because the server
 * has no handle on the active system's manifest in combat code.
 *
 * Square grids only: hex and gridless have no square footprint to measure and
 * are refused rather than approximated. Pure: no I/O.
 */

import { creatureSizeRank, parseCreatureSize, type CreatureSizeCode } from "@fusion/engine-2e";
import {
  squareCellDistance,
  squareFootprintCells,
  squarePixelToCell,
  type CellOffset,
  type DiagonalRule,
  type GridType,
} from "@fusion/shared";

/** Squares per side by size code (PF2e remaster space; tiny counts as 1). */
const SIDE_CELLS: Readonly<Record<CreatureSizeCode, number>> = {
  tiny: 1,
  sm: 1,
  med: 1,
  lg: 2,
  huge: 3,
  grg: 4,
};

/** The scene grid as position queries need it. */
export interface PositionGrid {
  /** Cell size in pixels. */
  size: number;
  /** In-game distance of one square (5 for PF2e feet). */
  distance: number;
  offsetX?: number;
  offsetY?: number;
  /** Default `alternating_1` (5-10-5, REQ-CNV-020). */
  diagonalRule?: DiagonalRule;
  /** Default `square`; anything else is refused. */
  type?: GridType;
}

/** What a position query needs to know about a token. */
export interface PositionedToken {
  id?: string;
  /** Top-left corner in scene pixels (TokenDocument.x / .y). */
  x: number;
  y: number;
  /** Size of the effective actor: sheet code (`lg`) or vendor word (`large`). */
  size: string;
}

function requireSize(size: string): CreatureSizeCode {
  const code = parseCreatureSize(size);
  if (code === undefined) throw new RangeError(`unknown creature size: ${JSON.stringify(size)}`);
  return code;
}

function requireSquare(grid: PositionGrid): void {
  if ((grid.type ?? "square") !== "square") {
    throw new RangeError(`position queries need a square grid, got ${String(grid.type)}`);
  }
}

/** Squares per side of a creature of this size (tiny = 1). */
export function sizeSideCells(size: string): number {
  return SIDE_CELLS[requireSize(size)];
}

/** Position of the size between tiny (0) and gargantuan (5). */
export function sizeRank(size: string): number {
  return creatureSizeRank(requireSize(size));
}

/** Every square the token occupies, from the cell holding its top-left corner. */
export function tokenCells(token: PositionedToken, grid: PositionGrid): CellOffset[] {
  requireSquare(grid);
  const side = sizeSideCells(token.size);
  const origin = squarePixelToCell(
    token.x,
    token.y,
    grid.size,
    grid.offsetX ?? 0,
    grid.offsetY ?? 0,
  );
  return squareFootprintCells(origin.i, origin.j, side, side);
}

interface Span {
  minI: number;
  maxI: number;
  minJ: number;
  maxJ: number;
}

function span(cells: readonly CellOffset[]): Span {
  const is = cells.map((c) => c.i);
  const js = cells.map((c) => c.j);
  return {
    minI: Math.min(...is),
    maxI: Math.max(...is),
    minJ: Math.min(...js),
    maxJ: Math.max(...js),
  };
}

/** Squares to walk along one axis between two ranges (0 when they overlap). */
function axisGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, aMin - bMax, bMin - aMax);
}

/** Per-axis square gap between the nearest squares of the two footprints. */
function squareGap(
  a: PositionedToken,
  b: PositionedToken,
  grid: PositionGrid,
): { di: number; dj: number } {
  const sa = span(tokenCells(a, grid));
  const sb = span(tokenCells(b, grid));
  return {
    di: axisGap(sa.minI, sa.maxI, sb.minI, sb.maxI),
    dj: axisGap(sa.minJ, sa.maxJ, sb.minJ, sb.maxJ),
  };
}

/**
 * Edge-to-edge distance in scene units (feet for PF2e): from the nearest
 * square of `a` to the nearest square of `b`. 0 when the footprints overlap.
 */
export function distanceBetween(
  a: PositionedToken,
  b: PositionedToken,
  grid: PositionGrid,
): number {
  const { di, dj } = squareGap(a, b, grid);
  return squareCellDistance(0, 0, di, dj, grid.distance, grid.diagonalRule ?? "alternating_1")
    .distance;
}

/**
 * Distance of a Strike from `attacker` to `target`. A creature on a mount attacks from ANY square the mount occupies
 * (BHR-F5-06, REQ-BHR-181), so with a `mount` the distance is the shorter of the two: from the rider's own square or
 * from the nearest square of the mount. Without a mount it is plain edge-to-edge distance.
 */
export function strikeDistance(
  attacker: PositionedToken,
  target: PositionedToken,
  grid: PositionGrid,
  mount?: PositionedToken | null,
): number {
  const own = distanceBetween(attacker, target, grid);
  if (mount === undefined || mount === null) return own;
  return Math.min(own, distanceBetween(mount, target, grid));
}

/** Whether `target` is within `reachFeet` of a Strike by `attacker`, measured from the mount when there is one. */
export function isWithinStrikeReach(input: {
  attacker: PositionedToken;
  target: PositionedToken;
  grid: PositionGrid;
  reachFeet: number;
  mount?: PositionedToken | null;
}): boolean {
  return (
    strikeDistance(input.attacker, input.target, input.grid, input.mount) <= input.reachFeet
  );
}

/**
 * Whether `b` is within one square of `a`'s space, diagonals included. A token
 * is never adjacent to itself (same `id`).
 */
export function areAdjacent(a: PositionedToken, b: PositionedToken, grid: PositionGrid): boolean {
  if (a.id !== undefined && a.id === b.id) return false;
  const { di, dj } = squareGap(a, b, grid);
  return Math.max(di, dj) <= 1;
}
