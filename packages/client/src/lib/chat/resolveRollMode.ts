/**
 * resolveRollMode.ts — one place decides the audience of a roll.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-04 and REQ-ACH-042..045, which rewrite
 * REQ-CHT-017 of spec 09 (`/roll` no longer means "always public" — it names no mode, so
 * it obeys the selector like every other roll).
 *
 * Precedence, strongest first:
 *   1. a command that NAMES the mode (`/gmroll`, `/blindroll`, `/selfroll`) — for that one
 *      message only, and it never moves the selector (REQ-ACH-043);
 *   2. a favorite with a locked mode (REQ-ACH-044, DEC-ACH-05);
 *   3. the selector (REQ-ACH-042).
 *
 * And a rule that is NOT about rolls at all: the selector never changes the visibility of
 * TEXT (REQ-ACH-045). Text with no command stays public; private text is `/w`.
 *
 * Why the payload sometimes has no `rollMode` at all
 * --------------------------------------------------
 * The server resolves `payload.rollMode ?? command.mode`
 * (`packages/server/src/chat/chat-handler.ts`). A client that echoed the selector into
 * `rollMode` would therefore OVERRULE `/gmroll` — the command would lose to the very thing
 * it is supposed to beat. So when the command names the mode, the payload deliberately
 * omits the key, and the server's own parse decides. That absence is the guarantee.
 *
 * Pure on purpose: no socket, no storage, no DOM. The chat box, the favorites tray, the
 * roll builder, sheets and cards all funnel through here, so "who sees this roll" has a
 * single answer everywhere.
 */

import { parseChatCommand } from "@fusion/shared";

import type { ChatSendFlags, ChatSendPayload, RollMode } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Which commands NAME a mode
// ---------------------------------------------------------------------------

/**
 * Command prefixes that state the audience out loud.
 *
 * `/roll` and `/r` are absent on purpose: they name no mode, which is exactly why
 * REQ-CHT-017 was rewritten to let them follow the selector. `/publicroll` and `/pr` ARE
 * here — an alias literally called "publicroll" states its audience, and letting it be
 * swallowed by a blind selector would be a trap.
 */
const MODE_NAMING_PREFIXES: ReadonlyMap<string, RollMode> = new Map<string, RollMode>([
  ["gmroll", "gmroll"],
  ["gmr", "gmroll"],
  ["blindroll", "blindroll"],
  ["br", "blindroll"],
  ["selfroll", "selfroll"],
  ["sr", "selfroll"],
  ["publicroll", "public"],
  ["pr", "public"],
]);

/**
 * The mode this input NAMES, or `null` when it names none (plain text, `/roll`, `/w`, an
 * emote, an unknown command).
 *
 * Only a roll command can name a mode: `/gmroll` inside a sentence is just text.
 */
export function commandRollMode(content: string): RollMode | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return null;
  if (parseChatCommand(trimmed).kind !== "roll") return null;

  const prefix = trimmed.slice(1).split(/\s/, 1)[0] ?? "";
  return MODE_NAMING_PREFIXES.get(prefix.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Which rung of the precedence ladder answered. `text` means "not a roll at all". */
export type RollModeSource = "command" | "favorite" | "selector" | "text";

/** What the client decided, and what it will (or will not) put in the payload. */
export interface RollModeDecision {
  /** The audience this message will actually reach. */
  readonly mode: RollMode;
  /** Which rule decided it — useful for UI hints, never for re-deciding. */
  readonly source: RollModeSource;
  /**
   * Value for `ChatSendPayload.rollMode`, or `undefined` when the payload must stay
   * silent so the server's own command parse wins (REQ-ACH-043, REQ-ACH-045).
   */
  readonly payloadRollMode: RollMode | undefined;
}

/** Input of {@link resolveRollMode} — plain data, no store and no component. */
export interface ResolveRollModeInput {
  /** Raw text about to be sent (a typed line, or a favorite's `/roll <formula>`). */
  readonly content: string;
  /** Current value of the roll mode selector (REQ-ACH-042). */
  readonly selectorMode: RollMode;
  /**
   * Locked mode of the favorite that fired this roll (REQ-ACH-044). `null`/absent means
   * "follows the selector", which is a favorite's other legal state (DEC-ACH-05).
   */
  readonly favoriteMode?: RollMode | null;
}

/**
 * Apply DEC-ACH-04's precedence to one outgoing message.
 *
 * Text is answered first and separately: a message with no roll command is public no
 * matter where the selector sits (REQ-ACH-045). Making the selector able to whisper text
 * would give two different meanings to one control, and `/w` already exists for that.
 */
export function resolveRollMode(input: ResolveRollModeInput): RollModeDecision {
  const { content, selectorMode, favoriteMode } = input;

  if (parseChatCommand(content.trim()).kind !== "roll") {
    return { mode: "public", source: "text", payloadRollMode: undefined };
  }

  const named = commandRollMode(content);
  if (named !== null) {
    // Deliberately no `payloadRollMode`: the server must read the command, not us.
    return { mode: named, source: "command", payloadRollMode: undefined };
  }

  if (favoriteMode !== undefined && favoriteMode !== null) {
    return { mode: favoriteMode, source: "favorite", payloadRollMode: favoriteMode };
  }

  return { mode: selectorMode, source: "selector", payloadRollMode: selectorMode };
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

/** Input of {@link buildChatSendPayload}. */
export interface BuildChatSendPayloadInput extends ResolveRollModeInput {
  readonly worldId: string;
  readonly speakerActorId?: string | undefined;
  readonly speakerTokenId?: string | undefined;
  readonly flags?: ChatSendFlags | undefined;
}

/**
 * Build the `chat:send` payload with the audience already decided (REQ-ACH-042..045).
 *
 * Every origin of a roll in this tab — the chat box, the favorites tray, the roll builder,
 * a sheet button, a card button — should go through here instead of setting `rollMode` by
 * hand, so none of them can quietly disagree about who sees the result.
 *
 * `rollMode` is OMITTED, not set to `undefined`, when the command names the mode: the key's
 * absence is what makes the server's `payload.rollMode ?? command.mode` fall through.
 */
export function buildChatSendPayload(input: BuildChatSendPayloadInput): ChatSendPayload {
  const decision = resolveRollMode(input);

  const payload: ChatSendPayload = { content: input.content, worldId: input.worldId };
  if (decision.payloadRollMode !== undefined) payload.rollMode = decision.payloadRollMode;
  if (input.speakerActorId !== undefined) payload.speakerActorId = input.speakerActorId;
  if (input.speakerTokenId !== undefined) payload.speakerTokenId = input.speakerTokenId;
  if (input.flags !== undefined) payload.flags = input.flags;

  return payload;
}
