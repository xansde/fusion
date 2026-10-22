/**
 * Tests for readActorSizeCategory — the ONE reader of an actor's size category, shared by the
 * server (what a glimpsed contact is still owed, spec 39 REQ-CTT-081) and the client (the token's
 * footprint, spec 41 REQ-TOK-012).
 *
 * Spec 17 DEC-PF2-13 / REQ-PF2-154: the size the sheet DERIVED (`system.derived.size`, a character
 * with an ancestry) wins; `system.traits.size` is the fallback (an NPC, or a manual-entry
 * character), a bare string or, on some raw/imported rows, `{ value }`.
 */

import { describe, it, expect } from "vitest";
import { readActorSize, readActorSizeCategory } from "../token/actorSize.js";
import { resolveEffectiveActor } from "../token/effectiveActor.js";

describe("readActorSizeCategory — REQ-PF2-154", () => {
  it("reads the derived size of a character", () => {
    expect(readActorSizeCategory({ derived: { size: "lg" }, traits: { size: "med" } })).toBe("lg");
  });

  it("the derived size wins over the stored `traits.size`: nothing writes the latter for a character, so it sits at the schema default", () => {
    expect(readActorSizeCategory({ derived: { size: "sm" }, traits: { size: "lg" } })).toBe("sm");
  });

  it("falls back to `traits.size` when there is no derived size — an NPC, or a manual-entry character", () => {
    expect(readActorSizeCategory({ traits: { size: "huge" } })).toBe("huge");
    expect(readActorSizeCategory({ derived: { hp: { max: 10 } }, traits: { size: "huge" } })).toBe(
      "huge",
    );
  });

  it("reads the raw `{ value }` shape of `traits.size` (NpcSizeSchema's on-disk form)", () => {
    expect(readActorSizeCategory({ traits: { size: { value: "lg" } } })).toBe("lg");
  });

  it("a derived size that is not a size does not shadow a usable `traits.size`", () => {
    expect(readActorSizeCategory({ derived: { size: 3 }, traits: { size: "lg" } })).toBe("lg");
    expect(readActorSizeCategory({ derived: { size: "" }, traits: { size: "lg" } })).toBe("lg");
    expect(
      readActorSizeCategory({ derived: { size: { value: "lg" } }, traits: { size: "sm" } }),
    ).toBe("sm");
  });

  it("names nothing when the actor says nothing usable", () => {
    expect(readActorSizeCategory(undefined)).toBeUndefined();
    expect(readActorSizeCategory(null)).toBeUndefined();
    expect(readActorSizeCategory("lg")).toBeUndefined();
    expect(readActorSizeCategory([])).toBeUndefined();
    expect(readActorSizeCategory({})).toBeUndefined();
    expect(readActorSizeCategory({ traits: null })).toBeUndefined();
    expect(readActorSizeCategory({ traits: { size: 4 } })).toBeUndefined();
    expect(readActorSizeCategory({ traits: { size: { value: 4 } } })).toBeUndefined();
    expect(readActorSizeCategory({ derived: [], traits: [] })).toBeUndefined();
  });

  it("a category is a short token — free text, spaces and long strings are not a size (the server forwards this to a player who must not read a name)", () => {
    expect(readActorSizeCategory({ derived: { size: "Ferreiro da Vila" } })).toBeUndefined();
    expect(readActorSizeCategory({ traits: { size: "Grande demais" } })).toBeUndefined();
    expect(readActorSizeCategory({ traits: { size: "x".repeat(25) } })).toBeUndefined();
    expect(readActorSizeCategory({ traits: { size: "x".repeat(24) } })).toBe("x".repeat(24));
    expect(readActorSizeCategory({ traits: { size: "sm" } })).toBe("sm");
    expect(readActorSizeCategory({ traits: { size: "extra-large" } })).toBe("extra-large");
  });
});

describe("readActorSize — where the size was found (spec 39 REQ-CTT-081, the slot a glimpsed contact keeps)", () => {
  it("names the slot the category came from: derived for a character, traits for an NPC", () => {
    expect(readActorSize({ derived: { size: "lg" }, traits: { size: "med" } })).toEqual({
      category: "lg",
      source: "derived",
    });
    expect(readActorSize({ traits: { size: "huge" } })).toEqual({
      category: "huge",
      source: "traits",
    });
    expect(readActorSize({ traits: { size: { value: "sm" } } })).toEqual({
      category: "sm",
      source: "traits",
    });
  });

  it("names nothing when there is no usable size", () => {
    expect(readActorSize({})).toBeUndefined();
    expect(readActorSize({ traits: { size: "Grande demais" } })).toBeUndefined();
    expect(readActorSize(undefined)).toBeUndefined();
  });

  it("the shape check is a BOUND, not a name filter: a one-word value has the shape of a category (who may write the field is the GM's statblock, and a client cannot write `derived`)", () => {
    expect(readActorSize({ traits: { size: "Grimtooth" } })).toEqual({
      category: "Grimtooth",
      source: "traits",
    });
  });

  it("an unlinked token's size override still wins over a glimpsed NPC's base size: the slot is preserved, so the delta merges over it (REQ-DOC-034)", () => {
    // What a player who only glimpsed the NPC holds as its base actor: the size, in the slot it lives in.
    const glimpsedBase = { name: "", system: { traits: { size: "lg" } } };
    const token = { actorLink: false, actorDelta: { system: { traits: { size: "sm" } } } };

    const effective = resolveEffectiveActor(token, glimpsedBase);

    expect(readActorSizeCategory(effective.system)).toBe("sm");
  });
});
