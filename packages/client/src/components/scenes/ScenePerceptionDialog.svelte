<script lang="ts">
  /**
   * ScenePerceptionDialog.svelte — the body of the PERCEPTION window (REQ-CEN-062).
   *
   * Spec: 07-visao-iluminacao-fog.md REQ-VIS-044/045, REQ-VIS-085.
   *
   * This is where the VALUES of the environment are tuned — the head of the Cenas tab
   * only toggles and resets (REQ-CEN-025, DEC-CEN-06). Reachable from the head and
   * from the configuration window, both of which open it as a real floating window
   * (`lib/scenes/sceneWindows.ts`, DEC-CEN-09); it no longer paints a backdrop and a
   * modal element of its own.
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
  import { t } from "../../lib/i18n/i18n.js";

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

  // Seeded once from the scene the window was opened with: a slider that jumped while
  // the GM dragged it would be worse than a stale one.
  // svelte-ignore state_referenced_locally
  let tokenVision = $state<boolean>(scene.tokenVision ?? false);
  // svelte-ignore state_referenced_locally
  let fogEnabled = $state<boolean>(scene.fogEnabled ?? false);
  // svelte-ignore state_referenced_locally
  let darkness = $state<number>(scene.darkness ?? 0);
  // svelte-ignore state_referenced_locally
  let globalLight = $state<boolean>(scene.globalLight ?? false);
  // svelte-ignore state_referenced_locally
  let globalLightThreshold = $state<number>(scene.globalLightThreshold ?? 0.5);

  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  const darknessPercent = $derived(Math.round(darkness * 100));
  const thresholdPercent = $derived(Math.round(globalLightThreshold * 100));

  // ---- Handlers ----

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
      serverError =
        err instanceof Error ? err.message : t("FUSION.Scene.Perception.UnexpectedError");
    } finally {
      submitting = false;
    }
  }
</script>

<form class="scene-perception" onsubmit={handleSubmit} novalidate>
  <!-- ====== Vision / Fog ====== -->
  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Scene.Perception.VisionSection")}</legend>

    <label class="checkbox-row">
      <input type="checkbox" bind:checked={tokenVision} disabled={submitting} />
      <span>{t("FUSION.Scene.Perception.TokenVision")}</span>
    </label>

    <label class="checkbox-row">
      <input type="checkbox" bind:checked={fogEnabled} disabled={submitting} />
      <span>{t("FUSION.Scene.Perception.Fog")}</span>
    </label>
  </fieldset>

  <!-- ====== Lighting ====== -->
  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Scene.Perception.LightingSection")}</legend>

    <div class="field">
      <label class="field__label" for="scene-darkness">
        {t("FUSION.Scene.Perception.Darkness", { percent: darknessPercent })}
        <span class="field__hint">{t("FUSION.Scene.Perception.DarknessHint")}</span>
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
      <span>{t("FUSION.Scene.Perception.GlobalLight")}</span>
    </label>

    {#if globalLight}
      <div class="field">
        <label class="field__label" for="scene-gi-threshold">
          {t("FUSION.Scene.Perception.Threshold", { percent: thresholdPercent })}
          <span class="field__hint">{t("FUSION.Scene.Perception.ThresholdHint")}</span>
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
      {t("FUSION.Scene.Dialog.Cancel")}
    </button>
    <button type="submit" class="btn btn--primary" disabled={submitting}>
      {submitting ? t("FUSION.Scene.Dialog.Saving") : t("FUSION.Scene.Dialog.Save")}
    </button>
  </footer>
</form>

<style>
  /* The window owns the frame (Window.svelte); this is only its content. */
  .scene-perception {
    color: var(--fusion-text);
    display: flex;
    flex-direction: column;
    font-family: var(--fusion-font);
    gap: 1.25rem;
    padding: 1rem 1.1rem;
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

  .field__input:focus-visible,
  .checkbox-row input:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
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
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
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
