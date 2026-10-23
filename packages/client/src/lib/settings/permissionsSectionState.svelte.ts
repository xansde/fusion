/**
 * permissionsSectionState.svelte.ts — per-row write-failure state for the
 * "Permissões" section (spec 37 §5.5, G104, REQ-CFG-042/073).
 *
 * Same shape and purpose as `WorldSectionState` (G102's sibling): a
 * `$state`-backed class, injectable into `PermissionsSection.svelte` as an
 * optional prop defaulting to a fresh instance per mount, so tests can
 * pre-seed a refusal before a `svelte/server` render without simulating a
 * change event. Keyed by `row.key`, never a role or a permission-specific
 * branch (REQ-CFG-040's "nunca matriz" applies here too).
 */

export class PermissionsSectionState {
  #errors: Record<string, string> = $state({});

  /** The message of `key`'s last refused write, or `null` once cleared/never failed. */
  errorFor(key: string): string | null {
    return this.#errors[key] ?? null;
  }

  /** REQ-CFG-042/073: record the reason a write for `key` was refused. */
  setError(key: string, message: string): void {
    this.#errors = { ...this.#errors, [key]: message };
  }

  /** A confirmed write for `key` clears any refusal it previously carried. */
  clearError(key: string): void {
    if (!(key in this.#errors)) return;
    const { [key]: _removed, ...next } = this.#errors;
    this.#errors = next;
  }
}
