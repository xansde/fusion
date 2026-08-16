<script lang="ts">
  /**
   * CombatQueue.svelte — the fila under the turn head (spec 40 §5.4, task G051).
   *
   * What it draws is a queue already rotated from the current turn by
   * `buildRotatedQueue()` (REQ-CBA-030): first whoever still acts this round, then, in a
   * group of its own, whoever already acted. That second group is labelled and kept
   * (REQ-CBA-031) — a round has a shape, and dropping half of it to make the list shorter
   * is exactly the information a GM is looking for.
   *
   * Three states are said in words as well as in colour or weight (REQ-CBA-094):
   *  - defeat is a mark with a drawn icon and the word, plus a struck-through name, never
   *    just a faded row (REQ-CBA-033), and the participant stays in the queue;
   *  - hidden is a mark only a privileged role ever sees — and the entry is not in the
   *    queue at all for anyone else, because `buildRotatedQueue` filtered it before this
   *    component was given anything to draw (REQ-CBA-034);
   *  - the group a row belongs to is on the section, not only in the reading order.
   *
   * Reordering (REQ-CBA-035) has two doors into the same pure function: dragging a row
   * onto another (`moveCombatantBefore`) and the handle's arrow keys
   * (`moveCombatantInOrder`), so the gesture is operable without a pointer (REQ-CBA-093).
   * Both act on the **underlying** turn order the panel passes in, never on the rotated
   * view, and both refuse to emit when nothing would change.
   *
   * This component owns no socket and no store: everything it does leaves through a
   * callback. The panel is what talks to the server, and the server is what decides
   * whether a reorder is allowed (REQ-CBA-080).
   */

  import { moveCombatantBefore, moveCombatantInOrder } from "../../lib/combat/combatTracker.js";
  import type { QueueEntry, RotatedQueue } from "../../lib/combat/combatTracker.js";
  import type { CombatantVitals } from "../../lib/combat/combatVitals.js";
  import type {
    InitiativeCellView,
    InitiativeStatisticOption,
  } from "../../lib/combat/combatSetup.js";
  import { TURN_HEAD_CONDITION_TAG_LIMIT } from "../../lib/combat/turnHead.svelte.js";
  import ConditionChip from "../common/ConditionChip.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    /** The rotated queue, from `buildRotatedQueue()`. */
    queue: RotatedQueue;
    /**
     * Health and conditions per combatant id, already resolved for this viewer's role by
     * `buildCombatVitals()` (spec 40 §5.5/§5.6).
     *
     * The queue never decides who may read a health: it draws the pair it is given and
     * omits what it is not (REQ-CBA-041, REQ-CBA-043). Conditions arrive independently of
     * health, which is what keeps a creature's "Amedrontado 2" on a player's screen while
     * its hit points are not there (REQ-CBA-053).
     */
    vitals?: ReadonlyMap<string, CombatantVitals>;
    /**
     * What each participant's initiative cell may say, decided per viewer and per phase by
     * `buildInitiativeCells()` (REQ-CBA-064, REQ-CBA-067, REQ-CBA-070).
     *
     * The queue never decides this either: a row whose cell says `"concealed"` or
     * `"hidden-phase"` simply has no initiative cell drawn — no dash, no zero, nothing to
     * read a number out of. Without the map the queue draws no initiative at all, which is
     * the safe direction to fail in.
     */
    initiativeCells?: ReadonlyMap<string, InitiativeCellView> | undefined;
    /**
     * Statistics each participant could roll initiative with (REQ-CBA-066, Q-CBA-03),
     * keyed by combatant id. Absent or empty means the system declared no choice and the
     * roll gesture carries none — degradação aberta.
     */
    statisticOptions?: ReadonlyMap<string, readonly InitiativeStatisticOption[]> | undefined;
    /** Whether the viewer holds a privileged role (REQ-CBA-035). */
    gmControls?: boolean;
    /** An operation is in flight; controls are disabled but keep their place. */
    busy?: boolean;
    /** The underlying turn order (ids), which the reorder gestures rewrite. */
    order?: readonly string[];
    /** Ids the current user may roll initiative for (REQ-CBT-034). */
    rollable?: ReadonlySet<string>;
    onReorder?: ((order: string[]) => void) | undefined;
    /**
     * Roll one participant's initiative. The second argument is the statistic chosen in the
     * same gesture (REQ-CBA-066), or `null` for the system's default.
     */
    onRollInitiative?: ((combatantId: string, statistic: string | null) => void) | undefined;
    onToggleDefeated?: ((combatantId: string, defeated: boolean) => void) | undefined;
    onToggleHidden?: ((combatantId: string, hidden: boolean) => void) | undefined;
    onRemove?: ((combatantId: string) => void) | undefined;
    onSetInitiative?: ((combatantId: string, value: number | null) => void) | undefined;
  }

  const {
    queue,
    vitals,
    initiativeCells,
    statisticOptions,
    gmControls = false,
    busy = false,
    order = [],
    rollable = new Set<string>(),
    onReorder,
    onRollInitiative,
    onToggleDefeated,
    onToggleHidden,
    onRemove,
    onSetInitiative,
  }: Props = $props();

  // ---- Reorder (REQ-CBA-035) ----

  let dragSourceId = $state<string | null>(null);

  function emitOrder(next: string[] | null): void {
    if (next === null) return;
    onReorder?.(next);
  }

  function handleDragStart(id: string): void {
    dragSourceId = id;
  }

  function handleDrop(targetId: string): void {
    const source = dragSourceId;
    dragSourceId = null;
    if (source === null) return;
    emitOrder(moveCombatantBefore(order, source, targetId));
  }

  function handleDragEnd(): void {
    dragSourceId = null;
  }

  /** The keyboard alternative to dragging (REQ-CBA-035, REQ-CBA-093). */
  function handleHandleKey(event: KeyboardEvent, id: string): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    emitOrder(moveCombatantInOrder(order, id, delta));
  }

  // ---- Inline initiative edit ----

  let editingId = $state<string | null>(null);
  let editingValue = $state<string>("");

  function startEdit(id: string, current: number | null): void {
    editingId = id;
    editingValue = current !== null ? current.toString() : "";
  }

  function commitEdit(id: string): void {
    editingId = null;
    const raw = editingValue.trim();
    if (raw === "") {
      onSetInitiative?.(id, null);
      return;
    }
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return;
    onSetInitiative?.(id, value);
  }

  // ---- Initiative and the statistic chosen with it (REQ-CBA-064/066/067/070) ----

  /**
   * The chosen initiative statistic per participant, held only until the roll leaves
   * (REQ-CBA-066). It is a choice about the gesture, not state of the encounter: the server
   * records what the formula actually used, on the participant, when the roll resolves.
   */
  let chosenStatistic = $state<Record<string, string>>({});

  /** What this row's initiative cell may say — nothing at all, when there is no entry. */
  function cellOf(id: string): InitiativeCellView | null {
    return initiativeCells?.get(id) ?? null;
  }

  function optionsOf(id: string): readonly InitiativeStatisticOption[] {
    return statisticOptions?.get(id) ?? [];
  }

  function rollRow(id: string): void {
    onRollInitiative?.(id, chosenStatistic[id] ?? null);
  }

  /** Health of a row, or `null` — the two answers the queue can draw (REQ-CBA-043). */
  function healthOf(id: string): CombatantVitals["health"] {
    return vitals?.get(id)?.health ?? null;
  }

  /** Conditions of a row, already ordered by the contract (REQ-CBA-051). */
  function conditionsOf(id: string): CombatantVitals["conditions"] {
    return vitals?.get(id)?.conditions ?? [];
  }

  /** Percentage for the bar, clamped — the fill never runs past either end. */
  function healthPercent(health: NonNullable<CombatantVitals["health"]>): number {
    return Math.max(0, Math.min(100, Math.round((health.current / health.max) * 100)));
  }

  function rowLabel(entry: QueueEntry): string {
    const row = entry.row;
    const parts = [row.name];
    if (row.isDefeated) parts.push(t("FUSION.Combat.Defeated"));
    if (row.isHidden) parts.push(t("FUSION.Combat.Queue.Hidden"));
    parts.push(
      entry.group === "acted"
        ? t("FUSION.Combat.Queue.Acted")
        : t("FUSION.Combat.Queue.Upcoming"),
    );
    return parts.join(" — ");
  }
</script>

<!-- Drawn icons, never emoji: the queue says "defeated"/"hidden" in a word and repeats it
     in a shape, so neither state depends on colour alone (REQ-CBA-094). -->
{#snippet iconDefeated()}
  <svg class="icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4" />
    <line x1="2.9" y1="9.1" x2="9.1" y2="2.9" stroke="currentColor" stroke-width="1.4" />
  </svg>
{/snippet}

{#snippet iconHidden()}
  <svg class="icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path
      d="M0.9 6C2.5 3.6 4.2 2.4 6 2.4S9.5 3.6 11.1 6C9.5 8.4 7.8 9.6 6 9.6S2.5 8.4 0.9 6Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.1"
    />
    <circle cx="6" cy="6" r="1.4" fill="currentColor" />
    <line x1="1.6" y1="10.4" x2="10.4" y2="1.6" stroke="currentColor" stroke-width="1.3" />
  </svg>
{/snippet}

{#snippet iconGrip()}
  <svg class="icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <g fill="currentColor">
      <circle cx="4.4" cy="2.8" r="0.95" />
      <circle cx="7.6" cy="2.8" r="0.95" />
      <circle cx="4.4" cy="6" r="0.95" />
      <circle cx="7.6" cy="6" r="0.95" />
      <circle cx="4.4" cy="9.2" r="0.95" />
      <circle cx="7.6" cy="9.2" r="0.95" />
    </g>
  </svg>
{/snippet}

{#snippet iconDie()}
  <svg class="icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <rect
      x="1.3"
      y="1.3"
      width="9.4"
      height="9.4"
      rx="1.6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
    />
    <circle cx="4.1" cy="4.1" r="0.9" fill="currentColor" />
    <circle cx="7.9" cy="7.9" r="0.9" fill="currentColor" />
  </svg>
{/snippet}

{#snippet iconRemove()}
  <svg class="icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <line x1="2.6" y1="2.6" x2="9.4" y2="9.4" stroke="currentColor" stroke-width="1.4" />
    <line x1="9.4" y1="2.6" x2="2.6" y2="9.4" stroke="currentColor" stroke-width="1.4" />
  </svg>
{/snippet}

{#snippet queueRow(entry: QueueEntry)}
  {@const row = entry.row}
  {@const cell = cellOf(row.id)}
  {@const statistics = optionsOf(row.id)}
  <div
    class="combatant-row"
    class:combatant-row--acted={entry.group === "acted"}
    class:combatant-row--defeated={row.isDefeated}
    class:combatant-row--hidden={row.isHidden}
    class:combatant-row--drag-over={dragSourceId !== null && dragSourceId !== row.id}
    role="listitem"
    aria-label={rowLabel(entry)}
    draggable={gmControls}
    ondragstart={() => {
      handleDragStart(row.id);
    }}
    ondragover={(e) => {
      e.preventDefault();
    }}
    ondrop={() => {
      handleDrop(row.id);
    }}
    ondragend={handleDragEnd}
  >
    {#if gmControls}
      <button
        class="combatant-row__handle"
        type="button"
        aria-label={t("FUSION.Combat.Queue.Reorder", { name: row.name })}
        aria-keyshortcuts="ArrowUp ArrowDown"
        disabled={busy}
        onkeydown={(e) => {
          handleHandleKey(e, row.id);
        }}
      >
        {@render iconGrip()}
      </button>
    {/if}

    <div class="combatant-row__portrait" aria-hidden="true">
      {#if row.img}
        <img class="combatant-row__img" src={row.img} alt="" loading="lazy" />
      {:else}
        <span class="combatant-row__img-placeholder">{row.name.charAt(0).toUpperCase()}</span>
      {/if}
    </div>

    <div class="combatant-row__info">
      <span
        class="combatant-row__name"
        class:combatant-row__name--defeated={row.isDefeated}
        title={row.name}>{row.name}</span
      >

      <span class="combatant-row__marks">
        {#if row.isDefeated}
          <span class="combatant-row__mark combatant-row__mark--defeated">
            {@render iconDefeated()}
            <span class="combatant-row__mark-text">{t("FUSION.Combat.Defeated")}</span>
          </span>
        {/if}
        {#if row.isHidden}
          <span class="combatant-row__mark combatant-row__mark--hidden">
            {@render iconHidden()}
            <span class="combatant-row__mark-text">{t("FUSION.Combat.Queue.Hidden")}</span>
          </span>
        {/if}
      </span>

      {#if conditionsOf(row.id).length > 0}
        {@const chips = conditionsOf(row.id)}
        <!-- REQ-CBA-053: drawn whatever the health rule said above — a creature the player
             may not count still shows what the table can see. REQ-CBA-051: two tags plus
             "+N"; the expansion gesture is the head's alone (REQ-CBA-052), so here the
             indicator is a count, not a control. -->
        <ul
          class="combatant-row__conditions"
          aria-label={t("FUSION.Combat.Queue.Conditions", { name: row.name })}
        >
          {#each chips.slice(0, TURN_HEAD_CONDITION_TAG_LIMIT) as chip (chip.id)}
            <li class="combatant-row__condition">
              <!-- `ConditionChipModel` já é, campo a campo, o `ConditionView` que o chip
                   compartilhado desenha (spec 39 §5.4) — o prefixo do tooltip inclui a
                   linha porque a mesma condição aparece em vários combatentes. -->
              <ConditionChip condition={chip} tooltipId={`queue-${row.id}-${chip.id}`} />
            </li>
          {/each}
          {#if chips.length > TURN_HEAD_CONDITION_TAG_LIMIT}
            {@const overflow = chips.length - TURN_HEAD_CONDITION_TAG_LIMIT}
            <li
              class="combatant-row__condition-more"
              aria-label={t("FUSION.Combat.Queue.MoreConditions", { count: overflow })}
            >
              +{overflow}
            </li>
          {/if}
        </ul>
      {/if}
    </div>

    {#if healthOf(row.id)}
      {@const health = healthOf(row.id)!}
      <!-- REQ-CBA-040: bar AND number, for every participant a privileged role reads.
           REQ-CBA-042: the number is what says the level when colour cannot, so the bar is
           never the only carrier. A row with no health here is a row the rule of §5.5
           omitted (REQ-CBA-041) or one whose value did not resolve (REQ-CBA-043) — the
           panel draws neither a full bar nor a zero. -->
      <div
        class="combatant-row__health"
        aria-label={t("FUSION.Combat.Queue.Health", { current: health.current, max: health.max })}
      >
        <span class="combatant-row__health-track" aria-hidden="true">
          <span
            class="combatant-row__health-fill"
            style:width={`${String(healthPercent(health))}%`}
          ></span>
        </span>
        <span class="combatant-row__health-text">{health.current}/{health.max}</span>
      </div>
    {/if}

    <!-- ---- Initiative (REQ-CBA-064, REQ-CBA-067, REQ-CBA-070) ----
      Drawn only when this viewer, in this phase, is allowed to read it. A cell of kind
      "concealed" (a creature, seen by a player) or "hidden-phase" (the encounter is
      running, and DEC-CBA-04 removed the number for everyone) leaves nothing here at all —
      not a dash, not a zero, not a disabled control shaped like a number. -->
    {#if cell !== null && cell.kind !== "concealed" && cell.kind !== "hidden-phase"}
      <div class="combatant-row__initiative">
        {#if cell.editable && editingId === row.id}
          <input
            class="combatant-row__init-input"
            type="number"
            value={editingValue}
            oninput={(e) => {
              editingValue = (e.target as HTMLInputElement).value;
            }}
            onblur={() => {
              commitEdit(row.id);
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") commitEdit(row.id);
              if (e.key === "Escape") editingId = null;
            }}
            aria-label="{t('FUSION.Combat.SetInitiativeManually')} {row.name}"
          />
        {:else if cell.kind === "unrolled"}
          <!-- REQ-CBA-064: "ainda não rolou" is said, not left blank — an empty cell in a
               column of numbers reads as a zero. -->
          <button
            class="combatant-row__init-btn combatant-row__init-btn--unrolled"
            type="button"
            disabled={!cell.editable}
            title={cell.editable
              ? t("FUSION.Combat.SetInitiativeManually")
              : t("FUSION.Combat.Setup.Unrolled")}
            aria-label="{t('FUSION.Combat.Setup.Unrolled')} — {row.name}"
            onclick={() => {
              if (cell.editable) startEdit(row.id, row.initiative);
            }}
          >
            <span class="combatant-row__init-unrolled" aria-hidden="true">—</span>
          </button>
        {:else}
          <button
            class="combatant-row__init-btn"
            type="button"
            disabled={!cell.editable}
            title={cell.editable
              ? t("FUSION.Combat.SetInitiativeManually")
              : t("FUSION.Combat.Initiative", { value: row.initiativeLabel })}
            aria-label={t("FUSION.Combat.Initiative", { value: row.initiativeLabel })}
            onclick={() => {
              if (cell.editable) startEdit(row.id, row.initiative);
            }}
          >
            {row.initiativeLabel}
          </button>
        {/if}
      </div>
    {/if}

    <!-- ---- The player's own roll, and the statistic it uses (REQ-CBA-065/066) ----
      Outside `.combatant-row__actions` on purpose: that group fades in on hover, which is
      right for the GM's dense icon strip and wrong for the one control a player is supposed
      to find without knowing to point at the row first. -->
    {#if statistics.length > 0 && (gmControls || rollable.has(row.id))}
      <!-- REQ-CBA-066 / Q-CBA-03: the choice of statistic rides the roll gesture, beside
           the control that performs it, and only where a roll is on offer. The system
           declaring nothing costs the menu, never the roll. -->
      <select
        class="combatant-row__statistic"
        disabled={busy}
        aria-label={t("FUSION.Combat.Setup.Statistic", { name: row.name })}
        value={chosenStatistic[row.id] ?? ""}
        onchange={(e) => {
          chosenStatistic = {
            ...chosenStatistic,
            [row.id]: (e.currentTarget as HTMLSelectElement).value,
          };
        }}
      >
        <option value="">{t("FUSION.Combat.Setup.StatisticDefault")}</option>
        {#each statistics as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
    {/if}

    {#if !gmControls && rollable.has(row.id)}
      <button
        class="btn btn--primary btn--xs combatant-row__roll"
        type="button"
        disabled={busy}
        aria-label={t("FUSION.Combat.RollMyInitiative")}
        onclick={() => {
          rollRow(row.id);
        }}
      >
        {t("FUSION.Combat.RollMyInitiative")}
      </button>
    {/if}

    <!-- ---- The privileged strip (REQ-CBA-063, REQ-CBA-068, REQ-CBA-075) ----
      Marking a target is deliberately absent here, for every role (REQ-CBA-076, DEC-CBA-05):
      aiming is a spatial gesture and lives on the canvas (REQ-CBT-053..055). A list of names
      is a second door to the same thing, with less information. -->
    {#if gmControls}
      <div class="combatant-row__actions">
        <button
          class="action-btn"
          type="button"
          disabled={busy}
          title={t("FUSION.Combat.RollInitiative")}
          aria-label="{t('FUSION.Combat.RollInitiative')} {row.name}"
          onclick={() => {
            rollRow(row.id);
          }}
        >
          {@render iconDie()}
        </button>

        <button
          class="action-btn"
          class:action-btn--active={row.isDefeated}
          type="button"
          disabled={busy}
          title={row.isDefeated
            ? t("FUSION.Combat.UnmarkDefeated")
            : t("FUSION.Combat.MarkDefeated")}
          aria-label={row.isDefeated
            ? t("FUSION.Combat.UnmarkDefeated")
            : t("FUSION.Combat.MarkDefeated")}
          onclick={() => {
            onToggleDefeated?.(row.id, !row.isDefeated);
          }}
        >
          {@render iconDefeated()}
        </button>

        <button
          class="action-btn"
          class:action-btn--active={row.isHidden}
          type="button"
          disabled={busy}
          title={row.isHidden
            ? t("FUSION.Combat.RevealCombatant")
            : t("FUSION.Combat.HiddenFromPlayers")}
          aria-label={row.isHidden
            ? t("FUSION.Combat.RevealCombatant")
            : t("FUSION.Combat.HiddenFromPlayers")}
          onclick={() => {
            onToggleHidden?.(row.id, !row.isHidden);
          }}
        >
          {@render iconHidden()}
        </button>

        <button
          class="action-btn action-btn--danger"
          type="button"
          disabled={busy}
          title={t("FUSION.Combat.RemoveFromCombat")}
          aria-label="{t('FUSION.Combat.RemoveFromCombat')} {row.name}"
          onclick={() => {
            onRemove?.(row.id);
          }}
        >
          {@render iconRemove()}
        </button>
      </div>
    {/if}
  </div>
{/snippet}

<div class="combat-queue" aria-label={t("FUSION.Combat.Queue.Label")}>
  {#if queue.upcoming.length > 0}
    <section class="combat-queue__group combat-queue__group--upcoming">
      {#if queue.acted.length > 0}
        <h4 class="combat-queue__group-label">{t("FUSION.Combat.Queue.Upcoming")}</h4>
      {/if}
      <div class="combat-queue__rows" role="list" aria-label={t("FUSION.Combat.Queue.Upcoming")}>
        {#each queue.upcoming as entry (entry.row.id)}
          {@render queueRow(entry)}
        {/each}
      </div>
    </section>
  {/if}

  <!-- REQ-CBA-031: never omitted, and never silently appended to the group above. -->
  {#if queue.acted.length > 0}
    <section class="combat-queue__group combat-queue__group--acted">
      <h4 class="combat-queue__group-label">{t("FUSION.Combat.Queue.Acted")}</h4>
      <div class="combat-queue__rows" role="list" aria-label={t("FUSION.Combat.Queue.Acted")}>
        {#each queue.acted as entry (entry.row.id)}
          {@render queueRow(entry)}
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  /* The queue is the CONTENT of the panel's scroller (`.combat-panel__list`), never a
     scroller itself: a second one here would trap the wheel inside one of the groups and
     let the other one disappear (REQ-CBA-036). */
  .combat-queue {
    display: flex;
    flex-direction: column;
  }

  .combat-queue__group {
    display: flex;
    flex-direction: column;
  }

  .combat-queue__group-label {
    background: var(--fusion-surface);
    border-bottom: 1px solid var(--fusion-border);
    color: var(--fusion-text-subtle);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    padding: 0.25rem 0.6rem;
    position: sticky;
    text-transform: uppercase;
    top: 0;
    z-index: 1;
  }

  /* The group that already acted recedes as a block — but every individual state inside
     it still says itself in words, so recession is never the only signal (REQ-CBA-031). */
  .combat-queue__group--acted .combatant-row__name {
    color: var(--fusion-text-muted);
  }

  .combat-queue__group--acted .combat-queue__group-label {
    color: var(--fusion-text-subtle);
  }

  .combat-queue__rows {
    display: flex;
    flex-direction: column;
  }

  /* ---- Row ---- */
  .combatant-row {
    align-items: center;
    border-left: 3px solid transparent;
    display: flex;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem 0.3rem 0.35rem;
    transition: background-color var(--fusion-transition);
    user-select: none;
  }

  .combatant-row:hover {
    background: var(--fusion-surface-alt);
  }

  .combatant-row--acted {
    background: color-mix(in srgb, var(--fusion-surface-alt) 60%, transparent);
  }

  /* REQ-CBA-033: defeat is a struck-through name and a mark with a drawn icon and the
     word "Derrotado" — the fade below is the last of the three signals, never the only
     one, which is what REQ-CBA-094 asks for. */
  .combatant-row--defeated {
    border-left-color: var(--fusion-danger);
    opacity: 0.75;
  }

  .combatant-row--hidden {
    border-left-color: var(--fusion-accent);
  }

  .combatant-row--drag-over {
    border-top: 2px solid var(--fusion-accent);
  }

  /* ---- Drag handle / keyboard reorder (REQ-CBA-035, REQ-CBA-093) ---- */
  .combatant-row__handle {
    align-items: center;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: grab;
    display: flex;
    flex-shrink: 0;
    height: 1.4rem;
    justify-content: center;
    opacity: 0;
    padding: 0;
    transition: opacity var(--fusion-transition);
    width: 1rem;
  }

  .combatant-row:hover .combatant-row__handle {
    opacity: 1;
  }

  /* Keyboard reach is not a hover state: focusing the handle has to reveal it too. */
  .combatant-row__handle:focus-visible {
    opacity: 1;
    border-color: var(--fusion-accent);
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  /* ---- Portrait ---- */
  .combatant-row__portrait {
    flex-shrink: 0;
    height: 2rem;
    position: relative;
    width: 2rem;
  }

  .combatant-row__img {
    border-radius: var(--fusion-radius-sm);
    display: block;
    height: 2rem;
    object-fit: cover;
    width: 2rem;
  }

  .combatant-row__img-placeholder {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    display: flex;
    font-size: 0.875rem;
    font-weight: 600;
    height: 2rem;
    justify-content: center;
    width: 2rem;
  }

  /* ---- Identity ---- */
  .combatant-row__info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
    overflow: hidden;
  }

  .combatant-row__name {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .combatant-row__name--defeated {
    color: var(--fusion-text-subtle);
    text-decoration: line-through;
  }

  .combatant-row__marks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .combatant-row__mark {
    align-items: center;
    border: 1px solid currentColor;
    border-radius: var(--fusion-radius-sm);
    display: inline-flex;
    font-size: 0.625rem;
    gap: 0.15rem;
    letter-spacing: 0.03em;
    line-height: 1;
    padding: 0.05rem 0.25rem;
    text-transform: uppercase;
  }

  .combatant-row__mark--defeated {
    color: var(--fusion-danger);
  }

  .combatant-row__mark--hidden {
    color: var(--fusion-accent);
  }

  .combatant-row__mark-text {
    white-space: nowrap;
  }

  /* ---- Conditions (REQ-CBA-050/051/053) ---- */
  .combatant-row__conditions {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.2rem;
    list-style: none;
    margin: 0;
    min-width: 0;
    overflow: hidden;
    padding: 0;
  }

  .combatant-row__condition {
    display: flex;
    list-style: none;
    min-width: 0;
  }

  .combatant-row__condition-more {
    color: var(--fusion-text-muted);
    flex-shrink: 0;
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
    list-style: none;
  }

  /* ---- Health (REQ-CBA-040/042/043) ---- */
  .combatant-row__health {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: 0.3rem;
    width: 4.75rem;
  }

  .combatant-row__health-track {
    background: var(--fusion-surface);
    border-radius: var(--fusion-radius-pill);
    display: block;
    flex: 1;
    height: 0.325rem;
    overflow: hidden;
  }

  .combatant-row__health-fill {
    background: var(--fusion-success);
    display: block;
    height: 100%;
  }

  .combatant-row__health-text {
    color: var(--fusion-text-muted);
    flex-shrink: 0;
    font-family: var(--fusion-font-mono);
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
  }

  /* ---- Initiative ---- */
  .combatant-row__initiative {
    flex-shrink: 0;
    min-width: 2.25rem;
    text-align: right;
  }

  .combatant-row__init-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font-mono);
    font-size: 0.8125rem;
    font-weight: 600;
    min-width: 2rem;
    padding: 0.1rem 0.25rem;
    text-align: right;
  }

  .combatant-row__init-btn:not(:disabled):hover {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
  }

  .combatant-row__init-btn:disabled {
    cursor: default;
    opacity: 1;
  }

  /* REQ-CBA-064: the "has not rolled" cell must not read as a value. A dashed outline says
     "slot waiting to be filled" where a bare glyph would read as a figure. */
  .combatant-row__init-btn--unrolled {
    border-color: var(--fusion-border);
    border-style: dashed;
    color: var(--fusion-text-subtle);
  }

  .combatant-row__init-unrolled {
    font-family: var(--fusion-font-mono);
  }

  /* ---- Choice of initiative statistic (REQ-CBA-066) ---- */
  .combatant-row__statistic {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font);
    font-size: 0.6875rem;
    max-width: 6rem;
    padding: 0.05rem 0.2rem;
  }

  .combatant-row__init-input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    font-size: 0.8125rem;
    padding: 0.1rem 0.2rem;
    text-align: right;
    width: 3rem;
  }

  /* ---- Actions ---- */
  .combatant-row__actions {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  .combatant-row:hover .combatant-row__actions,
  .combatant-row__actions:focus-within {
    opacity: 1;
  }

  .action-btn {
    align-items: center;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    display: flex;
    height: 1.4rem;
    justify-content: center;
    padding: 0;
    transition:
      background-color var(--fusion-transition),
      color var(--fusion-transition);
    width: 1.4rem;
  }

  .action-btn:not(:disabled):hover {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }

  .action-btn--active {
    color: var(--fusion-accent);
  }

  .action-btn--danger:not(:disabled):hover {
    background: rgba(255, 92, 92, 0.1);
    color: var(--fusion-danger);
  }

  .icon {
    display: block;
    height: 0.75rem;
    width: 0.75rem;
  }

  /* ---- Player's own roll button ----
     Always visible (REQ-CBA-065): it does not live in the hover-fading action group. */
  .combatant-row__roll {
    flex-shrink: 0;
  }

  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-weight: 500;
    justify-content: center;
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .btn--xs {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
  }
</style>
