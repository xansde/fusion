/**
 * attachGridCalibration.ts — the DOM adapter of the grid calibration tool.
 *
 * Spec: 06-canvas-e-renderizacao.md (REQ-CNV-017, configurable gridSize)
 *
 * A battle map is someone else's image with a grid already baked into the
 * pixels at whatever scale their export used. Typing cell sizes until the
 * lines happen to agree is guesswork, so instead the GM drags a box over one
 * cell they can see and the app derives the numbers from it.
 *
 * While the tool is on it takes the pointer for itself (capture phase, then
 * stopPropagation), so a drag over a token resizes the box instead of moving
 * the token. Turning the tool off gives every gesture back.
 *
 * Geometry lives in gridCalibrationRect.ts and the arithmetic in
 * calibrateSquareGrid (@fusion/shared); both are pure and tested. This file is
 * plumbing.
 */

import type { Container } from "pixi.js";
import type { FusionCanvas } from "./FusionCanvas.js";
import { GridCalibrationLayer, HANDLE_GRAB_RADIUS } from "./GridCalibrationLayer.js";
import { screenToWorld } from "./camera-math.js";
import {
  applyHandleDrag,
  defaultRect,
  hitTestHandle,
  normalizeRect,
  type CalibrationHandle,
  type Point,
  type Rect,
} from "./gridCalibrationRect.js";

export interface AttachGridCalibrationOptions {
  canvas: FusionCanvas;
  /** PIXI container to draw into (the "controls" layer — follows the camera). */
  layer: Container;
  /** Starting box. Omitted means a square of `cellPx` at the viewport center. */
  initialRect?: Rect;
  /** Current cell size, used to size the starting box. */
  cellPx: number;
  /** Called on every change so the panel can show live numbers. */
  onChange: (rect: Rect) => void;
  /** Whether the current box would produce a usable grid — drives the color. */
  isValid?: (rect: Rect) => boolean;
}

export interface GridCalibrationHandle {
  /** The current box, normalized. */
  getRect(): Rect;
  /** Replace the box (e.g. the panel typed an exact size). */
  setRect(rect: Rect): void;
  /** Remove listeners and erase the drawing. */
  dispose(): void;
}

export function attachGridCalibration(opts: AttachGridCalibrationOptions): GridCalibrationHandle {
  const { canvas, layer, cellPx, onChange, isValid } = opts;

  const el = canvas.viewElement;
  const calibrationLayer = new GridCalibrationLayer(layer);

  let rect: Rect = opts.initialRect ?? centeredRect(canvas, cellPx);

  /** Non-null while a drag is in progress. */
  let drag: { handle: CalibrationHandle; startRect: Rect; startPoint: Point } | null = null;
  let dirty = true;

  function toScene(e: PointerEvent): Point {
    const bounds = el.getBoundingClientRect();
    return screenToWorld(e.clientX - bounds.left, e.clientY - bounds.top, canvas.camera);
  }

  function commit(next: Rect): void {
    rect = normalizeRect(next);
    dirty = true;
    onChange(rect);
  }

  // ---- DOM listeners ----

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // leave middle-button panning alone
    e.preventDefault();
    e.stopPropagation();

    const point = toScene(e);
    // Grab radius in scene units, so it stays the same size on screen at any
    // zoom — the handle must not shrink exactly when the GM zooms in to align.
    const grabbed = hitTestHandle(rect, point, HANDLE_GRAB_RADIUS / (canvas.camera.scale || 1));

    if (grabbed) {
      drag = { handle: grabbed, startRect: rect, startPoint: point };
      return;
    }

    // Pressing outside starts a brand new box from that corner.
    const fresh = { x: point.x, y: point.y, width: 0, height: 0 };
    drag = { handle: "se", startRect: fresh, startPoint: point };
    commit(fresh);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();

    const point = toScene(e);
    commit(
      applyHandleDrag(drag.startRect, drag.handle, {
        x: point.x - drag.startPoint.x,
        y: point.y - drag.startPoint.y,
      }),
    );
  };

  const onPointerUp = (): void => {
    drag = null;
  };

  // Capture phase so the tool sees the press before the token layer does.
  el.addEventListener("pointerdown", onPointerDown, { capture: true });
  el.addEventListener("pointermove", onPointerMove, { capture: true });
  window.addEventListener("pointerup", onPointerUp, { capture: true });
  window.addEventListener("pointercancel", onPointerUp, { capture: true });

  // ---- Render loop ----

  let lastScale = canvas.camera.scale;
  const disposeTicker = canvas.addTicker(() => {
    // Zoom changes the on-screen size of the strokes and handles, so a scale
    // change is as much a reason to redraw as a geometry change.
    const scale = canvas.camera.scale;
    if (!dirty && scale === lastScale) return;
    lastScale = scale;
    dirty = false;
    calibrationLayer.render(rect, scale, isValid ? isValid(rect) : true);
  });

  onChange(rect);

  return {
    getRect: () => rect,
    setRect: (next: Rect) => {
      commit(next);
    },
    dispose: () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onPointerUp, { capture: true });
      disposeTicker();
      calibrationLayer.destroy();
    },
  };
}

/** A square of `side` at the center of what the camera is currently showing. */
function centeredRect(canvas: FusionCanvas, side: number): Rect {
  const el = canvas.viewElement;
  const center = screenToWorld(el.clientWidth / 2, el.clientHeight / 2, canvas.camera);
  return defaultRect(center, side > 0 ? side : 100);
}
