<script lang="ts">
  /**
   * UsesTracker.svelte — the Fodão's limited uses.
   *
   * Checkboxes for abilities that fire once per combat or per encounter. They
   * do NOT reset automatically: Fusion has no "new encounter" signal a sheet
   * can trust, and a tracker that clears itself at the wrong moment is worse
   * than one the player clears deliberately. "Resetar" is one click.
   *
   * Uses appear only from the level that grants them, so a level-3 Fodão sees
   * an honest empty trackerState instead of two abilities they cannot use.
   */

  import type {
    IsekaiArchetype,
    IsekaiUsesTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import { isekaiUsesAtLevel } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiUsesTracker;
    level: number;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: string[]) => void;
  }

  let { archetype, def, level, trackerState, editable, onChange }: Props = $props();

  const spent = $derived(
    new Set((Array.isArray(trackerState) ? trackerState : []).filter((id): id is string => typeof id === "string")),
  );
  const available = $derived(isekaiUsesAtLevel(archetype, level));

  function toggle(id: string): void {
    const next = new Set(spent);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }
</script>

<TrackerFrame title={def.title} accent={archetype.color} note={def.note}>
  {#if available.length === 0}
    <span class="empty">{t("FUSION.Sheet.Isekai.Tracker.NoUsesYet")}</span>
  {/if}

  {#each available as use (use.id)}
    {@const used = spent.has(use.id)}
    <button
      type="button"
      class="use"
      class:use--spent={used}
      disabled={!editable}
      onclick={() => toggle(use.id)}
    >
      <span class="use__check">{used ? "✓" : "○"}</span>
      <span class="use__name">{use.name}</span>
      <span class="use__scope">{use.scope}</span>
    </button>
  {/each}

  {#snippet controls()}
    {#if editable && spent.size > 0}
      <button type="button" onclick={() => onChange([])}>
        {t("FUSION.Sheet.Isekai.Tracker.ResetUses")}
      </button>
    {/if}
  {/snippet}
</TrackerFrame>

<style>
  .use {
    display: flex !important;
    align-items: center;
    gap: 7px;
    width: 100%;
    text-align: left;
    padding: 5px 8px !important;
  }

  .use--spent {
    opacity: 0.55;
  }

  .use--spent .use__name {
    text-decoration: line-through;
  }

  .use__check {
    font-size: 11px;
    color: var(--accent);
  }

  .use__name {
    flex: 1;
    font-size: 11.5px;
    color: var(--fusion-text);
  }

  .use__scope {
    font-size: 9.5px;
    color: var(--fusion-text-subtle);
    white-space: nowrap;
  }

  .empty {
    font-size: 10.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }
</style>
