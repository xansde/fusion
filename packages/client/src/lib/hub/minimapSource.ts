/**
 * minimapSource.ts — where the minimap gets its data, and when it redraws.
 *
 * Spec: `specs/32-minimapa-tatico.md` — DEC-MMT-02 (consumes the canvas's own
 * visibility, never a parallel channel), REQ-MMT-005 (shows nothing the canvas
 * does not), REQ-MMT-012 (one update cycle per frame), REQ-MMT-014 (scene swap).
 *
 * The widget reads a `MinimapSnapshot` once per animation frame and only
 * re-renders when the reading actually differs — which is what "coalescing"
 * means here: five tokens moving in the same frame produce one redraw, because
 * there is one read.
 *
 * The visible-token set comes from `TokenLayer.visibleTokenIds()` — the layer
 * that already decided what to draw. Recomputing vision here would be a second
 * visibility system, the exact failure DEC-MMT-02 forbids.
 */

import type { SceneDocument, TokenDocument } from "@fusion/shared";
import type { CameraState } from "../canvas/camera-math.js";
import type { MinimapScene, MinimapToken } from "./minimap.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Everything the widget needs, read in one go. */
export interface MinimapSnapshot {
  readonly scene: MinimapScene | null;
  /** Grid cell size in world pixels — token footprints are in cells. */
  readonly gridSize: number;
  readonly tokens: readonly MinimapToken[];
  readonly camera: CameraState;
  /** Canvas element size in screen pixels (the camera's viewport). */
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/**
 * The live wiring the widget is handed.
 *
 * Implemented in `TableScreen.svelte`, where the canvas, the token layer and
 * the active scene all already exist; the widget itself stays ignorant of PIXI.
 */
export interface MinimapSource {
  /** Read the current state. Called once per frame while the panel is open. */
  snapshot(): MinimapSnapshot;
  /**
   * Centre the camera on a world point. Camera only — never game state
   * (REQ-MMT-011).
   *
   * `animate` is the programmatic navigation of REQ-CNV-008 and is what a
   * click gets. A drag passes `false`: animating towards a target that moves
   * every frame reads as lag, not as motion.
   */
  centerOn(worldX: number, worldY: number, animate?: boolean): void;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Project the scene's tokens down to what the widget draws, keeping only the
 * ones the canvas reports as currently drawn.
 *
 * @param tokens         The scene's embedded tokens, as the client mirror has them.
 * @param visibleIds     Ids the canvas is drawing right now (hidden/out-of-vision excluded).
 * @param ownedActorIds  Actors this user explicitly owns — used for the highlight only.
 */
export function collectMinimapTokens(
  tokens: readonly TokenDocument[],
  visibleIds: ReadonlySet<string>,
  ownedActorIds: ReadonlySet<string>,
): MinimapToken[] {
  const result: MinimapToken[] = [];
  for (const token of tokens) {
    if (!visibleIds.has(token._id)) continue;
    result.push({
      id: token._id,
      name: token.name,
      x: token.x,
      y: token.y,
      width: token.width,
      height: token.height,
      disposition: token.disposition,
      hidden: token.hidden,
      controlled: token.actorId !== null && ownedActorIds.has(token.actorId),
    });
  }
  return result;
}

/** Narrow a SceneDocument down to the fields the widget draws. */
export function minimapSceneFrom(scene: SceneDocument | null): MinimapScene | null {
  if (scene === null) return null;
  return {
    width: scene.width,
    height: scene.height,
    backgroundColor: scene.backgroundColor,
    background: scene.background,
    thumb: scene.thumb,
  };
}

// ---------------------------------------------------------------------------
// Change detection (REQ-MMT-012)
// ---------------------------------------------------------------------------

/**
 * Whether a fresh reading differs from the one already on screen.
 *
 * Compares only what is drawn: any change in camera, viewport, scene geometry
 * or the token list is a redraw; anything else is not.
 */
export function snapshotChanged(previous: MinimapSnapshot | null, next: MinimapSnapshot): boolean {
  if (previous === null) return true;
  if (previous.gridSize !== next.gridSize) return true;
  if (previous.viewportWidth !== next.viewportWidth) return true;
  if (previous.viewportHeight !== next.viewportHeight) return true;
  if (!sameCamera(previous.camera, next.camera)) return true;
  if (!sameScene(previous.scene, next.scene)) return true;
  return !sameTokens(previous.tokens, next.tokens);
}

function sameCamera(a: CameraState, b: CameraState): boolean {
  return a.tx === b.tx && a.ty === b.ty && a.scale === b.scale;
}

function sameScene(a: MinimapScene | null, b: MinimapScene | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.backgroundColor === b.backgroundColor &&
    a.background === b.background &&
    a.thumb === b.thumb
  );
}

function sameTokens(a: readonly MinimapToken[], b: readonly MinimapToken[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined) return false;
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.height !== right.height ||
      left.disposition !== right.disposition ||
      left.hidden !== right.hidden ||
      left.controlled !== right.controlled
    ) {
      return false;
    }
  }
  return true;
}
