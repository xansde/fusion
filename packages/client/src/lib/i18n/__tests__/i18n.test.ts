/**
 * i18n.test.ts — Unit tests for the Fusion i18n resolver.
 *
 * REQ-UIF-057..060: key resolution, interpolation, pluralisation, fallback,
 * bundle registration.
 */

import { describe, it, expect } from "vitest";
import { FusionI18n } from "../i18n.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeI18n(): FusionI18n {
  const i = new FusionI18n();
  i.registerBundle("pt-BR", "", {
    "FUSION.Actors.Tab": "Atores",
    "FUSION.Count": { "1": "{{count}} item", other: "{{count}} itens" },
    "FUSION.Greeting": "Olá, {{name}}!",
    "FUSION.NoVars": "Valor fixo",
  });
  i.registerBundle("en", "", {
    "FUSION.Actors.Tab": "Actors",
    "FUSION.Count": { "1": "{{count}} item", other: "{{count}} items" },
    "FUSION.Greeting": "Hello, {{name}}!",
    "FUSION.NoVars": "Fixed value",
    "FUSION.EnOnly": "Only in English",
  });
  return i;
}

// ---------------------------------------------------------------------------
// Locale resolution
// ---------------------------------------------------------------------------

describe("t() — locale resolution", () => {
  it("resolves a key in pt-BR (default locale)", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Actors.Tab")).toBe("Atores");
  });

  it("resolves a key in en when locale is set to en", () => {
    const i18n = makeI18n();
    i18n.setLocale("en");
    expect(i18n.t("FUSION.Actors.Tab")).toBe("Actors");
  });

  it("falls back to en when key is not in pt-BR but exists in en", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.EnOnly")).toBe("Only in English");
  });

  it("returns the raw key when not found in any locale", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Missing.Key")).toBe("FUSION.Missing.Key");
  });
});

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe("t() — interpolation", () => {
  it("interpolates a single variable", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Greeting", { name: "Maria" })).toBe("Olá, Maria!");
  });

  it("leaves {{var}} untouched when vars not provided", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Greeting")).toBe("Olá, {{name}}!");
  });

  it("leaves {{var}} untouched when the variable is missing from vars", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Greeting", { other: "x" })).toBe("Olá, {{name}}!");
  });

  it("returns fixed string unchanged when no vars in template", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.NoVars", { x: 1 })).toBe("Valor fixo");
  });
});

// ---------------------------------------------------------------------------
// Pluralisation
// ---------------------------------------------------------------------------

describe("t() — pluralisation", () => {
  it("selects singular form when count === 1 (pt-BR)", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Count", { count: 1 })).toBe("1 item");
  });

  it("selects plural form when count !== 1 (pt-BR)", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Count", { count: 3 })).toBe("3 itens");
  });

  it("selects plural form for count === 0", () => {
    const i18n = makeI18n();
    i18n.setLocale("pt-BR");
    expect(i18n.t("FUSION.Count", { count: 0 })).toBe("0 itens");
  });

  it("selects singular form when count === 1 (en)", () => {
    const i18n = makeI18n();
    i18n.setLocale("en");
    expect(i18n.t("FUSION.Count", { count: 1 })).toBe("1 item");
  });

  it("selects plural form when count > 1 (en)", () => {
    const i18n = makeI18n();
    i18n.setLocale("en");
    expect(i18n.t("FUSION.Count", { count: 5 })).toBe("5 items");
  });
});

// ---------------------------------------------------------------------------
// registerBundle
// ---------------------------------------------------------------------------

describe("registerBundle()", () => {
  it("merges bundles from multiple calls", () => {
    const i18n = new FusionI18n();
    i18n.registerBundle("pt-BR", "", { "A.Key": "Valor A" });
    i18n.registerBundle("pt-BR", "", { "B.Key": "Valor B" });
    i18n.setLocale("pt-BR");
    expect(i18n.t("A.Key")).toBe("Valor A");
    expect(i18n.t("B.Key")).toBe("Valor B");
  });

  it("later registration overrides earlier for the same key", () => {
    const i18n = new FusionI18n();
    i18n.registerBundle("pt-BR", "", { K: "primeiro" });
    i18n.registerBundle("pt-BR", "", { K: "segundo" });
    i18n.setLocale("pt-BR");
    expect(i18n.t("K")).toBe("segundo");
  });

  it("applies namespace prefix", () => {
    const i18n = new FusionI18n();
    i18n.registerBundle("pt-BR", "PF2E", { "Sheet.Title": "Ficha PF2e" });
    i18n.setLocale("pt-BR");
    expect(i18n.t("PF2E.Sheet.Title")).toBe("Ficha PF2e");
  });
});

// ---------------------------------------------------------------------------
// setLocale
// ---------------------------------------------------------------------------

describe("setLocale()", () => {
  it("changes the active locale", () => {
    const i18n = makeI18n();
    i18n.setLocale("en");
    expect(i18n.locale).toBe("en");
    expect(i18n.t("FUSION.Actors.Tab")).toBe("Actors");

    i18n.setLocale("pt-BR");
    expect(i18n.locale).toBe("pt-BR");
    expect(i18n.t("FUSION.Actors.Tab")).toBe("Atores");
  });
});
