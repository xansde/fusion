/**
 * attachRuler.ts — the DOM adapter that makes the ruler reachable by a human.
 *
 * Spec: 06-canvas-e-renderizacao.md (ruler with grid measurement)
 * Spec: 04-rede-e-sincronizacao.md (presence:ruler / presence:ruler:clear)
 *
 * This is the piece that was missing. RulerStateMachine (what the ruler shows),
 * rulerGesture (what the user did), RulerLayer (how it draws) and
 * emitRulerUpdate (how it travels) all existed or are pure modules with their
 * own tests. Nothing connected them to a keyboard and a pointer, so no ruler
 * could ever be started — and, because none was ever started, none was ever
 * broadcast either, which is why the remote-ruler receive path also never ran.
 *
 * Deliberately thin: every rule lives in rulerGesture.ts, which is testable
 * under the node environment. What is here is DOM plumbing, and it is verified
 * by using the app.
 */

import type { Container } from "pixi.js";
import type { Socket } from "socket.io-client";
import type { GridStrategy } from "@fusion/shared";
import type { FusionCanvas } from "../canvas/FusionCanvas.js";
import { RulerLayer } from "../canvas/RulerLayer.js";
import { screenToWorld } from "../canvas/camera-math.js";
import { RulerStateMachine } from "./rulerState.js";
import { reduceRulerInput, isEditableTarget, type RulerInput } from "./rulerGesture.js";
import { emitRulerUpdate, emitRulerClear } from "./attachPresenceSync.js";
import { presenceState } from "./presenceStore.svelte.js";

/** How often ruler waypoints are broadcast while dragging (ms). */
const BROADCAST_INTERVAL_MS = 100;

export interface AttachRulerOptions {
  /** The canvas — supplies the camera, the DOM element and the ticker. */
  canvas: FusionCanvas;
  /** The active scene's grid: snapping and distance both come from it. */
  grid: GridStrategy;
  /** PIXI container to draw into (the "controls" layer — follows the camera). */
  layer: Container;
  /** Socket for broadcasting to other players. Null disables broadcasting. */
  socket: Socket | null;
}

/**
 * Wire the ruler to the keyboard and pointer.
 *
 * @returns A disposer that removes every listener and destroys the drawing.
 */
export function attachRuler(opts: AttachRulerOptions): () => void {
  const { canvas, grid, layer, socket } = opts;

  const ruler = new RulerStateMachine(grid);
  const rulerLayer = new RulerLayer(layer);
  const el = canvas.viewElement;

  /** Last known cursor position in scene coordinates. */
  let cursor: { x: number; y: number } | null = null;
  let measuring = false;
  let lastBroadcast = 0;
  let dirty = true;

  function toScene(e: PointerEvent): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, canvas.camera);
    // Snap to cell centers so the reading is cell-to-cell, matching how tokens
    // move. Without this the ruler reports the distance between two arbitrary
    // pixels and the diagonal rule becomes impossible to read.
    return grid.getSnappedPoint(world, "center");
  }

  function apply(input: RulerInput): void {
    const effect = reduceRulerInput(measuring, input, cursor);
    switch (effect.kind) {
      case "none":
        return;
      case "start":
        ruler.startMeasuring(effect.origin);
        measuring = true;
        break;
      case "live":
        ruler.updateLive(effect.point);
        break;
      case "waypoint":
        ruler.addWaypoint(effect.point);
        break;
      case "clear":
        ruler.clear();
        measuring = false;
        emitRulerClear(socket);
        lastBroadcast = 0;
        break;
    }
    dirty = true;
  }

  // ---- DOM listeners ----

  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    apply({
      kind: "key-down",
      key: e.key,
      inEditable: isEditableTarget(target?.tagName ?? null, target?.isContentEditable === true),
      repeat: e.repeat,
    });
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    apply({ kind: "key-up", key: e.key });
  };

  const onPointerMove = (e: PointerEvent): void => {
    cursor = toScene(e);
    apply({ kind: "pointer-move", point: cursor });
  };

  const onPointerDown = (e: PointerEvent): void => {
    // Only intercept while measuring — otherwise this would swallow the click
    // that selects or drags a token.
    if (!measuring) return;
    const point = toScene(e);
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
    }
    apply({ kind: "pointer-down", point, ctrl: e.ctrlKey });
  };

  const onBlur = (): void => {
    apply({ kind: "blur" });
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  el.addEventListener("pointermove", onPointerMove);
  // Capture phase: the ruler must see Ctrl+click before the token layer does.
  el.addEventListener("pointerdown", onPointerDown, { capture: true });

  // ---- Render + broadcast loop ----

  const disposeTicker = canvas.addTicker(() => {
    const hasRemotes = presenceState.remoteRulers.size > 0;
    if (!dirty && !hasRemotes && !measuring) return;

    const snapshot = measuring ? ruler.snapshot() : null;
    rulerLayer.render(snapshot, presenceState.remoteRulers.values());
    dirty = false;

    if (measuring && socket) {
      const now = Date.now();
      if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
        emitRulerUpdate(socket, ruler.broadcastWaypoints());
        lastBroadcast = now;
      }
    }
  });

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerdown", onPointerDown, { capture: true });
    disposeTicker();
    if (measuring) emitRulerClear(socket);
    rulerLayer.destroy();
  };
}
