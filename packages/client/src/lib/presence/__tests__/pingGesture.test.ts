/**
 * pingGesture — the rules of press-and-hold to drop a ping on the map.
 *
 * The ping travelled end to end since M1-E (emitPing, the server rate limiter,
 * the store) and no human could ever fire one: nothing called emitPing. These
 * tests cover the half that was missing — what the user's hand does — and in
 * particular the two ways a hold must NOT become a ping, because both of them
 * are gestures the map already uses: a click selects, a drag pans or moves a
 * token.
 */

import { describe, it, expect } from "vitest";
import {
  PingGesture,
  PING_HOLD_MS,
  PING_MOVE_TOLERANCE_PX,
  PING_TOUCH_TOLERANCE_PX,
  type PingEffect,
} from "../pingGesture.js";

const ORIGIN = { x: 300, y: 200 };
const NONE: PingEffect = { kind: "none" };

/** Press at ORIGIN at t=0 and return the gesture, ready for the next input. */
function pressed(): PingGesture {
  const g = new PingGesture();
  g.handle({ kind: "pointer-down", point: ORIGIN, button: 0, time: 0 });
  return g;
}

describe("firing the ping", () => {
  it("fires at the press point once the hold time elapses", () => {
    const g = pressed();
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: ORIGIN,
    });
  });

  it("does not fire before the hold time elapses", () => {
    const g = pressed();
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS - 1 })).toEqual(NONE);
  });

  it("fires only once — holding longer does not spray pings", () => {
    const g = pressed();
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS }).kind).toBe("ping");
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS + 500 })).toEqual(NONE);
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS + 5000 })).toEqual(NONE);
  });

  it("fires at the ORIGINAL point even if the finger drifted a little", () => {
    // Drift within tolerance must not drag the ping around: the mark belongs
    // where the user pressed, not where their hand ended up.
    const g = pressed();
    g.handle({
      kind: "pointer-move",
      point: { x: ORIGIN.x + PING_MOVE_TOLERANCE_PX - 1, y: ORIGIN.y },
      time: 100,
    });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: ORIGIN,
    });
  });
});

describe("gestures that must NOT become a ping", () => {
  it("a plain click — released before the hold time", () => {
    const g = pressed();
    g.handle({ kind: "pointer-up", time: PING_HOLD_MS - 50 });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS + 1000 })).toEqual(NONE);
  });

  it("a drag — the pointer left the tolerance radius", () => {
    const g = pressed();
    g.handle({
      kind: "pointer-move",
      point: { x: ORIGIN.x + PING_MOVE_TOLERANCE_PX + 1, y: ORIGIN.y },
      time: 50,
    });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("a drag measured diagonally, not per-axis", () => {
    // 7px on each axis is under tolerance per-axis but ~9.9px of real travel.
    const g = pressed();
    const d = PING_MOVE_TOLERANCE_PX - 1;
    g.handle({ kind: "pointer-move", point: { x: ORIGIN.x + d, y: ORIGIN.y + d }, time: 50 });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("a cancelled drag does not re-arm when the pointer comes back", () => {
    const g = pressed();
    g.handle({ kind: "pointer-move", point: { x: ORIGIN.x + 100, y: ORIGIN.y }, time: 50 });
    g.handle({ kind: "pointer-move", point: ORIGIN, time: 100 });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("a right-click — that button already toggles a target", () => {
    const g = new PingGesture();
    g.handle({ kind: "pointer-down", point: ORIGIN, button: 2, time: 0 });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("a middle-click — that button pans", () => {
    const g = new PingGesture();
    g.handle({ kind: "pointer-down", point: ORIGIN, button: 1, time: 0 });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("losing the window mid-hold", () => {
    const g = pressed();
    g.handle({ kind: "cancel" });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("a tick with no press at all", () => {
    const g = new PingGesture();
    expect(g.handle({ kind: "tick", time: 99999 })).toEqual(NONE);
  });
});

describe("the click that ends a ping", () => {
  it("is suppressed, so releasing does not also select what is underneath", () => {
    const g = pressed();
    g.handle({ kind: "tick", time: PING_HOLD_MS });
    expect(g.handle({ kind: "pointer-up", time: PING_HOLD_MS + 10 })).toEqual({
      kind: "suppress-click",
    });
  });

  it("is NOT suppressed when the hold never fired", () => {
    const g = pressed();
    expect(g.handle({ kind: "pointer-up", time: PING_HOLD_MS - 50 })).toEqual(NONE);
  });
});

describe("consecutive gestures", () => {
  it("a second hold fires again after the first completed", () => {
    const g = pressed();
    g.handle({ kind: "tick", time: PING_HOLD_MS });
    g.handle({ kind: "pointer-up", time: PING_HOLD_MS + 10 });

    const second = { x: 10, y: 20 };
    g.handle({ kind: "pointer-down", point: second, button: 0, time: 1000 });
    expect(g.handle({ kind: "tick", time: 1000 + PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: second,
    });
  });

  it("times the hold from the new press, not from the previous one", () => {
    const g = pressed();
    g.handle({ kind: "pointer-up", time: 10 });
    g.handle({ kind: "pointer-down", point: ORIGIN, button: 0, time: 5000 });
    expect(g.handle({ kind: "tick", time: 5000 + PING_HOLD_MS - 1 })).toEqual(NONE);
    expect(g.handle({ kind: "tick", time: 5000 + PING_HOLD_MS }).kind).toBe("ping");
  });

  it("a press that arrives while another is held restarts the hold", () => {
    // Defensive: a lost pointerup (pointer left the window) must not leave a
    // stale press that fires instantly on the next one.
    const g = pressed();
    g.handle({ kind: "pointer-down", point: { x: 1, y: 1 }, button: 0, time: 900 });
    expect(g.handle({ kind: "tick", time: 900 + PING_HOLD_MS - 1 })).toEqual(NONE);
    expect(g.handle({ kind: "tick", time: 900 + PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: { x: 1, y: 1 },
    });
  });
});

describe("Shift ping (pull view)", () => {
  it("marks the ping as a pull when Shift was down at the press", () => {
    const g = new PingGesture();
    g.handle({ kind: "pointer-down", point: { x: 5, y: 6 }, button: 0, time: 0, shift: true });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: { x: 5, y: 6 },
      pull: true,
    });
  });

  it("holds for 500 ms", () => {
    expect(PING_HOLD_MS).toBe(500);
  });
});

describe("ping on a token", () => {
  it("carries the token id of the press into the ping", () => {
    const g = new PingGesture();
    g.handle({ kind: "pointer-down", point: ORIGIN, button: 0, time: 0, tokenId: "tok1" });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: ORIGIN,
      tokenId: "tok1",
    });
  });

  it("a press on a token that moves past the tolerance is a drag, not a ping", () => {
    const g = new PingGesture();
    g.handle({ kind: "pointer-down", point: ORIGIN, button: 0, time: 0, tokenId: "tok1" });
    g.handle({
      kind: "pointer-move",
      point: { x: ORIGIN.x + PING_MOVE_TOLERANCE_PX + 1, y: ORIGIN.y },
      time: 100,
    });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual({ kind: "none" });
  });
});

describe("long press on a touch screen", () => {
  const SCREEN = { x: 400, y: 300 };

  /** A finger goes down at SCREEN; scene coordinates are scaled by the camera. */
  function touched(scale = 1): PingGesture {
    const g = new PingGesture();
    g.handle({
      kind: "pointer-down",
      point: { x: SCREEN.x / scale, y: SCREEN.y / scale },
      button: 0,
      time: 0,
      pointerType: "touch",
      pointerId: 7,
      screen: SCREEN,
    });
    return g;
  }

  it("a finger held still pings after the hold time", () => {
    const g = touched();
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual({
      kind: "ping",
      point: { x: SCREEN.x, y: SCREEN.y },
    });
  });

  it("finger tremor zoomed out (a few screen px = many scene px) still pings", () => {
    // Camera at 0.25x: 10 screen px of tremor are 40 scene px, far beyond the 8 px
    // mouse tolerance — the tolerance of a finger is measured on the screen.
    const g = touched(0.25);
    g.handle({
      kind: "pointer-move",
      point: { x: (SCREEN.x + 10) / 0.25, y: SCREEN.y / 0.25 },
      time: 100,
      pointerType: "touch",
      pointerId: 7,
      screen: { x: SCREEN.x + 10, y: SCREEN.y },
    });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS }).kind).toBe("ping");
  });

  it("a finger that travels past the touch tolerance is a drag, not a ping", () => {
    const g = touched();
    g.handle({
      kind: "pointer-move",
      point: { x: SCREEN.x + PING_TOUCH_TOLERANCE_PX + 1, y: SCREEN.y },
      time: 100,
      pointerType: "touch",
      pointerId: 7,
      screen: { x: SCREEN.x + PING_TOUCH_TOLERANCE_PX + 1, y: SCREEN.y },
    });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("a second finger (pinch) cancels the hold", () => {
    const g = touched();
    g.handle({
      kind: "pointer-down",
      point: { x: 10, y: 10 },
      button: 0,
      time: 50,
      pointerType: "touch",
      pointerId: 8,
      screen: { x: 10, y: 10 },
    });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS })).toEqual(NONE);
  });

  it("another finger moving or lifting does not disturb the hold", () => {
    const g = touched();
    g.handle({
      kind: "pointer-move",
      point: { x: 900, y: 900 },
      time: 100,
      pointerType: "touch",
      pointerId: 9,
      screen: { x: 900, y: 900 },
    });
    g.handle({ kind: "pointer-up", time: 120, pointerId: 9 });
    expect(g.handle({ kind: "tick", time: PING_HOLD_MS }).kind).toBe("ping");
  });

  it("the release after a fired long press swallows the click that follows it", () => {
    const g = touched();
    g.handle({ kind: "tick", time: PING_HOLD_MS });
    expect(g.handle({ kind: "pointer-up", time: PING_HOLD_MS + 50, pointerId: 7 })).toEqual({
      kind: "suppress-click",
    });
  });

  it("a short tap is still a plain click", () => {
    const g = touched();
    expect(g.handle({ kind: "pointer-up", time: 100, pointerId: 7 })).toEqual(NONE);
  });

  it("the mouse keeps its scene-unit tolerance", () => {
    expect(PING_TOUCH_TOLERANCE_PX).toBeGreaterThan(PING_MOVE_TOLERANCE_PX);
  });
});
