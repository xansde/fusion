/**
 * barAttributeOptions — the dropdown the token config offers instead of a
 * free-text dotted path (REQ-CNV-090).
 *
 * The canonical table resources — HP, hero points, focus points — are ALWAYS
 * offered: the 2e systems store them with rule-supplied maxima (hero points
 * cap at 3, the focus pool at the derived cap), so requiring a stored
 * `{ value, max }` pair would hide exactly the resources the sheet itself
 * shows. Extra pools genuinely stored as `{ value, max }` are discovered on
 * top, with `derived.X` canonicalized to `attributes.X` (the bar's alias).
 */
import { describe, expect, it } from "vitest";
import { barAttributeOptions, collectResourcePaths } from "../barAttributeOptions.js";

const PF2E_CHARACTER_SYSTEM = {
  attributes: { speed: { value: 25 } },
  derived: {
    hp: { value: 17, max: 20, temp: 0 },
    speed: { value: 25, base: 25 },
  },
  resources: {
    focusPoints: { value: 2 },
    heroPoints: { value: 3 },
  },
  details: { level: { value: 1 } },
};

const T = (key: string): string =>
  (
    ({
      "FUSION.Token.Config.BarAttr.none": "Sem barra",
      "FUSION.Token.Config.BarAttr.attributes.hp": "HP",
      "FUSION.Token.Config.BarAttr.resources.heroPoints": "Pontos de heroísmo",
      "FUSION.Token.Config.BarAttr.resources.focusPoints": "Pontos de foco",
      "FUSION.Token.Config.BarAttr.unresolved": "(não encontrado)",
    }) as Record<string, string>
  )[key] ?? key;

describe("collectResourcePaths", () => {
  it("finds every stored { value, max } pair, in stable depth-first order", () => {
    const system = {
      attributes: { hp: { value: 5, max: 9 }, speed: { value: 25 } },
      resources: { stamina: { value: 3, max: 5 } },
    };
    expect(collectResourcePaths(system)).toEqual(["attributes.hp", "resources.stamina"]);
  });

  it("canonicalizes derived.X to attributes.X, without duplicating a real twin", () => {
    const system = {
      attributes: { hp: { value: 5, max: 9 } },
      derived: { hp: { value: 12, max: 20 } },
    };
    expect(collectResourcePaths(system)).toEqual(["attributes.hp"]);
  });

  it("ignores leaves without a numeric max (speed, level, scalars)", () => {
    expect(collectResourcePaths({ attributes: { speed: { value: 25 }, ac: 16 } })).toEqual([]);
  });

  it("returns [] for a missing or non-object system", () => {
    expect(collectResourcePaths(null)).toEqual([]);
    expect(collectResourcePaths(undefined)).toEqual([]);
    expect(collectResourcePaths("hp")).toEqual([]);
  });

  it("does not walk inherited properties", () => {
    expect(collectResourcePaths({ __proto__: { hp: { value: 1, max: 2 } } })).toEqual([]);
  });

  it("stops at depth 3 instead of walking arbitrarily deep blobs", () => {
    const deep = { a: { b: { c: { d: { value: 1, max: 2 } } } } };
    expect(collectResourcePaths(deep)).toEqual([]);
  });
});

describe("barAttributeOptions", () => {
  it("always offers the canonical table resources, legibly labelled", () => {
    expect(barAttributeOptions(PF2E_CHARACTER_SYSTEM, "", T)).toEqual([
      { value: "", label: "Sem barra" },
      { value: "attributes.hp", label: "HP" },
      { value: "resources.heroPoints", label: "Pontos de heroísmo" },
      { value: "resources.focusPoints", label: "Pontos de foco" },
    ]);
  });

  it("offers the canonical resources even with no actor at all", () => {
    expect(barAttributeOptions(null, "", T).map((o) => o.value)).toEqual([
      "",
      "attributes.hp",
      "resources.heroPoints",
      "resources.focusPoints",
    ]);
  });

  it("appends discovered extra pools after the canonical ones", () => {
    const system = { resources: { stamina: { value: 3, max: 5 } } };
    const values = barAttributeOptions(system, "", T).map((o) => o.value);
    expect(values).toEqual([
      "",
      "attributes.hp",
      "resources.heroPoints",
      "resources.focusPoints",
      "resources.stamina",
    ]);
  });

  it("labels an unknown discovered pool by its last segment, capitalized", () => {
    const system = { resources: { stamina: { value: 3, max: 5 } } };
    expect(barAttributeOptions(system, "", T)).toContainEqual({
      value: "resources.stamina",
      label: "Stamina",
    });
  });

  it("does not duplicate a discovered pool that is already canonical", () => {
    const system = { derived: { hp: { value: 12, max: 20 } } };
    const options = barAttributeOptions(system, "attributes.hp", T);
    expect(options.filter((o) => o.value === "attributes.hp")).toHaveLength(1);
  });

  it("keeps a saved path that resolves nowhere, marked as unresolved", () => {
    const options = barAttributeOptions(PF2E_CHARACTER_SYSTEM, "attributes.old", T);
    expect(options).toContainEqual({
      value: "attributes.old",
      label: "attributes.old (não encontrado)",
    });
  });
});
