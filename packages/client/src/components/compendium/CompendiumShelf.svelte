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
   * may not drop for lack of room: the label and the license both wrap, nothing is cut. The
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
  import Icon from "../common/Icon.svelte";

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
        <span
          class="pack-group__chevron"
          class:pack-group__chevron--collapsed={group.collapsed}
          aria-hidden="true"
        >
          <Icon name="chevron-down" size={16} />
        </span>
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
              <span class="pack-row__label">{pack.label}</span>
              <span class="pack-row__meta">
                <span class="pack-row__count">
                  {t("FUSION.Compendium.Shelf.DocumentCount", { count: pack.documentCount })}
                </span>
                <span class="pack-row__sep" aria-hidden="true">·</span>
                <!--
                  Never conditional and never clipped: the license is the field
                  that has to survive a narrow drawer (DEC-CPD-07). Plain text in
                  the meta line; the long attribution is the row's tooltip.
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
   * down, never sideways: the name breaks onto a second line, the meta wraps.
   * Group = section heading; pack = flat row split by a divider (no card in card).
   */
  .pack-group {
    margin-bottom: var(--fusion-space-4);
  }

  .pack-group__heading {
    margin: 0 0 var(--fusion-space-1);
    font-size: var(--fusion-text-lg);
    font-weight: 500;
  }

  .pack-group__toggle {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
    width: 100%;
    min-height: var(--fusion-target);
    padding: 0 var(--fusion-space-1);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fusion-text);
    font: inherit;
    font-weight: inherit;
    text-align: left;
  }

  .pack-group__toggle:hover .pack-group__title {
    color: var(--fusion-accent);
  }

  .pack-group__chevron {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--fusion-text-muted);
    transition: transform var(--fusion-transition);
  }

  .pack-group__chevron--collapsed {
    transform: rotate(-90deg);
  }

  .pack-group__title {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .pack-group__count {
    flex-shrink: 0;
    font-size: var(--fusion-text-xs);
    font-weight: 400;
    color: var(--fusion-text-muted);
  }

  .pack-group__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .pack-group__item + .pack-group__item {
    border-top: 1px solid var(--fusion-border);
  }

  .pack-row {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-1);
    width: 100%;
    min-height: var(--fusion-target);
    box-sizing: border-box;
    padding: var(--fusion-space-2) var(--fusion-space-1);
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    color: var(--fusion-text);
    font: inherit;
    text-align: left;
    transition: background var(--fusion-transition);
  }

  .pack-row:hover {
    background: var(--fusion-surface-alt);
  }

  /* The whole name, breaking onto a second line when the drawer is narrow. */
  .pack-row__label {
    font-size: var(--fusion-text-base);
    overflow-wrap: anywhere;
  }

  .pack-row__meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--fusion-space-1) var(--fusion-space-2);
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-muted);
  }

  /* DEC-CPD-07: the license is never truncated — no `text-overflow`, no `nowrap`. */
  .pack-row__license {
    overflow-wrap: anywhere;
  }

  .pack-row__gm {
    flex-shrink: 0;
    padding: 0 var(--fusion-space-2);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-warning-dim);
    color: var(--fusion-text);
  }
</style>
