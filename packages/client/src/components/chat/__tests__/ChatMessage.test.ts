/**
 * ChatMessage.test.ts — the log shows the dice, not a button that shows the dice.
 *
 * Rendered with `render()` from `svelte/server`: the client project runs Vitest in a
 * node environment with no jsdom and no testing-library, so the assertions are made on
 * the FIRST paint of the markup. That is exactly the right instrument here: whatever
 * only appears after a click simply is not in this string — which is the whole point of
 * REQ-ACH-021 ("sem exigir interação").
 *
 * Covers REQ-ACH-021, REQ-ACH-022, REQ-ACH-023, REQ-ACH-024 and REQ-ACH-025.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatMessage from "../ChatMessage.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

import type {
  ChatMessage as ChatMessageType,
  RollResultData,
  RollTermResult,
} from "@fusion/shared";

function msg(id: string, overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    _id: id,
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "u1",
      createdBy: "u1",
      coreVersion: "0.1.0",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 1,
      systemSchemaVersion: null,
    },
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    type: "text",
    worldId: "w1",
    content: id,
    speaker: { userId: "u1", alias: "Ana" },
    timestamp: 1_700_000_000_000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

function diceTerm(expression: string, faces: number, values: readonly number[]): RollTermResult {
  return {
    type: "dice",
    expression,
    total: values.reduce((a, b) => a + b, 0),
    faces,
    number: values.length,
    results: values.map((result) => ({ result, active: true })),
  };
}

function rollData(overrides: Partial<RollResultData> = {}): RollResultData {
  return {
    rollId: "roll-1",
    formula: "2d4+4",
    expandedFormula: "2d4+4",
    total: 9,
    terms: [
      diceTerm("2d4", 4, [3, 2]),
      { type: "operator", expression: "+", total: 0 },
      { type: "numeric", expression: "4", total: 4 },
    ],
    rollMode: "public",
    timestamp: 1000,
    warnings: [],
    ...overrides,
  };
}

function saveChild(id: string, alias: string, degree: string, total: number): ChatMessageType {
  return msg(id, {
    type: "roll",
    speaker: { userId: `u-${id}`, alias },
    flags: {
      fusion: { parentMessageId: "p1" },
      pf2e: { checkContext: { kind: "save", basicSave: true } },
    },
    rolls: [
      rollData({
        rollId: `r-${id}`,
        formula: "1d20+8",
        total,
        degreeOfSuccess: degree,
        terms: [
          diceTerm("1d20", 20, [total - 8]),
          { type: "operator", expression: "+", total: 0 },
          { type: "numeric", expression: "8", total: 8 },
        ],
      }),
    ],
  });
}

function renderMsg(
  message: ChatMessageType,
  props: { children?: ChatMessageType[]; continuesPrevious?: boolean } = {},
): string {
  const { body } = render(ChatMessage, { props: { message, ...props } });
  return body;
}

/** Server-rendered attributes escape quotes; compare against what the markup really holds. */
function escaped(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/&(?!(quot|amp|lt|gt|#\d+);)/g, "&amp;");
}

/** How many save rows the markup holds (Svelte appends its scope class to each). */
function saveLines(body: string): number {
  return (body.match(/class="nested-save[ "]/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// REQ-ACH-021 — the dice are on the first paint
// ---------------------------------------------------------------------------

describe("REQ-ACH-021 — formula, each die and the modifier without interaction", () => {
  const rollMsg = msg("m1", { type: "roll", content: "", rolls: [rollData()] });

  it("prints the whole reading of 2d4+4 in the very first paint", () => {
    const body = renderMsg(rollMsg);
    expect(body).toContain(escaped("2d4+4 → [3, 2] + 4 = 9"));
  });

  it("shows each die as its own value, and the modifier next to them", () => {
    const body = renderMsg(rollMsg);
    const breakdown = body.slice(body.indexOf("roll-card__breakdown"));
    expect(breakdown).toContain(">3<");
    expect(breakdown).toContain(">2<");
    expect(breakdown).toContain("+");
    expect(breakdown).toContain(">4<");
  });

  it("keeps the total and the formula visible next to the breakdown", () => {
    const body = renderMsg(rollMsg);
    expect(body).toContain("2d4+4");
    expect(body).toContain(">9<");
  });

  it("hides the breakdown behind NO toggle — nothing to expand, nothing collapsed", () => {
    const body = renderMsg(rollMsg);
    expect(body).not.toContain("aria-expanded");
    expect(body).not.toContain("Toggle roll breakdown");
    expect(body).not.toContain("<details");
  });

  it("still reads as a number when the roll arrived without terms", () => {
    const body = renderMsg(
      msg("m2", {
        type: "roll",
        content: "",
        rolls: [rollData({ formula: "7", expandedFormula: "7", total: 7, terms: [] })],
      }),
    );
    expect(body).toContain(escaped("7 → 7 = 7"));
  });
});

// ---------------------------------------------------------------------------
// REQ-ACH-022 — the child rolls of a card are just as legible
// ---------------------------------------------------------------------------

describe("REQ-ACH-022 — nested child rolls inside the card", () => {
  const parent = msg("p1", { type: "text", content: "Ana lança Arco Elétrico" });
  const attack = msg("atk", {
    type: "roll",
    speaker: { userId: "u1", alias: "Ana" },
    flags: { fusion: { parentMessageId: "p1" } },
    rolls: [
      rollData({
        rollId: "r-atk",
        formula: "1d20+9",
        total: 22,
        flavor: "Ataque",
        terms: [
          diceTerm("1d20", 20, [13]),
          { type: "operator", expression: "+", total: 0 },
          { type: "numeric", expression: "9", total: 9 },
        ],
      }),
    ],
  });

  it("shows the dice values of an attack line, not only its total", () => {
    const body = renderMsg(parent, { children: [attack] });
    expect(body).toContain("[13] + 9");
    expect(body).toContain("Ataque");
    expect(body).toContain(">22<");
  });

  it("shows the degree of success on a graded child roll", () => {
    const gradedStrike = msg("atk", {
      type: "roll",
      speaker: { userId: "u1", alias: "Ana" },
      flags: {
        fusion: { parentMessageId: "p1" },
        pf2e: { checkContext: { kind: "attack" } },
      },
      rolls: [rollData({ rollId: "r-strike", degreeOfSuccess: "criticalSuccess" })],
    });
    const body = renderMsg(parent, { children: [gradedStrike] });
    expect(body).toContain(t("FUSION.Chat.Degree.criticalSuccess"));
  });
});

// ---------------------------------------------------------------------------
// REQ-ACH-023 / REQ-ACH-024 — the saves section
// ---------------------------------------------------------------------------

describe("REQ-ACH-023 — one line per target, with the dice of the test", () => {
  const parent = msg("p1", { type: "text", content: "Ana lança Bola de Fogo" });

  it("gives each target its own line with name, degree and dice", () => {
    const body = renderMsg(parent, {
      children: [saveChild("s1", "Bruenor", "success", 18), saveChild("s2", "Kira", "failure", 12)],
    });
    expect(body).toContain("Bruenor");
    expect(body).toContain("Kira");
    expect(body).toContain("[10] + 8");
    expect(body).toContain("[4] + 8");
    expect(body).toContain(t("FUSION.Chat.Degree.success"));
    expect(body).toContain(t("FUSION.Chat.Degree.failure"));
    // Two lines, one per target — never merged into a single row.
    expect(saveLines(body)).toBe(2);
  });

  it("carries the per-degree consequence when the save is basic", () => {
    const body = renderMsg(parent, { children: [saveChild("s1", "Bruenor", "success", 18)] });
    expect(body).toContain(t("FUSION.Chat.BasicSave.success"));
  });
});

describe("REQ-ACH-024 — at most four save lines, with a control for the rest", () => {
  const parent = msg("p1", { type: "text", content: "Ana lança Bola de Fogo" });
  const six = ["A", "B", "C", "D", "E", "F"].map((name, i) =>
    saveChild(`s${String(i)}`, `Alvo${name}`, "success", 18),
  );

  it("renders only four of six lines and offers 'ver todas (6)'", () => {
    const body = renderMsg(parent, { children: six });
    expect(saveLines(body)).toBe(4);
    expect(body).toContain("AlvoD");
    expect(body).not.toContain("AlvoE");
    expect(body).toContain(t("FUSION.Chat.SpellCard.ShowAllSaves", { count: "6" }));
  });

  it("does not offer the control when everything already fits (exactly four)", () => {
    const body = renderMsg(parent, { children: six.slice(0, 4) });
    expect(saveLines(body)).toBe(4);
    expect(body).not.toContain(t("FUSION.Chat.SpellCard.ShowAllSaves", { count: "4" }));
  });
});

// ---------------------------------------------------------------------------
// REQ-ACH-025 — one header per run of the same author
// ---------------------------------------------------------------------------

describe("REQ-ACH-025 — a continuation drops the header", () => {
  it("prints the author and the hour on the first message of a run", () => {
    const body = renderMsg(msg("m1"));
    expect(body).toContain("msg__header");
    expect(body).toContain("Ana");
  });

  it("omits the header when the message continues the previous one", () => {
    const body = renderMsg(msg("m2"), { continuesPrevious: true });
    expect(body).not.toContain("msg__header");
    expect(body).toContain("msg--continued");
    // The content itself is untouched — only the repeated header goes away.
    expect(body).toContain("m2");
  });
});
