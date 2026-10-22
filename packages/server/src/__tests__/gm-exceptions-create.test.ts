import { describe, it, expect } from "vitest";
import { stripGmExceptionsOnCreate } from "../documents/gm-exceptions.js";

const item = {
  name: "x",
  system: { currency: { gp: 1 }, build: { plan: 1, gmExceptions: { a: 1 } } },
};

describe("stripGmExceptionsOnCreate (BHR-F7-02)", () => {
  it("drops gmExceptions for a non-privileged creator and keeps the rest", () => {
    expect(stripGmExceptionsOnCreate(item, false)).toEqual({
      name: "x",
      system: { currency: { gp: 1 }, build: { plan: 1 } },
    });
  });
  it("keeps everything for a privileged creator", () => {
    expect(stripGmExceptionsOnCreate(item, true)).toBe(item);
  });
  it("leaves payloads without the field untouched", () => {
    const plain = { system: { build: { plan: 1 } } };
    expect(stripGmExceptionsOnCreate(plain, false)).toBe(plain);
    const none = { name: "y" };
    expect(stripGmExceptionsOnCreate(none, false)).toBe(none);
  });
});
