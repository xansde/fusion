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
import {
  rulerTool,
  setRulerTool,
  stepAreaSize,
  openTemplateMenu,
  closeTemplateMenu,
} from "./rulerToolStore.svelte.js";
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
import { noteUi } from "../notes/noteUi.svelte.js";
import {
  areaLabel,
  buildAreaTemplate,
  emanationForToken,
  isAreaMode,
  resolvePinned,
} from "./templateTool.js";
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

/** A token as the emanation tool sees it. */
export interface TokenRef {
  readonly id: string;
  readonly footprint: AreaFootprint;
}

/** How long a pinned template may point at a missing token before it is dropped (ms). */
const ORPHAN_GRACE_MS = 3000;

function cssToNumber(css: string | undefined, fallback: number): number {
  if (css === undefined) return fallback;
  const n = Number.parseInt(css.replace(/^#/, ""), 16);
  return Number.isFinite(n) ? n : fallback;
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
  /** The selected token (the source of an emanation), or null. */
  getSelectedToken?: () => TokenRef | null;
  /** The token under a scene point, or null. */
  getTokenAt?: (p: ScenePoint) => TokenRef | null;
  /** Current squares of a token (live: drag, remote preview, document), null if it is gone. */
  getTokenFootprint?: (tokenId: string) => AreaFootprint | null;
  /** True for a GM/assistant: may restyle and remove templates of others. */
  isModerator?: boolean;
  /** Every token on the scene, to name who a template touches. */
  getTargets?: () => AreaTarget[];
}

export interface RulerHandle {
  dispose: () => void;
  /** True while a measuring tool owns the left button (ruler, template, token drag). */
  isBusy: () => boolean;
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
  let lastViewScale = canvas.camera.scale;

  // Area template being aimed by the local user.
  let tplPress: ScenePoint | null = null;
  let tpl: AreaTemplate | null = null;
  let tplBroadcast = 0;
  /** Pinned templates whose token is missing: id -> when it was first seen missing. */
  const orphans = new Map<string, number>();

  // Token drag ruler.
  let dragInfo: TokenDragInfo | null = null;
  let dragWaypoints: ScenePoint[] = [];

  const cellsCache = new Map<string, CellOffset[]>();

  function toRaw(e: PointerEvent | MouseEvent): ScenePoint {
    const rect = el.getBoundingClientRect();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, canvas.camera);
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
    const selected = opts.getSelectedToken?.() ?? null;
    const built = buildAreaTemplate(
      rulerTool.mode,
      rulerTool.sizeFt,
      tplPress,
      rawCursor,
      square,
      selected?.footprint ?? null,
    );
    tpl = built
      ? {
          ...built,
          style: { ...rulerTool.style },
          ...(built.kind === "emanation" && selected ? { tokenId: selected.id } : {}),
        }
      : null;
    dirty = true;
  }

  /** One click (or Enter) on a token: its emanation, pinned and anchored to it. */
  function pinEmanationOf(token: TokenRef): void {
    if (!square) return;
    emitTemplatePin(
      socket,
      newId(),
      sceneId,
      emanationForToken(rulerTool.sizeFt, token.id, token.footprint, square, {
        ...rulerTool.style,
      }),
    );
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

  /** Pinned templates of this scene as they must be drawn NOW (anchored ones follow their token). */
  function livePinned(): Array<{
    id: string;
    userId: string;
    userName?: string;
    template: AreaTemplate;
  }> {
    const out: Array<{ id: string; userId: string; userName?: string; template: AreaTemplate }> =
      [];
    const now = Date.now();
    for (const pin of presenceState.pinnedTemplates.values()) {
      if (pin.sceneId !== sceneId) continue;
      const resolved = square
        ? resolvePinned(pin.template, (id) => opts.getTokenFootprint?.(id) ?? null, square)
        : pin.template;
      if (!resolved) {
        const since = orphans.get(pin.id) ?? now;
        orphans.set(pin.id, since);
        // The token is gone: the area goes with it. Its author (or the GM) tells the server.
        if (
          now - since > ORPHAN_GRACE_MS &&
          (pin.userId === selfUserId || opts.isModerator === true)
        ) {
          orphans.delete(pin.id);
          emitTemplateUnpin(socket, pin.id, sceneId);
        }
        continue;
      }
      orphans.delete(pin.id);
      out.push({
        id: pin.id,
        userId: pin.userId,
        ...(pin.userName !== undefined ? { userName: pin.userName } : {}),
        template: resolved,
      });
    }
    return out;
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
      ...(t.style ? { style: t.style } : {}),
      ...(axis ? { axisTo: axis } : {}),
    };
  }

  /** Pinned template of this scene whose squares contain the cursor, if any. */
  function pinnedUnderCursor(): string | null {
    if (!rawCursor) return null;
    const cell = grid.pixelToCell(rawCursor);
    for (const pin of livePinned()) {
      if (cellsOf(pin.template).some((c) => c.i === cell.i && c.j === cell.j)) return pin.id;
    }
    return null;
  }

  function pinOwnerOf(id: string): string | undefined {
    return presenceState.pinnedTemplates.get(id)?.userId;
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
      closeTemplateMenu();
      if (tplPress) endTemplate(false);
      else if (!measuring && rulerTool.mode !== null) setRulerTool(null);
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !editable(e) && removePinnedAtCursor()) {
      e.preventDefault();
    }
    // Enter with the emanation tool: the emanation of the selected token, no dragging.
    if (
      e.key === "Enter" &&
      !e.repeat &&
      !editable(e) &&
      rulerTool.mode === "emanation" &&
      !tplPress
    ) {
      const selected = opts.getSelectedToken?.() ?? null;
      if (selected) {
        e.preventDefault();
        pinEmanationOf(selected);
      }
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
      closeTemplateMenu();
      if (rulerTool.mode === "emanation") {
        // A click on a token is the whole gesture: its emanation, pinned to it.
        const hit = opts.getTokenAt?.(rawCursor) ?? null;
        if (hit) {
          pinEmanationOf(hit);
          return;
        }
        // Nothing selected and nothing hit: there is nothing to aim from.
        if (!opts.getSelectedToken?.()) return;
      }
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
    const id = pinnedUnderCursor();
    if (!id) return;
    e.preventDefault();
    // Only the author or a GM can change it; for anyone else the menu is just noise.
    if (pinOwnerOf(id) === selfUserId || opts.isModerator === true) {
      openTemplateMenu(id, e.clientX, e.clientY);
    }
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
    const wanted = rulerTool.mode !== null || noteUi.placing ? "crosshair" : "";
    if (el.style.cursor !== wanted && (wanted !== "" || el.style.cursor === "crosshair")) {
      el.style.cursor = wanted;
    }

    const pinned = livePinned();
    const remoteTpls = [...presenceState.remoteTemplates.values()].filter(
      (r) => r.userId !== selfUserId,
    );
    const remoteRulers = [...presenceState.remoteRulers.values()].filter(
      (r) => r.userId !== selfUserId,
    );
    const hasAny =
      rulerTool.mode === "emanation" ||
      measuring ||
      tpl !== null ||
      dragInfo !== null ||
      pinned.length > 0 ||
      remoteTpls.length > 0 ||
      remoteRulers.length > 0;
    // Labels are counter-scaled against the zoom, so a zoom change redraws them.
    const viewScale = canvas.camera.scale;
    if (viewScale !== lastViewScale) {
      lastViewScale = viewScale;
      dirty = true;
    }
    // Something that just disappeared still has to be erased once.
    if (!dirty && !hasAny && !hadAny) return;
    hadAny = hasAny;

    const areas: AreaDraw[] = [];
    for (const p of pinned) {
      areas.push(
        areaDraw(p.template, cssToNumber(p.template.style?.color, AREA_COLORS.pinned), p.userName),
      );
    }
    for (const r of remoteTpls) {
      areas.push(
        areaDraw(r.template, cssToNumber(r.template.style?.color, AREA_COLORS.remote), r.userName),
      );
    }
    if (tpl) areas.push(areaDraw(tpl, cssToNumber(tpl.style?.color, AREA_COLORS.local)));

    // "Clique num token": a hint at the cursor while the emanation tool has nothing to grow from.
    let hint: { text: string; at: ScenePoint } | null = null;
    if (rulerTool.mode === "emanation" && !tplPress && rawCursor) {
      hint = {
        text: opts.getSelectedToken?.() ? "Clique num token ou Enter" : "Clique num token",
        at: rawCursor,
      };
    }

    const snapshot = measuring ? ruler.snapshot() : null;
    rulerLayer.render(snapshot, remoteRulers, areas, dragView(), viewScale, hint);
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
    isBusy: () =>
      measuring ||
      toolDragging ||
      tplPress !== null ||
      dragInfo !== null ||
      rulerTool.mode !== null,
    showDrag: (info) => {
      if (!info) dragWaypoints = [];
      dragInfo = info;
      dirty = true;
    },
  };
}
