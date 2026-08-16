<script lang="ts">
  /**
   * CompendiumShelf.svelte — the shelf body of the Compendium tab (spec 43 §5.3).
   *
   * Every pack the caller may see, grouped by document type, each group a
   * collapsible section that counts its packs (REQ-CPD-020), each pack a row
   * that names itself with its label, its document count and its LICENSE
   * (REQ-CPD-021).
   *
   * The license is why this is not just a list of names. It is the reason the
   * project is clean-room (spec 26, DEC-CPD-07), so it is the one thing the row
   * may not drop for lack of room: the label ellipses, the license wraps. The
   * long attribution prose rides along as the row's tooltip.
   *
   * A pack of audience `"gm"` is marked as such — but only on the privileged
   * shelf (REQ-CPD-022). The audience is enforced on the server (DEC-CPD-04);
   * the mark exists so the GM knows what the table cannot see, which is worth
   * nothing to a player. `ShelfPackRow.gmOnly` already carries that gate.
   *
   * World packs get no separate section and no badge of their own: they share
   * the groups of the system packs and are told apart by the license they show
   * (REQ-CPD-025).
   *
   * Presentational on purpose — it takes the built groups and hands gestures
   * back. The view model lives in `lib/compendium/compendiumShelf.ts`, and the
   * panel owns the loading, the scope and the collapse store.
   */

  import type { ShelfGroup } from "../../lib/compendium/compendiumShelf.js";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    /** The shelf, already grouped and marked (`buildShelfGroups`). */
    groups: readonly ShelfGroup[];
    /** Open a pack — the panel turns it into a scope change (REQ-CPD-013). */
    onOpenPack: (pack: { id: string; label: string }) => void;
    /** Collapse or expand one group; the panel persists it (REQ-CPD-023). */
    onToggleGroup: (documentType: string) => void;
  }

  const { groups, onOpenPack, onToggleGroup }: Props = $props();

  /** Id of a group's pack list, so its heading button can point at it. */
  function listId(documentType: string): string {
    return `compendium-shelf-${documentType}`;
  }
</script>

{#each groups as group (group.documentType)}
  <section class="pack-group">
    <h3 class="pack-group__heading">
      <button
        class="pack-group__toggle"
        type="button"
        aria-expanded={!group.collapsed}
        aria-controls={listId(group.documentType)}
        onclick={() => onToggleGroup(group.documentType)}
      >
        <!--
          Drawn chevron, never a pictograph (REQ-NPC-094 / DEC-ACH-04): an emoji
          changes shape per operating system and ignores the theme.
        -->
        <svg
          class="pack-group__chevron"
          class:pack-group__chevron--collapsed={group.collapsed}
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span class="pack-group__title">{t(group.labelKey)}</span>
        <span class="pack-group__count">
          {t("FUSION.Compendium.Shelf.PackCount", { count: group.packCount })}
        </span>
      </button>
    </h3>

    {#if !group.collapsed}
      <ul class="pack-group__list" role="list" id={listId(group.documentType)}>
        {#each group.packs as pack (pack.id)}
          <li class="pack-group__item">
            <button
              class="pack-row"
              type="button"
              onclick={() => onOpenPack({ id: pack.id, label: pack.label })}
              title={pack.licenseDetail.length > 0
                ? `${pack.label} — ${pack.licenseDetail}`
                : pack.label}
            >
              <span class="pack-row__head">
                <span class="pack-row__label">{pack.label}</span>
                <span class="pack-row__count">
                  {t("FUSION.Compendium.Shelf.DocumentCount", { count: pack.documentCount })}
                </span>
              </span>
              <span class="pack-row__meta">
                <!--
                  Never conditional and never clipped: the license is the field
                  that has to survive a narrow drawer (DEC-CPD-07).
                -->
                <span class="pack-row__license" aria-label={t("FUSION.Compendium.Shelf.License")}>
                  {pack.license}
                </span>
                {#if pack.gmOnly}
                  <span class="pack-row__gm" title={t("FUSION.Compendium.Shelf.GmOnlyHint")}>
                    {t("FUSION.Compendium.Shelf.GmOnly")}
                  </span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/each}

<style>
  /*
   * No width anywhere: the drawer owns it (REQ-GAV-012, REQ-CPD-017). Rows grow
   * down, never sideways — which is exactly why the label ellipses and the
   * license wraps.
   */
  .pack-group {
    margin-bottom: 0.75rem;
  }

  .pack-group__heading {
    margin: 0 0 0.25rem;
    font-size: 0.7rem;
  }

  .pack-group__toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.15rem 0.25rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fusion-text-muted, #888);
    font: inherit;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: left;
  }

  .pack-group__toggle:hover {
    color: var(--fusion-text, #eee);
  }

  .pack-group__chevron {
    flex-shrink: 0;
    transition: transform var(--fusion-transition, 0.15s);
  }

  .pack-group__chevron--collapsed {
    transform: rotate(-90deg);
  }

  .pack-group__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pack-group__count {
    flex-shrink: 0;
    font-size: 0.7rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--fusion-text-muted, #888);
    background: var(--fusion-surface, #222);
    border-radius: 9999px;
    padding: 0.1rem 0.4rem;
  }

  .pack-group__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .pack-row {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.5rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    color: var(--fusion-text, #eee);
    font: inherit;
    text-align: left;
    transition: background 0.15s;
  }

  .pack-row:hover {
    background: var(--fusion-border, #444);
  }

  .pack-row__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    min-width: 0;
  }

  /* The label is what gives way when the drawer is narrow. */
  .pack-row__label {
    flex: 1;
    min-width: 0;
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pack-row__count {
    flex-shrink: 0;
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
  }

  .pack-row__meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.3rem;
    font-size: 0.68rem;
  }

  /*
   * DEC-CPD-07: the license is the one field that is never truncated. It wraps
   * onto a second line instead — hence no `text-overflow` and no `nowrap` here.
   */
  .pack-row__license {
    color: var(--fusion-text-muted, #888);
    overflow-wrap: anywhere;
  }

  .pack-row__gm {
    flex-shrink: 0;
    padding: 0 0.3rem;
    border: 1px solid var(--fusion-border, #444);
    border-radius: 9999px;
    color: var(--fusion-accent, #c0a060);
  }
</style>
