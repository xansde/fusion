import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, unwrap, fusionError } from "../result.js";

describe("ok", () => {
  it("creates an Ok result", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
});

describe("err", () => {
  it("creates an Err result", () => {
    const r = err("something went wrong");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("something went wrong");
  });
});

describe("isOk / isErr", () => {
  it("isOk returns true for Ok", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err("e"))).toBe(false);
  });

  it("isErr returns true for Err", () => {
    expect(isErr(err("e"))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });
});

describe("unwrap", () => {
  it("returns value for Ok", () => {
    expect(unwrap(ok("hello"))).toBe("hello");
  });

  it("throws for Err", () => {
    expect(() => unwrap(err("oops"))).toThrow();
  });
});

describe("fusionError", () => {
  it("builds a structured error", () => {
    const e = fusionError("NOT_FOUND", "Actor not found", [
      { path: ["_id"], message: "does not exist" },
    ]);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("Actor not found");
    expect(e.details).toHaveLength(1);
  });
});
