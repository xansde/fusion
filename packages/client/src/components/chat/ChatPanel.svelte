<script lang="ts">
  /**
   * ChatPanel.svelte — full chat panel (log + input).
   *
   * Composed from ChatLog + ChatInput.
   * Handles the dice canvas container for @3d-dice/dice-box.
   * Wires incoming ChatMessage broadcasts from worldSync to the chatStore.
   *
   * REQ-CHT: tab integration; badge de não lidas na tab (exposed via unreadCount).
   * REQ-ROL-035..038: 3D dice animation on visible rolls.
   */

  import { onMount, onDestroy } from "svelte";
  import type { Socket } from "socket.io-client";
  import type { ChatSendPayload } from "@fusion/shared";
  import {
    chatStore,
    sendChatMessage,
    setRollAnimator,
  } from "../../lib/chat/chatStore.svelte.js";
  import { session } from "../../lib/session.svelte.js";
  import { animateRoll, setDiceBoxEnabled, isDiceBoxEnabled } from "../../lib/chat/diceBoxBridge.js";
  import ChatLog from "./ChatLog.svelte";
  import ChatInput from "./ChatInput.svelte";

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

  // 3D dice toggle (will be user setting in M1-E; default true)
  let diceEnabled = $state(isDiceBoxEnabled());
  let diceContainer: HTMLElement | null = $state(null);

  // ---- Roll animator registration ----
  //
  // BUG #1 FIX: message sync (history load + live "op" listener) is now
  // owned by TableScreen (session-scoped, via attachChatSync +
  // attachChatMessageSync) — NOT by this component, since ChatPanel unmounts
  // whenever the user leaves the chat tab. ChatPanel only registers the 3D
  // dice animator, which is correctly scoped to "chat tab visible" (the
  // #dice-canvas element below only exists while this component is mounted).

  onMount(() => {
    setRollAnimator((roll) => {
      if (diceEnabled) void animateRoll(roll);
    });
  });

  onDestroy(() => {
    setRollAnimator(null);
  });

  // ---- Send ----

  async function handleSend(payload: ChatSendPayload): Promise<void> {
    // BUG E FIX: pass the local user's identity so sendChatMessage can render
    // an instant optimistic echo (plain text only — see isOptimisticallyRenderable).
    const user = session.user;
    const speaker = user ? { userId: user.id, alias: user.name } : undefined;
    await sendChatMessage(socket, payload, speaker);
  }

  // ---- 3D dice toggle ----

  function toggleDice(): void {
    diceEnabled = !diceEnabled;
    setDiceBoxEnabled(diceEnabled);
  }
</script>

<div class="chat-panel">
  <!-- Controls bar -->
  <div class="chat-panel__controls">
    <button
      class="chat-panel__dice-toggle"
      class:chat-panel__dice-toggle--on={diceEnabled}
      onclick={toggleDice}
      title={diceEnabled ? "Disable 3D dice" : "Enable 3D dice"}
      aria-pressed={diceEnabled}
      aria-label="Toggle 3D dice"
    >
      🎲 3D
    </button>
  </div>

  <!-- Chat log -->
  <ChatLog {socket} {worldId} {visible} {isGm} {userId} />

  <!-- Dice canvas host (used by dice-box) -->
  <div
    id="dice-canvas"
    class="chat-panel__dice-canvas"
    class:chat-panel__dice-canvas--hidden={!diceEnabled}
    bind:this={diceContainer}
    aria-hidden="true"
  ></div>

  <!-- Chat input -->
  <ChatInput {worldId} onSend={handleSend} />
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--fusion-surface);
  }

  .chat-panel__controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .chat-panel__dice-toggle {
    background: none;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
  }

  .chat-panel__dice-toggle:hover {
    color: var(--fusion-text);
    border-color: var(--fusion-text-subtle);
  }

  .chat-panel__dice-toggle--on {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  /* Dice canvas — rendered by @3d-dice/dice-box, overlays the chat */
  .chat-panel__dice-canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 50;
  }

  .chat-panel__dice-canvas--hidden {
    display: none;
  }
</style>
