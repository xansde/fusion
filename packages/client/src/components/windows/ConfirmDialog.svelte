<script lang="ts">
  /**
   * ConfirmDialog.svelte — Native modal confirm dialog.
   *
   * Svelte 5 Runes component.
   * Implements REQ-UIF-027 and REQ-UIF-030.
   *
   * Uses <dialog>.showModal() for free focus trap, Escape-to-close, and
   * backdrop (DEC-UIF-02 / DEC-UIF-02).
   *
   * Props:
   *  - pending: PendingConfirm — the dialog spec + resolve callback
   *  - onSettled: () => void — called after resolve so host can remove it
   */

  import type { PendingConfirm } from "$lib/windows/dialogs.svelte.js";
  import { onMount } from "svelte";

  interface Props {
    pending: PendingConfirm;
    onSettled: () => void;
  }

  let { pending, onSettled }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  /** Track which element had focus before the dialog opened (REQ-UIF-030). */
  let previouslyFocused = $state<HTMLElement | null>(null);

  onMount(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    dialogEl?.showModal();
    return () => {
      // Restore focus when component is destroyed (REQ-UIF-030)
      previouslyFocused?.focus();
    };
  });

  function settle(value: boolean) {
    pending.resolve(value);
    onSettled();
  }

  function onKeydown(e: KeyboardEvent) {
    // Escape is handled by the browser's native <dialog> close event,
    // but we intercept here to also resolve to false.
    if (e.key === "Escape") {
      e.preventDefault(); // prevent default close (we handle it)
      settle(false);
    }
  }

  function onDialogCancel(e: Event) {
    e.preventDefault();
    settle(false);
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

    <div class="fusion-dialog__actions">
      <button
        class="fusion-dialog__btn fusion-dialog__btn--cancel"
        onclick={() => settle(false)}
      >
        {pending.cancelLabel}
      </button>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <button
        class="fusion-dialog__btn fusion-dialog__btn--confirm"
        autofocus
        onclick={() => settle(true)}
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
    min-width: 320px;
    max-width: 480px;
    box-shadow: var(--fusion-shadow-modal);
  }

  .fusion-dialog::backdrop {
    background: var(--fusion-surface-alt);
  }

  .fusion-dialog__body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .fusion-dialog__message {
    margin: 0;
    font-size: var(--fusion-text-base);
    line-height: 1.6;
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
