/**
 * TokenInteractionManager.ts — PIXI shell for token interaction.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036, §D5
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050..052
 * Spec: 05-usuarios-e-permissoes.md (ownership / move permission)
 *
 * Responsibilities:
 *   - Listen to pointer events on token sprites (down/move/up) and drive
 *     the drag state machine from token-interaction.ts.
 *   - Listen to keyboard events (arrows → 1-cell move; ESC → cancel drag;
 *     H → toggle hidden; Del → delete selected token).
 *   - Dispatch optimistic moves via TokenLayer + sendOp (doc:update).
 *   - Rollback token position on ack failure/timeout.
 *   - Maintain a "selected token" set and update ring visuals.
 *   - Expose GM tools: addToken, deleteToken, toggleHidden.
 *   - Show a pending indicator (desaturation) while awaiting ack.
 *
 * This class is a PIXI shell — all pure logic lives in token-interaction.ts.
 * No DOM dependency (except window keyboard listener via optional callback).
 *
 * Usage (wiring in TableScreen or sceneLoader):
 *   const mgr = new TokenInteractionManager({
 *     tokenLayer, mirror, sceneId, canvas, socket, userId, userRole,
 *     ownedActorIds, gridConfig,
 *   });
 *   // In FusionCanvas ticker:
 *   // (nothing — interaction is event-driven)
 *   // On cleanup:
 *   mgr.destroy();
 */

import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Socket } from "socket.io-client";
import type {
  TokenDocument,
  SceneDocument,
  DocUpdatePayload,
  DocCreatePayload,
  DocDeletePayload,
} from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";
import type { DocumentMirror } from "../../docs/DocumentMirror.js";
import type { FusionCanvas } from "../FusionCanvas.js";
import { screenToWorld } from "../camera-math.js";
import { sendOp, OpError } from "../../docs/sendOp.js";
import { emitTokenPreview } from "../../presence/attachPresenceSync.js";
import type { TokenLayer } from "./TokenLayer.js";
import { footprintOf, type FootprintActorInput } from "./footprint.js";
import type { ActorDocument } from "../../actors/actorDirectory.js";
import {
  canMoveToken,
  snapTokenToGrid,
  arrowMoveToken,
  createDragMachine,
  startDrag,
  updateDragPosition,
  confirmDrop,
  cancelDrag,
  confirmMove,
  rollbackMove,
  resetToIdle,
  canStartDrag,
  type GridSnapConfig,
  type ArrowDirection,
  type DragMachine,
} from "./token-interaction.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TokenInteractionOptions {
  /** The PIXI container for the token layer. */
  tokenContainer: Container;
  /** The TokenLayer managing sprites. */
  tokenLayer: TokenLayer;
  /** DocumentMirror to read scene state. */
  mirror: DocumentMirror;
  /** Active scene ID. */
  sceneId: string;
  /** FusionCanvas (for camera state / screen→world transform). */
  canvas: FusionCanvas;
  /** Socket.io socket for sending ops. */
  socket: Socket;
  /** Logged-in user's ID. */
  userId: string;
  /** Logged-in user's role (1=PLAYER, 2=TRUSTED, 3=ASSISTANT, 4=GAMEMASTER). */
  userRole: number;
  /** Set of actor IDs the user owns (for move permission check). */
  ownedActorIds: ReadonlySet<string>;
  /** Current grid config for snapping. */
  gridConfig: GridSnapConfig;
  /** Whether to attach global keyboard listeners (default: true). */
  attachKeyboard?: boolean;
  /** Optional callback to show a toast/notification on error. */
  onError?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum pointer displacement (px) to start a drag vs. treat as click. */
const DRAG_THRESHOLD_PX = 5;

/** Timeout for sendOp acks on token moves (ms). */
const TOKEN_MOVE_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// TokenInteractionManager
// ---------------------------------------------------------------------------

export class TokenInteractionManager {
  private _opts: TokenInteractionOptions;

  /** Currently selected token IDs. */
  private _selectedIds: Set<string> = new Set();

  /** Drag state machine. */
  private _drag: DragMachine = createDragMachine();

  /** Pointer capture state for drag detection. */
  private _pointerDown: {
    tokenId: string;
    startSx: number;
    startSy: number;
    dragging: boolean;
  } | null = null;

  /** Pending ack cleanup fn (to cancel rollback if destroyed during pending). */
  private _pendingCleanup: (() => void) | null = null;

  /** True if destroyed. */
  private _destroyed = false;

  /** True if keyboard listener was actually attached (respects attachKeyboard option). */
  private _keyboardAttached = false;

  // Bound handlers
  private _onKeyDown: (e: KeyboardEvent) => void;

  constructor(opts: TokenInteractionOptions) {
    this._opts = opts;
    this._onKeyDown = this._handleKeyDown.bind(this);

    // Attach keyboard handlers
    if (opts.attachKeyboard !== false) {
      window.addEventListener("keydown", this._onKeyDown);
      this._keyboardAttached = true;
    }

    // Wire up pointer events on the token container using PIXI event delegation.
    // TokenSprite containers have eventMode="static" (set in TokenSprite.ts).
    this._attachContainerEvents();
  }

  // ---------------------------------------------------------------------------
  // Public — GM tool API
  // ---------------------------------------------------------------------------

  /**
   * GM: Add a new token linked to `actorId` to the active scene, centered in
   * the current viewport.
   *
   * TK023 (REQ-TOK-002, REQ-TOK-010, REQ-TOK-012): `actorId` is required — a
   * token with no actor is no longer a representable state (DEC-TOK-04) — and
   * the payload carries no `name`/`texture`/`width`/`height` of its own: name
   * and art come from the actor (REQ-TOK-060, REQ-CNV-091), and the footprint
   * (`footprintOf`, TK041, REQ-TOK-012/017) is derived from the actor's size
   * category, used here only to center the drop.
   *
   * @param actorId  The Actor this token is linked to.
   */
  async addToken(actorId: string): Promise<void> {
    const scene = this._opts.mirror.getDoc<SceneDocument>("Scene", this._opts.sceneId);
    if (!scene) return;

    // Place at center of current viewport, snapped
    const { canvas } = this._opts;
    const camera = canvas.camera;
    const viewRect = this._getViewRect();
    const centerSx = viewRect.width / 2;
    const centerSy = viewRect.height / 2;
    const world = screenToWorld(centerSx, centerSy, camera);

    const footprint = footprintOf(undefined, this._getActor(actorId));
    const snapped = snapTokenToGrid(
      world.x - (footprint.width * this._opts.gridConfig.size) / 2,
      world.y - (footprint.height * this._opts.gridConfig.size) / 2,
      footprint.width,
      footprint.height,
      this._opts.gridConfig,
    );

    const tokenId = createDocumentId();
    const newToken: Partial<TokenDocument> = {
      _id: tokenId,
      actorId,
      x: snapped.x,
      y: snapped.y,
    };

    const createPayload: DocCreatePayload = {
      documentType: "Token",
      data: [newToken],
      parent: { type: "Scene", id: this._opts.sceneId },
    };

    try {
      await sendOp(this._opts.socket, {
        type: "doc:create",
        payload: createPayload,
      });
    } catch (err) {
      this._opts.onError?.(
        err instanceof OpError ? `Failed to add token: ${err.message}` : "Failed to add token",
      );
    }
  }

  /**
   * GM: Delete the currently selected token.
   */
  async deleteSelectedToken(): Promise<void> {
    const [selectedId] = this._selectedIds;
    if (!selectedId) return;

    const deletePayload: DocDeletePayload = {
      documentType: "Token",
      ids: [selectedId],
      parent: { type: "Scene", id: this._opts.sceneId },
    };

    try {
      await sendOp(this._opts.socket, {
        type: "doc:delete",
        payload: deletePayload,
      });
      this._selectedIds.delete(selectedId);
    } catch (err) {
      this._opts.onError?.(
        err instanceof OpError
          ? `Failed to delete token: ${err.message}`
          : "Failed to delete token",
      );
    }
  }

  /**
   * GM: Toggle hidden flag on the currently selected token.
   */
  async toggleHiddenSelectedToken(): Promise<void> {
    const [selectedId] = this._selectedIds;
    if (!selectedId) return;

    const scene = this._opts.mirror.getDoc<SceneDocument>("Scene", this._opts.sceneId);
    if (!scene) return;
    const token = scene.tokens.find((t) => t._id === selectedId);
    if (!token) return;

    const togglePayload: DocUpdatePayload = {
      documentType: "Token",
      updates: [
        {
          _id: selectedId,
          diff: { hidden: !token.hidden },
          embedded: { type: "Token", id: this._opts.sceneId },
        },
      ],
    };

    try {
      await sendOp(this._opts.socket, {
        type: "doc:update",
        payload: togglePayload,
      });
    } catch (err) {
      this._opts.onError?.(
        err instanceof OpError
          ? `Failed to toggle hidden: ${err.message}`
          : "Failed to toggle hidden",
      );
    }
  }

  /**
   * Deselect all tokens.
   */
  deselectAll(): void {
    this._selectedIds.clear();
    this._updateSelectionVisuals();
  }

  /** The currently selected token IDs (read-only view). */
  get selectedIds(): ReadonlySet<string> {
    return this._selectedIds;
  }

  // ---------------------------------------------------------------------------
  // Public — teardown
  // ---------------------------------------------------------------------------

  /**
   * Destroy all event listeners. Safe to call multiple times.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._keyboardAttached) {
      window.removeEventListener("keydown", this._onKeyDown);
      this._keyboardAttached = false;
    }
    this._pendingCleanup?.();
    this._pendingCleanup = null;

    // Detach PIXI events
    const { tokenContainer } = this._opts;
    tokenContainer.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private — PIXI event wiring (event delegation on container)
  // ---------------------------------------------------------------------------

  private _attachContainerEvents(): void {
    const { tokenContainer, canvas } = this._opts;

    // Enable interaction on the token layer container
    tokenContainer.eventMode = "static";
    tokenContainer.hitArea = { contains: () => true };

    // Pointer down on the container — check if we hit a token sprite
    tokenContainer.on("pointerdown", (e: FederatedPointerEvent) => {
      if (this._destroyed) return;
      if (e.button !== 0) return; // left button only

      const tokenId = this._getTokenIdFromTarget(e.target);
      if (!tokenId) {
        // Click on empty canvas — deselect
        this.deselectAll();
        return;
      }

      const token = this._getToken(tokenId);
      if (!token) return;

      const { userId, userRole, ownedActorIds } = this._opts;
      const canMove = canMoveToken(token, userId, userRole, ownedActorIds);

      // Always select on click (regardless of move permission)
      this._selectToken(tokenId);

      if (!canMove) return;
      if (!canStartDrag(this._drag, tokenId)) return;

      // Start tracking potential drag
      const rect = canvas["_container"].getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      this._pointerDown = {
        tokenId,
        startSx: sx,
        startSy: sy,
        dragging: false,
      };

      e.stopPropagation();
    });

    tokenContainer.on("pointermove", (e: FederatedPointerEvent) => {
      if (this._destroyed || !this._pointerDown) return;

      const rect = canvas["_container"].getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const dx = sx - this._pointerDown.startSx;
      const dy = sy - this._pointerDown.startSy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this._pointerDown.dragging && dist > DRAG_THRESHOLD_PX) {
        // Threshold exceeded — start a real drag
        const tokenId = this._pointerDown.tokenId;
        const token = this._getToken(tokenId);
        if (!token) return;

        const requestId = createDocumentId();
        this._drag = startDrag(this._drag, tokenId, token.x, token.y, requestId);
        this._pointerDown.dragging = true;
      }

      if (this._pointerDown.dragging && this._drag.state === "dragging") {
        const camera = canvas.camera;
        const world = screenToWorld(sx, sy, camera);
        const token = this._getToken(this._pointerDown.tokenId);
        if (!token) return;

        const footprint = footprintOf(token, this._getActor(token.actorId));
        const snapped = snapTokenToGrid(
          world.x - (footprint.width * this._opts.gridConfig.size) / 2,
          world.y - (footprint.height * this._opts.gridConfig.size) / 2,
          footprint.width,
          footprint.height,
          this._opts.gridConfig,
        );

        this._drag = updateDragPosition(this._drag, snapped.x, snapped.y);

        // Move ghost (optimistic preview during drag — before drop)
        this._opts.tokenLayer.applyLocalMove(this._pointerDown.tokenId, snapped.x, snapped.y);

        // REQ-NET-044: broadcast the drag target to other clients (throttled,
        // ephemeral — never persisted). This is purely informational for
        // OTHER users; the dragger's own screen already updated above.
        emitTokenPreview(
          this._opts.socket,
          this._opts.sceneId,
          this._pointerDown.tokenId,
          snapped.x,
          snapped.y,
        );
      }
    });

    tokenContainer.on("pointerup", () => {
      if (this._destroyed) return;
      if (!this._pointerDown) return;

      if (this._pointerDown.dragging && this._drag.state === "dragging") {
        this._handleDrop();
      }

      this._pointerDown = null;
    });

    tokenContainer.on("pointerupoutside", () => {
      if (this._destroyed) return;
      if (!this._pointerDown) return;

      if (this._pointerDown.dragging && this._drag.state === "dragging") {
        this._handleDrop();
      }

      this._pointerDown = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Private — drop handler (confirm optimistic move + send op)
  // ---------------------------------------------------------------------------

  private _handleDrop(): void {
    if (this._drag.state !== "dragging" || !this._drag.context) return;

    const { tokenId, ghostX, ghostY, originalX, originalY, requestId } = this._drag.context;

    this._drag = confirmDrop(this._drag);

    if (this._drag.state === "confirmed") {
      // Ghost didn't move — nothing to do
      this._drag = resetToIdle(this._drag);
      return;
    }

    // State is "pending" — already applied optimistically during drag
    // (tokenLayer.applyLocalMove was called during pointermove).
    // Now send the server op.
    void this._sendMoveOp(tokenId, ghostX, ghostY, originalX, originalY, requestId ?? "");
  }

  private async _sendMoveOp(
    tokenId: string,
    newX: number,
    newY: number,
    originalX: number,
    originalY: number,
    requestId: string,
  ): Promise<void> {
    // NOTE: applyLocalMove must be called by the caller BEFORE _sendMoveOp.
    // For pointer drags it is called during pointermove; for arrow-key moves
    // it is called in _handleKeyDown.  Calling it here again would be redundant
    // for drags and would reset the _localPending flag a second time, causing
    // the server ack to animate instead of snapping (FIX M1-C).

    // Show pending indicator
    this._updatePendingVisual(tokenId, true);

    let settled = false;
    const cleanup = () => {
      if (!settled) {
        settled = true;
        this._pendingCleanup = null;
      }
    };
    this._pendingCleanup = cleanup;

    const movePayload: DocUpdatePayload = {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { x: newX, y: newY },
          embedded: { type: "Token", id: this._opts.sceneId },
        },
      ],
    };

    try {
      await sendOp(
        this._opts.socket,
        {
          type: "doc:update",
          requestId,
          payload: movePayload,
        },
        { timeoutMs: TOKEN_MOVE_TIMEOUT_MS },
      );

      if (this._destroyed) return;
      // Server accepted
      this._drag = confirmMove(this._drag);
      this._drag = resetToIdle(this._drag);
      this._updatePendingVisual(tokenId, false);
    } catch (err) {
      if (this._destroyed) return;

      // Server rejected or timeout — rollback
      this._drag = rollbackMove(this._drag, originalX, originalY);
      this._drag = resetToIdle(this._drag);
      this._opts.tokenLayer.rollbackMove(tokenId, originalX, originalY);
      this._updatePendingVisual(tokenId, false);

      const msg =
        err instanceof OpError ? `Move rejected: ${err.message}` : "Move failed: network timeout";
      this._opts.onError?.(msg);
    } finally {
      cleanup();
    }
  }

  // ---------------------------------------------------------------------------
  // Private — keyboard handler
  // ---------------------------------------------------------------------------

  private _handleKeyDown(e: KeyboardEvent): void {
    if (this._destroyed) return;

    // ESC — cancel drag or deselect
    if (e.code === "Escape") {
      if (this._drag.state === "dragging" && this._drag.context) {
        const { tokenId, originalX, originalY } = this._drag.context;
        this._drag = cancelDrag(this._drag);
        // Snap token back to original position
        this._opts.tokenLayer.applyLocalMove(tokenId, originalX, originalY);
      } else {
        this.deselectAll();
      }
      return;
    }

    // Arrow keys — move selected token 1 cell
    const arrowMap: Record<string, ArrowDirection> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const dir = arrowMap[e.code];
    if (dir !== undefined) {
      const [selectedId] = this._selectedIds;
      if (!selectedId) return;

      const token = this._getToken(selectedId);
      if (!token) return;

      const { userId, userRole, ownedActorIds } = this._opts;
      if (!canMoveToken(token, userId, userRole, ownedActorIds)) return;
      if (!canStartDrag(this._drag, selectedId)) return;

      e.preventDefault(); // prevent scroll

      const newPos = arrowMoveToken(token.x, token.y, dir, this._opts.gridConfig);
      const requestId = createDocumentId();

      // Simulate a complete drag cycle in one step
      this._drag = startDrag(this._drag, selectedId, token.x, token.y, requestId);
      this._drag = updateDragPosition(this._drag, newPos.x, newPos.y);
      this._drag = confirmDrop(this._drag);

      if (this._drag.state === "confirmed") {
        this._drag = resetToIdle(this._drag);
        return;
      }

      // Apply optimistic move before sending op (single point of application — FIX M1-C).
      this._opts.tokenLayer.applyLocalMove(selectedId, newPos.x, newPos.y);
      void this._sendMoveOp(selectedId, newPos.x, newPos.y, token.x, token.y, requestId);
      return;
    }

    // H — toggle hidden on selected token (GM only)
    if (e.code === "KeyH" && this._opts.userRole >= 3) {
      void this.toggleHiddenSelectedToken();
      return;
    }

    // Delete / Backspace — delete selected token (GM only)
    if ((e.code === "Delete" || e.code === "Backspace") && this._opts.userRole >= 3) {
      if (this._selectedIds.size > 0) {
        void this.deleteSelectedToken();
      }
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — selection helpers
  // ---------------------------------------------------------------------------

  private _selectToken(tokenId: string): void {
    this._selectedIds.clear();
    this._selectedIds.add(tokenId);
    this._updateSelectionVisuals();
  }

  private _updateSelectionVisuals(): void {
    // Apply selection outline to all sprites via TokenSprite.setSelected().
    // All currently selected IDs get selection=true; all others get false.
    for (const [id, sprite] of this._opts.tokenLayer.sprites()) {
      sprite.setSelected(this._selectedIds.has(id));
    }
  }

  private _updatePendingVisual(tokenId: string, pending: boolean): void {
    // Delegate to TokenSprite.setPending() for desaturation feedback while awaiting ack.
    const sprite = this._opts.tokenLayer.getSprite(tokenId);
    sprite?.setPending(pending);
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  private _getToken(tokenId: string): TokenDocument | undefined {
    const scene = this._opts.mirror.getDoc<SceneDocument>("Scene", this._opts.sceneId);
    return scene?.tokens.find((t) => t._id === tokenId);
  }

  /**
   * TK041 (REQ-TOK-012, REQ-TOK-043): the base Actor `footprintOf` derives a
   * footprint from, for snapping during drag/add. `undefined` when the actor
   * is not (yet) in the mirror — `footprintOf` already treats that the same
   * as "no size declared" and falls back to 1×1.
   */
  private _getActor(actorId: string): FootprintActorInput | undefined {
    return this._opts.mirror.getDoc<ActorDocument>("Actor", actorId);
  }

  private _getTokenIdFromTarget(target: Container | null): string | null {
    if (!target) return null;

    // Walk up to find a container labeled "token:<id>"
    let current: Container | null = target;
    while (current) {
      if (typeof current.label === "string" && current.label.startsWith("token:")) {
        return current.label.slice(6); // strip "token:" prefix
      }
      current = current.parent;
    }
    return null;
  }

  private _getViewRect(): { width: number; height: number } {
    const el = this._opts.canvas["_container"];
    const rect = el.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  }
}
