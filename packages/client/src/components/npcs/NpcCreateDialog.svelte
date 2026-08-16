<script lang="ts">
  /**
   * NpcCreateDialog.svelte — the body of the creation window (spec 42 §5.6, G074).
   *
   * Two doors in the SAME window (REQ-NPC-041), drawn side by side rather than
   * behind a tab strip: the Mestre's question is "give me a goblin", and making him
   * first pick which kind of question he is asking is the third screen DEC-NPC-06
   * set out to remove.
   *
   *  - **Do bestiário** (REQ-NPC-042): a search by name over the actor packs, and
   *    an import that is the spec 16 one. There is no second importer here — the
   *    button calls `importFromBestiary`, which calls `compendium:import`.
   *  - **Do zero** (REQ-NPC-043): subtype and name. The subtype select offers
   *    exactly `npc` and `hazard` (REQ-NPC-044): a player's character is born with
   *    the player, a familiar is born glued to a master, a chest is not an actor,
   *    and a vehicle does not exist in Fusion.
   *
   * Folder and attitude are chosen ONCE, above both doors (REQ-NPC-047), because
   * they are properties of what is being created and not of how it is being
   * created. The folder arrives pre-selected when the window was opened from a
   * folder header.
   *
   * The preset (REQ-NPC-045) pre-fills the sheet and is not stored: this form is
   * the only place its name is ever written, and nothing it sends carries the id.
   * Which is why the row of a created NPC has no "mercador" label to hide
   * (REQ-NPC-046) — there is nothing stored to label it with.
   */

  import type { Socket } from "socket.io-client";
  import type { ActorAttitude } from "@fusion/shared";

  import { t, i18n } from "../../lib/i18n/i18n.js";
  import { OpError } from "../../lib/docs/sendOp.js";
  import { UNFILED_FOLDER_ID } from "../../lib/npcs/folderTree.js";
  import type { MoveTargetOption } from "../../lib/npcs/moveActor.js";
  import {
    NPC_CREATABLE_SUBTYPES,
    createNpcFromScratch,
    importFromBestiary,
    listNpcPresets,
    loadActorPacks,
    searchBestiary,
    subtypeAcceptsAttitude,
    type BestiaryHit,
    type NpcCreatableSubtype,
  } from "../../lib/npcs/createNpc.js";
  import type { PackManifest } from "@fusion/shared";
  // SCAFFOLDING (G078 → G105): see the block at the bottom of this file.
  import { createCharacterScaffolding } from "../../lib/npcs/createCharacterScaffolding.js";
  import { session } from "../../lib/session.svelte.js";

  const {
    socket,
    initialFolderId = null,
    folderOptions = [],
    onClose,
  }: {
    socket: Socket;
    initialFolderId?: string | null;
    folderOptions?: readonly MoveTargetOption[];
    onClose: () => void;
  } = $props();

  // ---- Shared destination (REQ-NPC-047) ----

  // svelte-ignore state_referenced_locally
  let folderId = $state<string>(initialFolderId ?? UNFILED_FOLDER_ID);
  /** `""` means "no attitude", which is a legal state (REQ-NPC-037). */
  let attitude = $state<"" | ActorAttitude>("");

  // ---- From scratch (REQ-NPC-043) ----

  let subtype = $state<NpcCreatableSubtype>("npc");
  let name = $state("");
  let presetId = $state("");

  const presets = $derived(listNpcPresets(subtype));
  const attitudeAllowed = $derived(subtypeAcceptsAttitude(subtype));

  // ---- From the bestiary (REQ-NPC-042) ----

  let packs = $state<PackManifest[]>([]);
  let term = $state("");
  let hits = $state<BestiaryHit[]>([]);
  let searching = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    // Fire and forget: the "do zero" door is usable while the packs load.
    void loadActorPacks(socket)
      .then((loaded) => {
        packs = loaded;
      })
      .catch(report);
  });

  function report(err: unknown): void {
    error = err instanceof OpError ? err.message : String(err);
  }

  function chosenAttitude(subtypeOfTarget: string | null): ActorAttitude | null {
    if (attitude === "") return null;
    return subtypeAcceptsAttitude(subtypeOfTarget) ? attitude : null;
  }

  function chosenFolder(): string | null {
    return folderId === UNFILED_FOLDER_ID ? null : folderId;
  }

  async function runSearch(): Promise<void> {
    const text = term;
    searching = true;
    error = null;
    try {
      const found = await searchBestiary(socket, packs, text, i18n.locale);
      // A late answer to an abandoned term must not overwrite a newer list.
      if (term === text) hits = found;
    } catch (err) {
      report(err);
    } finally {
      searching = false;
    }
  }

  /** REQ-NPC-042: the import is the spec 16 one, consumed — never re-implemented. */
  async function onImport(hit: BestiaryHit): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const result = await importFromBestiary(socket, hit, {
        folderId: chosenFolder(),
        attitude: chosenAttitude(hit.subtype),
      });
      if (result.failed.length > 0) {
        error = result.failed.map((entry) => entry.reason).join("; ");
        return;
      }
      onClose();
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  /** REQ-NPC-043: subtype and name, plus the preset that pre-fills the sheet. */
  async function onCreate(): Promise<void> {
    if (busy || name.trim().length === 0) return;
    busy = true;
    error = null;
    try {
      const created = await createNpcFromScratch(socket, {
        name,
        subtype,
        folderId: chosenFolder(),
        attitude: chosenAttitude(subtype),
        presetId: presetId.length > 0 ? presetId : null,
      });
      if (created) onClose();
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  }

  function onNameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void onCreate();
    }
  }

  // ---- SCAFFOLDING (G078 → G105) ----
  //
  // The buried legacy Actors directory was the last gesture able to create a player's
  // character; spec 37's Usuários section (G105) is where it really belongs
  // (REQ-CFG-051). Until that lands, the gesture lives here, fenced off from both
  // doors: it has its own state, its own handler and its own module, and it never
  // goes through `createNpcFromScratch` — REQ-NPC-044 keeps refusing `character`.
  // Delete this block, its markup section and
  // `lib/npcs/createCharacterScaffolding.ts` together with G105.
  let characterName = $state("");

  async function onCreateCharacterScaffolding(): Promise<void> {
    if (busy || characterName.trim().length === 0) return;
    busy = true;
    error = null;
    try {
      const created = await createCharacterScaffolding(socket, {
        name: characterName,
        systemId: session.worldInfo?.systemId,
      });
      if (created) onClose();
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  function onCharacterNameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void onCreateCharacterScaffolding();
    }
  }
</script>

<div class="npc-create" data-npc-create>
  <!-- REQ-NPC-047: folder and attitude belong to what is created, not to the door
       it came through, so they are chosen once, above both. -->
  <section class="npc-create__block" data-block="destination">
    <label class="npc-create__field">
      <span>{t("FUSION.Npcs.Create.Folder")}</span>
      <select data-input="npc-create-folder" bind:value={folderId}>
        {#each folderOptions as option (option.value)}
          <option value={option.value}>
            {option.unfiled
              ? t("FUSION.Npcs.Folder.Unfiled")
              : "  ".repeat(option.depth) + option.name}
          </option>
        {/each}
      </select>
    </label>

    <label class="npc-create__field">
      <span>{t("FUSION.Npcs.Create.Attitude")}</span>
      <!-- REQ-NPC-037: a hazard has no attitude, so the control is disabled rather
           than offering a value the server would refuse (CA-NPC-010). -->
      <select
        data-input="npc-create-attitude"
        disabled={!attitudeAllowed}
        bind:value={attitude}
      >
        <option value="">{t("FUSION.Npcs.Create.NoAttitude")}</option>
        <option value="ally">{t("FUSION.Npcs.Attitude.ally")}</option>
        <option value="neutral">{t("FUSION.Npcs.Attitude.neutral")}</option>
        <option value="enemy">{t("FUSION.Npcs.Attitude.enemy")}</option>
      </select>
    </label>
  </section>

  {#if error !== null}
    <p class="npc-create__error" role="alert">{error}</p>
  {/if}

  <!-- Door one (REQ-NPC-042). -->
  <section class="npc-create__block" data-door="bestiary">
    <h3 class="npc-create__heading">{t("FUSION.Npcs.Create.FromBestiary")}</h3>

    <div class="npc-create__row">
      <input
        type="search"
        class="npc-create__input"
        data-input="bestiary-search"
        placeholder={t("FUSION.Npcs.Create.BestiarySearch")}
        aria-label={t("FUSION.Npcs.Create.BestiarySearch")}
        bind:value={term}
        onkeydown={onSearchKeydown}
      />
      <button
        class="npc-create__btn"
        type="button"
        data-action="search-bestiary"
        onclick={() => void runSearch()}
      >
        {t("FUSION.Npcs.Create.Search")}
      </button>
    </div>

    {#if searching}
      <p class="npc-create__hint">{t("FUSION.Npcs.Create.Searching")}</p>
    {:else if hits.length === 0 && term.trim().length > 0}
      <p class="npc-create__hint" data-bestiary-empty>
        {t("FUSION.Npcs.Create.NoBestiaryResult", { term })}
      </p>
    {/if}

    <ul class="npc-create__hits" data-bestiary-hits>
      {#each hits as hit (hit.uuid)}
        <li class="npc-create__hit" data-bestiary-uuid={hit.uuid}>
          <span class="npc-create__hit-name">{hit.name}</span>
          {#if hit.secondaryName !== null}
            <span class="npc-create__hit-alt">{hit.secondaryName}</span>
          {/if}
          {#if hit.level !== null}
            <span class="npc-create__hit-level">{t("FUSION.Npcs.Level", { level: hit.level })}</span>
          {/if}
          <span class="npc-create__hit-pack">{hit.packLabel}</span>
          <button
            class="npc-create__btn"
            type="button"
            data-action="import-bestiary"
            disabled={busy}
            onclick={() => void onImport(hit)}
          >
            {t("FUSION.Npcs.Create.Import")}
          </button>
        </li>
      {/each}
    </ul>
  </section>

  <!-- Door two (REQ-NPC-043). -->
  <section class="npc-create__block" data-door="scratch">
    <h3 class="npc-create__heading">{t("FUSION.Npcs.Create.FromScratch")}</h3>

    <label class="npc-create__field">
      <span>{t("FUSION.Npcs.Create.Subtype")}</span>
      <!-- REQ-NPC-044: exactly two options, and the list is written here rather
           than read from the system's declaration (DEC-NPC-05). -->
      <select data-input="npc-create-subtype" bind:value={subtype}>
        {#each NPC_CREATABLE_SUBTYPES as option (option)}
          <option value={option}>{t(`FUSION.Npcs.Subtype.${option}`)}</option>
        {/each}
      </select>
    </label>

    <label class="npc-create__field">
      <span>{t("FUSION.Npcs.Create.Name")}</span>
      <input
        class="npc-create__input"
        data-input="npc-create-name"
        bind:value={name}
        onkeydown={onNameKeydown}
      />
    </label>

    <!-- REQ-NPC-045: the preset pre-fills and is not stored. It exists inside this
         window and nowhere else in the app (REQ-NPC-046). -->
    {#if presets.length > 0}
      <label class="npc-create__field">
        <span>{t("FUSION.Npcs.Create.Preset")}</span>
        <select data-input="npc-create-preset" bind:value={presetId}>
          <option value="">{t("FUSION.Npcs.Create.NoPreset")}</option>
          {#each presets as preset (preset.id)}
            <option value={preset.id}>{t(preset.labelKey)}</option>
          {/each}
        </select>
      </label>
    {/if}

    <div class="npc-create__row npc-create__row--end">
      <button class="npc-create__btn" type="button" data-action="cancel-create" onclick={onClose}>
        {t("FUSION.Npcs.Create.Cancel")}
      </button>
      <button
        class="npc-create__btn npc-create__btn--primary"
        type="button"
        data-action="create-npc"
        disabled={busy || name.trim().length === 0}
        onclick={() => void onCreate()}
      >
        {t("FUSION.Npcs.Create.Confirm")}
      </button>
    </div>
  </section>

  <!-- REQ-NPC-090 lives in the panel; here it is only said once, as the reason the
       subtype list is short: a player's character is not born in this window. -->
  <p class="npc-create__note">{t("FUSION.Npcs.Create.CharacterElsewhere")}</p>

  <!-- SCAFFOLDING (G078 → G105): the temporary door for a player's character.
       Not a third door of REQ-NPC-041 — it is the burial of the legacy directory
       leaving its one irreplaceable gesture on the screen until spec 37's
       Usuários section (REQ-CFG-051) gives it its real address. Drawn apart,
       named as temporary, and wired to its own module. Delete with G105. -->
  <section class="npc-create__block npc-create__block--scaffolding" data-block="character-scaffolding" data-scaffolding="true">
    <h3 class="npc-create__heading">{t("FUSION.Npcs.Create.Scaffolding.Heading")}</h3>
    <p class="npc-create__hint">{t("FUSION.Npcs.Create.Scaffolding.Note")}</p>

    <label class="npc-create__field">
      <span>{t("FUSION.Npcs.Create.Scaffolding.Name")}</span>
      <input
        class="npc-create__input"
        data-input="scaffolding-character-name"
        bind:value={characterName}
        onkeydown={onCharacterNameKeydown}
      />
    </label>

    <div class="npc-create__row npc-create__row--end">
      <button
        class="npc-create__btn"
        type="button"
        data-action="create-character-scaffolding"
        disabled={busy || characterName.trim().length === 0}
        onclick={() => void onCreateCharacterScaffolding()}
      >
        {t("FUSION.Npcs.Create.Scaffolding.Confirm")}
      </button>
    </div>
  </section>
</div>

<style>
  .npc-create {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .npc-create__block {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--fusion-border);
  }

  /* SCAFFOLDING (G078 → G105): visually set apart so it never reads as a third
     door of the tab. Goes away with the block above. */
  .npc-create__block--scaffolding {
    border-bottom: none;
    border-top: 1px dashed var(--fusion-border);
    padding-top: 0.5rem;
    opacity: 0.85;
  }

  .npc-create__heading {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-muted);
  }

  .npc-create__field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .npc-create__row {
    display: flex;
    gap: 0.375rem;
  }

  .npc-create__row--end {
    justify-content: flex-end;
  }

  .npc-create__input,
  .npc-create__field select {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .npc-create__input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .npc-create__btn {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .npc-create__btn:hover:not(:disabled),
  .npc-create__btn:focus-visible {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .npc-create__btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .npc-create__btn--primary {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .npc-create__hits {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 12rem;
    overflow-y: auto;
  }

  .npc-create__hit {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.1875rem 0;
  }

  .npc-create__hit-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .npc-create__hit-alt,
  .npc-create__hit-level,
  .npc-create__hit-pack {
    font-size: 0.6875rem;
    color: var(--fusion-text-subtle);
  }

  .npc-create__hit-pack {
    margin-left: auto;
  }

  .npc-create__hint,
  .npc-create__note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--fusion-text-muted);
  }

  .npc-create__error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--fusion-danger);
  }
</style>
