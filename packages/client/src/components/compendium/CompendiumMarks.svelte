<script lang="ts">
  /**
   * CompendiumMarks.svelte — pinned and recently used, on top of the shelf.
   *
   * Spec 43 §5.9. Two short blocks that sit above the pack groups
   * (REQ-CPD-082, REQ-CPD-083): what the user pinned, and what he last
   * previewed or brought over. Both are device state kept by
   * `lib/compendium/compendiumPrefs.ts` — never a Document (REQ-CPD-081).
   *
   * The rows the panel hands over are ALREADY filtered against the packs the
   * seat may see (REQ-CPD-084): a pin whose pack went away is simply not among
   * them, which is why there is no "unavailable" state to draw here and no way
   * for one missing pack to blank the block.
   *
   * A block with nothing in it draws nothing at all — an empty "Pinned" heading
   * on top of the shelf would cost the user rows of the thing he came for.
   *
   * Presentational: it renders rows and hands gestures back. Clicking a row
   * opens the pack the entry lives in, which is the one navigation this file may
   * decide on its own; previewing and bringing over belong to the result line.
   */

  import type {
    CompendiumEntryRef,
    CompendiumRecentEntry,
  } from "../../lib/compendium/compendiumPrefs.js";
  import { t } from "../../lib/i18n/i18n.js";
  import Icon from "../common/Icon.svelte";

  interface Props {
    /** Pinned entries, newest first, already filtered by visible pack. */
    pinned: readonly CompendiumEntryRef[];
    /** Recently used entries, newest first, already capped and filtered. */
    recent: readonly CompendiumRecentEntry[];
    /** Open the pack an entry belongs to (REQ-CPD-013). */
    onOpenPack: (entry: CompendiumEntryRef) => void;
    /** Unpin one entry (REQ-CPD-082). */
    onUnpin: (entry: CompendiumEntryRef) => void;
  }

  const { pinned, recent, onOpenPack, onUnpin }: Props = $props();
</script>

{#if pinned.length > 0}
  <section class="compendium-marks compendium-marks--pinned">
    <h3 class="compendium-marks__heading">{t("FUSION.Compendium.Marks.Pinned")}</h3>
    <ul class="compendium-marks__list" role="list">
      {#each pinned as entry (entry.uuid)}
        <li class="compendium-marks__item">
          <button
            class="compendium-marks__row"
            type="button"
            onclick={() => onOpenPack(entry)}
            title={t("FUSION.Compendium.Marks.OpenPack", { name: entry.name })}
          >
            <span class="compendium-marks__name">{entry.name}</span>
          </button>
          <button
            class="compendium-marks__unpin"
            type="button"
            aria-label={t("FUSION.Compendium.Marks.Unpin", { name: entry.name })}
            title={t("FUSION.Compendium.Marks.Unpin", { name: entry.name })}
            onclick={() => onUnpin(entry)}
          >
            <Icon name="x" size={16} />
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if recent.length > 0}
  <section class="compendium-marks compendium-marks--recent">
    <h3 class="compendium-marks__heading">{t("FUSION.Compendium.Marks.Recent")}</h3>
    <ul class="compendium-marks__list" role="list">
      {#each recent as entry (entry.uuid)}
        <li class="compendium-marks__item">
          <button
            class="compendium-marks__row"
            type="button"
            onclick={() => onOpenPack(entry)}
            title={t("FUSION.Compendium.Marks.OpenPack", { name: entry.name })}
          >
            <span class="compendium-marks__name">{entry.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  /* No width anywhere — the drawer owns it (REQ-GAV-012, REQ-CPD-017). */
  .compendium-marks {
    margin-bottom: var(--fusion-space-4);
  }

  .compendium-marks__heading {
    margin: 0 0 var(--fusion-space-1);
    padding: 0 var(--fusion-space-1);
    font-size: var(--fusion-text-lg);
    font-weight: 500;
    color: var(--fusion-text);
  }

  .compendium-marks__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .compendium-marks__item {
    display: flex;
    align-items: stretch;
    min-width: 0;
  }

  .compendium-marks__item + .compendium-marks__item {
    border-top: 1px solid var(--fusion-border);
  }

  .compendium-marks__row {
    flex: 1;
    min-width: 0;
    min-height: var(--fusion-target);
    padding: var(--fusion-space-2) var(--fusion-space-1);
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    color: var(--fusion-text);
    font: inherit;
    font-size: var(--fusion-text-base);
    text-align: left;
  }

  .compendium-marks__row:hover {
    background: var(--fusion-surface-alt);
  }

  /* The whole name; it breaks onto a second line instead of being cut. */
  .compendium-marks__name {
    display: block;
    overflow-wrap: anywhere;
  }

  .compendium-marks__unpin {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--fusion-target);
    min-height: var(--fusion-target);
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    color: var(--fusion-text-muted);
  }

  .compendium-marks__unpin:hover {
    color: var(--fusion-text);
    background: var(--fusion-surface-alt);
  }
</style>
