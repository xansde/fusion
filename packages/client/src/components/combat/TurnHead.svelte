<script lang="ts">
  /**
   * TurnHead.svelte — the participant of the turn, at the top of the combat panel.
   *
   * Spec 40 (`specs/40-aba-combate.md`) §5.3 / DEC-CBA-02:
   *  - it sits above the fila and **outside the scrollable area** (REQ-CBA-020) — the
   *    panel gives it a fixed slot and scrolls the rest;
   *  - one height for every participant, from a theme token (REQ-CBA-021), with the
   *    advance control anchored to the head's own footer, on the same pixel every turn;
   *  - no data grows it (REQ-CBA-022, RNF-CBA-03): a seventh condition folds into "+N",
   *    a long name gets an ellipsis (REQ-CBA-025), health that cannot be resolved is
   *    omitted rather than drawn as an empty bar (REQ-CBA-043);
   *  - it grows for exactly one reason — the user opened the "+N" (REQ-CBA-052) — and
   *    the next advance or rewind takes that back (REQ-CBA-023), which is
   *    `TurnHeadState.syncTurn` in `lib/combat/turnHead.svelte.ts`;
   *  - "this one is yours" is said in words as well as in colour (REQ-CBA-024,
   *    REQ-CBA-094), and every control here is a real button, reachable by keyboard
   *    with visible focus (REQ-CBA-093).
   *
   * What this component does NOT decide: who may advance, whose health may be read, or
   * what a condition declares. Those arrive as props, from the panel — health by role is
   * §5.5, the condition contract is REQ-SYS-043 with DEC-CTT-11, and the server is what
   * actually refuses a forbidden advance (REQ-CBA-080, REQ-GAV-034).
   */

  import {
    TURN_HEAD_HEIGHT_TOKEN,
    summarizeTurnHeadConditions,
    turnHeadState as sharedTurnHeadState,
  } from "../../lib/combat/turnHead.svelte.js";
  import type {
    TurnHeadCondition,
    TurnHeadHealth,
    TurnHeadState,
  } from "../../lib/combat/turnHead.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import ConditionChip from "../common/ConditionChip.svelte";

  interface Props {
    /** Participant's display name; truncated with an ellipsis when it does not fit. */
    name: string;
    /** Portrait, or `null` for the drawn placeholder. */
    img?: string | null;
    /** Whether the participant of the turn belongs to this user (REQ-CBA-024). */
    isYours?: boolean;
    /** Whether the participant is marked defeated (REQ-CBA-033). */
    defeated?: boolean;
    /**
     * Health to draw, or `null` to omit it. `null` is the honest answer whenever the
     * value is not resolvable **or** this viewer may not see it (REQ-CBA-041/043) — the
     * head never invents a full or empty bar to fill the space.
     */
    health?: TurnHeadHealth | null;
    /** Active conditions, already ordered by the system's contract (REQ-CBA-050/051). */
    conditions?: readonly TurnHeadCondition[];
    /** Whether this user may advance the turn from here (REQ-CBA-071/072). */
    canAdvance?: boolean;
    /** Whether this user may rewind the turn from here (REQ-CBA-071). */
    canPrevious?: boolean;
    /** Label of the advance control — "next turn" for the GM, "end my turn" for a player. */
    advanceLabel?: string | undefined;
    /** Fired by the anchored control. The server is what validates it (REQ-CBA-080). */
    onAdvance?: (() => void) | undefined;
    /** Fired by the rewind control. */
    onPrevious?: (() => void) | undefined;
    /** An operation is in flight; controls are disabled but keep their place. */
    busy?: boolean;
    /** The expansion state to read and write. Injectable so tests own their own. */
    state?: TurnHeadState;
  }

  const {
    name,
    img = null,
    isYours = false,
    defeated = false,
    health = null,
    conditions = [],
    canAdvance = false,
    canPrevious = false,
    advanceLabel,
    onAdvance,
    onPrevious,
    busy = false,
    state = sharedTurnHeadState,
  }: Props = $props();

  const expanded = $derived(state.expanded);
  const conditionsView = $derived(summarizeTurnHeadConditions(conditions, expanded));
  const metrics = $derived(state.metrics(conditions.length));

  /**
   * Collapsed, the height is the token itself, so the markup carries no number at all and
   * three different participants produce the very same attribute (RNF-CBA-03). Expanded,
   * the head takes the height the model computed for the rows the user asked to see.
   */
  const heightStyle = $derived(
    expanded ? `${String(metrics.heightRem)}rem` : `var(${TURN_HEAD_HEIGHT_TOKEN})`,
  );

  /** Health as a percentage, clamped — the bar is never allowed past its own ends. */
  const healthPercent = $derived(
    health !== null && health.max > 0
      ? Math.max(0, Math.min(100, Math.round((health.current / health.max) * 100)))
      : 0,
  );

  const advanceText = $derived(advanceLabel ?? t("FUSION.Combat.TurnHead.Advance"));
</script>

<section
  class="turn-head"
  class:turn-head--yours={isYours}
  class:turn-head--expanded={expanded}
  style:height={heightStyle}
  aria-label={t("FUSION.Combat.TurnHead.Label")}
>
  <div class="turn-head__body">
    <div class="turn-head__portrait">
      {#if img}
        <img class="turn-head__img" src={img} alt="" loading="lazy" />
      {:else}
        <!-- Drawn placeholder, never an emoji (REQ-NPC-094): the initial of the name. -->
        <span class="turn-head__img-placeholder" aria-hidden="true"
          >{name.charAt(0).toUpperCase()}</span
        >
      {/if}
    </div>

    <div class="turn-head__ident">
      <span class="turn-head__name" title={name}>{name}</span>

      <span class="turn-head__marks">
        {#if isYours}
          <!-- REQ-CBA-024 / REQ-CBA-094: said in words, not only in the border colour. -->
          <span class="turn-head__mark turn-head__mark--yours">
            {t("FUSION.Combat.TurnHead.YourTurn")}
          </span>
        {/if}
        {#if defeated}
          <span class="turn-head__mark turn-head__mark--defeated">
            {t("FUSION.Combat.Defeated")}
          </span>
        {/if}
      </span>

      {#if health !== null}
        <!-- REQ-CBA-040/042: bar and number together; the number is what carries the
             level when colour cannot. Omitted entirely when null (REQ-CBA-043). -->
        <div
          class="turn-head__health"
          aria-label={t("FUSION.Combat.TurnHead.Health", {
            current: health.current,
            max: health.max,
          })}
        >
          <span class="turn-head__health-track" aria-hidden="true">
            <span class="turn-head__health-fill" style:width={`${String(healthPercent)}%`}></span>
          </span>
          <span class="turn-head__health-text">{health.current}/{health.max}</span>
        </div>
      {/if}
    </div>

    {#if conditionsView.total > 0}
      <ul class="turn-head__conditions" aria-label={t("FUSION.Combat.TurnHead.Conditions")}>
        {#each conditionsView.visible as condition (condition.id)}
          <!-- REQ-CBA-050: the chip is the shared one — colour by declared tone, fill for
               critical, drawn tooltip — so the head, the queue and a contact card cannot
               drift apart (DEC-CTT-11). -->
          <li class="turn-head__condition">
            <ConditionChip
              label={condition.label}
              tone={condition.tone}
              critical={condition.critical}
              help={condition.help}
            />
          </li>
        {/each}

        {#if conditionsView.overflow > 0 || expanded}
          <li class="turn-head__condition-more">
            <!-- REQ-CBA-052: the only gesture allowed to grow the head, in the panel
                 itself — no window, no change of drawer width. -->
            <button
              type="button"
              class="turn-head__more-btn"
              aria-expanded={expanded}
              aria-label={expanded
                ? t("FUSION.Combat.TurnHead.CollapseConditions")
                : t("FUSION.Combat.TurnHead.ExpandConditions", { count: conditionsView.total })}
              onclick={() => {
                state.toggle();
              }}
            >
              {#if expanded}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  focusable="false"
                  aria-hidden="true"
                >
                  <path d="M6 15l6-6 6 6" />
                </svg>
              {:else}
                +{conditionsView.overflow}
              {/if}
            </button>
          </li>
        {/if}
      </ul>
    {/if}
  </div>

  <!-- The anchored footer. It is absolutely positioned against the head, so the advance
       control sits on the same coordinate for every participant (REQ-CBA-021) and travels
       with the head only when the user expanded it (REQ-CBA-022). -->
  <div class="turn-head__footer">
    {#if canPrevious}
      <button
        type="button"
        class="turn-head__previous"
        disabled={busy}
        aria-label={t("FUSION.Combat.PreviousTurn")}
        title={t("FUSION.Combat.PreviousTurn")}
        onclick={() => onPrevious?.()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
    {/if}

    {#if canAdvance}
      <button
        type="button"
        class="turn-head__advance"
        data-turn-head-advance
        disabled={busy}
        onclick={() => onAdvance?.()}
      >
        {advanceText}
      </button>
    {/if}
  </div>
</section>

<style>
  /* REQ-CBA-021: one height for every participant, from the theme token. `overflow:
     hidden` is what makes REQ-CBA-025 true — what does not fit is cut at the edge of the
     body, never at the edge of a control, because the controls live in the footer below. */
  .turn-head {
    position: relative;
    flex-shrink: 0;
    box-sizing: border-box;
    height: var(--fusion-combat-turn-head-height);
    overflow: hidden;
    border-bottom: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
  }

  /* REQ-CBA-024: the "it is yours" state has a shape (the left bar) and a word (the
     mark inside), never colour alone (REQ-CBA-094). */
  .turn-head--yours {
    border-left: 3px solid var(--fusion-warning);
  }

  .turn-head__body {
    display: flex;
    box-sizing: border-box;
    height: calc(100% - var(--fusion-combat-turn-head-footer-height));
    gap: 0.5rem;
    padding: 0.5rem 0.625rem 0.25rem;
    overflow: hidden;
  }

  .turn-head__portrait {
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
  }

  .turn-head__img,
  .turn-head__img-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--fusion-radius-sm);
    object-fit: cover;
  }

  .turn-head__img-placeholder {
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    color: var(--fusion-text-muted);
    font-size: 1rem;
    font-weight: 600;
  }

  .turn-head__ident {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  /* REQ-CBA-025: a name too long for the drawer's fixed width ends in an ellipsis, on
     one line — it never wraps into a second row that would push the head open. */
  .turn-head__name {
    overflow: hidden;
    color: var(--fusion-text);
    font-size: 0.875rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .turn-head__marks {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.25rem;
    overflow: hidden;
  }

  .turn-head__mark {
    flex-shrink: 0;
    padding: 0 0.25rem;
    border-radius: var(--fusion-radius-sm);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .turn-head__mark--yours {
    background: var(--fusion-warning-dim);
    color: var(--fusion-warning);
  }

  .turn-head__mark--defeated {
    background: var(--fusion-danger-dim);
    color: var(--fusion-danger);
  }

  .turn-head__health {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .turn-head__health-track {
    display: block;
    flex: 1;
    height: 0.375rem;
    border-radius: var(--fusion-radius-pill);
    background: var(--fusion-surface);
    overflow: hidden;
  }

  .turn-head__health-fill {
    display: block;
    height: 100%;
    background: var(--fusion-success);
  }

  .turn-head__health-text {
    flex-shrink: 0;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  /* REQ-CBA-051: two tags plus "+N", on one row. `overflow: hidden` keeps a stubborn
     third tag from ever reaching the footer. */
  .turn-head__conditions {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 0.2rem;
    max-width: 45%;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: hidden;
  }

  /* The tag itself is ConditionChip (REQ-CBA-050); the item only places it, and lets it
     shrink so a long label truncates instead of pushing the row (REQ-CTT-038). */
  .turn-head__condition {
    display: flex;
    min-width: 0;
    max-width: 100%;
    list-style: none;
  }

  .turn-head__condition-more {
    list-style: none;
  }

  .turn-head__more-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  /* REQ-CBA-021 / RNF-CBA-03: anchored to the bottom edge of the head. Nothing in the
     body can move it, because the body is not in its flow. */
  .turn-head__footer {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    box-sizing: border-box;
    height: var(--fusion-combat-turn-head-footer-height);
    gap: 0.25rem;
    padding: 0 0.625rem 0.375rem;
  }

  .turn-head__advance,
  .turn-head__previous {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.625rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .turn-head__previous {
    width: 1.625rem;
    padding: 0;
  }

  .turn-head__advance {
    padding: 0 0.75rem;
    border-color: transparent;
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-weight: 600;
  }

  .turn-head__advance:hover:not(:disabled),
  .turn-head__previous:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
    color: var(--fusion-on-accent);
  }

  .turn-head__advance:disabled,
  .turn-head__previous:disabled,
  .turn-head__more-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  /* REQ-CBA-093 / REQ-UIF-064: every control here is keyboard-operable with visible focus. */
  .turn-head__advance:focus-visible,
  .turn-head__previous:focus-visible,
  .turn-head__more-btn:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }
</style>
