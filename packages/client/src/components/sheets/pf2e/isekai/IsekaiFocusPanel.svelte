<script lang="ts">
  /**
   * IsekaiFocusPanel.svelte — the layer's Focus pool, with the ★ locks made
   * visible.
   *
   * The pips always render the pool's FULL size: a locked point shows as a
   * hatched pip, not as a missing one. "Where did my third point go?" has to
   * be answerable from the sheet, and a pool that silently shrinks when you
   * name a companion is exactly the bug this renders away.
   */

  import type { IsekaiFocusModel } from "../../../../lib/sheets/pf2e/isekai/tabVM.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    focus: IsekaiFocusModel;
    editable: boolean;
    /** Set the spendable value; the caller clamps and emits the op. */
    onSet: (value: number) => void;
  }

  let { focus, editable, onSet }: Props = $props();

  /** Clicking pip i sets the pool to i+1, or to i when it is already the top filled pip. */
  function clickPip(i: number): void {
    if (!editable) return;
    onSet(i + 1 === focus.value ? i : i + 1);
  }
</script>

<section class="isekai-focus">
  <header class="isekai-focus__head">
    <span class="isekai-focus__title">{t("FUSION.Sheet.Isekai.Focus.Title")}</span>
    <span class="isekai-focus__count">
      {focus.value}/{focus.spendable}
      {#if focus.locked > 0}
        <span class="isekai-focus__locked">
          · {t("FUSION.Sheet.Isekai.Focus.Locked", { n: String(focus.locked) })}
        </span>
      {/if}
    </span>
  </header>

  <div class="isekai-focus__pips" role="group" aria-label={t("FUSION.Sheet.Isekai.Focus.Title")}>
    {#each { length: focus.max } as _, i}
      {#if i < focus.spendable}
        <button
          type="button"
          class="isekai-pip"
          class:isekai-pip--on={i < focus.value}
          disabled={!editable}
          aria-label={t("FUSION.Sheet.Isekai.Focus.Pip", { n: String(i + 1) })}
          onclick={() => clickPip(i)}
        ></button>
      {:else}
        <span
          class="isekai-pip isekai-pip--locked"
          title={t("FUSION.Sheet.Isekai.Focus.LockedPip")}
          aria-label={t("FUSION.Sheet.Isekai.Focus.LockedPip")}
        ></span>
      {/if}
    {/each}
    {#if focus.max === 0}
      <span class="isekai-focus__empty">{t("FUSION.Sheet.Isekai.Focus.NoPool")}</span>
    {:else if focus.spendable === 0}
      <span class="isekai-focus__empty">{t("FUSION.Sheet.Isekai.Focus.AllLocked")}</span>
    {/if}
  </div>

  {#if editable && focus.spendable > 0}
    <div class="isekai-focus__btns">
      <button type="button" onclick={() => onSet(focus.value - 1)} disabled={focus.value <= 0}>
        {t("FUSION.Sheet.Isekai.Focus.Spend")}
      </button>
      <button
        type="button"
        onclick={() => onSet(focus.value + 1)}
        disabled={focus.value >= focus.spendable}
      >
        {t("FUSION.Sheet.Isekai.Focus.Recover")}
      </button>
      <button
        type="button"
        onclick={() => onSet(focus.spendable)}
        disabled={focus.value >= focus.spendable}
      >
        {t("FUSION.Sheet.Isekai.Focus.Refocus")}
      </button>
    </div>
  {/if}
</section>

<style>
  .isekai-focus {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
  }

  .isekai-focus__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .isekai-focus__title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted);
  }

  .isekai-focus__count {
    font-size: 13px;
    font-weight: 700;
    color: var(--fusion-text);
  }

  .isekai-focus__locked {
    font-size: 10.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .isekai-focus__pips {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .isekai-pip {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 2px solid var(--fusion-accent);
    background: transparent;
    padding: 0;
    cursor: pointer;
  }

  .isekai-pip--on {
    background: var(--fusion-accent);
  }

  .isekai-pip:disabled {
    cursor: default;
  }

  .isekai-pip--locked {
    border-color: var(--fusion-border);
    background: repeating-linear-gradient(
      45deg,
      var(--fusion-border) 0,
      var(--fusion-border) 2px,
      transparent 2px,
      transparent 4px
    );
    cursor: not-allowed;
  }

  .isekai-focus__empty {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
    font-style: italic;
  }

  .isekai-focus__btns {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .isekai-focus__btns button {
    font-size: 11px;
    padding: 3px 9px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
  }

  .isekai-focus__btns button:hover:not(:disabled) {
    border-color: var(--fusion-accent);
  }

  .isekai-focus__btns button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
