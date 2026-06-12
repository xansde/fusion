<script lang="ts">
  /**
   * ScenePerceptionDialog.svelte — GM dialog for scene vision/fog/lighting settings.
   *
   * Spec: 07-visao-iluminacao-fog.md REQ-VIS-044/045, REQ-VIS-085
   *
   * Fields:
   *   - tokenVision (bool)
   *   - fogEnabled (bool)
   *   - darkness (0–1 slider)
   *   - globalLight (bool)
   *   - globalLightThreshold (0–1 slider, shown when globalLight=true)
   *
   * Sends doc:update op updating these fields on the SceneDocument.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument } from "@fusion/shared";
  import { sendOp } from "../../lib/docs/sendOp.js";

  // ---- Props ----

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

  // ---- State ----

  let tokenVision = $state<boolean>((scene as any).tokenVision ?? false);
  let fogEnabled = $state<boolean>((scene as any).fogEnabled ?? false);
  let darkness = $state<number>((scene as any).darkness ?? 0);
  let globalLight = $state<boolean>((scene as any).globalLight ?? false);
  let globalLightThreshold = $state<number>((scene as any).globalLightThreshold ?? 0.5);

  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  // ---- Handlers ----

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    submitting = true;
    serverError = null;

    try {
      await sendOp(socket, {
        type: "doc:update",
        payload: {
          documentType: "Scene",
          updates: [
            {
              _id: scene._id,
              diff: {
                tokenVision,
                fogEnabled,
                darkness,
                globalLight,
                globalLightThreshold,
              },
            },
          ],
        },
      });
      onSuccess();
    } catch (err) {
      serverError = err instanceof Error ? err.message : "An error occurred.";
    } finally {
      submitting = false;
    }
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="dialog-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<!-- Dialog -->
<dialog
  class="config-dialog"
  open
  aria-label="Scene perception settings"
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">Scene Perception — {scene.name}</h2>
    <button class="dialog__close" onclick={onClose} aria-label="Close">&#x2715;</button>
  </header>

  <form class="dialog__body" onsubmit={handleSubmit} novalidate>

    <!-- ====== Vision / Fog ====== -->
    <fieldset class="section">
      <legend class="section__title">Vision &amp; Fog</legend>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={tokenVision} disabled={submitting} />
        <span>Token vision enabled (players limited to what their tokens see)</span>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={fogEnabled} disabled={submitting} />
        <span>Fog of war enabled</span>
      </label>
    </fieldset>

    <!-- ====== Lighting ====== -->
    <fieldset class="section">
      <legend class="section__title">Lighting</legend>

      <div class="field">
        <label class="field__label" for="scene-darkness">
          Darkness level — {(darkness * 100).toFixed(0)}%
          <span class="field__hint">(0 = bright day; 1 = pitch black)</span>
        </label>
        <input
          id="scene-darkness"
          class="field__input"
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={darkness}
          disabled={submitting}
        />
      </div>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={globalLight} disabled={submitting} />
        <span>Global illumination (entire explored area is lit)</span>
      </label>

      {#if globalLight}
        <div class="field">
          <label class="field__label" for="scene-gi-threshold">
            GI darkness threshold — {(globalLightThreshold * 100).toFixed(0)}%
            <span class="field__hint">(GI is suppressed above this level)</span>
          </label>
          <input
            id="scene-gi-threshold"
            class="field__input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={globalLightThreshold}
            disabled={submitting}
          />
        </div>
      {/if}
    </fieldset>

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}

    <footer class="dialog__footer">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={submitting}>
        Cancel
      </button>
      <button type="submit" class="btn btn--primary" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </button>
    </footer>
  </form>
</dialog>

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
  }

  .config-dialog {
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
    width: min(480px, 94vw);
    max-height: 90dvh;
    overflow-y: auto;
  }

  .config-dialog::backdrop {
    background: transparent;
  }

  .dialog__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 1rem 1.25rem;
  }

  .dialog__title {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .dialog__close {
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.25rem;
    line-height: 1;
  }

  .dialog__body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.25rem;
  }

  .section {
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0.875rem 1rem;
  }

  .section__title {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .checkbox-row {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field__label {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .field__hint {
    color: var(--fusion-text-subtle);
    font-weight: 400;
    font-size: 0.75rem;
  }

  .field__input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    padding: 0.45rem 0.6rem;
    width: 100%;
  }

  .field__input[type="range"] {
    cursor: pointer;
    padding: 0.25rem 0;
    accent-color: var(--fusion-accent);
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
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }
</style>
