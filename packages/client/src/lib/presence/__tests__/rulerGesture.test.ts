/**
 * rulerGesture — the rules of the gesture that opens, drags and closes the ruler.
 *
 * These tests exist because the ruler's state machine was fully tested and
 * completely unreachable: no gesture ever called startMeasuring(). Testing the
 * state machine proved the ruler could measure; it never proved a person could
 * start one. This file tests the second thing.
 */

import { describe, it, expect } from "vitest";
import { reduceRulerInput, isEditableTarget, RULER_KEY } from "../rulerGesture.js";

const CURSOR = { x: 250, y: 250 };
const OPEN = true;
const CLOSED = false;

const keyDown = (key: string, over: Partial<{ inEditable: boolean; repeat: boolean }> = {}) =>
  ({ kind: "key-down", key, inEditable: false, repeat: false, ...over }) as const;

describe("opening the ruler", () => {
  it("R opens it at the cursor", () => {
    expect(reduceRulerInput(CLOSED, keyDown(RULER_KEY), CURSOR)).toEqual({
      kind: "start",
      origin: CURSOR,
    });
  });

  it("accepts an uppercase R (Shift held)", () => {
    expect(reduceRulerInput(CLOSED, keyDown("R"), CURSOR).kind).toBe("start");
  });

  it("does NOT open while the user is typing in a field", () => {
    expect(reduceRulerInput(CLOSED, keyDown(RULER_KEY, { inEditable: true }), CURSOR)).toEqual({
      kind: "none",
    });
  });

  it("does NOT restart on auto-repeat — holding R would discard the waypoints", () => {
    expect(reduceRulerInput(OPEN, keyDown(RULER_KEY, { repeat: true }), CURSOR)).toEqual({
      kind: "none",
    });
    expect(reduceRulerInput(CLOSED, keyDown(RULER_KEY, { repeat: true }), CURSOR)).toEqual({
      kind: "none",
    });
  });

  it("does nothing when the pointer has never been over the canvas", () => {
    expect(reduceRulerInput(CLOSED, keyDown(RULER_KEY), null)).toEqual({ kind: "none" });
  });

  it("ignores any other key", () => {
    for (const k of ["a", "Shift", "Control", "1", " "]) {
      expect(reduceRulerInput(CLOSED, keyDown(k), CURSOR)).toEqual({ kind: "none" });
    }
  });
});

describe("closing the ruler", () => {
  it("releasing R closes it", () => {
    expect(reduceRulerInput(OPEN, { kind: "key-up", key: RULER_KEY }, CURSOR)).toEqual({
      kind: "clear",
    });
  });

  it("Escape closes it", () => {
    expect(reduceRulerInput(OPEN, keyDown("Escape"), CURSOR)).toEqual({ kind: "clear" });
  });

  it("losing window focus closes it — no ruler left stuck on screen", () => {
    expect(reduceRulerInput(OPEN, { kind: "blur" }, CURSOR)).toEqual({ kind: "clear" });
  });

  it("closing gestures are inert when the ruler is already closed", () => {
    expect(reduceRulerInput(CLOSED, { kind: "key-up", key: RULER_KEY }, CURSOR).kind).toBe("none");
    expect(reduceRulerInput(CLOSED, keyDown("Escape"), CURSOR).kind).toBe("none");
    expect(reduceRulerInput(CLOSED, { kind: "blur" }, CURSOR).kind).toBe("none");
  });
});

describe("measuring", () => {
  it("moving the pointer drags the live endpoint", () => {
    expect(reduceRulerInput(OPEN, { kind: "pointer-move", point: CURSOR }, null)).toEqual({
      kind: "live",
      point: CURSOR,
    });
  });

  it("Ctrl+click commits a waypoint and keeps measuring", () => {
    expect(
      reduceRulerInput(OPEN, { kind: "pointer-down", point: CURSOR, ctrl: true }, CURSOR),
    ).toEqual({ kind: "waypoint", point: CURSOR });
  });

  it("a plain click does NOT commit a waypoint — that gesture belongs to selection", () => {
    expect(
      reduceRulerInput(OPEN, { kind: "pointer-down", point: CURSOR, ctrl: false }, CURSOR),
    ).toEqual({ kind: "none" });
  });

  it("does nothing at all while the ruler is closed", () => {
    expect(reduceRulerInput(CLOSED, { kind: "pointer-move", point: CURSOR }, CURSOR).kind).toBe(
      "none",
    );
    expect(
      reduceRulerInput(CLOSED, { kind: "pointer-down", point: CURSOR, ctrl: true }, CURSOR).kind,
    ).toBe("none");
  });
});

describe("isEditableTarget", () => {
  it("treats form fields and contenteditable as typing", () => {
    expect(isEditableTarget("INPUT", false)).toBe(true);
    expect(isEditableTarget("textarea", false)).toBe(true);
    expect(isEditableTarget("SELECT", false)).toBe(true);
    expect(isEditableTarget("DIV", true)).toBe(true);
  });

  it("treats the canvas and plain elements as not typing", () => {
    expect(isEditableTarget("CANVAS", false)).toBe(false);
    expect(isEditableTarget("DIV", false)).toBe(false);
    expect(isEditableTarget(null, false)).toBe(false);
  });
});
