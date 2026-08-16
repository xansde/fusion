/**
 * scenesTabVM.ts — the view model of the "no ar" head of the Cenas tab (spec 44, §5.2).
 *
 * The head is the top of the panel, outside the scrollable area: it answers "what is
 * the table looking at right now" before "which scenes exist" (DEC-CEN-01). This module
 * is the whole projection — a pure function of (scene list, id of the scene on air) — so
 * the rule of what the head says is testable without a DOM, and the component is left
 * with markup only.
 *
 * Deliberate boundaries:
 *  - it emits i18n KEYS and vars, never sentences: the component resolves them through
 *    `lib/i18n` and the head stays translatable (REQ-CEN-011/014);
 *  - it never truncates the name. Truncation is a layout concern and belongs to CSS
 *    (REQ-CEN-013) — a VM that cut strings would lie to the `title` tooltip;
 *  - the scene on air is identified ONLY by the id the drawer hands down, which comes
 *    from the world's single source (DEC-CEN-02). The `active` field of the document is
 *    deliberately NOT consulted as a fallback: a second source of "what is on air" would
 *    diverge on the first conflicting write;
 *  - it resolves no asset URL. `/assets/*` needs a freshly minted query-token, which is
 *    async and session-bound, so it stays in the component (`resolveAssetUrl`).
 */

import type { SceneDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Theme contract
// ---------------------------------------------------------------------------

/**
 * The theme token that fixes the head's height (REQ-CEN-010). Nothing inside the head
 * — a long name, the environment row, a missing image — may change it (REQ-CEN-013),
 * so the height has exactly one definition and it lives in the theme.
 */
export const SCENE_HEAD_HEIGHT_TOKEN = "--fusion-scene-head-height";

/**
 * The `sizes` hint handed to the head's background image (RNF-CEN-02).
 *
 * The head is drawn inside the drawer, whose width is one fixed value for every tab
 * (`--fusion-sidebar-width`, 300px — REQ-GAV-012). An HTML `sizes` attribute cannot read
 * a CSS custom property, so the value is repeated here on purpose: it tells the browser
 * the box is drawer-wide and lets it pick the smallest candidate a responsive source
 * offers, instead of assuming the viewport and pulling the full-resolution map.
 */
export const SCENE_HEAD_IMAGE_SIZES = "300px";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A message the component resolves through `t()` — key plus interpolation vars. */
export interface SceneHeadLine {
  readonly key: string;
  readonly vars?: Readonly<Record<string, string | number>>;
}

/**
 * What the head paints behind the identification.
 *
 * `color` is present in BOTH variants on purpose: it is the scene's own background
 * colour, painted under the image as well, so the box keeps its height and never
 * flashes empty while the image is still being fetched (REQ-CEN-012, REQ-CEN-013).
 */
export type SceneHeadBackgroundVM =
  | {
      readonly kind: "image";
      /** Raw path/URL as stored in the document — the component resolves it. */
      readonly src: string;
      /**
       * Which field the src came from. `thumb` is preferred when the world has one
       * because it is the smaller asset (RNF-CEN-02); nothing fills it today, and
       * generating one is canvas work, not UI work (DEC-CEN-04).
       */
      readonly source: "thumb" | "background";
      /** `sizes` hint for the browser (RNF-CEN-02). */
      readonly sizes: string;
      readonly color: string;
    }
  | { readonly kind: "color"; readonly color: string };

/** The head while a scene is on air (REQ-CEN-011). */
export interface SceneHeadOnAirVM {
  readonly kind: "on-air";
  readonly sceneId: string;
  /** Untruncated scene name — the component ellipsises it in CSS (REQ-CEN-013). */
  readonly name: string;
  readonly dimensions: SceneHeadLine;
  readonly grid: SceneHeadLine;
  readonly background: SceneHeadBackgroundVM;
}

/** The head when nothing is on air (REQ-CEN-014). */
export interface SceneHeadEmptyVM {
  readonly kind: "empty";
  readonly title: SceneHeadLine;
  /** Says, in so many words, that the players are sitting on the waiting screen. */
  readonly notice: SceneHeadLine;
  /**
   * The offer to put a scene on air, or `null` when the world has no scene at all —
   * there is nothing to offer yet, and the archive below already invites creating the
   * first one (REQ-CEN-080).
   */
  readonly action: SceneHeadLine | null;
}

/**
 * The world says a scene is on air but this client has not received it yet (a snapshot
 * still in flight). Saying "nothing is on air" here would be a lie, so the head says it
 * is waiting — at the same height as every other state.
 */
export interface SceneHeadPendingVM {
  readonly kind: "pending";
  readonly title: SceneHeadLine;
}

export type SceneHeadVM = SceneHeadOnAirVM | SceneHeadEmptyVM | SceneHeadPendingVM;

/** Everything the head is a function of (REQ-CEN-015: recompute, never reload). */
export interface SceneHeadInput {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string | null;
}

// ---------------------------------------------------------------------------
// i18n keys
// ---------------------------------------------------------------------------

export const SCENE_HEAD_KEYS = {
  dimensions: "FUSION.Scene.Head.Dimensions",
  gridSquare: "FUSION.Scene.Head.GridSquare",
  gridHex: "FUSION.Scene.Head.GridHex",
  gridNone: "FUSION.Scene.Head.GridNone",
  empty: "FUSION.Scene.Head.Empty",
  emptyNotice: "FUSION.Scene.Head.EmptyNotice",
  chooseScene: "FUSION.Scene.Head.ChooseScene",
  pending: "FUSION.Scene.Head.Pending",
} as const;

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const DEFAULT_BACKGROUND_COLOR = "#000000";

function usableSource(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Dimensions line: the scene's pixel size (REQ-CEN-011). */
function dimensionsLine(scene: SceneDocument): SceneHeadLine {
  return {
    key: SCENE_HEAD_KEYS.dimensions,
    vars: { width: scene.width, height: scene.height },
  };
}

/** Grid line: kind plus cell size, or the honest "no grid" (REQ-CEN-011). */
function gridLine(scene: SceneDocument): SceneHeadLine {
  const grid = scene.grid as { type?: string; size?: number } | undefined;
  const type = grid?.type ?? "square";
  if (type === "gridless") return { key: SCENE_HEAD_KEYS.gridNone };
  const size = grid?.size ?? 0;
  return {
    key: type === "hex" ? SCENE_HEAD_KEYS.gridHex : SCENE_HEAD_KEYS.gridSquare,
    vars: { size },
  };
}

/**
 * The background of the head (REQ-CEN-011, REQ-CEN-012, RNF-CEN-02).
 *
 * A scene without a background image is NOT a hole: it paints its own background
 * colour, and the head keeps exactly the same height it had with an image.
 */
function backgroundOf(scene: SceneDocument): SceneHeadBackgroundVM {
  const color = usableSource(scene.backgroundColor) ?? DEFAULT_BACKGROUND_COLOR;
  const thumb = usableSource(scene.thumb);
  const background = usableSource(scene.background);
  const src = thumb ?? background;
  if (src === null) return { kind: "color", color };
  return {
    kind: "image",
    src,
    source: thumb === null ? "background" : "thumb",
    sizes: SCENE_HEAD_IMAGE_SIZES,
    color,
  };
}

/**
 * Project the head of the Cenas tab.
 *
 * Pure: the same input always yields the same head, and a change of `activeSceneId`
 * from any origin (this GM, another GM, a resync) is a recompute, not a reload
 * (REQ-CEN-015).
 */
export function buildSceneHeadVM(input: SceneHeadInput): SceneHeadVM {
  const { scenes, activeSceneId } = input;

  if (activeSceneId === null || activeSceneId === "") {
    return {
      kind: "empty",
      title: { key: SCENE_HEAD_KEYS.empty },
      notice: { key: SCENE_HEAD_KEYS.emptyNotice },
      action: scenes.length > 0 ? { key: SCENE_HEAD_KEYS.chooseScene } : null,
    };
  }

  const scene = scenes.find((candidate) => candidate._id === activeSceneId);
  if (scene === undefined) {
    return { kind: "pending", title: { key: SCENE_HEAD_KEYS.pending } };
  }

  return {
    kind: "on-air",
    sceneId: scene._id,
    name: scene.name,
    dimensions: dimensionsLine(scene),
    grid: gridLine(scene),
    background: backgroundOf(scene),
  };
}
