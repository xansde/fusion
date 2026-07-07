/**
 * dialogs.svelte.ts — Modal dialog helpers (Promise-based).
 *
 * Implements REQ-UIF-027..030 from spec 11-ui-framework-e-fichas.md.
 *
 * Dialogs use the native <dialog> element with .showModal() as decided in
 * DEC-UIF-02: free focus trap, Escape-to-close and backdrop from the platform.
 *
 * API:
 *   confirm(message, opts?) → Promise<boolean>
 *   prompt(message, defaultValue?, opts?) → Promise<string | null>
 *
 * The actual DOM is managed by ConfirmDialog.svelte / PromptDialog.svelte.
 * This module only holds the imperative bridge: it pushes a "pending dialog"
 * onto the reactive queue so the host can mount the component, and the
 * component resolves/rejects the promise when the user acts.
 *
 * Reactivity (r21-Y1): `pendingDialogs` is a Svelte 5 `$state` array, so
 * WindowHost re-renders the modal layer the instant a dialog is pushed or
 * removed — no rAF polling. `$state` is a compiler rune, hence the `.svelte.ts`
 * extension. The array is never reassigned (only mutated via push/splice), so
 * exporting it is allowed.
 */

// ---------------------------------------------------------------------------
// Internal pending-dialog queue
// ---------------------------------------------------------------------------

export type DialogKind = "confirm" | "prompt";

export interface PendingConfirm {
  kind: "confirm";
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: boolean) => void;
}

export interface PendingPrompt {
  kind: "prompt";
  message: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: string | null) => void;
}

export type PendingDialog = PendingConfirm | PendingPrompt;

/**
 * Reactive list of pending dialogs — consumed by the <DialogHost> component
 * (rendered in WindowHost.svelte).
 *
 * External code should NOT mutate this directly; use the `confirm` / `prompt`
 * functions below.
 */
export const pendingDialogs: PendingDialog[] = $state([]);

/**
 * Remove a resolved dialog from the queue.
 * Called by the Svelte dialog components after settling.
 */
export function removePendingDialog(dialog: PendingDialog): void {
  const idx = pendingDialogs.indexOf(dialog);
  if (idx !== -1) pendingDialogs.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Show a modal confirmation dialog.
 * Returns `true` if the user confirmed, `false` if cancelled or Escape.
 *
 * REQ-UIF-027
 */
export function confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const pending: PendingConfirm = {
      kind: "confirm",
      message,
      confirmLabel: opts.confirmLabel ?? "Confirmar",
      cancelLabel: opts.cancelLabel ?? "Cancelar",
      resolve,
    };
    pendingDialogs.push(pending);
  });
}

export interface PromptOptions {
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Show a modal prompt dialog with a text input.
 * Returns the entered string if confirmed, `null` if cancelled or Escape.
 *
 * REQ-UIF-028 / REQ-UIF-029
 */
export function prompt(
  message: string,
  defaultValue = "",
  opts: PromptOptions = {},
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const pending: PendingPrompt = {
      kind: "prompt",
      message,
      defaultValue,
      confirmLabel: opts.confirmLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancelar",
      resolve,
    };
    pendingDialogs.push(pending);
  });
}

/** Namespace export matching the spec's `Dialog.confirm` / `Dialog.prompt` API. */
export const Dialog = { confirm, prompt } as const;
