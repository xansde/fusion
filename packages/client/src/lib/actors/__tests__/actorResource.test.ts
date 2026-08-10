/**
 * actorResource.test.ts — the single dot-path resource reader.
 *
 * REQ-CNV-090 (spec 06): the bar reads `{ value, max }` at a dotted path over
 * the Actor's `system`, and must survive a path that does not resolve, a
 * non-numeric value and `max <= 0` WITHOUT throwing — the path is free text
 * typed by the GM in the token config, not a validated field.
 *
 * REQ-HUB-044 (spec 28): the Comitiva panel reads HP through this same
 * function, so a fix here fixes both surfaces.
 *
 * Pure logic — no PIXI, no DOM.
 */

import { describe, it, expect } from "vitest";
import { readResourceAt } from "../actorResource.js";

const system = {
  attributes: {
    hp: { value: 31, max: 39, temp: 4 },
    ac: { value: 18 },
    broken: { value: "muitos", max: 10 },
    dead: { value: 0, max: 0 },
  },
  resources: {
    focus: { value: 1, max: 3 },
  },
};

describe("readResourceAt — resolution", () => {
  it("reads value/max/temp at a two-segment path", () => {
    expect(readResourceAt(system, "attributes.hp")).toEqual({ value: 31, max: 39, temp: 4 });
  });

  it("defaults temp to 0 when the block carries none", () => {
    expect(readResourceAt(system, "resources.focus")).toEqual({ value: 1, max: 3, temp: 0 });
  });

  it("reads a max of 0 as-is — clamping is the caller's decision, not the reader's", () => {
    expect(readResourceAt(system, "attributes.dead")).toEqual({ value: 0, max: 0, temp: 0 });
  });
});

describe("readResourceAt — a path that does not resolve yields null, never a throw", () => {
  it("returns null for a segment that is missing", () => {
    expect(readResourceAt(system, "attributes.sanity")).toBeNull();
  });

  it("returns null when an intermediate segment is not an object", () => {
    // "attributes.hp.value" is a number — walking INTO it must not explode.
    expect(readResourceAt(system, "attributes.hp.value.deeper")).toBeNull();
  });

  it("returns null when the leaf has no numeric max (ac carries only value)", () => {
    expect(readResourceAt(system, "attributes.ac")).toBeNull();
  });

  it("returns null when value is not a number", () => {
    expect(readResourceAt(system, "attributes.broken")).toBeNull();
  });

  it("returns null for an empty or blank path", () => {
    expect(readResourceAt(system, "")).toBeNull();
    expect(readResourceAt(system, "   ")).toBeNull();
  });

  it("returns null when the system blob itself is absent or not an object", () => {
    expect(readResourceAt(null, "attributes.hp")).toBeNull();
    expect(readResourceAt(undefined, "attributes.hp")).toBeNull();
    expect(readResourceAt("nope", "attributes.hp")).toBeNull();
    expect(readResourceAt(42, "attributes.hp")).toBeNull();
  });

  it("does not walk into the prototype chain", () => {
    // A GM typing "__proto__.x" must not reach Object.prototype.
    expect(readResourceAt(system, "__proto__")).toBeNull();
    expect(readResourceAt(system, "constructor.prototype")).toBeNull();
  });

  it("returns null for a path with empty segments", () => {
    expect(readResourceAt(system, "attributes..hp")).toBeNull();
    expect(readResourceAt(system, ".attributes.hp")).toBeNull();
  });
});
