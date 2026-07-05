<script lang="ts">
  /**
   * AbilityBoostsDialog.svelte — "Dádivas de Atributo" picker (R10-D item 2).
   *
   * Unlike CompendiumPickerDialog (which browses a pack), this dialog picks
   * ability SLUGS for one boost origin (`system.build.abilities.<origin>` —
   * see planVM.ts's setAbilityBoosts): fixed boosts are shown read-only,
   * free/levelled boosts are selectable checkboxes capped at `freeCount`
   * (PF2e Remaster rule: a boost origin never grants a boost to the same
   * ability twice — enforced here by simply not double-counting a slug).
   *
   * No socket/compendium access — this is pure client-side selection over
   * ABILITY_SLUGS; the caller (PlanColumn) turns the confirmed slugs into a
   * setAbilityBoosts() op.
   */

  import { ABILITY_SLUGS } from "../../../../lib/sheets/pf2e/planVM.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    /** Dialog title, e.g. "Dádivas de Atributo — Ancestralidade". */
    title: string;
    /** Ability slugs already fixed by this origin (shown read-only, always "boosted"). */
    fixedSlugs: string[];
    /** How many additional free boosts the player picks for this origin. */
    freeCount: number;
    /** Already-selected free slugs (pre-seeds the dialog when re-opening). */
    initialFreeSlugs: string[];
    onClose: () => void;
    onConfirm: (freeSlugs: string[]) => void;
  }

  let { title, fixedSlugs, freeCount, initialFreeSlugs, onClose, onConfirm }: Props = $props();

  // svelte-ignore state_referenced_locally — intentional: initialFreeSlugs/
  // freeCount seed the selection at mount only (the dialog is recreated per
  // opening, same pattern as SpellPickerDialog's initialRank); later prop
  // changes must NOT clobber the user's in-progress picks.
  let selected = $state<string[]>(initialFreeSlugs.slice(0, freeCount));

  function abilityLabel(slug: string): string {
    return t(`FUSION.Sheet.Labels.Ability.${slug}.full`);
  }

  function isFixed(slug: string): boolean {
    return fixedSlugs.includes(slug);
  }

  function isSelected(slug: string): boolean {
    return selected.includes(slug);
  }

  function toggle(slug: string): void {
    if (isFixed(slug)) return;
    if (isSelected(slug)) {
      selected = selected.filter((s) => s !== slug);
      return;
    }
    if (selected.length >= freeCount) return;
    selected = [...selected, slug];
  }

  function confirm(): void {
    onConfirm(selected);
    onClose();
  }
</script>

<div class="ab-backdrop" role="presentation" onclick={onClose} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
  <div
    class="ab-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={title}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <div class="ab-modal__header">
      <h2 class="ab-modal__title">{title}</h2>
      <button type="button" class="ab-modal__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>&times;</button>
    </div>

    <div class="ab-modal__body">
      {#if freeCount > 0}
        <p class="ab-hint">{t("FUSION.Sheet.Plan.AbilityBoosts.FreeHint", { n: String(freeCount) })}</p>
      {/if}
      <div class="ab-grid">
        {#each ABILITY_SLUGS as slug (slug)}
          <button
            type="button"
            class="ab-tile"
            class:ab-tile--fixed={isFixed(slug)}
            class:ab-tile--selected={isSelected(slug)}
            disabled={isFixed(slug) || (!isSelected(slug) && selected.length >= freeCount)}
            onclick={() => toggle(slug)}
          >
            <span class="ab-tile__label">{abilityLabel(slug)}</span>
            {#if isFixed(slug)}
              <span class="ab-tile__tag">{t("FUSION.Sheet.Plan.AbilityBoosts.Fixed")}</span>
            {:else if isSelected(slug)}
              <span class="ab-tile__check" aria-hidden="true">&#10003;</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <div class="ab-modal__footer">
      <button type="button" class="ab-btn ab-btn--secondary" onclick={onClose}>{t("FUSION.Dialog.Cancel")}</button>
      <button type="button" class="ab-btn ab-btn--primary" onclick={confirm}>{t("FUSION.Sheet.Plan.Picker.Confirm")}</button>
    </div>
  </div>
</div>

<style>
  .ab-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 100;
  }

  .ab-modal {
    width: 420px;
    max-width: 100%;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .ab-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--fusion-border);
  }

  .ab-modal__title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .ab-modal__close {
    width: 24px;
    height: 24px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .ab-modal__close:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .ab-modal__body {
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ab-hint {
    font-size: 12px;
    color: var(--fusion-text-muted);
    margin: 0;
  }

  .ab-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .ab-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 6px;
    border-radius: var(--fusion-radius);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    transition: border-color 0.12s, background 0.12s;
  }

  .ab-tile:hover:not(:disabled) {
    border-color: var(--fusion-accent);
  }

  .ab-tile:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .ab-tile--fixed {
    border-color: var(--fusion-success);
    background: var(--fusion-success-dim);
    opacity: 1;
  }

  .ab-tile--selected {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
  }

  .ab-tile__label {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .ab-tile__tag {
    font-size: 9px;
    color: var(--fusion-success);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .ab-tile__check {
    color: var(--fusion-accent);
    font-size: 12px;
  }

  .ab-modal__footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--fusion-border);
  }

  .ab-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    cursor: pointer;
    padding: 7px 14px;
    font-size: 13px;
    border-radius: var(--fusion-radius);
  }

  .ab-btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: 1px solid var(--fusion-accent);
  }

  .ab-btn--primary:hover {
    background: var(--fusion-accent-hover);
  }

  .ab-btn--secondary {
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .ab-btn--secondary:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }
</style>
