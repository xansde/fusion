/**
 * combatTracker.ts — pure, testable combat tracker logic.
 *
 * No PIXI, no Svelte runes, no socket.io. All functions are pure or
 * deterministic given their inputs so they can be unit-tested with Vitest.
 *
 * Exports:
 *   - TrackerRow: shape of a single row in the tracker UI
 *   - buildTrackerRows(): produce display rows from a CombatDocument
 *   - controlsState(): derive which GM controls are enabled/disabled
 *   - formatInitiative(): format an initiative value for display
 *   - canPlayerRollInitiative(): derive if a player can roll a given combatant
 *   - resolveCombatantTokenId(): find the tokenId for the canvas turn marker
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-040..047
 */

import type { CombatDocument, CombatantDocument, TokenDocument } from "@fusion/shared";
import { sortCombatants } from "@fusion/shared";

// ---------------------------------------------------------------------------
// TrackerRow
// ---------------------------------------------------------------------------

/**
 * Display model for one row in the combat tracker.
 * Components consume this instead of the raw CombatantDocument so that the
 * display logic is testable outside of Svelte.
 */
export interface TrackerRow {
  /** The combatant's _id. */
  id: string;
  /** Display name. */
  name: string;
  /** Token image URL, or null for a placeholder. */
  img: string | null;
  /** Formatted initiative string ("–" when null, number otherwise). */
  initiativeLabel: string;
  /** Raw initiative value (for manual edit input). */
  initiative: number | null;
  /** Whether this combatant is the active (current-turn) one. */
  isActive: boolean;
  /** Whether this combatant is defeated. */
  isDefeated: boolean;
  /**
   * Whether this combatant is hidden from players.
   * Only ever true for GM (server redacts hidden from player snapshots).
   */
  isHidden: boolean;
  /** Whether this combatant is linked to a player-owned actor. */
  hasPlayerOwner: boolean;
  /** The token ID (for canvas operations). */
  tokenId: string | null;
  /** The actor ID (for actor sheet operations). */
  actorId: string | null;
  /** Index in the sorted turn order (0-based). */
  turnIndex: number;
  /**
   * Tracked resource snapshot for display alongside initiative (REQ-CBT-047),
   * or null when the combat has no trackedResource configured or the system has
   * not provided a value for this combatant.
   */
  trackedResource: TrackedResourceView | null;
}

/**
 * Display model for the tracked resource (REQ-CBT-047).
 *
 * The authoritative value is produced server-side by the system API's
 * getTrackedResource() and cached onto the combatant under
 * flags.combat.trackedResource. The client only renders what is present; it
 * never computes or fabricates a value.
 */
export interface TrackedResourceView {
  value: number;
  max: number;
  label: string;
}

// ---------------------------------------------------------------------------
// buildTrackerRows
// ---------------------------------------------------------------------------

/**
 * Produce an ordered list of TrackerRow objects from a CombatDocument.
 *
 * Combatants are sorted using the default initiative comparator (desc total,
 * then desc tiebreaker, nulls last). This mirrors the server-side order but
 * is re-derived here so the tracker is always correct even if the server sends
 * the combatants array in insertion order.
 *
 * Active-turn highlight (REQ-CBT-042) is derived from combat.activeCombatantId
 * (matched by _id), NOT from combat.turnIndex. turnIndex is positional against
 * the GM's FULL array; a player receives a redacted (hidden-stripped) array, so
 * indexing into it with turnIndex would highlight the WRONG row. Matching by id
 * is redaction-stable: when the active combatant is hidden the server masks
 * activeCombatantId to null for players, so no row is highlighted (correct).
 *
 * REQ-CBT-041: each row shows img, name, initiative, defeated indicator.
 * REQ-CBT-042: active combatant is flagged.
 */
export function buildTrackerRows(combat: CombatDocument): TrackerRow[] {
  const sorted = sortCombatants(combat.combatants);

  return sorted.map((c, idx) => ({
    id: c._id,
    name: c.name,
    img: c.img,
    initiativeLabel: formatInitiative(c.initiative),
    initiative: c.initiative,
    isActive: combat.started && combat.activeCombatantId === c._id,
    isDefeated: c.defeated,
    isHidden: c.hidden,
    hasPlayerOwner: c.hasPlayerOwner,
    tokenId: c.tokenId,
    actorId: c.actorId,
    turnIndex: idx,
    trackedResource: resolveTrackedResource(combat, c),
  }));
}

// ---------------------------------------------------------------------------
// resolveTrackedResource
// ---------------------------------------------------------------------------

/**
 * Read the tracked-resource snapshot for a combatant (REQ-CBT-047).
 *
 * The authoritative value is computed server-side by the system API's
 * getTrackedResource() and cached onto the combatant under
 * flags.combat.trackedResource as { value, max, label }. The client only
 * surfaces what is present and validates the shape; it never fabricates a value.
 *
 * Returns null when:
 *   - the combat has no trackedResource configured, OR
 *   - the combatant has no cached resource snapshot, OR
 *   - the cached value has an invalid shape.
 */
export function resolveTrackedResource(
  combat: CombatDocument,
  combatant: CombatantDocument,
): TrackedResourceView | null {
  if (!combat.trackedResource) return null;

  const combatFlags = combatant.flags["combat"];
  if (combatFlags === undefined) return null;

  const raw = combatFlags["trackedResource"];
  if (typeof raw !== "object" || raw === null) return null;

  const r = raw as Record<string, unknown>;
  if (typeof r["value"] !== "number" || typeof r["max"] !== "number") return null;

  const label = typeof r["label"] === "string" ? r["label"] : combat.trackedResource;
  return { value: r["value"], max: r["max"], label };
}

// ---------------------------------------------------------------------------
// formatInitiative
// ---------------------------------------------------------------------------

/**
 * Format an initiative value for display in the tracker.
 *
 * - null  → "–"
 * - integer → "18"
 * - float → "18.5" (up to one decimal)
 */
export function formatInitiative(value: number | null): string {
  if (value === null) return "–";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

// ---------------------------------------------------------------------------
// controlsState
// ---------------------------------------------------------------------------

/**
 * Derive which GM-facing controls should be enabled given the current combat state.
 *
 * REQ-CBT-043: Next/Previous/End Combat buttons.
 * REQ-CBT-046: "Begin Combat" shown when not started.
 */
export interface ControlsState {
  canStart: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canEnd: boolean;
  canRollAll: boolean;
  canReset: boolean;
}

export function controlsState(combat: CombatDocument): ControlsState {
  const hasCombatants = combat.combatants.length > 0;
  const isStarted = combat.started;
  const isEnded = combat.ended;

  return {
    canStart: hasCombatants && !isStarted && !isEnded,
    canNext: isStarted && !isEnded && hasCombatants,
    canPrevious: isStarted && !isEnded && hasCombatants,
    canEnd: !isEnded,
    canRollAll: hasCombatants && !isEnded,
    canReset: hasCombatants && !isEnded,
  };
}

// ---------------------------------------------------------------------------
// canPlayerRollInitiative
// ---------------------------------------------------------------------------

/**
 * Determine whether the logged-in player can roll initiative for a combatant.
 *
 * REQ-CBT-034: players can roll their own PC's initiative when it is null and
 * the combat has not yet ended.
 *
 * @param combatant   The combatant to check.
 * @param combat      The parent combat document.
 * @param userId      The current user's ID.
 * @param actorOwnerIds  Set of actor _ids owned by the current user.
 * @param isGm        Whether the current user is GM (GM can always roll).
 */
export function canPlayerRollInitiative(
  combatant: CombatantDocument,
  combat: CombatDocument,
  _userId: string,
  actorOwnerIds: Set<string>,
  isGm: boolean,
): boolean {
  if (combat.ended) return false;
  if (isGm) return true;
  // Player can roll their own combatant if initiative is null.
  if (combatant.initiative !== null) return false;
  if (!combatant.actorId) return false;
  return actorOwnerIds.has(combatant.actorId);
}

// ---------------------------------------------------------------------------
// addableTokens (BUG D FIX)
// ---------------------------------------------------------------------------

/**
 * Display model for a token the GM can add to the active combat.
 */
export interface AddableToken {
  id: string;
  name: string;
  img: string | null;
  actorId: string | null;
}

/**
 * List the active scene's tokens that are NOT already combatants.
 *
 * BUG D root cause: combat:create + combat:beginCombat both work, and the
 * server (combat:addCombatant) + client (combatActions.addCombatant) plumbing
 * already exists end-to-end, but no UI ever called addCombatant — so a GM
 * had no way to populate a combat with combatants, making it look like
 * combat "couldn't be started". This is the pure filter behind the
 * CombatPanel "add token" list: hidden tokens are included (the GM sees
 * everything; hidden combatants are a combat-level flag set separately via
 * combat:setHidden, not inherited from the token).
 *
 * @param sceneTokens  All tokens embedded in the active scene (GM view — unfiltered).
 * @param combat       Current combat, or null when none exists yet.
 */
export function addableTokens(
  sceneTokens: TokenDocument[],
  combat: CombatDocument | null,
): AddableToken[] {
  const existingTokenIds = new Set(
    (combat?.combatants ?? []).map((c) => c.tokenId).filter((id): id is string => id !== null),
  );

  return sceneTokens
    .filter((t) => !existingTokenIds.has(t._id))
    .map((t) => ({
      id: t._id,
      name: t.name || "Token",
      img: t.texture,
      actorId: t.actorId,
    }));
}

// ---------------------------------------------------------------------------
// resolveCombatantTokenId
// ---------------------------------------------------------------------------

/**
 * Get the tokenId of the active combatant (for the canvas turn marker).
 *
 * Returns null when combat is not started/ended, has no active combatant, the
 * active combatant has no associated token, or — for a player — the active
 * combatant is hidden (the server masks activeCombatantId to null in that case,
 * so the marker correctly does not appear on a hidden token).
 *
 * Resolves the active combatant by combat.activeCombatantId (matched by _id),
 * NOT by turnIndex: turnIndex is positional against the GM's full array and
 * would resolve the wrong token for a player whose array is redacted.
 *
 * REQ-CBT-050/052: combat turn marker placed on the active token.
 */
export function resolveCombatantTokenId(combat: CombatDocument): string | null {
  if (!combat.started || combat.ended) return null;
  if (combat.activeCombatantId === null) return null;
  const active = combat.combatants.find((c) => c._id === combat.activeCombatantId);
  return active?.tokenId ?? null;
}
