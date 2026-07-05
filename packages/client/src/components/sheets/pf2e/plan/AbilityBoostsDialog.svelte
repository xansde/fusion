<script lang="ts">
  /**
   * AbilityBoostsDialog.svelte — "Dádivas de Atributo" picker (R10-D item 2,
   * extended R11 item 1 for the FULL level-1 dádivas model).
   *
   * Unlike CompendiumPickerDialog (which browses a pack), this dialog picks
   * ability SLUGS across one or more independent free-boost GROUPS (see
   * planVM.ts's `AbilityBoostsSlotContext`/`AbilityBoostsGroup`): fixed
   * boosts are shown read-only at the top; each group renders its own
   * checkbox grid capped at that group's `freeCount` (PF2e Remaster rule: a
   * boost origin never grants a boost to the same ability twice — enforced
   * per-group by simply not double-counting a slug within that group; two
   * DIFFERENT groups MAY legally pick the same ability).
   *
   * Level 1 has up to 3 groups (ancestryFree, backgroundFree, levelled);
   * a levelled milestone (5/10/15/20) has exactly 1 (levelled). A group with
   * freeCount 0 (e.g. no background applied yet) is skipped entirely.
   *
   * R11 item 2: a LIVE preview strip shows the resulting ability scores/mods
   * for all 6 abilities, recomputed on every toggle via `previewAbilityScores`
   * (same math `derivePlan`/the rest of the builder will see once
   * "Concluído" persists these picks — no separate preview formula to keep
   * in sync).
   *
   * No socket/compendium access — this is pure client-side selection over
   * ABILITY_SLUGS; the caller (PlanColumn) turns each group's confirmed
   * slugs into a setAbilityBoosts() op.
   */

  import {
    ABILITY_SLUGS,
    previewAbilityScores,
    type AbilityBoostsGroup,
    type AbilitySlug,
  } from "../../../../lib/sheets/pf2e/planVM.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    /** Dialog title, e.g. "Dádivas de Atributo — Nível 1". */
    title: string;
    /** Ability slugs already fixed for this level's boost step (shown read-only, always "boosted"). */
    fixedSlugs: string[];
    /** One or more independent free-pick groups (level 1: up to 3; a levelled milestone: exactly 1). */
    groups: AbilityBoostsGroup[];
    /** The level this boost step belongs to (1, or a milestone 5/10/15/20) — needed for the live preview. */
    level: number;
    /** The live actor document — needed for the live preview (base ledger the picks overlay onto). */
    doc: Record<string, unknown>;
    onClose: () => void;
    /** Confirmed free slugs, keyed by group index (same order as `groups`). */
    onConfirm: (freeSlugsByGroup: string[][]) => void;
  }

  let { title, fixedSlugs, groups, level, doc, onClose, onConfirm }: Props = $props();

  // svelte-ignore state_referenced_locally — intentional: `groups` seeds the
  // selection at mount only (the dialog is recreated per opening, same
  // pattern as SpellPickerDialog's initialRank); later prop changes must NOT
  // clobber the user's in-progress picks.
  let selectedByGroup = $state<string[][]>(
    groups.map((g) => g.initialFreeSlugs.slice(0, g.freeCount)),
  );

  // svelte-ignore state_referenced_locally — same reasoning: `groups` is
  // fixed for the lifetime of this dialog instance (recreated per opening).
  const visibleGroups = groups.map((g, i) => ({ group: g, index: i })).filter((e) => e.group.freeCount > 0);

  // R11 item 2: live preview of resulting scores — recomputed from the SAME
  // math the rest of the builder uses (previewAbilityScores wraps
  // computeAbilityScores) every time a pick toggles.
  const previewScores = $derived(previewAbilityScores(doc, level, groups, selectedByGroup));

  function abilityMod(score: number): number {
    return Math.floor((score - 10) / 2);
  }

  function fmtMod(value: number): string {
    return value >= 0 ? `+${String(value)}` : String(value);
  }

  function abilityLabel(slug: string): string {
    return t(`FUSION.Sheet.Labels.Ability.${slug}.full`);
  }

  function groupLabel(origin: AbilityBoostsGroup["origin"]): string {
    switch (origin) {
      case "ancestryFree":
        return t("FUSION.Sheet.Plan.AbilityBoosts.GroupAncestryFree");
      case "backgroundFree":
        return t("FUSION.Sheet.Plan.AbilityBoosts.GroupBackgroundFree");
      case "classBoost":
        return t("FUSION.Sheet.Plan.AbilityBoosts.GroupClassBoost");
      case "levelled":
        return t("FUSION.Sheet.Plan.AbilityBoosts.GroupLevelled");
    }
  }

  /** classBoost restricts the offer to the class's keyAbility options. */
  function isOffered(groupIndex: number, slug: string): boolean {
    const allowed = groups[groupIndex]?.allowedSlugs;
    return !allowed || allowed.includes(slug);
  }

  /**
   * A slug is blocked ONLY within its own group (same-origin rule): the
   * group's excludedSlugs carries the abilities already boosted by that
   * origin. Cross-origin repetition is legal (r11 live-verification fix —
   * a global fixedSlugs block made Tobias's dex/int 16s impossible).
   */
  function isExcluded(groupIndex: number, slug: string): boolean {
    return groups[groupIndex]?.excludedSlugs.includes(slug) ?? false;
  }

  /** Read-only membership in the "Dádivas Fixas" display section only. */
  function isFixed(slug: string): boolean {
    return fixedSlugs.includes(slug);
  }

  function isSelected(groupIndex: number, slug: string): boolean {
    return selectedByGroup[groupIndex]?.includes(slug) ?? false;
  }

  function toggle(groupIndex: number, slug: string): void {
    if (isExcluded(groupIndex, slug)) return;
    const freeCount = groups[groupIndex]?.freeCount ?? 0;
    const current = selectedByGroup[groupIndex] ?? [];
    if (current.includes(slug)) {
      selectedByGroup[groupIndex] = current.filter((s) => s !== slug);
      return;
    }
    if (current.length >= freeCount) return;
    selectedByGroup[groupIndex] = [...current, slug];
  }

  function confirm(): void {
    onConfirm(selectedByGroup);
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
      {#if fixedSlugs.length > 0}
        <div class="ab-section">
          <p class="ab-section__label">{t("FUSION.Sheet.Plan.AbilityBoosts.FixedLabel")}</p>
          <div class="ab-grid">
            {#each ABILITY_SLUGS as slug (slug)}
              {#if isFixed(slug)}
                <div class="ab-tile ab-tile--fixed">
                  <span class="ab-tile__label">{abilityLabel(slug)}</span>
                  <span class="ab-tile__tag">{t("FUSION.Sheet.Plan.AbilityBoosts.Fixed")}</span>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      {#if visibleGroups.length === 0}
        <p class="ab-hint">{t("FUSION.Sheet.Plan.AbilityBoosts.NoFreeChoices")}</p>
      {/if}

      {#each visibleGroups as { group, index } (index)}
        <div class="ab-section">
          <p class="ab-section__label">{groupLabel(group.origin)}</p>
          <p class="ab-hint">{t("FUSION.Sheet.Plan.AbilityBoosts.FreeHint", { n: String(group.freeCount) })}</p>
          <div class="ab-grid">
            {#each ABILITY_SLUGS as slug (slug)}
              {#if isOffered(index, slug)}
                <button
                  type="button"
                  class="ab-tile"
                  class:ab-tile--fixed={isExcluded(index, slug)}
                  class:ab-tile--selected={isSelected(index, slug)}
                  disabled={isExcluded(index, slug) ||
                    (!isSelected(index, slug) && (selectedByGroup[index]?.length ?? 0) >= group.freeCount)}
                  onclick={() => toggle(index, slug)}
                >
                  <span class="ab-tile__label">{abilityLabel(slug)}</span>
                  {#if isExcluded(index, slug)}
                    <span class="ab-tile__tag">{t("FUSION.Sheet.Plan.AbilityBoosts.Fixed")}</span>
                  {:else if isSelected(index, slug)}
                    <span class="ab-tile__check" aria-hidden="true">&#10003;</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/each}

      <div class="ab-preview">
        <p class="ab-section__label">{t("FUSION.Sheet.Plan.AbilityBoosts.PreviewTitle")}</p>
        <div class="ab-preview__grid">
          {#each ABILITY_SLUGS as slug (slug)}
            {@const score = previewScores[slug]}
            <div class="ab-preview__tile">
              <span class="ab-preview__label">{abilityLabel(slug)}</span>
              <span class="ab-preview__score">{score}</span>
              <span class="ab-preview__mod">{fmtMod(abilityMod(score))}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="ab-modal__footer">
      <button type="button" class="ab-btn ab-btn--secondary" onclick={onClose}>{t("FUSION.Dialog.Cancel")}</button>
      <button type="button" class="ab-btn ab-btn--primary" onclick={confirm}>{t("FUSION.Sheet.Plan.AbilityBoosts.Done")}</button>
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
    width: 460px;
    max-width: 100%;
    max-height: 80vh;
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
    gap: 16px;
    overflow-y: auto;
  }

  .ab-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ab-section__label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-muted);
    margin: 0;
  }

  .ab-hint {
    font-size: 12px;
    color: var(--fusion-text-muted);
    margin: 0;
  }

  .ab-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px dashed var(--fusion-border);
  }

  .ab-preview__grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }

  .ab-preview__tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px;
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
  }

  .ab-preview__label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--fusion-text-subtle);
  }

  .ab-preview__score {
    font-size: 14px;
    font-weight: 700;
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
  }

  .ab-preview__mod {
    font-size: 11px;
    font-weight: 600;
    color: var(--fusion-accent);
    font-family: var(--fusion-font-mono);
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
    cursor: default;
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
