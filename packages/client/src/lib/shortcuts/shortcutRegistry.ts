/**
 * shortcutRegistry.ts — the central registry of keyboard shortcuts, in its smallest form
 * (BAR-F1-05; spec 53 REQ-BAR-048..051; spec 23 REQ-A11-020, REQ-A11-023).
 *
 * The beginning of the `KeybindingRegistry` of REQ-A11-020, not a second one: shortcuts are NAMED
 * actions bound to fixed default keys, registered here and dispatched from one place — so the
 * contextual suspension of REQ-A11-023 has one implementation, and a remapping panel ([V2]) will
 * have somewhere to hook in. Today only the action bar registers (the 12 favourite keys and Esc);
 * the canvas keeps its own `window` listener in `TokenInteractionManager`, and nothing here changes
 * what that one does.
 *
 * **The guard** ({@link shouldSuspendShortcut}) is what makes a key safe to bind. A number key must
 * never run a roll because it was typed into the chat (the risk "rolagem pública indesejada", plan
 * §9), so a shortcut is suspended when the focus is in a text field, a textarea, a select, a
 * `contenteditable`, inside a dialog, or on a button or a link (REQ-BAR-049) — and with Ctrl, Alt or
 * Meta held (browser and system shortcuts), while an IME is composing, or when another handler has
 * already consumed the key. A held key (`repeat`) runs its action once.
 *
 * The guard is the registry's OWN. For "is this a text field?" it asks `isEditableTarget` and does
 * not touch it: that function is, on purpose, only "a field where you type" — a focused checkbox or
 * button is NOT one — because the token's keyboard alternatives (Backspace, the arrows, KeyD) must
 * keep working with a button of the drawer focused (REQ-A11-036, P2 of #194). Widening it would
 * change the canvas. So the extra targets (buttons, links, dialogs, ARIA widgets) live here.
 *
 * Pure and structurally typed like `isEscapeForSomethingElse` (§2.10): the event and the document
 * are minimal objects, so the whole matrix of key × focused element is tested without a DOM.
 */

import { isEditableTarget } from "../canvas/tokens/token-interaction.js";

// ---------------------------------------------------------------------------
// The structural types
// ---------------------------------------------------------------------------

/** The part of a `KeyboardEvent` the registry reads. */
export interface ShortcutKeyEvent {
  /** The physical key (`KeyboardEvent.code`): a shortcut answers to the position, not the character. */
  readonly code: string;
  readonly key?: string | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly metaKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  /** The key is being held down. */
  readonly repeat?: boolean | undefined;
  readonly isComposing?: boolean | undefined;
  /** Another handler already consumed the key. */
  readonly defaultPrevented?: boolean | undefined;
  readonly target?: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

/** The part of `document` the guard reads. */
export interface ShortcutDocument {
  readonly activeElement?: unknown;
}

/** A named action bound to fixed default keys. */
export interface ShortcutDefinition {
  /** The name of the action ("actionbar.favorite.1"). Unique by convention, not enforced. */
  readonly id: string;
  /** `KeyboardEvent.code` values that trigger it. */
  readonly codes: readonly string[];
  /**
   * Runs the action. Return `true` when it did something — the key is then consumed — and `false`
   * when it was not for this action (nothing to run, nothing to cancel): the key goes on.
   */
  run(event: ShortcutKeyEvent): boolean;
}

/** Where the registry listens: `window`, or a double in a test. */
export interface ShortcutListenerTarget {
  addEventListener(type: "keydown", handler: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", handler: (event: KeyboardEvent) => void): void;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** Elements that take the keyboard for themselves while focused. */
const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "A",
  "SUMMARY",
]);

/** ARIA roles of widgets that take the keyboard for themselves. */
const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
  "combobox",
  "option",
]);

const DIALOG_SELECTOR = 'dialog, [role="dialog"], [role="alertdialog"]';

interface ElementLike {
  tagName?: unknown;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

/** Whether the keyboard belongs to this element: a field, a control, or anything inside a dialog. */
function takesTheKeyboard(target: unknown): boolean {
  if (target === null || target === undefined || typeof target !== "object") return false;
  // The canvas shortcuts' own definition of "a field where you type" — asked, never widened.
  if (isEditableTarget(target)) return true;

  const element = target as ElementLike;
  if (typeof element.tagName === "string" && INTERACTIVE_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }
  const role = typeof element.getAttribute === "function" ? element.getAttribute("role") : null;
  if (role !== null && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

  return typeof element.closest === "function" && element.closest(DIALOG_SELECTOR) != null;
}

/**
 * Whether a shortcut must stand down for this key press (REQ-BAR-049, REQ-A11-023).
 *
 * Both the event's target and the document's active element are looked at: a key press is aimed at
 * the focused element, and either one saying "this takes the keyboard" is enough.
 */
export function shouldSuspendShortcut(event: ShortcutKeyEvent, doc?: ShortcutDocument): boolean {
  if (event.isComposing === true) return true;
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true) return true;
  if (event.defaultPrevented === true) return true;
  if (takesTheKeyboard(event.target)) return true;
  return doc !== undefined && takesTheKeyboard(doc.activeElement);
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface ShortcutRegistry {
  /** Registers an action; returns the function that takes it out again. */
  register(definition: ShortcutDefinition): () => void;
  /**
   * Hands a key press to the actions bound to its key. Returns `true` when one of them handled it,
   * in which case the event has been consumed (`preventDefault` and `stopPropagation`).
   */
  dispatch(event: ShortcutKeyEvent, doc?: ShortcutDocument): boolean;
  /** How many actions are registered. */
  size(): number;
}

export interface ShortcutRegistryOptions {
  /** Where to listen for `keydown`; `null` listens nowhere. Defaults to `window`, when there is one. */
  target?: ShortcutListenerTarget | null;
  /** The document the guard reads when `dispatch` is given none. Defaults to the page's. */
  document?: ShortcutDocument | undefined;
}

function pageWindow(): ShortcutListenerTarget | null {
  return typeof window === "undefined" ? null : window;
}

function pageDocument(): ShortcutDocument | undefined {
  return typeof document === "undefined" ? undefined : document;
}

export function createShortcutRegistry(options: ShortcutRegistryOptions = {}): ShortcutRegistry {
  const definitions: ShortcutDefinition[] = [];
  const target = options.target === undefined ? pageWindow() : options.target;

  function dispatch(event: ShortcutKeyEvent, doc?: ShortcutDocument): boolean {
    const matching = definitions.filter((definition) => definition.codes.includes(event.code));
    if (matching.length === 0) return false;
    if (shouldSuspendShortcut(event, doc ?? options.document ?? pageDocument())) return false;
    // A held key runs its action once.
    if (event.repeat === true) return false;

    for (const definition of matching) {
      let handled = false;
      try {
        handled = definition.run(event);
      } catch (error) {
        // One broken action must not silence the others, nor the next key.
        console.error(`[shortcuts] "${definition.id}" failed`, error);
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    }
    return false;
  }

  // One listener for all the actions, alive only while there is something to hear it.
  const listener = (event: KeyboardEvent): void => {
    dispatch(event);
  };
  let listening = false;

  function sync(): void {
    if (target === null) return;
    if (definitions.length > 0 && !listening) {
      target.addEventListener("keydown", listener);
      listening = true;
    } else if (definitions.length === 0 && listening) {
      target.removeEventListener("keydown", listener);
      listening = false;
    }
  }

  return {
    register(definition) {
      definitions.push(definition);
      sync();
      return () => {
        const index = definitions.indexOf(definition);
        if (index === -1) return;
        definitions.splice(index, 1);
        sync();
      };
    },
    dispatch,
    size: () => definitions.length,
  };
}

// ---------------------------------------------------------------------------
// The application's registry
// ---------------------------------------------------------------------------

/** The one registry of the app. */
export const shortcutRegistry: ShortcutRegistry = createShortcutRegistry();

/** Registers an action in the app's registry (`REQ-A11-020`): `registerShortcut(def): () => void`. */
export function registerShortcut(definition: ShortcutDefinition): () => void {
  return shortcutRegistry.register(definition);
}

/** Hands a key press to the app's registry; `true` when an action handled and consumed it. */
export function dispatchShortcut(event: ShortcutKeyEvent, doc?: ShortcutDocument): boolean {
  return shortcutRegistry.dispatch(event, doc);
}
