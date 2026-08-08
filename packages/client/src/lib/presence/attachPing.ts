/**
 * attachPing.ts — the DOM adapter that makes the map ping reachable by a human.
 *
 * Spec: 04-rede-e-sincronizacao.md (presence:ping ephemeral, REQ-NET-041)
 * Spec: 06-canvas-e-renderizacao.md (ephemeral canvas overlays)
 *
 * Same story as the ruler, one release later: presence:ping had a protocol
 * type, a validated server handler with its own rate limiter, an emitPing()
 * and an addPing() store — and emitPing() had zero callers, so no ping was
 * ever sent, which is also why the receive path never ran. This wires the
 * gesture (press and hold) to the emitter and the store to the renderer.
 *
 * Deliberately thin: the rules of the gesture live in pingGesture.ts and the
 * animation curve in PingLayer.ts, both pure and tested. What is here is DOM
 * plumbing, verified by using the app.
 */

import type { Container } from "pixi.js";
import type { Socket } from "socket.io-client";
import type { FusionCanvas } from "../canvas/FusionCanvas.js";
import { PingLayer } from "../canvas/PingLayer.js";
import { screenToWorld } from "../canvas/camera-math.js";
import { PingGesture } from "./pingGesture.js";
import { emitPing } from "./attachPresenceSync.js";
import { presenceState, addPing } from "./presenceStore.svelte.js";

export interface AttachPingOptions {
  /** The canvas — supplies the camera, the DOM element and the ticker. */
  canvas: FusionCanvas;
  /** PIXI container to draw into (the "controls" layer — follows the camera). */
  layer: Container;
  /** Socket for broadcasting. Null keeps the ping local to this client. */
  socket: Socket | null;
  /** Cell size in px — the ripple is scaled to the grid so it reads the same on any map. */
  cellPx?: number;
  /** This client's user id, used only for the local echo when there is no socket. */
  userId?: string;
}

/**
 * Wire press-and-hold to the map ping.
 *
 * @returns A disposer that removes every listener and destroys the drawing.
 */
export function attachPing(opts: AttachPingOptions): () => void {
  const { canvas, layer, socket, cellPx, userId } = opts;

  const gesture = new PingGesture();
  const pingLayer = new PingLayer(layer, cellPx ?? 100);
  const el = canvas.viewElement;

  function toScene(e: PointerEvent): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    // Deliberately NOT snapped to the grid: a ping marks a spot the eye picked
    // ("look at this door"), not a cell a token could stand on.
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, canvas.camera);
  }

  /** Swallow exactly one upcoming click so the ping does not also act on a token. */
  function suppressNextClick(): void {
    const swallow = (ev: Event): void => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    el.addEventListener("click", swallow, { capture: true, once: true });
    // A hold that ends outside the element produces no click at all; drop the
    // listener on the next frame so it cannot eat an unrelated click later.
    requestAnimationFrame(() => {
      el.removeEventListener("click", swallow, { capture: true });
    });
  }

  function fire(point: { x: number; y: number }): void {
    if (socket?.connected) {
      // The server echoes the ping back to its sender (ephemeral-handlers
      // broadcasts to the room INCLUDING the socket that sent it), so adding
      // it locally as well would draw the same ripple twice.
      emitPing(socket, point.x, point.y);
    } else if (userId != null) {
      addPing({ userId, x: point.x, y: point.y });
    }
  }

  // ---- DOM listeners ----

  const onPointerDown = (e: PointerEvent): void => {
    gesture.handle({ kind: "pointer-down", point: toScene(e), button: e.button, time: Date.now() });
  };

  const onPointerMove = (e: PointerEvent): void => {
    gesture.handle({ kind: "pointer-move", point: toScene(e), time: Date.now() });
  };

  const onPointerUp = (): void => {
    const effect = gesture.handle({ kind: "pointer-up", time: Date.now() });
    if (effect.kind === "suppress-click") suppressNextClick();
  };

  const onCancel = (): void => {
    gesture.handle({ kind: "cancel" });
  };

  // Listen on the window for the end of the gesture: a pointer released
  // outside the canvas must still close the hold, or the next press would
  // start from a stale state.
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onCancel);

  // ---- Ripen + render loop ----

  const disposeTicker = canvas.addTicker(() => {
    if (gesture.isActive) {
      const effect = gesture.handle({ kind: "tick", time: Date.now() });
      if (effect.kind === "ping") fire(effect.point);
    }

    // Skip the redraw only when there is nothing live AND nothing left over
    // from the previous frame to clear.
    if (presenceState.pings.length === 0 && pingLayer.isEmpty) return;
    pingLayer.render(presenceState.pings, Date.now());
  });

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onCancel);
    disposeTicker();
    pingLayer.destroy();
  };
}
