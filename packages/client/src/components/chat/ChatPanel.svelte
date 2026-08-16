<script lang="ts">
  /**
   * ChatPanel.svelte — the chat tab, top to bottom (plan G033).
   *
   * Spec 38 (`specs/38-aba-chat.md`) §5.2/§5.3/§5.4 lays the panel out as four bands and
   * nothing else:
   *
   *   1. a fixed bar with the search field taking the width and a "⋯" at the right, with
   *      NO textual title — the lit icon on the rail already says where the reader is
   *      (REQ-ACH-010);
   *   2. the log (or, while the field has a term, the results that replace it), filling
   *      every pixel between the bar and the favourites row (REQ-ACH-020);
   *   3. the favourites row (REQ-ACH-050, delivered by `DiceTray`);
   *   4. the write box across the full width with only the send button beside it
   *      (REQ-ACH-030), and the roll mode selector on its own line below it
   *      (REQ-ACH-040) — both inside `ChatInput`.
   *
   * The "⋯" menu offers the favourites editor to every role and, only to a GAMEMASTER,
   * exporting and clearing the log (REQ-ACH-015). ONLY THE FIRST HALF IS DELIVERED HERE.
   * `chat:flush` (REQ-CHT-006) and the export (REQ-CHT-037) have no server operation, and
   * spec 38 §5.10 requires both to be verified on the server — so this panel cannot fake
   * them from the client either. The two entries are drawn where the spec puts them and
   * disabled WITH the reason — the same call `favoriteDice` made for an unusable favourite:
   * a control that says why it cannot act beats one that silently does nothing. That is a
   * placeholder, not the requirement: REQ-ACH-015 stays HALF-OPEN until the server task
   * lands (G041 in `docs/design/gaveta-lateral/tasks.md`), and no test in this component
   * may read the disabled state as proof of REQ-CHT-006/REQ-CHT-037.
   *
   * NO 3D DICE HERE, ON PURPOSE (RNF-ACH-03 / DEC-ACH-12, plan G040). The 3D dice
   * animation of spec 08 (REQ-ROL-035..038, REQ-ROL-042) used to live in this panel: it
   * mounted a `#dice-canvas` host, registered a roll animator on the store and offered a
   * "3D dice" switch in the "⋯" menu. All of it is gone. A die tumbling inside a 300px
   * drawer is an animation nobody watches, and where dice roll is the call of whoever owns
   * the visual layer, not of the conversation panel. `lib/chat/diceBoxBridge.ts` and the
   * `@3d-dice/dice-box` dependency stay in the repository, switched off, until a future mod
   * claims them — but nothing in this panel's module graph reaches them, statically or
   * dynamically, so opening the tab never fetches that code.
   */

  import { onMount, onDestroy } from "svelte";
  import type { Socket } from "socket.io-client";
  import type { ChatSendPayload, ChatMessage } from "@fusion/shared";
  import { sendChatMessage, setChatTabVisible } from "../../lib/chat/chatStore.svelte.js";
  import {
    CHAT_SEARCH_MAX_TERM_LENGTH,
    chatSearch,
    clearChatSearch,
    highlightTerm,
    isChatSearchActive,
    scheduleChatSearch,
    searchSnippet,
  } from "../../lib/chat/chatSearch.svelte.js";
  import { openChatContextWindow } from "../../lib/chat/chatContext.svelte.js";
  import { openFavoriteDiceEditorWindow } from "../../lib/chat/rollBuilderWindow.js";
  import { getMessageDisplayMeta } from "../../lib/chat/messageFormatter.js";
  import { session } from "../../lib/session.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import ChatLog from "./ChatLog.svelte";
  import ChatInput from "./ChatInput.svelte";
  import DiceTray from "./DiceTray.svelte";

  const {
    socket,
    worldId,
    visible = true,
    isGm = false,
    userId = "",
  }: {
    socket: Socket;
    worldId: string;
    visible?: boolean;
    /** Forwarded to ChatLog/ChatMessage so system cards (e.g. Etmos ConjuracaoCard) can gate role-specific buttons. */
    isGm?: boolean;
    userId?: string;
  } = $props();

  let menuOpen = $state(false);

  const searching = $derived(isChatSearchActive());

  // ---- Mount / unmount ----
  //
  // Message sync (history load + live "op" listener) is owned by TableScreen
  // (session-scoped, via attachChatSync + attachChatMessageSync) — NOT by this
  // component, since ChatPanel unmounts whenever the user leaves the chat tab.
  // The only thing mounting means here is "the reader is looking at the chat".
  // It used to also register a 3D dice animator on the store; that is what
  // RNF-ACH-03 removed, and the store's animator slot now stays empty.

  onMount(() => {
    // The chat tab is visible exactly while this panel is mounted: the drawer keeps
    // only the active tab's panel alive and drops it on switch or collapse
    // (REQ-GAV-017), so mount/unmount IS the visibility signal. Zeroing the unread
    // counter on open is the chat's own rule (REQ-CHT-039 / REQ-ACH-004) — the rail
    // never touches a badge (REQ-GAV-022). Before the drawer existed this lived in
    // the sidebar container, which had to watch `activeTab` because the panel could not.
    setChatTabVisible(true);
  });

  onDestroy(() => {
    setChatTabVisible(false);
  });

  // ---- Send ----

  async function handleSend(payload: ChatSendPayload): Promise<void> {
    // BUG E FIX: pass the local user's identity so sendChatMessage can render
    // an instant optimistic echo (plain text only — see isOptimisticallyRenderable).
    const user = session.user;
    const speaker = user ? { userId: user.id, alias: user.name } : undefined;
    await sendChatMessage(socket, payload, speaker);
  }

  // ---- Search (REQ-ACH-010, REQ-ACH-011) ----

  function handleSearchInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    scheduleChatSearch(socket, worldId, value);
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    // Escape clears the field, which is the gesture that gives the live log back.
    if (event.key === "Escape") {
      event.preventDefault();
      clearChatSearch();
    }
  }

  function openResult(msg: ChatMessage): void {
    void openChatContextWindow(socket, worldId, msg._id, { isGm, userId });
  }

  function resultMeta(msg: ChatMessage): { alias: string; timeStr: string } {
    const meta = getMessageDisplayMeta(msg);
    return { alias: meta.alias, timeStr: meta.timeStr };
  }

  // ---- "⋯" menu (REQ-ACH-015) ----

  function toggleMenu(): void {
    menuOpen = !menuOpen;
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      menuOpen = false;
    }
  }

  function openFavoritesEditor(): void {
    menuOpen = false;
    openFavoriteDiceEditorWindow({ worldId, userId });
  }
</script>

<div class="chat-panel">
  <!--
    REQ-ACH-010: fixed top bar for every role — search across the width, "⋯" at the
    right, and no textual title.
  -->
  <div class="chat-panel__bar">
    <div class="chat-panel__search">
      <svg class="chat-panel__search-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path
          d="m10.2 10.2 3.3 3.3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
      <input
        class="chat-panel__search-input"
        type="search"
        value={chatSearch.term}
        oninput={handleSearchInput}
        onkeydown={handleSearchKeydown}
        maxlength={CHAT_SEARCH_MAX_TERM_LENGTH}
        placeholder={t("FUSION.Chat.Search.Placeholder")}
        aria-label={t("FUSION.Chat.Search.Label")}
      />
      {#if searching}
        <button
          class="chat-panel__search-clear"
          type="button"
          onclick={clearChatSearch}
          title={t("FUSION.Chat.Search.Clear")}
          aria-label={t("FUSION.Chat.Search.Clear")}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="m3 3 6 6M9 3l-6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {/if}
    </div>

    <div class="chat-panel__menu-anchor">
      <button
        class="chat-panel__more"
        type="button"
        onclick={toggleMenu}
        onkeydown={handleMenuKeydown}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={t("FUSION.Chat.Menu.More")}
        aria-label={t("FUSION.Chat.Menu.More")}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>

      <div
        class="chat-panel__menu"
        role="menu"
        tabindex="-1"
        hidden={!menuOpen}
        onkeydown={handleMenuKeydown}
        aria-label={t("FUSION.Chat.Menu.More")}
      >
        <!-- Every role edits its own favourites (REQ-ACH-015 / REQ-ACH-055). -->
        <button
          class="chat-panel__menu-item"
          type="button"
          role="menuitem"
          data-action="favorites"
          onclick={openFavoritesEditor}
        >
          {t("FUSION.Chat.Menu.Favorites")}
        </button>

        {#if isGm}
          <!--
            REQ-ACH-015 puts exporting (REQ-CHT-037) and clearing (REQ-CHT-006) under the
            GAMEMASTER alone. Both wait on a server operation that does not exist yet
            (task G041), so what follows is the PLACE the spec asks for, not the action it
            asks for: shown disabled with the reason instead of pretending to work. The
            role gate below is real and is the half of REQ-ACH-015 this panel does deliver.
          -->
          <button
            class="chat-panel__menu-item"
            type="button"
            role="menuitem"
            data-action="export"
            disabled
            title={t("FUSION.Chat.Menu.Unavailable")}
            aria-label="{t('FUSION.Chat.Menu.Export')} — {t('FUSION.Chat.Menu.Unavailable')}"
          >
            {t("FUSION.Chat.Menu.Export")}
          </button>
          <button
            class="chat-panel__menu-item"
            type="button"
            role="menuitem"
            data-action="clear-log"
            disabled
            title={t("FUSION.Chat.Menu.Unavailable")}
            aria-label="{t('FUSION.Chat.Menu.Clear')} — {t('FUSION.Chat.Menu.Unavailable')}"
          >
            {t("FUSION.Chat.Menu.Clear")}
          </button>
        {/if}
      </div>
    </div>
  </div>

  <!--
    REQ-ACH-011: while the field holds a term the results take the log's place; clearing it
    gives the live log back, at the position it was left in (the log hands its offset to
    the session on unmount — REQ-ACH-026).
  -->
  {#if searching}
    <div class="chat-panel__results">
      {#if chatSearch.loading}
        <p class="chat-panel__results-note">{t("FUSION.Chat.Search.Loading")}</p>
      {:else if chatSearch.error}
        <!--
          `chatSearch.error` is an i18n KEY, not a message: the ack carries internal codes
          and, on a rejected payload, the raw Zod issue blob. Rendering it directly is how
          a Zod dump used to reach the drawer.
        -->
        <p class="chat-panel__results-note chat-panel__results-note--error" role="alert">
          {t(chatSearch.error)}
        </p>
      {:else if chatSearch.results.length === 0}
        <p class="chat-panel__results-note">{t("FUSION.Chat.Search.Empty")}</p>
      {:else}
        <ul class="chat-panel__result-list" aria-label={t("FUSION.Chat.Search.ResultsLabel")}>
          {#each chatSearch.results as msg (msg._id)}
            {@const meta = resultMeta(msg)}
            <li>
              <button
                class="chat-panel__result"
                type="button"
                data-message-id={msg._id}
                onclick={() => openResult(msg)}
                title={t("FUSION.Chat.Search.OpenContext")}
              >
                <span class="chat-panel__result-head">
                  <span class="chat-panel__result-alias">{meta.alias}</span>
                  <span class="chat-panel__result-time">{meta.timeStr}</span>
                </span>
                <span class="chat-panel__result-snippet">
                  {#each highlightTerm(searchSnippet(msg.content, chatSearch.term), chatSearch.term) as seg, i (i)}
                    {#if seg.match}<mark class="chat-panel__result-mark">{seg.text}</mark>{:else}{seg.text}{/if}
                  {/each}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <ChatLog {socket} {worldId} {visible} {isGm} {userId} />
  {/if}

  <!-- Favourites row, above the box (REQ-ACH-050) -->
  <DiceTray {worldId} {userId} onRoll={handleSend} />

  <!-- Write box (full width) + roll mode selector below it -->
  <ChatInput {worldId} {userId} onSend={handleSend} />
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--fusion-surface);
  }

  /* ---- Top bar (REQ-ACH-010) ---- */

  .chat-panel__bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .chat-panel__search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 0 0.4rem;
  }

  .chat-panel__search:focus-within {
    border-color: var(--fusion-accent);
  }

  .chat-panel__search-icon {
    width: 0.85rem;
    height: 0.85rem;
    flex-shrink: 0;
    color: var(--fusion-text-subtle);
  }

  .chat-panel__search-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.3rem 0;
  }

  .chat-panel__search-input:focus {
    outline: none;
  }

  .chat-panel__search-clear,
  .chat-panel__more {
    background: none;
    border: none;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem;
    border-radius: var(--fusion-radius-sm);
    flex-shrink: 0;
  }

  .chat-panel__search-clear svg {
    width: 0.7rem;
    height: 0.7rem;
  }

  .chat-panel__more svg {
    width: 1rem;
    height: 1rem;
  }

  .chat-panel__search-clear:hover,
  .chat-panel__more:hover {
    color: var(--fusion-text);
  }

  .chat-panel__search-clear:focus-visible,
  .chat-panel__more:focus-visible,
  .chat-panel__menu-item:focus-visible,
  .chat-panel__result:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  /* ---- "⋯" menu (REQ-ACH-015) ---- */

  .chat-panel__menu-anchor {
    position: relative;
    flex-shrink: 0;
  }

  .chat-panel__menu {
    position: absolute;
    top: calc(100% + 0.25rem);
    right: 0;
    z-index: 20;
    min-width: 12rem;
    display: flex;
    flex-direction: column;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    padding: 0.2rem;
  }

  .chat-panel__menu[hidden] {
    display: none;
  }

  .chat-panel__menu-item {
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.35rem 0.5rem;
    text-align: left;
  }

  .chat-panel__menu-item:not(:disabled):hover {
    background: var(--fusion-surface);
  }

  .chat-panel__menu-item:disabled {
    color: var(--fusion-text-subtle);
    cursor: not-allowed;
  }

  /* ---- Search results (REQ-ACH-011) ---- */

  .chat-panel__results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .chat-panel__results-note {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    text-align: center;
    padding: 1.25rem 1rem;
    margin: 0;
  }

  .chat-panel__results-note--error {
    color: var(--fusion-danger);
  }

  .chat-panel__result-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .chat-panel__result {
    background: none;
    border: none;
    border-bottom: 1px solid var(--fusion-border);
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-family: var(--fusion-font);
    padding: 0.4rem 0.6rem;
    text-align: left;
    width: 100%;
  }

  .chat-panel__result:hover {
    background: var(--fusion-surface-alt);
  }

  .chat-panel__result-head {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.7rem;
    color: var(--fusion-text-subtle);
  }

  .chat-panel__result-alias {
    color: var(--fusion-text);
    font-weight: 600;
  }

  .chat-panel__result-snippet {
    font-size: 0.8125rem;
    line-height: 1.35;
    word-break: break-word;
  }

  .chat-panel__result-mark {
    background: var(--fusion-accent);
    color: #fff;
    border-radius: 2px;
    padding: 0 0.1rem;
  }
</style>
