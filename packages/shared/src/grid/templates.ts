/**
 * Area templates (burst, cone, line, emanation) on a square grid, PF2e rules.
 *
 * Pure math over SquareGrid: no PIXI, no DOM. The older `squareCircleHighlight`
 * (math.ts) uses a Chebyshev heuristic with locked tests (Q-CNV-02) and is left
 * untouched; the table templates use the functions below instead.
 *
 * Rules applied (Player Core, "Areas of Effect"):
 *  - Burst: centred on a grid INTERSECTION; a square is affected when its centre
 *    lies within the radius, measured with the 5-10 diagonal rule.
 *  - Cone: 90 degrees, origin at a corner or edge of the caster square,
 *    direction snapped to 45 degrees, length N.
 *  - Line: 5 ft wide, length N, from the origin toward the cursor.
 *  - Emanation: every square within N ft of the edges of the source footprint
 *    (so the source size is included), the source own squares excluded.
 */

import { squareCellDistance, squareConeHighlight, squareLineHighlight } from "./math.js";
import type { SquareGrid } from "./SquareGrid.js";
import type { CellOffset, ScenePoint } from "./types.js";

export type AreaKind = "burst" | "cone" | "line" | "emanation";

/** The cells a source token occupies (emanations grow from its edges). */
export interface AreaFootprint {
  readonly i: number;
  readonly j: number;
  readonly width: number;
  readonly height: number;
}

/** A serializable area template: enough for every client to recompute the cells. */
export interface AreaTemplate {
  readonly kind: AreaKind;
  /** Radius (burst, emanation) or length (cone, line) in feet. */
  readonly sizeFt: number;
  /** Burst centre / cone and line origin, in scene pixels. Unused by emanations. */
  readonly origin: ScenePoint;
  /** Degrees, 0 = east, clockwise (screen y grows down). Cones and lines only. */
  readonly direction: number;
  /** Emanations only. */
  readonly footprint?: AreaFootprint;
  /** Emanations only: the token this area is anchored to; it follows the token. */
  readonly tokenId?: string;
  /** How the area is drawn. Absent = defaults. */
  readonly style?: AreaStyle;
}

export type AreaBorder = "thin" | "medium" | "thick";

export interface AreaStyle {
  /** CSS hex, `#rrggbb`. */
  readonly color: string;
  readonly border: AreaBorder;
  /** Fill opacity, 0.1..0.7. */
  readonly fill: number;
}

/** Short palette, legible over dark and light maps. */
export const AREA_PALETTE: ReadonlyArray<string> = [
  "#ff3b30", // red
  "#ff9500", // orange
  "#ffd60a", // yellow
  "#34c759", // green
  "#0a84ff", // blue
  "#bf5af2", // violet
];

export const AREA_FILL_MIN = 0.1;
export const AREA_FILL_MAX = 0.7;

export const DEFAULT_AREA_STYLE: AreaStyle = {
  color: "#bf5af2",
  border: "medium",
  fill: 0.3,
};

/** Border width in SCREEN pixels. */
export const AREA_BORDER_PX: Readonly<Record<AreaBorder, number>> = {
  thin: 2,
  medium: 4,
  thick: 8,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Clean an untrusted style: unknown fields fall back to the defaults, fill is clamped. */
export function normalizeAreaStyle(raw: unknown): AreaStyle {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const color = typeof r["color"] === "string" && HEX.test(r["color"]) ? r["color"] : DEFAULT_AREA_STYLE.color;
  const b = r["border"];
  const border: AreaBorder = b === "thin" || b === "medium" || b === "thick" ? b : DEFAULT_AREA_STYLE.border;
  const f = typeof r["fill"] === "number" && Number.isFinite(r["fill"]) ? r["fill"] : DEFAULT_AREA_STYLE.fill;
  return { color, border, fill: Math.min(AREA_FILL_MAX, Math.max(AREA_FILL_MIN, f)) };
}

/** Squares of a token from its top-left scene position and size in cells. */
export function footprintFromAnchor(
  topLeft: ScenePoint,
  size: { width: number; height: number },
  grid: { size: number; ox: number; oy: number },
): AreaFootprint {
  return {
    i: Math.round((topLeft.x - grid.ox) / grid.size),
    j: Math.round((topLeft.y - grid.oy) / grid.size),
    width: size.width,
    height: size.height,
  };
}

/** The same emanation, re-anchored on the token's current squares. */
export function anchoredTemplate(
  t: AreaTemplate,
  footprint: AreaFootprint,
  grid: { size: number; ox: number; oy: number },
): AreaTemplate {
  return {
    ...t,
    footprint,
    origin: {
      x: grid.ox + (footprint.i + footprint.width / 2) * grid.size,
      y: grid.oy + (footprint.j + footprint.height / 2) * grid.size,
    },
  };
}

export const AREA_LABELS: Readonly<Record<AreaKind, string>> = {
  burst: "Explosão",
  cone: "Cone",
  line: "Linha",
  emanation: "Emanação",
};

/** Smallest and largest size the table accepts, in feet. */
export const AREA_MIN_FT = 5;
export const AREA_MAX_FT = 500;

/** Clamp to [5, 500] and round to a multiple of 5. */
export function normalizeAreaSize(ft: number): number {
  if (!Number.isFinite(ft)) return AREA_MIN_FT;
  const stepped = Math.round(ft / 5) * 5;
  return Math.min(AREA_MAX_FT, Math.max(AREA_MIN_FT, stepped));
}

const EPS = 1e-6;

function dims(grid: SquareGrid): { size: number; dist: number; ox: number; oy: number } {
  return {
    size: grid.config.size,
    dist: grid.config.distance,
    ox: grid.origin.x,
    oy: grid.origin.y,
  };
}

/** Snap to the nearest grid intersection (burst centre). */
export function snapToIntersection(grid: SquareGrid, p: ScenePoint): ScenePoint {
  const { size, ox, oy } = dims(grid);
  return {
    x: ox + Math.round((p.x - ox) / size) * size,
    y: oy + Math.round((p.y - oy) / size) * size,
  };
}

/**
 * Snap to the nearest corner or edge midpoint of any square (cone/line origin).
 * Square centres are excluded: a cone starts on the caster boundary.
 */
export function snapToCornerOrEdge(grid: SquareGrid, p: ScenePoint): ScenePoint {
  const { size, ox, oy } = dims(grid);
  const half = size / 2;
  const hx = Math.round((p.x - ox) / half);
  const hy = Math.round((p.y - oy) / half);
  if (Math.abs(hx) % 2 === 1 && Math.abs(hy) % 2 === 1) {
    // Landed on a square centre: push to the closest boundary lattice point.
    const dx = (p.x - ox) / half - hx;
    const dy = (p.y - oy) / half - hy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: ox + (hx + (dx >= 0 ? 1 : -1)) * half, y: oy + hy * half };
    }
    return { x: ox + hx * half, y: oy + (hy + (dy >= 0 ? 1 : -1)) * half };
  }
  return { x: ox + hx * half, y: oy + hy * half };
}

/** Direction in degrees from `from` to `to`, optionally snapped to 45 degrees. */
export function directionDeg(from: ScenePoint, to: ScenePoint, snap45: boolean): number {
  const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const d = snap45 ? Math.round(deg / 45) * 45 : deg;
  return ((d % 360) + 360) % 360;
}

function burstCells(t: AreaTemplate, grid: SquareGrid): CellOffset[] {
  const { size, dist, ox, oy } = dims(grid);
  const radius = t.sizeFt / dist; // in squares
  const ci = Math.round((t.origin.x - ox) / size); // intersection index
  const cj = Math.round((t.origin.y - oy) / size);
  const reach = Math.ceil(radius);
  const out: CellOffset[] = [];
  for (let j = cj - reach; j < cj + reach; j++) {
    for (let i = ci - reach; i < ci + reach; i++) {
      // Offsets of the square centre from the intersection, in squares.
      const a = Math.abs(i + 0.5 - ci);
      const b = Math.abs(j + 0.5 - cj);
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      // 5-10 rule, continuous: a diagonal step costs 1.5 squares on average.
      if (hi + 0.5 * lo <= radius + EPS) out.push({ i, j });
    }
  }
  return out;
}

function emanationCells(t: AreaTemplate, grid: SquareGrid): CellOffset[] {
  const fp = t.footprint;
  if (!fp) return [];
  const { dist } = dims(grid);
  const rule = grid.config.diagonalRule ?? "alternating_1";
  const reach = Math.ceil(t.sizeFt / dist);
  const out: CellOffset[] = [];
  for (let j = fp.j - reach; j < fp.j + fp.height + reach; j++) {
    for (let i = fp.i - reach; i < fp.i + fp.width + reach; i++) {
      const gapI = i < fp.i ? fp.i - i : i > fp.i + fp.width - 1 ? i - (fp.i + fp.width - 1) : 0;
      const gapJ = j < fp.j ? fp.j - j : j > fp.j + fp.height - 1 ? j - (fp.j + fp.height - 1) : 0;
      if (gapI === 0 && gapJ === 0) continue; // the source own squares
      const { distance } = squareCellDistance(0, 0, gapI, gapJ, dist, rule);
      if (distance <= t.sizeFt + EPS) out.push({ i, j });
    }
  }
  return out;
}

/** The squares an area template affects. */
export function templateCells(t: AreaTemplate, grid: SquareGrid): CellOffset[] {
  const { size, dist, ox, oy } = dims(grid);
  switch (t.kind) {
    case "burst":
      return burstCells(t, grid);
    case "emanation":
      return emanationCells(t, grid);
    case "cone":
      // 92 degrees: squares whose centre sits exactly on the 45-degree edge of a
      // 90-degree wedge must count, and float error must not decide it.
      return squareConeHighlight(t.origin.x, t.origin.y, t.direction, 92, t.sizeFt, size, dist, ox, oy);
    case "line":
      return squareLineHighlight(t.origin.x, t.origin.y, t.direction, t.sizeFt, 5, size, dist, ox, oy);
  }
}

/** "Cone 15 pés". */
export function templateTitle(t: Pick<AreaTemplate, "kind" | "sizeFt">): string {
  return `${AREA_LABELS[t.kind]} ${String(t.sizeFt)} pés`;
}

/** A token as seen by the template: its name and the squares it covers. */
export interface AreaTarget {
  readonly name: string;
  readonly i: number;
  readonly j: number;
  readonly width: number;
  readonly height: number;
}

/** Names of the targets with at least one square inside `cells`, in input order. */
export function targetsInCells(
  cells: ReadonlyArray<CellOffset>,
  targets: ReadonlyArray<AreaTarget>,
): string[] {
  const set = new Set(cells.map((c) => `${String(c.i)},${String(c.j)}`));
  const names: string[] = [];
  for (const t of targets) {
    let hit = false;
    for (let j = t.j; j < t.j + t.height && !hit; j++) {
      for (let i = t.i; i < t.i + t.width; i++) {
        if (set.has(`${String(i)},${String(j)}`)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) names.push(t.name);
  }
  return names;
}

const KINDS: ReadonlySet<string> = new Set(["burst", "cone", "line", "emanation"]);

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Validate an untrusted template (from the wire). Returns a clean AreaTemplate or
 * null; never throws.
 */
export function parseAreaTemplate(raw: unknown): AreaTemplate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = r["kind"];
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  const sizeFt = num(r["sizeFt"]);
  const direction = num(r["direction"]);
  const o = r["origin"] as Record<string, unknown> | undefined;
  const ox = num(o?.["x"]);
  const oy = num(o?.["y"]);
  if (sizeFt === undefined || direction === undefined || ox === undefined || oy === undefined) {
    return null;
  }
  const tokenId = typeof r["tokenId"] === "string" && r["tokenId"] !== "" ? r["tokenId"] : undefined;
  const base = {
    kind: kind as AreaKind,
    sizeFt,
    origin: { x: ox, y: oy },
    direction,
    ...(tokenId !== undefined ? { tokenId } : {}),
    ...(r["style"] !== undefined ? { style: normalizeAreaStyle(r["style"]) } : {}),
  };
  const fp = r["footprint"] as Record<string, unknown> | undefined;
  if (fp) {
    const i = num(fp["i"]);
    const j = num(fp["j"]);
    const width = num(fp["width"]);
    const height = num(fp["height"]);
    if (i === undefined || j === undefined || width === undefined || height === undefined) {
      return null;
    }
    return { ...base, footprint: { i, j, width, height } };
  }
  return base;
}
