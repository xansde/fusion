import { describe, it, expect } from "vitest";
import { buildWorldUuid, buildCompendiumUuid, parseUuid, isValidUuid } from "../uuid.js";

describe("buildWorldUuid", () => {
  it("builds a simple root UUID", () => {
    const uuid = buildWorldUuid("Actor", "abc1234567890123");
    expect(uuid).toBe("Actor.abc1234567890123");
  });

  it("builds an embedded UUID", () => {
    const uuid = buildWorldUuid("Actor", "abc1234567890123", [
      { type: "Item", id: "xyz1234567890123" },
    ]);
    expect(uuid).toBe("Actor.abc1234567890123.Item.xyz1234567890123");
  });

  it("builds a deeply nested UUID", () => {
    const uuid = buildWorldUuid("Scene", "sc1234567890123x", [
      { type: "Token", id: "tk1234567890123x" },
    ]);
    expect(uuid).toBe("Scene.sc1234567890123x.Token.tk1234567890123x");
  });
});

describe("buildCompendiumUuid", () => {
  it("builds a compendium UUID", () => {
    const uuid = buildCompendiumUuid("pf2e.bestiary", "Actor", "doc123456789012");
    expect(uuid).toBe("Compendium.pf2e.bestiary.Actor.doc123456789012");
  });

  it("builds a compendium UUID with embedded path", () => {
    const uuid = buildCompendiumUuid("pf2e.bestiary", "Actor", "doc123456789012", [
      { type: "Item", id: "itm123456789012x" },
    ]);
    expect(uuid).toBe("Compendium.pf2e.bestiary.Actor.doc123456789012.Item.itm123456789012x");
  });
});

describe("parseUuid — world scope", () => {
  it("parses a simple world UUID", () => {
    const result = parseUuid("Actor.abc1234567890123");
    expect(result.scope).toBe("world");
    expect(result.rootType).toBe("Actor");
    expect(result.rootId).toBe("abc1234567890123");
    expect(result.embedded).toHaveLength(0);
    expect(result.packId).toBeUndefined();
  });

  it("parses an embedded world UUID", () => {
    const result = parseUuid("Actor.abc1234567890123.Item.xyz1234567890123");
    expect(result.scope).toBe("world");
    expect(result.rootType).toBe("Actor");
    expect(result.rootId).toBe("abc1234567890123");
    expect(result.embedded).toHaveLength(1);
    expect(result.embedded[0]).toEqual({ type: "Item", id: "xyz1234567890123" });
  });

  it("parses a doubly-nested world UUID", () => {
    const result = parseUuid("Actor.a0.Item.b0.ActiveEffect.c0");
    expect(result.scope).toBe("world");
    expect(result.embedded).toHaveLength(2);
    expect(result.embedded[0]).toEqual({ type: "Item", id: "b0" });
    expect(result.embedded[1]).toEqual({ type: "ActiveEffect", id: "c0" });
  });

  it("throws when there are fewer than 2 segments", () => {
    expect(() => parseUuid("Actor")).toThrow();
  });

  it("throws for an odd number of embedded segments", () => {
    // "Actor.id.Item" — 3 parts after "Actor.id" would be 1 leftover
    expect(() => parseUuid("Actor.a.Item")).toThrow();
  });

  it("throws when rootType does not start with uppercase", () => {
    expect(() => parseUuid("actor.abc1234567890123")).toThrow();
  });
});

describe("parseUuid — compendium scope", () => {
  it("parses a compendium UUID", () => {
    const result = parseUuid("Compendium.pf2e.bestiary.Actor.doc123456789012");
    expect(result.scope).toBe("compendium");
    expect(result.packId).toBe("pf2e.bestiary");
    expect(result.rootType).toBe("Actor");
    expect(result.rootId).toBe("doc123456789012");
    expect(result.embedded).toHaveLength(0);
  });

  it("parses a compendium UUID with embedded path", () => {
    const result = parseUuid(
      "Compendium.pf2e.bestiary.Actor.doc123456789012.Item.itm123456789012x",
    );
    expect(result.scope).toBe("compendium");
    expect(result.embedded).toHaveLength(1);
    expect(result.embedded[0]).toEqual({ type: "Item", id: "itm123456789012x" });
  });

  it("throws when compendium UUID has fewer than 4 segments", () => {
    expect(() => parseUuid("Compendium.pf2e.Actor")).toThrow();
  });
});

describe("isValidUuid", () => {
  it("returns true for valid world UUID", () => {
    expect(isValidUuid("Actor.abc1234567890123")).toBe(true);
  });

  it("returns true for valid compendium UUID", () => {
    expect(isValidUuid("Compendium.pf2e.bestiary.Actor.doc123456789012")).toBe(true);
  });

  it("returns false for invalid strings", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("actor.id")).toBe(false);
    expect(isValidUuid("Compendium.only3")).toBe(false);
  });
});

describe("round-trip", () => {
  it("buildWorldUuid → parseUuid round-trips correctly", () => {
    const embedded = [{ type: "Item", id: "xyz1234567890123" }];
    const uuid = buildWorldUuid("Actor", "abc1234567890123", embedded);
    const parsed = parseUuid(uuid);
    expect(parsed.scope).toBe("world");
    expect(parsed.rootType).toBe("Actor");
    expect(parsed.rootId).toBe("abc1234567890123");
    expect(parsed.embedded).toEqual(embedded);
  });

  it("buildCompendiumUuid → parseUuid round-trips correctly (2-segment packId)", () => {
    const uuid = buildCompendiumUuid("pf2e.bestiary", "Actor", "doc123456789012");
    const parsed = parseUuid(uuid);
    expect(parsed.scope).toBe("compendium");
    expect(parsed.packId).toBe("pf2e.bestiary");
    expect(parsed.rootType).toBe("Actor");
    expect(parsed.rootId).toBe("doc123456789012");
  });

  it("buildCompendiumUuid → parseUuid round-trips correctly (1-segment packId)", () => {
    const uuid = buildCompendiumUuid("mypack", "Actor", "doc123456789012");
    const parsed = parseUuid(uuid);
    expect(parsed.scope).toBe("compendium");
    expect(parsed.packId).toBe("mypack");
    expect(parsed.rootType).toBe("Actor");
    expect(parsed.rootId).toBe("doc123456789012");
  });

  it("buildCompendiumUuid → parseUuid round-trips correctly (3-segment packId)", () => {
    const uuid = buildCompendiumUuid("pf2e.sub.pack", "Actor", "doc123456789012");
    const parsed = parseUuid(uuid);
    expect(parsed.scope).toBe("compendium");
    expect(parsed.packId).toBe("pf2e.sub.pack");
    expect(parsed.rootType).toBe("Actor");
    expect(parsed.rootId).toBe("doc123456789012");
  });
});
