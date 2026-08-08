/**
 * RulerLayer.ts — draws the measurement ruler (local and remote).
 *
 * Spec: 06-canvas-e-renderizacao.md (ruler with grid measurement)
 * Spec: 04-rede-e-sincronizacao.md (presence:ruler ephemeral)
 *
 * Lives in the "controls" layer (InterfaceGroup), which follows the camera:
 * waypoints are scene coordinates, so the line must pan and zoom with the map.
 *
 * Remote rulers were already received and stored by presenceStore since M1-E —
 * nothing ever drew them, because no local gesture could produce one to send.
 * This renderer covers both sides.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { RulerSnapshot } from "../presence/rulerState.js";
import type { RulerState } from "../presence/types.js";

const LOCAL_COLOR = 0xffcc44;
const REMOTE_COLOR = 0x66aaff;
const LINE_WIDTH = 3;
const WAYPOINT_RADIUS = 6;

export class RulerLayer {
  private _root: Container;
  private _graphics: Graphics;
  private _labels: Container;
  private _destroyed = false;

  constructor(parent: Container) {
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
   */
  render(local: RulerSnapshot | null, remotes: Iterable<RulerState> = []): void {
    if (this._destroyed) return;

    this._graphics.clear();
    this._labels.removeChildren().forEach((c) => {
      c.destroy();
    });

    for (const remote of remotes) {
      this._drawPath(remote.waypoints, REMOTE_COLOR);
      const tip = remote.waypoints.at(-1);
      if (tip && remote.userName) this._drawLabel(remote.userName, tip, REMOTE_COLOR);
    }

    if (local && local.mode === "measuring") {
      const path = [...local.waypoints];
      if (local.livePoint) path.push(local.livePoint);
      this._drawPath(path, LOCAL_COLOR);
      const tip = path.at(-1);
      if (tip && local.distanceLabel) this._drawLabel(local.distanceLabel, tip, LOCAL_COLOR);
    }
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
