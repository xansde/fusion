/**
 * Tests for the chat command parser (chat/command-parser.ts).
 *
 * Covers REQ-ROL-020, REQ-CHT-013..015.
 */

import { describe, it, expect } from "vitest";
import {
  parseChatCommand,
  extractInlineRolls,
  type ParsedRollCommand,
  type ParsedWhisperCommand,
  type ParsedEmoteCommand,
  type ParsedInCharacterCommand,
  type ParsedOutOfCharacterCommand,
  type ParsedPlainText,
} from "../chat/command-parser.js";

// ---------------------------------------------------------------------------
// Roll commands — REQ-ROL-020 / REQ-CHT-013
// ---------------------------------------------------------------------------

describe("parseChatCommand — roll commands", () => {
  // Canonical aliases from spec-09 REQ-CHT-013.
  // Note: /broll was removed — only /blindroll and /br are spec-canonical.
  const rollCases: Array<[string, string, string]> = [
    ["/roll 2d6+3", "public", "2d6+3"],
    ["/r 2d6+3", "public", "2d6+3"],
    ["/publicroll 1d20", "public", "1d20"],
    ["/pr 1d20", "public", "1d20"],
    ["/gmroll 1d20+5", "gmroll", "1d20+5"],
    ["/gmr 4d6", "gmroll", "4d6"],
    ["/blindroll 1d6", "blindroll", "1d6"],
    ["/br 1d6", "blindroll", "1d6"],
    ["/selfroll 1d100", "selfroll", "1d100"],
    ["/sr 1d100", "selfroll", "1d100"],
  ];

  for (const [input, expectedMode, expectedFormula] of rollCases) {
    it(`parses "${input}" as roll/${expectedMode}`, () => {
      const result = parseChatCommand(input) as ParsedRollCommand;
      expect(result.kind).toBe("roll");
      expect(result.mode).toBe(expectedMode);
      expect(result.formula).toBe(expectedFormula);
    });
  }

  it("captures formula with flavor suffix", () => {
    const result = parseChatCommand("/roll 1d20+5 # Attack") as ParsedRollCommand;
    expect(result.kind).toBe("roll");
    expect(result.formula).toBe("1d20+5 # Attack");
  });

  it("case-insensitive prefix matching", () => {
    const result = parseChatCommand("/ROLL 1d6") as ParsedRollCommand;
    expect(result.kind).toBe("roll");
    expect(result.mode).toBe("public");
  });

  it("empty formula string (no text after command)", () => {
    const result = parseChatCommand("/roll") as ParsedRollCommand;
    expect(result.kind).toBe("roll");
    expect(result.formula).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Whisper commands — REQ-CHT-013..014
// ---------------------------------------------------------------------------

describe("parseChatCommand — whisper commands", () => {
  it("parses /w with single target", () => {
    const result = parseChatCommand("/w [Alice] hello secret") as ParsedWhisperCommand;
    expect(result.kind).toBe("whisper");
    expect(result.targets).toEqual(["Alice"]);
    expect(result.message).toBe("hello secret");
  });

  it("parses /whisper with multiple targets", () => {
    const result = parseChatCommand(
      "/whisper [João, Maria] secret message",
    ) as ParsedWhisperCommand;
    expect(result.kind).toBe("whisper");
    expect(result.targets).toEqual(["João", "Maria"]);
    expect(result.message).toBe("secret message");
  });

  it("parses /w [gm] for GM target", () => {
    const result = parseChatCommand("/w [gm] telling the GM") as ParsedWhisperCommand;
    expect(result.kind).toBe("whisper");
    expect(result.targets).toEqual(["gm"]);
  });

  it("parses /w [players] for players target", () => {
    const result = parseChatCommand("/w [players] public to players") as ParsedWhisperCommand;
    expect(result.kind).toBe("whisper");
    expect(result.targets).toEqual(["players"]);
  });

  it("malformed whisper (no brackets) falls through to text", () => {
    const result = parseChatCommand("/w Alice hello");
    // No brackets → falls through as plain text
    expect(result.kind).toBe("text");
  });

  it("trims whitespace around target names", () => {
    const result = parseChatCommand("/w [ Alice ,  Bob ] msg") as ParsedWhisperCommand;
    expect(result.targets).toEqual(["Alice", "Bob"]);
  });
});

// ---------------------------------------------------------------------------
// Emote commands — REQ-CHT-013
// ---------------------------------------------------------------------------

describe("parseChatCommand — emote commands", () => {
  const emoteCases = [
    "/emote examina a sala",
    "/em examina a sala",
    "/me examina a sala",
    "/e examina a sala",
  ];

  for (const input of emoteCases) {
    it(`parses "${input}" as emote`, () => {
      const result = parseChatCommand(input) as ParsedEmoteCommand;
      expect(result.kind).toBe("emote");
      expect(result.message).toBe("examina a sala");
    });
  }
});

// ---------------------------------------------------------------------------
// IC / OOC commands — REQ-CHT-013
// ---------------------------------------------------------------------------

describe("parseChatCommand — ic/ooc", () => {
  it("parses /ic", () => {
    const result = parseChatCommand("/ic Hello adventurers!") as ParsedInCharacterCommand;
    expect(result.kind).toBe("ic");
    expect(result.message).toBe("Hello adventurers!");
  });

  it("parses /ooc", () => {
    const result = parseChatCommand("/ooc brb") as ParsedOutOfCharacterCommand;
    expect(result.kind).toBe("ooc");
    expect(result.message).toBe("brb");
  });
});

// ---------------------------------------------------------------------------
// Plain text — REQ-CHT-015 and inline roll detection
// ---------------------------------------------------------------------------

describe("parseChatCommand — plain text", () => {
  it("returns kind=text for plain message", () => {
    const result = parseChatCommand("Hello everyone!") as ParsedPlainText;
    expect(result.kind).toBe("text");
    expect(result.content).toBe("Hello everyone!");
    expect(result.inlineRolls).toHaveLength(0);
  });

  it("unrecognized /cmd returns text", () => {
    const result = parseChatCommand("/strike shortsword") as ParsedPlainText;
    expect(result.kind).toBe("text");
  });

  it("trims leading/trailing whitespace from input", () => {
    const result = parseChatCommand("  hello  ") as ParsedPlainText;
    expect(result.content).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Inline roll extraction — REQ-ROL-017..018
// ---------------------------------------------------------------------------

describe("extractInlineRolls", () => {
  it("extracts a single immediate inline roll", () => {
    const spans = extractInlineRolls("I roll [[1d20+5]] for attack");
    expect(spans).toHaveLength(1);
    expect(spans[0].formula).toBe("1d20+5");
    expect(spans[0].kind).toBe("immediate");
    expect(spans[0].mode).toBe("public");
  });

  it("extracts multiple inline rolls", () => {
    const spans = extractInlineRolls("[[2d6]] fire and [[1d8]] cold damage");
    expect(spans).toHaveLength(2);
    expect(spans[0].formula).toBe("2d6");
    expect(spans[1].formula).toBe("1d8");
  });

  it("extracts a deferred /r roll", () => {
    const spans = extractInlineRolls("Click to roll [[/r 1d20+5]]");
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe("deferred");
    expect(spans[0].mode).toBe("public");
    expect(spans[0].formula).toBe("1d20+5");
  });

  it("extracts deferred /gmroll", () => {
    const spans = extractInlineRolls("[[/gmroll 1d6]] hidden");
    expect(spans[0].kind).toBe("deferred");
    expect(spans[0].mode).toBe("gmroll");
  });

  it("extracts deferred /blindroll", () => {
    const spans = extractInlineRolls("[[/blindroll 1d20]]");
    expect(spans[0].kind).toBe("deferred");
    expect(spans[0].mode).toBe("blindroll");
  });

  it("extracts deferred /selfroll", () => {
    const spans = extractInlineRolls("[[/selfroll 1d4]]");
    expect(spans[0].kind).toBe("deferred");
    expect(spans[0].mode).toBe("selfroll");
  });

  it("returns empty array for text with no inline rolls", () => {
    const spans = extractInlineRolls("No dice here");
    expect(spans).toHaveLength(0);
  });

  it("records correct start/end positions", () => {
    const text = "pre [[2d6]] post";
    const spans = extractInlineRolls(text);
    expect(spans[0].start).toBe(4);
    expect(spans[0].end).toBe(11);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("[[2d6]]");
  });

  it("plain text [[...]] in parseChatCommand detects inline rolls", () => {
    const result = parseChatCommand("I deal [[2d6+3]] fire damage") as ParsedPlainText;
    expect(result.kind).toBe("text");
    expect(result.inlineRolls).toHaveLength(1);
    expect(result.inlineRolls[0].formula).toBe("2d6+3");
    expect(result.inlineRolls[0].kind).toBe("immediate");
  });

  it("deferred /br alias for blindroll", () => {
    const spans = extractInlineRolls("[[/br 1d20]]");
    expect(spans[0].mode).toBe("blindroll");
  });

  it("deferred /sr alias for selfroll", () => {
    const spans = extractInlineRolls("[[/sr 1d4]]");
    expect(spans[0].mode).toBe("selfroll");
  });

  it("skips deferred [[/cmd]] with no formula", () => {
    const spans = extractInlineRolls("[[/roll]]");
    expect(spans).toHaveLength(0);
  });
});
