<script lang="ts">
  /**
   * ChatInput.svelte — chat input bar with command preview and roll mode selector.
   *
   * Features:
   * - Arrow ↑↓ for input history navigation.
   * - Inline formula validity indicator on /roll commands.
   * - Roll mode selector (drawn icons, persisted per world + user — REQ-ACH-040/041).
   * - Enter to send, Shift+Enter for newline.
   *
   * REQ-CHT-013..015: command parsing on client for UX preview.
   * REQ-ROL-021..023: formula validation without RNG.
   * REQ-ACH-042..045 / REQ-CHT-017: who sees a roll is decided in ONE place —
   * `lib/chat/resolveRollMode.ts` — and this component only feeds it the typed line and
   * the selector's value. It never sets `rollMode` on the payload by hand.
   */

  import { validateFormulaWithLimits, parseChatCommand } from "@fusion/shared";
  import { InputHistory } from "../../lib/chat/inputHistory.js";
  import { initRollMode, rollModeState, setRollMode } from "../../lib/chat/rollModeState.svelte.js";
  import { buildChatSendPayload } from "../../lib/chat/resolveRollMode.js";
  import { session } from "../../lib/session.svelte.js";
  import RollModeSelector from "./RollModeSelector.svelte";
  import type { RollMode, ChatSendPayload } from "@fusion/shared";

  const {
    worldId,
    onSend,
    disabled = false,
    userId = session.user?.id ?? "",
  }: {
    worldId: string;
    onSend: (payload: ChatSendPayload) => Promise<void>;
    disabled?: boolean;
    /**
     * Owner of the roll mode preference on this device (REQ-ACH-041). Defaults to the
     * logged-in user so the panel does not have to thread it down.
     */
    userId?: string;
  } = $props();

  // ---- State ----

  let inputText = $state("");
  let sending = $state(false);
  // Restored per world + user: a shared browser never hands the GM's mode to a player,
  // and switching worlds does not carry it over (REQ-ACH-041). The value lives in a
  // session-scoped store because sheets, cards and the roll builder read it too
  // (REQ-ACH-042) and this panel unmounts on every drawer tab switch.
  $effect(() => {
    initRollMode(worldId, userId);
  });
  const history = new InputHistory();

  // ---- Formula validation preview ----

  const parseResult = $derived(() => {
    const trimmed = inputText.trim();
    if (!trimmed.startsWith("/")) return null;
    const parsed = parseChatCommand(trimmed);
    if (parsed.kind !== "roll") return null;
    if (!parsed.formula) return null;
    return validateFormulaWithLimits(parsed.formula);
  });

  const formulaValid = $derived(() => {
    const r = parseResult();
    if (r === null) return null; // not a roll command
    return r.valid;
  });

  const formulaError = $derived(() => {
    const r = parseResult();
    if (r === null || r.valid) return null;
    return r.error ?? "Invalid formula";
  });

  // ---- Roll mode ----

  function handleRollModeSelect(mode: RollMode): void {
    setRollMode(worldId, userId, mode);
  }

  // ---- Send ----

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || sending || disabled) return;

    sending = true;
    try {
      // Precedence lives in resolveRollMode: a command that names the mode beats the
      // selector and the payload stays silent so the server's own parse wins
      // (REQ-ACH-043); plain text is never touched by the selector (REQ-ACH-045).
      const payload = buildChatSendPayload({
        content: text,
        worldId,
        selectorMode: rollModeState.mode,
      });
      await onSend(payload);
      history.push(text);
      inputText = "";
    } finally {
      sending = false;
    }
  }

  // ---- Keyboard ----

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = history.navigateUp(inputText);
      if (prev !== null) inputText = prev;
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = history.navigateDown();
      if (next !== null) inputText = next;
      return;
    }

    // Any other key resets navigation if we were navigating
    if (history.cursor !== -1 && e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt") {
      history.resetNavigation();
    }
  }
</script>

<div class="chat-input">
  <!-- Roll mode selector — four drawn icons, never emoji (REQ-ACH-040) -->
  <RollModeSelector mode={rollModeState.mode} onSelect={handleRollModeSelect} {disabled} />

  <!-- Input area -->
  <div class="chat-input__field-wrap">
    <textarea
      class="chat-input__textarea
        {formulaValid() === false ? 'chat-input__textarea--invalid' : ''}
        {formulaValid() === true ? 'chat-input__textarea--valid' : ''}"
      placeholder="Chat or /roll 1d20+5…"
      rows={1}
      bind:value={inputText}
      onkeydown={handleKeydown}
      disabled={disabled || sending}
      aria-label="Chat message input"
      aria-invalid={formulaValid() === false ? "true" : undefined}
    ></textarea>
    <!-- Formula validation hint -->
    {#if formulaError()}
      <span class="chat-input__formula-hint chat-input__formula-hint--error" role="alert">
        {formulaError()}
      </span>
    {:else if formulaValid() === true}
      <span class="chat-input__formula-hint chat-input__formula-hint--ok" aria-live="polite">
        Valid formula
      </span>
    {/if}
  </div>

  <!-- Send button -->
  <button
    class="chat-input__send-btn"
    onclick={() => void handleSend()}
    disabled={disabled || sending || !inputText.trim()}
    aria-label="Send message"
  >
    {sending ? "…" : "Send"}
  </button>
</div>

<style>
  .chat-input {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-top: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    flex-shrink: 0;
  }

  .chat-input__field-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .chat-input__textarea {
    width: 100%;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    line-height: 1.5;
    padding: 0.35rem 0.55rem;
    resize: none;
    overflow: hidden;
    min-height: 2rem;
    max-height: 6rem;
    overflow-y: auto;
    transition: border-color var(--fusion-transition);
  }

  .chat-input__textarea:focus {
    outline: none;
    border-color: var(--fusion-accent);
  }

  .chat-input__textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-input__textarea--valid {
    border-color: var(--fusion-success);
  }

  .chat-input__textarea--invalid {
    border-color: var(--fusion-danger);
  }

  .chat-input__formula-hint {
    display: block;
    font-size: 0.7rem;
    margin-top: 0.2rem;
    padding-left: 0.15rem;
  }

  .chat-input__formula-hint--error {
    color: var(--fusion-danger);
  }

  .chat-input__formula-hint--ok {
    color: var(--fusion-success);
  }

  .chat-input__send-btn {
    background: var(--fusion-accent);
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: #fff;
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.35rem 0.8rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 0.05rem;
  }

  .chat-input__send-btn:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .chat-input__send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
