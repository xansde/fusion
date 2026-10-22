import { describe, it, expect } from "vitest";
import { stripTokenMarksOnCreate, touchesTokenMarksFlag } from "../token-mark.js";

const marks = [{ slug: "hunted-prey", targetTokenId: "t" }];

describe("stripTokenMarksOnCreate (BHR-F3-06)", () => {
  it("drops forged marks from a non-privileged create, keeping every other flag", () => {
    const doc = { name: "Lobo", flags: { fusion: { tokenMarks: marks, note: "x" }, other: 1 } };
    const out = stripTokenMarksOnCreate(doc, false);
    expect(touchesTokenMarksFlag(out)).toBe(false);
    expect(out).toEqual({ name: "Lobo", flags: { fusion: { note: "x" }, other: 1 } });
  });

  it("leaves a privileged create untouched, and a document with no marks as the same reference", () => {
    const doc = { flags: { fusion: { tokenMarks: marks } } };
    expect(stripTokenMarksOnCreate(doc, true)).toBe(doc);
    const plain = { flags: { fusion: { note: "x" } } };
    expect(stripTokenMarksOnCreate(plain, false)).toBe(plain);
  });
});

describe("touchesTokenMarksFlag", () => {
  it("catches the key, the namespace wipe and a non-object flags", () => {
    expect(touchesTokenMarksFlag({ flags: { fusion: { tokenMarks: [] } } })).toBe(true);
    expect(touchesTokenMarksFlag({ flags: { fusion: null } })).toBe(true);
    expect(touchesTokenMarksFlag({ flags: null })).toBe(true);
    expect(touchesTokenMarksFlag({ flags: { fusion: { note: 1 } } })).toBe(false);
    expect(touchesTokenMarksFlag({ name: "x" })).toBe(false);
  });
});
