/**
 * damageTypes.test.ts — every damage type of the PF2e/SF2e rules has a `FUSION.Damage.*` string in both
 * bundles (satélite #410, item 1).
 *
 * The Exemplar Draconic dialog printed `FUSION.Damage.force`, `FUSION.Damage.spirit` and
 * `FUSION.Damage.mental` as raw keys under its tradition buttons: the dictionary only had the seven types
 * the first screens needed. The slugs below are the `DAMAGE_TYPES` of both systems (`systems/pf2e/src/types.ts`
 * and `systems/sf2e/src/types.ts` in the satellite carry the same 25); the core cannot import a system
 * package, so the list is copied here and this test is what notices when a type is added there and not here.
 */

import { describe, expect, it } from "vitest";
import ptBR from "../pt-BR.json" assert { type: "json" };
import en from "../en.json" assert { type: "json" };

const DAMAGE_TYPES = [
  "acid",
  "bleed",
  "bludgeoning",
  "chaotic",
  "cold",
  "electricity",
  "evil",
  "fire",
  "force",
  "good",
  "lawful",
  "mental",
  "negative",
  "persistent",
  "physical",
  "piercing",
  "poison",
  "positive",
  "precision",
  "slashing",
  "sonic",
  "spirit",
  "untyped",
  "vitality",
  "void",
] as const;

const ptBundle = ptBR as Record<string, unknown>;
const enBundle = en as Record<string, unknown>;

describe("FUSION.Damage.* covers every PF2e/SF2e damage type", () => {
  it.each(DAMAGE_TYPES)("%s has a non-empty string in pt-BR and in en", (type) => {
    const key = `FUSION.Damage.${type}`;
    expect(typeof ptBundle[key], `pt-BR ${key}`).toBe("string");
    expect(ptBundle[key], `pt-BR ${key}`).not.toBe("");
    expect(typeof enBundle[key], `en ${key}`).toBe("string");
    expect(enBundle[key], `en ${key}`).not.toBe("");
  });

  it("the types the Draconic Exemplar dialog showed as raw keys now read in Portuguese", () => {
    expect(ptBundle["FUSION.Damage.force"]).toBe("força");
    expect(ptBundle["FUSION.Damage.spirit"]).toBe("espírito");
    expect(ptBundle["FUSION.Damage.mental"]).toBe("mental");
  });

  it("the Portuguese names agree with the compendium glossary (DAMAGE_TYPE_NAMES_PT)", async () => {
    const { DAMAGE_TYPE_NAMES_PT } = await import("../../compendium/traitNames.js");
    for (const [slug, name] of Object.entries(DAMAGE_TYPE_NAMES_PT)) {
      expect(ptBundle[`FUSION.Damage.${slug}`], slug).toBe(name);
    }
  });
});
