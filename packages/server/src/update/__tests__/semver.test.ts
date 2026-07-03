import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, isNewerVersion } from "../semver.js";

describe("parseVersion", () => {
  it("parses a bare major.minor.patch", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("accepts a leading v", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("ignores a pre-release/build suffix", () => {
    expect(parseVersion("1.2.3-dev.1")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("returns null for unparseable input", () => {
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  it("treats unparseable versions as equal (not newer) rather than throwing", () => {
    expect(compareVersions("garbage", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "garbage")).toBe(0);
  });
});

describe("isNewerVersion", () => {
  it("returns true only when candidate is strictly greater", () => {
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(true);
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.2", "1.2.3")).toBe(false);
  });
});
