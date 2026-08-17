<script lang="ts">
  /**
   * ChatContextWindow.svelte — the one context window (plan G038).
   *
   * Spec 38 §5.2. Activating a search result opens this window centred on that
   * message, with the 5 visible neighbours on each side and a "mais 5" control per
   * side (REQ-ACH-013); there is at most one of these windows at a time, so a
   * second result lands on this same instance (REQ-ACH-014).
   *
   * Everything it draws comes from `lib/chat/chatContext.svelte.ts`, not from its
   * window props: the window manager focuses an existing singleton WITHOUT
   * re-applying `componentProps`, so a target arriving through props would be the
   * target of whichever result opened the window first, forever.
   *
   * It reads no live-log state and writes none: the log behind it neither scrolls
   * nor changes while this is open (REQ-ACH-014).
   *
   * That "writes none" also has to hold for the rows it draws, not just for the
   * window's own state: it reuses ChatMessage.svelte for the target and every
   * neighbour, which — outside this window — carries the invalidate/revalidate
   * control (A024, REQ-ACH-080..086). `chatContext`'s `target`/`before`/`after`
   * are a one-shot snapshot from `loadChatContext` (chatContext.svelte.ts) and
   * never subscribe to the `doc:update` broadcast that control's write lands
   * as — that subscription is `chatStore`'s/`chatMessageSync.ts`'s. Without
   * `readOnly`, clicking the button would still reach the server and really
   * invalidate the message (REQ-ACH-090 makes the server the only gate), but
   * this window would never repaint to show it, success OR refusal — a write
   * with no visible outcome. So every row here is rendered `readOnly`: same
   * struck-through presentation for a message that already came back
   * invalidated (REQ-ACH-081), no button offering a write this window has no
   * way to reflect.
   */

  import { onDestroy } from "svelte";
  import type { Socket } from "socket.io-client";
  import {
    CHAT_CONTEXT_PAGE,
    canExpandChatContext,
    chatContext,
    closeChatContext,
    expandChatContext,
  } from "../../lib/chat/chatContext.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import ChatMessageComponent from "./ChatMessage.svelte";

  const {
    socket,
    worldId = "",
    isGm = false,
    userId = "",
  }: {
    /**
     * Only forwarded to the message renderer (cards); every row is drawn
     * `readOnly` (see header comment), so this window itself sends nothing.
     */
    socket: Socket;
    worldId?: string;
    isGm?: boolean;
    userId?: string;
  } = $props();

  const canMoreBefore = $derived(canExpandChatContext("before"));
  const canMoreAfter = $derived(canExpandChatContext("after"));

  function moreBefore(): void {
    void expandChatContext("before");
  }

  function moreAfter(): void {
    void expandChatContext("after");
  }

  // Closing the window is what ends this reading — the next result opens a fresh
  // window and a fresh state.
  onDestroy(() => {
    closeChatContext();
  });
</script>

<div class="chat-context">
  {#if canMoreBefore}
    <button class="chat-context__more" onclick={moreBefore} disabled={chatContext.loading}>
      <svg class="chat-context__arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M6 10V2.5M2.5 6 6 2.5 9.5 6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {t("FUSION.Chat.Context.MoreBefore", { count: CHAT_CONTEXT_PAGE })}
    </button>
  {/if}

  {#if chatContext.error}
    <p class="chat-context__error" role="alert">{chatContext.error}</p>
  {:else if chatContext.target === null}
    <p class="chat-context__empty">
      {chatContext.loading
        ? t("FUSION.Chat.Context.Loading")
        : t("FUSION.Chat.Context.Empty")}
    </p>
  {:else}
    <div class="chat-context__list">
      {#each chatContext.before as msg (msg._id)}
        <div class="chat-context__row" data-message-id={msg._id}>
          <ChatMessageComponent message={msg} {socket} {isGm} {userId} {worldId} readOnly />
        </div>
      {/each}

      <div
        class="chat-context__row chat-context__row--target"
        data-message-id={chatContext.target._id}
        aria-label={t("FUSION.Chat.Context.TargetLabel")}
      >
        <ChatMessageComponent message={chatContext.target} {socket} {isGm} {userId} {worldId} readOnly />
      </div>

      {#each chatContext.after as msg (msg._id)}
        <div class="chat-context__row" data-message-id={msg._id}>
          <ChatMessageComponent message={msg} {socket} {isGm} {userId} {worldId} readOnly />
        </div>
      {/each}
    </div>
  {/if}

  {#if canMoreAfter}
    <button class="chat-context__more" onclick={moreAfter} disabled={chatContext.loading}>
      <svg class="chat-context__arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M6 2v7.5M2.5 6 6 9.5 9.5 6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {t("FUSION.Chat.Context.MoreAfter", { count: CHAT_CONTEXT_PAGE })}
    </button>
  {/if}
</div>

<style>
  .chat-context {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    background: var(--fusion-surface);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
  }

  .chat-context__list {
    display: flex;
    flex-direction: column;
  }

  .chat-context__row {
    border-left: 2px solid transparent;
  }

  /* The message the result pointed at — the reason the window is open. */
  .chat-context__row--target {
    border-left-color: var(--fusion-accent);
    background: var(--fusion-surface-alt);
  }

  .chat-context__more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.3rem 0.5rem;
    border: none;
    border-bottom: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text-muted);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .chat-context__more:hover:not(:disabled) {
    color: var(--fusion-text);
  }

  .chat-context__more:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .chat-context__arrow {
    width: 0.75rem;
    height: 0.75rem;
  }

  .chat-context__empty,
  .chat-context__error {
    padding: 1.25rem 1rem;
    margin: 0;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--fusion-text-subtle);
  }

  .chat-context__error {
    color: var(--fusion-danger);
  }
</style>
