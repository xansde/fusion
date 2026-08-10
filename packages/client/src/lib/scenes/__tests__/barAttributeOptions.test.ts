/**
 * barAttributeOptions — the dropdown the token config offers instead of a
 * free-text dotted path (REQ-CNV-090). The list is DISCOVERED from the
 * effective actor's `system`: every `{ value, max }` pair is a candidate,
 * labelled legibly ("HP", not "attributes.hp").
 */
import { describe, expect, it } from "vitest";
import { barAttributeOptions, collectResourcePaths } from "../barAttributeOptions.js";

const PF2E_SYSTEM = {
  attributes: {
    hp: { value: 17, max: 20, temp: 0 },
    speed: { value: 25 },
    ac: 16,
  },
  resources: {
    focus: { value: 1, max: 2 },
  },
  details: { level: { value: 1 } },
};

describe("collectResourcePaths", () => {
  it("finds every { value, max } pair, in stable depth-first order", () => {
    expect(collectResourcePaths(PF2E_SYSTEM)).toEqual(["attributes.hp", "resources.focus"]);
  });

  it("ignores leaves without a numeric max (speed, ac, level)", () => {
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
  const t = (key: string): string =>
    (
      ({
        "FUSION.Token.Config.BarAttr.none": "Sem barra",
        "FUSION.Token.Config.BarAttr.attributes.hp": "HP",
        "FUSION.Token.Config.BarAttr.resources.focus": "Foco",
        "FUSION.Token.Config.BarAttr.unresolved": "(não encontrado)",
      }) as Record<string, string>
    )[key] ?? key;

  it("offers 'no bar' first, then each discovered resource with a legible label", () => {
    expect(barAttributeOptions(PF2E_SYSTEM, "", t)).toEqual([
      { value: "", label: "Sem barra" },
      { value: "attributes.hp", label: "HP" },
      { value: "resources.focus", label: "Foco" },
    ]);
  });

  it("labels an unknown discovered path by its last segment, capitalized", () => {
    const system = { attributes: { stamina: { value: 3, max: 5 } } };
    expect(barAttributeOptions(system, "", t)).toContainEqual({
      value: "attributes.stamina",
      label: "Stamina",
    });
  });

  it("keeps the currently saved path even when it no longer resolves", () => {
    const options = barAttributeOptions(PF2E_SYSTEM, "attributes.old", t);
    expect(options).toContainEqual({
      value: "attributes.old",
      label: "attributes.old (não encontrado)",
    });
  });

  it("does not duplicate the current path when it is already discovered", () => {
    const options = barAttributeOptions(PF2E_SYSTEM, "attributes.hp", t);
    expect(options.filter((o) => o.value === "attributes.hp")).toHaveLength(1);
  });

  it("still offers 'no bar' plus the saved path when there is no actor at all", () => {
    expect(barAttributeOptions(null, "attributes.hp", t)).toEqual([
      { value: "", label: "Sem barra" },
      { value: "attributes.hp", label: "attributes.hp (não encontrado)" },
    ]);
  });
});
