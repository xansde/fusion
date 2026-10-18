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
import type { CellOffset, GridStrategy, ScenePoint } from "@fusion/shared";
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
}

export const AREA_COLORS = { local: LOCAL_COLOR, remote: REMOTE_COLOR, pinned: PINNED_COLOR };

export class RulerLayer {
  private _root: Container;
  private _graphics: Graphics;
  private _labels: Container;
  private _destroyed = false;
  private _grid: GridStrategy;

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
  ): void {
    if (this._destroyed) return;

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
    for (const c of area.cells) {
      const center = this._grid.cellToPixel(c);
      this._graphics.rect(center.x - size / 2, center.y - size / 2, size, size);
    }
    this._graphics.fill({ color: area.color, alpha: 0.28 });
    for (const c of area.cells) {
      const center = this._grid.cellToPixel(c);
      this._graphics.rect(center.x - size / 2, center.y - size / 2, size, size);
    }
    this._graphics.stroke({ width: 2, color: area.color, alpha: 0.75 });

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

  private _drawLabel(text: string, at: { x: number; y: number }, color: number): void {
    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: "sans-serif",
        fontSize: 20,
        fill: color,
        stroke: { color: 0x000000, width: 4 },
      }),
    });
    label.eventMode = "none";
    label.x = at.x + WAYPOINT_RADIUS * 2;
    label.y = at.y - WAYPOINT_RADIUS * 3;
    this._labels.addChild(label);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._root.destroy({ children: true });
  }
}
