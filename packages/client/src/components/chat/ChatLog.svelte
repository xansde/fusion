<script lang="ts">
  /**
   * ChatLog.svelte — scrollable message log with smart scroll and pagination.
   *
   * Features:
   * - Scroll gruda no fim; quando o usuário rola para cima, mostra indicador
   *   de novas mensagens ao invés de auto-scroll.
   * - "Carregar mais" ao scrollar até o topo (chat:history).
   * - Fade indicator at top showing "Load more" / loading state.
   *
   * REQ-CHT-033..034: cursor-based pagination.
   * Spec 09 §scroll: virtual scroll substituível; nesta milestone usa DOM real
   * com renderização completa (virtual scroll é melhoria futura).
   */

  import { onDestroy, onMount } from "svelte";
  import type { Socket } from "socket.io-client";
  import type { ChatMessage } from "@fusion/shared";
  import {
    chatSession,
    chatStore,
    dismissUnreadMarker,
    loadMoreHistory,
    resolveUnreadAnchorIndex,
  } from "../../lib/chat/chatStore.svelte.js";
  import { ScrollStateManager, resolveMarkerAnchorId } from "../../lib/chat/scrollState.js";
  import { groupChatMessages } from "../../lib/chat/chatGrouping.js";
  import { registerLogScroller } from "../../lib/chat/logScroller.js";
  import { t } from "../../lib/i18n/i18n.js";
  import ChatMessageComponent from "./ChatMessage.svelte";

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
    /** Forwarded to ChatMessage so system cards (e.g. Etmos ConjuracaoCard) can gate role-specific buttons. */
    isGm?: boolean;
    userId?: string;
  } = $props();

  let logEl: HTMLElement | null = $state(null);
  let showIndicator = $state(false);
  /** How many messages piled up below the viewport — the number the notice spells out. */
  let pendingBelow = $state(0);

  // ---- Nested-roll grouping (r18-N1) ----
  // Spell-cast rolls (attack/damage/save) carry flags.fusion.parentMessageId;
  // group them so the log renders ONE card per conjuration (children nested
  // inside their parent). An orphan (parent scrolled out / not yet paginated)
  // degrades to a normal top-level card — see groupChatMessages. Unread count
  // and 3D dice remain per-message (handled in chatStore/chatMessageSync,
  // which are unchanged and count/animate every incoming message).
  const grouped = $derived(groupChatMessages(chatStore.messages));

  // ---- Unread divider (REQ-ACH-004/005) ----
  //
  // The row the "N novas" divider sits above. Null when there is no divider, or
  // when its anchor is no longer in the loaded page (RNF-ACH-02: we do not page
  // back through history to find it).
  // A nested roll has no row of its own: the row that draws it is its parent card,
  // and that is where the divider belongs (REQ-ACH-004 — immediately BEFORE the
  // first unread, never after the card that already showed it).
  const containerByChildId = $derived(
    new Map<string, string>(
      [...grouped.childrenByParent].flatMap(([parentId, children]) =>
        children.map((child): [string, string] => [child._id, parentId]),
      ),
    ),
  );
  const markerAnchorId = $derived(
    resolveMarkerAnchorId(
      chatStore.messages.map((m) => m._id),
      grouped.topLevel.map((m) => m._id),
      chatStore.unreadMarker?.firstUnreadId,
      containerByChildId,
    ),
  );
  const markerCount = $derived(chatStore.unreadMarker?.count ?? 0);

  // ---- Scroll state machine ----

  const scrollManager = new ScrollStateManager({
    scrollToBottom: () => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    },
    setIndicatorVisible: (visible, count) => {
      showIndicator = visible;
      pendingBelow = count;
    },
    // Reaching the end is the only thing that retires the divider (REQ-ACH-005).
    reachedEnd: () => {
      dismissUnreadMarker();
    },
  });

  // ---- React to new messages ----
  // NOTE: unread-count visibility tracking (setChatTabVisible) lives in
  // ChatPanel's onMount/onDestroy: the drawer keeps only the active tab's panel
  // mounted (REQ-GAV-017), so the panel's own lifecycle IS the visibility signal.
  // ChatLog must not own it — it also unmounts when the log is replaced.

  let _prevMsgCount = 0;
  /**
   * The first pass only records how much was already there. Messages already in
   * the store when the panel mounts are not arrivals — counting them would open
   * the log with a "N novas" notice for messages that are simply the log
   * (REQ-ACH-006 is about what arrives *while* the reader is looking).
   */
  let _seeded = false;

  $effect(() => {
    const count = chatStore.messages.length;
    if (!_seeded) {
      _seeded = true;
      _prevMsgCount = count;
      return;
    }
    if (count > _prevMsgCount) {
      const diff = count - _prevMsgCount;
      for (let i = 0; i < diff; i++) {
        scrollManager.onNewMessage();
      }
      _prevMsgCount = count;
    }
  });

  // ---- Where the log opens (REQ-ACH-004, REQ-ACH-026, RNF-ACH-02) ----
  //
  // Three cases, in order of who has the strongest claim on the viewport:
  //  1. there is a "N novas" divider → land on it, not on the end. Landing on the
  //     end would lose exactly the messages the badge promised (REQ-ACH-004);
  //  2. the reader had scrolled somewhere and switched tabs → put them back
  //     (REQ-ACH-026: the log position survives the switch);
  //  3. otherwise → the end, as always.

  onMount(() => {
    // REQ-ACH-034: sending takes the log to its end, and the element that can do that
    // lives here. The sender is a sibling, not a child, so the ability is published
    // rather than threaded down.
    registerLogScroller(() => {
      scrollManager.forceScrollToBottom();
    });

    if (positionAtUnreadMarker()) return;

    const saved = chatSession.scrollTop;
    if (saved !== null && logEl) {
      logEl.scrollTop = saved;
      scrollManager.onScroll(logEl.scrollTop, logEl.scrollHeight, logEl.clientHeight);
      return;
    }

    scrollManager.forceScrollToBottom();
  });

  onDestroy(() => {
    registerLogScroller(null);
    // Hand the position to the session before the component goes (REQ-ACH-026).
    if (logEl) chatSession.scrollTop = logEl.scrollTop;
  });

  /**
   * Bring the first unread into view. Returns false when there is nothing to
   * land on — no divider, or an anchor that aged out of the loaded page.
   */
  function positionAtUnreadMarker(): boolean {
    if (resolveUnreadAnchorIndex() < 0) return false;
    const anchorId = markerAnchorId;
    if (anchorId === null || !logEl) return false;

    const row = logEl.querySelector<HTMLElement>(`[data-message-id="${anchorId}"]`);
    if (!row) return false;

    logEl.scrollTop = row.offsetTop - logEl.offsetTop;
    scrollManager.positionAtAnchor();
    // A log that already fits the drawer has nothing left to scroll: landing on the
    // anchor put the end of the log on screen too, and no scroll event will ever
    // fire to say so. Handing the real metrics over closes that hole — the "N novas"
    // divider retires now, as REQ-ACH-005 asks of a reader who reached the end,
    // instead of standing forever; and the view re-pins, so the next arrival scrolls
    // along instead of lighting a notice for a line already in view (REQ-ACH-006).
    scrollManager.onScroll(logEl.scrollTop, logEl.scrollHeight, logEl.clientHeight);
    return true;
  }

  // ---- Scroll event handler ----

  function handleScroll(): void {
    if (!logEl) return;
    scrollManager.onScroll(logEl.scrollTop, logEl.scrollHeight, logEl.clientHeight);

    // Load more when near the top (threshold: 80px)
    if (logEl.scrollTop < 80 && chatStore.hasMore && !chatStore.loadingMore) {
      void loadMoreHistory(socket, worldId);
    }
  }

  // ---- Jump to bottom ----

  function jumpToBottom(): void {
    scrollManager.jumpToBottom();
  }
</script>

<div class="chat-log-container">
  <!-- Load more indicator at top -->
  {#if chatStore.loadingMore}
    <div class="chat-log__load-indicator">{t("FUSION.Chat.Log.Loading")}</div>
  {:else if chatStore.hasMore}
    <div class="chat-log__load-indicator chat-log__load-indicator--hint">
      {t("FUSION.Chat.Log.LoadMore")}
    </div>
  {/if}

  <!-- Message list -->
  <div
    class="chat-log"
    bind:this={logEl}
    onscroll={handleScroll}
    role="log"
    aria-label="Chat messages"
    aria-live="polite"
    aria-atomic="false"
  >
    {#if chatStore.loadingInitial}
      <p class="chat-log__loading">{t("FUSION.Chat.Log.Loading")}</p>
    {:else if chatStore.messages.length === 0}
      <!-- Empty state per the mother spec's §7 contract, item 4 (REQ-ACH-020). -->
      <p class="chat-log__empty">
        {t("FUSION.Chat.Log.Empty")}
        <span class="chat-log__empty-hint">{t("FUSION.Chat.Log.EmptyHint")}</span>
      </p>
    {:else}
      {#each grouped.topLevel as msg (msg._id)}
        {#if markerAnchorId === msg._id}
          <!-- REQ-ACH-004: "N novas" sits immediately above the first unread. -->
          <div class="chat-log__unread-marker" role="separator">
            <span class="chat-log__unread-marker-label"
              >{t("FUSION.Chat.Log.UnreadMarker", { count: markerCount })}</span
            >
          </div>
        {/if}
        <div class="chat-log__row" data-message-id={msg._id}>
          <ChatMessageComponent
            message={msg}
            children={grouped.childrenByParent.get(msg._id) ?? []}
            continuesPrevious={grouped.continuations.has(msg._id)}
            {socket}
            {isGm}
            {userId}
            {worldId}
          />
        </div>
      {/each}
    {/if}

    {#if chatStore.error}
      <p class="chat-log__error" role="alert">{chatStore.error}</p>
    {/if}
  </div>

  <!--
    REQ-ACH-006: away from the end, a new message does not move the log — it
    piles up behind this notice, which counts what is waiting and, when pressed,
    is the way to the end.
  -->
  {#if showIndicator}
    <button
      class="chat-log__new-indicator"
      onclick={jumpToBottom}
      aria-label={t("FUSION.Chat.Log.NewBelowHint", { count: pendingBelow })}
    >
      <svg class="chat-log__new-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M6 1.5v7.5M2.5 6.5 6 10l3.5-3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {t("FUSION.Chat.Log.NewBelow", { count: pendingBelow })}
    </button>
  {/if}
</div>

<style>
  .chat-log-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }

  .chat-log {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    /* Smooth scrolling */
    scroll-behavior: auto; /* don't animate auto-scroll, only user scrolls */
  }

  .chat-log__loading,
  .chat-log__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    text-align: center;
    padding: 1.5rem 1rem;
    margin: 0;
  }

  .chat-log__empty-hint {
    display: block;
    font-size: 0.75rem;
    margin-top: 0.25rem;
    opacity: 0.85;
  }

  .chat-log__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
    padding: 0.3rem 0.75rem;
    margin: 0;
  }

  /* Load more indicator */
  .chat-log__load-indicator {
    text-align: center;
    font-size: 0.7rem;
    color: var(--fusion-text-subtle);
    padding: 0.3rem;
    flex-shrink: 0;
  }

  .chat-log__load-indicator--hint {
    color: var(--fusion-text-subtle);
  }

  /* Unread divider (REQ-ACH-004) */
  .chat-log__unread-marker {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
  }

  .chat-log__unread-marker::before,
  .chat-log__unread-marker::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--fusion-accent);
    opacity: 0.55;
  }

  .chat-log__unread-marker-label {
    color: var(--fusion-accent);
    font-family: var(--fusion-font);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  /* New messages indicator */
  .chat-log__new-indicator {
    position: absolute;
    bottom: 0.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--fusion-accent);
    border: none;
    border-radius: 1rem;
    color: #fff;
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.3rem 0.9rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    animation: slide-up 0.15s ease-out;
    white-space: nowrap;
    z-index: 10;
  }

  .chat-log__new-indicator:hover {
    background: var(--fusion-accent-hover);
  }

  .chat-log__new-arrow {
    width: 0.75rem;
    height: 0.75rem;
    vertical-align: -0.1em;
    margin-right: 0.25rem;
  }

  @keyframes slide-up {
    from {
      transform: translateX(-50%) translateY(8px);
      opacity: 0;
    }
    to {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  }
</style>
