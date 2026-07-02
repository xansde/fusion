/**
 * @fusion/system-etmos — particulas-syntax.ts (Complemento connectivity table) tests.
 *
 * Verifies the 10 Complemento entries against the real pack data
 * (systems/etmos/packs-src/particulas.json `complementos` array) — cross
 * checked by hand in the batch context transcription.
 *
 * REQ-ETM-028, design doc §1.4.
 */
import { describe, it, expect } from "vitest";
import {
  PARTICULAS_SYNTAX,
  getComplementoSyntax,
  isComplementoSlug,
} from "../particulas-syntax.js";

describe("PARTICULAS_SYNTAX — 10 Complemento entries", () => {
  it("has exactly 10 entries", () => {
    expect(PARTICULAS_SYNTAX).toHaveLength(10);
  });

  it.each([
    ["mor", "modificador", "suffix", 1],
    ["min", "modificador", "suffix", 1],
    ["san", "modificador", "suffix", 1],
    ["sar", "modificador", "suffix", 1],
    ["sin", "modificador", "suffix", 1],
    ["ag", "criador", "connector", 2],
    ["ada", "criador", "prefix", 3],
    ["no", "criador", "prefix", 3],
    ["mut", "criador", "prefix", 3],
    ["itam", "modificador", "suffix", 4],
  ] as const)("%s -> subtipo=%s, ligacao=%s, nivelGrimorio=%i", (slug, subtipo, ligacao, nivel) => {
    const entry = getComplementoSyntax(slug);
    expect(entry).toBeDefined();
    expect(entry?.subtipo).toBe(subtipo);
    expect(entry?.ligacao).toBe(ligacao);
    expect(entry?.nivelGrimorio).toBe(nivel);
  });

  it("isComplementoSlug is true for all 10 Complemento slugs, false otherwise", () => {
    for (const entry of PARTICULAS_SYNTAX) {
      expect(isComplementoSlug(entry.slug)).toBe(true);
    }
    expect(isComplementoSlug("et")).toBe(false); // Função, not a Complemento
    expect(isComplementoSlug("imu")).toBe(false); // Objeto, not a Complemento
    expect(isComplementoSlug("nonexistent")).toBe(false);
  });

  it("getComplementoSyntax returns undefined for non-Complemento slugs", () => {
    expect(getComplementoSyntax("et")).toBeUndefined();
    expect(getComplementoSyntax("quan")).toBeUndefined();
  });
});
