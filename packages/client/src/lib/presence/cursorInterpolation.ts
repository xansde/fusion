/**
 * Cursor interpolation — pure functions, no PIXI, no DOM.
 *
 * Provides smooth lerp-based interpolation for remote cursors.
 * Tested in isolation via Vitest.
 *
 * M1-E: REQ-NET-040, spec 04 §D7
 */

import type { RemoteCursor } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cursors that have not updated in this many ms are considered stale and removed. */
export const CURSOR_STALE_MS = 4000;

/** Lerp factor per ms — controls how quickly cursor catches up to target.
 *  At 60 fps (16.7 ms/frame) a factor of 0.3 gives smooth but responsive movement.
 */
const LERP_FACTOR_PER_MS = 0.015;

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute the interpolation factor for a given deltaMs.
 *
 * Uses exponential decay: factor = 1 - (1 - alpha)^(deltaMs)
 * where alpha = LERP_FACTOR_PER_MS. This is frame-rate independent.
 */
export function lerpFactor(deltaMs: number): number {
  // Clamp to [0, 1]
  const f = 1 - Math.pow(1 - LERP_FACTOR_PER_MS, deltaMs);
  return Math.min(1, Math.max(0, f));
}

/**
 * Advance the cursor position one frame toward its target.
 *
 * Returns a new cursor object (immutable update).
 */
export function interpolateCursor(cursor: RemoteCursor, deltaMs: number): RemoteCursor {
  const t = lerpFactor(deltaMs);
  const newX = lerp(cursor.x, cursor.targetX, t);
  const newY = lerp(cursor.y, cursor.targetY, t);
  return { ...cursor, x: newX, y: newY };
}

/**
 * Apply a server-side cursor update to an existing cursor state.
 *
 * If the cursor doesn't exist yet, creates a new one at the target position
 * (with current === target so there's no stale position to lerp from).
 */
export function applyCursorUpdate(
  existing: RemoteCursor | undefined,
  update: {
    userId: string;
    userName?: string;
    x: number;
    y: number;
    color?: string;
  },
  nowMs: number,
): RemoteCursor {
  if (!existing) {
    // New cursor — start at target position
    const newCursor: RemoteCursor = {
      userId: update.userId,
      x: update.x,
      y: update.y,
      targetX: update.x,
      targetY: update.y,
      color: update.color ?? "#888888",
      lastUpdatedMs: nowMs,
    };
    if (update.userName !== undefined) newCursor.userName = update.userName;
    return newCursor;
  }

  // Update target; current stays at old position for smooth lerp
  const updatedCursor: RemoteCursor = {
    ...existing,
    targetX: update.x,
    targetY: update.y,
    color: update.color ?? existing.color,
    lastUpdatedMs: nowMs,
  };
  if (update.userName !== undefined) {
    updatedCursor.userName = update.userName;
  } else if (existing.userName !== undefined) {
    updatedCursor.userName = existing.userName;
  }
  return updatedCursor;
}

/**
 * Remove stale cursors (those not updated within CURSOR_STALE_MS).
 *
 * Returns the updated map of active cursors.
 */
export function pruneStale(
  cursors: Map<string, RemoteCursor>,
  nowMs: number,
): Map<string, RemoteCursor> {
  const result = new Map(cursors);
  for (const [userId, cursor] of result) {
    if (nowMs - cursor.lastUpdatedMs > CURSOR_STALE_MS) {
      result.delete(userId);
    }
  }
  return result;
}
