<script lang="ts">
  /**
   * RosterTracker.svelte — the Carismático's Séquito, in three tiers.
   *
   * Base is unlimited, up to five may follow, up to three fight at once. The
   * caps are enforced on PROMOTION (a companion cannot move into a full tier)
   * rather than on adding: recruiting into the Base always works, which is what
   * the rule says.
   *
   * ★ Dar um Nome locks 1 point of the Focus maximum. The star is disabled
   * below the level that grants the blessing — showing it greyed tells the
   * player the mechanic exists and when it arrives.
   */

  import type {
    IsekaiArchetype,
    IsekaiRosterTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import type { IsekaiCompanionState } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiRosterTracker;
    level: number;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: IsekaiCompanionState[]) => void;
  }

  let { archetype, def, level, trackerState, editable, onChange }: Props = $props();

  const TIER_ORDER = ["active", "retinue", "base"] as const;

  function isCompanion(value: unknown): value is IsekaiCompanionState {
    if (value === null || typeof value !== "object") return false;
    const c = value as Record<string, unknown>;
    return typeof c["id"] === "string" && typeof c["name"] === "string";
  }

  const companions = $derived(
    (Array.isArray(trackerState) ? trackerState : []).filter(isCompanion).map((c) => ({
      ...c,
      tier: TIER_ORDER.includes(c.tier) ? c.tier : ("base" as const),
      named: c.named === true,
    })),
  );

  const activeCount = $derived(companions.filter((c) => c.tier === "active").length);
  const followingCount = $derived(companions.filter((c) => c.tier !== "base").length);
  const namedCount = $derived(companions.filter((c) => c.named).length);
  const activeCap = $derived(def.tiers.find((tr) => tr.id === "active")?.cap ?? 3);
  const canName = $derived(level >= def.namedFromLevel);

  let draft = $state("");
  let seq = 0;

  function add(): void {
    const name = draft.trim();
    if (!name) return;
    onChange([
      ...companions,
      { id: `c${Date.now().toString(36)}${String(seq++)}`, name, tier: "base", named: false },
    ]);
    draft = "";
  }

  function update(id: string, patch: Partial<IsekaiCompanionState>): void {
    onChange(companions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function remove(id: string): void {
    onChange(companions.filter((c) => c.id !== id));
  }

  /** Move a companion between tiers, refusing a move into a full tier. */
  function move(companion: IsekaiCompanionState, to: IsekaiCompanionState["tier"]): void {
    if (to === "active" && companion.tier !== "active" && activeCount >= activeCap) return;
    if (to !== "base" && companion.tier === "base" && followingCount >= def.followingCap) return;
    update(companion.id, { tier: to });
  }

  const meta = $derived(
    t("FUSION.Sheet.Isekai.Tracker.RosterMeta", {
      active: String(activeCount),
      activeCap: String(activeCap),
      following: String(followingCount),
      followingCap: String(def.followingCap),
    }) + (namedCount > 0 ? ` · ${String(namedCount)} ★` : ""),
  );
</script>

<TrackerFrame title={def.title} accent={archetype.color} {meta} note={def.note}>
  {#if editable}
    <div class="add">
      <input
        type="text"
        bind:value={draft}
        placeholder={t("FUSION.Sheet.Isekai.Tracker.CompanionPlaceholder")}
        onkeydown={(e) => {
          if (e.key === "Enter") add();
        }}
      />
      <button type="button" onclick={add}>{t("FUSION.Sheet.Isekai.Tracker.Add")}</button>
    </div>
  {/if}

  {#each TIER_ORDER as tierId (tierId)}
    {@const tier = def.tiers.find((tr) => tr.id === tierId)}
    {@const members = companions.filter((c) => c.tier === tierId)}
    <div class="tier">
      <div class="tier__label">
        {tier?.label}{tier?.cap ? ` · ${t("FUSION.Sheet.Isekai.Tracker.UpTo", { n: String(tier.cap) })}` : ""}
      </div>
      {#if members.length === 0}
        <span class="empty">—</span>
      {/if}
      {#each members as companion (companion.id)}
        <div class="row" class:row--named={companion.named}>
          <button
            type="button"
            class="star"
            disabled={!editable || !canName}
            title={canName
              ? t("FUSION.Sheet.Isekai.Tracker.ToggleNamed")
              : t("FUSION.Sheet.Isekai.Tracker.NamedFrom", { n: String(def.namedFromLevel) })}
            onclick={() => update(companion.id, { named: !companion.named })}
          >
            {companion.named ? "★" : "☆"}
          </button>
          <span class="row__name">{companion.name}</span>
          {#if editable}
            <span class="row__move">
              {#if tierId !== "active"}
                <button
                  type="button"
                  title={t("FUSION.Sheet.Isekai.Tracker.Promote")}
                  onclick={() => move(companion, tierId === "base" ? "retinue" : "active")}
                >▲</button>
              {/if}
              {#if tierId !== "base"}
                <button
                  type="button"
                  title={t("FUSION.Sheet.Isekai.Tracker.Demote")}
                  onclick={() => move(companion, tierId === "active" ? "retinue" : "base")}
                >▼</button>
              {/if}
              <button
                type="button"
                title={t("FUSION.Sheet.Isekai.Tracker.Remove")}
                onclick={() => remove(companion.id)}
              >✕</button>
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
</TrackerFrame>

<style>
  .add {
    display: flex;
    gap: 6px;
  }

  .tier {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .tier__label {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-subtle);
    margin-top: 2px;
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

  .row--named {
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

  .row__move {
    display: flex;
    gap: 3px;
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
</style>
