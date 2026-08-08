/**
 * rulerGesture.ts — the GESTURE rules of the ruler tool, as a pure reducer.
 *
 * Spec: 06-canvas-e-renderizacao.md (ruler with grid measurement).
 *
 * Why this module exists at all: RulerStateMachine (rulerState.ts) had full
 * unit tests and was never constructed in production — there was no key
 * handler, so startMeasuring() could not be reached by any human. The state
 * machine answers "what is the ruler showing?"; this module answers "what did
 * the user just do?", which is the half that was missing.
 *
 * Kept pure (no DOM, no PIXI) so the gesture rules are testable under the
 * node environment. attachRuler.ts is the thin DOM adapter that feeds it.
 */

import type { ScenePoint } from "@fusion/shared";

/** The key that holds the ruler open while pressed. */
export const RULER_KEY = "r";

/** Raw user input, already normalized away from DOM specifics. */
export type RulerInput =
  | {
      kind: "key-down";
      key: string;
      /** True when focus is in a text field — typing "r" must not measure. */
      inEditable: boolean;
      /** True for auto-repeat; holding the key must not restart the ruler. */
      repeat: boolean;
    }
  | { kind: "key-up"; key: string }
  | { kind: "pointer-move"; point: ScenePoint }
  | { kind: "pointer-down"; point: ScenePoint; ctrl: boolean }
  | { kind: "blur" };

/** What the caller should do to the RulerStateMachine. */
export type RulerEffect =
  | { kind: "none" }
  | { kind: "start"; origin: ScenePoint }
  | { kind: "live"; point: ScenePoint }
  | { kind: "waypoint"; point: ScenePoint }
  | { kind: "clear" };

const NONE: RulerEffect = { kind: "none" };

/**
 * Decide what a single input does, given whether the ruler is currently open.
 *
 * Rules:
 *   - `R` (not repeating, not while typing) opens the ruler at the cursor.
 *   - Releasing `R`, pressing Escape, or losing window focus closes it.
 *   - While open, moving the pointer drags the live endpoint.
 *   - While open, Ctrl+click commits a waypoint and keeps measuring.
 *   - Everything else is inert. In particular, nothing happens while the
 *     ruler is closed except the opening gesture itself.
 *
 * @param measuring Whether the ruler is currently open.
 * @param input     The normalized user input.
 * @param cursor    Last known cursor position in scene coordinates; null when
 *                  the pointer has not been over the canvas yet.
 */
export function reduceRulerInput(
  measuring: boolean,
  input: RulerInput,
  cursor: ScenePoint | null,
): RulerEffect {
  switch (input.kind) {
    case "key-down": {
      if (input.key.toLowerCase() === "escape") {
        return measuring ? { kind: "clear" } : NONE;
      }
      if (input.key.toLowerCase() !== RULER_KEY) return NONE;
      // Typing "r" into a chat box or a name field is not a measurement.
      if (input.inEditable) return NONE;
      // Auto-repeat would restart the ruler and throw away the waypoints.
      if (input.repeat) return NONE;
      if (measuring) return NONE;
      // Without a cursor position there is no origin to measure from.
      if (!cursor) return NONE;
      return { kind: "start", origin: cursor };
    }

    case "key-up": {
      if (input.key.toLowerCase() !== RULER_KEY) return NONE;
      return measuring ? { kind: "clear" } : NONE;
    }

    case "pointer-move":
      return measuring ? { kind: "live", point: input.point } : NONE;

    case "pointer-down":
      if (!measuring) return NONE;
      return input.ctrl ? { kind: "waypoint", point: input.point } : NONE;

    case "blur":
      return measuring ? { kind: "clear" } : NONE;
  }
}

/**
 * Whether a DOM element should swallow the ruler key.
 * Exported so the adapter and the tests agree on what "typing" means.
 */
export function isEditableTarget(tagName: string | null, isContentEditable: boolean): boolean {
  if (isContentEditable) return true;
  if (!tagName) return false;
  const tag = tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
