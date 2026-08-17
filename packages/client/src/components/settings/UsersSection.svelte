<script lang="ts">
  /**
   * UsersSection.svelte — "Usuários" (spec 37 §5.6, G105).
   *
   * REQ-CFG-050: one line per user (name, papel, cor, conexão) — the list is
   * `mergeConnectionStatus(usersRegistry.users, presenceState.onlineUsers)`,
   * never a second fetch of presence data. REQ-CFG-051: create (server also
   * creates the blank personagem for a non-privileged role, REQ-USR-025 —
   * this markup has no button, field or dialog about that personagem at all,
   * REQ-CFG-051a) and the four row actions (editar, resetar senha, desativar,
   * desconectar). REQ-CFG-052: editing happens as a STACKED form in this same
   * panel, one field applied per blur/change (REQ-CFG-080) — never a save
   * button, never a floating window (DEC-CFG-04). REQ-CFG-053: a reset's
   * password is shown exactly once, with a copy action, and is gone the
   * instant `flow.resetReveal` is cleared (`usersSectionState.svelte.ts`
   * clears it on every navigation away). REQ-CFG-054: desativar and
   * desconectar both gate on the SAME nominal `confirm()` — "Tirar <nome> da
   * mesa?" — the native-dialog precedent `WorldSection.svelte`'s disable
   * confirm and `ActorDirectory.svelte`'s delete already use.
   *
   * All five writes (`create`/`update`/`reset-password`/`delete`/`kick`) go
   * through `usersApi.ts`'s HTTP client — user administration predates
   * `Setting`/`doc:*` and is not a socket op (brief §3.9) — with the bearer
   * token read fresh from `fusionApi.getToken()` on every call, never cached
   * anywhere in this component.
   *
   * The prop carrying the list↔create↔edit machine (`UsersSectionState`) is
   * deliberately named `flow`, not `state`: Svelte 5's legacy store
   * auto-subscription rewrites any `$state(...)` rune call textually when a
   * top-level binding is literally named `state`, which throws
   * `store_invalid_shape` at server-render time — `settingsNav.svelte.ts`'s
   * own injectable prop sidesteps the same trap by being named `nav`.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import { fusionApi } from "../../lib/api.js";
  import { presenceState } from "../../lib/presence/presenceStore.svelte.js";
  import * as usersApi from "../../lib/settings/usersApi.js";
  import type { AdminUser } from "../../lib/settings/usersApi.js";
  import {
    applyCreatedUser,
    applyDeactivatedUser,
    applyUpdatedUser,
    ensureUsersRegistry,
    usersRegistry,
  } from "../../lib/settings/usersRegistry.svelte.js";
  import {
    buildFieldPatch,
    CONFIRM_REMOVE_KEY,
    mergeConnectionStatus,
    userRoleLabelKey,
    USER_ROLE_OPTIONS,
    type UsersSectionRow,
  } from "../../lib/settings/usersSection.js";
  import { UsersSectionState } from "../../lib/settings/usersSectionState.svelte.js";

  interface Props {
    /** Injectable so tests own their own (mirrors `SettingsTab.svelte`'s `nav` prop). */
    flow?: UsersSectionState;
  }

  const { flow = new UsersSectionState() }: Props = $props();

  // The drawer mounts a fresh panel on every switch (REQ-GAV-017), so there is
  // nothing to keep reactive to a token change here.
  // svelte-ignore state_referenced_locally
  void ensureUsersRegistry(fusionApi.getToken() ?? "");

  const rows = $derived(mergeConnectionStatus(usersRegistry.users, presenceState.onlineUsers));

  function roleLabel(role: number): string {
    return t(userRoleLabelKey(role));
  }

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // ---------------------------------------------------------------------------
  // Create (REQ-CFG-051, REQ-USR-025)
  // ---------------------------------------------------------------------------

  let createName = $state("");
  let createRole = $state(1);
  let createColor = $state("#3b82f6");
  let createPassword = $state("");
  let createError = $state<string | null>(null);
  let creating = $state(false);

  function resetCreateForm(): void {
    createName = "";
    createRole = 1;
    createColor = "#3b82f6";
    createPassword = "";
    createError = null;
  }

  function openCreate(): void {
    resetCreateForm();
    flow.openCreate();
  }

  async function submitCreate(): Promise<void> {
    const name = createName.trim();
    if (!name) {
      createError = t("FUSION.Settings.Users.NameRequired");
      return;
    }
    creating = true;
    createError = null;
    try {
      const input: usersApi.CreateUserInput = { name, role: createRole, color: createColor };
      if (createPassword.trim() !== "") input.password = createPassword;
      const user = await usersApi.createUser(fusionApi.getToken() ?? "", input);
      applyCreatedUser(user);
      flow.backToList();
    } catch (err) {
      createError = errorMessage(err);
    } finally {
      creating = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Edit (REQ-CFG-052, REQ-USR-026)
  // ---------------------------------------------------------------------------

  // `$derived.by` (not `$derived`) because `flow.view` is a getter: reading it
  // twice — once to narrow `kind`, once more for `userId` — cannot be
  // correlated by TS through two separate getter calls, so it is read once
  // into a local instead.
  const editingUser = $derived.by<AdminUser | null>(() => {
    const view = flow.view;
    if (view.kind !== "edit") return null;
    return usersRegistry.users.find((user) => user.id === view.userId) ?? null;
  });
  let editError = $state<string | null>(null);

  function openEdit(user: AdminUser): void {
    editError = null;
    flow.openEdit(user.id);
  }

  async function commitEditName(value: string): Promise<void> {
    if (!editingUser) return;
    const patch = buildFieldPatch(editingUser, "name", value);
    if (!patch) return;
    await commitEdit(editingUser.id, patch);
  }

  async function commitEditRole(value: number): Promise<void> {
    if (!editingUser) return;
    const patch = buildFieldPatch(editingUser, "role", value);
    if (!patch) return;
    await commitEdit(editingUser.id, patch);
  }

  async function commitEditColor(value: string): Promise<void> {
    if (!editingUser) return;
    const patch = buildFieldPatch(editingUser, "color", value);
    if (!patch) return;
    await commitEdit(editingUser.id, patch);
  }

  async function commitEditAvatar(value: string): Promise<void> {
    if (!editingUser) return;
    const avatar = value.trim() === "" ? null : value.trim();
    const patch = buildFieldPatch(editingUser, "avatar", avatar);
    if (!patch) return;
    await commitEdit(editingUser.id, patch);
  }

  async function commitEditActive(value: boolean): Promise<void> {
    if (!editingUser) return;
    const patch = buildFieldPatch(editingUser, "active", value);
    if (!patch) return;
    await commitEdit(editingUser.id, patch);
  }

  async function commitEdit(userId: string, patch: usersApi.UpdateUserInput): Promise<void> {
    try {
      const updated = await usersApi.updateUser(fusionApi.getToken() ?? "", userId, patch);
      applyUpdatedUser(updated);
      editError = null;
    } catch (err) {
      // REQ-CFG-073's spirit, extended to this section: a refusal (e.g. "LAST_GM")
      // never applied optimistically, so there is nothing to revert — only to explain.
      editError = errorMessage(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Reset password (REQ-CFG-053, REQ-USR-027)
  // ---------------------------------------------------------------------------

  let resettingId = $state<string | null>(null);

  async function handleResetPassword(row: UsersSectionRow): Promise<void> {
    resettingId = row.id;
    try {
      const result = await usersApi.resetPassword(fusionApi.getToken() ?? "", row.id);
      flow.showResetReveal({ userId: row.id, userName: row.name, password: result.password });
    } catch (err) {
      alert(t("FUSION.Settings.Users.ResetFailed", { message: errorMessage(err) }));
    } finally {
      resettingId = null;
    }
  }

  let copied = $state(false);

  function copyRevealedPassword(password: string): void {
    void navigator.clipboard?.writeText(password);
    copied = true;
  }

  // ---------------------------------------------------------------------------
  // Desativar / desconectar (REQ-CFG-054, REQ-USR-028/029)
  // ---------------------------------------------------------------------------

  async function handleDeactivate(row: UsersSectionRow): Promise<void> {
    if (!confirm(t(CONFIRM_REMOVE_KEY, { name: row.name }))) return;
    try {
      await usersApi.deactivateUser(fusionApi.getToken() ?? "", row.id);
      applyDeactivatedUser(row.id);
    } catch (err) {
      alert(t("FUSION.Settings.Users.DeactivateFailed", { message: errorMessage(err) }));
    }
  }

  async function handleKick(row: UsersSectionRow): Promise<void> {
    if (!confirm(t(CONFIRM_REMOVE_KEY, { name: row.name }))) return;
    try {
      await usersApi.kickUser(fusionApi.getToken() ?? "", row.id);
    } catch (err) {
      alert(t("FUSION.Settings.Users.KickFailed", { message: errorMessage(err) }));
    }
  }
</script>

<div class="users-section">
  {#if flow.view.kind === "list"}
    <div class="users-section__toolbar">
      <button type="button" class="users-section__create-btn" onclick={openCreate}>
        {t("FUSION.Settings.Users.Create.Open")}
      </button>
    </div>

    {#if flow.resetReveal}
      <div class="users-section__reveal">
        <p class="users-section__reveal-title">
          {t("FUSION.Settings.Users.ResetPassword.RevealTitle", {
            name: flow.resetReveal.userName,
          })}
        </p>
        {#if flow.resetReveal.password !== null}
          {@const password = flow.resetReveal.password}
          <div class="users-section__reveal-row">
            <code class="users-section__reveal-password">{password}</code>
            <button
              type="button"
              class="users-section__reveal-copy"
              onclick={() => {
                copyRevealedPassword(password);
              }}
            >
              {copied
                ? t("FUSION.Settings.Users.ResetPassword.Copied")
                : t("FUSION.Settings.Users.ResetPassword.Copy")}
            </button>
          </div>
        {:else}
          <p class="users-section__reveal-password">
            {t("FUSION.Settings.Users.ResetPassword.Removed")}
          </p>
        {/if}
        <p class="users-section__reveal-warning">
          {t("FUSION.Settings.Users.ResetPassword.Warning")}
        </p>
        <button
          type="button"
          class="users-section__reveal-close"
          onclick={() => {
            copied = false;
            flow.clearResetReveal();
          }}
        >
          {t("FUSION.Settings.Users.ResetPassword.Close")}
        </button>
      </div>
    {/if}

    {#if rows.length === 0}
      <p class="users-section__empty">{t("FUSION.Settings.Users.Empty")}</p>
    {:else}
      <ul class="users-section__list">
        {#each rows as row (row.id)}
          <li class="users-section__row">
            <span
              class="users-section__swatch"
              style={`background-color: ${row.color};`}
              aria-hidden="true"
            ></span>
            <div class="users-section__meta">
              <span class="users-section__name">{row.name}</span>
              <span class="users-section__role">{roleLabel(row.role)}</span>
            </div>
            <span
              class={`users-section__dot ${row.online ? "users-section__dot--online" : "users-section__dot--offline"}`}
              title={row.online
                ? t("FUSION.Settings.Users.Connection.Online")
                : t("FUSION.Settings.Users.Connection.Offline")}
              aria-hidden="true"
            ></span>
            {#if !row.active}
              <span class="users-section__inactive">{t("FUSION.Settings.Users.Inactive")}</span>
            {/if}
            <div class="users-section__actions">
              <button
                type="button"
                onclick={() => {
                  openEdit(row);
                }}
              >
                {t("FUSION.Settings.Users.Actions.Edit")}
              </button>
              <button
                type="button"
                disabled={resettingId === row.id}
                onclick={() => {
                  void handleResetPassword(row);
                }}
              >
                {t("FUSION.Settings.Users.Actions.ResetPassword")}
              </button>
              {#if row.active}
                <button
                  type="button"
                  onclick={() => {
                    void handleDeactivate(row);
                  }}
                >
                  {t("FUSION.Settings.Users.Actions.Deactivate")}
                </button>
              {/if}
              {#if row.online}
                <button
                  type="button"
                  onclick={() => {
                    void handleKick(row);
                  }}
                >
                  {t("FUSION.Settings.Users.Actions.Kick")}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if flow.view.kind === "create"}
    <div class="users-section__form">
      <button type="button" class="users-section__form-back" onclick={() => flow.backToList()}>
        <span aria-hidden="true">‹</span>
        {t("FUSION.Settings.Users.BackToList")}
      </button>
      <p class="users-section__form-title">{t("FUSION.Settings.Users.Create.Title")}</p>

      <label class="users-section__field">
        <span>{t("FUSION.Settings.Users.Fields.Name")}</span>
        <input type="text" bind:value={createName} />
      </label>

      <label class="users-section__field">
        <span>{t("FUSION.Settings.Users.Fields.Role")}</span>
        <select
          value={String(createRole)}
          onchange={(event) => {
            createRole = Number((event.currentTarget as HTMLSelectElement).value);
          }}
        >
          {#each USER_ROLE_OPTIONS as option (option)}
            <option value={String(option)}>{roleLabel(option)}</option>
          {/each}
        </select>
      </label>

      <label class="users-section__field">
        <span>{t("FUSION.Settings.Users.Fields.Color")}</span>
        <input type="color" bind:value={createColor} />
      </label>

      <label class="users-section__field">
        <span>{t("FUSION.Settings.Users.Fields.Password")}</span>
        <input type="text" bind:value={createPassword} />
      </label>

      {#if createError}
        <p class="users-section__form-error">{createError}</p>
      {/if}

      <button
        type="button"
        class="users-section__form-submit"
        disabled={creating}
        onclick={() => {
          void submitCreate();
        }}
      >
        {t("FUSION.Settings.Users.Create.Submit")}
      </button>
    </div>
  {:else if flow.view.kind === "edit"}
    <div class="users-section__form">
      <button type="button" class="users-section__form-back" onclick={() => flow.backToList()}>
        <span aria-hidden="true">‹</span>
        {t("FUSION.Settings.Users.BackToList")}
      </button>

      {#if editingUser}
        {@const user = editingUser}
        <p class="users-section__form-title">
          {t("FUSION.Settings.Users.Edit.Title", { name: user.name })}
        </p>

        <label class="users-section__field">
          <span>{t("FUSION.Settings.Users.Fields.Name")}</span>
          <input
            type="text"
            value={user.name}
            onblur={(event) => {
              void commitEditName((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>

        <label class="users-section__field">
          <span>{t("FUSION.Settings.Users.Fields.Role")}</span>
          <select
            value={String(user.role)}
            onchange={(event) => {
              void commitEditRole(Number((event.currentTarget as HTMLSelectElement).value));
            }}
          >
            {#each USER_ROLE_OPTIONS as option (option)}
              <option value={String(option)}>{roleLabel(option)}</option>
            {/each}
          </select>
        </label>

        <label class="users-section__field">
          <span>{t("FUSION.Settings.Users.Fields.Color")}</span>
          <input
            type="color"
            value={user.color}
            onchange={(event) => {
              void commitEditColor((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>

        <label class="users-section__field">
          <span>{t("FUSION.Settings.Users.Fields.Avatar")}</span>
          <input
            type="text"
            value={user.avatar ?? ""}
            onblur={(event) => {
              void commitEditAvatar((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>

        <label class="users-section__checkbox-row">
          <input
            type="checkbox"
            checked={user.active}
            onchange={(event) => {
              void commitEditActive((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          <span>{t("FUSION.Settings.Users.Fields.Active")}</span>
        </label>

        {#if editError}
          <p class="users-section__form-error">{editError}</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .users-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }

  .users-section__toolbar {
    display: flex;
    justify-content: flex-end;
  }

  .users-section__create-btn {
    background: var(--fusion-accent);
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-surface);
    cursor: pointer;
    font: inherit;
    padding: 0.3rem 0.6rem;
  }

  .users-section__create-btn:hover {
    background: var(--fusion-accent-hover);
  }

  .users-section__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 0;
    text-align: center;
  }

  .users-section__list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .users-section__row {
    align-items: center;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .users-section__swatch {
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
    height: 0.75rem;
    width: 0.75rem;
  }

  .users-section__meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin-right: auto;
    min-width: 0;
  }

  .users-section__name {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .users-section__role {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
  }

  .users-section__dot {
    border-radius: 50%;
    flex-shrink: 0;
    height: 0.5rem;
    width: 0.5rem;
  }

  .users-section__dot--online {
    background: var(--fusion-success);
  }

  .users-section__dot--offline {
    background: var(--fusion-text-subtle);
  }

  .users-section__inactive {
    color: var(--fusion-danger);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .users-section__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    width: 100%;
  }

  .users-section__actions button {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
  }

  .users-section__reveal {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem;
  }

  .users-section__reveal-title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    margin: 0;
  }

  .users-section__reveal-row {
    align-items: center;
    display: flex;
    gap: 0.5rem;
  }

  .users-section__reveal-password {
    background: var(--fusion-surface);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-size: 0.8125rem;
    margin: 0;
    padding: 0.25rem 0.4rem;
  }

  .users-section__reveal-copy,
  .users-section__reveal-close {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    width: fit-content;
  }

  .users-section__reveal-warning {
    color: var(--fusion-text-subtle);
    font-size: 0.6875rem;
    margin: 0;
  }

  .users-section__form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .users-section__form-back {
    align-items: center;
    background: none;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: flex;
    font: inherit;
    gap: 0.25rem;
    padding: 0;
    width: fit-content;
  }

  .users-section__form-title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    margin: 0;
  }

  .users-section__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .users-section__field span,
  .users-section__checkbox-row span {
    color: var(--fusion-text);
    font-size: 0.8125rem;
  }

  .users-section__field input,
  .users-section__field select {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font: inherit;
    padding: 0.3rem 0.4rem;
  }

  .users-section__checkbox-row {
    align-items: center;
    display: flex;
    gap: 0.5rem;
  }

  .users-section__form-error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
    margin: 0;
  }

  .users-section__form-submit {
    background: var(--fusion-accent);
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-surface);
    cursor: pointer;
    font: inherit;
    padding: 0.35rem 0.6rem;
    width: fit-content;
  }

  .users-section__form-submit:hover {
    background: var(--fusion-accent-hover);
  }
</style>
