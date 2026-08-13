/**
 * WallsLayer.ts — PIXI rendering + interaction for walls and doors.
 *
 * Spec: 07-visao-iluminacao-fog.md
 * REQ-VIS-001..009: wall rendering and door interaction
 * REQ-VIS-005: secret doors hidden from players
 * REQ-VIS-007: locked doors blocked from players
 * REQ-VIS-008: preset UI
 * REQ-VIS-009: draw/move/delete walls
 *
 * Attached for EVERY user, GM and player alike (issue #83) — but what each
 * of them sees differs. Wall LINE geometry (`_linesContainer`) is GM-only:
 * the server does not redact wall coordinates for players (it only strips
 * `doorType` on secret doors), so this layer itself hides the lines via
 * `_linesContainer.visible = isGm` to keep the dungeon's skeleton from
 * leaking to players who haven't explored it. Door ICONS
 * (`_doorsContainer`) are visible/clickable for everyone, except a secret
 * door's icon, which stays GM-only — opening/closing a door is a player
 * gesture (`scene:doorState`), so the icon has to render for them.
 *
 * Architecture:
 *   - WallsLayer owns the PIXI containers for wall lines + door icons
 *   - WallDrawingTool handles click-to-draw chain of wall segments
 *   - Door icons are clickable by all users (non-secret, unlocked doors)
 *   - Wall create/delete are sent via sendOp as `doc:create`/`doc:delete` with
 *     `documentType: "Wall"` and `parent: { type: "Scene", id: sceneId }` —
 *     Wall is an embedded document (issue #83), so the server allocates the
 *     `_id` and folds it into `Scene.walls[]`. Door state toggling is sent as
 *     the dedicated `scene:doorState` op (not `doc:update`), matching the
 *     permission split the server enforces (open/close: any user; lock/unlock
 *     and secret doors: GM/ASSISTANT only).
 *
 * Color coding (GM view):
 *   normal wall:    #ff4444 (red)
 *   terrain wall:   #44aa44 (green)
 *   invisible wall: #4444ff (blue, dashed)
 *   ethereal wall:  #aa44aa (purple)
 *   door (closed):  #ffaa00 (orange)
 *   door (open):    #44ff88 (cyan)
 *   door (locked):  #884400 (dark brown)
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Wall, DoorState } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import { sendOp } from "../../docs/sendOp.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WallPreset = "normal" | "terrain" | "invisible" | "ethereal" | "door";

export interface WallPresetDef {
  move: "none" | "normal";
  sight: "none" | "normal" | "limited";
  light: "none" | "normal" | "limited";
  sound: "none" | "normal" | "limited";
  doorType: "none" | "door";
}

export const WALL_PRESETS: Record<WallPreset, WallPresetDef> = {
  normal: { move: "normal", sight: "normal", light: "normal", sound: "normal", doorType: "none" },
  terrain: { move: "none", sight: "limited", light: "limited", sound: "limited", doorType: "none" },
  invisible: { move: "normal", sight: "none", light: "none", sound: "none", doorType: "none" },
  ethereal: { move: "none", sight: "normal", light: "normal", sound: "normal", doorType: "none" },
  door: { move: "normal", sight: "normal", light: "normal", sound: "normal", doorType: "door" },
};

// Wall colors by type
const WALL_COLORS: Record<WallPreset, number> = {
  normal: 0xff4444,
  terrain: 0x44aa44,
  invisible: 0x4444ff,
  ethereal: 0xaa44aa,
  door: 0xffaa00,
};

const DOOR_OPEN_COLOR = 0x44ff88;
const DOOR_LOCKED_COLOR = 0x884400;

// ---------------------------------------------------------------------------
// WallsLayer
// ---------------------------------------------------------------------------

export class WallsLayer {
  private _container: Container;
  private _linesContainer: Container;
  private _doorsContainer: Container;
  private _drawingContainer: Container;

  private _walls: Wall[] = [];
  private _sceneId: string;
  private _socket: Socket | null;
  private _isGm: boolean;

  // Drawing tool state
  private _drawingMode = false;
  private _drawStart: { x: number; y: number } | null = null;
  private _drawPreset: WallPreset = "normal";
  private _drawPreviewLine: Graphics | null = null;
  private _chainStart: { x: number; y: number } | null = null;

  // Selection
  private _selectedWallIds = new Set<string>();

  // Callbacks
  private _onWallsChanged: (() => void) | null = null;

  // Bound handlers
  private _boundPointerDown: (e: PointerEvent) => void;
  private _boundPointerMove: (e: PointerEvent) => void;
  private _boundPointerUp: (e: PointerEvent) => void;
  private _boundKeyDown: (e: KeyboardEvent) => void;

  // Container element (for event listeners)
  private _canvasEl: HTMLElement | null = null;

  // Grid snap
  private _gridSize = 100;
  private _padX = 0;
  private _padY = 0;

  // Camera ref (for screen→world conversion)
  private _camera: { tx: number; ty: number; scale: number } = { tx: 0, ty: 0, scale: 1 };

  constructor(
    container: Container,
    sceneId: string,
    socket: Socket | null,
    isGm: boolean,
    onWallsChanged?: () => void,
  ) {
    this._container = container;
    this._sceneId = sceneId;
    this._socket = socket;
    this._isGm = isGm;
    this._onWallsChanged = onWallsChanged ?? null;

    // BUG FIX (found in review): `container` is the shared "controls" layer
    // (see FusionCanvas._buildHierarchy), which FusionCanvas builds with
    // `eventMode = "none"` — PIXI's docs are explicit that "none" "[i]gnores
    // all interaction events, even on its children", and EventBoundary's
    // `_interactivePrune` enforces that literally: a "none" ancestor prunes
    // the whole subtree before it even looks at children, regardless of what
    // eventMode THEY carry. Without this override every pointerdown on a wall
    // line or door icon was dropped before it ever reached them — selecting,
    // deleting or opening a door silently did nothing, GM or player. This
    // mirrors TokenInteractionManager's identical fix for the "tokens" layer
    // (same "every layer starts none" default there). Safe to share with
    // NoteLayer/RulerLayer/PingLayer, also parented under "controls": each of
    // those sets its OWN root to "none" to opt out, and pruning is decided by
    // a node's own literal eventMode, not what it inherited — so they stay
    // uninteractive no matter what this line does to their shared parent.
    container.eventMode = "static";

    // Lines (wall segments) — below doors. Must NOT be "none": that would
    // independently prune this subtree the same way the parent fix above
    // guards against, blocking every wall line regardless of its own
    // eventMode. Left at the Container default ("passive") so an interactive
    // child (the per-wall Graphics below) still gets hit-tested.
    this._linesContainer = new Container();
    this._linesContainer.label = "walls:lines";
    // REQ-CNV-004 (specs/06-canvas-e-renderizacao.md:281,582,606): wall
    // geometry — including segments the server never redacts, like the
    // exact position of a secret door — is GM-only. The server only strips
    // `doorType` for secret doors; it still ships the raw wall list to every
    // client, so hiding the drawn lines is this layer's job. Only the
    // segments are gated; door icons (below, in `_doorsContainer`) stay
    // visible/clickable for non-secret doors so players can open/close them.
    this._linesContainer.visible = this._isGm;
    container.addChild(this._linesContainer);

    // Door icons (interactive)
    this._doorsContainer = new Container();
    this._doorsContainer.label = "walls:doors";
    container.addChild(this._doorsContainer);

    // Drawing preview (topmost)
    this._drawingContainer = new Container();
    this._drawingContainer.label = "walls:drawing";
    this._drawingContainer.eventMode = "none";
    container.addChild(this._drawingContainer);

    this._boundPointerDown = this._handlePointerDown.bind(this);
    this._boundPointerMove = this._handlePointerMove.bind(this);
    this._boundPointerUp = this._handlePointerUp.bind(this);
    this._boundKeyDown = this._handleKeyDown.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Update walls from scene document.
   * Call whenever the scene's wall collection changes.
   */
  setWalls(walls: Wall[]): void {
    this._walls = walls;
    this._render();
  }

  /**
   * Update camera state for screen→world conversion in pointer handlers.
   */
  setCamera(camera: { tx: number; ty: number; scale: number }): void {
    this._camera = camera;
  }

  /** Set grid size for snap. */
  setGrid(gridSize: number, padX: number, padY: number): void {
    this._gridSize = gridSize;
    this._padX = padX;
    this._padY = padY;
  }

  /**
   * Attach DOM event listeners to the canvas element.
   * Call once after canvas init.
   */
  attachToElement(el: HTMLElement): void {
    this._canvasEl = el;
    // Listeners are added only when drawing mode is active
  }

  /** Enter wall drawing mode. */
  startDrawing(preset: WallPreset = "normal"): void {
    if (!this._isGm) return;
    this._drawingMode = true;
    this._drawPreset = preset;
    this._drawStart = null;
    this._chainStart = null;
    if (this._canvasEl) {
      this._canvasEl.style.cursor = "crosshair";
      this._canvasEl.addEventListener("pointerdown", this._boundPointerDown);
      this._canvasEl.addEventListener("pointermove", this._boundPointerMove);
      this._canvasEl.addEventListener("pointerup", this._boundPointerUp);
      window.addEventListener("keydown", this._boundKeyDown);
    }
  }

  /** Exit wall drawing mode. */
  stopDrawing(): void {
    this._drawingMode = false;
    this._drawStart = null;
    this._chainStart = null;
    this._clearPreview();
    if (this._canvasEl) {
      this._canvasEl.style.cursor = "";
      this._canvasEl.removeEventListener("pointerdown", this._boundPointerDown);
      this._canvasEl.removeEventListener("pointermove", this._boundPointerMove);
      this._canvasEl.removeEventListener("pointerup", this._boundPointerUp);
      window.removeEventListener("keydown", this._boundKeyDown);
    }
  }

  get isDrawing(): boolean {
    return this._drawingMode;
  }

  /** Delete all selected walls. */
  async deleteSelected(): Promise<void> {
    if (!this._isGm || this._selectedWallIds.size === 0) return;
    const ids = [...this._selectedWallIds];
    this._selectedWallIds.clear();

    await this._sendWallsDelete(ids);
    this._onWallsChanged?.();
  }

  /** Select a wall by id (toggle). */
  toggleSelectWall(wallId: string): void {
    if (this._selectedWallIds.has(wallId)) {
      this._selectedWallIds.delete(wallId);
    } else {
      this._selectedWallIds.add(wallId);
    }
    this._render();
  }

  /** Clear selection. */
  clearSelection(): void {
    this._selectedWallIds.clear();
    this._render();
  }

  /** Teardown. */
  destroy(): void {
    this.stopDrawing();
    this._linesContainer.destroy({ children: true });
    this._doorsContainer.destroy({ children: true });
    this._drawingContainer.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Private — rendering
  // ---------------------------------------------------------------------------

  private _render(): void {
    this._renderLines();
    this._renderDoors();
  }

  private _renderLines(): void {
    this._linesContainer.removeChildren();

    for (const wall of this._walls) {
      const g = new Graphics();
      // BUG FIX (found in review): "auto" never fires its own events — PIXI's
      // docs say so explicitly ("Does not emit events... Same as
      // `interactive = false`"), and EventBoundary.isInteractive() only
      // returns true for "static"/"dynamic". The g.on("pointerdown", ...)
      // handler below never fired with "auto", so a GM's click could never
      // select (and therefore never delete) a wall.
      g.eventMode = this._isGm ? "static" : "none";

      const color = this._wallColor(wall);
      const selected = this._selectedWallIds.has(wall._id);
      const lineWidth = selected ? 4 : 2;

      // Dash for invisible walls
      if (wall.sight === "none" && wall.light === "none") {
        this._drawDashedLine(g, wall.a.x, wall.a.y, wall.b.x, wall.b.y, color, lineWidth);
      } else {
        g.moveTo(wall.a.x, wall.a.y).lineTo(wall.b.x, wall.b.y);
        g.stroke({ color, width: lineWidth, alpha: 0.85 });
      }

      // Selection highlight
      if (selected) {
        const halo = new Graphics();
        halo.moveTo(wall.a.x, wall.a.y).lineTo(wall.b.x, wall.b.y);
        halo.stroke({ color: 0xffffff, width: 6, alpha: 0.3 });
        halo.eventMode = "none";
        this._linesContainer.addChild(halo);
      }

      // Endpoint handles (GM only)
      if (this._isGm) {
        this._drawEndpoint(g, wall.a.x, wall.a.y, color);
        this._drawEndpoint(g, wall.b.x, wall.b.y, color);
      }

      // Click to select (GM)
      if (this._isGm) {
        const wallId = wall._id;
        g.on("pointerdown", (e) => {
          e.stopPropagation();
          this.toggleSelectWall(wallId);
        });
      }

      this._linesContainer.addChild(g);
    }
  }

  private _renderDoors(): void {
    this._doorsContainer.removeChildren();

    for (const wall of this._walls) {
      if (wall.doorType === "none") continue;

      // Secret doors: only GM sees the icon
      if (wall.doorType === "secret" && !this._isGm) continue;

      const mx = (wall.a.x + wall.b.x) / 2;
      const my = (wall.a.y + wall.b.y) / 2;

      const icon = this._createDoorIcon(wall, mx, my);
      this._doorsContainer.addChild(icon);
    }
  }

  private _createDoorIcon(wall: Wall, x: number, y: number): Container {
    const c = new Container();
    c.x = x;
    c.y = y;

    const radius = 10;
    const g = new Graphics();

    const doorColor = this._doorIconColor(wall.doorState);
    g.circle(0, 0, radius).fill({ color: doorColor, alpha: 0.9 });
    g.circle(0, 0, radius).stroke({ color: 0x000000, width: 1.5, alpha: 0.6 });

    // Lock icon for locked doors
    if (wall.doorState === "locked") {
      const lockStyle = new TextStyle({ fontSize: 10, fill: 0x000000 });
      const lockText = new Text({ text: "🔒", style: lockStyle });
      lockText.anchor.set(0.5);
      lockText.eventMode = "none";
      c.addChild(lockText);
    } else if (wall.doorState === "open") {
      // Open indicator
      const openStyle = new TextStyle({ fontSize: 10, fill: 0x000000 });
      const openText = new Text({ text: "○", style: openStyle });
      openText.anchor.set(0.5);
      openText.eventMode = "none";
      c.addChild(openText);
    }

    c.addChild(g);
    // BUG FIX (found in review): same "auto" mistake as the wall-line
    // Graphics above — "auto" never emits its own events, so the
    // c.on("pointerdown", ...) handler below never fired for any user. "auto"
    // is retained for the inner circle `g`; a plain (non-hitArea) Container
    // like `c` has no geometry of its own, so `c`'s hit test is satisfied via
    // `g`'s real hit-tested shape — only `c` needs to be "static" for
    // isInteractive() to resolve it as the propagation target.
    c.eventMode = "static";
    c.cursor = wall.doorState === "locked" ? "not-allowed" : "pointer";

    // Door interaction
    const wallId = wall._id;
    const socket = this._socket;
    const isGm = this._isGm;
    const onChanged = this._onWallsChanged;

    c.on("pointerdown", (e) => {
      e.stopPropagation();
      if (!socket) return;

      if (wall.doorState === "locked") {
        // Only GM can unlock
        if (isGm) {
          void this._sendDoorStateUpdate(wallId, "closed").then(() => {
            onChanged?.();
          });
        }
        return;
      }

      const newState: DoorState = wall.doorState === "open" ? "closed" : "open";
      void this._sendDoorStateUpdate(wallId, newState).then(() => {
        onChanged?.();
      });
    });

    return c;
  }

  private _wallColor(wall: Wall): number {
    if (wall.doorType !== "none") {
      return this._doorIconColor(wall.doorState) === DOOR_LOCKED_COLOR
        ? DOOR_LOCKED_COLOR
        : WALL_COLORS.door;
    }
    if (wall.sight === "limited") return WALL_COLORS.terrain;
    if (wall.sight === "none" && wall.move === "none") return WALL_COLORS.ethereal;
    if (wall.sight === "none") return WALL_COLORS.invisible;
    return WALL_COLORS.normal;
  }

  private _doorIconColor(state: DoorState): number {
    switch (state) {
      case "open":
        return DOOR_OPEN_COLOR;
      case "locked":
        return DOOR_LOCKED_COLOR;
      default:
        return WALL_COLORS.door;
    }
  }

  private _drawEndpoint(g: Graphics, x: number, y: number, color: number): void {
    g.circle(x, y, 4).fill({ color, alpha: 0.9 });
    g.circle(x, y, 4).stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  }

  private _drawDashedLine(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    width: number,
  ): void {
    const dashLen = 8;
    const gapLen = 4;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    let pos = 0;
    let drawing = true;

    while (pos < len) {
      const segLen = Math.min(drawing ? dashLen : gapLen, len - pos);
      if (drawing) {
        const sx = x1 + ux * pos;
        const sy = y1 + uy * pos;
        const ex = x1 + ux * (pos + segLen);
        const ey = y1 + uy * (pos + segLen);
        g.moveTo(sx, sy).lineTo(ex, ey);
        g.stroke({ color, width, alpha: 0.7 });
      }
      pos += segLen;
      drawing = !drawing;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — drawing tool
  // ---------------------------------------------------------------------------

  private _handlePointerDown(e: PointerEvent): void {
    if (!this._drawingMode || e.button !== 0) return;
    e.stopPropagation();

    const worldPt = this._screenToWorld(e);
    const snapped = this._snap(worldPt);

    if (this._drawStart === null) {
      // First click: set start of segment
      this._drawStart = snapped;
      // For chaining: if chain in progress, continue from previous end
      if (this._chainStart) {
        this._drawStart = this._chainStart;
      }
    }
  }

  private _handlePointerMove(e: PointerEvent): void {
    if (!this._drawingMode || this._drawStart === null) return;

    const worldPt = this._screenToWorld(e);
    const snapped = this._snap(worldPt);

    this._clearPreview();
    const preview = new Graphics();
    preview.eventMode = "none";
    const color = WALL_COLORS[this._drawPreset];
    preview.moveTo(this._drawStart.x, this._drawStart.y).lineTo(snapped.x, snapped.y);
    preview.stroke({ color, width: 2, alpha: 0.6 });

    // Start point marker
    preview.circle(this._drawStart.x, this._drawStart.y, 5).fill({ color, alpha: 0.8 });

    this._drawPreviewLine = preview;
    this._drawingContainer.addChild(preview);
  }

  private _handlePointerUp(e: PointerEvent): void {
    if (!this._drawingMode || e.button !== 0 || this._drawStart === null) return;
    e.stopPropagation();

    const worldPt = this._screenToWorld(e);
    const end = this._snap(worldPt);

    const dx = end.x - this._drawStart.x;
    const dy = end.y - this._drawStart.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) {
      // Too short — ignore
      this._drawStart = null;
      this._clearPreview();
      return;
    }

    // Create the wall
    const start = this._drawStart;
    void this._createWall(start, end);

    // Chain: next segment starts from this end point
    this._chainStart = end;
    this._drawStart = null;
    this._clearPreview();
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.stopDrawing();
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._isGm) {
      void this.deleteSelected();
    }
  }

  private _clearPreview(): void {
    if (this._drawPreviewLine) {
      this._drawPreviewLine.destroy();
      this._drawPreviewLine = null;
    }
    this._drawingContainer.removeChildren();
  }

  // ---------------------------------------------------------------------------
  // Private — grid snap
  // ---------------------------------------------------------------------------

  private _screenToWorld(e: PointerEvent): { x: number; y: number } {
    const el = this._canvasEl;
    if (!el) return { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { tx, ty, scale } = this._camera;
    return {
      x: (sx - tx) / scale,
      y: (sy - ty) / scale,
    };
  }

  private _snap(pt: { x: number; y: number }): { x: number; y: number } {
    // Snap to nearest grid vertex + snap to existing wall endpoints
    const gridX = Math.round((pt.x - this._padX) / this._gridSize) * this._gridSize + this._padX;
    const gridY = Math.round((pt.y - this._padY) / this._gridSize) * this._gridSize + this._padY;

    const SNAP_THRESHOLD = 12;
    let best = { x: gridX, y: gridY };
    let bestDistSq = SNAP_THRESHOLD * SNAP_THRESHOLD;

    // Snap to existing wall endpoints
    for (const wall of this._walls) {
      for (const ep of [wall.a, wall.b]) {
        const dx = ep.x - pt.x;
        const dy = ep.y - pt.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = { x: ep.x, y: ep.y };
        }
      }
    }

    return best;
  }

  // ---------------------------------------------------------------------------
  // Private — ops
  // ---------------------------------------------------------------------------

  // BUG FIX (issue #83): Wall is embedded in the Scene document. The server
  // addresses embedded-document creation/deletion with `doc:create`/`doc:delete`
  // + `parent: { type: "Scene", id: sceneId }` — the same wire shape
  // tokenDrop.ts's buildTokenDropPayload, TokenInteractionManager's
  // deleteSelectedToken and tileController.ts's addTile/deleteTile already use.
  // The `$push`/`$pull` operators these two methods used to send do not exist
  // in the server's diff engine: it replaces the whole `walls` array with the
  // literal `{ $push: {...} }` / `{ $pull: [...] }` object, which SceneSchema
  // then rejects with VALIDATION_FAILED (walls: Expected array, received object).
  private async _createWall(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): Promise<void> {
    if (!this._socket) return;
    const preset = WALL_PRESETS[this._drawPreset];
    // `_id` is generated server-side for embedded documents, so none is sent
    // here — same contract as the reference call-sites above.
    const wall: Omit<Wall, "_id"> = {
      a,
      b,
      move: preset.move,
      sight: preset.sight,
      light: preset.light,
      sound: preset.sound,
      dir: "both",
      doorType: preset.doorType,
      doorState: "closed",
    };

    try {
      await sendOp(this._socket, {
        type: "doc:create",
        payload: {
          documentType: "Wall",
          data: [wall],
          parent: { type: "Scene", id: this._sceneId },
        },
      });
      this._onWallsChanged?.();
    } catch (err) {
      console.error("[WallsLayer] Failed to create wall:", err);
    }
  }

  private async _sendWallsDelete(wallIds: string[]): Promise<void> {
    if (!this._socket) return;
    try {
      await sendOp(this._socket, {
        type: "doc:delete",
        payload: {
          documentType: "Wall",
          ids: wallIds,
          parent: { type: "Scene", id: this._sceneId },
        },
      });
    } catch (err) {
      console.error("[WallsLayer] Failed to delete walls:", err);
    }
  }

  // BUG FIX (review of issue #83): this used to send `doc:update` with
  // `documentType: "Scene"` and a dot-path diff `walls.<id>.doorState` — the
  // exact same shape `_createWall`/`_sendWallsDelete` were fixed away from
  // above. The server's `applyDotPathDiff` expands that dot-path into
  // `{ walls: { "<id>": { doorState: ... } } }`, and `deepMerge` sees an
  // array on the target (`walls`) meet an object on the patch, which its
  // "mixed types" branch REPLACES wholesale — `walls` becomes an object and
  // `SceneSchema` rejects it (`walls: Expected array, received object`).
  // Doors never opened for anyone, GM or player.
  //
  // The server already ships a dedicated op for exactly this, with exactly
  // the permission split this UI needs (open/close: anyone; lock/unlock and
  // secret doors: GM/ASSISTANT only) — `scene:doorState`
  // (DoorStatePayloadSchema, vision-handlers.ts buildDoorStateHandler). Using
  // it also sidesteps the generic embedded `doc:update` path entirely, whose
  // GM_ONLY_EMBEDDED set would incorrectly block a player's own door toggle.
  private async _sendDoorStateUpdate(wallId: string, state: DoorState): Promise<void> {
    if (!this._socket) return;
    try {
      await sendOp(this._socket, {
        type: "scene:doorState",
        payload: {
          sceneId: this._sceneId,
          wallId,
          state,
        },
      });
    } catch (err) {
      console.error("[WallsLayer] Failed to update door state:", err);
    }
  }
}
