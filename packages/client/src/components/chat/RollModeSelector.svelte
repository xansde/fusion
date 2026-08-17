<script lang="ts">
  /**
   * RollModeSelector.svelte — the one control that decides the audience of a roll.
   *
   * Spec 38 (`specs/38-aba-chat.md`) §5.5, DEC-ACH-04 / REQ-ACH-040: a **full-width** strip
   * of four drawn icons (public · to the GM · blind · self only) behind a sliding indicator
   * that animates to the active one, plus help text on hover AND on focus. Never emoji
   * (REQ-NPC-094). The strip fills the composer's width — it is not a compact, self-sized
   * cluster — matching `chat-tab.prototype.html`'s `.modes` (grid of 4 equal columns,
   * `.thumb` sliding with `transition: left .14s`).
   *
   * It is a presentation component: it owns no preference and no storage. The owner
   * (`ChatInput`) reads and writes `lib/chat/rollModePreference.ts` per world + user
   * (REQ-ACH-041) and hands the current value down. Precedence over commands and favorites
   * lives in `lib/chat/resolveRollMode.ts` (REQ-ACH-042..045) — not here.
   *
   * Keyboard: four real `<button>`s in a `radiogroup`, so Tab reaches them and Enter/Space
   * activate them with the browser's own focus ring (RNF-ACH-04, REQ-UIF-064).
   */

  import { t } from "../../lib/i18n/i18n.js";
  import { ROLL_MODE_ORDER, rollModeI18nStem, rollModeIcons } from "./rollModeIcons.js";

  import type { RollMode } from "@fusion/shared";

  const {
    mode,
    onSelect,
    disabled = false,
  }: {
    /** Currently selected mode (REQ-ACH-041 — restored by the owner). */
    mode: RollMode;
    /** Called with the mode the user picked; the owner persists it. */
    onSelect: (mode: RollMode) => void;
    disabled?: boolean;
  } = $props();

  function labelOf(m: RollMode): string {
    return t(`${rollModeI18nStem[m]}.Label`);
  }

  function helpOf(m: RollMode): string {
    return t(`${rollModeI18nStem[m]}.Help`);
  }

  // The strip has ROLL_MODE_ORDER.length (4) equal columns; the thumb slides to the
  // active one by percentage of its index, same formula as the decided prototype
  // (`chat-tab.prototype.html`'s composerHtml: `calc(${idx} * 25% + 2px)`).
  const activeIndex = $derived(ROLL_MODE_ORDER.indexOf(mode));
  const thumbLeft = $derived(`calc(${activeIndex} * 25% + 2px)`);
</script>

<div
  class="roll-mode"
  role="radiogroup"
  aria-label={t("FUSION.Chat.RollMode.GroupLabel")}
  data-active-mode={mode}
>
  <span class="roll-mode__thumb" style="left: {thumbLeft}" aria-hidden="true"></span>
  {#each ROLL_MODE_ORDER as m (m)}
    <button
      type="button"
      class="roll-mode__option"
      class:roll-mode__option--active={m === mode}
      data-mode={m}
      role="radio"
      aria-checked={m === mode}
      aria-label={`${labelOf(m)} — ${helpOf(m)}`}
      title={helpOf(m)}
      {disabled}
      onclick={() => {
        onSelect(m);
      }}
    >
      <span class="roll-mode__icon" aria-hidden="true">{@html rollModeIcons[m]}</span>
    </button>
  {/each}
</div>

<style>
  /* Full-width strip of 4 equal columns (DEC-ACH-04, REQ-ACH-040) — matches
     chat-tab.prototype.html's `.modes`, not a compact self-sized cluster. */
  .roll-mode {
    position: relative;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    width: 100%;
    height: 26px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-pill);
    background: var(--fusion-surface-alt);
  }

  /* The sliding indicator behind the active option — animates on mode change
     instead of the option itself changing shape (prototype's `.modes .thumb`). */
  .roll-mode__thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc(25% - 3px);
    border-radius: var(--fusion-radius-pill);
    background: var(--fusion-accent-dim);
    border: 1px solid var(--fusion-accent);
    transition: left 0.14s ease;
    pointer-events: none;
  }

  .roll-mode__option {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    transition: color var(--fusion-transition);
  }

  .roll-mode__option:not(:disabled):hover {
    color: var(--fusion-text);
  }

  /* The active mark: colour alone would not survive a colour-blind reader, so the
     active option also sits above the filled, bordered thumb (above). */
  .roll-mode__option--active {
    color: var(--fusion-accent-hover);
  }

  .roll-mode__option:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Focus ring kept as the browser's own (RNF-ACH-04) — visible on keyboard focus. */
  .roll-mode__option:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  .roll-mode__icon {
    display: inline-flex;
    line-height: 0;
  }
</style>
