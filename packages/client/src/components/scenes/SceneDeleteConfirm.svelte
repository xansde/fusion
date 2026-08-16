<script lang="ts">
  /**
   * SceneDeleteConfirm.svelte — the body of the DELETE window (spec 44 §5.7).
   *
   * Two requirements shape it:
   *  - REQ-CEN-063: the confirmation NAMES what falls with the scene (its presences,
   *    walls, lights, sounds and drawings — all embedded in the scene document,
   *    DEC-PER-02) and what does not (the actors, which live on their own).
   *  - REQ-CEN-064: deleting the scene ON AIR is refused, with the reason and the way
   *    out. The refusal is read from the live pointer (`activeSceneState`, the single
   *    source of DEC-CEN-02), so a scene that goes on air while this window is open
   *    turns the confirmation into the refusal without a reopen.
   *
   * The refusal here is ergonomics; the boundary is the server, which refuses the same
   * `doc:delete` (DEC-CEN-11) — see `scene-delete-guard.test.ts`.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument } from "@fusion/shared";
  import { deleteScene, OpError } from "../../lib/scenes/sceneController.js";
  import { buildSceneDeleteVM } from "../../lib/scenes/sceneDelete.js";
  import { activeSceneState } from "../../lib/docs/activeScene.svelte.js";
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

  const vm = $derived(buildSceneDeleteVM({ scene, activeSceneId: activeSceneState.id }));

  let deleting = $state(false);
  let serverError = $state<string | null>(null);

  async function handleDelete(): Promise<void> {
    // REQ-CEN-064: the refused case never reaches the wire.
    if (vm.blocked || deleting) return;
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
</script>

<div class="scene-delete">
  {#if vm.blocked}
    <!-- REQ-CEN-064: the reason first, then the way out — never a greyed button with
         no explanation. -->
    <div class="scene-delete__blocked" role="alert">
      <p class="scene-delete__reason">{t(vm.reasonKey ?? "", { name: vm.name })}</p>
      <p class="scene-delete__path">{t(vm.pathKey ?? "")}</p>
    </div>
  {:else}
    <p class="scene-delete__question">
      {t(vm.questionKey)} <strong>{vm.name}</strong>?
    </p>

    <!-- REQ-CEN-063: what goes with it, named one by one. -->
    <p class="scene-delete__cascade-title">{t(vm.cascadeTitleKey)}</p>
    <ul class="scene-delete__cascade">
      {#each vm.cascadeKeys as key (key)}
        <li>{t(key)}</li>
      {/each}
    </ul>
    <!-- REQ-CEN-063: and what does not. -->
    <p class="scene-delete__kept">{t(vm.keptKey)}</p>
  {/if}

  {#if serverError}
    <div class="server-error" role="alert">{serverError}</div>
  {/if}

  <footer class="dialog__footer">
    <button class="btn btn--ghost" onclick={onClose} disabled={deleting}>
      {t("FUSION.Scene.Delete.Cancel")}
    </button>
    {#if !vm.blocked}
      <button class="btn btn--danger" onclick={handleDelete} disabled={deleting}>
        {deleting ? t("FUSION.Scene.Delete.Deleting") : t("FUSION.Scene.Delete.Delete")}
      </button>
    {/if}
  </footer>
</div>

<style>
  /* The window owns the frame (Window.svelte); this is only its content. */
  .scene-delete {
    color: var(--fusion-text);
    display: flex;
    flex-direction: column;
    font-family: var(--fusion-font);
    gap: 0.6rem;
    padding: 1rem 1.1rem;
  }

  .scene-delete__question {
    color: var(--fusion-text-muted);
    font-size: 0.875rem;
    line-height: 1.5;
    margin: 0;
  }

  .scene-delete__question strong {
    color: var(--fusion-text);
  }

  .scene-delete__cascade-title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    margin: 0.2rem 0 0;
  }

  .scene-delete__cascade {
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    font-size: 0.8125rem;
    gap: 0.15rem;
    line-height: 1.4;
    margin: 0;
    padding-left: 1.1rem;
  }

  .scene-delete__kept {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    line-height: 1.4;
    margin: 0.2rem 0 0;
  }

  /* REQ-CEN-064: the refusal is a message, not a disabled control with no words. */
  .scene-delete__blocked {
    background: rgba(255, 92, 92, 0.1);
    border: 1px solid var(--fusion-danger);
    border-radius: var(--fusion-radius-sm);
    padding: 0.7rem 0.8rem;
  }

  .scene-delete__reason {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    line-height: 1.45;
    margin: 0;
  }

  .scene-delete__path {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    line-height: 1.45;
    margin: 0.35rem 0 0;
  }

  .server-error {
    background: rgba(255, 92, 92, 0.12);
    border: 1px solid var(--fusion-danger);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-danger);
    font-size: 0.8125rem;
    padding: 0.6rem 0.75rem;
  }

  .dialog__footer {
    border-top: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.4rem;
    padding-top: 0.9rem;
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
    transition:
      background-color var(--fusion-transition),
      opacity var(--fusion-transition);
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
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
