<script lang="ts">
  /**
   * QuestAuthoring.svelte — where the GM writes a quest and reveals it.
   *
   * Spec: 28 (REQ-HUB-028..042), design `docs/design/quadro-de-missoes.md`.
   *
   * One surface, not a wizard: the GM writes the hook, the rumour and the
   * objectives in the same place they reveal them, because deciding what a
   * player may read is part of writing the thing, not a separate administrative
   * step (design §1).
   *
   * Two rules show up repeatedly below and are worth stating once:
   *
   *  - **Reveal is never a side effect of an edit.** Renaming an objective or
   *    ticking it off goes through `journal:updatePage`, which cannot touch
   *    ownership; revealing goes through `journal:revealPage`, which is the
   *    only op that can. The separation is enforced by the server's payload
   *    schemas, and this component simply never mixes them.
   *  - **Propagating a reveal to a place is OFFERED, never automatic**
   *    (DEC-HUB-07): revealing an objective that names a pin shows a one-click
   *    action to reveal the pin too. A GM who wanted the party to know the
   *    objective without knowing where it is must stay able to do that.
   */

  import { OwnershipLevel, canReadPage, type JournalEntryPage } from "@fusion/shared";
  import { getSocket } from "$lib/session.svelte.js";
  import RichText from "../ui/RichText.svelte";
  import {
    createPage,
    updatePage,
    deletePage,
    revealPage,
    setQuestDone,
    setQuestPois,
    updateQuest,
    pageRole,
    objectivesOf,
    questPois,
    type TablePlayer,
  } from "$lib/hub/questStore.svelte.js";
  import { regionMapStore, revealPin } from "$lib/hub/regionMapStore.svelte.js";
  import type { QuestEntry } from "@fusion/shared";

  interface Props {
    entry: QuestEntry;
    players: TablePlayer[];
    onClose: () => void;
  }

  const { entry, players, onClose }: Props = $props();

  let busy = $state(false);
  let errorMessage = $state<string | null>(null);

  const hook = $derived(entry.pages.find((page) => pageRole(page) === "hook") ?? null);
  const rumour = $derived(entry.pages.find((page) => pageRole(page) === "rumour") ?? null);
  const objectives = $derived(objectivesOf(entry));

  /** Pins of the region map on screen, for the POI links. */
  const pins = $derived(regionMapStore.selected?.pins ?? []);
  const mapId = $derived(regionMapStore.selected?._id ?? null);

  function socketOrThrow() {
    const socket = getSocket();
    if (!socket) throw new Error("sem conexão com o servidor");
    return socket;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    errorMessage = null;
    try {
      await action();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function hubOf(page: JournalEntryPage): { done?: boolean; pois?: string[] } {
    return (page.flags["fusion"]?.["hub"] ?? {}) as { done?: boolean; pois?: string[] };
  }

  // -- the quest itself -----------------------------------------------------

  function renameQuest(event: Event): void {
    const name = (event.currentTarget as HTMLInputElement).value;
    void run(async () => {
      await updateQuest(socketOrThrow(), entry._id, { name });
    });
  }

  function toggleQuestDone(): void {
    void run(async () => {
      const done = (entry.flags?.["fusion"]?.["hub"] as { done?: boolean } | undefined)?.done;
      await setQuestDone(socketOrThrow(), entry, done !== true);
    });
  }

  function toggleQuestPoi(pinId: string): void {
    void run(async () => {
      const current = questPois(entry);
      const next = current.includes(pinId)
        ? current.filter((id) => id !== pinId)
        : [...current, pinId];
      await setQuestPois(socketOrThrow(), entry, next);
    });
  }

  // -- pages ----------------------------------------------------------------

  /**
   * The hook and the rumour are ordinary pages that happen to be named.
   *
   * They are created on demand rather than up front so a quest the GM has not
   * finished writing does not carry two empty pages that the matrix would then
   * ask them to reveal.
   */
  /**
   * Guard against the second keystroke creating a second page.
   *
   * The editor reports changes on a debounce, so typing into an empty hook
   * fires `ensurePage` again long before the first `createPage` has come back
   * and repopulated `entry.pages` — without this, a GM writing two sentences
   * would end up with two hooks.
   */
  let creating = $state<Record<string, boolean>>({});

  function ensurePage(role: "hook" | "rumour", content: string): void {
    const existing = role === "hook" ? hook : rumour;
    if (existing) {
      void run(async () => {
        await updatePage(socketOrThrow(), entry._id, existing._id, { content });
      });
      return;
    }
    if (creating[role] === true) return;
    creating = { ...creating, [role]: true };
    void run(async () => {
      try {
        await createPage(socketOrThrow(), entry._id, {
          name: role === "hook" ? "Gancho" : "Boato",
          content,
          sort: role === "hook" ? 0 : 1,
          hub: { role },
        });
      } finally {
        creating = { ...creating, [role]: false };
      }
    });
  }

  function addObjective(): void {
    void run(async () => {
      await createPage(socketOrThrow(), entry._id, {
        name: "Novo objetivo",
        sort: 2 + objectives.length,
        hub: { role: "objective" },
      });
    });
  }

  function renameObjective(page: JournalEntryPage, event: Event): void {
    const name = (event.currentTarget as HTMLInputElement).value;
    void run(async () => {
      await updatePage(socketOrThrow(), entry._id, page._id, { name });
    });
  }

  function describeObjective(page: JournalEntryPage, content: string): void {
    void run(async () => {
      await updatePage(socketOrThrow(), entry._id, page._id, { content });
    });
  }

  function toggleObjectiveDone(page: JournalEntryPage): void {
    void run(async () => {
      await updatePage(socketOrThrow(), entry._id, page._id, {
        hub: { done: hubOf(page).done !== true },
      });
    });
  }

  function toggleObjectivePoi(page: JournalEntryPage, pinId: string): void {
    void run(async () => {
      const current = hubOf(page).pois ?? [];
      const next = current.includes(pinId)
        ? current.filter((id) => id !== pinId)
        : [...current, pinId];
      await updatePage(socketOrThrow(), entry._id, page._id, { hub: { pois: next } });
    });
  }

  function removePage(page: JournalEntryPage): void {
    void run(async () => {
      await deletePage(socketOrThrow(), entry._id, page._id);
    });
  }

  // -- reveal ---------------------------------------------------------------

  function reveals(page: JournalEntryPage, userId: string): boolean {
    return canReadPage(page, entry.ownership, userId);
  }

  function setReveal(page: JournalEntryPage, userId: string, on: boolean): void {
    void run(async () => {
      await revealPage(
        socketOrThrow(),
        entry._id,
        page._id,
        [userId],
        on ? OwnershipLevel.OBSERVER : OwnershipLevel.NONE,
      );
    });
  }

  /**
   * "todos" — bring the table to the next step (REQ-HUB-031).
   *
   * Only ever reveals. A GM catching one player up must not take the objective
   * away from another who already had it, so there is no "hide from everyone"
   * on this button; hiding is per player, above.
   */
  function revealToTable(page: JournalEntryPage): void {
    void run(async () => {
      await revealPage(socketOrThrow(), entry._id, page._id, [], OwnershipLevel.OBSERVER);
    });
  }

  /** DEC-HUB-07: offered, never automatic. */
  function revealPinsOf(page: JournalEntryPage): void {
    const ids = hubOf(page).pois ?? [];
    if (mapId === null || ids.length === 0) return;
    void run(async () => {
      for (const pinId of ids) {
        await revealPin(socketOrThrow(), mapId, pinId, [], OwnershipLevel.OBSERVER);
      }
    });
  }

  const questDone = $derived(
    (entry.flags?.["fusion"]?.["hub"] as { done?: boolean } | undefined)?.done === true,
  );
</script>

<div class="authoring">
  <div class="head">
    <input
      class="name-input"
      value={entry.name}
      onchange={renameQuest}
      aria-label="Nome da missão"
    />
    <button class="control" type="button" onclick={toggleQuestDone} disabled={busy}>
      {questDone ? "reabrir" : "concluir"}
    </button>
    <button class="control" type="button" onclick={onClose} aria-label="Fechar autoria">×</button>
  </div>

  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  <!-- ------------------------------------------------------------------ -->
  <!-- Hook and rumour                                                    -->
  <!-- ------------------------------------------------------------------ -->
  <section class="block">
    <h4 class="block-title">Gancho</h4>
    <RichText
      value={hook?.content ?? ""}
      onChange={(value) => ensurePage("hook", value)}
      placeholder="O que a missão é, para quem já a tem."
      ariaLabel="Gancho da missão"
    />
    {#if hook}
      {@const hookPage = hook}
      <div class="reveal-row">
        <span class="who">quem lê</span>
        {#each players as player (player.id)}
          <button
            class="control tiny"
            class:on={reveals(hookPage, player.id)}
            type="button"
            disabled={busy}
            onclick={() => setReveal(hookPage, player.id, !reveals(hookPage, player.id))}
          >
            {player.name}
          </button>
        {/each}
        <button
          class="control tiny"
          type="button"
          disabled={busy}
          onclick={() => revealToTable(hookPage)}
        >
          todos ▸
        </button>
      </div>
    {/if}
  </section>

  <section class="block">
    <h4 class="block-title">Boato</h4>
    <!-- DEC-HUB-05: the rumour is TEXT THE GM WRITES, never an automatic
         excerpt of the hook — the shape of an excerpt tells the player what
         kind of thing is behind it. -->
    <RichText
      value={rumour?.content ?? ""}
      onChange={(value) => ensurePage("rumour", value)}
      placeholder="O que corre à boca pequena, para quem ainda não tem a missão."
      ariaLabel="Boato da missão"
    />
    {#if rumour}
      {@const rumourPage = rumour}
      <div class="reveal-row">
        <span class="who">quem ouviu</span>
        {#each players as player (player.id)}
          <button
            class="control tiny"
            class:on={reveals(rumourPage, player.id)}
            type="button"
            disabled={busy}
            onclick={() => setReveal(rumourPage, player.id, !reveals(rumourPage, player.id))}
          >
            {player.name}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- Objectives                                                         -->
  <!-- ------------------------------------------------------------------ -->
  <section class="block">
    <div class="block-head">
      <h4 class="block-title">Objetivos</h4>
      <button class="control" type="button" onclick={addObjective} disabled={busy}>
        + objetivo
      </button>
    </div>

    {#each objectives as objective (objective._id)}
      {@const hub = hubOf(objective)}
      <div class="objective">
        <div class="objective-head">
          <button
            class="tick-button"
            type="button"
            disabled={busy}
            aria-pressed={hub.done === true}
            onclick={() => toggleObjectiveDone(objective)}
          >
            {hub.done ? "✓" : "○"}
          </button>
          <input
            class="objective-input"
            value={objective.name}
            onchange={(e) => renameObjective(objective, e)}
            aria-label="Nome do objetivo"
          />
          <button
            class="control tiny danger"
            type="button"
            disabled={busy}
            onclick={() => removePage(objective)}
            aria-label="Remover objetivo">×</button
          >
        </div>

        <RichText
          value={objective.content}
          onChange={(value) => describeObjective(objective, value)}
          placeholder="Descrição (opcional)"
          ariaLabel="Descrição do objetivo"
        />

        <div class="reveal-row">
          <span class="who">liberado a</span>
          {#each players as player (player.id)}
            <button
              class="control tiny"
              class:on={reveals(objective, player.id)}
              type="button"
              disabled={busy}
              onclick={() => setReveal(objective, player.id, !reveals(objective, player.id))}
            >
              {player.name}
            </button>
          {/each}
          <button
            class="control tiny"
            type="button"
            disabled={busy}
            onclick={() => revealToTable(objective)}
          >
            todos ▸
          </button>
        </div>

        {#if pins.length > 0}
          <div class="reveal-row">
            <span class="who">lugares</span>
            {#each pins as pin (pin._id)}
              <button
                class="control tiny"
                class:on={(hub.pois ?? []).includes(pin._id)}
                type="button"
                disabled={busy}
                onclick={() => toggleObjectivePoi(objective, pin._id)}
              >
                📍 {pin.text || "sem nome"}
              </button>
            {/each}
            {#if (hub.pois ?? []).length > 0}
              <!-- Offered, never automatic (DEC-HUB-07). -->
              <button
                class="control tiny"
                type="button"
                disabled={busy}
                onclick={() => revealPinsOf(objective)}
              >
                revelar lugares
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <p class="empty">Nenhum objetivo ainda. Cada um é uma etapa com nome livre.</p>
    {/each}
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- The quest's own places                                             -->
  <!-- ------------------------------------------------------------------ -->
  {#if pins.length > 0}
    <section class="block">
      <h4 class="block-title">Lugares da missão</h4>
      <div class="reveal-row">
        {#each pins as pin (pin._id)}
          <button
            class="control tiny"
            class:on={questPois(entry).includes(pin._id)}
            type="button"
            disabled={busy}
            onclick={() => toggleQuestPoi(pin._id)}
          >
            📍 {pin.text || "sem nome"}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ------------------------------------------------------------------ -->
  <!-- Reveal matrix                                                      -->
  <!-- ------------------------------------------------------------------ -->
  {#if players.length > 0 && entry.pages.length > 0}
    <section class="block">
      <h4 class="block-title">Revelação</h4>
      <div class="matrix" role="table" aria-label="Matriz de revelação">
        <div class="matrix-row matrix-head" role="row">
          <span class="matrix-cell page-name" role="columnheader">página</span>
          {#each players as player (player.id)}
            <span class="matrix-cell" role="columnheader">{player.name}</span>
          {/each}
        </div>
        {#each [...entry.pages].sort((a, b) => a.sort - b.sort) as page (page._id)}
          <div class="matrix-row" role="row">
            <span class="matrix-cell page-name" role="cell">{page.name}</span>
            {#each players as player (player.id)}
              <button
                class="matrix-cell state"
                class:revealed={reveals(page, player.id)}
                type="button"
                disabled={busy}
                title="{page.name} · {player.name}"
                onclick={() => setReveal(page, player.id, !reveals(page, player.id))}
              >
                {reveals(page, player.id) ? "●" : "○"}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .authoring {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    overflow-y: auto;
    max-height: 52vh;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .name-input,
  .objective-input {
    flex: 1;
    padding: 4px 6px;
    border: 1px solid var(--fusion-sw-line);
    background: rgba(0, 0, 0, 0.25);
    color: var(--fusion-sw-ink);
    font-family: var(--fusion-sw-font);
    font-size: 12px;
  }

  .name-input {
    font-weight: 700;
  }

  .control {
    padding: 4px 9px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-ink);
    font: 600 10px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    cursor: pointer;
    transition: var(--fusion-sw-transition);
  }
  .control:hover:not(:disabled) {
    background: var(--fusion-sw-fill-active);
  }
  .control:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .control.on {
    border-color: var(--fusion-sw-blue);
    color: var(--fusion-sw-blue);
    background: var(--fusion-sw-fill-active);
  }
  .control.tiny {
    padding: 2px 6px;
    font-size: 9px;
    text-transform: none;
  }
  .control.danger {
    border-color: var(--fusion-sw-bad);
    color: var(--fusion-sw-bad);
  }

  .error {
    margin: 0;
    font-size: 11px;
    color: var(--fusion-sw-bad);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-top: 8px;
    border-top: 1px dashed var(--fusion-sw-line);
  }

  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .block-title {
    margin: 0;
    font: 700 9.5px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .objective {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .objective-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tick-button {
    width: 20px;
    padding: 2px;
    border: 1px solid var(--fusion-sw-line);
    background: none;
    color: var(--fusion-sw-ink);
    cursor: pointer;
    font-size: 11px;
  }

  .reveal-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .who {
    width: 68px;
    font-size: 9.5px;
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .empty {
    margin: 0;
    font-size: 11px;
    font-style: italic;
    color: var(--fusion-sw-dim);
  }

  .matrix {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-x: auto;
  }

  .matrix-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .matrix-cell {
    min-width: 54px;
    font-size: 10px;
    color: var(--fusion-sw-ink);
    text-align: center;
  }

  .matrix-head .matrix-cell {
    color: var(--fusion-sw-dim);
    text-transform: uppercase;
    letter-spacing: var(--fusion-sw-track-label);
  }

  .page-name {
    min-width: 120px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    padding: 1px 0;
    border: 1px solid transparent;
    background: none;
    color: var(--fusion-sw-dim);
    cursor: pointer;
  }
  .state.revealed {
    color: var(--fusion-sw-gold);
  }
  .state:hover:not(:disabled) {
    border-color: var(--fusion-sw-line);
  }

  @media (prefers-reduced-motion: reduce) {
    .control {
      transition: none;
    }
  }
</style>
