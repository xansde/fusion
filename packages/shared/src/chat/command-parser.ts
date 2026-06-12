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
 * Parse whisper targets from the format `[Name1, Name2] message`.
 * Returns null if the format is invalid.
 */
function parseWhisperPart(rest: string): { targets: string[]; message: string } | null {
  const trimmed = rest.trim();
  if (!trimmed.startsWith("[")) {
    return null;
  }
  const closeIdx = trimmed.indexOf("]");
  if (closeIdx === -1) {
    return null;
  }
  const targetsPart = trimmed.slice(1, closeIdx);
  const targets = targetsPart
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (targets.length === 0) {
    return null;
  }
  const message = trimmed.slice(closeIdx + 1).trim();
  return { targets, message };
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
export function parseChatCommand(input: string): ParsedChatCommand {
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
    const parsed = parseWhisperPart(rest);
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
