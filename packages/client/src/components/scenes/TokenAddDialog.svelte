<script lang="ts">
  /**
   * TokenAddDialog.svelte — modal for adding a token to the active scene.
   *
   * Props:
   *   sceneId   string        — ID of the target scene.
   *   onClose   () => void    — called when the dialog is dismissed.
   *   onSuccess () => void    — called after the token is created.
   *   socket    Socket        — for sendOp.
   *
   * The texture field uses FilePicker (world assets) OR an external URL.
   * Logic (form validation, sendOp) lives in tokenController.ts (pure TS).
   */

  import type { Socket } from "socket.io-client";
  import { sendOp } from "../../lib/docs/sendOp.js";
  import { createDocumentId } from "@fusion/shared";
  import { fusionApi } from "../../lib/api.js";
  import { session } from "../../lib/session.svelte.js";
  import { resolveBrowseAssetUrl } from "../../lib/assets/assetApi.js";
  import FilePicker from "../assets/FilePicker.svelte";

  // ---- Props ----

  const {
    sceneId,
    onClose,
    onSuccess,
    socket,
  }: {
    sceneId: string;
    onClose: () => void;
    onSuccess: () => void;
    socket: Socket;
  } = $props();

  // ---- Form state ----

  interface TokenFormData {
    name: string;
    texture: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let formData = $state<TokenFormData>({
    name: "New Token",
    texture: "",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });

  interface TokenFormErrors {
    name?: string;
    texture?: string;
    x?: string;
    y?: string;
    width?: string;
    height?: string;
  }

  let errors = $state<TokenFormErrors>({});
  let submitting = $state(false);
  let serverError = $state<string | null>(null);
  let showFilePicker = $state(false);

  // BUG A FIX: formData.texture is stored as a clean "/assets/<name>" path
  // (see resolveAssetUrl()'s doc comment) — the <img> preview below needs a
  // freshly-minted query token to actually load it, otherwise the server's
  // static route 401s. External URLs pass through unchanged.
  //
  // T025: this preview uses the BROWSE scope, not a document grant, and that is
  // the correct scope rather than an exemption. The value being previewed was
  // just chosen in the FilePicker and is attached to NO document — the token
  // does not exist yet, so asking the server for a grant over this scene would
  // (rightly) return nothing and blank the preview. This dialog is a
  // GM/TRUSTED surface, exactly the role browse scope serves, and the same
  // credential the FilePicker grid beside it already uses.
  let previewUrl = $state<string | null>(null);

  $effect(() => {
    const raw = formData.texture.trim();
    if (!raw) {
      previewUrl = null;
      return;
    }
    const accessToken = fusionApi.getToken();
    const userId = session.user?.id;
    if (!accessToken || !userId) {
      previewUrl = raw;
      return;
    }
    let cancelled = false;
    void resolveBrowseAssetUrl(raw, accessToken, userId).then((url) => {
      if (!cancelled) previewUrl = url;
    });
    return () => { cancelled = true; };
  });

  // ---- Validation ----

  function validate(data: TokenFormData): TokenFormErrors {
    const errs: TokenFormErrors = {};
    if (!data.name.trim()) errs.name = "Name is required.";
    else if (data.name.trim().length > 128) errs.name = "Name must be 128 chars or fewer.";
    if (!Number.isInteger(data.width) || data.width < 1) errs.width = "Width must be at least 1.";
    if (!Number.isInteger(data.height) || data.height < 1) errs.height = "Height must be at least 1.";
    return errs;
  }

  function isValid(errs: TokenFormErrors): boolean {
    return Object.keys(errs).length === 0;
  }

  // ---- Handlers ----

  function handleInput(): void {
    errors = validate(formData);
    serverError = null;
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    errors = validate(formData);
    if (!isValid(errors)) return;

    submitting = true;
    serverError = null;

    try {
      await sendOp(socket, {
        type: "doc:update",
        payload: {
          documentType: "Scene",
          updates: [
            {
              _id: sceneId,
              diff: {
                tokens: {
                  $push: {
                    _id: createDocumentId(),
                    name: formData.name.trim(),
                    texture: formData.texture.trim() || null,
                    x: formData.x,
                    y: formData.y,
                    width: formData.width,
                    height: formData.height,
                    rotation: 0,
                    hidden: false,
                    disposition: 0,
                    elevation: 0,
                    bar1: { attribute: null },
                    bar2: { attribute: null },
                  },
                },
              },
            },
          ],
        },
      });
      onSuccess();
    } catch (err) {
      serverError = err instanceof Error ? err.message : "An unexpected error occurred.";
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
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
  class="token-dialog"
  open
  aria-label="Add token"
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">Add Token</h2>
    <button class="dialog__close btn btn--icon" onclick={onClose} aria-label="Close dialog">
      &#x2715;
    </button>
  </header>

  <form class="dialog__body" onsubmit={handleSubmit} novalidate>
    <!-- Name -->
    <div class="field" class:field--error={!!errors.name}>
      <label class="field__label" for="token-name">Name</label>
      <input
        id="token-name"
        class="field__input"
        type="text"
        bind:value={formData.name}
        oninput={handleInput}
        placeholder="Goblin Warrior"
        maxlength="128"
        autocomplete="off"
        disabled={submitting}
        required
      />
      {#if errors.name}
        <span class="field__error" role="alert">{errors.name}</span>
      {/if}
    </div>

    <!-- Texture / art -->
    <div class="field" class:field--error={!!errors.texture}>
      <label class="field__label" for="token-texture">
        Texture <span class="field__optional">(optional)</span>
      </label>
      <div class="field__asset-row">
        <input
          id="token-texture"
          class="field__input field__input--grow"
          type="text"
          bind:value={formData.texture}
          oninput={handleInput}
          placeholder="https://… or pick from assets"
          disabled={submitting}
        />
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          onclick={() => { showFilePicker = true; }}
          disabled={submitting}
          aria-label="Browse assets"
          title="Browse world assets"
        >
          &#128247;
        </button>
      </div>
      {#if previewUrl && !submitting}
        <div class="field__preview">
          <img
            class="field__preview-img"
            src={previewUrl}
            alt="Token texture preview"
            loading="lazy"
            onerror={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      {/if}
      {#if errors.texture}
        <span class="field__error" role="alert">{errors.texture}</span>
      {/if}
    </div>

    <!-- Position row -->
    <div class="field-row">
      <div class="field" class:field--error={!!errors.x}>
        <label class="field__label" for="token-x">X (px)</label>
        <input
          id="token-x"
          class="field__input"
          type="number"
          bind:value={formData.x}
          oninput={handleInput}
          min="0"
          step="1"
          disabled={submitting}
        />
      </div>
      <div class="field" class:field--error={!!errors.y}>
        <label class="field__label" for="token-y">Y (px)</label>
        <input
          id="token-y"
          class="field__input"
          type="number"
          bind:value={formData.y}
          oninput={handleInput}
          min="0"
          step="1"
          disabled={submitting}
        />
      </div>
    </div>

    <!-- Size row -->
    <div class="field-row">
      <div class="field" class:field--error={!!errors.width}>
        <label class="field__label" for="token-w">Width (cells)</label>
        <input
          id="token-w"
          class="field__input"
          type="number"
          bind:value={formData.width}
          oninput={handleInput}
          min="1"
          max="10"
          step="1"
          disabled={submitting}
        />
        {#if errors.width}
          <span class="field__error" role="alert">{errors.width}</span>
        {/if}
      </div>
      <div class="field" class:field--error={!!errors.height}>
        <label class="field__label" for="token-h">Height (cells)</label>
        <input
          id="token-h"
          class="field__input"
          type="number"
          bind:value={formData.height}
          oninput={handleInput}
          min="1"
          max="10"
          step="1"
          disabled={submitting}
        />
        {#if errors.height}
          <span class="field__error" role="alert">{errors.height}</span>
        {/if}
      </div>
    </div>

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}

    <footer class="dialog__footer">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={submitting}>
        Cancel
      </button>
      <button
        type="submit"
        class="btn btn--primary"
        disabled={submitting || !isValid(validate(formData))}
      >
        {submitting ? "Adding…" : "Add Token"}
      </button>
    </footer>
  </form>
</dialog>

<!-- FilePicker rendered outside dialog -->
{#if showFilePicker}
  {@const tok = fusionApi.getToken() ?? ""}
  <FilePicker
    token={tok}
    onSelect={(path) => {
      formData.texture = path;
      errors = validate(formData);
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

  .token-dialog {
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
    width: min(480px, 92vw);
    max-height: 90dvh;
    overflow-y: auto;
  }

  .token-dialog::backdrop {
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

  /* Inline preview of the selected texture URL */
  .field__preview {
    background: var(--fusion-bg);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    height: 80px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .field__preview-img {
    display: block;
    max-height: 78px;
    max-width: 100%;
    object-fit: contain;
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

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }

  .btn--icon {
    padding: 0.25rem 0.4rem;
  }
</style>
