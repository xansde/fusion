import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@fusion/shared";
import { rollBreakdownRows } from "../rollBreakdownParts.js";

const msg = (fusion: Record<string, unknown> | undefined): Pick<ChatMessage, "flags"> =>
  ({ flags: fusion === undefined ? {} : { fusion } }) as Pick<ChatMessage, "flags">;

describe("rollBreakdownRows — the card's decomposition, as the server wrote it", () => {
  it("lists the statistic's parts with signed values, the non-stacking one flagged", () => {
    const rows = rollBreakdownRows(
      msg({
        breakdown: {
          statistic: "skill:athletics",
          parts: [
            { label: "Atributo (For)", type: "ability", value: 4, applied: true },
            { label: "Proficiência (Treinado)", type: "proficiency", value: 5, applied: true },
            { label: "Bênção", type: "status", value: 1, applied: false },
            { label: "Fadigado", type: "status", value: -1, applied: true },
          ],
        },
      }),
    );
    expect(rows.map((r) => [r.label, r.valueFormatted, r.applied])).toEqual([
      ["Atributo (For)", "+4", true],
      ["Proficiência (Treinado)", "+5", true],
      ["Bênção", "+1", false],
      ["Fadigado", "-1", true],
    ]);
  });

  it("adds the conditional modifiers the server settled, marked as such", () => {
    const rows = rollBreakdownRows(
      msg({
        breakdown: {
          statistic: "strike:a",
          parts: [{ label: "Atributo (For)", type: "ability", value: 3, applied: true }],
        },
        conditionalModifiers: [
          { slug: "prey", label: "Contra a presa", type: "circumstance", value: 2 },
        ],
      }),
    );
    expect(rows.at(-1)).toEqual({
      label: "Contra a presa",
      valueFormatted: "+2",
      applied: true,
      conditional: true,
    });
  });

  it("no decomposition recorded: nothing to print, not even the conditional modifiers alone", () => {
    expect(rollBreakdownRows(msg(undefined))).toEqual([]);
    expect(rollBreakdownRows(msg({ conditionalModifiers: [{ label: "X", value: 2 }] }))).toEqual(
      [],
    );
  });

  it("ignores malformed parts instead of printing garbage", () => {
    const rows = rollBreakdownRows(
      msg({
        breakdown: {
          parts: [
            { label: 3, value: "x" },
            { label: "Ok", value: 1 },
          ],
        },
      }),
    );
    expect(rows.map((r) => r.label)).toEqual(["Ok"]);
  });
});
