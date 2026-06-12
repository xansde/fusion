/**
 * Pure grid mathematics — no PIXI, no DOM.
 *
 * This module contains all the geometry and measurement logic for square grids
 * that can be unit-tested in Vitest without a browser environment.
 *
 * Spec: 06-canvas-e-renderizacao.md §D3, §D4
 * REQ-CNV-019: diagonal rule, alternating accumulated counts.
 * REQ-CNV-020: alternating_1 = PF2e 5-10-5.
 */

import type { CellOffset, DiagonalRule, ScenePoint, SnapResolution } from "./types.js";

// ---------------------------------------------------------------------------
// Pixel ↔ Cell conversions (square grid)
// ---------------------------------------------------------------------------

/**
 * Convert a scene-coordinate point to its containing cell offset.
 *
 * The grid origin is at (offsetX, offsetY) — top-left of cell (0, 0).
 * Negative coordinates are valid (cells with negative i/j).
 *
 * @param x      Scene x in pixels
 * @param y      Scene y in pixels
 * @param size   Cell size in pixels
 * @param offsetX Grid origin x offset (pixels)
 * @param offsetY Grid origin y offset (pixels)
 */
export function squarePixelToCell(
  x: number,
  y: number,
  size: number,
  offsetX: number,
  offsetY: number,
): CellOffset {
  return {
    i: Math.floor((x - offsetX) / size),
    j: Math.floor((y - offsetY) / size),
  };
}

/**
 * Return the center point of a cell in scene coordinates.
 *
 * @param i      Cell column
 * @param j      Cell row
 * @param size   Cell size in pixels
 * @param offsetX Grid origin x offset (pixels)
 * @param offsetY Grid origin y offset (pixels)
 */
export function squareCellToPixel(
  i: number,
  j: number,
  size: number,
  offsetX: number,
  offsetY: number,
): ScenePoint {
  return {
    x: offsetX + i * size + size / 2,
    y: offsetY + j * size + size / 2,
  };
}

/**
 * Return the bounding box (top-left corner) of a cell in scene coordinates.
 */
export function squareCellTopLeft(
  i: number,
  j: number,
  size: number,
  offsetX: number,
  offsetY: number,
): ScenePoint {
  return {
    x: offsetX + i * size,
    y: offsetY + j * size,
  };
}

// ---------------------------------------------------------------------------
// Snapping (square grid)
// ---------------------------------------------------------------------------

/**
 * Snap a point to the nearest anchor of the requested resolution.
 *
 * center:      nearest cell center
 * vertex:      nearest cell corner (4 per cell)
 * edge:        nearest cell edge midpoint (4 per cell)
 * intersection: nearest grid-line intersection, same as vertex for square
 *
 * REQ-CNV-018.
 */
export function squareSnapPoint(
  x: number,
  y: number,
  size: number,
  offsetX: number,
  offsetY: number,
  resolution: SnapResolution,
): ScenePoint {
  const relX = x - offsetX;
  const relY = y - offsetY;

  switch (resolution) {
    case "center": {
      const i = Math.floor(relX / size);
      const j = Math.floor(relY / size);
      return {
        x: offsetX + i * size + size / 2,
        y: offsetY + j * size + size / 2,
      };
    }

    case "vertex":
    case "intersection": {
      // Nearest grid-line intersection (corners of cells).
      const snappedX = Math.round(relX / size) * size;
      const snappedY = Math.round(relY / size) * size;
      return {
        x: offsetX + snappedX,
        y: offsetY + snappedY,
      };
    }

    case "edge": {
      // Edge midpoints lie where exactly ONE axis is on a grid line (even half-index)
      // and the other is at a cell-center half (odd half-index).
      //
      // Half-cell grid (halfSize = size/2):
      //   even half-index → on a grid line (vertex position on that axis)
      //   odd  half-index → at cell center on that axis
      //
      // Valid edge midpoints:
      //   top/bottom edge: hx odd,  hy even  → (hx*hs, hy*hs)
      //   left/right edge: hx even, hy odd   → (hx*hs, hy*hs)
      //
      // Invalid cases that must be redirected:
      //   both odd  → cell center  → nudge the nearer axis to an edge
      //   both even → grid vertex  → nudge the nearer axis to an adjacent half-cell center
      const halfSize = size / 2;

      // Half-cell index
      const hx = Math.round(relX / halfSize);
      const hy = Math.round(relY / halfSize);

      const xOnLine = hx % 2 === 0; // even → on grid line
      const yOnLine = hy % 2 === 0;

      if (!xOnLine && !yOnLine) {
        // Both odd → cell center; nudge the axis that is closer to a grid line
        // toward that grid line, turning the result into a left/right or top/bottom edge.
        const dxToLine = Math.abs(relX - Math.round(relX / size) * size);
        const dyToLine = Math.abs(relY - Math.round(relY / size) * size);
        if (dxToLine <= dyToLine) {
          // Snap x to nearest grid line (even half-index), keep y at half-cell center
          const nx = Math.round(relX / size) * size;
          return { x: offsetX + nx, y: offsetY + hy * halfSize };
        } else {
          const ny = Math.round(relY / size) * size;
          return { x: offsetX + hx * halfSize, y: offsetY + ny };
        }
      }

      if (xOnLine && yOnLine) {
        // Both even → grid vertex; nudge the axis closer to its adjacent cell-center
        // toward that center, turning the result into a left/right or top/bottom edge.
        const dxToCenter = Math.abs(relX - hx * halfSize); // distance from snapped vertex on x
        const dyToCenter = Math.abs(relY - hy * halfSize);
        // Pick the axis farther from the grid line (i.e., closer to a cell center)
        // and push it to the odd half-index in that direction.
        if (dxToCenter >= dyToCenter) {
          // x is closer to a half-cell center — push hx to nearest odd index
          const hxOdd = relX > hx * halfSize ? hx + 1 : hx - 1;
          return { x: offsetX + hxOdd * halfSize, y: offsetY + hy * halfSize };
        } else {
          const hyOdd = relY > hy * halfSize ? hy + 1 : hy - 1;
          return { x: offsetX + hx * halfSize, y: offsetY + hyOdd * halfSize };
        }
      }

      // Exactly one axis on a grid line → valid edge midpoint
      return {
        x: offsetX + hx * halfSize,
        y: offsetY + hy * halfSize,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Bounding cells (square grid)
// ---------------------------------------------------------------------------

/**
 * Return all cell offsets covered by a rectangular footprint.
 *
 * @param originI  Top-left cell column
 * @param originJ  Top-left cell row
 * @param width    Footprint width in cells
 * @param height   Footprint height in cells
 */
export function squareFootprintCells(
  originI: number,
  originJ: number,
  width: number,
  height: number,
): CellOffset[] {
  const cells: CellOffset[] = [];
  for (let dj = 0; dj < height; dj++) {
    for (let di = 0; di < width; di++) {
      cells.push({ i: originI + di, j: originJ + dj });
    }
  }
  return cells;
}

/**
 * Return all cell offsets within range `r` of a given cell (square grid),
 * using Chebyshev distance (8-directional).
 */
export function squareNeighborhoodCells(
  centerI: number,
  centerJ: number,
  range: number,
): CellOffset[] {
  const cells: CellOffset[] = [];
  const r = Math.max(0, Math.floor(range));
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      cells.push({ i: centerI + di, j: centerJ + dj });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Diagonal step counting (square grid)
// ---------------------------------------------------------------------------

/**
 * Count the number of strictly diagonal steps and straight (cardinal) steps
 * between two cells.
 */
export function squareCellSteps(
  fromI: number,
  fromJ: number,
  toI: number,
  toJ: number,
): { diagonals: number; cardinals: number } {
  const di = Math.abs(toI - fromI);
  const dj = Math.abs(toJ - fromJ);
  const diagonals = Math.min(di, dj);
  const cardinals = Math.abs(di - dj);
  return { diagonals, cardinals };
}

/**
 * Chebyshev distance between two cells.
 */
export function chebyshevDistance(fromI: number, fromJ: number, toI: number, toJ: number): number {
  return Math.max(Math.abs(toI - fromI), Math.abs(toJ - fromJ));
}

// ---------------------------------------------------------------------------
// Diagonal cost functions
// ---------------------------------------------------------------------------

/**
 * Compute the cost of a single diagonal step given the diagonal rule and the
 * cumulative count of diagonal steps BEFORE this one (zero-based).
 *
 * alternating_1: costs are 1, 2, 1, 2 … (begins at 1)
 * alternating_2: costs are 2, 1, 2, 1 … (begins at 2)
 *
 * The `diagonalsBefore` parameter is the number of diagonal steps that have
 * already been taken along the entire path so far (accumulated, not per
 * segment). REQ-CNV-019: alternance is across the WHOLE path.
 */
export function diagonalStepCost(rule: DiagonalRule, diagonalsBefore: number): number {
  switch (rule) {
    case "equidistant":
      return 1;
    case "exact":
      return Math.SQRT2;
    case "approximate":
      return 1.5;
    case "rectilinear":
      return 2;
    case "alternating_1":
      // 0th diagonal → cost 1 (odd parity → cost 2)
      return diagonalsBefore % 2 === 0 ? 1 : 2;
    case "alternating_2":
      // 0th diagonal → cost 2 (odd parity → cost 1)
      return diagonalsBefore % 2 === 0 ? 2 : 1;
    case "illegal":
      return Infinity;
  }
}

// ---------------------------------------------------------------------------
// Distance between two cells (square grid)
// ---------------------------------------------------------------------------

/**
 * Measure the in-game distance between two cells, applying the diagonal rule.
 *
 * @param fromI         Source cell column
 * @param fromJ         Source cell row
 * @param toI           Destination cell column
 * @param toJ           Destination cell row
 * @param gridDistance  In-game distance per cell
 * @param rule          Diagonal movement rule
 * @param diagonalsBefore  Number of diagonal steps accumulated before this
 *                         segment (for path measurement). Default 0.
 *
 * Returns { distance, diagonalsUsed } so the caller can accumulate.
 */
export function squareCellDistance(
  fromI: number,
  fromJ: number,
  toI: number,
  toJ: number,
  gridDistance: number,
  rule: DiagonalRule,
  diagonalsBefore: number = 0,
): { distance: number; diagonalsUsed: number } {
  const di = Math.abs(toI - fromI);
  const dj = Math.abs(toJ - fromJ);
  const diags = Math.min(di, dj);
  const cards = Math.abs(di - dj);

  let totalCells = 0;
  let d = diagonalsBefore;

  for (let k = 0; k < diags; k++) {
    totalCells += diagonalStepCost(rule, d);
    d++;
  }
  totalCells += cards;

  return {
    distance: totalCells * gridDistance,
    diagonalsUsed: diags,
  };
}

// ---------------------------------------------------------------------------
// Path measurement (square grid)
// ---------------------------------------------------------------------------

/**
 * Measure the total in-game distance along a path of waypoints (scene pixels).
 *
 * The alternating diagonal count is accumulated across the WHOLE path, not
 * reset per segment. REQ-CNV-019.
 *
 * @param path          Array of scene-coordinate waypoints (min 2 for non-zero)
 * @param gridSize      Cell size in pixels
 * @param gridDistance  In-game distance per cell
 * @param rule          Diagonal movement rule
 * @param offsetX       Grid origin x offset (pixels)
 * @param offsetY       Grid origin y offset (pixels)
 *
 * Returns total distance in game units.
 */
export function squareMeasurePath(
  path: ReadonlyArray<{ x: number; y: number }>,
  gridSize: number,
  gridDistance: number,
  rule: DiagonalRule,
  offsetX: number,
  offsetY: number,
): number {
  if (path.length < 2) return 0;

  let total = 0;
  let diagonalAccum = 0;

  for (let idx = 0; idx < path.length - 1; idx++) {
    const p0 = path[idx] as ScenePoint;
    const p1 = path[idx + 1] as ScenePoint;
    const from = squarePixelToCell(p0.x, p0.y, gridSize, offsetX, offsetY);
    const to = squarePixelToCell(p1.x, p1.y, gridSize, offsetX, offsetY);

    const { distance, diagonalsUsed } = squareCellDistance(
      from.i,
      from.j,
      to.i,
      to.j,
      gridDistance,
      rule,
      diagonalAccum,
    );

    total += distance;
    diagonalAccum += diagonalsUsed;
  }

  return total;
}

/**
 * Measure the total in-game distance along a path given as cell offsets.
 *
 * Useful when cells are pre-computed.
 * Accumulates diagonal count across all segments. REQ-CNV-019.
 */
export function squareMeasureCellPath(
  cells: ReadonlyArray<CellOffset>,
  gridDistance: number,
  rule: DiagonalRule,
): number {
  if (cells.length < 2) return 0;

  let total = 0;
  let diagonalAccum = 0;

  for (let idx = 0; idx < cells.length - 1; idx++) {
    const from = cells[idx] as CellOffset;
    const to = cells[idx + 1] as CellOffset;
    const { distance, diagonalsUsed } = squareCellDistance(
      from.i,
      from.j,
      to.i,
      to.j,
      gridDistance,
      rule,
      diagonalAccum,
    );
    total += distance;
    diagonalAccum += diagonalsUsed;
  }

  return total;
}

// ---------------------------------------------------------------------------
// Token footprint snapping (square grid)
// ---------------------------------------------------------------------------

/**
 * Return the snapped top-left cell for a token footprint.
 *
 * The snapping aligns the footprint so that its geometric center coincides with
 * the nearest valid grid anchor for a token of the given size.
 *
 * For odd footprint sizes the center is at a cell center; for even footprint
 * sizes the center is at a cell intersection.
 *
 * REQ-CNV-023: large token (e.g. 2×2) must snap correctly.
 *
 * @param x          Scene x of the token's center (pixels)
 * @param y          Scene y of the token's center (pixels)
 * @param footW      Footprint width in cells
 * @param footH      Footprint height in cells
 * @param gridSize   Cell size in pixels
 * @param offsetX    Grid origin x offset (pixels)
 * @param offsetY    Grid origin y offset (pixels)
 *
 * Returns the top-left CellOffset of the snapped footprint.
 */
export function squareSnapFootprint(
  x: number,
  y: number,
  footW: number,
  footH: number,
  gridSize: number,
  offsetX: number,
  offsetY: number,
): CellOffset {
  const relX = x - offsetX;
  const relY = y - offsetY;

  // Even footprint → center on intersection; odd footprint → center on cell center
  let snappedCenterX: number;
  let snappedCenterY: number;

  if (footW % 2 === 0) {
    // snap to nearest grid-line intersection
    snappedCenterX = Math.round(relX / gridSize) * gridSize;
  } else {
    // snap to nearest cell center
    snappedCenterX = (Math.floor(relX / gridSize) + 0.5) * gridSize;
    // Tie-break: pick nearest half-cell
    const alt = (Math.floor(relX / gridSize) + 1.5) * gridSize;
    if (Math.abs(relX - alt) < Math.abs(relX - snappedCenterX)) {
      snappedCenterX = alt;
    }
  }

  if (footH % 2 === 0) {
    snappedCenterY = Math.round(relY / gridSize) * gridSize;
  } else {
    snappedCenterY = (Math.floor(relY / gridSize) + 0.5) * gridSize;
    const alt = (Math.floor(relY / gridSize) + 1.5) * gridSize;
    if (Math.abs(relY - alt) < Math.abs(relY - snappedCenterY)) {
      snappedCenterY = alt;
    }
  }

  // Top-left cell
  const topLeftI = Math.round(snappedCenterX / gridSize - footW / 2);
  const topLeftJ = Math.round(snappedCenterY / gridSize - footH / 2);

  return { i: topLeftI, j: topLeftJ };
}

// ---------------------------------------------------------------------------
// Template highlight (square grid, circle / cone / line / emanation)
// ---------------------------------------------------------------------------

/**
 * Compute the set of cells covered by a circular burst (circle template).
 *
 * **M1-A placeholder**: cell inclusion uses Chebyshev distance (max of |di|, |dj|)
 * as a heuristic matching PF2e burst behavior. The exact per-system inclusion rule
 * (e.g. "any part of the cell" vs "center of the cell") is deferred to Q-CNV-02
 * and will be resolved in M1-C when `MeasuredTemplate` is consumed by the UI.
 *
 * Do not change the heuristic without updating the locked test expectations in
 * `packages/shared/src/grid/__tests__/math.test.ts` and referencing Q-CNV-02.
 *
 * See: 06-canvas-e-renderizacao.md Q-CNV-02
 */
export function squareCircleHighlight(
  originX: number,
  originY: number,
  distanceUnits: number,
  gridSize: number,
  gridDistance: number,
  offsetX: number,
  offsetY: number,
): CellOffset[] {
  if (gridDistance <= 0 || distanceUnits <= 0) return [];

  const radiusCells = distanceUnits / gridDistance;
  const originCell = squarePixelToCell(originX, originY, gridSize, offsetX, offsetY);
  const rCeil = Math.ceil(radiusCells);

  const result: CellOffset[] = [];

  for (let dj = -rCeil; dj <= rCeil; dj++) {
    for (let di = -rCeil; di <= rCeil; di++) {
      // Use Chebyshev (maximum of |di|, |dj|) as cell coverage heuristic
      // matching PF2e burst behavior.
      if (Math.max(Math.abs(di), Math.abs(dj)) <= radiusCells) {
        result.push({ i: originCell.i + di, j: originCell.j + dj });
      }
    }
  }

  return result;
}

/** Compute the set of cells covered by a line/ray template. */
export function squareLineHighlight(
  originX: number,
  originY: number,
  directionDeg: number,
  distanceUnits: number,
  widthUnits: number,
  gridSize: number,
  gridDistance: number,
  offsetX: number,
  offsetY: number,
): CellOffset[] {
  if (gridDistance <= 0 || distanceUnits <= 0) return [];

  const angle = (directionDeg * Math.PI) / 180;
  const lengthPx = (distanceUnits / gridDistance) * gridSize;
  const halfWidthPx =
    ((widthUnits > 0 ? widthUnits : gridDistance) / gridDistance) * gridSize * 0.5;

  const endX = originX + Math.cos(angle) * lengthPx;
  const endY = originY + Math.sin(angle) * lengthPx;

  // Perpendicular unit vector
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  // Build 4-corner polygon of the line rectangle
  const corners = [
    { x: originX + perpX * halfWidthPx, y: originY + perpY * halfWidthPx },
    { x: originX - perpX * halfWidthPx, y: originY - perpY * halfWidthPx },
    { x: endX - perpX * halfWidthPx, y: endY - perpY * halfWidthPx },
    { x: endX + perpX * halfWidthPx, y: endY + perpY * halfWidthPx },
  ];

  return cellsInPolygon(corners, gridSize, offsetX, offsetY);
}

/** Compute the set of cells covered by a cone template. */
export function squareConeHighlight(
  originX: number,
  originY: number,
  directionDeg: number,
  angleDeg: number,
  distanceUnits: number,
  gridSize: number,
  gridDistance: number,
  offsetX: number,
  offsetY: number,
): CellOffset[] {
  if (gridDistance <= 0 || distanceUnits <= 0) return [];

  const centerAngle = (directionDeg * Math.PI) / 180;
  const halfAngle = ((angleDeg > 0 ? angleDeg : 90) * Math.PI) / 360;
  const lengthPx = (distanceUnits / gridDistance) * gridSize;

  const steps = 32; // polygon resolution
  const vertices: Array<{ x: number; y: number }> = [{ x: originX, y: originY }];

  for (let k = 0; k <= steps; k++) {
    const a = centerAngle - halfAngle + (k / steps) * (2 * halfAngle);
    vertices.push({
      x: originX + Math.cos(a) * lengthPx,
      y: originY + Math.sin(a) * lengthPx,
    });
  }

  return cellsInPolygon(vertices, gridSize, offsetX, offsetY);
}

// ---------------------------------------------------------------------------
// Polygon → cells helper
// ---------------------------------------------------------------------------

/**
 * Return all cell offsets whose center lies inside (or on the boundary of)
 * the given polygon.
 *
 * Uses point-in-polygon (ray-casting).
 */
function cellsInPolygon(
  vertices: ReadonlyArray<{ x: number; y: number }>,
  gridSize: number,
  offsetX: number,
  offsetY: number,
): CellOffset[] {
  if (vertices.length < 3) return [];

  // Compute bounding box
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }

  const minI = Math.floor((minX - offsetX) / gridSize);
  const minJ = Math.floor((minY - offsetY) / gridSize);
  const maxI = Math.floor((maxX - offsetX) / gridSize);
  const maxJ = Math.floor((maxY - offsetY) / gridSize);

  const result: CellOffset[] = [];

  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const cx = offsetX + i * gridSize + gridSize / 2;
      const cy = offsetY + j * gridSize + gridSize / 2;
      if (pointInPolygon(cx, cy, vertices)) {
        result.push({ i, j });
      }
    }
  }

  return result;
}

/**
 * Ray-casting point-in-polygon test.
 */
function pointInPolygon(
  px: number,
  py: number,
  vertices: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  let inside = false;
  const n = vertices.length;
  let j = n - 1;

  for (let i = 0; i < n; i++) {
    const vi = vertices[i] as { x: number; y: number };
    const vj = vertices[j] as { x: number; y: number };
    const xi = vi.x;
    const yi = vi.y;
    const xj = vj.x;
    const yj = vj.y;

    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }

  return inside;
}
