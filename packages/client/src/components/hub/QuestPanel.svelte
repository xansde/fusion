<script lang="ts">
  /**
   * QuestPanel.svelte — the Missões panel of the System Window.
   *
   * Spec: 28 (DEC-HUB-04..07, REQ-HUB-021..042), and the design settled with
   * the owner in `docs/design/quadro-de-missoes.md`.
   *
   * The board reads like a diary the party keeps, not like a mural: a finished
   * objective is struck through where it stands rather than moving to a "done"
   * block at the bottom, because the trail of what was already done is what
   * makes it feel like a record of play (design §6).
   *
   * Everything that is not layout lives in `lib/hub/questStore.svelte.ts`.
   * This file turns documents into elements and clicks into ops — and, on the
   * GM's side, hands the authoring surface to `QuestAuthoring.svelte`.
   */

  import { onMount, onDestroy } from "svelte";
  import { isObjectiveDone, objectivePois } from "@fusion/shared";
  import { session, getSocket } from "$lib/session.svelte.js";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";
  import { isEmptyDoc } from "$lib/ui/richText.js";
  import RichText from "../ui/RichText.svelte";
  import QuestAuthoring from "./QuestAuthoring.svelte";
  import {
    questStore,
    buildBoard,
    splitBoard,
    createQuest,
    listTablePlayers,
    type QuestView,
    type TablePlayer,
  } from "$lib/hub/questStore.svelte.js";
  import { regionMapStore } from "$lib/hub/regionMapStore.svelte.js";

  interface Props {
    /** Switch the Hub to the Mapa panel and centre it on a pin (REQ-HUB-041). */
    onTrackOnMap?: (pinId: string) => void;
  }

  const { onTrackOnMap }: Props = $props();

  const userId = $derived(session.user?.id ?? "");
  const role = $derived(session.user?.role ?? 0);
  const isGm = $derived(role >= 3);

  let players = $state<TablePlayer[]>([]);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  /** Objectives whose description is expanded, by page id. */
  let expanded = $state<Record<string, boolean>>({});

  onMount(() => {
    questStore.attach();
    // Read the region map, do NOT subscribe to it: the map panel owns that
    // subscription, and a detach here would tear down its live updates. The
    // quest board only needs the pins that exist right now, to name places.
    regionMapStore.refresh();
    players = listTablePlayers();
  });
  onDestroy(() => {
    questStore.detach();
  });

  /**
   * Whose board is on screen.
   *
   * A GM previewing a player drops their own privilege for the duration — that
   * is the whole point of REQ-HUB-033, and doing it here rather than inside
   * `buildBoard` keeps the preview honest: it runs the player's path, not a
   * GM path with things hidden.
   */
  const viewerId = $derived(isGm && questStore.viewAs !== null ? questStore.viewAs : userId);
  const previewing = $derived(isGm && questStore.viewAs !== null);
  const board = $derived(buildBoard(questStore.quests, viewerId, isGm && !previewing));
  const split = $derived(splitBoard(board));

  /** Pins this viewer actually has on the region map, for `rastrear no mapa`. */
  const visiblePinIds = $derived(
    new Set((regionMapStore.selected?.pins ?? []).map((pin) => pin._id)),
  );

  function trackablePins(view: QuestView, pageIds: string[]): string[] {
    // A quest shown only as a rumour never exposes its places (REQ-HUB-042).
    if (view.reading !== "published") return [];
    return pageIds.filter((id) => visiblePinIds.has(id));
  }

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

  function newQuest(): void {
    void run(async () => {
      const id = await createQuest(socketOrThrow(), "Nova missão");
      questStore.openQuestId = id;
    });
  }

  function toggle(pageId: string): void {
    expanded = { ...expanded, [pageId]: !expanded[pageId] };
  }

  function track(pinId: string): void {
    regionMapStore.openPinId = pinId;
    onTrackOnMap?.(pinId);
  }

  const activeCount = $derived(split.published.filter((view) => !view.done).length);
</script>

<div class="panel {HUB_SURFACE_CLASS}">
  <!-- ------------------------------------------------------------------ -->
  <!-- Header                                                             -->
  <!-- ------------------------------------------------------------------ -->
  <div class="head">
    <span class="count">{activeCount} {activeCount === 1 ? "ativa" : "ativas"}</span>
    <span class="spacer"></span>

    {#if isGm}
      <!-- REQ-HUB-033: the preview is the player's own path, not a GM path
           with pieces hidden — so it changes what this panel computes, not
           just what it draws. -->
      <select
        class="control"
        value={questStore.viewAs ?? ""}
        onchange={(e) => {
          const value = (e.currentTarget as HTMLSelectElement).value;
          questStore.viewAs = value === "" ? null : value;
        }}
        aria-label="Ver o quadro como"
      >
        <option value="">como GM</option>
        {#each players as player (player.id)}
          <option value={player.id}>ver como {player.name}</option>
        {/each}
      </select>
      <button class="control" type="button" onclick={newQuest} disabled={busy}>+ missão</button>
    {/if}
  </div>

  {#if previewing}
    <p class="preview-note">
      Prévia do quadro de <strong>{players.find((p) => p.id === viewerId)?.name ?? "?"}</strong> —
      é exatamente o que chega ao cliente dele.
    </p>
  {/if}

  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  <!-- ------------------------------------------------------------------ -->
  <!-- The board                                                          -->
  <!-- ------------------------------------------------------------------ -->
  <div class="board">
    {#each split.published as view (view.entry._id)}
      <article class="quest" class:done={view.done}>
        <header class="quest-head">
          <button
            class="quest-title"
            type="button"
            onclick={() => (questStore.openQuestId = view.entry._id)}
            disabled={!isGm || previewing}
          >
            <span class="bullet">●</span>{view.entry.name}
          </button>
          {#if view.done}<span class="badge">concluída</span>{/if}
        </header>

        {#if view.hook && !isEmptyDoc(view.hook.content)}
          <div class="hook">
            <RichText value={view.hook.content} readonly onChange={() => {}} />
          </div>
        {/if}

        <ul class="objectives">
          {#each view.objectives as objective (objective._id)}
            {@const hasBody = !isEmptyDoc(objective.content)}
            {@const isOpen = expanded[objective._id] === true}
            {@const pins = trackablePins(view, objectivePois(objective))}
            {@const done = isObjectiveDone(objective)}
            <li class="objective">
              <div class="objective-line">
                <span class="tick" aria-hidden="true">{done ? "✓" : "○"}</span>
                <span class="objective-name" class:struck={done}>{objective.name}</span>
                <!-- No expander when there is no description: most objectives
                     are one line ("falar com o xerife") and an affordance that
                     opens nothing is a lie (REQ-HUB-032b). -->
                {#if hasBody}
                  <button
                    class="expander"
                    type="button"
                    aria-expanded={isOpen}
                    onclick={() => toggle(objective._id)}
                  >
                    {isOpen ? "▴" : "▾"}
                  </button>
                {/if}
              </div>

              {#if hasBody && isOpen}
                <div class="objective-body">
                  <RichText value={objective.content} readonly onChange={() => {}} />
                  {#each pins as pinId (pinId)}
                    <button class="track" type="button" onclick={() => track(pinId)}>
                      📍 rastrear no mapa
                    </button>
                  {/each}
                </div>
              {/if}
            </li>
          {:else}
            <li class="objective empty-line">Nenhum objetivo liberado ainda.</li>
          {/each}
        </ul>

        {#each trackablePins(view, view.pois) as pinId (pinId)}
          <button class="track quest-track" type="button" onclick={() => track(pinId)}>
            📍 rastrear no mapa
          </button>
        {/each}
      </article>
    {:else}
      <p class="empty">Nenhuma missão ainda.</p>
    {/each}

    {#if split.rumours.length > 0}
      <section class="rumours">
        <h3 class="rumours-title">? Boatos</h3>
        {#each split.rumours as view (view.entry._id)}
          <!-- A rumour shows the written text and NOTHING else — not the
               quest's name, which would be the reveal (REQ-HUB-023). -->
          <div class="rumour">
            {#if view.rumour}
              <RichText value={view.rumour.content} readonly onChange={() => {}} />
            {/if}
          </div>
        {/each}
      </section>
    {/if}
  </div>

  {#if isGm && !previewing && questStore.openQuest}
    <QuestAuthoring
      entry={questStore.openQuest}
      {players}
      onClose={() => (questStore.openQuestId = null)}
    />
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .spacer {
    flex: 1;
  }

  .count {
    font-size: 10px;
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
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

  .preview-note {
    margin: 0;
    padding: 4px 6px;
    border-left: 2px solid var(--fusion-sw-gold);
    font-size: 11px;
    color: var(--fusion-sw-dim);
  }

  .error {
    margin: 0;
    font-size: 11px;
    color: var(--fusion-sw-bad);
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    min-height: 0;
  }

  .empty {
    margin: 0;
    padding: 24px 8px;
    font-size: 12px;
    color: var(--fusion-sw-dim);
    text-align: center;
  }

  .quest {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .quest.done {
    opacity: 0.65;
  }

  .quest-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .quest-title {
    padding: 0;
    border: none;
    background: none;
    color: var(--fusion-sw-ink);
    font: 700 12px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
  }
  .quest-title:disabled {
    cursor: default;
  }

  .bullet {
    margin-right: 6px;
    color: var(--fusion-sw-gold);
  }

  .badge {
    font-size: 9px;
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .hook {
    font-size: 12px;
    line-height: 1.55;
    color: var(--fusion-sw-ink);
  }

  .objectives {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .objective-line {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fusion-sw-ink);
  }

  .tick {
    width: 12px;
    color: var(--fusion-sw-dim);
  }

  .objective-name {
    flex: 1;
  }

  /* Struck through in place — the trail of what was done is the point. */
  .objective-name.struck {
    text-decoration: line-through;
    color: var(--fusion-sw-dim);
  }

  .expander {
    padding: 0 4px;
    border: none;
    background: none;
    color: var(--fusion-sw-dim);
    cursor: pointer;
    font-size: 11px;
  }

  .objective-body {
    margin: 2px 0 6px 18px;
    padding-left: 8px;
    border-left: 1px solid var(--fusion-sw-line);
    font-size: 12px;
    line-height: 1.55;
    color: var(--fusion-sw-ink);
  }

  .empty-line {
    font-size: 11px;
    font-style: italic;
    color: var(--fusion-sw-dim);
  }

  .track {
    align-self: flex-start;
    margin-top: 4px;
    padding: 2px 6px;
    border: 1px solid var(--fusion-sw-line);
    background: none;
    color: var(--fusion-sw-ink);
    font: 600 10px var(--fusion-sw-font);
    cursor: pointer;
  }
  .track:hover {
    background: var(--fusion-sw-fill-active);
  }

  .quest-track {
    align-self: flex-end;
  }

  .rumours {
    padding-top: 8px;
    border-top: 1px dashed var(--fusion-sw-line);
  }

  .rumours-title {
    margin: 0 0 4px;
    font: 700 10px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .rumour {
    font-size: 12px;
    font-style: italic;
    line-height: 1.55;
    color: var(--fusion-sw-dim);
  }

  @media (prefers-reduced-motion: reduce) {
    .control {
      transition: none;
    }
  }
</style>
