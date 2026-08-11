<script lang="ts">
  /**
   * CatalogTracker.svelte — the Evolutivo's Catálogo do Predador.
   *
   * The catalogue itself is unlimited; what is capped is how many entries are
   * PREPARED for the day (Constitution + level). The limit is an editable
   * number rather than a derived one: the rule reads off Constitution, which
   * this widget deliberately does not reach into — a player who boosts CON
   * mid-campaign changes one number here, and nobody has to trust that the
   * sheet guessed their modifier right.
   *
   * From level 12 (Predador Supremo) passives stop counting against the limit,
   * so only prepared ACTIVES are tallied.
   */

  import type {
    IsekaiArchetype,
    IsekaiCatalogTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import type {
    IsekaiCatalogEntryState,
    IsekaiCatalogState,
  } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiCatalogTracker;
    level: number;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: IsekaiCatalogState) => void;
  }

  let { archetype, def, level, trackerState, editable, onChange }: Props = $props();

  function isEntry(value: unknown): value is IsekaiCatalogEntryState {
    if (value === null || typeof value !== "object") return false;
    const e = value as Record<string, unknown>;
    return typeof e["id"] === "string" && typeof e["name"] === "string";
  }

  const raw = $derived(
    trackerState !== null && typeof trackerState === "object" ? (trackerState as Record<string, unknown>) : {},
  );
  const entries = $derived(
    (Array.isArray(raw["entries"]) ? raw["entries"] : []).filter(isEntry).map((e) => ({
      ...e,
      type: e.type === "passive" ? ("passive" as const) : ("active" as const),
      prepared: e.prepared === true,
    })),
  );
  const limit = $derived(typeof raw["limit"] === "number" ? Math.max(0, raw["limit"]) : level);

  /** Passives stop counting from the level Predador Supremo lands. */
  const passivesFree = $derived(
    def.passivesUnlimitedFromLevel !== undefined && level >= def.passivesUnlimitedFromLevel,
  );
  const preparedCount = $derived(
    entries.filter((e) => e.prepared && !(passivesFree && e.type === "passive")).length,
  );
  const atLimit = $derived(preparedCount >= limit);

  let draft = $state("");
  let seq = 0;

  function commit(patch: Partial<IsekaiCatalogState>): void {
    onChange({ entries, limit, ...patch });
  }

  function add(type: "passive" | "active"): void {
    const name = draft.trim();
    if (!name) return;
    commit({
      entries: [
        ...entries,
        { id: `k${Date.now().toString(36)}${String(seq++)}`, name, type, prepared: false },
      ],
    });
    draft = "";
  }

  function togglePrepared(id: string): void {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    // Refuse to prepare past the limit; un-preparing is always allowed.
    if (!entry.prepared && atLimit && !(passivesFree && entry.type === "passive")) return;
    commit({ entries: entries.map((e) => (e.id === id ? { ...e, prepared: !e.prepared } : e)) });
  }

  function remove(id: string): void {
    commit({ entries: entries.filter((e) => e.id !== id) });
  }

  const meta = $derived(
    t("FUSION.Sheet.Isekai.Tracker.PreparedMeta", {
      n: String(preparedCount),
      limit: String(limit),
    }),
  );
</script>

<TrackerFrame title={def.title} accent={archetype.color} {meta} note={def.note}>
  {#if editable}
    <div class="add">
      <input
        type="text"
        bind:value={draft}
        placeholder={def.placeholder}
        onkeydown={(e) => {
          if (e.key === "Enter") add("active");
        }}
      />
      <button type="button" title={t("FUSION.Sheet.Isekai.Tracker.AddPassive")} onclick={() => add("passive")}>
        +P
      </button>
      <button type="button" title={t("FUSION.Sheet.Isekai.Tracker.AddActive")} onclick={() => add("active")}>
        +A
      </button>
    </div>

    <div class="limit">
      <span>{t("FUSION.Sheet.Isekai.Tracker.PreparedLimit")}</span>
      <button type="button" onclick={() => commit({ limit: Math.max(0, limit - 1) })}>−</button>
      <b>{limit}</b>
      <button type="button" onclick={() => commit({ limit: limit + 1 })}>+</button>
      <span class="dim">{t("FUSION.Sheet.Isekai.Tracker.ConPlusLevel")}</span>
    </div>
  {/if}

  {#if entries.length === 0}
    <span class="empty">{t("FUSION.Sheet.Isekai.Tracker.EmptyCatalog")}</span>
  {/if}

  {#each entries as entry (entry.id)}
    <div class="row" class:row--prepared={entry.prepared}>
      <button
        type="button"
        class="star"
        disabled={!editable}
        title={t("FUSION.Sheet.Isekai.Tracker.TogglePrepared")}
        onclick={() => togglePrepared(entry.id)}
      >
        {entry.prepared ? "★" : "☆"}
      </button>
      <span class="kind" class:kind--passive={entry.type === "passive"}>
        {entry.type === "passive" ? "P" : "A"}
      </span>
      <span class="row__name">{entry.name}</span>
      {#if editable}
        <button type="button" title={t("FUSION.Sheet.Isekai.Tracker.Remove")} onclick={() => remove(entry.id)}>
          ✕
        </button>
      {/if}
    </div>
  {/each}

  {#if passivesFree}
    <p class="legend">{t("FUSION.Sheet.Isekai.Tracker.PassivesFree")}</p>
  {/if}
</TrackerFrame>

<style>
  .add {
    display: flex;
    gap: 6px;
  }

  .limit {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: var(--fusion-text-muted);
  }

  .limit b {
    font-size: 12px;
    color: var(--fusion-text);
    min-width: 14px;
    text-align: center;
  }

  .dim {
    color: var(--fusion-text-subtle);
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

  .row--prepared {
    border-color: color-mix(in srgb, var(--accent, currentColor) 60%, var(--fusion-border));
  }

  .row__name {
    flex: 1;
    font-size: 11.5px;
    color: var(--fusion-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent);
  }

  .kind--passive {
    background: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .star {
    padding: 1px 4px !important;
    font-size: 12px !important;
    border: none !important;
    background: none !important;
  }

  .empty {
    font-size: 10.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .legend {
    margin: 0;
    font-size: 10px;
    color: var(--fusion-text-subtle);
  }
</style>
