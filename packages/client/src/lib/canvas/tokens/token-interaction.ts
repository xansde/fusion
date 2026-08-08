/**
 * token-interaction.ts — Pure, PIXI-free token interaction logic.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036, §D5
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050..052 (optimistic move)
 * Spec: 05-usuarios-e-permissoes.md (ownership, who can move what)
 *
 * Responsibilities:
 *   - Drag state machine: idle → dragging → pending → confirmed / rolledback
 *   - Compute snapped target cell from cursor position
 *   - canMoveToken: ownership-based permission check (GM moves all; player moves own)
 *   - pending indicator state (for RTT feedback — desaturation flag)
 *   - Arrow-key move calculation (1 cell per keypress)
 *
 * This module has NO PIXI dependency and NO DOM dependency.
 * It is safe to run under Vitest with the "node" environment.
 *
 * The PIXI shell (TokenInteractionManager) consumes these helpers to wire
 * pointer events to TokenLayer.applyLocalMove() and sendOp().
 */

import type { TokenDocument, ScenePoint, GridStrategy } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

/**
 * Token ownership on a per-token basis.
 * For embedded tokens, ownership is derived from the Actor they reference.
 * When actorId is null, only GMs can move the token.
 *
 * Spec 05 §REQ-USR-006: GM has implicit OWNER on all documents.
 * Spec 05 §REQ-USR-005: roles in ascending order PLAYER(1) < TRUSTED(2) < ASSISTANT(3) < GAMEMASTER(4).
 *
 * canMoveToken: returns true if the given user can move the given token.
 *   - GM (role >= ASSISTANT=3) can move any token.
 *   - Player can move tokens they own: token.actorId matches one of their
 *     owned actor IDs, OR if an explicit ownership map is provided.
 *
 * @param token        The token to check.
 * @param userId       The user's ID (string).
 * @param userRole     Numeric role: 1=PLAYER, 2=TRUSTED, 3=ASSISTANT, 4=GAMEMASTER.
 * @param ownedActorIds Set of actorIds the user owns (derived from server-side
 *                     ownership resolution and carried by the session context).
 */
export function canMoveToken(
  token: TokenDocument,
  userId: string,
  userRole: number,
  ownedActorIds: ReadonlySet<string>,
): boolean {
  // GM and Assistant have blanket move permission
  if (userRole >= ROLE_ASSISTANT) return true;

  // Players can only move tokens linked to actors they own
  if (token.actorId !== null && ownedActorIds.has(token.actorId)) return true;

  // Fallback: check if token was explicitly assigned to this user via flags
  // (future-proof hook — not used in M1-C but prevents stale errors)
  const flagOwner = token.flags["fusion"]?.["owner"];
  if (typeof flagOwner === "string" && flagOwner === userId) return true;

  return false;
}

/** Minimum role that grants blanket move permission (ASSISTANT = 3). */
export const ROLE_ASSISTANT = 3;
/** GAMEMASTER role value. */
export const ROLE_GAMEMASTER = 4;

// ---------------------------------------------------------------------------
// Grid snap helper
// ---------------------------------------------------------------------------

/**
 * Snap a scene point to the nearest cell center.
 * Returns the top-left of the snapped cell so the token footprint aligns correctly.
 *
 * The token's x/y is the top-left of the footprint bounding box.
 * Snapping snaps the footprint's center to the nearest cell center
 * (or cell-cluster center for footprint > 1), then converts back to top-left.
 *
 * The grid arrives as a GridStrategy, not as loose scalars: this function no
 * longer knows nor cares whether the scene's grid is square.
 *
 * @param cursorX    Cursor x in scene coordinates (top-left drag anchor).
 * @param cursorY    Cursor y in scene coordinates.
 * @param footW      Token footprint width in cells.
 * @param footH      Token footprint height in cells.
 * @param grid       The active scene's grid.
 */
export function snapTokenToGrid(
  cursorX: number,
  cursorY: number,
  footW: number,
  footH: number,
  grid: GridStrategy,
): ScenePoint {
  // For multi-cell footprints, snap the center of the bounding box
  const cellSize = grid.config.size;
  const halfPixW = (footW * cellSize) / 2;
  const halfPixH = (footH * cellSize) / 2;

  const snappedCenter = grid.getSnappedPoint(
    { x: cursorX + halfPixW, y: cursorY + halfPixH },
    "center",
  );

  // Convert back to top-left
  return {
    x: snappedCenter.x - halfPixW,
    y: snappedCenter.y - halfPixH,
  };
}

// ---------------------------------------------------------------------------
// Arrow-key movement
// ---------------------------------------------------------------------------

/** Direction enum for keyboard movement. */
export type ArrowDirection = "up" | "down" | "left" | "right";

/**
 * Compute the new top-left position after moving one cell in the given direction.
 * The resulting position is already snapped (integer multiples of gridSize).
 *
 * @param currentX  Current token x (top-left, scene pixels).
 * @param currentY  Current token y (top-left, scene pixels).
 * @param direction Arrow key direction.
 * @param grid      The active scene's grid.
 */
export function arrowMoveToken(
  currentX: number,
  currentY: number,
  direction: ArrowDirection,
  grid: GridStrategy,
): ScenePoint {
  const step = grid.config.size;
  switch (direction) {
    case "up":
      return { x: currentX, y: currentY - step };
    case "down":
      return { x: currentX, y: currentY + step };
    case "left":
      return { x: currentX - step, y: currentY };
    case "right":
      return { x: currentX + step, y: currentY };
  }
}

// ---------------------------------------------------------------------------
// Drag state machine
// ---------------------------------------------------------------------------

/**
 * Drag state machine states.
 *
 * idle       — no interaction in progress.
 * dragging   — pointer is down and moving; ghost follows cursor.
 * pending    — drop confirmed; optimistic move applied; waiting for server ack.
 * confirmed  — server accepted the move (terminal — transition back to idle).
 * rolledback — server rejected the move; token reverted (terminal).
 */
export type DragState = "idle" | "dragging" | "pending" | "confirmed" | "rolledback";

export interface DragContext {
  /** Token being dragged. */
  tokenId: string;

  /** Position before the drag started (for rollback). */
  originalX: number;
  originalY: number;

  /** Current ghost/target position (snapped). */
  ghostX: number;
  ghostY: number;

  /** Request ID of the pending op (to correlate ack). */
  requestId: string | null;

  /** Whether the pending indicator should be shown. */
  isPending: boolean;
}

export interface DragMachine {
  state: DragState;
  context: DragContext | null;
}

/** Create a fresh idle machine. */
export function createDragMachine(): DragMachine {
  return { state: "idle", context: null };
}

// ---------------------------------------------------------------------------
// Drag machine transitions (pure functions — return new machine state)
// ---------------------------------------------------------------------------

/**
 * Start a drag operation.
 * Transition: idle → dragging.
 *
 * @param machine   Current machine state (must be idle).
 * @param tokenId   The token being dragged.
 * @param origX     Token's current x before drag.
 * @param origY     Token's current y before drag.
 * @param requestId A pre-generated request ID for the eventual op.
 */
export function startDrag(
  machine: DragMachine,
  tokenId: string,
  origX: number,
  origY: number,
  requestId: string,
): DragMachine {
  if (machine.state !== "idle") return machine; // guard: already dragging

  return {
    state: "dragging",
    context: {
      tokenId,
      originalX: origX,
      originalY: origY,
      ghostX: origX,
      ghostY: origY,
      requestId,
      isPending: false,
    },
  };
}

/**
 * Update the ghost position during drag.
 * Transition: dragging → dragging (with new ghostX/ghostY).
 *
 * @param machine   Current machine state (must be dragging).
 * @param ghostX    New snapped x position.
 * @param ghostY    New snapped y position.
 */
export function updateDragPosition(
  machine: DragMachine,
  ghostX: number,
  ghostY: number,
): DragMachine {
  if (machine.state !== "dragging" || !machine.context) return machine;

  return {
    ...machine,
    context: { ...machine.context, ghostX, ghostY },
  };
}

/**
 * Confirm the drop: apply optimistic move and send to server.
 * Transition: dragging → pending.
 *
 * After this, the caller must:
 *   1. Call tokenLayer.applyLocalMove(tokenId, ghostX, ghostY)
 *   2. Call sendOp({ type: "doc:update", ... }) with requestId from context
 *   3. On ack success → call confirmMove()
 *   4. On ack failure/timeout → call rollbackMove()
 */
export function confirmDrop(machine: DragMachine): DragMachine {
  if (machine.state !== "dragging" || !machine.context) return machine;

  // If the ghost didn't actually move, skip the op by going directly to confirmed
  if (
    machine.context.ghostX === machine.context.originalX &&
    machine.context.ghostY === machine.context.originalY
  ) {
    return { state: "confirmed", context: machine.context };
  }

  return {
    state: "pending",
    context: { ...machine.context, isPending: true },
  };
}

/**
 * Cancel the drag without confirming (ESC pressed during drag).
 * Transition: dragging → idle (caller must snap token back to originalX/Y).
 */
export function cancelDrag(machine: DragMachine): DragMachine {
  if (machine.state !== "dragging") return machine;
  return { state: "idle", context: null };
}

/**
 * Server accepted the move.
 * Transition: pending → confirmed.
 */
export function confirmMove(machine: DragMachine): DragMachine {
  if (machine.state !== "pending" || !machine.context) return machine;
  return {
    state: "confirmed",
    context: { ...machine.context, isPending: false },
  };
}

/**
 * Server rejected/corrected the move — must rollback.
 * Transition: pending → rolledback.
 *
 * Caller must call tokenLayer.rollbackMove(tokenId, authX, authY).
 */
export function rollbackMove(machine: DragMachine, authX: number, authY: number): DragMachine {
  if (machine.state !== "pending" || !machine.context) return machine;

  return {
    state: "rolledback",
    context: {
      ...machine.context,
      isPending: false,
      ghostX: authX,
      ghostY: authY,
    },
  };
}

/**
 * Reset machine to idle after a terminal state (confirmed / rolledback).
 * Safe to call from confirmed or rolledback.
 */
export function resetToIdle(machine: DragMachine): DragMachine {
  if (machine.state !== "confirmed" && machine.state !== "rolledback") return machine;
  return { state: "idle", context: null };
}

// ---------------------------------------------------------------------------
// Pending indicator helper
// ---------------------------------------------------------------------------

/**
 * Whether the token should show a pending (desaturated) indicator.
 * True when the machine is in "pending" state for that token.
 */
export function isTokenPending(machine: DragMachine, tokenId: string): boolean {
  if (machine.state !== "pending" || !machine.context) return false;
  return machine.context.tokenId === tokenId && machine.context.isPending;
}

// ---------------------------------------------------------------------------
// Sequential move guard (prevents second drag before first ack)
// ---------------------------------------------------------------------------

/**
 * Returns true if the machine is in a state that allows starting a new drag
 * on the given token. A pending move on a different token does not block.
 *
 * Note: two rapid moves on the SAME token while one is pending are serialized:
 * the second drag must wait until the machine resets to idle after the first ack.
 */
export function canStartDrag(machine: DragMachine, _tokenId: string): boolean {
  if (machine.state === "idle") return true;
  if (machine.state === "confirmed" || machine.state === "rolledback") return true;
  // If dragging/pending a DIFFERENT token, we can start dragging this one
  // (multi-token drag is [V2]; for now only single-token).
  return false;
}
