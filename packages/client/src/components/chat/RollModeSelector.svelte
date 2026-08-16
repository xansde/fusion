<script lang="ts">
  /**
   * RollModeSelector.svelte — the one control that decides the audience of a roll.
   *
   * Spec 38 (`specs/38-aba-chat.md`) §5.5, DEC-ACH-04 / REQ-ACH-040: four drawn icons
   * (public · to the GM · blind · self only), a visible mark on the active one, and help
   * text on hover AND on focus. Never emoji (REQ-NPC-094).
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
</script>

<div
  class="roll-mode"
  role="radiogroup"
  aria-label={t("FUSION.Chat.RollMode.GroupLabel")}
  data-active-mode={mode}
>
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
  .roll-mode {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    padding: 0.1rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    flex-shrink: 0;
    align-self: center;
  }

  .roll-mode__option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: none;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
  }

  .roll-mode__option:not(:disabled):hover {
    color: var(--fusion-text);
    background: var(--fusion-surface);
  }

  /* The active mark: colour alone would not survive a colour-blind reader, so the
     active option also carries a filled backing plate. */
  .roll-mode__option--active {
    color: var(--fusion-accent);
    background: var(--fusion-surface);
    box-shadow: inset 0 0 0 1px var(--fusion-accent);
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
