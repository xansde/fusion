/**
 * spellCast.test.ts — cast-announcement chat payloads (r16 verificação viva).
 *
 * "Lançar magia não está jogando no chat" — casting now emits a plain-text
 * chat:send (speaker = the actor) naming the spell in pt-BR with the effective
 * rank, action-cost glyphs, and (for save spells) the DC + save; attack spells
 * ALSO fire the spell-attack roll. Tests pin the wire shape and the content.
 */

import { describe, it, expect } from "vitest";
import { CharacterSheetVM, type SpellHealResolver } from "../characterSheetVM.js";
import { ChatSendPayloadSchema } from "@fusion/shared";

// Tobias-like caster: level 3 Magus, one arcane entry, Ignition (attack cantrip)
// and Electric Arc (save cantrip). Embedded copies are STRIPPED (no heightening/
// traits/time/defense) — the heal resolver supplies the pack systems.
function makeCaster(): Record<string, unknown> {
  return {
    _id: "tobias",
    name: "Tobias",
    type: "character",
    ownership: { default: 0, "user-gm": 3 },
    system: {
      level: { value: 3 },
      details: { keyAbility: "int" },
      derived: {
        spellcasting: { "entry-arcane": { dc: 19, attack: 9, rank: 2 } },
      },
    },
    items: [
      { _id: "entry-arcane", name: "Arcane Spells", type: "spellcastingEntry", system: { prepared: { value: "prepared" }, tradition: { value: "arcane" }, ability: { value: "int" } } },
      { _id: "sp-ignition", name: "Ignition", type: "spell", location: "entry-arcane", system: { level: 0, damage: { "0": { formula: "2d4", type: "fire" } }, traits: { value: [] } } },
      { _id: "sp-arc", name: "Electric Arc", type: "spell", location: "entry-arcane", system: { level: 0, damage: { "0": { formula: "2d4", type: "electricity" } }, traits: { value: [] } } },
    ],
  };
}

const PACK: Record<string, Record<string, unknown>> = {
  ignition: {
    level: 1,
    time: { value: "2" },
    damage: { cQDyW0QpjJ38MlSi: { formula: "2d4", type: "fire" } },
    heightening: { type: "interval", interval: 1, damage: { cQDyW0QpjJ38MlSi: "1d4" } },
    traits: { value: ["attack", "cantrip", "concentrate", "fire", "manipulate"] },
  },
  "electric arc": {
    level: 1,
    time: { value: "2" },
    damage: { "0": { formula: "2d4", type: "electricity" } },
    heightening: { type: "interval", interval: 1, damage: { "0": "1d4" } },
    traits: { value: ["cantrip", "concentrate", "electricity", "manipulate"] },
    defense: { save: { basic: true, statistic: "reflex" } },
  },
};

const heal: SpellHealResolver = (name) => PACK[name.toLowerCase()] ?? null;

function makeVM(): CharacterSheetVM {
  return new CharacterSheetVM({
    doc: makeCaster(),
    actorId: "tobias",
    ownership: 3,
    userId: "user-gm",
    isGm: true,
    worldId: "world-1",
    spellHeal: heal,
  });
}

describe("castSpell — announcement", () => {
  it("attack cantrip (Ignition): announcement + spell-attack roll, speaker = actor", () => {
    const vm = makeVM();
    const cast = vm.castSpell("sp-ignition", "entry-arcane", "cantrip");
    expect(cast).not.toBeNull();
    const { announcement, attack } = cast!;

    // Announcement is a valid chat:send payload (envelope `type` stripped) with
    // the actor as speaker, no /r prefix.
    const { type: _t, ...payload } = announcement;
    expect(ChatSendPayloadSchema.safeParse(payload).success).toBe(true);
    expect(announcement.type).toBe("chat:send");
    expect(announcement.speakerActorId).toBe("tobias");
    expect(announcement.content.startsWith("/r")).toBe(false);
    // pt-BR verb + effective rank 2 (L3 cantrip) + ◆◆ glyphs (time "2").
    expect(announcement.content).toContain("(nível 2)");
    expect(announcement.content).toContain("◆◆");

    // Attack spell → the spell-attack roll fires (one click = announce + attack).
    expect(attack).not.toBeNull();
    expect(attack!.content).toContain("/r 1d20+9");
  });

  it("save cantrip (Electric Arc): announcement carries CD + save, no attack roll", () => {
    const vm = makeVM();
    const cast = vm.castSpell("sp-arc", "entry-arcane", "cantrip");
    expect(cast).not.toBeNull();
    const { announcement, attack } = cast!;
    expect(announcement.content).toContain("CD 19");
    expect(announcement.content).toContain("Reflexos");
    expect(announcement.content).toContain("básico");
    // Not an attack spell → no attack roll.
    expect(attack).toBeNull();
  });

  it("prepared surface heightens to the slot rank in the announcement", () => {
    const vm = makeVM();
    // Cast Ignition as if prepared in a rank-3 slot (surface prepared).
    const cast = vm.castSpell("sp-ignition", "entry-arcane", "prepared", 3);
    expect(cast!.announcement.content).toContain("(nível 3)");
  });

  it("returns null for an unknown spell id", () => {
    const vm = makeVM();
    expect(vm.castSpell("nope", "entry-arcane", "cantrip")).toBeNull();
  });
});
