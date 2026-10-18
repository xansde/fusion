/**
 * attachRuler.ts — the DOM adapter that makes the measuring tools reachable.
 *
 * Spec: 06-canvas-e-renderizacao.md (ruler with grid measurement)
 * Spec: 04-rede-e-sincronizacao.md (presence:ruler / presence:template)
 *
 * Four things live here, all thin plumbing over pure, tested modules:
 *  - the ruler: hold R, or the toolbar tool and drag (rulerGesture.ts);
 *  - area templates: burst / cone / line / emanation, press-drag-release, Shift on
 *    release pins (templateTool.ts, shared/grid/templates.ts);
 *  - the drag ruler: path + colour while a token is dragged (dragRuler.ts), fed by
 *    TokenInteractionManager through the returned `showDrag`;
 *  - drawing and sharing all of the above (RulerLayer, presence emitters).
 */

import type { Container } from "pixi.js";
import type { Socket } from "socket.io-client";
import {
  SquareGrid,
  targetsInCells,
  templateCells,
  type AreaFootprint,
  type AreaTarget,
  type AreaTemplate,
  type GridStrategy,
  type CellOffset,
  type ScenePoint,
} from "@fusion/shared";
import type { FusionCanvas } from "../canvas/FusionCanvas.js";
import { RulerLayer, AREA_COLORS, type AreaDraw } from "../canvas/RulerLayer.js";
import { screenToWorld } from "../canvas/camera-math.js";
import { RulerStateMachine } from "./rulerState.js";
import {
  reduceRulerInput,
  reduceRulerToolInput,
  isEditableTarget,
  type RulerEffect,
  type RulerInput,
} from "./rulerGesture.js";
import { rulerTool, setRulerTool, stepAreaSize } from "./rulerToolStore.svelte.js";
import {
  emitRulerUpdate,
  emitRulerClear,
  emitTemplateUpdate,
  emitTemplateClear,
  emitTemplatePin,
  emitTemplateUnpin,
  emitTemplateSync,
} from "./attachPresenceSync.js";
import { presenceState } from "./presenceStore.svelte.js";
import { areaLabel, buildAreaTemplate, isAreaMode } from "./templateTool.js";
import { buildDragRuler, type DragRulerView } from "./dragRuler.js";

/** How often ruler waypoints and templates are broadcast while dragging (ms). */
const BROADCAST_INTERVAL_MS = 100;

/** A token drag in progress, as reported by TokenInteractionManager. */
export interface TokenDragInfo {
  /** Token top-left before the drag, scene pixels. */
  readonly from: ScenePoint;
  /** Token top-left now (snapped), scene pixels. */
  readonly to: ScenePoint;
  /** The actor Speed in feet, for the colour. */
  readonly speedFt: number;
}

export interface AttachRulerOptions {
  /** The canvas — supplies the camera, the DOM element and the ticker. */
  canvas: FusionCanvas;
  /** The active scene's grid: snapping and distance both come from it. */
  grid: GridStrategy;
  /** PIXI container to draw into (the "controls" layer — follows the camera). */
  layer: Container;
  /** Socket for broadcasting to other players. Null disables broadcasting. */
  socket: Socket | null;
  /** The scene being drawn: scopes pinned templates. */
  sceneId: string;
  /** The local user: their own broadcasts echo back and must not be drawn twice. */
  selfUserId: string;
  /** The squares of the selected token (the source of an emanation), or null. */
  getSource?: () => AreaFootprint | null;
  /** Every token on the scene, to name who a template touches. */
  getTargets?: () => AreaTarget[];
}

export interface RulerHandle {
  dispose: () => void;
  /** Report a token drag (null when it ended or was cancelled). */
  showDrag: (info: TokenDragInfo | null) => void;
}

function newId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Wire the measuring tools to the keyboard and pointer.
 *
 * @returns A handle: `dispose` removes every listener and destroys the drawing.
 */
export function attachRuler(opts: AttachRulerOptions): RulerHandle {
  const { canvas, grid, layer, socket, sceneId, selfUserId } = opts;
  const square = grid instanceof SquareGrid ? grid : null;
  const cellSize = grid.config.size;

  const ruler = new RulerStateMachine(grid);
  const rulerLayer = new RulerLayer(layer, grid);
  const el = canvas.viewElement;

  /** Last known cursor position in scene coordinates, snapped to a cell centre. */
  let cursor: ScenePoint | null = null;
  /** Last known cursor position, unsnapped. */
  let rawCursor: ScenePoint | null = null;
  let measuring = false;
  /** True while a drag started by the toolbar ruler tool is in progress. */
  let toolDragging = false;
  let lastBroadcast = 0;
  let dirty = true;
  let hadAny = false;

  // Area template being aimed by the local user.
  let tplPress: ScenePoint | null = null;
  let tpl: AreaTemplate | null = null;
  let tplBroadcast = 0;

  // Token drag ruler.
  let dragInfo: TokenDragInfo | null = null;
  let dragWaypoints: ScenePoint[] = [];

  const cellsCache = new Map<string, CellOffset[]>();

  function toRaw(e: PointerEvent | MouseEvent): ScenePoint {
    const rect = el.getBoundingClientRect();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, canvas.camera);
  }

  function toScene(e: PointerEvent): ScenePoint {
    // Snap to cell centers so the reading is cell-to-cell, matching how tokens
    // move. Without this the ruler reports the distance between two arbitrary
    // pixels and the diagonal rule becomes impossible to read.
    return grid.getSnappedPoint(toRaw(e), "center");
  }

  // ---- Ruler ----

  function apply(input: RulerInput): void {
    run(reduceRulerInput(measuring, input, cursor));
  }

  function run(effect: RulerEffect): void {
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
        toolDragging = false;
        emitRulerClear(socket);
        lastBroadcast = 0;
        break;
    }
    dirty = true;
  }

  // ---- Area templates ----

  function rebuildTemplate(): void {
    if (!square || !tplPress || !rawCursor || !isAreaMode(rulerTool.mode)) return;
    tpl = buildAreaTemplate(
      rulerTool.mode,
      rulerTool.sizeFt,
      tplPress,
      rawCursor,
      square,
      opts.getSource?.() ?? null,
    );
    dirty = true;
  }

  function endTemplate(pin: boolean): void {
    if (pin && tpl) emitTemplatePin(socket, newId(), sceneId, tpl);
    tpl = null;
    tplPress = null;
    emitTemplateClear(socket);
    tplBroadcast = 0;
    dirty = true;
  }

  function cellsOf(t: AreaTemplate): CellOffset[] {
    if (!square) return [];
    const key = JSON.stringify(t);
    let cells = cellsCache.get(key);
    if (!cells) {
      cells = templateCells(t, square);
      if (cellsCache.size > 200) cellsCache.clear();
      cellsCache.set(key, cells);
    }
    return cells;
  }

  function areaDraw(t: AreaTemplate, color: number, owner?: string): AreaDraw {
    const cells = cellsOf(t);
    const names = targetsInCells(cells, opts.getTargets?.() ?? []);
    const title = areaLabel(t, names);
    const rad = (t.direction * Math.PI) / 180;
    const len = (t.sizeFt / grid.config.distance) * cellSize;
    const axis =
      t.kind === "cone" || t.kind === "line"
        ? { x: t.origin.x + Math.cos(rad) * len, y: t.origin.y + Math.sin(rad) * len }
        : undefined;
    return {
      cells,
      color,
      label: owner ? `${owner} · ${title}` : title,
      origin: t.origin,
      ...(axis ? { axisTo: axis } : {}),
    };
  }

  /** Pinned template of this scene whose squares contain the cursor, if any. */
  function pinnedUnderCursor(): string | null {
    if (!rawCursor) return null;
    const cell = grid.pixelToCell(rawCursor);
    for (const pin of presenceState.pinnedTemplates.values()) {
      if (pin.sceneId !== sceneId) continue;
      if (cellsOf(pin.template).some((c) => c.i === cell.i && c.j === cell.j)) return pin.id;
    }
    return null;
  }

  function removePinnedAtCursor(): boolean {
    const id = pinnedUnderCursor();
    if (!id) return false;
    emitTemplateUnpin(socket, id, sceneId);
    return true;
  }

  // ---- Token drag ruler ----

  function refPoint(topLeft: ScenePoint): ScenePoint {
    return { x: topLeft.x + cellSize / 2, y: topLeft.y + cellSize / 2 };
  }

  function dragView(): DragRulerView | null {
    if (!dragInfo) return null;
    const path = [refPoint(dragInfo.from), ...dragWaypoints, refPoint(dragInfo.to)];
    return buildDragRuler(grid, path, dragInfo.speedFt);
  }

  // ---- DOM listeners ----

  const editable = (e: KeyboardEvent): boolean => {
    const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    return isEditableTarget(target?.tagName ?? null, target?.isContentEditable === true);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (tplPress) endTemplate(false);
      else if (!measuring && rulerTool.mode !== null) setRulerTool(null);
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !editable(e) && removePinnedAtCursor()) {
      e.preventDefault();
    }
    // Ctrl during a token drag commits a waypoint of the movement path.
    if (e.key === "Control" && !e.repeat && dragInfo) {
      const here = refPoint(dragInfo.to);
      const last = dragWaypoints.at(-1) ?? refPoint(dragInfo.from);
      if (here.x !== last.x || here.y !== last.y) {
        dragWaypoints = [...dragWaypoints, here];
        dirty = true;
      }
    }
    apply({ kind: "key-down", key: e.key, inEditable: editable(e), repeat: e.repeat });
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    apply({ kind: "key-up", key: e.key });
  };

  const onPointerMove = (e: PointerEvent): void => {
    rawCursor = toRaw(e);
    cursor = grid.getSnappedPoint(rawCursor, "center");
    apply({ kind: "pointer-move", point: cursor });
    if (tplPress) rebuildTemplate();
  };

  const onPointerDown = (e: PointerEvent): void => {
    rawCursor = toRaw(e);
    cursor = grid.getSnappedPoint(rawCursor, "center");

    // Area tool: press anchors the template. Swallowed so the press neither pans,
    // selects nor drags a token underneath.
    if (isAreaMode(rulerTool.mode) && e.button === 0 && !measuring && !tplPress) {
      e.preventDefault();
      e.stopPropagation();
      tplPress = rawCursor;
      rebuildTemplate();
      return;
    }

    // Toolbar ruler: a plain press starts a drag measurement.
    if (rulerTool.mode === "ruler" && e.button === 0 && !measuring) {
      const effect = reduceRulerToolInput(true, toolDragging, { kind: "down", point: cursor });
      if (effect.kind === "start") {
        e.preventDefault();
        e.stopPropagation();
        toolDragging = true;
        run(effect);
        return;
      }
    }

    // Only intercept while measuring — otherwise this would swallow the click
    // that selects or drags a token.
    if (!measuring) return;
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
    }
    apply({ kind: "pointer-down", point: cursor, ctrl: e.ctrlKey });
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (tplPress) endTemplate(e.shiftKey);
    run(reduceRulerToolInput(rulerTool.mode === "ruler", toolDragging, { kind: "up" }));
  };

  const onWheel = (e: WheelEvent): void => {
    // Only while aiming a template: the wheel resizes it in steps of 5 ft.
    // Otherwise it keeps zooming the map.
    if (!tplPress) return;
    e.preventDefault();
    e.stopPropagation();
    stepAreaSize(e.deltaY < 0 ? 1 : -1);
    rebuildTemplate();
  };

  const onContextMenu = (e: MouseEvent): void => {
    rawCursor = toRaw(e);
    if (removePinnedAtCursor()) e.preventDefault();
  };

  const onBlur = (): void => {
    apply({ kind: "blur" });
    if (tplPress) endTemplate(false);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("contextmenu", onContextMenu);
  // Capture phase: the tools must see the press before the token layer does.
  el.addEventListener("pointerdown", onPointerDown, { capture: true });
  el.addEventListener("wheel", onWheel, { capture: true, passive: false });

  emitTemplateSync(socket, sceneId);

  // ---- Render + broadcast loop ----

  const disposeTicker = canvas.addTicker(() => {
    // Crosshair while a tool is on; FusionCanvas only touches this style while panning.
    const wanted = rulerTool.mode !== null ? "crosshair" : "";
    if (el.style.cursor !== wanted && (wanted !== "" || el.style.cursor === "crosshair")) {
      el.style.cursor = wanted;
    }

    const pinned = [...presenceState.pinnedTemplates.values()].filter((p) => p.sceneId === sceneId);
    const remoteTpls = [...presenceState.remoteTemplates.values()].filter(
      (r) => r.userId !== selfUserId,
    );
    const remoteRulers = [...presenceState.remoteRulers.values()].filter(
      (r) => r.userId !== selfUserId,
    );
    const hasAny =
      measuring ||
      tpl !== null ||
      dragInfo !== null ||
      pinned.length > 0 ||
      remoteTpls.length > 0 ||
      remoteRulers.length > 0;
    // Something that just disappeared still has to be erased once.
    if (!dirty && !hasAny && !hadAny) return;
    hadAny = hasAny;

    const areas: AreaDraw[] = [];
    for (const p of pinned) areas.push(areaDraw(p.template, AREA_COLORS.pinned, p.userName));
    for (const r of remoteTpls) areas.push(areaDraw(r.template, AREA_COLORS.remote, r.userName));
    if (tpl) areas.push(areaDraw(tpl, AREA_COLORS.local));

    const snapshot = measuring ? ruler.snapshot() : null;
    rulerLayer.render(snapshot, remoteRulers, areas, dragView());
    dirty = false;

    const now = Date.now();
    if (measuring && socket && now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
      emitRulerUpdate(socket, ruler.broadcastWaypoints());
      lastBroadcast = now;
    }
    if (tpl && socket && now - tplBroadcast >= BROADCAST_INTERVAL_MS) {
      emitTemplateUpdate(socket, tpl);
      tplBroadcast = now;
    }
  });

  return {
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.style.cursor = "";
      disposeTicker();
      if (measuring) emitRulerClear(socket);
      if (tpl) emitTemplateClear(socket);
      rulerLayer.destroy();
    },
    showDrag: (info) => {
      if (!info) dragWaypoints = [];
      dragInfo = info;
      dirty = true;
    },
  };
}
