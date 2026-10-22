/**
 * Chat command parser — pure parsing of user input into typed command structs.
 *
 * Implements REQ-ROL-020 and REQ-CHT-013..015.
 * Runs on both client (for UX) and server (authoritative validation).
 * No RNG here — parsing only.
 */

import { type RollMode } from "./types.js";

// ---------------------------------------------------------------------------
// Inline roll span — REQ-ROL-017..018
// ---------------------------------------------------------------------------

/**
 * An inline roll expression extracted from text.
 * `[[formula]]` → type: "immediate"
 * `[[/r formula]]` etc. → type: "deferred"
 */
export interface InlineRollSpan {
  /** Character offset (inclusive) of the `[[` in the source string. */
  start: number;
  /** Character offset (exclusive) of the `]]` end in the source string. */
  end: number;
  /** The formula string inside the brackets (trimmed). */
  formula: string;
  /** Immediate = evaluate now; deferred = button rendered for user to click. */
  kind: "immediate" | "deferred";
  /** For deferred rolls, the explicit roll mode (default "public"). */
  mode: RollMode;
}

// ---------------------------------------------------------------------------
// Parsed command results
// ---------------------------------------------------------------------------

/** A roll command: /roll, /r, /gmroll, etc. */
export interface ParsedRollCommand {
  kind: "roll";
  formula: string;
  mode: RollMode;
}

/** A whisper command: /w [targets] message */
export interface ParsedWhisperCommand {
  kind: "whisper";
  /**
   * Target specifiers — raw strings.
   * May be usernames, "gm", or "players".
   * Server resolves to actual User IDs.
   */
  targets: string[];
  message: string;
}

/** An emote command: /emote, /em, /me */
export interface ParsedEmoteCommand {
  kind: "emote";
  message: string;
}

/** An in-character message: /ic */
export interface ParsedInCharacterCommand {
  kind: "ic";
  message: string;
}

/** An out-of-character message: /ooc */
export interface ParsedOutOfCharacterCommand {
  kind: "ooc";
  message: string;
}

/**
 * Plain text with no recognized command prefix.
 * The server will also scan `inlineRolls` and evaluate them.
 */
export interface ParsedPlainText {
  kind: "text";
  content: string;
  inlineRolls: InlineRollSpan[];
}

export type ParsedChatCommand =
  | ParsedRollCommand
  | ParsedWhisperCommand
  | ParsedEmoteCommand
  | ParsedInCharacterCommand
  | ParsedOutOfCharacterCommand
  | ParsedPlainText;

// ---------------------------------------------------------------------------
// Roll prefix table — REQ-ROL-020, REQ-CHT-013
// ---------------------------------------------------------------------------

/**
 * Maps recognized command prefixes to their roll mode.
 * Prefixes are compared case-insensitively after stripping the leading `/`.
 *
 * Canonical aliases per spec-09 REQ-CHT-013 / REQ-ROL-020:
 *   /roll, /r           → public
 *   /gmroll, /gmr       → gmroll
 *   /blindroll, /br     → blindroll
 *   /selfroll, /sr      → selfroll
 *
 * Additional aliases kept for convenience (superset of spec; intentional):
 *   /publicroll, /pr    → public   (explicit public alias)
 */
const ROLL_PREFIXES: ReadonlyArray<readonly [string, RollMode]> = [
  ["roll", "public"],
  ["r", "public"],
  ["publicroll", "public"],
  ["pr", "public"],
  ["gmroll", "gmroll"],
  ["gmr", "gmroll"],
  ["blindroll", "blindroll"],
  ["br", "blindroll"],
  ["selfroll", "selfroll"],
  ["sr", "selfroll"],
];

// Sort longest first to avoid prefix shadowing (e.g. "br" vs "blindroll")
const SORTED_ROLL_PREFIXES = [...ROLL_PREFIXES].sort(([a], [b]) => b.length - a.length);

const EMOTE_PREFIXES = new Set(["emote", "em", "me", "e"]);
const IC_PREFIXES = new Set(["ic"]);
const OOC_PREFIXES = new Set(["ooc"]);
const WHISPER_PREFIXES = new Set(["w", "whisper"]);

// ---------------------------------------------------------------------------
// Inline roll extraction — REQ-ROL-017..018
// ---------------------------------------------------------------------------

/**
 * Maps deferred roll command prefixes to RollMode.
 * Mirrors ROLL_PREFIXES — kept in sync manually (spec-09 REQ-CHT-013).
 */
const DEFERRED_MODES: Record<string, RollMode> = {
  r: "public",
  roll: "public",
  pr: "public",
  publicroll: "public",
  gmroll: "gmroll",
  gmr: "gmroll",
  blindroll: "blindroll",
  br: "blindroll",
  selfroll: "selfroll",
  sr: "selfroll",
};

/**
 * Extract all `[[...]]` spans from a text string.
 * Handles both immediate `[[formula]]` and deferred `[[/cmd formula]]`.
 *
 * REQ-ROL-017..018.
 */
export function extractInlineRolls(text: string): InlineRollSpan[] {
  const spans: InlineRollSpan[] = [];
  // Pattern: [[ ... ]] — non-greedy
  const pattern = /\[\[(.+?)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const inner = (match[1] ?? "").trim();
    const start = match.index;
    const end = match.index + match[0].length;

    // Check for deferred roll: [[/cmd formula]]
    if (inner.startsWith("/")) {
      const spaceIdx = inner.indexOf(" ");
      if (spaceIdx === -1) {
        // [[/cmd]] with no formula — skip
        continue;
      }
      const cmd = inner.slice(1, spaceIdx).toLowerCase();
      const formula = inner.slice(spaceIdx + 1).trim();
      const mode: RollMode = DEFERRED_MODES[cmd] ?? "public";
      spans.push({ start, end, formula, kind: "deferred", mode });
    } else {
      // Immediate inline roll
      spans.push({ start, end, formula: inner, kind: "immediate", mode: "public" });
    }
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Whisper target parsing — REQ-CHT-014
// ---------------------------------------------------------------------------

/**
 * Parse the part of a whisper after the command into targets + message.
 *
 * Three forms, tried in order (REQ-CHT-014):
 *   1. `[Name1, Name2] message` — the spec's bracket list.
 *   2. `"Nome Composto" message` — one quoted target, spaces allowed.
 *   3. `Nome Composto message` — no delimiters: the longest of `knownNames`
 *      (case-insensitive, whole words) that starts the text, or the keywords
 *      `gm`/`players`; with no such match, the first word. Matching the longest
 *      known name is what lets a compound user name ("Huo Jinwu") be whispered
 *      to without quotes.
 *
 * Returns null only when there is no target at all or a bracket/quote is left
 * open. A whisper must never degrade into public text because of how the name
 * was typed: an unknown target is still returned, and the server refuses it
 * by name (WHISPER_TARGET_NOT_FOUND).
 */
function parseWhisperPart(
  rest: string,
  knownNames: readonly string[],
): { targets: string[]; message: string } | null {
  const trimmed = rest.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx === -1) return null;
    const targets = trimmed
      .slice(1, closeIdx)
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (targets.length === 0) return null;
    return { targets, message: trimmed.slice(closeIdx + 1).trim() };
  }

  if (trimmed.startsWith('"')) {
    const closeIdx = trimmed.indexOf('"', 1);
    if (closeIdx === -1) return null;
    const target = trimmed.slice(1, closeIdx).trim();
    if (target === "") return null;
    return { targets: [target], message: trimmed.slice(closeIdx + 1).trim() };
  }

  const lower = trimmed.toLowerCase();
  let best: string | null = null;
  for (const name of [...knownNames, "gm", "players"]) {
    const candidate = name.trim();
    if (candidate === "" || (best !== null && candidate.length <= best.length)) continue;
    if (!lower.startsWith(candidate.toLowerCase())) continue;
    const next = trimmed.charAt(candidate.length);
    if (next !== "" && !/\s/.test(next)) continue;
    best = candidate;
  }
  if (best !== null) {
    // The canonical spelling of the known name, not what was typed.
    return { targets: [best], message: trimmed.slice(best.length).trim() };
  }

  const spaceIdx = trimmed.search(/\s/);
  return spaceIdx === -1
    ? { targets: [trimmed], message: "" }
    : { targets: [trimmed.slice(0, spaceIdx)], message: trimmed.slice(spaceIdx + 1).trim() };
}

/** Context the parser cannot know by itself. */
export interface ParseChatCommandOptions {
  /**
   * Names a whisper may be addressed to without brackets or quotes (the
   * world's user names). The server passes them; a caller without them still
   * gets a whisper, addressed to the first word.
   */
  knownNames?: readonly string[];
}

// ---------------------------------------------------------------------------
// Main parser — REQ-CHT-013
// ---------------------------------------------------------------------------

/**
 * Parse a raw chat input string into a typed command.
 *
 * Rules:
 * - If the string starts with `/`, extract the prefix and route to the
 *   appropriate command type.
 * - Unrecognized `/cmd` is returned as ParsedPlainText so the server can
 *   check the CommandRegistry.
 * - Otherwise, extract inline rolls and return ParsedPlainText.
 *
 * This function is pure and side-effect free — no RNG, no I/O.
 */
export function parseChatCommand(
  input: string,
  options: ParseChatCommandOptions = {},
): ParsedChatCommand {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    // Plain text — scan for inline rolls
    return {
      kind: "text",
      content: trimmed,
      inlineRolls: extractInlineRolls(trimmed),
    };
  }

  // Extract command prefix (up to first whitespace)
  const spaceIdx = trimmed.indexOf(" ");
  const prefixRaw = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const prefix = prefixRaw.toLowerCase();
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  // --- Roll commands ---
  for (const [cmd, mode] of SORTED_ROLL_PREFIXES) {
    if (prefix === cmd) {
      return {
        kind: "roll",
        formula: rest.trim(),
        mode,
      };
    }
  }

  // --- Whisper ---
  if (WHISPER_PREFIXES.has(prefix)) {
    const parsed = parseWhisperPart(rest, options.knownNames ?? []);
    if (parsed) {
      return {
        kind: "whisper",
        targets: parsed.targets,
        message: parsed.message,
      };
    }
    // Malformed whisper — fall through to text
  }

  // --- Emote ---
  if (EMOTE_PREFIXES.has(prefix)) {
    return { kind: "emote", message: rest.trim() };
  }

  // --- In-character ---
  if (IC_PREFIXES.has(prefix)) {
    return { kind: "ic", message: rest.trim() };
  }

  // --- Out-of-character ---
  if (OOC_PREFIXES.has(prefix)) {
    return { kind: "ooc", message: rest.trim() };
  }

  // Unrecognized command — return as plain text (server checks CommandRegistry)
  return {
    kind: "text",
    content: trimmed,
    inlineRolls: [],
  };
}
