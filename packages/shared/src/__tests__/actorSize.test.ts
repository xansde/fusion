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
import { readActorSizeCategory } from "../token/actorSize.js";

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
