/**
 * REQ-DOC-033 / DEC-DOC-08 — the TokenActor reconstruction.
 *
 * These tests describe the BEHAVIOUR the server and the client both depend on:
 * six skeleton tokens sharing one base Actor must be able to hold six
 * independent hit-point pools without any of them owning an Actor row.
 */

import { describe, it, expect } from "vitest";

import {
  applyActorDelta,
  effectiveTokenActor,
  isActorDeltaEmpty,
  mergeActorDelta,
} from "../actor-delta.js";

const baseActor = {
  _id: "0123456789abcdef",
  name: "Esqueleto",
  type: "npc",
  img: "icons/skeleton.webp",
  system: {
    attributes: { hp: { value: 20, max: 20 }, ac: { value: 16 } },
    abilities: { str: { mod: 2 } },
  },
  items: [{ _id: "aaaaaaaaaaaaaaaa", name: "Cimitarra" }],
};

describe("applyActorDelta (REQ-DOC-033, DEC-DOC-08)", () => {
  it("an empty delta yields the base actor unchanged", () => {
    expect(applyActorDelta(baseActor, {})).toEqual(baseActor);
    expect(applyActorDelta(baseActor, null)).toEqual(baseActor);
    expect(applyActorDelta(baseActor, undefined)).toEqual(baseActor);
  });

  it("a partial system patch does not erase the rest of system", () => {
    const effective = applyActorDelta(baseActor, {
      system: { attributes: { hp: { value: 7 } } },
    });

    const system = effective["system"] as Record<string, unknown>;
    const attributes = system["attributes"] as Record<string, unknown>;
    expect(attributes["hp"]).toEqual({ value: 7, max: 20 });
    // Everything the patch did not mention survives — this is the whole point.
    expect(attributes["ac"]).toEqual({ value: 16 });
    expect(system["abilities"]).toEqual({ str: { mod: 2 } });
    expect(effective["name"]).toBe("Esqueleto");
  });

  it("scalars at the top level are overridden", () => {
    const effective = applyActorDelta(baseActor, { name: "Esqueleto 3" });
    expect(effective["name"]).toBe("Esqueleto 3");
    expect(effective["type"]).toBe("npc");
  });

  it("items in the delta REPLACE the base collection integrally (DEC-DOC-08)", () => {
    const effective = applyActorDelta(baseActor, {
      items: [{ _id: "bbbbbbbbbbbbbbbb", name: "Arco curto" }],
    });
    expect(effective["items"]).toEqual([{ _id: "bbbbbbbbbbbbbbbb", name: "Arco curto" }]);
  });

  it("items absent from the delta are inherited from the base", () => {
    const effective = applyActorDelta(baseActor, { system: { attributes: { hp: { value: 1 } } } });
    expect(effective["items"]).toEqual(baseActor.items);
  });

  it("null inside system deletes the key (REQ-DOC-037 parity)", () => {
    const effective = applyActorDelta(baseActor, { system: { attributes: { ac: null } } });
    const attributes = (effective["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect("ac" in attributes).toBe(false);
    expect(attributes["hp"]).toEqual({ value: 20, max: 20 });
  });

  it("null at the top level is a value, not a deletion", () => {
    const effective = applyActorDelta(baseActor, { img: null });
    expect(effective["img"]).toBeNull();
  });

  it("never mutates the base actor nor the delta", () => {
    const delta = { system: { attributes: { hp: { value: 3 } } } };
    const frozenBefore = structuredClone(baseActor);
    const deltaBefore = structuredClone(delta);
    applyActorDelta(baseActor, delta);
    expect(baseActor).toEqual(frozenBefore);
    expect(delta).toEqual(deltaBefore);
  });

  it("two deltas over the same base do not see each other (the six skeletons)", () => {
    const skeletonThree = applyActorDelta(baseActor, {
      system: { attributes: { hp: { value: 0 } } },
    });
    const skeletonFour = applyActorDelta(baseActor, {
      system: { attributes: { hp: { value: 18 } } },
    });

    const hpOf = (a: Record<string, unknown>): unknown =>
      (
        ((a["system"] as Record<string, unknown>)["attributes"] as Record<string, unknown>)[
          "hp"
        ] as Record<string, unknown>
      )["value"];

    expect(hpOf(skeletonThree)).toBe(0);
    expect(hpOf(skeletonFour)).toBe(18);
    expect(hpOf(baseActor as unknown as Record<string, unknown>)).toBe(20);
  });

  it("a delta whose shape does not match the actor does not throw", () => {
    expect(() => applyActorDelta(baseActor, { system: "não é um objeto" })).not.toThrow();
    expect(applyActorDelta(baseActor, { system: "não é um objeto" })["system"]).toBe(
      "não é um objeto",
    );
    expect(() => applyActorDelta(baseActor, { items: "nem isso" })).not.toThrow();
  });

  it("a missing or malformed base actor does not throw", () => {
    expect(() => applyActorDelta(null, { name: "Órfão" })).not.toThrow();
    expect(applyActorDelta(null, { name: "Órfão" })).toEqual({ name: "Órfão" });
    expect(applyActorDelta(undefined, {})).toEqual({});
  });
});

describe("mergeActorDelta — accumulating patches into the stored delta", () => {
  it("merges a new patch on top of the stored delta", () => {
    const first = mergeActorDelta({}, { system: { attributes: { hp: { value: 12 } } } });
    const second = mergeActorDelta(first, { system: { attributes: { hp: { value: 5 } } } });
    expect(second).toEqual({ system: { attributes: { hp: { value: 5 } } } });
  });

  it("keeps keys the new patch does not mention", () => {
    const first = mergeActorDelta({}, { name: "Esqueleto 3" });
    const second = mergeActorDelta(first, { system: { attributes: { hp: { value: 5 } } } });
    expect(second["name"]).toBe("Esqueleto 3");
  });

  it("stores a null instead of dropping the key, so the deletion survives the round trip", () => {
    // Deleting a key from the EFFECTIVE actor is expressed as a null in the
    // stored delta; dropping the key here would silently restore the base
    // actor's value on the next read.
    const delta = mergeActorDelta({}, { system: { attributes: { ac: null } } });
    const attributes = (delta["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect("ac" in attributes).toBe(true);
    expect(attributes["ac"]).toBeNull();

    const effective = applyActorDelta(baseActor, delta);
    const effAttrs = (effective["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect("ac" in effAttrs).toBe(false);
  });

  it("never mutates the stored delta it is given", () => {
    const stored = { system: { attributes: { hp: { value: 12 } } } };
    const before = structuredClone(stored);
    mergeActorDelta(stored, { name: "outro" });
    expect(stored).toEqual(before);
  });
});

describe("isActorDeltaEmpty", () => {
  it("recognises the empty forms", () => {
    expect(isActorDeltaEmpty({})).toBe(true);
    expect(isActorDeltaEmpty(null)).toBe(true);
    expect(isActorDeltaEmpty(undefined)).toBe(true);
    expect(isActorDeltaEmpty("nonsense")).toBe(true);
  });

  it("recognises a delta that carries something", () => {
    expect(isActorDeltaEmpty({ system: {} })).toBe(false);
  });
});

describe("effectiveTokenActor (REQ-DOC-032 / REQ-DOC-033)", () => {
  it("a linked token IS the world Actor — same reference, no copy", () => {
    const token = { actorLink: true, actorDelta: { name: "ignorado" } };
    expect(effectiveTokenActor(token, baseActor)).toBe(baseActor);
  });

  it("a token with no actorLink field behaves as linked (legacy tokens)", () => {
    expect(effectiveTokenActor({}, baseActor)).toBe(baseActor);
  });

  it("an unlinked token gets the reconstructed TokenActor", () => {
    const token = { actorLink: false, actorDelta: { name: "Esqueleto 3" } };
    expect(effectiveTokenActor(token, baseActor)?.["name"]).toBe("Esqueleto 3");
  });

  it("an unlinked token with an empty delta still reads as the base actor", () => {
    const token = { actorLink: false, actorDelta: {} };
    expect(effectiveTokenActor(token, baseActor)).toEqual(baseActor);
  });

  it("no base actor yields null — a token without an Actor has no sheet", () => {
    expect(effectiveTokenActor({ actorLink: false, actorDelta: { name: "x" } }, null)).toBeNull();
    expect(effectiveTokenActor(null, baseActor)).toBeNull();
  });
});
