/**
 * Tests for resolveEffectiveActor (TK021, specs/41-token.md RNF-TOK-01) and
 * ActorDeltaPatchSchema (DEC-DOC-08, specs/02-modelo-de-dados.md).
 *
 * Covers:
 *  - RNF-TOK-01: one shared function resolves the effective actor; two tokens
 *    of the same base actor with different deltas resolve different health.
 *  - REQ-CNV-091: the "effective actor" a canvas bar reads is the reconstructed
 *    TokenActor for an unlinked token, base actor for a linked one.
 *  - DEC-DOC-08: `items` REPLACES the base actor's collection integrally when
 *    present in the delta; `system` deep-merges; a linked token ignores its
 *    delta entirely.
 */

import { describe, it, expect } from "vitest";
import {
  ActorDeltaPatchSchema,
  resolveEffectiveActor,
  type EffectiveActorBaseInput,
} from "../token/effectiveActor.js";

function baseActor(): EffectiveActorBaseInput {
  return {
    name: "Skeleton Guard",
    img: "skeleton.webp",
    system: {
      attributes: { hp: { value: 20, max: 20 } },
      traits: { size: "medium" },
    },
    items: [{ name: "Rusty Scimitar" }],
    effects: [],
  };
}

describe("resolveEffectiveActor — RNF-TOK-01", () => {
  it("RNF-TOK-01: two tokens of the SAME actor with different deltas resolve different health", () => {
    const actor = baseActor();

    const tokenA = {
      actorLink: false,
      actorDelta: { system: { attributes: { hp: { value: 12, max: 20 } } } },
    };
    const tokenB = {
      actorLink: false,
      actorDelta: { system: { attributes: { hp: { value: 3, max: 20 } } } },
    };

    const effectiveA = resolveEffectiveActor(tokenA, actor);
    const effectiveB = resolveEffectiveActor(tokenB, actor);

    expect(effectiveA.system.attributes).toEqual({ hp: { value: 12, max: 20 } });
    expect(effectiveB.system.attributes).toEqual({ hp: { value: 3, max: 20 } });
    // The base actor object itself is never mutated by either resolution.
    expect(actor.system.attributes).toEqual({ hp: { value: 20, max: 20 } });
  });

  it("REQ-DOC-032: actorLink === true resolves to the base actor untouched, delta ignored", () => {
    const actor = baseActor();
    const token = {
      actorLink: true,
      // Present but must be ignored entirely — a linked token never applies its delta.
      actorDelta: { name: "SHOULD NOT APPEAR", system: { attributes: { hp: { value: 1 } } } },
    };

    const effective = resolveEffectiveActor(token, actor);

    expect(effective).toBe(actor); // same reference: no reconstruction happened
    expect(effective.name).toBe("Skeleton Guard");
  });

  it("REQ-DOC-032: a null delta resolves to the base actor untouched, even when actorLink is false", () => {
    const actor = baseActor();
    const token = { actorLink: false, actorDelta: null };

    const effective = resolveEffectiveActor(token, actor);

    expect(effective).toBe(actor);
  });

  it("DEC-DOC-08: a delta's `items` REPLACES the base actor's item list integrally", () => {
    const actor = baseActor();
    const token = {
      actorLink: false,
      actorDelta: { items: [{ name: "Broken Shield" }, { name: "Notched Axe" }] },
    };

    const effective = resolveEffectiveActor(token, actor);

    expect(effective.items).toEqual([{ name: "Broken Shield" }, { name: "Notched Axe" }]);
    // Never a merge of the two lists — the original item is gone, not appended to.
    expect(effective.items).not.toContainEqual({ name: "Rusty Scimitar" });
  });

  it("DEC-DOC-08: `system` deep-merges over the base actor's system, preserving untouched siblings", () => {
    const actor = baseActor();
    const token = {
      actorLink: false,
      actorDelta: { system: { attributes: { hp: { value: 5 } } } },
    };

    const effective = resolveEffectiveActor(token, actor);

    // hp.value patched, hp.max survives from the base actor (deep merge, not replace).
    expect(effective.system.attributes).toEqual({ hp: { value: 5, max: 20 } });
    // A sibling of `attributes` never mentioned in the delta survives untouched.
    expect(effective.system.traits).toEqual({ size: "medium" });
  });

  it("DEC-DOC-08: `name`/`img` replace outright when present in the delta", () => {
    const actor = baseActor();
    const token = {
      actorLink: false,
      actorDelta: { name: "Animated Skeleton #3", img: null },
    };

    const effective = resolveEffectiveActor(token, actor);

    expect(effective.name).toBe("Animated Skeleton #3");
    expect(effective.img).toBeNull();
  });

  it("an empty delta object resolves to a copy equal to the base actor", () => {
    const actor = baseActor();
    const token = { actorLink: false, actorDelta: {} };

    const effective = resolveEffectiveActor(token, actor);

    expect(effective).toEqual(actor);
  });
});

describe("ActorDeltaPatchSchema — DEC-DOC-08 merge patch shape", () => {
  it("accepts a partial patch with only `system`", () => {
    const result = ActorDeltaPatchSchema.safeParse({ system: { hp: 5 } });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object (no fields patched)", () => {
    expect(ActorDeltaPatchSchema.safeParse({}).success).toBe(true);
  });

  it("accepts `img: null`", () => {
    expect(ActorDeltaPatchSchema.safeParse({ img: null }).success).toBe(true);
  });

  it("rejects a non-array `items`", () => {
    const result = ActorDeltaPatchSchema.safeParse({ items: "not-an-array" });
    expect(result.success).toBe(false);
  });
});
