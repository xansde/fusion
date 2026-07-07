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

  import { onMount } from "svelte";
  import type { Socket } from "socket.io-client";
  import type { ChatMessage } from "@fusion/shared";
  import { chatStore, loadMoreHistory } from "../../lib/chat/chatStore.svelte.js";
  import { ScrollStateManager } from "../../lib/chat/scrollState.js";
  import { groupChatMessages } from "../../lib/chat/chatGrouping.js";
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

  // ---- Nested-roll grouping (r18-N1) ----
  // Spell-cast rolls (attack/damage/save) carry flags.fusion.parentMessageId;
  // group them so the log renders ONE card per conjuration (children nested
  // inside their parent). An orphan (parent scrolled out / not yet paginated)
  // degrades to a normal top-level card — see groupChatMessages. Unread count
  // and 3D dice remain per-message (handled in chatStore/chatMessageSync,
  // which are unchanged and count/animate every incoming message).
  const grouped = $derived(groupChatMessages(chatStore.messages));

  // ---- Scroll state machine ----

  const scrollManager = new ScrollStateManager({
    scrollToBottom: () => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    },
    setIndicatorVisible: (v) => {
      showIndicator = v;
    },
  });

  // ---- React to new messages ----
  // NOTE: unread-count visibility tracking (setChatTabVisible) now lives in
  // AppSidebar.svelte, which owns activeTab and can observe every tab value —
  // including the initial default — even though ChatLog only mounts while
  // the chat tab is the active one (see AppSidebar's BUG #1 FIX comment).

  let _prevMsgCount = 0;

  $effect(() => {
    const count = chatStore.messages.length;
    if (count > _prevMsgCount) {
      const diff = count - _prevMsgCount;
      for (let i = 0; i < diff; i++) {
        scrollManager.onNewMessage();
      }
      _prevMsgCount = count;
    }
  });

  // ---- Initial scroll to bottom after mount ----

  onMount(() => {
    scrollManager.forceScrollToBottom();
  });

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
    <div class="chat-log__load-indicator">Loading…</div>
  {:else if chatStore.hasMore}
    <div class="chat-log__load-indicator chat-log__load-indicator--hint">
      Scroll up for more
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
      <p class="chat-log__loading">Loading messages…</p>
    {:else if chatStore.messages.length === 0}
      <p class="chat-log__empty">No messages yet. Say something!</p>
    {:else}
      {#each grouped.topLevel as msg (msg._id)}
        <ChatMessageComponent
          message={msg}
          children={grouped.childrenByParent.get(msg._id) ?? []}
          {socket}
          {isGm}
          {userId}
          {worldId}
        />
      {/each}
    {/if}

    {#if chatStore.error}
      <p class="chat-log__error" role="alert">{chatStore.error}</p>
    {/if}
  </div>

  <!-- New messages indicator -->
  {#if showIndicator}
    <button
      class="chat-log__new-indicator"
      onclick={jumpToBottom}
      aria-label="New messages — click to jump to bottom"
    >
      New messages ▼
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
