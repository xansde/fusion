/**
 * Throttle utilities — pure, testable.
 *
 * Provides a simple leading-edge throttle function for cursor emission.
 * The client throttles cursor updates to ~30ms intervals before sending
 * to the server (REQ-NET-040).
 *
 * M1-E.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThrottleState {
  lastFiredMs: number;
}

// ---------------------------------------------------------------------------
// Throttle logic
// ---------------------------------------------------------------------------

/**
 * Create a new throttle state (not yet fired).
 */
export function createThrottleState(): ThrottleState {
  return { lastFiredMs: -Infinity };
}

/**
 * Check whether enough time has passed since the last allowed call.
 *
 * Returns true if the call is allowed (updates state); false otherwise.
 * This is a leading-edge throttle: the first call is always allowed.
 *
 * @param state       Mutable throttle state
 * @param intervalMs  Minimum interval between allowed calls
 * @param nowMs       Current timestamp
 */
export function shouldThrottle(state: ThrottleState, intervalMs: number, nowMs: number): boolean {
  if (nowMs - state.lastFiredMs >= intervalMs) {
    state.lastFiredMs = nowMs;
    return false; // allowed
  }
  return true; // throttled — skip
}

// ---------------------------------------------------------------------------
// Distance gate
// ---------------------------------------------------------------------------

/**
 * Return true if the position changed by at least `threshold` pixels from the last sent position.
 *
 * Prevents sending micro-jitter updates.
 */
export function movedSignificantly(
  lastX: number,
  lastY: number,
  currentX: number,
  currentY: number,
  threshold = 2,
): boolean {
  const dx = currentX - lastX;
  const dy = currentY - lastY;
  return dx * dx + dy * dy >= threshold * threshold;
}
