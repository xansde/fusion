/**
 * turnHead.svelte.ts — the height of the turn head, and the only gesture that changes it.
 *
 * Spec 40 (`specs/40-aba-combate.md`) §5.3, DEC-CBA-02. The most repeated gesture a GM
 * makes in a session is "next". A control that moves because this participant carries
 * seven conditions and the previous one carried none turns the most repeated operation
 * into the least precise one — so the head has a **fixed height, defined by a theme
 * token** (REQ-CBA-021), the advance control is anchored to its footer, and no piece of
 * data — a new condition, a long name, health — is allowed to change that height
 * (REQ-CBA-022, RNF-CBA-03). The head grows for exactly one reason: the user asked it to,
 * by opening the "+N" of the conditions (REQ-CBA-052) — and the next advance or rewind
 * throws that growth away (REQ-CBA-023), because the expansion belongs to the turn, not
 * to the panel.
 *
 * The geometry lives here, outside the component, for the same reason the drawer's
 * behaviour does: the client's Vitest runs in a node environment with no DOM, so a height
 * that only exists inside a `.svelte` file is a height no test can measure. What the
 * component does with these numbers is set one CSS height and let the footer sit on the
 * bottom edge; `TURN_HEAD_HEIGHT_REM` and `TURN_HEAD_FOOTER_HEIGHT_REM` are the mirror,
 * in TypeScript, of the two theme tokens in `styles/base.css` (kept honest by a test).
 *
 * Deliberately NOT here: which participants exist, what health a role may see, and what a
 * condition declares — those are the fila (G051), the health rules of §5.5 (G052) and the
 * system contract of REQ-SYS-043. This module knows a count and a boolean.
 */

import type { ConditionChipModel } from "../conditions/conditionChip.js";

// ---------------------------------------------------------------------------
// Theme tokens, mirrored
// ---------------------------------------------------------------------------

/** Custom property that defines the head's fixed height (REQ-CBA-021). */
export const TURN_HEAD_HEIGHT_TOKEN = "--fusion-combat-turn-head-height";

/** Custom property that defines the height of the anchored footer strip. */
export const TURN_HEAD_FOOTER_HEIGHT_TOKEN = "--fusion-combat-turn-head-footer-height";

/** Value of {@link TURN_HEAD_HEIGHT_TOKEN}, in rem. */
export const TURN_HEAD_HEIGHT_REM = 6.5;

/** Value of {@link TURN_HEAD_FOOTER_HEIGHT_TOKEN}, in rem. */
export const TURN_HEAD_FOOTER_HEIGHT_REM = 2.25;

/** Height of one extra row of condition tags, added only by an explicit expansion. */
export const TURN_HEAD_CONDITION_ROW_REM = 1.5;

/**
 * How many condition tags the head shows before collapsing the rest into "+N"
 * (REQ-CBA-051). Two is the spec's number, not a layout guess.
 */
export const TURN_HEAD_CONDITION_TAG_LIMIT = 2;

/**
 * How many tags fit on one row of the head at the drawer's fixed width (REQ-GAV-012):
 * the two visible tags plus the "+N" indicator. Used only to size an expansion.
 */
export const TURN_HEAD_CONDITION_ROW_CAPACITY = 3;

// ---------------------------------------------------------------------------
// Conditions shown in the head
// ---------------------------------------------------------------------------

/**
 * What the head needs from a condition: the SHARED chip model, whole.
 *
 * `id` and `label` are the shape the geometry was built against — something to key on and
 * something to write. The rest is the declared contract (REQ-SYS-043 with DEC-CTT-11, read
 * by REQ-CBA-050), which decides the chip's colour, its fill and its tooltip, never whether
 * the condition is drawn.
 *
 * It is an ALIAS rather than a narrower copy on purpose: the head draws
 * `components/common/ConditionChip.svelte`, the same component the contacts cards draw
 * (spec 39 §5.4), and that component takes a `ConditionView` whole — slug, name and value
 * included. A narrower local interface here would compile until the day the chip read one
 * more declared field, and then fail at the call site instead of at the contract.
 *
 * Ordering is NOT this module's: it belongs to the contract (REQ-CBA-051), and arrives
 * already applied.
 */
export type TurnHeadCondition = ConditionChipModel;

/**
 * Health of a participant, already resolved for the viewer's role.
 *
 * `null` — never a zeroed or full pair — is how the head is told there is nothing to draw,
 * either because the value is unresolvable or because this viewer may not see it
 * (REQ-CBA-041, REQ-CBA-043). The rule that produces the `null` is §5.5's, not the head's.
 */
export interface TurnHeadHealth {
  readonly current: number;
  readonly max: number;
}

/** What the head draws for a given list of conditions. */
export interface TurnHeadConditionsView {
  /** The tags actually drawn — capped at {@link TURN_HEAD_CONDITION_TAG_LIMIT} when collapsed. */
  readonly visible: readonly TurnHeadCondition[];
  /** How many are folded into the "+N" indicator; `0` means there is no indicator. */
  readonly overflow: number;
  /** How many conditions the participant has in total. */
  readonly total: number;
}

/**
 * Cap the condition tags for the head (REQ-CBA-051): two tags plus "+N" while collapsed,
 * the whole list once the user opened it (REQ-CBA-052).
 *
 * The order that arrives is the order that is drawn — this function never sorts, because
 * the grouping rule (critical, penalties, situations, benefits) belongs to the condition
 * contract, not to the head.
 */
export function summarizeTurnHeadConditions(
  conditions: readonly TurnHeadCondition[],
  expanded: boolean,
): TurnHeadConditionsView {
  const total = conditions.length;
  if (expanded || total <= TURN_HEAD_CONDITION_TAG_LIMIT) {
    return { visible: conditions, overflow: 0, total };
  }
  return {
    visible: conditions.slice(0, TURN_HEAD_CONDITION_TAG_LIMIT),
    overflow: total - TURN_HEAD_CONDITION_TAG_LIMIT,
    total,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Where the head ends and where its anchored control starts, both in rem. */
export interface TurnHeadMetrics {
  /** Total height of the head. */
  readonly heightRem: number;
  /** Distance from the top of the head to the top of the advance control. */
  readonly advanceControlTopRem: number;
}

/**
 * The head's geometry (REQ-CBA-021, REQ-CBA-022, RNF-CBA-03).
 *
 * Collapsed, the answer does not depend on `conditionCount` at all — that is the whole
 * point, and it is why the parameter is a count and not a participant: there is no data
 * this function could read that would move the button.
 *
 * Expanded (REQ-CBA-052), the head gains whole rows of tags, and the footer travels down
 * with it: `heightRem - advanceControlTopRem` is always the footer strip, so the control
 * never leaves the bottom edge of the head.
 */
export function turnHeadMetrics(conditionCount: number, expanded: boolean): TurnHeadMetrics {
  const extraRows = expanded
    ? Math.max(0, Math.ceil(Math.max(0, conditionCount) / TURN_HEAD_CONDITION_ROW_CAPACITY) - 1)
    : 0;
  const heightRem = TURN_HEAD_HEIGHT_REM + extraRows * TURN_HEAD_CONDITION_ROW_REM;
  return { heightRem, advanceControlTopRem: heightRem - TURN_HEAD_FOOTER_HEIGHT_REM };
}

// ---------------------------------------------------------------------------
// The turn the head is showing
// ---------------------------------------------------------------------------

/** The little the turn key needs from a combat document. */
export interface TurnHeadTurnSource {
  readonly round: number;
  readonly activeCombatantId: string | null;
}

/**
 * Identity of the current turn — the thing that changes when someone advances or rewinds.
 *
 * The round is part of it on purpose: a two-participant encounter that wraps around comes
 * back to the same participant, and that is still a new turn (REQ-CBA-023).
 */
export function turnKeyOf(source: TurnHeadTurnSource | null): string {
  if (source === null) return "";
  return `${String(source.round)}:${source.activeCombatantId ?? ""}`;
}

/**
 * The head's only mutable state: whether the user opened the conditions of *this* turn.
 *
 * Nothing here is persisted. Spec 40 §7 puts the "+N" expansion in "cliente, memória de
 * sessão": it dies with the turn (REQ-CBA-023), so writing it to `ClientUIPreferences`
 * would be storing something that is already stale by the time it is read.
 */
export class TurnHeadState {
  #turnKey = $state("");
  #expanded = $state(false);

  /** Whether the head is currently showing the whole condition list. */
  get expanded(): boolean {
    return this.#expanded;
  }

  /** Key of the turn the current expansion belongs to. Exposed for tests. */
  get turnKey(): string {
    return this.#turnKey;
  }

  /**
   * Tell the head which turn it is showing. A different key — advance, rewind, a new
   * round, a new encounter — drops the expansion the previous turn had (REQ-CBA-023).
   * The same key is a no-op, so a re-render never collapses what the user just opened.
   */
  syncTurn(turnKey: string): void {
    if (this.#turnKey === turnKey) return;
    this.#turnKey = turnKey;
    this.#expanded = false;
  }

  /** Open the full condition list (REQ-CBA-052) — the one gesture that grows the head. */
  expand(): void {
    this.#expanded = true;
  }

  /** Close it again, back to the fixed height (REQ-CBA-021). */
  collapse(): void {
    this.#expanded = false;
  }

  /** Toggle, for the single "+N" control the head draws. */
  toggle(): void {
    this.#expanded = !this.#expanded;
  }

  /** Geometry for a participant with `conditionCount` conditions, in the current state. */
  metrics(conditionCount: number): TurnHeadMetrics {
    return turnHeadMetrics(conditionCount, this.#expanded);
  }
}

/**
 * The head of the panel that is mounted. One drawer, one head — a second instance would
 * be a second combat panel, which the drawer does not have (REQ-GAV-017).
 */
export const turnHeadState: TurnHeadState = new TurnHeadState();
