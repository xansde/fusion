<script lang="ts">
  /**
   * ChatInput.svelte — chat input bar with command preview and roll mode selector.
   *
   * Features:
   * - Arrow ↑↓ for input history navigation.
   * - Inline formula validity indicator on /roll commands.
   * - Roll mode selector (persisted to localStorage).
   * - Enter to send, Shift+Enter for newline.
   *
   * REQ-CHT-013..015: command parsing on client for UX preview.
   * REQ-ROL-021..023: formula validation without RNG.
   */

  import { parseChatCommand, validateFormulaWithLimits } from "@fusion/shared";
  import { InputHistory } from "../../lib/chat/inputHistory.js";
  import { loadRollMode, saveRollMode } from "../../lib/chat/rollModePreference.js";
  import type { RollMode, ChatSendPayload } from "@fusion/shared";

  const {
    worldId,
    onSend,
    disabled = false,
  }: {
    worldId: string;
    onSend: (payload: ChatSendPayload) => Promise<void>;
    disabled?: boolean;
  } = $props();

  // ---- State ----

  let inputText = $state("");
  let sending = $state(false);
  let rollMode = $state<RollMode>(loadRollMode());
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

  function handleRollModeChange(e: Event): void {
    const val = (e.target as HTMLSelectElement).value as RollMode;
    rollMode = val;
    saveRollMode(val);
  }

  // ---- Send ----

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || sending || disabled) return;

    sending = true;
    try {
      const payload: ChatSendPayload = {
        content: text,
        worldId,
        rollMode,
      };
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
  <!-- Roll mode selector -->
  <select
    class="chat-input__mode-select"
    value={rollMode}
    onchange={handleRollModeChange}
    aria-label="Roll mode"
    title="Roll mode"
  >
    <option value="public">Public</option>
    <option value="gmroll">GM roll</option>
    <option value="blindroll">Blind</option>
    <option value="selfroll">Self</option>
  </select>

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

  .chat-input__mode-select {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font);
    font-size: 0.7rem;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    flex-shrink: 0;
    min-width: 4.5rem;
    align-self: center;
  }

  .chat-input__mode-select:focus {
    outline: none;
    border-color: var(--fusion-accent);
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
