/**
 * FogToolController.ts — pointer/keyboard input for the manual fog tools.
 *
 * Listens on the canvas host in the CAPTURE phase so that, while a fog tool is
 * armed, a left click edits the fog instead of selecting/dragging a token.
 * Middle-button pan, Space+drag pan and the wheel are left alone (this only
 * swallows a plain left press). Gestures:
 *
 *   rect   press, drag, release                (snaps to the grid when asked)
 *   poly   click vertices; close with a double click, Enter, or a click on the
 *          first vertex; Backspace drops the last vertex; Escape cancels
 *   brush  press, drag, release                (radius from the options)
 *
 * Alt flips Revelar/Cobrir for the gesture. Finished shapes go out through
 * `onCommit`; the controller never touches the scene itself. The shape maths
 * lives in fogDraw.ts so it stays testable.
 */

import { Graphics, type Container } from "pixi.js";
import type { FogMode, FogOp } from "@fusion/shared";
import type { FusionCanvas } from "../FusionCanvas.js";
import { screenToWorld } from "../camera-math.js";
import {
  addBrushSample,
  buildBrushOp,
  buildPolyOp,
  buildRectOp,
  effectiveMode,
  isNearFirstVertex,
  type Point,
} from "./fogDraw.js";

export type FogTool = "none" | "rect" | "poly" | "brush";

export interface FogToolOptions {
  readonly tool: FogTool;
  readonly mode: FogMode;
  /** Brush radius in scene px. */
  readonly radius: number;
  /** Snap rectangles to the grid. */
  readonly snap: boolean;
}

export interface FogToolControllerOptions {
  readonly container: HTMLElement;
  readonly canvas: FusionCanvas;
  /** Layer the preview shapes are drawn in (scene coordinates). */
  readonly previewLayer: Container;
  readonly getOptions: () => FogToolOptions;
  readonly getGridSize: () => number;
  readonly onCommit: (op: FogOp) => void;
}

const REVEAL_COLOR = 0x3ddc84;
const COVER_COLOR = 0xff5c5c;
/** Screen-space distance (px) within which a click closes the polygon. */
const CLOSE_TOLERANCE_PX = 12;

export class FogToolController {
  private readonly _o: FogToolControllerOptions;
  private readonly _preview = new Graphics();

  private _tool: FogTool = "none";
  private _dragging = false;
  private _rectStart: Point | null = null;
  private _polyVertices: Point[] = [];
  private _brushPoints: readonly Point[] = [];
  private _cursor: Point | null = null;
  private _alt = false;
  private _space = false;

  constructor(opts: FogToolControllerOptions) {
    this._o = opts;
    this._preview.label = "fog:preview";
    this._preview.eventMode = "none";
    opts.previewLayer.addChild(this._preview);

    const el = opts.container;
    el.addEventListener("pointerdown", this._onDown, true);
    el.addEventListener("pointermove", this._onMove);
    el.addEventListener("pointerup", this._onUp);
    el.addEventListener("pointercancel", this._onCancel);
    el.addEventListener("pointerleave", this._onLeave);
    el.addEventListener("dblclick", this._onDblClick, true);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  /** Call when the options changed (tool switch, mode, radius): drops any half-made shape. */
  refresh(): void {
    const tool = this._o.getOptions().tool;
    if (tool !== this._tool) {
      this._reset();
      this._tool = tool;
      this._o.container.style.cursor = tool === "none" ? "" : "crosshair";
    }
    this._draw();
  }

  destroy(): void {
    const el = this._o.container;
    el.removeEventListener("pointerdown", this._onDown, true);
    el.removeEventListener("pointermove", this._onMove);
    el.removeEventListener("pointerup", this._onUp);
    el.removeEventListener("pointercancel", this._onCancel);
    el.removeEventListener("pointerleave", this._onLeave);
    el.removeEventListener("dblclick", this._onDblClick, true);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    el.style.cursor = "";
    this._preview.destroy();
  }

  // -- helpers ---------------------------------------------------------------

  private _active(): boolean {
    return this._o.getOptions().tool !== "none";
  }

  private _world(e: PointerEvent): Point {
    const rect = this._o.container.getBoundingClientRect();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, this._o.canvas.camera);
  }

  private _mode(): FogMode {
    return effectiveMode(this._o.getOptions().mode, this._alt);
  }

  private _reset(): void {
    this._dragging = false;
    this._rectStart = null;
    this._polyVertices = [];
    this._brushPoints = [];
  }

  private _typing(): boolean {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  }

  // -- pointer ---------------------------------------------------------------

  private readonly _onDown = (e: PointerEvent): void => {
    const opts = this._o.getOptions();
    if (opts.tool === "none" || e.button !== 0 || this._space) return;
    e.stopPropagation();
    e.preventDefault();
    this._alt = e.altKey;
    const p = this._world(e);
    this._cursor = p;

    if (opts.tool === "rect") {
      this._rectStart = p;
      this._dragging = true;
      this._capture(e);
    } else if (opts.tool === "brush") {
      this._brushPoints = addBrushSample([], p, opts.radius);
      this._dragging = true;
      this._capture(e);
    } else {
      const scale = this._o.canvas.camera.scale;
      if (isNearFirstVertex(this._polyVertices, p, CLOSE_TOLERANCE_PX / scale)) {
        this._finishPoly();
      } else {
        this._polyVertices = [...this._polyVertices, p];
      }
    }
    this._draw();
  };

  private _capture(e: PointerEvent): void {
    try {
      this._o.container.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; the gesture just ends on pointerup.
    }
  }

  private readonly _onMove = (e: PointerEvent): void => {
    if (!this._active()) return;
    this._alt = e.altKey;
    const p = this._world(e);
    this._cursor = p;
    if (this._dragging && this._o.getOptions().tool === "brush") {
      this._brushPoints = addBrushSample(this._brushPoints, p, this._o.getOptions().radius);
    }
    this._draw();
  };

  private readonly _onUp = (e: PointerEvent): void => {
    if (!this._dragging) return;
    const opts = this._o.getOptions();
    const p = this._world(e);
    this._alt = e.altKey;
    const mode = this._mode();
    let op: FogOp | null = null;
    if (opts.tool === "rect" && this._rectStart) {
      op = buildRectOp(mode, this._rectStart, p, opts.snap ? this._o.getGridSize() : null);
    } else if (opts.tool === "brush") {
      op = buildBrushOp(mode, opts.radius, addBrushSample(this._brushPoints, p, opts.radius));
    }
    this._dragging = false;
    this._rectStart = null;
    this._brushPoints = [];
    try {
      this._o.container.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (op) this._o.onCommit(op);
    this._draw();
  };

  private readonly _onCancel = (): void => {
    this._reset();
    this._draw();
  };

  private readonly _onLeave = (): void => {
    this._cursor = null;
    this._draw();
  };

  private readonly _onDblClick = (e: MouseEvent): void => {
    if (this._o.getOptions().tool !== "poly") return;
    e.stopPropagation();
    e.preventDefault();
    this._finishPoly();
    this._draw();
  };

  private _finishPoly(): void {
    const op = buildPolyOp(this._mode(), this._polyVertices);
    this._polyVertices = [];
    if (op) this._o.onCommit(op);
  }

  // -- keyboard --------------------------------------------------------------

  private readonly _onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space") this._space = true;
    if (!this._active() || this._typing()) return;
    if (e.key === "Alt") {
      this._alt = true;
      e.preventDefault();
      this._draw();
    } else if (e.key === "Enter" && this._polyVertices.length > 0) {
      e.preventDefault();
      this._finishPoly();
      this._draw();
    } else if (e.key === "Escape") {
      this._reset();
      this._draw();
    } else if (e.key === "Backspace" && this._polyVertices.length > 0) {
      e.preventDefault();
      this._polyVertices = this._polyVertices.slice(0, -1);
      this._draw();
    }
  };

  private readonly _onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") this._space = false;
    if (e.key === "Alt") {
      this._alt = false;
      this._draw();
    }
  };

  // -- preview ---------------------------------------------------------------

  private _draw(): void {
    const g = this._preview;
    g.clear();
    const opts = this._o.getOptions();
    if (opts.tool === "none") return;
    const color = this._mode() === "reveal" ? REVEAL_COLOR : COVER_COLOR;
    const scale = this._o.canvas.camera.scale;
    const line = 2 / scale;
    const cursor = this._cursor;

    if (opts.tool === "rect" && this._rectStart && cursor) {
      const snap = opts.snap ? this._o.getGridSize() : null;
      const op = buildRectOp(this._mode(), this._rectStart, cursor, snap);
      if (op && op.t === "rect") {
        g.rect(op.x, op.y, op.w, op.h).fill({ color, alpha: 0.2 }).stroke({ color, width: line });
      } else {
        const x = Math.min(this._rectStart.x, cursor.x);
        const y = Math.min(this._rectStart.y, cursor.y);
        g.rect(
          x,
          y,
          Math.abs(cursor.x - this._rectStart.x),
          Math.abs(cursor.y - this._rectStart.y),
        ).stroke({
          color,
          width: line,
        });
      }
    } else if (opts.tool === "poly") {
      const v = this._polyVertices;
      if (v.length > 0) {
        const first = v[0] as Point;
        g.moveTo(first.x, first.y);
        for (const pt of v.slice(1)) g.lineTo(pt.x, pt.y);
        if (cursor) g.lineTo(cursor.x, cursor.y);
        g.stroke({ color, width: line });
        if (v.length >= 3) {
          g.poly(v.flatMap((pt) => [pt.x, pt.y])).fill({ color, alpha: 0.15 });
        }
        for (const pt of v) g.circle(pt.x, pt.y, 4 / scale).fill({ color });
      }
    } else if (opts.tool === "brush") {
      if (this._brushPoints.length > 0) {
        const first = this._brushPoints[0] as Point;
        g.moveTo(first.x, first.y);
        for (const pt of this._brushPoints.slice(1)) g.lineTo(pt.x, pt.y);
        g.stroke({ color, width: opts.radius * 2, alpha: 0.25, cap: "round", join: "round" });
        g.circle(first.x, first.y, opts.radius).fill({ color, alpha: 0.25 });
      }
      if (cursor) g.circle(cursor.x, cursor.y, opts.radius).stroke({ color, width: line });
    }
  }
}
