<script lang="ts">
  /**
   * FamiliarSheet.svelte — the standalone window sheet for a familiar Actor
   * (spec 29 REQ-PET-055). A lean statblock: derived HP/AC/Perception/saves/
   * attack/speed, a "belongs to <master>" header linking back to the master's
   * sheet, and the selected daily abilities. Editing lives in the master's
   * Pets tab (the source of truth for creation/budget); this window is a
   * read-focused view (HP still editable by the owner).
   *
   * Registered via registerPf2eSheets for Actor subtype "familiar" and opened
   * from the Pets tab's "open sheet" action or a token double-click.
   *
   * Clean-room: remaster (ORC) mechanics only.
   */

  import { worldMirror } from "$lib/docs/worldSync.js";
  import { session, getSocket } from "$lib/session.svelte.js";
  import { sendOp, toEnvelope } from "$lib/docs/sendOp.js";
  import { requireConnectedSocket } from "$lib/compendium/compendiumApi.js";
  import { t, i18n } from "$lib/i18n/i18n.js";
  import { openActorSheet } from "$lib/sheets/pf2e/registerPf2eSheets.js";
  import {
    readFamiliar,
    buildSetHpOp,
    loadAbilityEntries,
    toAbilityRow,
    type AbilityRow,
  } from "$lib/sheets/pf2e/petsVM.js";
  import { getUserLevel, type Ownership } from "@fusion/shared";
  import ActorPortrait from "../../../common/ActorPortrait.svelte";

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    worldId?: string;
  }

  let { doc, actorId, ownership, userId, isGm, worldId = "" }: Props = $props();

  // Live doc from worldMirror (WindowHost captures props once at open time).
  let liveDoc = $state(doc);
  $effect(() => {
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      const fresh = docs.find((d) => (d as { _id?: unknown })._id === actorId);
      if (fresh) liveDoc = fresh;
    });
    return unsub;
  });

  let allActors = $state<Array<Record<string, unknown>>>([]);
  $effect(() => {
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      allActors = docs;
    });
    return unsub;
  });

  const masterId = $derived.by((): string => {
    const sys = liveDoc["system"] as Record<string, unknown> | undefined;
    return typeof sys?.["masterActorId"] === "string" ? (sys["masterActorId"] as string) : "";
  });

  const familiar = $derived(readFamiliar(liveDoc, masterId));
  const editable = $derived(isGm || ownership >= 3);

  const masterDoc = $derived(allActors.find((a) => (a as { _id?: unknown })._id === masterId));
  const masterName = $derived.by((): string => {
    const sys = liveDoc["system"] as Record<string, unknown> | undefined;
    const cache = sys?.["master"] as { name?: unknown } | undefined;
    const cached = typeof cache?.name === "string" ? cache.name : "";
    const live = masterDoc && typeof masterDoc["name"] === "string" ? (masterDoc["name"] as string) : "";
    return live || cached || t("FUSION.Sheet.Pets.UnknownMaster");
  });

  // Ability names for the selected chips.
  let abilityRows = $state<AbilityRow[]>([]);
  $effect(() => {
    void (async () => {
      if (abilityRows.length > 0) return;
      try {
        const entries = await loadAbilityEntries(getSocket, session.worldInfo?.systemId ?? "pf2e");
        abilityRows = entries.map((e) => toAbilityRow(e, i18n.locale));
      } catch {
        abilityRows = [];
      }
    })();
  });
  const nameBySlug = $derived.by((): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of abilityRows) m.set(r.slug, r.name);
    return m;
  });

  function fmtMod(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  async function setHp(e: Event): Promise<void> {
    const raw = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    try {
      const sock = requireConnectedSocket(getSocket());
      const op = buildSetHpOp(familiar, raw);
      // toEnvelope normalizes the flat doc:update into `{ updates: [{ _id, diff }] }`
      // (the server's DocUpdatePayloadSchema rejects the flat `{ id, diff }`).
      await sendOp(sock, toEnvelope(op));
    } catch (err) {
      console.error("[FamiliarSheet] HP update failed:", err);
    }
  }

  function openMaster(): void {
    if (!masterDoc) return;
    const own = (masterDoc["ownership"] as Ownership | undefined) ?? { default: 0 };
    const lvl = getUserLevel(own, userId);
    openActorSheet(masterId, masterDoc, { userId, ownership: isGm ? 3 : lvl, isGm, worldId });
  }

  // Portrait from the familiar's raw Actor doc (r19-W4).
  const famImg = $derived(typeof liveDoc["img"] === "string" ? (liveDoc["img"] as string) : null);
</script>

<div class="fam-sheet">
  <header class="fam-sheet__header">
    <div class="fam-sheet__ident">
      <ActorPortrait
        img={famImg}
        docRef={{ table: "actors", id: actorId }}
        name={familiar.name}
        size={48}
        label={t("FUSION.Sheet.Portrait.Alt", { name: familiar.name })}
      />
      <div class="fam-sheet__headings">
        <h2 class="fam-sheet__name">{familiar.name}</h2>
        <div class="fam-sheet__belongs">
          {t("FUSION.Sheet.Pets.BelongsTo")}
          {#if masterDoc}
            <button class="fam-sheet__master-link" onclick={openMaster}>{masterName}</button>
          {:else}
            <span class="fam-sheet__master">{masterName}</span>
          {/if}
        </div>
      </div>
    </div>
    {#if familiar.appearance}
      <p class="fam-sheet__appearance">{familiar.appearance}</p>
    {/if}
  </header>

  <div class="fam-sheet__stats">
    <div class="fam-stat">
      <span class="fam-stat__label">{t("FUSION.Sheet.Pets.HP")}</span>
      <span class="fam-stat__value">
        {#if editable}
          <input class="fam-hp" type="number" min="0" max={familiar.hp.max} value={familiar.hp.value} onchange={setHp} />
        {:else}
          {familiar.hp.value}
        {/if}
        <span class="fam-stat__sep">/ {familiar.hp.max}</span>
      </span>
    </div>
    <div class="fam-stat"><span class="fam-stat__label">{t("FUSION.Sheet.Pets.AC")}</span><span class="fam-stat__value">{familiar.ac}</span></div>
    <div class="fam-stat"><span class="fam-stat__label">{t("FUSION.Sheet.Pets.Perception")}</span><span class="fam-stat__value">{fmtMod(familiar.perception)}</span></div>
    <div class="fam-stat"><span class="fam-stat__label">{t("FUSION.Sheet.Pets.Attack")}</span><span class="fam-stat__value">{fmtMod(familiar.attack)}</span></div>
    <div class="fam-stat"><span class="fam-stat__label">{t("FUSION.Sheet.Labels.Saves.Fort")}</span><span class="fam-stat__value">{fmtMod(familiar.saves.fortitude)}</span></div>
    <div class="fam-stat"><span class="fam-stat__label">{t("FUSION.Sheet.Labels.Saves.Ref")}</span><span class="fam-stat__value">{fmtMod(familiar.saves.reflex)}</span></div>
    <div class="fam-stat"><span class="fam-stat__label">{t("FUSION.Sheet.Labels.Saves.Will")}</span><span class="fam-stat__value">{fmtMod(familiar.saves.will)}</span></div>
    <div class="fam-stat">
      <span class="fam-stat__label">{t("FUSION.Sheet.Pets.Speed")}</span>
      <span class="fam-stat__value">{familiar.speed} {t("FUSION.Sheet.Pets.Feet")}
        {#each familiar.otherSpeeds as sp}<span class="fam-stat__other">· {sp.type} {sp.value}</span>{/each}
      </span>
    </div>
  </div>

  <section class="fam-sheet__abilities">
    <h3 class="fam-sheet__section-title">
      {t("FUSION.Sheet.Pets.Abilities")} <span class="fam-sheet__count">{familiar.selectedAbilities.length}/{familiar.abilitiesBudget.max}</span>
    </h3>
    {#if familiar.selectedAbilities.length > 0}
      <div class="fam-sheet__chips">
        {#each familiar.selectedAbilities as slug (slug)}
          <span class="fam-chip">{nameBySlug.get(slug) ?? slug}</span>
        {/each}
      </div>
    {:else}
      <p class="fam-sheet__empty">{t("FUSION.Sheet.Pets.NoAbilities")}</p>
    {/if}
  </section>
</div>

<style>
  .fam-sheet {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .fam-sheet__header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .fam-sheet__ident {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .fam-sheet__headings {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .fam-sheet__name {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
  }

  .fam-sheet__belongs {
    font-size: 12px;
    color: var(--fusion-text-muted);
  }

  .fam-sheet__master-link {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--fusion-accent);
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
  }

  .fam-sheet__master {
    font-weight: 700;
    color: var(--fusion-text);
  }

  .fam-sheet__appearance {
    margin: 2px 0 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--fusion-text-muted);
  }

  .fam-sheet__stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
  }

  .fam-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 9px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
  }

  .fam-stat__label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
  }

  .fam-stat__value {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .fam-stat__sep {
    font-size: 11px;
    font-weight: 500;
    color: var(--fusion-text-subtle);
  }

  .fam-stat__other {
    font-size: 10px;
    font-weight: 500;
    color: var(--fusion-text-subtle);
  }

  .fam-hp {
    width: 44px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 1px 4px;
    color: var(--fusion-text);
    font-size: 15px;
    font-weight: 700;
    text-align: center;
    outline: none;
  }

  .fam-hp:focus {
    border-color: var(--fusion-accent);
  }

  .fam-sheet__section-title {
    margin: 0 0 6px;
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .fam-sheet__count {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-pill);
    padding: 1px 6px;
  }

  .fam-sheet__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .fam-chip {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-pill);
    padding: 2px 9px;
  }

  .fam-sheet__empty {
    margin: 0;
    font-size: 12px;
    color: var(--fusion-text-subtle);
  }
</style>
