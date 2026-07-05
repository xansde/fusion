<script lang="ts">
  /**
   * SkillTrainingDialog.svelte — Pathbuilder-style MASS skill training/
   * increase picker (R11 item 1), replacing PlanColumn's former one-at-a-time
   * skillTraining/skillIncrease mini-dialog.
   *
   * Lists ALL 16 canonical skills + any existing lores in one scrollable list.
   * A live "Seleções restantes: N" header tracks how many picks are left
   * (bounded by the level's collapsed group slot count — see planVM.ts's
   * `skillTrainingDialogContext`). Clicking an eligible row toggles it
   * selected/deselected; each row shows the CURRENT proficiency badge, the
   * TARGET badge it would jump to if selected, the current/target modifier,
   * and the ability/proficiency breakdown (mirrors the Pathbuilder reference
   * screenshot's skill row layout).
   *
   * "Concluído" persists every pick in ONE doc:update via
   * `confirmSkillTraining` (lesson r10: diffs never index arrays — the whole
   * `system.build.choices` array is always sent). Disabled until picks.length
   * === totalSlots (every slot must be filled before confirming — matches
   * Pathbuilder's own behavior of not letting you leave slots unassigned).
   *
   * "Lores" opens an inline name input that calls `addLoreSkill` (its own
   * doc:update, sent immediately) to create a new custom Lore at rank 0, then
   * the new lore appears as a pickable row without closing this dialog.
   *
   * No socket access — pure client-side selection over
   * `skillTrainingDialogContext`'s rows; the caller (PlanColumn) supplies
   * `sendOpFn` for the lore-creation op and reacts to `onConfirm` for the
   * batch op.
   */

  import type { SkillTrainingDialogContext, SkillTrainingRow } from "../../../../lib/sheets/pf2e/planVM.js";
  import ProficiencyBadge from "../ProficiencyBadge.svelte";
  import { skillHelpFor, TEML_LEGEND } from "./abilitySkillHelp.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    title: string;
    dialogCtx: SkillTrainingDialogContext;
    onClose: () => void;
    onConfirm: (picks: string[]) => void;
    onAddLore: (name: string) => void;
  }

  let { title, dialogCtx, onClose, onConfirm, onAddLore }: Props = $props();

  // svelte-ignore state_referenced_locally — intentional: `dialogCtx` seeds
  // this dialog's list at mount only (recreated per opening, same pattern as
  // AbilityBoostsDialog's `selectedByGroup`). R12 item 1: a slot re-opened for
  // editing pre-selects the skills already picked for this level+kind
  // (`filledPicks`), so the player sees the current ledger and can swap or
  // remove any of them — confirm sends the FULL list, reconciling the whole
  // group (see confirmSkillTraining).
  let picks = $state<string[]>([...dialogCtx.filledPicks]);
  let showLoreInput = $state(false);
  let loreName = $state("");

  // R12 item 2: description side-panel — the skill the player is
  // hovering/focusing, shown with its curated help text + the TEML legend.
  let hoveredSlug = $state<string | null>(null);

  const totalSlots = $derived(dialogCtx.totalSlots);
  const remaining = $derived(Math.max(0, totalSlots - picks.length));
  const kindLabel = $derived(
    dialogCtx.kind === "skillIncrease"
      ? t("FUSION.Sheet.Plan.SlotLabel.skillIncrease")
      : t("FUSION.Sheet.Plan.SlotLabel.skillTraining"),
  );

  // R12 item 2: the help entry for the row under the cursor/focus (falls back
  // to the first row so the panel is never empty when the dialog opens).
  const helpSlug = $derived(hoveredSlug ?? dialogCtx.rows[0]?.slug ?? null);
  const activeHelp = $derived(helpSlug !== null ? skillHelpFor(helpSlug) : null);

  function rankToBadge(rank: number): "U" | "T" | "E" | "M" | "L" {
    switch (rank) {
      case 1:
        return "T";
      case 2:
        return "E";
      case 3:
        return "M";
      case 4:
        return "L";
      default:
        return "U";
    }
  }

  // Skill names are PF2e game terms and stay in English everywhere in the
  // sheet (mirrors PlanColumn.svelte's SKILL_LABELS / characterSheetVM.ts's
  // SKILL_LABELS — never routed through t()).
  const SKILL_LABELS: Record<string, string> = {
    acrobatics: "Acrobatics",
    arcana: "Arcana",
    athletics: "Athletics",
    crafting: "Crafting",
    deception: "Deception",
    diplomacy: "Diplomacy",
    intimidation: "Intimidation",
    medicine: "Medicine",
    nature: "Nature",
    occultism: "Occultism",
    performance: "Performance",
    religion: "Religion",
    society: "Society",
    stealth: "Stealth",
    survival: "Survival",
    thievery: "Thievery",
  };

  function skillLabel(row: SkillTrainingRow): string {
    if (row.isLore) return `Lore (${row.slug.replace(/^lore-/, "")})`;
    return SKILL_LABELS[row.slug] ?? row.slug;
  }

  function fmtSigned(value: number): string {
    return value >= 0 ? `+${String(value)}` : String(value);
  }

  /** Proficiency-only portion of a row's modifier (total mod minus the ability mod). */
  function profPart(row: SkillTrainingRow, selected: boolean): number {
    return selected ? row.targetMod - row.abilityMod : row.currentMod - row.abilityMod;
  }

  function isSelected(slug: string): boolean {
    return picks.includes(slug);
  }

  function canToggle(row: SkillTrainingRow): boolean {
    if (isSelected(row.slug)) return true; // always allowed to deselect
    return row.eligible && picks.length < totalSlots;
  }

  function toggle(row: SkillTrainingRow): void {
    if (!canToggle(row)) return;
    if (isSelected(row.slug)) {
      picks = picks.filter((s) => s !== row.slug);
    } else {
      picks = [...picks, row.slug];
    }
  }

  function confirm(): void {
    if (picks.length !== totalSlots) return;
    onConfirm(picks);
    onClose();
  }

  function submitLore(): void {
    const trimmed = loreName.trim();
    if (!trimmed) return;
    onAddLore(trimmed);
    loreName = "";
    showLoreInput = false;
  }
</script>

<div
  class="st-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === "Escape") onClose();
  }}
>
  <div
    class="st-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={title}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === "Escape") onClose();
    }}
  >
    <div class="st-modal__header">
      <div>
        <h2 class="st-modal__title">{title}</h2>
        <p class="st-modal__remaining">
          {t("FUSION.Sheet.Plan.SkillTraining.Remaining", { n: String(remaining) })}
        </p>
      </div>
      <button type="button" class="st-modal__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>
        &times;
      </button>
    </div>

    <div class="st-modal__body">
      <div class="st-main">
        <div class="st-list">
          {#each dialogCtx.rows as row (row.slug)}
            {@const selected = isSelected(row.slug)}
            {@const disabled = !canToggle(row)}
            <button
              type="button"
              class="st-row"
              class:st-row--selected={selected}
              class:st-row--disabled={disabled}
              {disabled}
              onclick={() => toggle(row)}
              onmouseenter={() => { hoveredSlug = row.slug; }}
              onfocus={() => { hoveredSlug = row.slug; }}
            >
              <span class="st-row__check" aria-hidden="true">{selected ? "✓" : ""}</span>
              <span class="st-row__name">{skillLabel(row)}</span>
              <span class="st-row__ability">{row.ability.toUpperCase()}</span>
              <span class="st-row__breakdown">
                {t("FUSION.Sheet.Plan.SkillTraining.Breakdown", {
                  ability: fmtSigned(row.abilityMod),
                  prof: fmtSigned(profPart(row, selected)),
                })}
              </span>
              <span class="st-row__badges">
                <ProficiencyBadge rank={rankToBadge(row.currentRank)} size={16} />
                <span class="st-row__arrow" aria-hidden="true">&#8594;</span>
                <ProficiencyBadge rank={rankToBadge(selected ? row.targetRank : row.currentRank)} size={16} />
              </span>
              <span class="st-row__mod">{selected ? row.targetModFormatted : row.currentModFormatted}</span>
            </button>
          {/each}
        </div>

        <!-- R12 item 2: curated description side-panel + TEML legend. -->
        <aside class="st-help" aria-live="polite">
          {#if activeHelp}
            <p class="st-help__name">{activeHelp.name}</p>
            <p class="st-help__ability">Atributo-chave: {activeHelp.ability.toUpperCase()}</p>
            <p class="st-help__desc">{activeHelp.description}</p>
          {/if}
          <div class="st-help__legend">
            <p class="st-help__legend-title">Proficiência (TEML)</p>
            {#each TEML_LEGEND as row (row.badge)}
              <div class="st-help__legend-row">
                <ProficiencyBadge rank={row.badge} size={16} />
                <span class="st-help__legend-name">{row.name}</span>
                <span class="st-help__legend-note">{row.note}</span>
              </div>
            {/each}
          </div>
        </aside>
      </div>

      {#if showLoreInput}
        <div class="st-lore-input">
          <input
            type="text"
            class="st-lore-input__field"
            placeholder={t("FUSION.Sheet.Plan.SkillTraining.LoreNamePlaceholder")}
            bind:value={loreName}
            onkeydown={(e) => {
              if (e.key === "Enter") submitLore();
            }}
          />
          <button type="button" class="st-btn st-btn--secondary" onclick={submitLore}>
            {t("FUSION.Sheet.Plan.Picker.Confirm")}
          </button>
        </div>
      {:else}
        <button type="button" class="st-lore-toggle" onclick={() => { showLoreInput = true; }}>
          + {t("FUSION.Sheet.Plan.SkillTraining.AddLore")}
        </button>
      {/if}
    </div>

    <div class="st-modal__footer">
      <span class="st-modal__hint">{kindLabel}</span>
      <div class="st-modal__actions">
        <button type="button" class="st-btn st-btn--secondary" onclick={onClose}>
          {t("FUSION.Dialog.Cancel")}
        </button>
        <button
          type="button"
          class="st-btn st-btn--primary"
          disabled={picks.length !== totalSlots}
          onclick={confirm}
        >
          {t("FUSION.Sheet.Plan.SkillTraining.Done")}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .st-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 100;
  }

  .st-modal {
    width: 860px;
    max-width: 100%;
    max-height: 82vh;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .st-modal__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .st-modal__title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .st-modal__remaining {
    margin: 4px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--fusion-accent);
  }

  .st-modal__close {
    width: 24px;
    height: 24px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--fusion-font);
    flex-shrink: 0;
  }

  .st-modal__close:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .st-modal__body {
    padding: 12px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }

  .st-main {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .st-list {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 4px;
    max-height: 420px;
    overflow-y: auto;
  }

  .st-help {
    width: 240px;
    flex-shrink: 0;
    align-self: stretch;
    max-height: 420px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
  }

  .st-help__name {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--fusion-text);
  }

  .st-help__ability {
    margin: 0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
  }

  .st-help__desc {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--fusion-text-muted);
  }

  .st-help__legend {
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px dashed var(--fusion-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .st-help__legend-title {
    margin: 0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
  }

  .st-help__legend-row {
    display: grid;
    grid-template-columns: 16px auto 1fr;
    align-items: center;
    gap: 6px;
  }

  .st-help__legend-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .st-help__legend-note {
    font-size: 10px;
    color: var(--fusion-text-subtle);
    text-align: right;
  }

  .st-row {
    display: grid;
    grid-template-columns: 16px 1fr 32px 1fr auto 44px;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    border: 1px solid transparent;
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, border-color 0.12s;
  }

  .st-row:hover:not(.st-row--disabled) {
    background: var(--fusion-surface-alt);
  }

  .st-row--selected {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .st-row--disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .st-row__check {
    color: var(--fusion-accent);
    font-size: 12px;
    text-align: center;
  }

  .st-row__name {
    font-size: 12.5px;
    font-weight: 600;
  }

  .st-row__ability {
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-text-subtle);
    text-align: center;
  }

  .st-row__breakdown {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
    font-family: var(--fusion-font-mono);
  }

  .st-row__badges {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .st-row__arrow {
    color: var(--fusion-text-subtle);
    font-size: 11px;
  }

  .st-row__mod {
    font-size: 12.5px;
    font-weight: 700;
    text-align: right;
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
  }

  .st-lore-toggle {
    align-self: flex-start;
    font-family: var(--fusion-font);
    font-size: 12px;
    font-weight: 600;
    color: var(--fusion-accent);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 2px;
  }

  .st-lore-toggle:hover {
    color: var(--fusion-accent-hover);
  }

  .st-lore-input {
    display: flex;
    gap: 8px;
  }

  .st-lore-input__field {
    flex: 1;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 7px 10px;
    color: var(--fusion-text);
    font-size: 12.5px;
    font-family: var(--fusion-font);
    outline: none;
  }

  .st-lore-input__field:focus {
    border-color: var(--fusion-accent);
  }

  .st-modal__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    border-top: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .st-modal__hint {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 700;
  }

  .st-modal__actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .st-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    padding: 7px 14px;
    font-size: 13px;
    border-radius: var(--fusion-radius);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .st-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .st-btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: 1px solid var(--fusion-accent);
  }

  .st-btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
    border-color: var(--fusion-accent-hover);
  }

  .st-btn--secondary {
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .st-btn--secondary:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }
</style>
