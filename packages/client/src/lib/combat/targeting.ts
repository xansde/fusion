/**
 * targeting.ts — pure targeting-state reducer logic.
 *
 * No PIXI, no Svelte runes, no socket.io. Models the cross-user targeting set
 * as a plain data structure so the reducer is fully unit-testable.
 *
 * Targeting model (spec 10 §REQ-CBT-053..055):
 *   - Each user maintains their own set of targeted tokenIds.
 *   - The server broadcasts token:targeted { tokenId, targeted, userId } whenever
 *     any user marks/clears a target.
 *   - REQ-CBT-055: when a combatant's turn ends, the targeting set OF THE USER
 *     WHO OWNS THAT COMBATANT is cleared (the acting user's targets reset),
 *     unless a system opts out. The server is authoritative for this clear; the
 *     client mirrors it for instant canvas feedback.
 *
 * The canvas reticle (TargetingMarker) shows a token as targeted when ANY user
 * targets it. The local user's own targets may optionally be drawn in a distinct
 * color (see TargetingMarker).
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * The full targeting state: a map from userId to the set of tokenIds that user
 * currently targets.
 *
 * Using a Map<string, Set<string>> keeps per-user scoping explicit so we can
 * clear one user's targets (REQ-CBT-055) without touching others (open question
 * 6 in the spec: clearing one user's targets preserves other users').
 */
export interface TargetingState {
  readonly byUser: Map<string, Set<string>>;
}

/** Create an empty targeting state. */
export function createTargetingState(): TargetingState {
  return { byUser: new Map() };
}

// ---------------------------------------------------------------------------
// Reducer — apply a token:targeted broadcast
// ---------------------------------------------------------------------------

/**
 * Apply a single token:targeted broadcast to the state, mutating it in place.
 *
 * @param state    The targeting state (mutated).
 * @param tokenId  The token whose targeting changed.
 * @param targeted Whether the token is now targeted (true) or cleared (false).
 * @param userId   The user who set/cleared the target (server-resolved).
 * @returns true if the visible (any-user) targeting set for tokenId changed,
 *          so the caller can skip redundant canvas redraws.
 */
export function applyTargeted(
  state: TargetingState,
  tokenId: string,
  targeted: boolean,
  userId: string,
): boolean {
  const wasTargeted = isTargetedByAnyone(state, tokenId);

  let set = state.byUser.get(userId);
  if (targeted) {
    if (!set) {
      set = new Set();
      state.byUser.set(userId, set);
    }
    set.add(tokenId);
  } else if (set) {
    set.delete(tokenId);
    if (set.size === 0) state.byUser.delete(userId);
  }

  return wasTargeted !== isTargetedByAnyone(state, tokenId);
}

/**
 * Clear every target owned by a single user, mutating the state in place.
 *
 * Used when that user's combatant turn ends (REQ-CBT-055). Returns the set of
 * tokenIds whose any-user targeting status changed (became untargeted) so the
 * canvas can update only those reticles.
 */
export function clearUserTargets(state: TargetingState, userId: string): string[] {
  const set = state.byUser.get(userId);
  if (!set || set.size === 0) return [];

  const candidates = [...set];
  state.byUser.delete(userId);

  // A token only visually changes if no OTHER user still targets it.
  return candidates.filter((tokenId) => !isTargetedByAnyone(state, tokenId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Whether the given token is targeted by at least one user. */
export function isTargetedByAnyone(state: TargetingState, tokenId: string): boolean {
  for (const set of state.byUser.values()) {
    if (set.has(tokenId)) return true;
  }
  return false;
}

/** Whether the given token is targeted specifically by the given user. */
export function isTargetedByUser(state: TargetingState, tokenId: string, userId: string): boolean {
  return state.byUser.get(userId)?.has(tokenId) ?? false;
}

/**
 * Return the full set of tokenIds targeted by anyone, with a flag indicating
 * whether the local user is among the targeters.
 *
 * Used by the canvas to decide which reticles to draw and in which style
 * (REQ-CBT-054: targeted tokens get a distinct visual; the local user's own
 * targets may render differently).
 */
export interface TargetedTokenView {
  tokenId: string;
  /** Whether the local user is one of the targeters of this token. */
  byLocalUser: boolean;
  /** Total number of users targeting this token. */
  count: number;
}

export function targetedTokens(state: TargetingState, localUserId: string): TargetedTokenView[] {
  const counts = new Map<string, { count: number; byLocal: boolean }>();
  for (const [userId, set] of state.byUser) {
    const isLocal = userId === localUserId;
    for (const tokenId of set) {
      const cur = counts.get(tokenId);
      if (cur) {
        cur.count += 1;
        cur.byLocal = cur.byLocal || isLocal;
      } else {
        counts.set(tokenId, { count: 1, byLocal: isLocal });
      }
    }
  }

  const result: TargetedTokenView[] = [];
  for (const [tokenId, { count, byLocal }] of counts) {
    result.push({ tokenId, byLocalUser: byLocal, count });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reticle position computation
// ---------------------------------------------------------------------------

/** A token's canvas footprint, as resolved from the token layer. */
export interface TokenFootprint {
  /** Top-left x in scene pixels. */
  x: number;
  /** Top-left y in scene pixels. */
  y: number;
  /** Footprint size in scene pixels. */
  gridSize: number;
}

/** A targeted token paired with its resolved canvas footprint. */
export interface ReticlePosition {
  tokenId: string;
  x: number;
  y: number;
  gridSize: number;
  byLocalUser: boolean;
}

/**
 * Resolve the canvas positions of every targeted token.
 *
 * Pure: takes a `resolve` callback that maps a tokenId to its footprint (or null
 * when the token is not rendered in the current scene). Tokens that do not
 * resolve are skipped (no reticle is drawn for off-scene targets).
 *
 * This keeps the PIXI-dependent position lookup out of the reducer so the whole
 * pipeline can be unit-tested with a stub resolver.
 */
export function computeReticlePositions(
  state: TargetingState,
  localUserId: string,
  resolve: (tokenId: string) => TokenFootprint | null,
): ReticlePosition[] {
  const out: ReticlePosition[] = [];
  for (const view of targetedTokens(state, localUserId)) {
    const fp = resolve(view.tokenId);
    if (!fp) continue;
    out.push({
      tokenId: view.tokenId,
      x: fp.x,
      y: fp.y,
      gridSize: fp.gridSize,
      byLocalUser: view.byLocalUser,
    });
  }
  return out;
}
