/**
 * spellCastCardVM.test.ts — pure resolution logic for the interactive
 * spell-cast chat card (r17-P2): clicker-actor resolution, button visibility,
 * and roll-op building.
 */

import { describe, it, expect } from "vitest";
import type { SpellCastCard } from "@fusion/shared";
import {
  resolveClickerActors,
  showSaveButton,
  hasDamage,
  canRollDamage,
  buildSaveRollOp,
  buildDamageRollOp,
  actorSaveMod,
  type ActorDocLike,
} from "../spellCastCardVM.js";

const SAVE_CARD: SpellCastCard = {
  casterActorId: "caster",
  spellName: "Arco Elétrico",
  rank: 2,
  saveType: "reflex",
  dcValue: 19,
  basicSave: true,
  damageFormula: "2d4+1d4",
  damageType: "electricity",
};

function actor(
  id: string,
  name: string,
  ownership: Record<string, number>,
  saves?: Record<string, number>,
  type = "character",
): ActorDocLike {
  return {
    _id: id,
    name,
    type,
    ownership,
    system: saves
      ? {
          derived: {
            saves: {
              fortitude: { total: saves["fortitude"] ?? 0 },
              reflex: { total: saves["reflex"] ?? 0 },
              will: { total: saves["will"] ?? 0 },
            },
          },
        }
      : {},
  };
}

// ---------------------------------------------------------------------------
// resolveClickerActors
// ---------------------------------------------------------------------------

describe("resolveClickerActors", () => {
  const roster: ActorDocLike[] = [
    actor("a1", "Zelda", { default: 0, alice: 3 }),
    actor("a2", "Bruno", { default: 0, bob: 3 }),
    actor("a3", "Ana", { default: 0, alice: 3 }),
    actor("loot", "Chest", { default: 0 }, undefined, "loot"), // not a character
  ];

  it("player: only owned characters, sorted by name", () => {
    const opts = resolveClickerActors(roster, "alice", false);
    expect(opts.map((o) => o.id)).toEqual(["a3", "a1"]); // Ana, Zelda
  });

  it("player with a single owned character resolves to exactly one option", () => {
    const opts = resolveClickerActors(roster, "bob", false);
    expect(opts).toHaveLength(1);
    expect(opts[0]!.id).toBe("a2");
  });

  it("player with no owned character resolves to []", () => {
    expect(resolveClickerActors(roster, "carol", false)).toHaveLength(0);
  });

  it("GM: every character/npc (roster), never the non-character loot", () => {
    const opts = resolveClickerActors(roster, "gm", true);
    expect(opts.map((o) => o.id).sort()).toEqual(["a1", "a2", "a3"]);
  });
});

// ---------------------------------------------------------------------------
// Button visibility
// ---------------------------------------------------------------------------

describe("button visibility", () => {
  it("save button shows only with save type + DC", () => {
    expect(showSaveButton(SAVE_CARD)).toBe(true);
    const { saveType: _s, dcValue: _d, ...noSave } = SAVE_CARD;
    expect(showSaveButton(noSave as SpellCastCard)).toBe(false);
  });

  it("hasDamage reflects the formula", () => {
    expect(hasDamage(SAVE_CARD)).toBe(true);
    const { damageFormula: _f, ...noDmg } = SAVE_CARD;
    expect(hasDamage(noDmg as SpellCastCard)).toBe(false);
  });

  it("damage button: caster owner or GM only", () => {
    const caster = actor("caster", "Tobias", { default: 0, alice: 3 });
    expect(canRollDamage(SAVE_CARD, caster, "alice", false)).toBe(true); // owner
    expect(canRollDamage(SAVE_CARD, caster, "bob", false)).toBe(false); // not owner
    expect(canRollDamage(SAVE_CARD, caster, "bob", true)).toBe(true); // GM
    // A player who can't see the caster (undefined actor) never rolls damage.
    expect(canRollDamage(SAVE_CARD, undefined, "bob", false)).toBe(false);
    // GM rolls damage even without the caster in their mirror.
    expect(canRollDamage(SAVE_CARD, undefined, "gm", true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// actorSaveMod
// ---------------------------------------------------------------------------

describe("actorSaveMod", () => {
  it("reads the derived save total", () => {
    const a = actor("t", "T", { default: 0 }, { reflex: 11, will: 7 });
    expect(actorSaveMod(a, "reflex")).toBe(11);
    expect(actorSaveMod(a, "will")).toBe(7);
  });

  it("falls back to 0 when no derived saves", () => {
    const a = actor("t", "T", { default: 0 });
    expect(actorSaveMod(a, "reflex")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Roll op builders
// ---------------------------------------------------------------------------

describe("buildSaveRollOp", () => {
  it("rolls the target's save with THEIR mod and speaker (positive mod)", () => {
    const target = actor("target", "Hero", { default: 0, alice: 3 }, { reflex: 11 });
    const op = buildSaveRollOp(SAVE_CARD, target, "Reflexos", "world-1")!;
    expect(op.type).toBe("chat:send");
    expect(op.speakerActorId).toBe("target");
    expect(op.content).toBe("/r 1d20+11 # Salvaguarda de Reflexos (CD 19)");
    expect(op.rollMode).toBe("public");
  });

  it("handles a negative save modifier", () => {
    const target = actor("t", "T", { default: 0 }, { reflex: -1 });
    const op = buildSaveRollOp(SAVE_CARD, target, "Reflexos", "w")!;
    expect(op.content).toBe("/r 1d20-1 # Salvaguarda de Reflexos (CD 19)");
  });

  it("returns null when the card has no save", () => {
    const { saveType: _s, dcValue: _d, ...noSave } = SAVE_CARD;
    const target = actor("t", "T", { default: 0 });
    expect(buildSaveRollOp(noSave as SpellCastCard, target, "Reflexos", "w")).toBeNull();
  });
});

describe("buildDamageRollOp", () => {
  it("rolls the heightened formula with the caster as speaker", () => {
    const op = buildDamageRollOp(SAVE_CARD, "world-1", "Arco Elétrico (nível 2) — Dano")!;
    expect(op.speakerActorId).toBe("caster");
    expect(op.content).toBe("/r 2d4+1d4 # Arco Elétrico (nível 2) — Dano electricity");
    expect(op.rollMode).toBe("public");
  });

  it("returns null when the card has no damage", () => {
    const { damageFormula: _f, ...noDmg } = SAVE_CARD;
    expect(buildDamageRollOp(noDmg as SpellCastCard, "w", "x")).toBeNull();
  });
});
