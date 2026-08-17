/**
 * worldSectionState.svelte.ts — per-row write-failure state for the "Mundo"
 * section (spec 37 §5.4, G102, REQ-CFG-073).
 *
 * Mirrors `UsersSectionState`: a class with a `$state` field, injectable
 * into `WorldSection.svelte` as an optional prop (defaulting to a fresh
 * instance per mount, same as `flow` on `UsersSection.svelte`), so tests can
 * pre-seed a refusal before a `svelte/server` render without simulating a
 * change event.
 *
 * Keyed by `row.key` (never a system id or a setting-specific branch,
 * REQ-CFG-031) — each row's last write failure, cleared the moment a write
 * for that same key is confirmed by the server.
 */

export class WorldSectionState {
  #errors: Record<string, string> = $state({});

  /** The message of `key`'s last refused write, or `null` once cleared/never failed. */
  errorFor(key: string): string | null {
    return this.#errors[key] ?? null;
  }

  /** REQ-CFG-073: record the reason a write for `key` was refused. */
  setError(key: string, message: string): void {
    this.#errors = { ...this.#errors, [key]: message };
  }

  /** A confirmed write for `key` clears any refusal it previously carried. */
  clearError(key: string): void {
    if (!(key in this.#errors)) return;
    const next = { ...this.#errors };
    delete next[key];
    this.#errors = next;
  }
}
