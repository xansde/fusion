<script lang="ts">
  /**
   * StatusStrip.svelte — the status strip of the action bar (BAR-F1-04; spec 53 REQ-BAR-027,
   * REQ-BAR-028, REQ-BAR-036..040, D-B23; prototype `.ab-state`).
   *
   * Four columns: who (portrait, name, classes), life (hit points with the temporary ones, then the
   * resources that matter in the turn), situation (condition chips and the marked target) and turn
   * (whose turn it is and the MAP of the next attack). Everything but the turn comes from the
   * system's `provider.status`; the turn is the combat tab's own data, decided in `turn.ts`.
   *
   * What it does NOT do, on purpose:
   *  - **No action counter** (D-15, REQ-BAR-036): no pips of "ações restantes", no budget. Pips here
   *    are RESOURCES the provider declares (Focus, Hero) — a number the actor has, not a count the
   *    bar keeps.
   *  - **Never shows `gmOnly` to a player** (T6): the armour class of an NPC is the Mestre's. The
   *    provider already leaves the field empty for a player; the strip ignores it all the same.
   *  - **Conditions show only their name** (D-B23): a click reveals the effect, a second click folds
   *    it. Chips are drawn in the "situation" tone — the status contract carries no tone, and the
   *    client has no access to the system's declaration yet (the combat tab degrades the same way).
   */

  import ActorPortrait from "$lib/components/common/ActorPortrait.svelte";
  import { t } from "../../lib/i18n/i18n.js";
  import { releaseFocusAfterPointer } from "../../lib/actionbar/slotFocus.js";
  import {
    formatMapPenalty,
    hpPercent,
    hpTone,
    tempPercent,
  } from "../../lib/actionbar/statusModel.js";
  import type { TurnView } from "../../lib/actionbar/turn.js";
  import type { ActionBarStatus } from "../../lib/actionbar/types.js";
  import ConditionEffect from "./ConditionEffect.svelte";

  interface Props {
    status: ActionBarStatus;
    /** The actor this bar draws: the portrait asks the server for a grant on THIS document. */
    actorId: string;
    /** The viewer is the privileged seat: only then does `status.gmOnly` count. */
    viewerIsGm: boolean;
    /** `actor.type`, for the seal of the Mestre ("Mestre · NPC"). */
    actorType: string;
    turn: TurnView;
    /** What the strike under the mouse does to the next attack ("depois deste: MAP −10"), or null. */
    preview: string | null;
    /** The condition whose effect is revealed, or null. */
    openCondition: string | null;
    ontogglecondition: (id: string) => void;
    onclosecondition: () => void;
    collapsed: boolean;
    onexpand: () => void;
  }

  const {
    status,
    actorId,
    viewerIsGm,
    actorType,
    turn,
    preview,
    openCondition,
    ontogglecondition,
    onclosecondition,
    collapsed,
    onexpand,
  }: Props = $props();

  const fill = $derived(hpPercent(status.hp.value, status.hp.max));
  const temp = $derived(tempPercent(status.hp.temp, status.hp.max, fill));
  const armourClass = $derived(viewerIsGm ? status.gmOnly?.ac : undefined);

  let chipElements = $state<Record<string, HTMLElement | null>>({});

  function labelOf(condition: ActionBarStatus["conditions"][number]): string {
    return condition.value === undefined ? condition.name : `${condition.name} ${String(condition.value)}`;
  }

  function toggle(event: MouseEvent, id: string): void {
    releaseFocusAfterPointer(event, document);
    ontogglecondition(id);
  }

  function expand(event: MouseEvent): void {
    releaseFocusAfterPointer(event, document);
    onexpand();
  }
</script>

<div class="ab-state" class:ab-state--collapsed={collapsed}>
  <!-- Who -->
  <div class="who">
    <!-- The shared portrait: a stored image is a /assets/* path, and that route wants a short grant a
         bare <img> cannot send, so it is resolved there (never `src={status.portrait}` here); with no
         usable image it paints the initials. Decorative: the name is written beside it. -->
    <ActorPortrait
      img={status.portrait}
      docRef={{ table: "actors", id: actorId }}
      name={status.name}
      size={40}
    />
    <span class="who__id">
      <span class="who__name">{status.name}</span>
      {#if status.subtitle !== undefined && status.subtitle !== ""}
        <span class="who__cls">{status.subtitle}</span>
      {/if}
    </span>
  </div>

  <!-- Life -->
  <div class="col">
    <div
      class="hp"
      role="img"
      aria-label={t("FUSION.ActionBar.Hp.Label", { value: status.hp.value, max: status.hp.max })}
    >
      <span class="hp__lb" aria-hidden="true">{t("FUSION.ActionBar.Hp")}</span>
      <span class="hp__track" aria-hidden="true">
        <span class="hp__fill hp__fill--{hpTone(fill)}" style:width="{fill}%"></span>
        {#if temp > 0}<span class="hp__tmp" style:width="{temp}%"></span>{/if}
      </span>
      <span class="hp__txt" aria-hidden="true">
        <b>{status.hp.value}</b>/{status.hp.max}
        {#if status.hp.temp > 0}
          <span class="hp__tmpt">+{t("FUSION.ActionBar.Hp.Temp", { value: status.hp.temp })}</span>
        {/if}
      </span>
    </div>
    <div class="resrow">
      {#if armourClass !== undefined}
        <span class="ac">{t("FUSION.ActionBar.Ac")} <b>{armourClass}</b></span>
      {/if}
      {#each status.resources as resource (resource.id)}
        <span class="res" data-resource={resource.id}>
          {resource.label}
          {#if resource.style === "pips"}
            <span class="pips" aria-hidden="true">
              {#each { length: resource.max } as _, pip (pip)}
                <span class="pip" class:pip--on={pip < resource.value}></span>
              {/each}
            </span>
            <span class="sr-only">{resource.value}/{resource.max}</span>
          {:else}
            <b>{resource.value}/{resource.max}</b>
          {/if}
        </span>
      {/each}
      {#if viewerIsGm}
        <span class="seal-gm"
          >{actorType === "npc" ? t("FUSION.ActionBar.GmSeal.Npc") : t("FUSION.ActionBar.GmSeal")}</span
        >
      {/if}
    </div>
  </div>

  <!-- Situation -->
  <div class="col">
    <div class="chips" role="group" aria-label={t("FUSION.ActionBar.Conditions")}>
      {#each status.conditions as condition (condition.id)}
        {@const label = labelOf(condition)}
        {#if condition.effect !== undefined && condition.effect !== ""}
          <button
            type="button"
            class="chip chip--special"
            class:is-open={openCondition === condition.id}
            bind:this={chipElements[condition.id]}
            aria-expanded={openCondition === condition.id ? "true" : "false"}
            aria-controls="ab-condition-{condition.id}"
            aria-label={t("FUSION.ActionBar.Condition.Effect", { name: label })}
            data-condition={condition.id}
            onclick={(event) => {
              toggle(event, condition.id);
            }}>{label}</button
          >
          {#if openCondition === condition.id}
            <ConditionEffect
              id="ab-condition-{condition.id}"
              anchor={chipElements[condition.id] ?? null}
              name={label}
              effect={condition.effect}
              onclose={onclosecondition}
            />
          {/if}
        {:else}
          <span class="chip chip--special chip--static" data-condition={condition.id}>{label}</span>
        {/if}
      {:else}
        <span class="tgt">{t("FUSION.ActionBar.NoConditions")}</span>
      {/each}
    </div>
    <div class="tgt">
      {#if status.target === null}
        {t("FUSION.ActionBar.NoTarget")}
      {:else if status.target.name === ""}
        {t("FUSION.ActionBar.Target.Unnamed")}
      {:else}
        {t("FUSION.ActionBar.Target")} <b>{status.target.name}</b>
      {/if}
    </div>
  </div>

  <!-- Turn -->
  <div class="col ab-turn" class:is-preview={preview !== null}>
    {#if turn.kind === "mine"}
      <span class="turn turn--mine">{t("FUSION.ActionBar.Turn.Mine", { round: turn.round })}</span>
    {:else if turn.kind === "actor"}
      <span class="turn turn--mine"
        >{t("FUSION.ActionBar.Turn.Actor", { name: turn.name, round: turn.round })}</span
      >
    {:else if turn.kind === "other"}
      <span class="turn turn--other">{t("FUSION.ActionBar.Turn.Other", { name: turn.name })}</span>
    {:else if turn.kind === "running"}
      <span class="turn turn--other">{t("FUSION.ActionBar.Turn.Running", { round: turn.round })}</span>
    {:else}
      <span class="turn turn--out">{t("FUSION.ActionBar.Turn.Out")}</span>
    {/if}
    {#if status.nextAttack !== undefined}
      <span class="nxt">
        {#if preview !== null}
          <span class="pv">{preview}</span>
        {:else}
          {t("FUSION.ActionBar.NextAttack")}
          <b>{t("FUSION.ActionBar.Map", { penalty: formatMapPenalty(status.nextAttack.mapPenalty) })}</b>
        {/if}
      </span>
    {/if}
  </div>

  {#if collapsed}
    <button
      type="button"
      class="ab-expand"
      aria-label={t("FUSION.ActionBar.Expand")}
      data-action="expand"
      onclick={expand}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  {/if}
</div>

<style>
  /* The prototype's `.ab-state`: who | life | situation | turn. */
  .ab-state {
    display: grid;
    grid-template-columns: auto minmax(150px, 1fr) minmax(130px, 1fr) auto;
    column-gap: 14px;
    align-items: center;
    min-height: 56px;
    padding: 8px 10px;
  }

  .ab-state--collapsed {
    grid-template-columns: auto minmax(150px, 1fr) minmax(130px, 1fr) auto auto;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .who__id {
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 150px;
  }

  .who__name {
    overflow: hidden;
    font-size: 0.8125rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who__cls {
    overflow: hidden;
    color: var(--fusion-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ----- Life ----- */

  .hp {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hp__lb {
    color: var(--fusion-text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .hp__track {
    display: flex;
    flex: 1;
    height: 0.375rem;
    overflow: hidden;
    border-radius: var(--fusion-radius-pill);
    background: var(--fusion-surface);
  }

  .hp__fill {
    display: block;
    height: 100%;
  }

  .hp__fill--success {
    background: var(--fusion-success);
  }

  .hp__fill--warning {
    background: var(--fusion-warning);
  }

  .hp__fill--danger {
    background: var(--fusion-danger);
  }

  .hp__tmp {
    display: block;
    height: 100%;
    background: var(--fusion-accent);
  }

  .hp__txt {
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .hp__txt b {
    color: var(--fusion-text);
    font-weight: 600;
  }

  .hp__tmpt {
    color: var(--fusion-accent-hover);
  }

  /* Armour class, resources and the Mestre's seal can be more than the column holds (a Mestre looking
     at a character with Focus and Hero): they wrap to a second line rather than run under the next
     column. */
  .resrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    min-width: 0;
    color: var(--fusion-text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .res {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .res b,
  .ac b {
    color: var(--fusion-text);
  }

  .pips {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    color: var(--fusion-accent-hover);
  }

  .pip {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 2px;
    border: 1px solid currentColor;
    border-radius: 50%;
  }

  .pip--on {
    background: currentColor;
  }

  /* Resource pips: the hero points are amber in the prototype; the provider names the resource. */
  .res[data-resource="hero"] .pips {
    color: var(--fusion-warning);
  }

  .seal-gm {
    display: inline-block;
    padding: 0 5px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent-hover);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    vertical-align: 1px;
  }

  /* ----- Situation ----- */

  /* Many conditions wrap instead of running under the turn column. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 18px;
  }

  /* 24 px tall: a chip that opens its effect is a click target (REQ-A11-044). */
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    min-height: 24px;
    padding: 1px 7px;
    border: 1px solid var(--ink);
    border-radius: var(--fusion-radius-pill);
    background: var(--wash);
    color: var(--ink);
    font-family: var(--fusion-font);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
    cursor: pointer;
  }

  .chip--special {
    --ink: var(--fusion-accent-hover);
    --wash: var(--fusion-accent-dim);
  }

  .chip--static {
    cursor: default;
  }

  .chip:focus-visible,
  .chip.is-open {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: 1px;
  }

  .tgt {
    overflow: hidden;
    color: var(--fusion-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tgt b {
    color: var(--fusion-text);
    font-weight: 600;
  }

  /* ----- Turn ----- */

  .ab-turn {
    align-items: flex-end;
    text-align: right;
  }

  .turn {
    display: inline-block;
    padding: 1px 8px;
    border-radius: var(--fusion-radius-sm);
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }

  .turn--mine {
    background: var(--fusion-warning-dim);
    color: var(--fusion-warning);
  }

  .turn--other {
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .turn--out {
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    font-weight: 500;
  }

  .nxt {
    padding: 1px 6px;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .nxt b {
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* While the mouse is on a strike, the strip says what changes next (REQ-BAR-039). */
  .is-preview .nxt {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
  }

  .pv {
    color: var(--fusion-accent-hover);
    font-weight: 600;
  }

  .ab-expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text-muted);
    cursor: pointer;
  }

  .ab-expand:hover {
    color: var(--fusion-text);
  }

  .ab-expand:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .ab-expand svg {
    display: block;
    width: 16px;
    height: 16px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    border: 0;
    white-space: nowrap;
  }
</style>
