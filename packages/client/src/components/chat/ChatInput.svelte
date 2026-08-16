<script lang="ts">
  /**
   * ChatInput.svelte — the write box, and only the write box.
   *
   * Spec 38 §5.4: the box takes the whole width with the send button as its ONLY
   * neighbour on that line (REQ-ACH-030); it starts at one line and grows with the text to
   * five, scrolling after that (REQ-ACH-031); Enter sends and Shift+Enter breaks the line,
   * with that instruction living in the send button's tooltip and never inside the field
   * (REQ-ACH-032). The roll mode selector sits on its own line BELOW the box (REQ-ACH-040)
   * — it is not a control that divides the line with the field.
   *
   * The typed line goes to the server verbatim, commands included, with no local RNG
   * (REQ-ACH-033); sending empties the box and takes the log to its end (REQ-ACH-034).
   * Both of those are in `lib/chat/composeBox.ts`, where a test can reach them.
   *
   * Draft and ↑↓ history are session state, not component state (REQ-ACH-026): the drawer
   * drops this component on every tab switch (REQ-GAV-017), so anything kept here would be
   * lost by the gesture the spec says must preserve it.
   *
   * REQ-CHT-013..015: command parsing on client for UX preview.
   * REQ-ROL-021..023: formula validation without RNG.
   * REQ-ACH-042..045 / REQ-CHT-017: who sees a roll is decided in ONE place —
   * `lib/chat/resolveRollMode.ts` — and this component only feeds it the typed line and
   * the selector's value. It never sets `rollMode` on the payload by hand.
   */

  import { validateFormulaWithLimits, parseChatCommand } from "@fusion/shared";
  import { chatInputHistory, chatSession } from "../../lib/chat/chatStore.svelte.js";
  import {
    MAX_COMPOSE_ROWS,
    computeComposeRows,
    resolveComposeKey,
    rowsForContentHeight,
    submitChatLine,
  } from "../../lib/chat/composeBox.js";
  import { initRollMode, rollModeState, setRollMode } from "../../lib/chat/rollModeState.svelte.js";
  import { session } from "../../lib/session.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
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

  let sending = $state(false);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  /** Refined after mount to account for soft wrapping; the hard-break count seeds it. */
  let measuredRows = $state<number | null>(null);
  // Restored per world + user: a shared browser never hands the GM's mode to a player,
  // and switching worlds does not carry it over (REQ-ACH-041). The value lives in a
  // session-scoped store because sheets, cards and the roll builder read it too
  // (REQ-ACH-042) and this panel unmounts on every drawer tab switch.
  $effect(() => {
    initRollMode(worldId, userId);
  });
  const history = chatInputHistory;

  // REQ-ACH-031: one line, growing with the content to five, scrolling after that.
  const rows = $derived(measuredRows ?? computeComposeRows(chatSession.draft));

  /**
   * Measure the real wrapped height: collapse to one row, read `scrollHeight`, then claim
   * the rows it needs. Cheap enough per keystroke, and the only way to count SOFT breaks.
   */
  function remeasure(): void {
    const el = textareaEl;
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.rows = 1;
    const next = rowsForContentHeight(el.scrollHeight - padding, lineHeight);
    measuredRows = next;
    el.rows = next;
  }

  function handleInput(event: Event): void {
    chatSession.draft = (event.currentTarget as HTMLTextAreaElement).value;
    remeasure();
  }

  // ---- Formula validation preview ----

  const parseResult = $derived(() => {
    const trimmed = chatSession.draft.trim();
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
    if (sending || disabled) return;

    sending = true;
    try {
      // Precedence lives in resolveRollMode: a command that names the mode beats the
      // selector and the payload stays silent so the server's own parse wins
      // (REQ-ACH-043); plain text is never touched by the selector (REQ-ACH-045).
      // Clearing the box and taking the log to its end is submitChatLine's job
      // (REQ-ACH-034).
      await submitChatLine({
        text: chatSession.draft,
        worldId,
        selectorMode: rollModeState.mode,
        send: onSend,
        history,
      });
      measuredRows = null;
    } finally {
      sending = false;
    }
  }

  // ---- Keyboard (REQ-ACH-032) ----

  function handleKeydown(e: KeyboardEvent): void {
    const action = resolveComposeKey(e);

    if (action === "send") {
      e.preventDefault();
      void handleSend();
      return;
    }

    // "newline" is deliberately NOT prevented: Shift+Enter is the browser inserting the
    // break, which is exactly what REQ-ACH-032 asks for.
    if (action === "newline") return;

    if (action === "history-up") {
      e.preventDefault();
      const prev = history.navigateUp(chatSession.draft);
      if (prev !== null) {
        chatSession.draft = prev;
        measuredRows = null;
      }
      return;
    }

    if (action === "history-down") {
      e.preventDefault();
      const next = history.navigateDown();
      if (next !== null) {
        chatSession.draft = next;
        measuredRows = null;
      }
      return;
    }

    // Any other key resets navigation if we were navigating
    if (history.cursor !== -1 && e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt") {
      history.resetNavigation();
    }
  }
</script>

<div class="chat-input">
  <!--
    REQ-ACH-030: the box and the send button, and nothing else, share this line.
  -->
  <div class="chat-input__line">
    <div class="chat-input__field-wrap">
      <textarea
        class="chat-input__textarea
        {formulaValid() === false ? 'chat-input__textarea--invalid' : ''}
        {formulaValid() === true ? 'chat-input__textarea--valid' : ''}"
        placeholder={t("FUSION.Chat.Compose.Placeholder")}
        {rows}
        style:max-height="calc({MAX_COMPOSE_ROWS} * 1.5em + 0.7rem)"
        bind:this={textareaEl}
        value={chatSession.draft}
        oninput={handleInput}
        onkeydown={handleKeydown}
        disabled={disabled || sending}
        aria-label={t("FUSION.Chat.Compose.Label")}
        aria-invalid={formulaValid() === false ? "true" : undefined}
      ></textarea>
      <!-- Formula validation hint -->
      {#if formulaError()}
        <span class="chat-input__formula-hint chat-input__formula-hint--error" role="alert">
          {formulaError()}
        </span>
      {:else if formulaValid() === true}
        <span class="chat-input__formula-hint chat-input__formula-hint--ok" aria-live="polite">
          {t("FUSION.Chat.Compose.FormulaOk")}
        </span>
      {/if}
    </div>

    <!--
      REQ-ACH-032: the Enter / Shift+Enter instruction lives HERE, in the button's tooltip
      and accessible name — never as placeholder text inside the field.
    -->
    <button
      class="chat-input__send-btn"
      type="button"
      onclick={() => void handleSend()}
      disabled={disabled || sending || !chatSession.draft.trim()}
      title={t("FUSION.Chat.Compose.SendHint")}
      aria-label={t("FUSION.Chat.Compose.SendHint")}
    >
      {sending ? "…" : t("FUSION.Chat.Compose.Send")}
    </button>
  </div>

  <!-- Roll mode selector — its own line below the box, four drawn icons (REQ-ACH-040) -->
  <RollModeSelector mode={rollModeState.mode} onSelect={handleRollModeSelect} {disabled} />
</div>

<style>
  .chat-input {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.6rem;
    border-top: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    flex-shrink: 0;
  }

  .chat-input__line {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
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
    /* Grows to MAX_COMPOSE_ROWS via the `rows` attribute; only then does it scroll
       (REQ-ACH-031). The ceiling is set inline from the same constant. */
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
