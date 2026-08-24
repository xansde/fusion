/**
 * chatCardExtensionRegistry.svelte.ts — pluggable "special chat card" resolver
 * (F3, DEC-SEP-02).
 *
 * `ChatMessage.svelte` renders the plain declarative `ChatCard` (message.card)
 * out of the box, but a system can want a richer, interactive card for its own
 * message shape (PF2e's ability card, `flags.pf2e.abilityCard` /
 * legacy `flags.pf2e.spellCast` — see `systems/pf2e`'s registration). The core
 * chat component cannot import a system's Svelte component directly (that
 * would defeat the whole point of F3's boundary), so this is where a system
 * plugs its recognizer + component in instead — the same shape as
 * `sheetRegistry`, except keyed by "does this message match?" rather than by
 * (documentType, subtype).
 *
 * Registration order matters only in the pathological case of two systems
 * both claiming the same message; first match wins. In practice exactly one
 * system is active per world.
 *
 * Reactive (`$state`) so a `ChatMessage` already mounted before
 * `registerPf2eSheets()` runs (boot ordering is not guaranteed) still picks
 * up the extension on the next render, mirroring `conditionRegistry`'s /
 * `footprintRegistry`'s fail-open + late-registration behaviour.
 */

import type { ChatMessage as ChatMessageType } from "@fusion/shared";

/**
 * A Svelte 5 component constructor. `any`, matching `WindowEntry.component`
 * in `lib/windows/window-manager.ts` — dynamic-component typing in Svelte 5
 * templates (`{@const Comp = ...}` + `<Comp {...props} />`) needs the loose
 * type; the actual prop contract is enforced by the registering system.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatCardComponent = any;

export interface ChatCardExtension {
  /**
   * Recognize whether this message carries this extension's card shape and,
   * if so, return the card data to pass as the `card` prop. Returns `null`
   * when the message doesn't match (falls through to the next extension, or
   * to the plain text/roll rendering).
   */
  recognize(message: ChatMessageType): unknown;
  /** The Svelte component to mount with `{ card, messageId, worldId, socket, isGm, userId }`. */
  component: ChatCardComponent;
}

const registry = $state<{ extensions: readonly ChatCardExtension[] }>({ extensions: [] });

/** Register a chat card extension (called once at system boot). */
export function registerChatCardExtension(extension: ChatCardExtension): void {
  registry.extensions = [...registry.extensions, extension];
}

/**
 * Resolve the first extension that recognizes this message, or `null` when no
 * registered extension applies.
 */
export function resolveChatCardExtension(
  message: ChatMessageType,
): { component: ChatCardComponent; card: unknown } | null {
  for (const extension of registry.extensions) {
    const card = extension.recognize(message);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    if (card !== null) return { component: extension.component, card };
  }
  return null;
}

/** Forget every registration — tests only. */
export function resetChatCardExtensions(): void {
  registry.extensions = [];
}
