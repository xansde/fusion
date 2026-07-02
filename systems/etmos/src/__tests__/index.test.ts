/**
 * defineSystem registration smoke tests — models, rollData, degreeOfSuccess,
 * effectsMaterializer surfaces (M5-A E1/E2/E4).
 */
import { describe, it, expect } from "vitest";
import { etmosSystem } from "../index.js";

describe("etmosSystem — defineSystem registration", () => {
  it("registers manifest id and documentTypes", () => {
    expect(etmosSystem.manifest.id).toBe("etmos");
    expect(etmosSystem.manifest.documentTypes.Actor).toEqual(["orador", "antagonista"]);
    expect(etmosSystem.manifest.documentTypes.Item).toEqual([
      "particula",
      "habilidade",
      "origem",
      "totem",
      "item_encantado",
      "frase_magica",
    ]);
  });

  it("registers all 8 data models", () => {
    expect(etmosSystem.models.get("Actor:orador")).toBeDefined();
    expect(etmosSystem.models.get("Actor:antagonista")).toBeDefined();
    expect(etmosSystem.models.get("Item:particula")).toBeDefined();
    expect(etmosSystem.models.get("Item:habilidade")).toBeDefined();
    expect(etmosSystem.models.get("Item:origem")).toBeDefined();
    expect(etmosSystem.models.get("Item:totem")).toBeDefined();
    expect(etmosSystem.models.get("Item:item_encantado")).toBeDefined();
    expect(etmosSystem.models.get("Item:frase_magica")).toBeDefined();
    expect(etmosSystem.models.size).toBe(8);
  });

  it("registers rollData for orador exposing atributos (E1, REQ-ETM-015)", () => {
    const builder = etmosSystem.registries.rollData.find((r) => r.subtypes.includes("orador"));
    expect(builder).toBeDefined();
    const rollData = builder.build({
      system: { atributos: { corpo: { value: 3 }, alma: { value: 2 }, mente: { value: 4 } } },
    });
    expect(rollData).toEqual({
      atributos: { corpo: { value: 3 }, alma: { value: 2 }, mente: { value: 4 } },
    });
  });

  it("registers rollData for antagonista exposing bare-integer atributos (E1, REQ-ETM-015/050)", () => {
    const builder = etmosSystem.registries.rollData.find((r) => r.subtypes.includes("antagonista"));
    expect(builder).toBeDefined();
    // Antagonista atributos are bare integers (AtributoAntagonistaSchema), not
    // { value, max } objects — "2d6 + atributo" resolves `@atributos.corpo` directly.
    const rollData = builder.build({
      system: { atributos: { corpo: 2, alma: 0, mente: 1 } },
    });
    expect(rollData).toEqual({ atributos: { corpo: 2, alma: 0, mente: 1 } });
  });

  it("registers degreeOfSuccess 'etmos.conjuracao' returning binary success/failure (E2, D6)", () => {
    // Registered directly as `etmosDegreeOfSuccessDefinition` (compositor/degree.ts) —
    // a single source of truth, so meta also carries `classeDificuldade` (12b §3.4),
    // not just `margem`.
    const def = etmosSystem.registries.degreeOfSuccess.get("etmos.conjuracao");
    expect(def).toBeDefined();
    const success = def.compute(10, 8);
    expect(success.degree).toBe("success");
    expect(success.meta).toEqual({ margem: 2, classeDificuldade: "mediano" });

    const failure = def.compute(5, 8);
    expect(failure.degree).toBe("failure");
    expect(failure.meta).toEqual({ margem: -3, classeDificuldade: "simples" });
  });

  it("registers an effectsMaterializer for orador/antagonista returning an empty list (E4)", () => {
    const materializer = etmosSystem.registries.effectsMaterializers.find((m) =>
      m.subtypes.includes("orador"),
    );
    expect(materializer).toBeDefined();
    expect(materializer.build({})).toEqual([]);
  });
});
