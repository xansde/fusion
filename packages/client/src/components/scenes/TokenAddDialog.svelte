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
   * TK022-client (REQ-TOK-002, REQ-TOK-010, REQ-TOK-012, REQ-TOK-020, REQ-TOK-024,
   * DEC-TOK-04): a token has no `texture`/`width`/`height` of its own, and `actorId` is
   * required — a piece with no actor is not a representable state. This dialog picks
   * that actor from the world's own list (`worldMirror`, searchable by name); with none
   * selected, "Add Token" stays disabled with a legible reason (CA-TOK-003). `name`
   * remains a free-text override: blank, it is left off the payload and the token
   * inherits the actor's own name (REQ-TOK-060). `hidden` is the other overridable
   * field this dialog exposes (REQ-TOK-024), for the piece that enters an ambush
   * already out of sight. The pure logic (filtering, validation, the `doc:create` op)
   * lives in `lib/scenes/tokenAddDialogVM.ts` so it is testable without a DOM.
   */

  import type { Socket } from "socket.io-client";
  import { sendOp } from "../../lib/docs/sendOp.js";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { t } from "../../lib/i18n/i18n.js";
  import {
    buildCreateTokenOp,
    filterTokenActorOptions,
    isTokenAddFormValid,
    toTokenActorOptions,
    validateTokenAddForm,
    type MinimalActorDoc,
    type TokenActorOption,
    type TokenAddFormData,
    type TokenAddFormErrors,
  } from "../../lib/scenes/tokenAddDialogVM.js";

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

  // ---- Actor list (REQ-TOK-002: picking one is mandatory) ----

  let actors = $state<TokenActorOption[]>(
    toTokenActorOptions(worldMirror.getByType<MinimalActorDoc>("Actor")),
  );

  $effect(() => {
    const unsubscribe = worldMirror.subscribe<MinimalActorDoc>("Actor", (docs) => {
      actors = toTokenActorOptions(docs);
    });
    actors = toTokenActorOptions(worldMirror.getByType<MinimalActorDoc>("Actor"));
    return unsubscribe;
  });

  let actorQuery = $state("");
  const filteredActors = $derived(filterTokenActorOptions(actors, actorQuery));

  // ---- Form state ----

  let formData = $state<TokenAddFormData>({
    actorId: "",
    name: "",
    x: 0,
    y: 0,
    hidden: false,
  });

  const selectedActor = $derived(actors.find((a) => a.id === formData.actorId) ?? null);

  // Validated eagerly (not just on mount): `render()` from `svelte/server` — the
  // component-test instrument this repo uses for first-paint assertions — never runs
  // lifecycle hooks, so an `onMount`-only validation would leave `errors` empty on
  // every SSR string and mask CA-TOK-003's "legible reason" in the very test meant to
  // prove it. Computing it here also removes the one-tick flash of an unlabeled
  // required field a real mount used to have before `onMount` fired.
  let errors = $state<TokenAddFormErrors>(validateTokenAddForm(formData));
  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  // ---- Handlers ----

  function handleInput(): void {
    errors = validateTokenAddForm(formData);
    serverError = null;
  }

  function selectActor(id: string): void {
    formData.actorId = id;
    actorQuery = "";
    handleInput();
  }

  function clearActor(): void {
    formData.actorId = "";
    handleInput();
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    errors = validateTokenAddForm(formData);
    if (!isTokenAddFormValid(errors)) return;

    submitting = true;
    serverError = null;

    try {
      await sendOp(socket, buildCreateTokenOp(sceneId, formData));
      onSuccess();
    } catch (err) {
      serverError = err instanceof Error ? err.message : t("FUSION.Scenes.TokenAdd.UnexpectedError");
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
  aria-label={t("FUSION.Scenes.TokenAdd.Title")}
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">{t("FUSION.Scenes.TokenAdd.Title")}</h2>
    <button
      class="dialog__close btn btn--icon"
      onclick={onClose}
      aria-label={t("FUSION.Dialog.Close")}
    >
      &#x2715;
    </button>
  </header>

  <form class="dialog__body" onsubmit={handleSubmit} novalidate>
    <!-- Actor (REQ-TOK-002, DEC-TOK-04: required — CA-TOK-003) -->
    <div class="field" class:field--error={!!errors.actorId}>
      <label class="field__label" for="token-actor-search">
        {t("FUSION.Scenes.TokenAdd.ActorLabel")}
      </label>

      {#if selectedActor}
        <div class="actor-selected">
          {#if selectedActor.img}
            <img class="actor-selected__img" src={selectedActor.img} alt="" />
          {/if}
          <span class="actor-selected__name">{selectedActor.name}</span>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            onclick={clearActor}
            disabled={submitting}
          >
            {t("FUSION.Scenes.TokenAdd.ActorChange")}
          </button>
        </div>
      {:else}
        <input
          id="token-actor-search"
          class="field__input"
          type="text"
          bind:value={actorQuery}
          placeholder={t("FUSION.Scenes.TokenAdd.ActorSearchPlaceholder")}
          autocomplete="off"
          disabled={submitting}
        />
        <ul class="actor-list" role="listbox" aria-label={t("FUSION.Scenes.TokenAdd.ActorLabel")}>
          {#each filteredActors as actor (actor.id)}
            <li>
              <button
                type="button"
                class="actor-option"
                role="option"
                aria-selected="false"
                onclick={() => selectActor(actor.id)}
                disabled={submitting}
              >
                {#if actor.img}
                  <img class="actor-option__img" src={actor.img} alt="" />
                {/if}
                <span class="actor-option__name">{actor.name}</span>
              </button>
            </li>
          {:else}
            <li class="actor-list__empty">{t("FUSION.Scenes.TokenAdd.ActorNoResults")}</li>
          {/each}
        </ul>
      {/if}

      {#if errors.actorId}
        <span class="field__error" role="alert">{t(errors.actorId)}</span>
      {/if}
    </div>

    <!-- Name (optional override — blank inherits the actor's own, REQ-TOK-060) -->
    <div class="field" class:field--error={!!errors.name}>
      <label class="field__label" for="token-name">
        {t("FUSION.Scenes.TokenAdd.NameLabel")}
        <span class="field__optional">{t("FUSION.Scenes.TokenAdd.NameOptional")}</span>
      </label>
      <input
        id="token-name"
        class="field__input"
        type="text"
        bind:value={formData.name}
        oninput={handleInput}
        maxlength="128"
        autocomplete="off"
        disabled={submitting}
      />
      {#if errors.name}
        <span class="field__error" role="alert">{t(errors.name)}</span>
      {/if}
    </div>

    <!-- Position row -->
    <div class="field-row">
      <div class="field">
        <label class="field__label" for="token-x">{t("FUSION.Scenes.TokenAdd.XLabel")}</label>
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
      <div class="field">
        <label class="field__label" for="token-y">{t("FUSION.Scenes.TokenAdd.YLabel")}</label>
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

    <!-- Hidden (REQ-TOK-024: overridable at creation) -->
    <label class="checkbox-row">
      <input
        type="checkbox"
        bind:checked={formData.hidden}
        onchange={handleInput}
        disabled={submitting}
      />
      <span>{t("FUSION.Scenes.TokenAdd.HiddenLabel")}</span>
    </label>

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}

    <footer class="dialog__footer">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={submitting}>
        {t("FUSION.Dialog.Cancel")}
      </button>
      <button
        type="submit"
        class="btn btn--primary"
        disabled={submitting || !isTokenAddFormValid(validateTokenAddForm(formData))}
      >
        {submitting ? t("FUSION.Scenes.TokenAdd.Submitting") : t("FUSION.Scenes.TokenAdd.Submit")}
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

  .actor-list {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0.3rem 0 0;
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.25rem;
  }

  .actor-list__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 0.5rem;
  }

  .actor-option {
    align-items: center;
    background: transparent;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    text-align: left;
    width: 100%;
  }

  .actor-option:hover:not(:disabled) {
    background: var(--fusion-surface);
  }

  .actor-option:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .actor-option__img {
    border-radius: var(--fusion-radius-sm);
    height: 1.5rem;
    object-fit: cover;
    width: 1.5rem;
  }

  .actor-selected {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
  }

  .actor-selected__img {
    border-radius: var(--fusion-radius-sm);
    height: 1.75rem;
    object-fit: cover;
    width: 1.75rem;
  }

  .actor-selected__name {
    flex: 1;
    font-size: 0.875rem;
  }

  .checkbox-row {
    align-items: center;
    cursor: pointer;
    display: flex;
    font-size: 0.875rem;
    gap: 0.5rem;
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
    font-size: 0.75rem;
    padding: 0.3rem 0.6rem;
  }

  .btn--icon {
    padding: 0.25rem 0.4rem;
  }
</style>
