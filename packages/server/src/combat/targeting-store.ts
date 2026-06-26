/**
 * TargetingStore — in-memory per-world targeting state.
 *
 * Tracks which tokens each user has marked as targets. State is ephemeral:
 * it is NOT persisted to the world database (REQ-CBT-053..055). One instance
 * lives per world namespace (created in socket-manager).
 *
 * Semantics (spec 10 §Canvas — Combat Turn Marker e Targeting):
 *   - REQ-CBT-053: a user marks/unmarks tokens as targets (`targeted: true/false`).
 *   - REQ-CBT-055: targeting is cleared automatically at the END of the turn of
 *     the combatant that performed the targeting (its owning user). The combat
 *     EventBus turnEnd hook calls clearForUser() for the relevant user.
 *
 * Cross-user semantics (spec 10 §Questões em Aberto #6): clearing is scoped to
 * a single userId, so one user clearing their targets never affects another
 * user's targets on the same token.
 */

/**
 * Per-world targeting state: userId → set of targeted tokenIds.
 *
 * Stored as a Map for O(1) add/remove and cheap per-user iteration.
 */
export class TargetingStore {
  private readonly byUser = new Map<string, Set<string>>();

  /**
   * Mark or unmark a token as a target for a specific user.
   *
   * @returns true when the state actually changed (so the caller can decide
   *   whether to broadcast); false when the requested state already held.
   */
  setTarget(userId: string, tokenId: string, targeted: boolean): boolean {
    let set = this.byUser.get(userId);

    if (targeted) {
      if (!set) {
        set = new Set<string>();
        this.byUser.set(userId, set);
      }
      if (set.has(tokenId)) return false;
      set.add(tokenId);
      return true;
    }

    // Unmark
    if (!set || !set.has(tokenId)) return false;
    set.delete(tokenId);
    if (set.size === 0) this.byUser.delete(userId);
    return true;
  }

  /** Return the set of tokenIds currently targeted by a user (may be empty). */
  getTargetsForUser(userId: string): ReadonlySet<string> {
    return this.byUser.get(userId) ?? new Set<string>();
  }

  /**
   * Clear ALL targets for a single user.
   *
   * Used by the turnEnd lifecycle hook (REQ-CBT-055): when a combatant's turn
   * ends, the targeting set by that combatant's owning user is wiped.
   *
   * @returns the list of tokenIds that were cleared (empty when the user had
   *   no targets). Callers broadcast a token:targeted(false) for each.
   */
  clearForUser(userId: string): string[] {
    const set = this.byUser.get(userId);
    if (!set || set.size === 0) return [];
    const cleared = [...set];
    this.byUser.delete(userId);
    return cleared;
  }

  /** Evict all targeting state for a disconnected user. */
  evictUser(userId: string): void {
    this.byUser.delete(userId);
  }
}
