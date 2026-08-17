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
   * TK023 (REQ-TOK-002, REQ-TOK-010, REQ-TOK-012, DEC-TOK-04): a token has no
   * `texture`/`width`/`height` of its own anymore, and `actorId` is required —
   * a piece with no actor is not a representable state. This dialog has no
   * actor PICKER yet (that UI is TK022-client, a later stage of this same
   * plan): until it exists, `actorId` stays empty and the submit button stays
   * disabled (`isValid`), same as a name that fails validation today. `name`
   * remains free text: unlike the hardcoded name a dragged actor's token used
   * to duplicate, this one is a deliberate GM override — left blank, it is
   * sent as `null` and the token inherits the actor's own name (REQ-TOK-060).
   */

  import type { Socket } from "socket.io-client";
  import { sendOp } from "../../lib/docs/sendOp.js";
  import { createDocumentId } from "@fusion/shared";

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
    actorId: string;
    x: number;
    y: number;
  }

  let formData = $state<TokenFormData>({
    name: "",
    actorId: "",
    x: 0,
    y: 0,
  });

  interface TokenFormErrors {
    name?: string;
    actorId?: string;
    x?: string;
    y?: string;
  }

  let errors = $state<TokenFormErrors>({});
  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  // ---- Validation ----

  function validate(data: TokenFormData): TokenFormErrors {
    const errs: TokenFormErrors = {};
    if (data.name.trim().length > 128) errs.name = "Name must be 128 chars or fewer.";
    // REQ-TOK-002 / DEC-TOK-04: no actor, no token — and there is no picker
    // here yet (TK022-client), so this is the one way this form can fail
    // validation on the field that matters most.
    if (!data.actorId.trim()) errs.actorId = "An actor is required.";
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
                    // REQ-TOK-060: blank name inherits the actor's own.
                    name: formData.name.trim() || null,
                    actorId: formData.actorId.trim(),
                    x: formData.x,
                    y: formData.y,
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
    <!-- Actor (REQ-TOK-002, DEC-TOK-04: required — no picker yet, TK022-client) -->
    <div class="field" class:field--error={!!errors.actorId}>
      <label class="field__label" for="token-actor">Actor</label>
      <input
        id="token-actor"
        class="field__input"
        type="text"
        bind:value={formData.actorId}
        oninput={handleInput}
        placeholder="Actor id"
        autocomplete="off"
        disabled={submitting}
        required
      />
      {#if errors.actorId}
        <span class="field__error" role="alert">{errors.actorId}</span>
      {/if}
    </div>

    <!-- Name (optional override — blank inherits the actor's own, REQ-TOK-060) -->
    <div class="field" class:field--error={!!errors.name}>
      <label class="field__label" for="token-name">
        Name <span class="field__optional">(optional — inherits the actor's)</span>
      </label>
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
      />
      {#if errors.name}
        <span class="field__error" role="alert">{errors.name}</span>
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
