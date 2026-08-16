/**
 * combatVitals.test.ts — health by role, conditions by contract (spec 40 §5.5/§5.6, G052).
 *
 * The asymmetry these tests exist for: the SAME participant, the SAME actor document, read
 * by a GM and by a player, must produce a health pair for one and nothing at all for the
 * other (REQ-CBA-040, REQ-CBA-041) — while its conditions stay identical for both
 * (REQ-CBA-053). The player's "nothing" is the same `null` an unresolvable value produces
 * (REQ-CBA-043), so no shape in the panel distinguishes "not yours to read" from
 * "not known".
 *
 * WHICH ACTOR A PLAYER ACTUALLY HAS. The REQ-CBA-053 fixtures below are the NPC the GM
 * shared at OBSERVER/LIMITED: its document is in the player's mirror (the snapshot's
 * ownership filter lets it through) while its combatant carries `hasPlayerOwner: false`,
 * because the server only raises that flag for OWNER-level player ownership. That is the
 * case where the requirement is a rule this module keeps, and it is provable end to end —
 * `packages/server/src/__tests__/combat-conditions-payload.test.ts` asserts the same pair
 * on the payload a player's socket receives. The ordinary creature is the OTHER half: its
 * actor never reaches the player, so no client code can draw its conditions, and the
 * `buildCombatVitals` test below pins that limit instead of pretending it away.
 *
 * Q-CBA-02 / REQ-CBA-083: the player branch is a rule of this screen, not a seal — creature
 * health reaches the player's client by the token's own resource bars (REQ-CNV-090).
 */

import { describe, expect, it } from "vitest";

import {
  buildCombatVitals,
  readActorHealth,
  resolveCombatantVitals,
  resolveHpView,
} from "../combatVitals.js";
import {
  buildConditionChip,
  orderConditionChips,
  readActorConditions,
} from "../../conditions/conditionChip.js";
import type { ConditionDisplayContract } from "../../conditions/conditionChip.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ActorOptions {
  hp?: { value: number; max: number } | null;
  derivedHp?: { value: number; max: number } | null;
  conditions?: { id?: string; name: string; slug?: string; value?: number }[];
}

function makeActor(options: ActorOptions = {}): Record<string, unknown> {
  const system: Record<string, unknown> = {};
  if (options.hp !== null && options.hp !== undefined) {
    system["attributes"] = { hp: { ...options.hp } };
  }
  if (options.derivedHp !== null && options.derivedHp !== undefined) {
    system["derived"] = { hp: { ...options.derivedHp } };
  }
  return {
    _id: "actor-1",
    name: "Alvo",
    type: "npc",
    system,
    items: (options.conditions ?? []).map((c, index) => ({
      _id: c.id ?? `item-${String(index)}`,
      name: c.name,
      type: "condition",
      system: {
        slug: c.slug ?? c.name.toLowerCase(),
        ...(c.value === undefined ? {} : { value: c.value }),
      },
    })),
  };
}

const creature = { actorId: "actor-1", hasPlayerOwner: false };
const playerCharacter = { actorId: "actor-1", hasPlayerOwner: true };

/**
 * The NPC the GM shared with the table at OBSERVER/LIMITED: not a player character — so
 * `hasPlayerOwner` is false and the health rule refuses its numbers — yet its document IS
 * in the player's mirror, so its conditions have a source. Same shape as `creature` on
 * purpose: the health rule cannot tell the two apart, and that is the point.
 */
const sharedNpc = { actorId: "actor-1", hasPlayerOwner: false };

// ---------------------------------------------------------------------------
// Health by role
// ---------------------------------------------------------------------------

describe("resolveHpView — health by role (REQ-CBA-040, REQ-CBA-041, REQ-CBA-042)", () => {
  it("REQ-CBA-040: privileged role reads current and maximum of every participant", () => {
    const actor = makeActor({ hp: { value: 12, max: 40 } });

    expect(resolveHpView("gm", creature, actor)).toEqual({ current: 12, max: 40 });
    expect(resolveHpView("gm", playerCharacter, actor)).toEqual({ current: 12, max: 40 });
  });

  it("REQ-CBA-041: the SAME creature is health for the GM and nothing for the player", () => {
    const actor = makeActor({ hp: { value: 12, max: 40 } });

    const gmView = resolveHpView("gm", creature, actor);
    const playerView = resolveHpView("player", creature, actor);

    expect(gmView).toEqual({ current: 12, max: 40 });
    expect(playerView).toBeNull();
  });

  it("REQ-CBA-041: a player reads the health of a player character", () => {
    const actor = makeActor({ hp: { value: 21, max: 34 } });

    expect(resolveHpView("player", playerCharacter, actor)).toEqual({ current: 21, max: 34 });
  });

  it("REQ-CBA-041: no fraction, no percentage and no qualitative step survives for a creature", () => {
    const actor = makeActor({ hp: { value: 3, max: 60 } });

    // The rule returns a value or nothing: there is no third shape a player could read a
    // "bloodied"/"almost down" step out of.
    const playerView = resolveHpView("player", creature, actor);
    expect(playerView).toBeNull();
    expect(JSON.stringify(playerView)).not.toContain("3");
    expect(JSON.stringify(playerView)).not.toContain("60");
  });

  it("REQ-CBA-042: the pair carries the level as numbers, so a bar never has to say it in colour alone", () => {
    const actor = makeActor({ hp: { value: 7, max: 28 } });
    const view = resolveHpView("gm", creature, actor);

    expect(view).not.toBeNull();
    expect(typeof view?.current).toBe("number");
    expect(typeof view?.max).toBe("number");
  });
});

describe("resolveHpView — unresolvable health is omitted (REQ-CBA-043)", () => {
  it("REQ-CBA-043: an actor the client does not have yields null, not a full bar", () => {
    expect(resolveHpView("gm", creature, null)).toBeNull();
    expect(resolveHpView("gm", creature, undefined)).toBeNull();
  });

  it("REQ-CBA-043: an actor without a health block yields null, not zero", () => {
    expect(resolveHpView("gm", creature, makeActor({}))).toBeNull();
  });

  it("REQ-CBA-043: a non-numeric or zero maximum is unresolvable, never a marker", () => {
    const broken = { _id: "a", system: { attributes: { hp: { value: 5, max: "muitos" } } } };
    expect(resolveHpView("gm", creature, broken)).toBeNull();
    expect(resolveHpView("gm", creature, makeActor({ hp: { value: 0, max: 0 } }))).toBeNull();
  });

  it("REQ-CBA-043: zero current with a real maximum IS resolvable — a downed participant reads 0/40", () => {
    expect(resolveHpView("gm", creature, makeActor({ hp: { value: 0, max: 40 } }))).toEqual({
      current: 0,
      max: 40,
    });
  });

  it("REQ-CBA-040: the derived block wins over the stored attributes, like the sheets read it", () => {
    const actor = makeActor({ hp: { value: 10, max: 10 }, derivedHp: { value: 4, max: 33 } });
    expect(readActorHealth(actor)).toEqual({ current: 4, max: 33 });
  });
});

// ---------------------------------------------------------------------------
// Conditions keep being drawn (REQ-CBA-050..054)
// ---------------------------------------------------------------------------

describe("conditions and health answer to opposite rules (REQ-CBA-053)", () => {
  it("REQ-CBA-053: the shared NPC whose health a player may not read still shows its conditions", () => {
    // The actor a player's mirror really holds in this case: shared at OBSERVER, so the
    // document is there; not owned, so `hasPlayerOwner` is false and the health rule bites.
    const actor = makeActor({
      hp: { value: 12, max: 40 },
      conditions: [{ name: "Amedrontado", slug: "frightened", value: 2 }],
    });

    const gm = resolveCombatantVitals("gm", sharedNpc, actor);
    const player = resolveCombatantVitals("player", sharedNpc, actor);

    expect(gm.health).toEqual({ current: 12, max: 40 });
    expect(player.health).toBeNull();
    expect(player.conditions.map((c) => c.label)).toEqual(["Amedrontado 2"]);
    expect(player.conditions).toEqual(gm.conditions);
  });

  it("REQ-CBA-054: a condition added to the actor shows up on the next resolve, with no reopening", () => {
    const before = resolveCombatantVitals("player", creature, makeActor({ conditions: [] }));
    const after = resolveCombatantVitals(
      "player",
      creature,
      makeActor({ conditions: [{ name: "Atordoado", slug: "stunned", value: 1 }] }),
    );

    expect(before.conditions).toHaveLength(0);
    expect(after.conditions.map((c) => c.label)).toEqual(["Atordoado 1"]);
  });

  it("REQ-CBA-050: an actor missing from this client resolves to no conditions and no health", () => {
    const vitals = resolveCombatantVitals("player", creature, null);
    expect(vitals.health).toBeNull();
    expect(vitals.conditions).toEqual([]);
  });
});

describe("buildCombatVitals — the whole encounter at once (REQ-CBA-040, REQ-CBA-041)", () => {
  it("REQ-CBA-041: one map, one role, and only the player characters carry health for a player", () => {
    const actors = new Map<string, Record<string, unknown>>([
      ["pc", makeActor({ hp: { value: 18, max: 22 } })],
      ["mob", makeActor({ hp: { value: 5, max: 90 } })],
    ]);
    const combatants = [
      { _id: "c1", actorId: "pc", hasPlayerOwner: true },
      { _id: "c2", actorId: "mob", hasPlayerOwner: false },
      { _id: "c3", actorId: null, hasPlayerOwner: false },
    ];

    const forPlayer = buildCombatVitals("player", combatants, actors);
    const forGm = buildCombatVitals("gm", combatants, actors);

    expect(forPlayer.get("c1")?.health).toEqual({ current: 18, max: 22 });
    expect(forPlayer.get("c2")?.health).toBeNull();
    expect(forPlayer.get("c3")?.health).toBeNull();

    expect(forGm.get("c1")?.health).toEqual({ current: 18, max: 22 });
    expect(forGm.get("c2")?.health).toEqual({ current: 5, max: 90 });
    // REQ-CBA-043: a participant with no actor is omitted for the GM too.
    expect(forGm.get("c3")?.health).toBeNull();
  });

  it("REQ-CBA-053: fed a PLAYER's real mirror, the shared NPC keeps its tags and the plain creature has no source", () => {
    // `actorsById` here is what the panel actually builds for a player: the mirror after the
    // server's ownership filter. The shared NPC is in it; the goblin, whose ownership
    // resolves to NONE, is not — no `undefined` entry, no empty document, simply absent.
    const playerMirror = new Map<string, Record<string, unknown>>([
      [
        "shared-npc",
        makeActor({
          hp: { value: 12, max: 40 },
          conditions: [{ name: "Amedrontado", slug: "frightened", value: 2 }],
        }),
      ],
    ]);
    const combatants = [
      { _id: "c1", actorId: "shared-npc", hasPlayerOwner: false },
      { _id: "c2", actorId: "goblin", hasPlayerOwner: false },
    ];

    const forPlayer = buildCombatVitals("player", combatants, playerMirror);

    // The half REQ-CBA-053 is a rule about, and this module keeps it: no health, tag drawn.
    expect(forPlayer.get("c1")?.health).toBeNull();
    expect(forPlayer.get("c1")?.conditions.map((c) => c.label)).toEqual(["Amedrontado 2"]);

    // The half that is a MISSING SOURCE, pinned here so nobody reads the empty list as a
    // decision of this module: the goblin's document never reaches the player, so there is
    // no condition to draw. Closing this is the server's, at the single redaction module —
    // open question of this phase. When it is closed, THIS assertion is what should fail.
    expect(forPlayer.get("c2")?.health).toBeNull();
    expect(forPlayer.get("c2")?.conditions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The condition contract (REQ-CBA-050..052, REQ-CTT-030..038)
// ---------------------------------------------------------------------------

describe("condition chips follow the system's declaration (REQ-CBA-050, REQ-CTT-031..035)", () => {
  const declared: Record<string, ConditionDisplayContract> = {
    frightened: { label: "Amedrontado", tone: "harm", help: "Penalidade de condição em tudo." },
    "quickened-boon": { label: "Apressado", tone: "benefit" },
    unconscious: { label: "Inconsciente", tone: "harm", critical: true },
  };
  const lookup = (slug: string): ConditionDisplayContract | undefined => declared[slug];

  it("REQ-CTT-031 / REQ-CBA-050: the colour comes from the declared tone, never from the effects", () => {
    const chip = buildConditionChip(
      { id: "i1", slug: "frightened", name: "Frightened", value: 2 },
      lookup("frightened"),
    );
    expect(chip.tone).toBe("harm");
    expect(chip.label).toBe("Amedrontado 2");
  });

  it("REQ-CTT-033: the value is part of the label, with no parentheses and no second tag", () => {
    const chip = buildConditionChip({
      id: "i1",
      slug: "frightened",
      name: "Amedrontado",
      value: 3,
    });
    expect(chip.label).toBe("Amedrontado 3");
    expect(chip.label).not.toContain("(");
  });

  it("REQ-CTT-032: critical is emphasis on an existing tone, never a fourth tone", () => {
    const chip = buildConditionChip(
      { id: "i1", slug: "unconscious", name: "Unconscious", value: null },
      lookup("unconscious"),
    );
    expect(chip.critical).toBe(true);
    expect(chip.tone).toBe("harm");
  });

  it("REQ-CTT-035: an undeclared condition degrades to a situation and is still drawn", () => {
    const chip = buildConditionChip({
      id: "i1",
      slug: "enfeitiçado",
      name: "Enfeitiçado",
      value: null,
    });
    expect(chip.tone).toBe("special");
    expect(chip.help).toBeNull();
    expect(chip.label).toBe("Enfeitiçado");
  });

  it("REQ-CTT-035: an invalid tone degrades instead of invalidating the condition", () => {
    const chip = buildConditionChip({ id: "i1", slug: "x", name: "X", value: null }, {
      tone: "catastrophic",
    } as unknown as ConditionDisplayContract);
    expect(chip.tone).toBe("special");
  });

  it("REQ-CTT-034: help travels with the chip so the panel can draw its own tooltip", () => {
    const chip = buildConditionChip(
      { id: "i1", slug: "frightened", name: "Frightened", value: 1 },
      lookup("frightened"),
    );
    expect(chip.help).toBe("Penalidade de condição em tudo.");
  });

  it("REQ-CBA-051 / REQ-CTT-036: critical, penalties, situations, benefits — alphabetical inside each", () => {
    const chips = orderConditionChips([
      buildConditionChip(
        { id: "1", slug: "a", name: "Apressado", value: null },
        { tone: "benefit" },
      ),
      buildConditionChip({ id: "2", slug: "b", name: "Zangado", value: null }, { tone: "harm" }),
      buildConditionChip(
        { id: "3", slug: "c", name: "Escondido", value: null },
        { tone: "special" },
      ),
      buildConditionChip({ id: "4", slug: "d", name: "Atordoado", value: null }, { tone: "harm" }),
      buildConditionChip(
        { id: "5", slug: "e", name: "Inconsciente", value: null },
        { tone: "harm", critical: true },
      ),
    ]);

    expect(chips.map((c) => c.label)).toEqual([
      "Inconsciente",
      "Atordoado",
      "Zangado",
      "Escondido",
      "Apressado",
    ]);
  });

  it("REQ-CBA-050: conditions are read off the actor's embedded items, already ordered", () => {
    const actor = makeActor({
      conditions: [
        { name: "Apressado", slug: "quickened-boon" },
        { name: "Amedrontado", slug: "frightened", value: 2 },
      ],
    });

    const chips = readActorConditions(actor, lookup);
    expect(chips.map((c) => c.label)).toEqual(["Amedrontado 2", "Apressado"]);
    expect(chips.map((c) => c.tone)).toEqual(["harm", "benefit"]);
  });

  it("REQ-CBA-050: items that are not conditions are ignored", () => {
    const actor = {
      _id: "a",
      items: [
        { _id: "w", name: "Espada", type: "weapon" },
        { _id: "c", name: "Cego", type: "condition", system: { slug: "blinded" } },
      ],
    };
    expect(readActorConditions(actor).map((c) => c.label)).toEqual(["Cego"]);
  });
});

// ---------------------------------------------------------------------------
// The pipeline as the panel really runs it
// ---------------------------------------------------------------------------

/**
 * Everything above feeds `buildConditionChip`/`readActorConditions` a declaration, and so
 * proves the CONTRACT of REQ-CTT-031/032/034: tone paints, critical emphasises, help travels.
 * The contract has no producer on the client yet — `CombatPanel.svelte` calls
 * `buildCombatVitals(role, combatants, actorsById)` with no fourth argument, because the
 * client cannot import a game system's registry and no socket channel carries the
 * registrations. What follows is therefore not a repetition: it is the ONLY test here that
 * runs the pipeline exactly as the screen runs it, and it states what the table sees today.
 */
describe("the panel's real call — no declaration reaches the client yet (REQ-CBA-050, REQ-CTT-035)", () => {
  const actorWithConditions = makeActor({
    hp: { value: 12, max: 40 },
    conditions: [
      { name: "Inconsciente", slug: "unconscious" },
      { name: "Amedrontado", slug: "frightened", value: 2 },
    ],
  });
  const combatants = [{ _id: "c1", actorId: "actor-1", hasPlayerOwner: false }];
  const actors = new Map<string, Record<string, unknown>>([["actor-1", actorWithConditions]]);

  it("REQ-CTT-035 / REQ-CBA-050: with no lookup, every condition is still drawn — and every one degrades", () => {
    const chips = buildCombatVitals("gm", combatants, actors).get("c1")?.conditions ?? [];

    // Fail open, the half that holds: nothing is hidden, the labels and values survive whole
    // (REQ-CTT-033), and the ordering still runs.
    expect(chips.map((c) => c.label)).toEqual(["Amedrontado 2", "Inconsciente"]);

    // Fail open, the half that costs: with nothing declared, every chip is a situation with
    // no tooltip and no emphasis — including "Inconsciente", which the system declares
    // critical and which this screen therefore does NOT emphasise today.
    expect(chips.map((c) => c.tone)).toEqual(["special", "special"]);
    expect(chips.map((c) => c.help)).toEqual([null, null]);
    expect(chips.map((c) => c.critical)).toEqual([false, false]);
  });

  it("REQ-CTT-031 / REQ-CTT-032 / REQ-CTT-034: the same actor, fed a declaration, is a different drawing", () => {
    // The gap measured against itself: one argument separates what the contract promises
    // from what the screen shows. When the registry reaches the client, the assertions above
    // are the ones that must fail — not these.
    const declared: Record<string, ConditionDisplayContract> = {
      unconscious: { label: "Inconsciente", tone: "harm", critical: true, help: "Fora de si." },
      frightened: { label: "Amedrontado", tone: "harm", help: "Penalidade em tudo." },
    };
    const chips =
      buildCombatVitals("gm", combatants, actors, (slug) => declared[slug]).get("c1")?.conditions ??
      [];

    expect(chips.map((c) => c.label)).toEqual(["Inconsciente", "Amedrontado 2"]);
    expect(chips.map((c) => c.tone)).toEqual(["harm", "harm"]);
    expect(chips.map((c) => c.critical)).toEqual([true, false]);
    expect(chips.map((c) => c.help)).toEqual(["Fora de si.", "Penalidade em tudo."]);
  });
});
