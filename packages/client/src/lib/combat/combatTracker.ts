/**
 * combatTracker.ts — pure, testable combat tracker logic.
 *
 * No PIXI, no Svelte runes, no socket.io. All functions are pure or
 * deterministic given their inputs so they can be unit-tested with Vitest.
 *
 * Exports:
 *   - TrackerRow: shape of a single row in the tracker UI
 *   - buildTrackerRows(): produce display rows from a CombatDocument
 *   - buildRotatedQueue(): rotate those rows from the current turn (spec 40 §5.4)
 *   - moveCombatantInOrder()/moveCombatantBefore(): the two reorder gestures
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
// The queue below the turn head (spec 40 §5.4)
// ---------------------------------------------------------------------------

/**
 * Which half of the round an entry belongs to.
 *
 * `"upcoming"` still acts this round; `"acted"` already did. The distinction exists
 * because REQ-CBA-031 forbids dropping the second group: someone who already acted is
 * still in the encounter, still carries conditions, and is still the person the GM points
 * at — hiding them to make the list shorter loses the round's shape.
 */
export type QueueGroup = "upcoming" | "acted";

/** One participant's place in the rotated queue. */
export interface QueueEntry {
  /** The row to draw. */
  readonly row: TrackerRow;
  /** Which group the row was sorted into (REQ-CBA-031). */
  readonly group: QueueGroup;
  /** Position in the rotated queue, counted across both groups (0-based). */
  readonly queueIndex: number;
}

/** The queue the panel draws under the turn head. */
export interface RotatedQueue {
  /** Whoever still acts this round, in turn order. */
  readonly upcoming: readonly QueueEntry[];
  /** Whoever already acted this round, in turn order — kept, never omitted. */
  readonly acted: readonly QueueEntry[];
  /** `upcoming` followed by `acted`; the reading order of the panel. */
  readonly entries: readonly QueueEntry[];
  /** Whether a turn was actually in progress, i.e. whether a rotation happened. */
  readonly rotated: boolean;
}

/**
 * Build the queue shown below the turn head (REQ-CBA-030).
 *
 * The initiative order is a ring, and the panel enters it at the current turn: what a
 * player wants to know is how many participants stand between them and their own turn, and
 * a list that always starts at the highest initiative makes that a counting exercise. So
 * the order is **rotated from the participant of the turn** — first who still acts this
 * round, then who already acted (REQ-CBA-030), with the second half kept as its own,
 * labelled group (REQ-CBA-031).
 *
 * The participant of the turn is not in the queue at all: it is the head (REQ-CBA-020),
 * and REQ-CBA-030 lists "os demais".
 *
 * The active participant is resolved by `TrackerRow.isActive` — which `buildTrackerRows`
 * derives from `activeCombatantId`, not from `turnIndex`, so the rotation is stable under
 * redaction (a player's array is missing rows the GM's has).
 *
 * `canSeeHidden` is the same defense in depth `redactCombatForViewer` applies (REQ-CBA-034,
 * REQ-CBT-031..033): the server already strips hidden combatants from a non-privileged
 * payload, and the queue refuses to draw one anyway. Filtering happens **before** the
 * rotation, so a hidden participant sitting between two visible ones does not leave a gap
 * or shift the split.
 *
 * @param rows         Rows in turn order, from {@link buildTrackerRows}.
 * @param canSeeHidden Whether the viewer's role may see hidden participants.
 */
export function buildRotatedQueue(
  rows: readonly TrackerRow[],
  canSeeHidden: boolean,
): RotatedQueue {
  const visible = canSeeHidden ? rows : rows.filter((row) => !row.isHidden);
  const activeIndex = visible.findIndex((row) => row.isActive);

  if (activeIndex === -1) {
    // No turn in progress (montagem, or an active participant this viewer cannot see):
    // there is nothing to rotate around, and nobody has acted yet.
    const entries = visible.map<QueueEntry>((row, index) => ({
      row,
      group: "upcoming",
      queueIndex: index,
    }));
    return { upcoming: entries, acted: [], entries, rotated: false };
  }

  const upcoming = visible.slice(activeIndex + 1).map<QueueEntry>((row, index) => ({
    row,
    group: "upcoming",
    queueIndex: index,
  }));
  const acted = visible.slice(0, activeIndex).map<QueueEntry>((row, index) => ({
    row,
    group: "acted",
    queueIndex: upcoming.length + index,
  }));

  return { upcoming, acted, entries: [...upcoming, ...acted], rotated: true };
}

// ---------------------------------------------------------------------------
// Reordering the queue (REQ-CBA-035)
// ---------------------------------------------------------------------------

/**
 * Move one participant `delta` places in the turn order — the keyboard alternative to
 * dragging (REQ-CBA-035, REQ-CBA-093).
 *
 * Operates on the **underlying** turn order, not on the rotated view: rotation is a way of
 * reading the ring, while the order sent to the server is the ring itself.
 *
 * Returns `null` when nothing would change — unknown id, zero delta, or a move off either
 * end. A caller that gets `null` must not emit `combat:reorder`: re-sending the order that
 * is already stored is a write with no reader.
 */
export function moveCombatantInOrder(
  order: readonly string[],
  id: string,
  delta: number,
): string[] | null {
  const from = order.indexOf(id);
  if (from === -1 || delta === 0) return null;

  const to = from + delta;
  if (to < 0 || to >= order.length) return null;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Move `sourceId` to sit immediately before `targetId` — what dropping one row onto
 * another means (REQ-CBA-035).
 *
 * Returns `null` when the gesture is not a reorder: dropping a row onto itself, or either
 * id missing from the order.
 */
export function moveCombatantBefore(
  order: readonly string[],
  sourceId: string,
  targetId: string,
): string[] | null {
  if (sourceId === targetId) return null;
  if (!order.includes(sourceId) || !order.includes(targetId)) return null;

  const next = order.filter((id) => id !== sourceId);
  next.splice(next.indexOf(targetId), 0, sourceId);
  return next;
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

// ---------------------------------------------------------------------------
// Active-combat resolution (GRUPO 4 / combat panel deadlock fix)
// ---------------------------------------------------------------------------

/**
 * Resolve "the" Combat the combat panel should display, scoped to the given
 * active scene.
 *
 * BUG FIX (combat panel deadlock, #6): the mirror can legitimately hold more
 * than one non-ended Combat document at a time — e.g. a stale/orphaned
 * Combat left over from a previous scene that was never explicitly ended.
 * The previous selection ("first non-ended Combat across the WHOLE world")
 * had no sceneId filter, so it could latch onto a Combat that does not
 * belong to the currently active scene, or fail to surface the active
 * scene's own Combat if an orphan from another scene sorted first. Either
 * way combatStore.combat diverged from "the active scene's Combat": the GM
 * would see the wrong encounter (or none), and combatActions.create() for
 * the real active scene would be rejected by the server with DEC-CBT-06
 * ("one active combat per scene") pointing at a combat the GM can't see or
 * act on — a dead end with no visible way out.
 *
 * Selection, scoped to `combats.filter(c => c.sceneId === activeSceneId)`:
 *   1. Prefer a started, non-ended combat (the in-progress encounter).
 *   2. Otherwise, the first non-ended combat (not yet started).
 *   3. null if the active scene has no non-ended combat.
 *
 * When `activeSceneId` is null (no scene active yet), returns null — there is
 * no scene to scope the search to.
 */
export function resolveActiveCombat(
  combats: CombatDocument[],
  activeSceneId: string | null,
): CombatDocument | null {
  if (activeSceneId === null) return null;
  const forScene = combats.filter((c) => c.sceneId === activeSceneId);
  return forScene.find((c) => c.started && !c.ended) ?? forScene.find((c) => !c.ended) ?? null;
}

/**
 * Extract the conflicting combatId from a DEC-CBT-06 rejection message, if
 * present.
 *
 * Self-heal defense-in-depth (GRUPO 4, combat panel deadlock #6): the server
 * embeds `combatId=<id>` in the VALIDATION_FAILED message when combat:create
 * is rejected because a non-ended Combat already exists for the scene (see
 * buildCombatCreateHandler in combat-handlers.ts). If the client's local
 * combatStore.combat is out of sync with the server for any reason (stale
 * mirror, a race between two GMs), this lets the client recognize the
 * situation and reconcile instead of dead-ending on a "Create Combat" button
 * that will always fail the same way.
 *
 * Returns null if the message doesn't match the expected shape (e.g. a
 * different VALIDATION_FAILED cause, or a future server that no longer
 * includes the id — parsing failure must never throw).
 */
export function extractConflictingCombatId(message: string): string | null {
  const match = /combatId=([A-Za-z0-9]+)/.exec(message);
  return match?.[1] ?? null;
}
