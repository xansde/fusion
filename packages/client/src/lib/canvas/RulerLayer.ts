/**
 * RulerLayer.ts — draws the measurement ruler, area templates and the drag ruler.
 *
 * Spec: 06-canvas-e-renderizacao.md (ruler with grid measurement)
 * Spec: 04-rede-e-sincronizacao.md (presence:ruler ephemeral)
 *
 * Lives in the "controls" layer (InterfaceGroup), which follows the camera:
 * waypoints are scene coordinates, so the line must pan and zoom with the map.
 * One renderer for the local user and for what other users share.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { AREA_BORDER_PX, type AreaStyle, type CellOffset, type GridStrategy, type ScenePoint } from "@fusion/shared";
import { unitLabel, type RulerSnapshot } from "../presence/rulerState.js";
import type { DragRulerView } from "../presence/dragRuler.js";
import type { RulerState } from "../presence/types.js";

const LOCAL_COLOR = 0xffcc44;
const REMOTE_COLOR = 0x66aaff;
const PINNED_COLOR = 0xcc88ff;
const LINE_WIDTH = 3;
const WAYPOINT_RADIUS = 6;

/** One area template ready to draw: affected squares, colour and tip label. */
export interface AreaDraw {
  readonly cells: ReadonlyArray<CellOffset>;
  readonly color: number;
  readonly label: string;
  /** Where the label goes and, for cones/lines, where the template starts. */
  readonly origin: ScenePoint;
  /** Also draw a line from origin to this point (cone / line axis). */
  readonly axisTo?: ScenePoint;
  /** Border and fill; absent = the legacy look. */
  readonly style?: Pick<AreaStyle, "border" | "fill">;
}

/** One edge of an area outline, in grid-corner indices (not pixels). */
export interface CellEdge {
  readonly i1: number;
  readonly j1: number;
  readonly i2: number;
  readonly j2: number;
}

/**
 * The outer edges of a set of squares: an edge shared by two squares of the set is
 * inside the area and is left out, so a thick border follows the silhouette only.
 */
export function boundaryEdges(cells: ReadonlyArray<CellOffset>): CellEdge[] {
  const has = new Set(cells.map((c) => `${String(c.i)},${String(c.j)}`));
  const edges: CellEdge[] = [];
  for (const { i, j } of cells) {
    if (!has.has(`${String(i)},${String(j - 1)}`)) edges.push({ i1: i, j1: j, i2: i + 1, j2: j });
    if (!has.has(`${String(i)},${String(j + 1)}`)) edges.push({ i1: i, j1: j + 1, i2: i + 1, j2: j + 1 });
    if (!has.has(`${String(i - 1)},${String(j)}`)) edges.push({ i1: i, j1: j, i2: i, j2: j + 1 });
    if (!has.has(`${String(i + 1)},${String(j)}`)) edges.push({ i1: i + 1, j1: j, i2: i + 1, j2: j + 1 });
  }
  return edges;
}

/** Label height in screen pixels: the same at any zoom. */
export const LABEL_FONT_PX = 16;

/**
 * Scale to apply to a label container living inside the camera-scaled stage so
 * it renders at a constant size on screen (the stage multiplies by `cameraScale`).
 * Guards against a zero/NaN scale from a not-yet-laid-out canvas.
 */
export function labelCounterScale(cameraScale: number): number {
  return Number.isFinite(cameraScale) && cameraScale > 0 ? 1 / cameraScale : 1;
}

export const AREA_COLORS = { local: LOCAL_COLOR, remote: REMOTE_COLOR, pinned: PINNED_COLOR };

export class RulerLayer {
  private _root: Container;
  private _graphics: Graphics;
  private _labels: Container;
  private _destroyed = false;
  private _grid: GridStrategy;
  private _viewScale = 1;

  constructor(parent: Container, grid: GridStrategy) {
    this._grid = grid;
    this._root = new Container();
    this._root.label = "ruler";
    this._root.eventMode = "none"; // never steals a click from a token
    this._graphics = new Graphics();
    this._graphics.eventMode = "none";
    this._labels = new Container();
    this._labels.eventMode = "none";
    this._root.addChild(this._graphics, this._labels);
    parent.addChild(this._root);
  }

  /**
   * Redraw everything.
   *
   * @param local   The local user's ruler, or null when not measuring.
   * @param remotes Rulers broadcast by other users.
   * @param areas   Area templates (local, remote and pinned).
   * @param drag    The drag ruler of a token being dragged, or null.
   */
  render(
    local: RulerSnapshot | null,
    remotes: Iterable<RulerState> = [],
    areas: Iterable<AreaDraw> = [],
    drag: DragRulerView | null = null,
    viewScale = 1,
    hint: { text: string; at: ScenePoint } | null = null,
  ): void {
    if (this._destroyed) return;
    this._viewScale = viewScale;

    this._graphics.clear();
    this._labels.removeChildren().forEach((c) => {
      c.destroy();
    });

    for (const area of areas) this._drawArea(area);

    for (const remote of remotes) {
      this._drawPath(remote.waypoints, REMOTE_COLOR);
      const tip = remote.waypoints.at(-1);
      if (tip) {
        // Remote rulers travel as waypoints only; the viewer measures them on
        // its own grid, so everyone reads the same number the owner sees.
        const dist =
          remote.waypoints.length >= 2 ? this._grid.measureDistance([...remote.waypoints]) : 0;
        const distLabel =
          dist > 0 ? `${dist.toFixed(0)} ${unitLabel(this._grid.config.units)}` : "";
        const text = [remote.userName, distLabel].filter(Boolean).join(" · ");
        if (text) this._drawLabel(text, tip, REMOTE_COLOR);
      }
    }

    if (local && local.mode === "measuring") {
      const path = [...local.waypoints];
      if (local.livePoint) path.push(local.livePoint);
      this._drawPath(path, LOCAL_COLOR);
      const tip = path.at(-1);
      if (tip && local.distanceLabel) this._drawLabel(local.distanceLabel, tip, LOCAL_COLOR);
    }

    if (hint) this._drawLabel(hint.text, hint.at, LOCAL_COLOR);

    if (drag && drag.path.length >= 1) {
      this._drawPath(drag.path, drag.color);
      const tip = drag.path.at(-1);
      if (tip && drag.distanceFt > 0) {
        const units = unitLabel(this._grid.config.units);
        this._drawLabel(`${drag.distanceFt.toFixed(0)} ${units}`, tip, drag.color);
      }
    }
  }

  private _drawArea(area: AreaDraw): void {
    const size = this._grid.config.size;
    const fillAlpha = area.style?.fill ?? 0.28;
    for (const c of area.cells) {
      const center = this._grid.cellToPixel(c);
      this._graphics.rect(center.x - size / 2, center.y - size / 2, size, size);
    }
    this._graphics.fill({ color: area.color, alpha: fillAlpha });
    // Outline of the silhouette only, at a width that is constant on screen.
    const k = labelCounterScale(this._viewScale);
    const width = (area.style ? AREA_BORDER_PX[area.style.border] : 2) * k;
    const corner = this._grid.cellToPixel({ i: 0, j: 0 });
    const x0 = corner.x - size / 2;
    const y0 = corner.y - size / 2;
    for (const e of boundaryEdges(area.cells)) {
      this._graphics.moveTo(x0 + e.i1 * size, y0 + e.j1 * size).lineTo(x0 + e.i2 * size, y0 + e.j2 * size);
    }
    this._graphics.stroke({ width, color: area.color, alpha: 0.95, cap: "square", join: "miter" });

    if (area.axisTo) {
      this._graphics.moveTo(area.origin.x, area.origin.y).lineTo(area.axisTo.x, area.axisTo.y);
      this._graphics.stroke({ width: LINE_WIDTH, color: area.color, alpha: 0.9 });
    }
    this._graphics.circle(area.origin.x, area.origin.y, WAYPOINT_RADIUS).fill({
      color: area.color,
      alpha: 0.95,
    });
    if (area.label) this._drawLabel(area.label, area.origin, area.color);
  }

  private _drawPath(points: ReadonlyArray<{ x: number; y: number }>, color: number): void {
    if (points.length === 0) return;

    if (points.length >= 2) {
      const [first, ...rest] = points as Array<{ x: number; y: number }>;
      if (first) {
        this._graphics.moveTo(first.x, first.y);
        for (const p of rest) this._graphics.lineTo(p.x, p.y);
        this._graphics.stroke({ width: LINE_WIDTH, color, alpha: 0.9 });
      }
    }

    for (const p of points) {
      this._graphics.circle(p.x, p.y, WAYPOINT_RADIUS).fill({ color, alpha: 0.9 });
    }
  }

  /**
   * A label with a dark plate, drawn at constant screen size: the container is
   * counter-scaled against the camera, so "fit the scene" zoom does not shrink it.
   */
  private _drawLabel(text: string, at: { x: number; y: number }, color: number): void {
    const box = new Container();
    box.eventMode = "none";
    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: "sans-serif",
        fontSize: LABEL_FONT_PX,
        fontWeight: "bold",
        fill: color,
      }),
    });
    label.eventMode = "none";
    const padX = 6;
    const padY = 3;
    label.x = padX;
    label.y = padY;
    const plate = new Graphics();
    plate.eventMode = "none";
    plate
      .roundRect(0, 0, label.width + padX * 2, label.height + padY * 2, 5)
      .fill({ color: 0x000000, alpha: 0.78 })
      .stroke({ width: 1, color, alpha: 0.8 });
    box.addChild(plate, label);
    const k = labelCounterScale(this._viewScale);
    box.scale.set(k);
    // Offset of 12 px right / 34 px up in screen units, whatever the zoom.
    box.x = at.x + 12 * k;
    box.y = at.y - 34 * k;
    this._labels.addChild(box);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._root.destroy({ children: true });
  }
}
