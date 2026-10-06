/**
 * Turn-hook registrar — DEC-SYS-11 / DF-05 / REQ-SYS-138..142.
 *
 * Asserts by the RULE, not by an implementation detail:
 *   - multiple callbacks per event, exposed already sorted by priority
 *     descending, tie-broken by registration order (REQ-SYS-139);
 *   - duplicate id in the SAME event throws (REQ-SYS-138); the same id is
 *     fine across DIFFERENT events (separate registries per event);
 *   - `registerCombatHooks` (the pre-DEC-SYS-11 slot) keeps working AND
 *     becomes an adapter entry with id "legacy"/priority 0 (REQ-SYS-141) that
 *     forwards to the original legacy function unchanged;
 *   - `registerActorMechanics` accepts at most one registration per system
 *     (REQ-SYS-142);
 *   - `onDamageApplied` (onda 2, adversarial review finding B5 — the F1-02
 *     delivery omitted this sixth hook even though spec 15:588/:738/:1240
 *     and docs/design/alquimista/tasks.md:175/:748 already require it) joins
 *     the SAME id+priority registry, same ordering rule, exposed on the SAME
 *     `module.combat.turnHooks` — REQ-SYS-144's "single extension point", not
 *     a second registration mechanism invented ad hoc by whoever wires the
 *     server behavior (ALQ-F1-08, out of this task's scope).
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-138..142. Plan: docs/design/alquimista/tasks.md §2.2.
 */
import { describe, it, expect, vi } from "vitest";
import type { CombatDocument, CombatantDocument, DamageAppliedTarget } from "@fusion/shared";
import { defineSystem } from "../system-module.js";
import type { TurnHookContext, CombatEndHookFn, DamageAppliedHookFn } from "../combat.js";
import type { ActorMechanics } from "../actor-mechanics.js";

const VALID_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

// ---------------------------------------------------------------------------
// Fixtures — mirrors packages/shared/src/combat/__tests__/combat.test.ts
// ---------------------------------------------------------------------------

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "AbcDef1234567890",
    tokenId: "TokenId12345678",
    actorId: "ActorId12345678",
    name: "Fighter",
    img: "/img/fighter.png",
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: true,
    flags: {},
    ...overrides,
  };
}

function makeCombat(overrides: Partial<CombatDocument> = {}): CombatDocument {
  return {
    _id: "CombatId12345678",
    sceneId: "SceneId12345678",
    round: 1,
    turnIndex: 0,
    activeCombatantId: null,
    started: true,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants: [],
    flags: {},
    sort: 0,
    ...overrides,
  };
}

/** Mirrors DamageAppliedTargetSchema (@fusion/shared/protocol.ts). */
function makeDamageAppliedTarget(
  overrides: Partial<DamageAppliedTarget> = {},
): DamageAppliedTarget {
  return {
    tokenId: "TokenId12345678",
    actorId: "ActorId12345678",
    name: "Fighter",
    byType: [{ type: "fire", amount: 8 }],
    total: 8,
    ...overrides,
  };
}

/** Never called in these tests — the type only needs to be assignable. */
const ctxStub = {} as TurnHookContext;

describe("TurnHookRegistrar — onTurnStart/onTurnEnd/onRoundStart/onRoundEnd/onCombatEnd", () => {
  it("exposes two onTurnStart callbacks (priority 10 then 0) already ordered", () => {
    const calls: string[] = [];
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      // Registered in reverse priority order on purpose — the exposed array
      // must be sorted, not just "registration order".
      r.onTurnStart("low", () => void calls.push("low"), { priority: 0 });
      r.onTurnStart("high", () => void calls.push("high"), { priority: 10 });
    });

    const hooks = module.combat.turnHooks.onTurnStart;
    expect(hooks.map((h) => h.id)).toEqual(["high", "low"]);
    expect(hooks.map((h) => h.priority)).toEqual([10, 0]);

    for (const hook of hooks) {
      void hook.fn({ combat: makeCombat(), combatant: makeCombatant(), actor: null }, ctxStub);
    }
    expect(calls).toEqual(["high", "low"]);
  });

  it("ties break by registration order (equal priority)", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onTurnEnd("first", () => {});
      r.onTurnEnd("second", () => {});
      r.onTurnEnd("third", () => {});
    });

    expect(module.combat.turnHooks.onTurnEnd.map((h) => h.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    // default priority is 0 for all three
    expect(module.combat.turnHooks.onTurnEnd.every((h) => h.priority === 0)).toBe(true);
  });

  it("throws when the same id is registered twice for the SAME event", () => {
    expect(() =>
      defineSystem({ ...VALID_MANIFEST }, (r) => {
        r.onTurnStart("dup", () => {});
        r.onTurnStart("dup", () => {});
      }),
    ).toThrow(/duplicate "onTurnStart" hook id "dup"/);
  });

  it("allows the same id across DIFFERENT events (separate registries)", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onTurnStart("pf2e.thing", () => {});
      r.onTurnEnd("pf2e.thing", () => {});
    });
    expect(module.combat.turnHooks.onTurnStart.map((h) => h.id)).toEqual(["pf2e.thing"]);
    expect(module.combat.turnHooks.onTurnEnd.map((h) => h.id)).toEqual(["pf2e.thing"]);
  });

  it("registers onRoundStart/onRoundEnd with the {combat, round} shape", () => {
    const seenRounds: number[] = [];
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onRoundStart("pf2e.roundStart", (e) => void seenRounds.push(e.round));
      r.onRoundEnd("pf2e.roundEnd", (e) => void seenRounds.push(e.round));
    });
    module.combat.turnHooks.onRoundStart[0]!.fn({ combat: makeCombat(), round: 3 }, ctxStub);
    module.combat.turnHooks.onRoundEnd[0]!.fn({ combat: makeCombat(), round: 3 }, ctxStub);
    expect(seenRounds).toEqual([3, 3]);
  });

  it("registers onCombatEnd with the {combat, actorIds} shape", () => {
    let received: string[] = [];
    const fn: CombatEndHookFn = (e) => {
      received = e.actorIds;
    };
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onCombatEnd("pf2e.cleanup", fn);
    });
    module.combat.turnHooks.onCombatEnd[0]!.fn(
      { combat: makeCombat(), actorIds: ["a1", "a2"] },
      ctxStub,
    );
    expect(received).toEqual(["a1", "a2"]);
  });
});

describe("onDamageApplied (onda 2 B5, REQ-SYS-142 step 5)", () => {
  it("registers with the {target, actor, sourceMessageId} shape and a TurnHookContext, same as the other five hooks", () => {
    let received: {
      target: DamageAppliedTarget;
      actor: Record<string, unknown> | null;
      sourceMessageId: string;
    } | null = null;
    const fn: DamageAppliedHookFn = (e) => {
      received = e;
    };
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onDamageApplied("pf2e.reactionTrigger", fn);
    });

    const target = makeDamageAppliedTarget();
    void module.combat.turnHooks.onDamageApplied[0]!.fn(
      { target, actor: { name: "Fighter" }, sourceMessageId: "MsgId1234567890" },
      ctxStub,
    );

    expect(received).toEqual({
      target,
      actor: { name: "Fighter" },
      sourceMessageId: "MsgId1234567890",
    });
  });

  it("is its OWN id+priority registry (DEC-SYS-11/REQ-SYS-144): sorted by priority, id space independent of the other five events", () => {
    const calls: string[] = [];
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onDamageApplied("low", () => void calls.push("low"), { priority: 0 });
      r.onDamageApplied("high", () => void calls.push("high"), { priority: 10 });
      // Same id as an onTurnStart registration below — allowed, separate event namespace.
      r.onTurnStart("high", () => {});
    });

    const hooks = module.combat.turnHooks.onDamageApplied;
    expect(hooks.map((h) => h.id)).toEqual(["high", "low"]);
    expect(hooks.map((h) => h.priority)).toEqual([10, 0]);

    for (const hook of hooks) {
      void hook.fn(
        { target: makeDamageAppliedTarget(), actor: null, sourceMessageId: "MsgId1234567890" },
        ctxStub,
      );
    }
    expect(calls).toEqual(["high", "low"]);
  });

  it("throws when the same id is registered twice for onDamageApplied", () => {
    expect(() =>
      defineSystem({ ...VALID_MANIFEST }, (r) => {
        r.onDamageApplied("dup", () => {});
        r.onDamageApplied("dup", () => {});
      }),
    ).toThrow(/duplicate "onDamageApplied" hook id "dup"/);
  });

  it("is empty when no system registers it (no legacy counterpart exists to adapt — REQ-SYS-141 never covered damage)", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, () => {});
    expect(module.combat.turnHooks.onDamageApplied).toHaveLength(0);
  });
});

describe("registerCombatHooks legacy adapter (REQ-SYS-141)", () => {
  it("turns turnStart/turnEnd/roundStart into id:'legacy' priority:0 entries", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.registerCombatHooks({
        turnStart: () => {},
        turnEnd: () => {},
        roundStart: () => {},
      });
    });

    for (const key of ["onTurnStart", "onTurnEnd", "onRoundStart"] as const) {
      const hooks = module.combat.turnHooks[key];
      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toMatchObject({ id: "legacy", priority: 0 });
    }
    // roundEnd/combatEnd have no legacy counterpart in CombatSystemHooks.
    expect(module.combat.turnHooks.onRoundEnd).toHaveLength(0);
    expect(module.combat.turnHooks.onCombatEnd).toHaveLength(0);
  });

  it("the legacy entry forwards to the original function with (combatant, combat)", () => {
    const legacyTurnStart = vi.fn();
    const combat = makeCombat();
    const combatant = makeCombatant();

    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.registerCombatHooks({ turnStart: legacyTurnStart });
    });

    const entry = module.combat.turnHooks.onTurnStart[0]!;
    void entry.fn({ combat, combatant, actor: null }, ctxStub);

    expect(legacyTurnStart).toHaveBeenCalledExactlyOnceWith(combatant, combat);
  });

  it("legacy entries coexist with explicit onX registrations, sorted together", () => {
    const calls: string[] = [];
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.registerCombatHooks({ turnStart: () => void calls.push("legacy") });
      r.onTurnStart("pf2e.priority", () => void calls.push("priority"), { priority: 5 });
    });

    const hooks = module.combat.turnHooks.onTurnStart;
    expect(hooks.map((h) => h.id)).toEqual(["pf2e.priority", "legacy"]);
  });

  it("still throws when registerCombatHooks is called more than once (unchanged behavior)", () => {
    expect(() =>
      defineSystem({ ...VALID_MANIFEST }, (r) => {
        r.registerCombatHooks({});
        r.registerCombatHooks({});
      }),
    ).toThrow(/registerCombatHooks more than once/);
  });

  it("no system already relying on registerCombatHooks needs to change", () => {
    // getTrackedResource-only registration (no turnStart/turnEnd/roundStart) —
    // must not blow up, and must not create any turnHooks entries.
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.registerCombatHooks({ getTrackedResource: () => null });
    });
    expect(module.combat.hooks).not.toBeNull();
    expect(module.combat.turnHooks.onTurnStart).toHaveLength(0);
  });
});

describe("registerActorMechanics (REQ-SYS-142)", () => {
  const mechanics: ActorMechanics = {
    applyDamage: () => ({
      diff: {},
      embeddedCreate: [],
      embeddedDelete: [],
      breakdown: [],
      flags: { droppedToZero: false, dead: false, dyingChanged: false },
    }),
    applyCondition: () => ({
      diff: {},
      embeddedCreate: [],
      embeddedDelete: [],
      breakdown: [],
      flags: { droppedToZero: false, dead: false, dyingChanged: false },
    }),
  };

  it("is null when the system registers nothing", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, () => {});
    expect(module.actorMechanics).toBeNull();
  });

  it("exposes the registered ActorMechanics on the built SystemModule", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.registerActorMechanics(mechanics);
    });
    expect(module.actorMechanics).toBe(mechanics);
  });

  it("throws when called more than once per system", () => {
    expect(() =>
      defineSystem({ ...VALID_MANIFEST }, (r) => {
        r.registerActorMechanics(mechanics);
        r.registerActorMechanics(mechanics);
      }),
    ).toThrow(/registerActorMechanics more than once/);
  });
});
