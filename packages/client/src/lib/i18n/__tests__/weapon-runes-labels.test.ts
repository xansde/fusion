/**
 * The rune editor says what the prototype says (BHR-F7-01, wave 9 review M-8 / P1): the property runes sit in
 * "espaços" (not "vagas"), numbered "Espaço N", and the preview names the damage type.
 */
import { describe, it, expect } from "vitest";
import ptBR from "../pt-BR.json";
import en from "../en.json";

const pt = ptBR as Record<string, string>;
const english = en as Record<string, string>;

describe("rune editor labels", () => {
  it("numbers the property runes as Espaço N, and counts them in espaços", () => {
    expect(pt["FUSION.Sheet.Runes.Property.Slot"]).toBe("Espaço {{n}}");
    expect(pt["FUSION.Sheet.Runes.Property.Label"]).toBe(
      "Runas de propriedade ({{count}} espaços)",
    );
    expect(pt["FUSION.Sheet.Runes.Property.LabelOne"]).toBe("Runas de propriedade (1 espaço)");
    expect(pt["FUSION.Sheet.Runes.Property.NoSlots"]).toContain("Sem espaços");
  });

  it("the preview names the damage type, in both languages", () => {
    expect(pt["FUSION.Sheet.Runes.Preview"]).toContain("{{damage}} {{type}}");
    expect(english["FUSION.Sheet.Runes.Preview"]).toContain("{{damage}} {{type}}");
  });
});
