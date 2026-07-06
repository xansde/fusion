/**
 * skillNames.test.ts — pt-BR skill-name display for the Skills tab (B1 r14 #7).
 */

import { describe, it, expect } from "vitest";
import { SKILL_NAMES_PT, skillNamePt } from "../skillNames.js";

describe("skillNamePt", () => {
  it("translates every canonical skill slug to its pt-BR name", () => {
    expect(skillNamePt("acrobatics")).toBe("Acrobacia");
    expect(skillNamePt("arcana")).toBe("Arcanismo");
    expect(skillNamePt("athletics")).toBe("Atletismo");
    expect(skillNamePt("crafting")).toBe("Ofício");
    expect(skillNamePt("deception")).toBe("Enganação");
    expect(skillNamePt("diplomacy")).toBe("Diplomacia");
    expect(skillNamePt("intimidation")).toBe("Intimidação");
    expect(skillNamePt("medicine")).toBe("Medicina");
    expect(skillNamePt("nature")).toBe("Natureza");
    expect(skillNamePt("occultism")).toBe("Ocultismo");
    expect(skillNamePt("performance")).toBe("Atuação");
    expect(skillNamePt("religion")).toBe("Religião");
    expect(skillNamePt("society")).toBe("Sociedade");
    expect(skillNamePt("stealth")).toBe("Furtividade");
    expect(skillNamePt("survival")).toBe("Sobrevivência");
    expect(skillNamePt("thievery")).toBe("Ladinagem");
  });

  it("covers all 16 canonical skills in the map", () => {
    expect(Object.keys(SKILL_NAMES_PT)).toHaveLength(16);
  });

  it("renders a lore skill as 'Saber (<subject>)' with the subject title-cased", () => {
    expect(skillNamePt("lore-taverna")).toBe("Saber (Taverna)");
    expect(skillNamePt("lore-dragoes")).toBe("Saber (Dragoes)");
  });

  it("handles a multi-word lore subject", () => {
    expect(skillNamePt("lore-arte-antiga")).toBe("Saber (Arte antiga)");
  });

  it("renders a bare 'lore-' as just 'Saber'", () => {
    expect(skillNamePt("lore-")).toBe("Saber");
  });

  it("falls back to the slug itself for an unknown non-lore skill", () => {
    expect(skillNamePt("unknownskill")).toBe("unknownskill");
  });
});
