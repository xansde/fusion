/**
 * combatVisibility.ts — pure visibility/permission logic for the combat tracker.
 *
 * No PIXI, no Svelte runes, no socket.io. All functions are pure so they can be
 * unit-tested with Vitest.
 *
 * The server's redaction layer (packages/server/src/net/redaction.ts) already
 * strips hidden combatants from the snapshots/broadcasts/acks it sends to
 * non-privileged sockets. These helpers are DEFENSE IN DEPTH: the client must
 * not assume the payload it received was redacted, so it filters hidden
 * combatants again before rendering for a player. A GM sees everything (with a
 * hidden indicator). This guarantees that even if a hidden=true combatant
 * leaks through a network path, a player UI never reveals it.
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-031..035
 *   REQ-CBT-031: hidden combatants are invisible to players.
 *   REQ-CBT-032: GM sees all combatants (with hidden indicator).
 *   REQ-CBT-033: players see their own PCs and all non-hidden combatants.
 */

import type { CombatDocument, CombatantDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Viewer role
// ---------------------------------------------------------------------------

/**
 * The role the local user has when viewing the combat tracker.
 *
 * - "gm": GM or Assistant GM — privileged, sees all combatants including hidden.
 * - "player": regular player — sees only non-hidden combatants (plus their own
 *   PCs, which a GM would never hide from their own owner — but defense in depth
 *   keeps the rule simple: hidden=true is never shown to a player).
 */
export type ViewerRole = "gm" | "player";

/**
 * Map a privileged boolean (server's isRolePrivileged result, mirrored on the
 * client via the user's role) to a ViewerRole.
 *
 * Keeping this a single chokepoint avoids scattering `isGm ? ... : ...` ternaries
 * across the UI and makes the visibility machine testable in isolation.
 */
export function viewerRole(isPrivileged: boolean): ViewerRole {
  return isPrivileged ? "gm" : "player";
}

// ---------------------------------------------------------------------------
// Hidden filter
// ---------------------------------------------------------------------------

/**
 * Decide whether a single combatant is visible to the given viewer role.
 *
 * REQ-CBT-031/032/033:
 *   - GM: always visible.
 *   - player: visible only when NOT hidden.
 */
export function isCombatantVisibleTo(combatant: CombatantDocument, role: ViewerRole): boolean {
  if (role === "gm") return true;
  return !combatant.hidden;
}

/**
 * Return the subset of combatants visible to the given viewer role.
 *
 * For a GM this returns the input array unchanged (same reference when nothing
 * is filtered — zero allocation in the common GM path). For a player it returns
 * a new array without any hidden combatants.
 *
 * Defense in depth: even though the server redacts hidden combatants from
 * player payloads, the client re-applies the filter so a leaked hidden
 * combatant is never rendered to a player.
 */
export function visibleCombatants(
  combatants: readonly CombatantDocument[],
  role: ViewerRole,
): readonly CombatantDocument[] {
  if (role === "gm") return combatants;

  // Avoid allocating a new array when nothing is hidden (common case).
  let hasHidden = false;
  for (const c of combatants) {
    if (c.hidden) {
      hasHidden = true;
      break;
    }
  }
  if (!hasHidden) return combatants;

  return combatants.filter((c) => !c.hidden);
}

/**
 * Produce a player-safe shallow copy of a combat document with hidden
 * combatants removed.
 *
 * Returns the original reference for a GM (no copy). For a player it returns a
 * new CombatDocument object whose `combatants` array excludes hidden entries —
 * but ONLY when at least one hidden combatant existed, to avoid needless
 * allocations.
 *
 * IMPORTANT: turnIndex is NOT remapped here, and it MUST NOT be used to resolve
 * the active combatant on the client. turnIndex is positional against the GM's
 * full array; after hidden combatants are stripped, the positions shift, so
 * indexing a player's redacted array with turnIndex points at the wrong row.
 *
 * The active-turn highlight (REQ-CBT-042) and the canvas turn marker
 * (REQ-CBT-050) are instead derived from combat.activeCombatantId (matched by
 * _id) — a redaction-stable pointer the server masks to null when the active
 * combatant is itself hidden. See buildTrackerRows / resolveCombatantTokenId.
 * This function is for list rendering only.
 */
export function redactCombatForViewer(combat: CombatDocument, role: ViewerRole): CombatDocument {
  if (role === "gm") return combat;

  const visible = visibleCombatants(combat.combatants, role);
  if (visible === combat.combatants) return combat;

  return { ...combat, combatants: visible as CombatantDocument[] };
}

// ---------------------------------------------------------------------------
// GM-only control gating
// ---------------------------------------------------------------------------

/**
 * Whether GM-only controls (Begin/Next/Previous/End, hide, remove, set
 * initiative manually, reorder) should be exposed in the UI for this role.
 *
 * REQ-CBT-043/046: Next/Previous/End/Begin are GM controls.
 * REQ-CBT-031: only the GM can hide combatants.
 */
export function canUseGmControls(role: ViewerRole): boolean {
  return role === "gm";
}

/**
 * Whether the viewer may mark/clear targets.
 *
 * REQ-CBT-053: GM or a player with permission may target tokens. In the MVP
 * any connected user may set their own targets (the server scopes targeting by
 * the authenticated userId), so both roles may target.
 */
export function canTarget(_role: ViewerRole): boolean {
  return true;
}
