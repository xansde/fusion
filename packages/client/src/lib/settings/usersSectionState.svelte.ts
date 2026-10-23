/**
 * usersSectionState.svelte.ts — the list↔create↔edit machine INSIDE the
 * "Usuários" section (spec 37 §5.6, G105).
 *
 * Mirrors `settingsNav.svelte.ts`'s `SettingsNav`: a class with `$state`
 * fields, injectable into `UsersSection.svelte` as an optional prop
 * (defaulting to a fresh instance per mount, same as `nav` on
 * `SettingsTab.svelte`), so tests can pre-open a view before a
 * `svelte/server` render without simulating a click. This is a SECOND,
 * section-local navigation level, never a floating window (DEC-CFG-04) —
 * `UsersSection.svelte` is the only thing that ever reads it, and it never
 * substitutes `SettingsNav`'s own index↔section slot.
 *
 * `resetReveal` is REQ-CFG-053's one-time password: set right after a
 * successful reset, and cleared the moment the section moves away from that
 * user (`openCreate`, `openEdit`, `backToList`) — there is no code path that
 * reads it again afterwards, which is what "não deve ser recuperável depois
 * de sair da tela" means structurally, not just as a UI convention.
 */

export type UsersSectionView =
  | { readonly kind: "list" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly userId: string };

export interface ResetPasswordReveal {
  readonly userId: string;
  readonly userName: string;
  /** REQ-CFG-053's plaintext, or `null` for a passwordless reset. */
  readonly password: string | null;
}

export class UsersSectionState {
  #view: UsersSectionView = $state({ kind: "list" });
  #resetReveal: ResetPasswordReveal | null = $state(null);

  get view(): UsersSectionView {
    return this.#view;
  }

  get resetReveal(): ResetPasswordReveal | null {
    return this.#resetReveal;
  }

  /** REQ-CFG-051: the create form (stacked fields, same panel — DEC-CFG-04). */
  openCreate(): void {
    this.#view = { kind: "create" };
    this.#resetReveal = null;
  }

  /** REQ-CFG-052: the edit form for one user, stacked fields, same panel. */
  openEdit(userId: string): void {
    this.#view = { kind: "edit", userId };
    this.#resetReveal = null;
  }

  /** Back to the plain list — also the point past which a reset reveal is gone for good. */
  backToList(): void {
    this.#view = { kind: "list" };
    this.#resetReveal = null;
  }

  /** REQ-CFG-053: show a freshly reset password exactly once. */
  showResetReveal(reveal: ResetPasswordReveal): void {
    this.#resetReveal = reveal;
  }

  /** Explicit dismissal (the reveal's own "fechar"), same effect as navigating away. */
  clearResetReveal(): void {
    this.#resetReveal = null;
  }
}
