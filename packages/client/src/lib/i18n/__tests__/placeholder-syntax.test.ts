/**
 * Placeholder syntax of the bundles: the resolver interpolates `{{name}}` only, so a single-brace `{name}`
 * reaches the screen verbatim (L2 defect D3: "Efeito aplicado: {name}").
 */
import { describe, it, expect } from "vitest";
import en from "../en.json";
import ptBR from "../pt-BR.json";

const SINGLE_BRACE = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})/;

describe("i18n placeholders", () => {
  for (const [name, bundle] of [
    ["en", en],
    ["pt-BR", ptBR],
  ] as const) {
    it(`${name}: no key uses a single-brace placeholder`, () => {
      const offenders = Object.entries(bundle as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && SINGLE_BRACE.test(value))
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });
  }
});
