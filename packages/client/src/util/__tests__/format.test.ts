import { describe, it, expect } from "vitest";
import { formatVersion, clamp, truncate } from "../format.js";

describe("formatVersion", () => {
  it("combines engine version and protocol version", () => {
    expect(formatVersion("0.1.0", 1)).toBe("v0.1.0 (protocol 1)");
  });

  it("works with larger version numbers", () => {
    expect(formatVersion("1.2.3", 7)).toBe("v1.2.3 (protocol 7)");
  });
});

describe("clamp", () => {
  it("returns the value when within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min when below range", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it("clamps to max when above range", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles equal min and max", () => {
    expect(clamp(42, 5, 5)).toBe(5);
  });
});

describe("truncate", () => {
  it("returns the string unchanged when short enough", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns the string unchanged at exact max length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and appends ellipsis when too long", () => {
    const result = truncate("hello world", 7);
    expect(result).toBe("hello …");
    expect(result.length).toBe(7);
  });

  it("handles single-character limit", () => {
    const result = truncate("abc", 1);
    expect(result).toBe("…");
    expect(result.length).toBe(1);
  });
});
