/**
 * composeBox.ts — the rules of the write box, outside the component (plan G033).
 *
 * Spec 38 §5.4. Three behaviours the box promises are decisions, not markup, so they live
 * here where a test can reach them without a DOM:
 *  - how tall the box is for a given text (REQ-ACH-031: one line, growing to five, then
 *    scrolling);
 *  - what a keypress means (REQ-ACH-032: Enter sends, Shift+Enter breaks the line, ↑↓ walk
 *    the history);
 *  - what sending does (REQ-ACH-033/034: the typed line goes to the server verbatim, with
 *    no local RNG, and afterwards the box is empty and the log is at its end).
 */

import type { ChatSendPayload, RollMode } from "@fusion/shared";
import { buildChatSendPayload } from "./resolveRollMode.js";
import { chatSession } from "./chatStore.svelte.js";
import { scrollLogToEnd } from "./logScroller.js";
import type { InputHistory } from "./inputHistory.js";

/** The box never grows past this; after it, the text scrolls (REQ-ACH-031). */
export const MAX_COMPOSE_ROWS = 5;
export const MIN_COMPOSE_ROWS = 1;

/**
 * Rows the box should claim for `text`.
 *
 * Counts hard line breaks only. Soft wrapping depends on the rendered width, which no
 * pure function can know; the element's own `scrollHeight` refines it at runtime, and this
 * is the value that is right on the server render and on the first paint.
 */
export function computeComposeRows(text: string, maxRows: number = MAX_COMPOSE_ROWS): number {
  const lines = text.length === 0 ? 1 : text.split("\n").length;
  return Math.min(Math.max(lines, MIN_COMPOSE_ROWS), Math.max(maxRows, MIN_COMPOSE_ROWS));
}

/**
 * Rows for an element that already knows how tall its content is — used after mount to
 * account for soft wrapping. `lineHeight` and `contentHeight` are px.
 */
export function rowsForContentHeight(
  contentHeight: number,
  lineHeight: number,
  maxRows: number = MAX_COMPOSE_ROWS,
): number {
  if (lineHeight <= 0) return MIN_COMPOSE_ROWS;
  const rows = Math.ceil(contentHeight / lineHeight);
  return Math.min(Math.max(rows, MIN_COMPOSE_ROWS), Math.max(maxRows, MIN_COMPOSE_ROWS));
}

export type ComposeKeyAction = "send" | "newline" | "history-up" | "history-down" | "none";

export interface ComposeKeyEvent {
  readonly key: string;
  readonly shiftKey?: boolean;
  /** True while an IME candidate window is open; Enter then belongs to the IME. */
  readonly isComposing?: boolean;
}

/**
 * What a keypress in the box means (REQ-ACH-032).
 *
 * `"newline"` is returned rather than `"none"` for Shift+Enter on purpose: the caller must
 * know the difference between "I am not handling this" and "let the browser insert the
 * break", and only the first may be swallowed.
 */
export function resolveComposeKey(event: ComposeKeyEvent): ComposeKeyAction {
  if (event.isComposing === true) return "none";
  if (event.key === "Enter") return event.shiftKey === true ? "newline" : "send";
  if (event.key === "ArrowUp") return "history-up";
  if (event.key === "ArrowDown") return "history-down";
  return "none";
}

export interface SubmitChatLineInput {
  /** Exactly what the user typed. */
  readonly text: string;
  readonly worldId: string;
  /** Current value of the roll mode selector (REQ-ACH-042). */
  readonly selectorMode: RollMode;
  readonly send: (payload: ChatSendPayload) => void | Promise<void>;
  /** Session-scoped ↑↓ history (REQ-ACH-026). */
  readonly history: InputHistory;
}

/**
 * Send the typed line.
 *
 * The content travels to the server EXACTLY as typed — commands included (REQ-ACH-033).
 * Nothing here parses `/roll`, and nothing here rolls: the RNG is the server's
 * (REQ-ROL-020/024), and a client that pre-computed a total would be a client that could
 * choose one. Who sees the result is decided in one place too — `resolveRollMode`.
 *
 * Returns false when there was nothing to send.
 */
export async function submitChatLine(input: SubmitChatLineInput): Promise<boolean> {
  const text = input.text.trim();
  if (text.length === 0) return false;

  const payload = buildChatSendPayload({
    content: text,
    worldId: input.worldId,
    selectorMode: input.selectorMode,
  });

  await input.send(payload);

  input.history.push(text);
  // REQ-ACH-034: the box is empty and the log is at its end — in that order, so a failed
  // send (which threw above) leaves the text where the user can try again.
  chatSession.draft = "";
  scrollLogToEnd();
  return true;
}
