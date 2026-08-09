/**
 * commandBar.ts — the keyboard contract behind the Hub's command bar.
 *
 * The command bar is the System Window's spine: a strip at the bottom of the
 * viewport with one button per panel, each bound to a single key. Design source
 * is the interactive prototype in `docs/design/prototipo-log-missoes.html`
 * (`Missões [Q]` / `Comitiva [C]` / `Mapa [M]`), itself derived from Mario's
 * "System Window" mockup for the Isekai-Companion.
 *
 * Everything here is a pure function over a structural event, deliberately.
 * The client runs Vitest with `environment: "node"`, so a reducer that reached
 * for `KeyboardEvent` or `HTMLElement` would be untestable — and this is the
 * one piece of the Hub that *must* be tested, because a shortcut that fires
 * while someone types in the chat is indistinguishable from a haunted UI.
 *
 * `CommandBar.svelte` is the only intended caller: it resolves the intent,
 * calls `preventDefault()` when there is one, and reduces the active panel.
 */

/** One entry of the command bar. */
export interface HubPanel {
  /** Stable identifier. English, like every identifier in this repo. */
  readonly id: string;
  /** What the player reads on the button — pt-BR. */
  readonly label: string;
  /** Single lowercase character that opens (and re-closes) the panel. */
  readonly key: string;
}

/**
 * The panels the prototype settled on, in bar order.
 *
 * Kept here rather than in the component so the ordering and the key bindings
 * are covered by tests. Content for each panel lands with specs 28 (Hub) and
 * 34 (mapa de região); this module only owns *reaching* them.
 */
export const HUB_PANELS: readonly HubPanel[] = [
  { id: "missions", label: "Missões", key: "q" },
  { id: "party", label: "Comitiva", key: "c" },
  { id: "map", label: "Mapa", key: "m" },
] as const;

/** The key that dismisses whatever panel is open. */
export const HUB_CLOSE_KEY = "Escape";

/** What a keystroke asks the Hub to do. `null` means "not ours". */
export type ShortcutIntent = { kind: "panel"; panelId: string } | { kind: "close" };

/** The shape `resolveShortcut` needs from a `KeyboardEvent`. */
export interface ShortcutEvent {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: unknown;
}

/** Elements whose whole job is to swallow letters. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when a keystroke aimed at `target` is text entry, not a command.
 *
 * `unknown` rather than `EventTarget` on purpose: the DOM types the target as
 * `EventTarget`, which carries neither `tagName` nor `isContentEditable`, so a
 * narrower parameter would force a cast at every call site — including the
 * tests, where the target is a plain object.
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };

  // TipTap (chat, journal) edits a contenteditable div, not a form control, so
  // the tag check alone would let `q` through mid-sentence.
  if (el.isContentEditable === true) return true;

  // Uppercase in HTML documents, lowercase in XML ones.
  return typeof el.tagName === "string" && TYPING_TAGS.has(el.tagName.toUpperCase());
}

/** The panel bound to `key`, case-insensitively, or `undefined`. */
export function panelByKey(key: string, panels: readonly HubPanel[] = HUB_PANELS) {
  const wanted = key.toLowerCase();
  return panels.find((panel) => panel.key.toLowerCase() === wanted);
}

/**
 * Translate a keystroke into a Hub intent, or `null` to leave the event alone.
 *
 * Order matters: Escape survives a typing target (it is the universal way out,
 * and a field that wants it can stop propagation first), while a panel key does
 * not.
 */
export function resolveShortcut(
  event: ShortcutEvent,
  panels: readonly HubPanel[] = HUB_PANELS,
): ShortcutIntent | null {
  // Ctrl / Cmd / Alt combinations belong to the browser and the OS.
  // Shift is not in this list: `Q` is simply how you type `q` with caps lock on.
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;

  if (event.key === HUB_CLOSE_KEY) return { kind: "close" };

  if (isTypingTarget(event.target)) return null;

  const panel = panelByKey(event.key, panels);
  return panel ? { kind: "panel", panelId: panel.id } : null;
}

/**
 * Reduce the active panel against an intent.
 *
 * Pressing a panel's own key again closes it. This diverges from the prototype,
 * where a panel is always open because the page *is* the Hub. Here the Hub
 * floats over the canvas: the key that summoned a window has to dismiss it, or
 * the only way back to the map would be opening some other window.
 */
export function applyShortcut(active: string | null, intent: ShortcutIntent | null): string | null {
  if (intent === null) return active;
  if (intent.kind === "close") return null;
  return intent.panelId === active ? null : intent.panelId;
}
