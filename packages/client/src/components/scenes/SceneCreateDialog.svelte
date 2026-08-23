<script lang="ts">
  /**
   * SceneCreateDialog.svelte — the body of the CREATE and the CONFIGURE windows
   * (spec 44 §5.7, REQ-CEN-060 and REQ-CEN-061).
   *
   * It used to paint its own backdrop and its own modal element, which made it a second
   * window system living beside `lib/windows/window-manager.ts`. It is now mounted as
   * the content of a real window (`lib/scenes/sceneWindows.ts`), so the frame — title
   * bar, close, drag, resize, z-order — belongs to `Window.svelte` and this file is a
   * form and nothing else (DEC-CEN-09).
   *
   * Props:
   *   mode   "create" | "edit"
   *   scene  SceneDocument — populated in edit mode, ignored in create mode.
   *   onClose() — closes the window (the opener passes the manager's closer).
   *   onSuccess() — same, after a successful write.
   *   socket  Socket instance for sendOp.
   *
   * The rules live in sceneController.ts — this component is intentionally thin.
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
  import { sceneListState } from "../../lib/scenes/scenesState.svelte.js";
  import { nextSortInFolder, SCENE_SHELF_KEYS } from "../../lib/scenes/sceneShelf.js";
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
  // the form ever rendered). Fall back to defaultSceneFormData().gridSize,
  // the same canonical default (100) the schema itself defaults to.
  // The form is seeded ONCE from the document the window was opened with — a form the
  // server could rewrite under the GM's fingers is worse than a stale one.
  // svelte-ignore state_referenced_locally
  const initialData: SceneFormData =
    mode === "edit" && scene
      ? {
          name: scene.name,
          folder: scene.folder ?? null,
          width: scene.width,
          height: scene.height,
          gridSize: scene.grid?.size ?? defaultSceneFormData().gridSize,
          backgroundColor: scene.backgroundColor || defaultSceneFormData().backgroundColor,
          background: scene.background ?? "",
        }
      : defaultSceneFormData();

  let formData = $state<SceneFormData>({ ...initialData });
  let errors = $state<SceneFormErrors>({});
  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  /**
   * REQ-CEN-061: filing a scene is configuration, so the folder is a field here and
   * not a drag in the drawer. The options are the world's folders as the mirror knows
   * them — the tab does not manage folders (DEC-CEN-05).
   */
  const folderOptions = $derived(
    [...sceneListState.folders].sort((a, b) => a.name.localeCompare(b.name)),
  );

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
        // REQ-CEN-031: a new scene lands at the end of the folder it was filed in.
        // REQ-CEN-065: and nowhere near the air — `createScene` writes `active: false`
        // and this path emits nothing else.
        await createScene(
          socket,
          formData,
          nextSortInFolder(sceneListState.scenes, formData.folder),
        );
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

</script>

<form class="scene-form" onsubmit={handleSubmit} novalidate>
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

  <!-- Folder (REQ-CEN-061) -->
  <div class="field">
    <label class="field__label" for="scene-folder">{t("FUSION.Scene.Dialog.Folder")}</label>
    <select
      id="scene-folder"
      class="field__input"
      bind:value={formData.folder}
      onchange={handleInput}
      disabled={submitting}
    >
      <option value={null}>{t(SCENE_SHELF_KEYS.noFolder)}</option>
      {#each folderOptions as folder (folder._id)}
        <option value={folder._id}>{folder.name}</option>
      {/each}
    </select>
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

  <!-- Fill colour — "preenchimento" (REQ-CEN-061) -->
  <div class="field" class:field--error={!!errors.backgroundColor}>
    <label class="field__label" for="scene-fill">
      {t("FUSION.Scene.Dialog.Fill")}
      <span class="field__optional">{t("FUSION.Scene.Dialog.FillHint")}</span>
    </label>
    <div class="field__asset-row">
      <input
        id="scene-fill"
        class="field__swatch"
        type="color"
        bind:value={formData.backgroundColor}
        oninput={handleInput}
        disabled={submitting}
      />
      <input
        class="field__input field__input--grow"
        type="text"
        bind:value={formData.backgroundColor}
        oninput={handleInput}
        aria-label={t("FUSION.Scene.Dialog.Fill")}
        maxlength="7"
        autocomplete="off"
        disabled={submitting}
      />
    </div>
    {#if errors.backgroundColor}
      <span class="field__error" role="alert">{errors.backgroundColor}</span>
    {/if}
  </div>

  <!-- Background -->
  <div class="field" class:field--error={!!errors.background}>
    <label class="field__label" for="scene-bg">
      {t("FUSION.Scene.Dialog.Background")}
      <span class="field__optional">{t("FUSION.Scene.Dialog.BackgroundOptional")}</span>
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
        onclick={() => {
          showFilePicker = true;
        }}
        disabled={submitting}
        aria-label={t("FUSION.Scene.Dialog.BrowseAssets")}
        title={t("FUSION.Scene.Dialog.BrowseAssets")}
      >
        <!-- Drawn glyph (REQ-NPC-094): a picture frame, never an emoji. -->
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
          <path d="m3.5 11 3-3.2 2.3 2.4 1.8-1.7 1.9 2" />
          <circle cx="6" cy="6.2" r="0.9" />
        </svg>
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
      {submitting
        ? t("FUSION.Scene.Dialog.Saving")
        : mode === "create"
          ? t("FUSION.Scene.Dialog.Create")
          : t("FUSION.Scene.Dialog.Save")}
    </button>
  </footer>
</form>

<!-- FilePicker modal — rendered outside the form so z-index layers correctly -->
{#if showFilePicker}
  {@const tok = fusionApi.getToken() ?? ""}
  <FilePicker
    token={tok}
    onSelect={(path) => {
      formData.background = path;
      errors = validateSceneForm(formData);
      showFilePicker = false;
    }}
    onClose={() => {
      showFilePicker = false;
    }}
  />
{/if}

<style>
  /* The window owns the frame (Window.svelte) — this is only the form inside it. */
  .scene-form {
    color: var(--fusion-text);
    display: flex;
    flex-direction: column;
    font-family: var(--fusion-font);
    gap: 1rem;
    padding: 1rem 1.1rem;
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

  .field__swatch {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    flex-shrink: 0;
    height: 2rem;
    padding: 0.15rem;
    width: 2.5rem;
  }

  .field__input:focus,
  .field__swatch:focus {
    border-color: var(--fusion-accent);
    outline: none;
  }

  .field__input:focus-visible,
  .field__swatch:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
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
    padding-top: 0.9rem;
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
    transition:
      background-color var(--fusion-transition),
      opacity var(--fusion-transition);
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

  .btn--sm {
    padding: 0.3rem 0.6rem;
  }
</style>
