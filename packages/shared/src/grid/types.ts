/**
 * Grid system types — shared between client and server.
 *
 * Spec: 06-canvas-e-renderizacao.md §DEC-CNV-03, §DEC-CNV-04, §REQ-CNV-014..024
 * Spec: 02-modelo-de-dados.md (SceneDocument.grid)
 *
 * REQ-CNV-014: square, hex, gridless behind a common GridStrategy interface.
 * REQ-CNV-015: hex supports four variants (pointy/flat × odd/even).
 * REQ-CNV-016: pixelToCell, cellToPixel, getSnappedPoint, measureDistance,
 *              getHighlightCells.
 * REQ-CNV-017: gridSize minimum 50 px.
 * REQ-CNV-018: snapping resolution: center, vertex, edge, intersection.
 * REQ-CNV-019: diagonal rule for square grids (configurable per scene).
 * REQ-CNV-020: default diagonal rule for PF2e = alternating_1 (5-10-5).
 */

// ---------------------------------------------------------------------------
// Core coordinate types
// ---------------------------------------------------------------------------

/** A point in scene coordinates (pixels). */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A cell offset (column i, row j).
 * For square grids: i = column, j = row, both zero-based from top-left.
 * For hex grids: offset-row or offset-col depending on orientation/parity.
 */
export interface CellOffset {
  readonly i: number; // column
  readonly j: number; // row
}

/**
 * Axial (cube) coordinate for hexagonal grids.
 * Invariant: q + r + s === 0.
 * REQ-CNV-015: cube coordinates used internally for hex.
 */
export interface CubeCoord {
  readonly q: number;
  readonly r: number;
  readonly s: number;
}

// ---------------------------------------------------------------------------
// Grid configuration
// ---------------------------------------------------------------------------

/** Grid type supported by the canvas. REQ-CNV-014. */
export type GridType = "square" | "hex" | "gridless";

/** Hex orientation. REQ-CNV-015. */
export type HexOrientation = "pointy" | "flat";

/** Hex parity — which rows/columns are offset. REQ-CNV-015. */
export type HexParity = "odd" | "even";

/**
 * Diagonal movement rule for square grids.
 * REQ-CNV-019, D4 of spec 06.
 *
 * alternating_1 = 1-2-1-2 (begins with cost 1) — PF2e 5-10-5, ALTERNATING_1
 * alternating_2 = 2-1-2-1 (begins with cost 2) — ALTERNATING_2 [V2 target]
 */
export type DiagonalRule =
  | "equidistant" // diagonal = 1 cell (D&D 5e)
  | "exact" // diagonal = √2 cells
  | "approximate" // diagonal = 1.5 cells
  | "rectilinear" // diagonal = 2 cells
  | "alternating_1" // alternates 1-2-1-2 per path (begins 1) — PF2e 5-10-5
  | "alternating_2" // alternates 2-1-2-1 per path (begins 2) — [V2 target]
  | "illegal"; // diagonal movement is forbidden

/** Configuration for a scene's grid. REQ-CNV-017, REQ-CNV-024. */
export interface GridConfig {
  /** Grid type. */
  type: GridType;
  /**
   * Size of a cell in pixels.
   * Square: side length. Hex: distance between parallel sides (width for pointy,
   * height for flat).
   * Minimum: 50 px (REQ-CNV-017).
   */
  size: number;
  /** In-game distance represented by one cell (e.g. 5). */
  distance: number;
  /** Unit label for distances (e.g. "ft", "m"). */
  units: string;
  /** CSS hex color for the grid lines (e.g. "#000000"). */
  color: string;
  /** Opacity of grid lines, 0–1. */
  alpha: number;
  /**
   * Hex-specific options.
   * Required when type === "hex"; ignored otherwise.
   */
  hex?: {
    orientation: HexOrientation;
    parity: HexParity;
  };
  /**
   * Diagonal movement rule.
   * Only applies to square grids (REQ-CNV-019).
   * Default for PF2e scenes: "alternating_1" (REQ-CNV-020).
   */
  diagonalRule?: DiagonalRule;
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/**
 * Snap resolution — which grid anchor to snap to.
 * REQ-CNV-018.
 */
export type SnapResolution = "center" | "vertex" | "edge" | "intersection";

// ---------------------------------------------------------------------------
// Shapes for highlight / footprint
// ---------------------------------------------------------------------------

/** Template shape kinds (REQ-CNV-052). */
export type TemplateShapeKind = "circle" | "cone" | "line" | "emanation";

/** A measured template shape in scene coordinates. */
export interface TemplateShape {
  readonly kind: TemplateShapeKind;
  readonly origin: ScenePoint;
  /** Facing direction in degrees (0 = east, clockwise). */
  readonly direction: number;
  /** Reach distance in game units (gridDistance units). */
  readonly distance: number;
  /** Cone opening angle in degrees (only for kind === "cone"). Default 90. */
  readonly angle?: number;
  /** Line width in game units (only for kind === "line"). */
  readonly width?: number;
}

/** A token footprint — how many cells wide/tall the token occupies. */
export interface FootprintShape {
  /** Top-left cell of the footprint. */
  readonly origin: CellOffset;
  /** Width in cells. */
  readonly width: number;
  /** Height in cells. */
  readonly height: number;
}

// ---------------------------------------------------------------------------
// SceneConfig — shape of the future Scene Document's canvas fields
// Spec 06 §REQ-CNV-064..069
// ---------------------------------------------------------------------------

/**
 * Scene canvas configuration.
 * This is the shape that will live inside SceneDocument once M1-B lands.
 * For M1-A it is used locally in the dev scene mock.
 *
 * REQ-CNV-064: dimensions (width, height in pixels).
 * REQ-CNV-065: background image path, optional foreground, grid offset.
 * REQ-CNV-066: padding (fraction of canvas area).
 * REQ-CNV-067: grid configuration.
 * REQ-CNV-068: initialView.
 */
export interface SceneConfig {
  /** Scene width in pixels (excluding padding). */
  width: number;
  /** Scene height in pixels (excluding padding). */
  height: number;
  /**
   * Padding around the scene as a fraction of the scene dimensions.
   * E.g. 0.25 adds 25% of width/height as a border on each side.
   * REQ-CNV-066.
   */
  padding: number;
  /**
   * Path to the background map image.
   * Null = solid backgroundColor.
   * REQ-CNV-065.
   */
  backgroundPath: string | null;
  /**
   * CSS color for the background when no image is used.
   * E.g. "#1a1a2e".
   */
  backgroundColor: string;
  /**
   * Optional foreground image path (renders above tokens).
   * REQ-CNV-065.
   */
  foregroundPath: string | null;
  /**
   * Pixel offset applied to align a pre-drawn grid in the background image.
   * REQ-CNV-065.
   */
  gridOffsetX: number;
  gridOffsetY: number;
  /** Grid configuration (type, size, color, diagonal rule, etc.). */
  grid: GridConfig;
  /**
   * Initial camera view when the scene is activated.
   * Null = fit scene to viewport.
   * REQ-CNV-068.
   */
  initialView: {
    x: number;
    y: number;
    scale: number;
  } | null;
}

// ---------------------------------------------------------------------------
// GridStrategy interface
// ---------------------------------------------------------------------------

/**
 * Contract for all grid implementations.
 *
 * Implementations: SquareGrid, HexGrid (not implemented yet), GridlessGrid
 * (not implemented yet).
 *
 * REQ-CNV-016.
 */
export interface GridStrategy {
  readonly config: GridConfig;

  /**
   * Convert a scene-coordinate point to the containing cell offset.
   * REQ-CNV-016.
   */
  pixelToCell(p: ScenePoint): CellOffset;

  /**
   * Return the center of a cell in scene coordinates.
   * REQ-CNV-016.
   */
  cellToPixel(c: CellOffset): ScenePoint;

  /**
   * Snap a scene-coordinate point to the nearest grid anchor of the given
   * resolution.
   * REQ-CNV-016, REQ-CNV-018.
   */
  getSnappedPoint(p: ScenePoint, resolution: SnapResolution): ScenePoint;

  /**
   * Measure the total in-game distance along a path of waypoints, applying
   * the diagonal rule configured on this grid.
   *
   * Returns distance in game units (gridDistance per cell).
   * An empty or single-point path returns 0.
   *
   * REQ-CNV-016, REQ-CNV-019.
   */
  measureDistance(path: ScenePoint[]): number;

  /**
   * Return the list of cell offsets covered by a shape.
   * Used for template highlights and token footprints.
   * REQ-CNV-016, REQ-CNV-054.
   */
  getHighlightCells(shape: TemplateShape | FootprintShape): CellOffset[];
}
