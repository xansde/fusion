<script lang="ts">
  /**
   * StockTracker.svelte — the Crafter's Essências de Monstro.
   *
   * A count per essence level, plus the fusion that is the archetype's whole
   * economy: 2×[Nv N] → 1×[Nv N+1]. Levels with zero are dropped from the map
   * rather than kept at 0, so the list shows what you HAVE instead of twenty
   * empty rows.
   */

  import type {
    IsekaiArchetype,
    IsekaiStockTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import type { IsekaiStockState } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiStockTracker;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: IsekaiStockState) => void;
  }

  let { archetype, def, trackerState, editable, onChange }: Props = $props();

  const stock = $derived.by(() => {
    const out: Record<number, number> = {};
    if (trackerState === null || typeof trackerState !== "object" || Array.isArray(trackerState)) return out;
    for (const [key, value] of Object.entries(trackerState as Record<string, unknown>)) {
      const lvl = Number(key);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > def.maxLevel) continue;
      if (typeof value === "number" && value > 0) out[lvl] = Math.floor(value);
    }
    return out;
  });

  const levels = $derived(
    Object.keys(stock)
      .map(Number)
      .sort((a, b) => a - b),
  );

  let pick = $state(1);

  /** Write the map back, dropping every level that reached zero. */
  function commit(next: Record<number, number>): void {
    const clean: IsekaiStockState = {};
    for (const [key, value] of Object.entries(next)) {
      if (value > 0) clean[key] = value;
    }
    onChange(clean);
  }

  function setCount(level: number, count: number): void {
    commit({ ...stock, [level]: Math.max(0, count) });
  }

  function fuse(level: number): void {
    if ((stock[level] ?? 0) < def.fuseRatio || level >= def.maxLevel) return;
    commit({
      ...stock,
      [level]: (stock[level] ?? 0) - def.fuseRatio,
      [level + 1]: (stock[level + 1] ?? 0) + 1,
    });
  }
</script>

<TrackerFrame title={def.title} accent={archetype.color} note={def.note}>
  {#if editable}
    <div class="add">
      <span>{t("FUSION.Sheet.Isekai.Tracker.LevelShort")}</span>
      <button type="button" onclick={() => (pick = Math.max(1, pick - 1))}>−</button>
      <b>{pick}</b>
      <button type="button" onclick={() => (pick = Math.min(def.maxLevel, pick + 1))}>+</button>
      <button type="button" onclick={() => setCount(pick, (stock[pick] ?? 0) + 1)}>
        + {def.unitLabel}
      </button>
    </div>
  {/if}

  {#if levels.length === 0}
    <span class="empty">{t("FUSION.Sheet.Isekai.Tracker.EmptyStock")}</span>
  {/if}

  {#each levels as level (level)}
    <div class="row">
      <span class="row__lvl">{t("FUSION.Sheet.Isekai.Tracker.LevelShort")} {level}</span>
      {#if editable}
        <button type="button" onclick={() => setCount(level, (stock[level] ?? 0) - 1)}>−</button>
      {/if}
      <b class="row__count">{stock[level]}</b>
      {#if editable}
        <button type="button" onclick={() => setCount(level, (stock[level] ?? 0) + 1)}>+</button>
        <button
          type="button"
          class="fuse"
          disabled={(stock[level] ?? 0) < def.fuseRatio || level >= def.maxLevel}
          title={t("FUSION.Sheet.Isekai.Tracker.FuseHint", {
            ratio: String(def.fuseRatio),
            from: String(level),
            to: String(level + 1),
          })}
          onclick={() => fuse(level)}
        >
          ⤴ {t("FUSION.Sheet.Isekai.Tracker.Fuse")}
        </button>
      {/if}
    </div>
  {/each}
</TrackerFrame>

<style>
  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: var(--fusion-text-muted);
  }

  .add b {
    font-size: 12px;
    color: var(--fusion-text);
    min-width: 16px;
    text-align: center;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
  }

  .row__lvl {
    font-size: 10.5px;
    color: var(--fusion-text-muted);
    min-width: 44px;
  }

  .row__count {
    font-size: 12px;
    color: var(--fusion-text);
    min-width: 18px;
    text-align: center;
  }

  .fuse {
    margin-left: auto;
    font-size: 10px !important;
  }

  .empty {
    font-size: 10.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }
</style>
