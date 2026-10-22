<script lang="ts">
  /**
   * PromptDialog.svelte — Native modal prompt dialog (text input).
   *
   * Svelte 5 Runes component.
   * Implements REQ-UIF-028..030 from spec 11-ui-framework-e-fichas.md.
   *
   * Uses <dialog>.showModal() — free focus trap, Escape, backdrop (DEC-UIF-02).
   */

  import type { PendingPrompt } from "$lib/windows/dialogs.svelte.js";
  import { onMount } from "svelte";

  interface Props {
    pending: PendingPrompt;
    onSettled: () => void;
  }

  let { pending, onSettled }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let inputValue = $state(pending.defaultValue);
  let previouslyFocused = $state<HTMLElement | null>(null);

  onMount(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    dialogEl?.showModal();
    // Focus the input (autofocus attribute handles it, but we ensure it)
    requestAnimationFrame(() => inputEl?.focus());
    return () => {
      previouslyFocused?.focus();
    };
  });

  function settle(value: string | null) {
    pending.resolve(value);
    onSettled();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      settle(null);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      settle(inputValue);
    }
  }

  function onDialogCancel(e: Event) {
    e.preventDefault();
    settle(null);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="fusion-dialog"
  aria-modal="true"
  oncancel={onDialogCancel}
  onkeydown={onKeydown}
>
  <div class="fusion-dialog__body">
    <p class="fusion-dialog__message">{pending.message}</p>

    <input
      bind:this={inputEl}
      class="fusion-dialog__input"
      type="text"
      bind:value={inputValue}
      aria-label={pending.message}
    />

    <div class="fusion-dialog__actions">
      <button
        class="fusion-dialog__btn fusion-dialog__btn--cancel"
        onclick={() => settle(null)}
      >
        {pending.cancelLabel}
      </button>
      <button
        class="fusion-dialog__btn fusion-dialog__btn--confirm"
        onclick={() => settle(inputValue)}
      >
        {pending.confirmLabel}
      </button>
    </div>
  </div>
</dialog>

<style>
  .fusion-dialog {
    background: var(--fusion-surface);
    color: var(--fusion-text);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 0;
    min-width: 340px;
    max-width: 500px;
    box-shadow: var(--fusion-shadow-modal);
  }

  .fusion-dialog::backdrop {
    background: var(--fusion-surface-alt);
  }

  .fusion-dialog__body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .fusion-dialog__message {
    margin: 0;
    font-size: var(--fusion-text-base);
    line-height: 1.6;
  }

  .fusion-dialog__input {
    width: 100%;
    padding: 8px 12px;
    background: var(--fusion-input-bg);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-size: var(--fusion-text-base);
    box-sizing: border-box;
  }

  .fusion-dialog__input:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 2px;
  }

  .fusion-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .fusion-dialog__btn {
    padding: 8px 16px;
    border-radius: var(--fusion-radius-sm);
    font-size: var(--fusion-text-sm);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--fusion-border);
    transition: background 0.15s;
    min-width: 80px;
    min-height: 36px;
  }

  .fusion-dialog__btn:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 2px;
  }

  .fusion-dialog__btn--cancel {
    background: transparent;
    color: var(--fusion-text-muted);
  }

  .fusion-dialog__btn--cancel:hover {
    background: var(--fusion-accent-dim);
  }

  .fusion-dialog__btn--confirm {
    background: var(--fusion-accent);
    color: var(--fusion-text);
    border-color: transparent;
  }

  .fusion-dialog__btn--confirm:hover {
    background: var(--fusion-accent-hover);
  }
</style>
