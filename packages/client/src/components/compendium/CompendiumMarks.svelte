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
            <!-- Drawn glyph, never an emoji (DEC-ACH-04): a pin with a stroke. -->
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
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
    margin-bottom: 0.75rem;
  }

  .compendium-marks__heading {
    margin: 0 0 0.25rem;
    padding: 0 0.25rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted, #888);
  }

  .compendium-marks__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .compendium-marks__item {
    display: flex;
    align-items: stretch;
    gap: 0.15rem;
    min-width: 0;
  }

  .compendium-marks__row {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.5rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    color: var(--fusion-text, #eee);
    font: inherit;
    font-size: 0.82rem;
    text-align: left;
  }

  .compendium-marks__row:hover {
    background: var(--fusion-border, #444);
  }

  .compendium-marks__name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compendium-marks__unpin {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 0.35rem;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    color: var(--fusion-text-muted, #888);
  }

  .compendium-marks__unpin:hover {
    color: var(--fusion-text, #eee);
    border-color: var(--fusion-border, #444);
  }
</style>
