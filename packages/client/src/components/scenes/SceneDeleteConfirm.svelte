<script lang="ts">
  /**
   * SceneDeleteConfirm.svelte — confirmation dialog before deleting a Scene.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument } from "@fusion/shared";
  import { deleteScene, OpError } from "../../lib/scenes/sceneController.js";
  import { t } from "../../lib/i18n/i18n.js";

  const {
    scene,
    onClose,
    onSuccess,
    socket,
  }: {
    scene: SceneDocument;
    onClose: () => void;
    onSuccess: () => void;
    socket: Socket;
  } = $props();

  let deleting = $state(false);
  let serverError = $state<string | null>(null);

  async function handleDelete(): Promise<void> {
    deleting = true;
    serverError = null;
    try {
      await deleteScene(socket, scene._id);
      onSuccess();
    } catch (err) {
      if (err instanceof OpError) {
        serverError = err.message;
      } else {
        serverError = t("FUSION.Scene.Delete.UnexpectedError");
      }
    } finally {
      deleting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }
</script>

<!-- Backdrop -->
<div
  class="dialog-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<dialog
  class="confirm-dialog"
  open
  aria-label={t("FUSION.Scene.Delete.Title")}
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">{t("FUSION.Scene.Delete.Title")}</h2>
  </header>

  <div class="dialog__body">
    <p class="dialog__message">
      {t("FUSION.Scene.Delete.Confirm")} <strong>{scene.name}</strong>?
      {t("FUSION.Scene.Delete.Cannot")}
    </p>

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}
  </div>

  <footer class="dialog__footer">
    <button class="btn btn--ghost" onclick={onClose} disabled={deleting}>
      {t("FUSION.Scene.Delete.Cancel")}
    </button>
    <button class="btn btn--danger" onclick={handleDelete} disabled={deleting}>
      {deleting ? t("FUSION.Scene.Delete.Deleting") : t("FUSION.Scene.Delete.Delete")}
    </button>
  </footer>
</dialog>

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
  }

  .confirm-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 201;

    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    padding: 0;
    width: min(380px, 90vw);
  }

  .confirm-dialog::backdrop {
    background: transparent;
  }

  .dialog__header {
    border-bottom: 1px solid var(--fusion-border);
    padding: 1rem 1.25rem;
  }

  .dialog__title {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .dialog__body {
    padding: 1.25rem;
  }

  .dialog__message {
    color: var(--fusion-text-muted);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .dialog__message strong {
    color: var(--fusion-text);
  }

  .server-error {
    background: rgba(255, 92, 92, 0.12);
    border: 1px solid var(--fusion-danger);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-danger);
    font-size: 0.8125rem;
    margin-top: 0.75rem;
    padding: 0.6rem 0.75rem;
  }

  .dialog__footer {
    border-top: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    padding: 1rem 1.25rem;
  }

  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    font-weight: 500;
    justify-content: center;
    padding: 0.45rem 1rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--ghost:hover:not(:disabled) {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .btn--danger {
    background: var(--fusion-danger);
    color: #fff;
  }

  .btn--danger:hover:not(:disabled) {
    background: #e04040;
  }
</style>
