<script lang="ts">
  /**
   * SceneCreateDialog.svelte — modal dialog for creating or editing a Scene.
   *
   * Props:
   *   mode   "create" | "edit"
   *   scene  SceneDocument — populated in edit mode, ignored in create mode.
   *   onClose() — called when the dialog is dismissed (cancel or success).
   *   onSubmit(data) — called after successful op; parent re-fetches the list.
   *   socket  Socket instance for sendOp.
   *
   * Logic lives in sceneController.ts — this component is intentionally thin.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument } from "@fusion/shared";
  import {
    validateSceneForm,
    isFormValid,
    defaultSceneFormData,
    createScene,
    updateSceneConfig,
    OpError,
    type SceneFormData,
    type SceneFormErrors,
  } from "../../lib/scenes/sceneController.js";
  import { fusionApi } from "../../lib/api.js";
  import FilePicker from "../assets/FilePicker.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  // ---- Props ----

  const {
    mode = "create",
    scene = null,
    onClose,
    onSuccess,
    socket,
  }: {
    mode?: "create" | "edit";
    scene?: SceneDocument | null;
    onClose: () => void;
    onSuccess: () => void;
    socket: Socket;
  } = $props();

  // ---- FilePicker state ----
  let showFilePicker = $state(false);

  // ---- Local state ----

  // BUG B FIX: scene.grid could be undefined on a document that predates the
  // grid default (or arrived via a partial diff) — reading scene.grid.size
  // unguarded threw "Cannot read properties of undefined (reading 'size')"
  // and silently aborted the whole dialog (crash during $state init, before
  // <dialog> ever rendered). Fall back to defaultSceneFormData().gridSize,
  // the same canonical default (100) the schema itself defaults to.
  const initialData: SceneFormData =
    mode === "edit" && scene
      ? {
          name: scene.name,
          width: scene.width,
          height: scene.height,
          gridSize: scene.grid?.size ?? defaultSceneFormData().gridSize,
          background: scene.background ?? "",
        }
      : defaultSceneFormData();

  let formData = $state<SceneFormData>({ ...initialData });
  let errors = $state<SceneFormErrors>({});
  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  // ---- Handlers ----

  function handleInput(): void {
    // Live-validate on input to clear resolved errors
    errors = validateSceneForm(formData);
    serverError = null;
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    errors = validateSceneForm(formData);
    if (!isFormValid(errors)) return;

    submitting = true;
    serverError = null;

    try {
      if (mode === "create") {
        await createScene(socket, formData);
      } else if (scene) {
        await updateSceneConfig(socket, scene._id, formData);
      }
      onSuccess();
    } catch (err) {
      if (err instanceof OpError) {
        serverError = err.message;
      } else {
        serverError = t("FUSION.Scene.Dialog.UnexpectedError");
      }
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- Backdrop -->
<div
  class="dialog-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<!-- Dialog -->
<dialog
  class="scene-dialog"
  open
  aria-label={mode === "create" ? t("FUSION.Scene.Dialog.Create.Title") : t("FUSION.Scene.Dialog.Edit.Title")}
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">{mode === "create" ? t("FUSION.Scene.Dialog.Create.Title") : t("FUSION.Scene.Dialog.Edit.Title")}</h2>
    <button class="dialog__close btn btn--icon" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>
      &#x2715;
    </button>
  </header>

  <form class="dialog__body" onsubmit={handleSubmit} novalidate>
    <!-- Name -->
    <div class="field" class:field--error={!!errors.name}>
      <label class="field__label" for="scene-name">{t("FUSION.Scene.Dialog.Name")}</label>
      <input
        id="scene-name"
        class="field__input"
        type="text"
        bind:value={formData.name}
        oninput={handleInput}
        placeholder={t("FUSION.Scene.Dialog.NamePlaceholder")}
        maxlength="128"
        autocomplete="off"
        disabled={submitting}
        required
      />
      {#if errors.name}
        <span class="field__error" role="alert">{errors.name}</span>
      {/if}
    </div>

    <!-- Dimensions row -->
    <div class="field-row">
      <div class="field" class:field--error={!!errors.width}>
        <label class="field__label" for="scene-width">{t("FUSION.Scene.Dialog.Width")}</label>
        <input
          id="scene-width"
          class="field__input"
          type="number"
          bind:value={formData.width}
          oninput={handleInput}
          min="100"
          max="20000"
          step="1"
          disabled={submitting}
        />
        {#if errors.width}
          <span class="field__error" role="alert">{errors.width}</span>
        {/if}
      </div>

      <div class="field" class:field--error={!!errors.height}>
        <label class="field__label" for="scene-height">{t("FUSION.Scene.Dialog.Height")}</label>
        <input
          id="scene-height"
          class="field__input"
          type="number"
          bind:value={formData.height}
          oninput={handleInput}
          min="100"
          max="20000"
          step="1"
          disabled={submitting}
        />
        {#if errors.height}
          <span class="field__error" role="alert">{errors.height}</span>
        {/if}
      </div>
    </div>

    <!-- Grid size -->
    <div class="field" class:field--error={!!errors.gridSize}>
      <label class="field__label" for="scene-grid">{t("FUSION.Scene.Dialog.GridSize")}</label>
      <input
        id="scene-grid"
        class="field__input"
        type="number"
        bind:value={formData.gridSize}
        oninput={handleInput}
        min="50"
        max="500"
        step="1"
        disabled={submitting}
      />
      {#if errors.gridSize}
        <span class="field__error" role="alert">{errors.gridSize}</span>
      {/if}
    </div>

    <!-- Background -->
    <div class="field" class:field--error={!!errors.background}>
      <label class="field__label" for="scene-bg">
        {t("FUSION.Scene.Dialog.Background")} <span class="field__optional">{t("FUSION.Scene.Dialog.BackgroundOptional")}</span>
      </label>
      <div class="field__asset-row">
        <input
          id="scene-bg"
          class="field__input field__input--grow"
          type="text"
          bind:value={formData.background}
          oninput={handleInput}
          placeholder={t("FUSION.Scene.Dialog.BackgroundPlaceholder")}
          disabled={submitting}
        />
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          onclick={() => { showFilePicker = true; }}
          disabled={submitting}
          aria-label={t("FUSION.Scene.Dialog.BrowseAssets")}
          title={t("FUSION.Scene.Dialog.BrowseAssets")}
        >
          &#128247;
        </button>
      </div>
      {#if errors.background}
        <span class="field__error" role="alert">{errors.background}</span>
      {/if}
    </div>

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}

    <footer class="dialog__footer">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={submitting}>
        {t("FUSION.Scene.Dialog.Cancel")}
      </button>
      <button
        type="submit"
        class="btn btn--primary"
        disabled={submitting || !isFormValid(validateSceneForm(formData))}
      >
        {submitting ? t("FUSION.Scene.Dialog.Saving") : mode === "create" ? t("FUSION.Scene.Dialog.Create") : t("FUSION.Scene.Dialog.Save")}
      </button>
    </footer>
  </form>
</dialog>

<!-- FilePicker modal — rendered outside the dialog so z-index layers correctly -->
{#if showFilePicker}
  {@const tok = fusionApi.getToken() ?? ""}
  <FilePicker
    token={tok}
    onSelect={(path) => {
      formData.background = path;
      errors = validateSceneForm(formData);
      showFilePicker = false;
    }}
    onClose={() => { showFilePicker = false; }}
  />
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
  }

  .scene-dialog {
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
    width: min(440px, 92vw);
    max-height: 90dvh;
    overflow-y: auto;
  }

  /* Reset browser dialog defaults */
  .scene-dialog::backdrop {
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
    transition: color var(--fusion-transition);
  }

  .dialog__close:hover {
    color: var(--fusion-text);
  }

  .dialog__body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem;
  }

  /* Field layout */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field-row {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1fr 1fr;
  }

  .field__label {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .field__optional {
    color: var(--fusion-text-subtle);
    font-weight: 400;
  }

  .field__asset-row {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
  }

  .field__input--grow {
    flex: 1;
    min-width: 0;
  }

  .field__input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    padding: 0.45rem 0.6rem;
    transition: border-color var(--fusion-transition);
    width: 100%;
  }

  .field__input:focus {
    border-color: var(--fusion-accent);
    outline: none;
  }

  .field__input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .field--error .field__input {
    border-color: var(--fusion-danger);
  }

  .field__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
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

  /* Buttons (inline — avoids deep import of global .btn) */
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

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
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

  .btn--icon {
    padding: 0.25rem 0.4rem;
  }
</style>
