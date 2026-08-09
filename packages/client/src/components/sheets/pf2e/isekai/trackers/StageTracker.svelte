<script lang="ts">
  /**
   * StageTracker.svelte — the Underdog's Desespero.
   *
   * One button per barrier, holding the N that every Mark de Desespero scales
   * on. The ladder skips 4 on purpose (1 → 2 → 3 → 5, "no fundo do poço você
   * dá um salto"), which is why the values come from the data rather than
   * being computed from the index.
   */

  import type {
    IsekaiArchetype,
    IsekaiStageTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiStageTracker;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: number) => void;
  }

  let { archetype, def, trackerState, editable, onChange }: Props = $props();

  const current = $derived(typeof trackerState === "number" ? trackerState : 0);
  const meta = $derived(
    current > 0 ? `N = ${String(current)}` : t("FUSION.Sheet.Isekai.Tracker.StageZero"),
  );
</script>

<TrackerFrame title={def.title} accent={archetype.color} {meta} note={def.note}>
  <div class="stages">
    {#each def.stages as stage (stage.value)}
      <button
        type="button"
        class="stage"
        class:stage--on={current === stage.value}
        disabled={!editable}
        onclick={() => onChange(stage.value)}
      >
        <b>{stage.value || "—"}</b>
        <span>{stage.label}</span>
      </button>
    {/each}
  </div>
</TrackerFrame>

<style>
  .stages {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .stage {
    display: flex !important;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 54px;
    padding: 5px 7px !important;
  }

  .stage b {
    font-size: 14px;
    color: var(--fusion-text);
  }

  .stage span {
    font-size: 9px;
    color: var(--fusion-text-subtle);
  }

  .stage--on {
    border-color: var(--accent) !important;
    background: color-mix(in srgb, var(--accent) 16%, var(--fusion-surface)) !important;
  }

  .stage--on b {
    color: var(--accent);
  }
</style>
