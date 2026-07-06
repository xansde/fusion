<script lang="ts">
  /**
   * PetsTab.svelte — the PF2e character sheet's "Pets" tab (companions /
   * familiars, spec 29 r16-G4).
   *
   * LAYOUT
   *   - No familiar yet, but the master has a familiar-granting feat → a
   *     call-to-action card to create one (name + appearance).
   *   - One card per linked familiar (PetCard): name, HP (owner-editable),
   *     derived statblock, and the daily-ability picker (N slots = derived
   *     budget). Rename / remove / open-mini-sheet actions.
   *   - Nothing to show → a hint (the feat also unlocks the tab so an owner
   *     always sees the CTA).
   *
   * DATA / SOCKET
   *   The world's actor list is read from worldMirror (reactive) to find the
   *   familiars linked to this master. Create/update/delete ops go through the
   *   LIVE socket via getSocket() (never a frozen prop — r10 lesson). On open,
   *   each familiar's master cache is re-snapshotted (re-derive on read) so a
   *   familiar tracks a master who levelled up while this tab was closed.
   *
   * Clean-room: remaster (ORC) mechanics only.
   */

  import { worldMirror } from "$lib/docs/worldSync.js";
  import { session, getSocket } from "$lib/session.svelte.js";
  import { sendOp, toEnvelope } from "$lib/docs/sendOp.js";
  import { requireConnectedSocket } from "$lib/compendium/compendiumApi.js";
  import { t } from "$lib/i18n/i18n.js";
  import { openActorSheet } from "$lib/sheets/pf2e/registerPf2eSheets.js";
  import {
    detectFamiliarGrant,
    linkedFamiliars,
    buildCreateFamiliarOp,
    buildMasterRefreshOp,
    buildDeleteOp,
    type LinkedFamiliar,
    type CreateFamiliarOp,
    type UpdateFamiliarOp,
    type DeleteFamiliarOp,
  } from "$lib/sheets/pf2e/petsVM.js";

  type FamiliarOp = CreateFamiliarOp | UpdateFamiliarOp | DeleteFamiliarOp;
  import PetCard from "./PetCard.svelte";

  interface Props {
    /** The master character document (reactive `liveDoc` from CharacterSheet). */
    masterDoc: Record<string, unknown>;
    masterId: string;
    /** Whether the current user owns the master (may create/edit familiars). */
    editable: boolean;
    userId: string;
    isGm: boolean;
    ownership: number;
    worldId?: string;
  }

  let { masterDoc, masterId, editable, userId, isGm, ownership, worldId = "" }: Props = $props();

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  // --- Reactive world actor list -------------------------------------------
  let allActors = $state<Array<Record<string, unknown>>>([]);
  $effect(() => {
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      allActors = docs;
    });
    return unsub;
  });

  const grant = $derived(detectFamiliarGrant(masterDoc));
  const familiars = $derived(linkedFamiliars(allActors, masterId));

  // --- Re-derive on read: re-snapshot the master onto each familiar on open -
  // Runs whenever the master doc or the familiar set changes; only writes when
  // buildMasterRefreshOp detects an actual drift (e.g. master levelled up).
  $effect(() => {
    if (!editable) return;
    for (const fam of familiars) {
      const op = buildMasterRefreshOp(fam, masterId, masterDoc);
      if (op) void emitOp(op);
    }
  });

  // --- Create form state ----------------------------------------------------
  let showCreate = $state(false);
  let newName = $state("");
  let newAppearance = $state("");
  let creating = $state(false);
  let createError = $state<string | null>(null);

  async function emitOp(op: FamiliarOp): Promise<void> {
    const sock = requireConnectedSocket(getSocket());
    // toEnvelope normalizes the flat op into the wire shape (doc:create's `data`
    // becomes an array — the server's DocCreatePayloadSchema rejects an object;
    // r16 pets bug) and strips the redundant `type` field from the payload.
    await sendOp(sock, toEnvelope(op));
  }

  async function createFamiliar(): Promise<void> {
    if (creating) return;
    creating = true;
    createError = null;
    try {
      const op = buildCreateFamiliarOp({
        masterId,
        masterDoc,
        name: newName,
        appearance: newAppearance,
      });
      await emitOp(op);
      newName = "";
      newAppearance = "";
      showCreate = false;
    } catch (err) {
      createError = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }

  async function removeFamiliar(fam: LinkedFamiliar): Promise<void> {
    const confirmed = confirm(t("FUSION.Sheet.Pets.RemoveConfirm", { name: fam.name }));
    if (!confirmed) return;
    try {
      await emitOp(buildDeleteOp(fam));
    } catch (err) {
      console.error("[PetsTab] remove failed:", err);
    }
  }

  function openFamiliarSheet(fam: LinkedFamiliar): void {
    const doc = allActors.find((a) => (a as { _id?: unknown })._id === fam.id);
    if (!doc) return;
    openActorSheet(fam.id, doc, { userId, ownership, isGm, worldId });
  }
</script>

<div class="pets-tab">
  {#if familiars.length === 0 && !grant.canHaveFamiliar}
    <!-- No familiar and no grant: nothing to manage. -->
    <p class="pets-empty">{t("FUSION.Sheet.Pets.NoGrant")}</p>
  {:else}
    {#if familiars.length > 0}
      <div class="pets-list">
        {#each familiars as fam (fam.id)}
          <PetCard
            familiar={fam}
            {editable}
            {systemId}
            onOpenSheet={() => openFamiliarSheet(fam)}
            onRemove={() => void removeFamiliar(fam)}
            onOp={(op) => void emitOp(op)}
          />
        {/each}
      </div>
    {/if}

    <!-- Create call-to-action (shown when the master has a grant). -->
    {#if grant.canHaveFamiliar && editable}
      {#if showCreate}
        <div class="pets-create">
          <h3 class="pets-create__title">{t("FUSION.Sheet.Pets.CreateTitle")}</h3>
          <label class="pets-field">
            <span class="pets-field__label">{t("FUSION.Sheet.Pets.NameLabel")}</span>
            <input
              class="pets-field__input"
              type="text"
              bind:value={newName}
              placeholder={t("FUSION.Sheet.Pets.NamePlaceholder")}
              maxlength="60"
            />
          </label>
          <label class="pets-field">
            <span class="pets-field__label">{t("FUSION.Sheet.Pets.AppearanceLabel")}</span>
            <input
              class="pets-field__input"
              type="text"
              bind:value={newAppearance}
              placeholder={t("FUSION.Sheet.Pets.AppearancePlaceholder")}
              maxlength="120"
            />
          </label>
          <p class="pets-create__hint">
            {t("FUSION.Sheet.Pets.BudgetHint", { count: grant.abilityBudget })}
          </p>
          {#if createError}
            <p class="pets-create__error">{createError}</p>
          {/if}
          <div class="pets-create__actions">
            <button class="pets-btn pets-btn--primary" disabled={creating} onclick={() => void createFamiliar()}>
              {creating ? t("FUSION.Sheet.Pets.Creating") : t("FUSION.Sheet.Pets.CreateConfirm")}
            </button>
            <button class="pets-btn" disabled={creating} onclick={() => { showCreate = false; createError = null; }}>
              {t("FUSION.Dialog.Cancel")}
            </button>
          </div>
        </div>
      {:else}
        <button class="pets-cta" onclick={() => { showCreate = true; }}>
          <span class="pets-cta__icon" aria-hidden="true">🐾</span>
          <span class="pets-cta__text">
            <span class="pets-cta__title">{t("FUSION.Sheet.Pets.CtaTitle")}</span>
            <span class="pets-cta__sub">{t("FUSION.Sheet.Pets.CtaSub")}</span>
          </span>
        </button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .pets-tab {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .pets-empty {
    padding: 28px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--fusion-text-muted);
  }

  .pets-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Create CTA button */
  .pets-cta {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-radius: var(--fusion-radius);
    border: 1px dashed var(--fusion-border);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.12s, background 0.12s;
  }

  .pets-cta:hover {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
  }

  .pets-cta__icon {
    font-size: 24px;
    line-height: 1;
  }

  .pets-cta__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pets-cta__title {
    font-size: 13.5px;
    font-weight: 700;
    font-family: var(--fusion-font);
  }

  .pets-cta__sub {
    font-size: 11.5px;
    color: var(--fusion-text-muted);
  }

  /* Create form */
  .pets-create {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--fusion-radius);
    border: 1px solid var(--fusion-accent);
    background: var(--fusion-surface-alt);
  }

  .pets-create__title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .pets-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pets-field__label {
    font-size: 11px;
    font-weight: 600;
    color: var(--fusion-text-muted);
  }

  .pets-field__input {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 6px 10px;
    color: var(--fusion-text);
    font-size: 13px;
    font-family: var(--fusion-font);
    outline: none;
  }

  .pets-field__input:focus {
    border-color: var(--fusion-accent);
  }

  .pets-create__hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--fusion-text-subtle);
  }

  .pets-create__error {
    margin: 0;
    font-size: 12px;
    color: var(--fusion-danger);
  }

  .pets-create__actions {
    display: flex;
    gap: 8px;
  }

  .pets-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    padding: 7px 14px;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .pets-btn:hover:not(:disabled) {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .pets-btn--primary {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .pets-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
