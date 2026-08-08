<script lang="ts">
  /**
   * OwnershipDialog.svelte — GM-only modal to edit an Actor's `ownership` map.
   *
   * REQ-USR-015 [MVP]: "GM alters ownership of any Document via a dedicated
   * interface." This dialog covers Actors (opened from ActorDirectory.svelte).
   *
   * One row for "default" (fallback for every player not listed explicitly)
   * plus one row per world user (from session.worldInfo.users). Submitting
   * sends a single doc:update with the FULL ownership map as the diff — see
   * ownershipEdit.ts's MERGE ENGINE DECISION doc comment for why every row's
   * value must be written explicitly (including INHERIT), never omitted.
   *
   * Design mirrors TokenConfigDialog.svelte's dialog/backdrop/form pattern.
   */

  import type { Socket } from "socket.io-client";
  import { sendOp, OpError } from "../../lib/docs/sendOp.js";
  import { t } from "../../lib/i18n/i18n.js";
  import type { UserJoinInfo } from "../../lib/api.js";
  import {
    deriveOwnershipFormState,
    buildOwnershipDiff,
    ownershipLevelI18nKey,
    DEFAULT_LEVEL_OPTIONS,
    PER_USER_LEVEL_OPTIONS,
    type OwnershipFormState,
    type DefaultOwnershipLevel,
    type PerUserOwnershipLevel,
  } from "../../lib/actors/ownershipEdit.js";
  import type { Ownership } from "@fusion/shared";

  // ---- Props ----

  const {
    actorId,
    actorName,
    ownership,
    users,
    onClose,
    onSuccess,
    socket,
  }: {
    actorId: string;
    actorName: string;
    ownership: Ownership;
    users: readonly UserJoinInfo[];
    onClose: () => void;
    onSuccess: () => void;
    socket: Socket;
  } = $props();

  // ---- State ----

  let form = $state<OwnershipFormState>(
    deriveOwnershipFormState(
      ownership,
      users.map((u) => u.id),
    ),
  );

  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  // ---- Handlers ----

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  function setDefaultLevel(value: string): void {
    form.default = Number(value) as DefaultOwnershipLevel;
  }

  function setUserLevel(userId: string, value: string): void {
    form.perUser[userId] = Number(value) as PerUserOwnershipLevel;
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    submitting = true;
    serverError = null;

    try {
      await sendOp(socket, {
        type: "doc:update",
        payload: {
          documentType: "Actor",
          updates: [
            {
              _id: actorId,
              diff: { ownership: buildOwnershipDiff(form) },
            },
          ],
        },
      });
      onSuccess();
    } catch (err) {
      serverError =
        err instanceof OpError
          ? err.message
          : t("FUSION.Ownership.Dialog.UnexpectedError");
    } finally {
      submitting = false;
    }
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="dialog-backdrop" role="presentation" onclick={onClose} onkeydown={handleKeydown}></div>

<!-- Dialog -->
<dialog
  class="ownership-dialog"
  open
  aria-label={t("FUSION.Ownership.Dialog.Title", { name: actorName })}
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">{t("FUSION.Ownership.Dialog.Title", { name: actorName })}</h2>
    <button class="dialog__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>&#x2715;</button>
  </header>

  <form class="dialog__body" onsubmit={handleSubmit} novalidate>
    <!-- Default row -->
    <div class="ownership-row ownership-row--default">
      <span class="ownership-row__label">{t("FUSION.Ownership.Dialog.DefaultRowLabel")}</span>
      <select
        class="ownership-row__select"
        value={form.default}
        disabled={submitting}
        onchange={(e) => setDefaultLevel((e.target as HTMLSelectElement).value)}
      >
        {#each DEFAULT_LEVEL_OPTIONS as level (level)}
          <option value={level}>{t(`FUSION.Ownership.Level.${ownershipLevelI18nKey(level)}`)}</option>
        {/each}
      </select>
    </div>

    <!-- Per-user rows -->
    {#each users as user (user.id)}
      <div class="ownership-row">
        <span class="ownership-row__user">
          <span class="ownership-row__swatch" style="background-color: {user.color}"></span>
          <span class="ownership-row__label">{user.name}</span>
        </span>
        <select
          class="ownership-row__select"
          value={form.perUser[user.id]}
          disabled={submitting}
          onchange={(e) => setUserLevel(user.id, (e.target as HTMLSelectElement).value)}
        >
          {#each PER_USER_LEVEL_OPTIONS as level (level)}
            <option value={level}>{t(`FUSION.Ownership.Level.${ownershipLevelI18nKey(level)}`)}</option>
          {/each}
        </select>
      </div>
    {/each}

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}

    <footer class="dialog__footer">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={submitting}>
        {t("FUSION.Dialog.Cancel")}
      </button>
      <button type="submit" class="btn btn--primary" disabled={submitting}>
        {submitting ? t("FUSION.Ownership.Dialog.Saving") : t("FUSION.Ownership.Dialog.Save")}
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

  .ownership-dialog {
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
    width: min(420px, 94vw);
    max-height: 90dvh;
    overflow-y: auto;
  }

  .ownership-dialog::backdrop {
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    gap: 0.6rem;
    padding: 1.25rem;
  }

  .ownership-row {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .ownership-row--default {
    border-bottom: 1px solid var(--fusion-border);
    padding-bottom: 0.75rem;
    margin-bottom: 0.25rem;
  }

  .ownership-row__user {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }

  .ownership-row__swatch {
    border-radius: 50%;
    flex-shrink: 0;
    height: 0.7rem;
    width: 0.7rem;
  }

  .ownership-row__label {
    color: var(--fusion-text);
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ownership-row__select {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    flex-shrink: 0;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.35rem 0.5rem;
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
    margin-top: 0.5rem;
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
