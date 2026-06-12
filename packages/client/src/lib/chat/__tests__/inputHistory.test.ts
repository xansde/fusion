/**
 * Tests for InputHistory.
 */

import { describe, it, expect } from "vitest";
import { InputHistory } from "../inputHistory.js";

describe("InputHistory", () => {
  it("starts empty", () => {
    const h = new InputHistory();
    expect(h.length).toBe(0);
    expect(h.cursor).toBe(-1);
  });

  it("push adds entries", () => {
    const h = new InputHistory();
    h.push("hello");
    expect(h.length).toBe(1);
  });

  it("push deduplicates consecutive entries", () => {
    const h = new InputHistory();
    h.push("hello");
    h.push("hello");
    expect(h.length).toBe(1);
  });

  it("push ignores empty strings", () => {
    const h = new InputHistory();
    h.push("  ");
    expect(h.length).toBe(0);
  });

  it("navigateUp returns last entry", () => {
    const h = new InputHistory();
    h.push("first");
    h.push("second");
    expect(h.navigateUp("")).toBe("second");
  });

  it("navigateUp twice goes to earlier entry", () => {
    const h = new InputHistory();
    h.push("first");
    h.push("second");
    h.navigateUp("");
    expect(h.navigateUp("")).toBe("first");
  });

  it("navigateUp saves draft", () => {
    const h = new InputHistory();
    h.push("first");
    // Navigate up saves the draft
    h.navigateUp("my draft");
    // Navigate back down — only one entry, so next down restores draft
    const result = h.navigateDown();
    expect(result).toBe("my draft");
  });

  it("navigateDown returns draft after going past newest", () => {
    const h = new InputHistory();
    h.push("a");
    h.push("b");
    h.navigateUp("draft text");
    h.navigateUp("draft text");
    // Navigate forward: b, then draft
    h.navigateDown(); // → "b"
    const result = h.navigateDown(); // → "draft text" (draft)
    expect(result).toBe("draft text");
  });

  it("navigateDown returns null when not navigating", () => {
    const h = new InputHistory();
    expect(h.navigateDown()).toBeNull();
  });

  it("navigateUp returns null when empty", () => {
    const h = new InputHistory();
    expect(h.navigateUp("text")).toBeNull();
  });

  it("clamps navigateUp at oldest entry", () => {
    const h = new InputHistory();
    h.push("only");
    h.navigateUp("");
    const result = h.navigateUp(""); // still at "only"
    expect(result).toBe("only");
  });

  it("resetNavigation resets cursor", () => {
    const h = new InputHistory();
    h.push("a");
    h.navigateUp("");
    h.resetNavigation();
    expect(h.cursor).toBe(-1);
    expect(h.navigateDown()).toBeNull();
  });

  it("push after navigation resets cursor", () => {
    const h = new InputHistory();
    h.push("a");
    h.navigateUp("");
    h.push("b");
    expect(h.cursor).toBe(-1);
  });
});
