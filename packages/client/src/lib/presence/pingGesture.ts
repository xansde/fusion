/**
 * pingGesture.ts — the GESTURE rules of press-and-hold to ping the map.
 *
 * Spec: 04-rede-e-sincronizacao.md (presence:ping ephemeral, REQ-NET-041)
 * Spec: 06-canvas-e-renderizacao.md (pings live in the OverlayGroup)
 *
 * The ping already existed everywhere except in the user's hand: emitPing(),
 * the server rate limiter and presenceStore.addPing() all shipped in M1-E and
 * emitPing had zero callers. This module is the missing half — it decides when
 * a press becomes a ping — and PingLayer/attachPing are the other two.
 *
 * The hard part is not firing the ping; it is NOT firing it, because the same
 * button already selects a token (click) and pans or drags (press + move). So
 * a hold only survives while the pointer stays put and the button stays down.
 *
 * Kept pure (no DOM, no PIXI, no clock) so the rules are testable under the
 * node environment: time arrives on every input. attachPing.ts is the thin DOM
 * adapter that feeds it.
 */

import type { ScenePoint } from "@fusion/shared";

/** How long the pointer must stay down, motionless, to drop a ping (ms). */
export const PING_HOLD_MS = 450;

/**
 * How far the pointer may drift during the hold before the gesture is read as
 * a drag instead (px, in scene units). Generous enough for a shaky hand on a
 * trackpad, tight enough that an intentional drag always cancels.
 */
export const PING_MOVE_TOLERANCE_PX = 8;

/** The mouse button that pings. Right-click targets; middle-click pans. */
const PING_BUTTON = 0;

/** Raw user input, already normalized away from DOM specifics. */
export type PingInput =
  | { kind: "pointer-down"; point: ScenePoint; button: number; time: number }
  | { kind: "pointer-move"; point: ScenePoint; time: number }
  | { kind: "pointer-up"; time: number }
  /** Clock advanced — the only way a hold can ripen. Driven by the ticker. */
  | { kind: "tick"; time: number }
  /** Window blur, pointer cancel, scene teardown. */
  | { kind: "cancel" };

/** What the caller should do. */
export type PingEffect =
  | { kind: "none" }
  /** Drop a ping here and broadcast it. */
  | { kind: "ping"; point: ScenePoint }
  /**
   * The release that ends a fired hold. The caller must swallow the click so
   * the ping does not also select whatever sits under the pointer.
   */
  | { kind: "suppress-click" };

const NONE: PingEffect = { kind: "none" };

type Phase =
  /** No button down, or the press was disqualified. */
  | { name: "idle" }
  /** Button down, still eligible: motionless and not yet ripe. */
  | { name: "holding"; origin: ScenePoint; since: number }
  /** The ping already fired; waiting for the release to swallow. */
  | { name: "fired" };

const IDLE: Phase = { name: "idle" };

/**
 * Press-and-hold recognizer for map pings.
 *
 * One instance per attached canvas. Stateful by nature (a hold is a span of
 * time, not an event), but the state is three cases wide and carries no
 * ambient clock, so every rule below is reachable from a test.
 */
export class PingGesture {
  private _phase: Phase = IDLE;

  /**
   * Feed one input and get back what to do.
   *
   * Rules:
   *   - Pressing the left button starts a hold at that point.
   *   - The hold ripens into a ping after PING_HOLD_MS of motionless press.
   *   - Moving beyond PING_MOVE_TOLERANCE_PX disqualifies the press for good;
   *     coming back does not re-arm it (that gesture was a drag).
   *   - Releasing early is a plain click and produces nothing.
   *   - Releasing after firing asks the caller to swallow that click.
   *   - A ping fires at most once per press.
   */
  handle(input: PingInput): PingEffect {
    switch (input.kind) {
      case "pointer-down": {
        // A fresh press always supersedes whatever came before, including a
        // press whose release was lost outside the window.
        this._phase =
          input.button === PING_BUTTON
            ? { name: "holding", origin: input.point, since: input.time }
            : IDLE;
        return NONE;
      }

      case "pointer-move": {
        if (this._phase.name !== "holding") return NONE;
        if (distance(this._phase.origin, input.point) > PING_MOVE_TOLERANCE_PX) {
          this._phase = IDLE;
        }
        return NONE;
      }

      case "tick": {
        if (this._phase.name !== "holding") return NONE;
        if (input.time - this._phase.since < PING_HOLD_MS) return NONE;
        const point = this._phase.origin;
        this._phase = { name: "fired" };
        return { kind: "ping", point };
      }

      case "pointer-up": {
        const fired = this._phase.name === "fired";
        this._phase = IDLE;
        return fired ? { kind: "suppress-click" } : NONE;
      }

      case "cancel": {
        this._phase = IDLE;
        return NONE;
      }
    }
  }

  /** True while a press is eligible or has fired — used to gate the ticker. */
  get isActive(): boolean {
    return this._phase.name !== "idle";
  }
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
