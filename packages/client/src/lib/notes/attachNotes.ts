/**
 * attachNotes.ts - the DOM/canvas adapter of the map pins.
 *
 *  - draws the active scene's pins (NoteLayer) from the document mirror;
 *  - a click on a pin opens its window (screen-space hit test, so a pin wins over
 *    the token underneath without PIXI events);
 *  - while the GM is placing a pin, the next click on the map opens the new-pin form.
 *
 * Thin plumbing over noteModel.ts / noteUi.svelte.ts, verified by using the app.
 */

import type { Container } from "pixi.js";
import type { MapNote } from "@fusion/shared";
import type { FusionCanvas } from "../canvas/FusionCanvas.js";
import { NoteLayer, PIN_RADIUS_PX } from "../canvas/NoteLayer.js";
import { screenToWorld, worldToScreen } from "../canvas/camera-math.js";
import type { DocumentMirror } from "../docs/DocumentMirror.js";
import { visibleNotes } from "./noteModel.js";
import { noteUi, openDraft, openNote, stopPlacing } from "./noteUi.svelte.js";

export interface AttachNotesOptions {
  canvas: FusionCanvas;
  layer: Container;
  mirror: DocumentMirror;
  sceneId: string;
  isGm: boolean;
}

export interface NotesHandle {
  dispose: () => void;
  /** The pin under a client point, or null. */
  pinAt: (clientX: number, clientY: number) => MapNote | null;
}

/** Max pointer travel (px) between press and release that still counts as a click. */
const CLICK_SLOP_PX = 6;

export function attachNotes(opts: AttachNotesOptions): NotesHandle {
  const { canvas, layer, mirror, sceneId, isGm } = opts;
  const noteLayer = new NoteLayer(layer);
  const el = canvas.viewElement;

  let notes: MapNote[] = [];
  let dirty = true;
  let lastScale = canvas.camera.scale;
  let lastOpen: string | null = noteUi.openId;

  function readNotes(): void {
    const scene = mirror.getDoc<Record<string, unknown>>("Scene", sceneId);
    notes = visibleNotes(scene?.["notes"], isGm);
    dirty = true;
  }
  readNotes();
  const unsubscribe = mirror.subscribe<Record<string, unknown>>("Scene", readNotes);

  function localPoint(clientX: number, clientY: number): { sx: number; sy: number } {
    const rect = el.getBoundingClientRect();
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  }

  function pinAt(clientX: number, clientY: number): MapNote | null {
    const { sx, sy } = localPoint(clientX, clientY);
    let best: MapNote | null = null;
    let bestDist = PIN_RADIUS_PX + 3;
    for (const n of notes) {
      const p = worldToScreen(n.x, n.y, canvas.camera);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  let pressed: { id: string; x: number; y: number } | null = null;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (noteUi.placing) {
      e.preventDefault();
      e.stopPropagation();
      const { sx, sy } = localPoint(e.clientX, e.clientY);
      openDraft(screenToWorld(sx, sy, canvas.camera));
      return;
    }
    const hit = pinAt(e.clientX, e.clientY);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      pressed = { id: hit.id, x: e.clientX, y: e.clientY };
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    const p = pressed;
    pressed = null;
    if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP_PX) openNote(p.id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && noteUi.placing) stopPlacing();
  };

  // Capture phase: a pin or a placing click must win over the token layer.
  el.addEventListener("pointerdown", onPointerDown, { capture: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);

  const disposeTicker = canvas.addTicker(() => {
    const scale = canvas.camera.scale;
    if (scale !== lastScale) {
      lastScale = scale;
      dirty = true;
    }
    if (noteUi.openId !== lastOpen) {
      lastOpen = noteUi.openId;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    noteLayer.render(notes, scale, noteUi.openId);
  });

  return {
    pinAt,
    dispose: () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe();
      disposeTicker();
      noteLayer.destroy();
    },
  };
}
