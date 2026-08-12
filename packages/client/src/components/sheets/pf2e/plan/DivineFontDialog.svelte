<script lang="ts">
  /**
   * DivineFontDialog.svelte — the Cleric "Divine Font" picker (issue #34).
   *
   * A level-1 Cleric chooses Healing Font or Harmful Font (Player Core
   * p.119): "you can prepare additional Heal or Harm spells... if both are
   * listed [by your deity], you can choose." Fusion has no Deity document to
   * read that entry from, so — same simplification "Doctrine" already makes
   * for Cloistered Cleric vs. Warpriest — this offers the choice directly.
   *
   * Unlike CompendiumPickerDialog/KineticGateDialog this resolves NOTHING
   * from the compendium: no per-option document exists in any pack for this
   * choice (see `chooseDivineFont`'s doc comment in planVM.ts), so the dialog
   * is a plain two-button pick with no socket round-trip and no loading
   * state — same shape as IsekaiBlessingDialog's read-only panel, but
   * interactive.
   */

  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    title: string;
    onClose: () => void;
    onConfirm: (choice: "heal" | "harm") => void;
  }

  let { title, onClose, onConfirm }: Props = $props();
</script>

<div
  class="divine-font-dialog__backdrop"
  role="button"
  tabindex="-1"
  aria-label={t("FUSION.Dialog.Close")}
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === "Escape") onClose();
  }}
></div>

<div class="divine-font-dialog" role="dialog" aria-modal="true" aria-label={title}>
  <header class="divine-font-dialog__head">
    <h2 class="divine-font-dialog__title">{title}</h2>
    <button
      type="button"
      class="divine-font-dialog__close"
      onclick={onClose}
      aria-label={t("FUSION.Dialog.Close")}
    >
      ✕
    </button>
  </header>

  <p class="divine-font-dialog__intro">{t("FUSION.Sheet.Plan.DivineFont.Intro")}</p>

  <div class="divine-font-dialog__options">
    <button type="button" class="divine-font-dialog__option" onclick={() => onConfirm("heal")}>
      <span class="divine-font-dialog__option-name">{t("FUSION.Sheet.Plan.DivineFont.Heal")}</span>
      <span class="divine-font-dialog__option-desc">{t("FUSION.Sheet.Plan.DivineFont.HealDescription")}</span>
    </button>
    <button type="button" class="divine-font-dialog__option" onclick={() => onConfirm("harm")}>
      <span class="divine-font-dialog__option-name">{t("FUSION.Sheet.Plan.DivineFont.Harm")}</span>
      <span class="divine-font-dialog__option-desc">{t("FUSION.Sheet.Plan.DivineFont.HarmDescription")}</span>
    </button>
  </div>
</div>

<style>
  .divine-font-dialog__backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    padding: 0;
    z-index: 60;
  }

  .divine-font-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    overflow-y: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    padding: 16px 18px 18px;
  }

  .divine-font-dialog__head {
    position: relative;
    padding-right: 28px;
    margin-bottom: 6px;
  }

  .divine-font-dialog__title {
    margin: 0;
    font-size: 16px;
    color: var(--fusion-text);
  }

  .divine-font-dialog__close {
    position: absolute;
    top: 0;
    right: 0;
    background: none;
    border: none;
    color: var(--fusion-text-subtle);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .divine-font-dialog__close:hover {
    color: var(--fusion-text);
  }

  .divine-font-dialog__intro {
    margin: 0 0 12px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fusion-text-subtle);
  }

  .divine-font-dialog__options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .divine-font-dialog__option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 10px 12px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt, transparent);
    color: var(--fusion-text);
    cursor: pointer;
  }

  .divine-font-dialog__option:hover {
    border-color: var(--fusion-accent, #5b8dee);
  }

  .divine-font-dialog__option-name {
    font-size: 13px;
    font-weight: 600;
  }

  .divine-font-dialog__option-desc {
    font-size: 11.5px;
    color: var(--fusion-text-subtle);
  }
</style>
