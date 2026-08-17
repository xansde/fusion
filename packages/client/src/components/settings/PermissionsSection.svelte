<script lang="ts">
  /**
   * PermissionsSection.svelte — "Permissões" (spec 37 §5.5, G104).
   *
   * REQ-CFG-040: one row per configurable Permission (REQ-USR-008), each with
   * a papel-mínimo SELECTOR — never a bidimensional matrix (the `{#each}`
   * below is the entire contract; there is no second axis anywhere in this
   * markup). REQ-CFG-041: a row carries the "alterado" mark exactly when
   * `isPermissionChanged` says its effective floor differs from the shipped
   * default.
   *
   * Writes go through the generic `doc:create`/`doc:update` of `Setting`
   * (`buildPermissionWriteOp`, REQ-CFG-071), sent by
   * `commitPermissionWrite` (`permissionsRegistry.svelte.ts`). No optimistic
   * update: a row only shows a NEW role once the ack confirms it — a refusal
   * leaves `permissionsRegistry` at the last value the server actually
   * accepted, because `commitPermissionWrite` only folds the write back in
   * on success. On a refusal (REQ-CFG-042/073) `handleChange` does two
   * things the registry alone cannot: records the server's reason in
   * `state` (rendered under the row, `FUSION.Settings.Permissions.
   * WriteFailed`) and forces the `<select>`'s DOM value back to `row.minRole`
   * — a plain `<select>`'s `value` is native browser state the moment the
   * user picks an option, and since the row itself never changed on a
   * refusal, Svelte's own `value={String(row.minRole)}` binding has nothing
   * to re-run (the expression's value is unchanged), so nobody else undoes
   * the browser's own edit.
   *
   * `state` (`PermissionsSectionState`) is an injectable prop, same pattern
   * as `UsersSection.svelte`'s `flow` — defaults to a fresh instance per
   * mount (the drawer remounts the panel on every switch, REQ-GAV-017), and
   * lets tests pre-seed a refusal before a `svelte/server` render.
   */

  import type { Socket } from "socket.io-client";
  import { t } from "../../lib/i18n/i18n.js";
  import {
    commitPermissionWrite,
    ensurePermissionsRegistry,
    permissionsRegistry,
  } from "../../lib/settings/permissionsRegistry.svelte.js";
  import {
    isPermissionChanged,
    permissionLabelKey,
    PERMISSION_ROLE_OPTIONS,
    type PermissionRow,
  } from "../../lib/settings/permissionsSection.js";
  import { PermissionsSectionState } from "../../lib/settings/permissionsSectionState.svelte.js";

  interface Props {
    socket: Socket;
    state?: PermissionsSectionState;
  }

  const { socket, state = new PermissionsSectionState() }: Props = $props();

  // The drawer mounts a fresh panel on every switch (REQ-GAV-017), so there is
  // nothing to keep reactive to a socket reconnect here.
  // svelte-ignore state_referenced_locally
  void ensurePermissionsRegistry(socket);

  const rows = $derived(permissionsRegistry.rows);

  function roleLabel(role: number): string {
    switch (role) {
      case 4:
        return t("FUSION.Role.GM");
      case 3:
        return t("FUSION.Role.Assistant");
      case 2:
        return t("FUSION.Role.Trusted");
      default:
        return t("FUSION.Role.Player");
    }
  }

  async function handleChange(
    row: PermissionRow,
    nextMinRole: number,
    target: HTMLSelectElement,
  ): Promise<void> {
    try {
      await commitPermissionWrite(socket, row, nextMinRole);
      state.clearError(row.key);
    } catch (err) {
      // REQ-CFG-042/073: a refusal reverts the selector to the role the
      // server last actually accepted, and shows why.
      const message = err instanceof Error ? err.message : String(err);
      state.setError(row.key, message);
      target.value = String(row.minRole);
    }
  }
</script>

<div class="permissions-section">
  {#if rows.length === 0}
    <p class="permissions-section__empty">{t("FUSION.Settings.Permissions.Empty")}</p>
  {:else}
    <ul class="permissions-section__list">
      {#each rows as row (row.key)}
        {@const rowError = state.errorFor(row.key)}
        <li class="permissions-section__row">
          <div class="permissions-section__meta">
            <span class="permissions-section__label">{t(permissionLabelKey(row.key))}</span>
            {#if isPermissionChanged(row)}
              <span class="permissions-section__changed"
                >{t("FUSION.Settings.Permissions.Changed")}</span
              >
            {/if}
            {#if rowError}
              <span class="permissions-section__error"
                >{t("FUSION.Settings.Permissions.WriteFailed", { message: rowError })}</span
              >
            {/if}
          </div>
          <select
            class="permissions-section__select"
            value={String(row.minRole)}
            onchange={(event) => {
              const target = event.currentTarget as HTMLSelectElement;
              void handleChange(row, Number(target.value), target);
            }}
          >
            {#each PERMISSION_ROLE_OPTIONS as option (option)}
              <option value={String(option)}>{roleLabel(option)}</option>
            {/each}
          </select>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .permissions-section {
    padding: 0.5rem 0.75rem;
  }

  .permissions-section__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 0;
    text-align: center;
  }

  .permissions-section__list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .permissions-section__row {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .permissions-section__meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .permissions-section__label {
    color: var(--fusion-text);
    font-size: 0.8125rem;
  }

  .permissions-section__changed {
    color: var(--fusion-accent);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .permissions-section__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
  }

  .permissions-section__select {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    flex-shrink: 0;
    font: inherit;
    padding: 0.25rem 0.4rem;
  }
</style>
