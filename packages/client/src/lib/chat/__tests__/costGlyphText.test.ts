/**
 * costGlyphText.test.ts — the cost glyphs a stored announcement carries as characters
 * ("lança Fogo (grau 2) ◆◆") are split out so the chat draws them as Fusion's own marks
 * with a spoken label, without migrating any stored message.
 */

import { describe, expect, it } from "vitest";
import { splitCostGlyphs } from "../costGlyphText.js";

describe("splitCostGlyphs", () => {
  it("splits a run of action diamonds out of the announcement, with the words for it", () => {
    expect(splitCostGlyphs("lança Raio de Fogo (grau 2) ◆◆ (CD 18 Reflexos)", "pt-BR")).toEqual([
      { kind: "text", text: "lança Raio de Fogo (grau 2) " },
      { kind: "cost", glyphs: "◆◆", label: "2 ações" },
      { kind: "text", text: " (CD 18 Reflexos)" },
    ]);
  });

  it("names one action, a free action and a reaction", () => {
    expect(splitCostGlyphs("lança Luz ◆", "pt-BR")[1]).toEqual({
      kind: "cost",
      glyphs: "◆",
      label: "1 ação",
    });
    expect(splitCostGlyphs("usa Passo ◇", "pt-BR")[1]).toMatchObject({ label: "ação livre" });
    expect(splitCostGlyphs("usa Escudo ↺", "pt-BR")[1]).toMatchObject({ label: "reação" });
    expect(splitCostGlyphs("usa Escudo ⟳", "en")[1]).toMatchObject({ label: "reaction" });
  });

  it("leaves text without glyphs untouched (one text part)", () => {
    expect(splitCostGlyphs("Olá, mesa!", "pt-BR")).toEqual([{ kind: "text", text: "Olá, mesa!" }]);
  });

  it("a mixed run it cannot name stays as glyphs, labelled by its pieces", () => {
    const parts = splitCostGlyphs("lança X ◆◇", "pt-BR");
    expect(parts[1]).toMatchObject({ kind: "cost", glyphs: "◆◇" });
    expect((parts[1] as { label: string }).label).not.toBe("");
  });
});
