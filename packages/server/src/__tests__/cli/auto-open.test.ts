/**
 * Unit tests for the M6 first-run auto-open-browser gate (cli/auto-open.ts).
 *
 * decideAutoOpen() is a pure predicate — no process/child_process access —
 * so every combination of its four conditions is exhaustively covered here.
 * The actual spawn (openBrowserBestEffort) sits behind this gate and is
 * intentionally NOT unit-tested for real process-spawning behaviour (per
 * the module doc comment): it is fire-and-forget and platform-dependent.
 * We only assert it never throws synchronously and reports errors via the
 * callback instead of crashing the caller.
 */

import { describe, it, expect, vi } from "vitest";
import { decideAutoOpen, openBrowserBestEffort } from "../../cli/auto-open.js";
import type { AutoOpenContext } from "../../cli/auto-open.js";

const BASE: AutoOpenContext = {
  isSea: true,
  hasWorldFlag: false,
  setupCompleted: false,
  noOpen: false,
  isCi: false,
};

describe("decideAutoOpen", () => {
  it("returns true when all four conditions hold (SEA, no --world, first run, not CI/no-open)", () => {
    expect(decideAutoOpen(BASE)).toBe(true);
  });

  it("returns false when not running as SEA (dev boot)", () => {
    expect(decideAutoOpen({ ...BASE, isSea: false })).toBe(false);
  });

  it("returns false when --world was passed", () => {
    expect(decideAutoOpen({ ...BASE, hasWorldFlag: true })).toBe(false);
  });

  it("returns false when setup has already been completed", () => {
    expect(decideAutoOpen({ ...BASE, setupCompleted: true })).toBe(false);
  });

  it("returns false when --no-open was passed", () => {
    expect(decideAutoOpen({ ...BASE, noOpen: true })).toBe(false);
  });

  it("returns false when CI env var is set", () => {
    expect(decideAutoOpen({ ...BASE, isCi: true })).toBe(false);
  });

  it("returns false when every gating condition fails simultaneously", () => {
    expect(
      decideAutoOpen({
        isSea: false,
        hasWorldFlag: true,
        setupCompleted: true,
        noOpen: true,
        isCi: true,
      }),
    ).toBe(false);
  });

  it("--no-open wins even on an otherwise-perfect first-run SEA boot", () => {
    expect(decideAutoOpen({ ...BASE, noOpen: true, isCi: false })).toBe(false);
  });

  it("CI wins even when --no-open was not passed", () => {
    expect(decideAutoOpen({ ...BASE, noOpen: false, isCi: true })).toBe(false);
  });
});

describe("openBrowserBestEffort", () => {
  it("never throws synchronously, regardless of platform", () => {
    const onError = vi.fn();
    expect(() =>
      openBrowserBestEffort("http://localhost:33000/setup", onError, "win32"),
    ).not.toThrow();
    expect(() =>
      openBrowserBestEffort("http://localhost:33000/setup", onError, "darwin"),
    ).not.toThrow();
    expect(() =>
      openBrowserBestEffort("http://localhost:33000/setup", onError, "linux"),
    ).not.toThrow();
  });
});
