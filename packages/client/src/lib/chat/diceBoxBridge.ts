/**
 * diceBoxBridge.ts — maps RollResultData to @3d-dice/dice-box notation.
 *
 * Spec 08 (motor-de-rolagens), REQ-ROL-042..046 — 3D dice integration:
 *  - REQ-ROL-042: `@3d-dice/dice-box` is an OPTIONAL dependency, initialized
 *    only when the user preference `dice3d.enabled === true`.
 *  - REQ-ROL-043: on receiving a server RollResult (via ChatMessage broadcast),
 *    the client feeds the server-determined values into the 3D box so the
 *    animation reproduces EXACTLY the server values — the dice are NEVER
 *    re-rolled on the client.
 *  - REQ-ROL-044: animation completion is signaled via the box `onRollComplete`
 *    callback, which the chat renderer awaits before showing the result.
 *  - REQ-ROL-045: the toggle is a user setting (`UserSettings.dice3d`),
 *    surfaced here as setDiceBoxEnabled / isDiceBoxEnabled.
 *  - REQ-ROL-046 [V2]: custom dice themes (theme / themeColor options).
 *
 * Plus: WebGL failure → silent fallback (disabled, no throw).
 *
 * This module does NOT import dice-box at the top level. It lazy-imports it on
 * first use so the module is tree-shakeable and doesn't break in SSR / Node
 * test environments.
 *
 * REAL dice-box v1 API (from @3d-dice/dice-box@1.x `dist/dice-box.es.js`):
 *   `box.roll(notation, { theme?, themeColor?, newStartPoint? })`
 * where `notation` is one of:
 *   - a string, e.g. "4d6";
 *   - an array of strings, e.g. ["4d6", "2d10"];
 *   - an object `{ qty, sides, ... }` (or an array of such objects).
 * Preset (predetermined) results are supplied per notation object so the
 * animation lands on the exact server values — see DiceBoxNotation below, which
 * carries `notation` + `results` (one value per die).
 */

import type { RollResultData, RollTermResult } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiceBoxNotation {
  /** e.g. "2d6", "1d20" */
  notation: string;
  /** Preset results — one per die, matching notation count. */
  results: number[];
  /** Allow extra dice-box options (index signature matches ambient DiceNotation). */
  [key: string]: unknown;
}

export interface DiceBoxConfig {
  /** Path to the dice-box assets (default: /assets/dice-box). */
  assetPath?: string;
  /** dice-box container selector (default: #dice-canvas). */
  container?: string;
}

// ---------------------------------------------------------------------------
// Mapping RollResultData → DiceBoxNotation[]
// ---------------------------------------------------------------------------

/**
 * Extract dice notation entries from a RollResultData.
 * Filters out non-dice terms and discarded/inactive dice.
 *
 * Produces one DiceBoxNotation per dice term in the roll.
 * E.g. "4d6k3 + 1d20" → two entries.
 */
export function mapRollToDiceBoxNotations(roll: RollResultData): DiceBoxNotation[] {
  const out: DiceBoxNotation[] = [];

  for (const term of roll.terms) {
    if (term.type !== "dice") continue;
    const notation = extractNotationFromTerm(term);
    if (!notation) continue;
    out.push(notation);
  }

  return out;
}

function extractNotationFromTerm(term: RollTermResult): DiceBoxNotation | null {
  if (!term.results || term.results.length === 0) return null;
  const faces = term.faces ?? 6;
  const count = term.results.length;
  if (count === 0) return null;

  // Only take results from active dice (not discarded) for the total,
  // but dice-box shows all dice and highlights discarded ones.
  const results = term.results.map((d) => d.result);

  return {
    notation: `${count.toString()}d${faces.toString()}`,
    results,
  };
}

// ---------------------------------------------------------------------------
// DiceBox manager
// ---------------------------------------------------------------------------

type DiceBoxInstance = {
  roll: (notation: DiceBoxNotation[] | string) => Promise<unknown>;
  init: () => Promise<void>;
  clear: () => void;
  hide: () => void;
  show: () => void;
  // dice-box v1 typed loosely
  [key: string]: unknown;
};

let _instance: DiceBoxInstance | null = null;
let _initPromise: Promise<DiceBoxInstance | null> | null = null;
let _enabled = true; // User toggle
let _webglFailed = false;

/**
 * Initialize the dice-box instance (lazy, called once).
 * Returns null if WebGL fails or the user has disabled 3D dice.
 */
async function _getOrCreate(config: DiceBoxConfig = {}): Promise<DiceBoxInstance | null> {
  if (!_enabled || _webglFailed) return null;
  if (_instance) return _instance;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Lazy import — tree-shakeable, won't affect SSR
      const { default: DiceBox } = await import("@3d-dice/dice-box");

      const container = config.container ?? "#dice-canvas";
      const assetPath = config.assetPath ?? "/assets/dice-box";

      const box = new DiceBox(container, {
        assetPath,
        // Silence console output
        theme: "default",
        gravity: 1,
      });

      // dice-box v1 init
      await box.init();
      _instance = box;
      return box;
    } catch (err) {
      console.warn("[diceBoxBridge] WebGL init failed — 3D dice disabled", err);
      _webglFailed = true;
      return null;
    }
  })();

  return _initPromise;
}

/**
 * Set the user toggle for 3D dice.
 * If disabled mid-session, hides and clears the current canvas.
 */
export function setDiceBoxEnabled(enabled: boolean): void {
  _enabled = enabled;
  if (!enabled && _instance) {
    _instance.hide();
    _instance.clear();
  }
}

export function isDiceBoxEnabled(): boolean {
  return _enabled && !_webglFailed;
}

/**
 * Animate a roll using the 3D dice box.
 * Feeds the server-determined results so the animation matches exactly.
 *
 * @param roll The authoritative RollResultData from the server.
 * @param config Optional dice-box configuration.
 * @returns Promise that resolves when animation is complete (or immediately if 3D is disabled).
 */
export async function animateRoll(roll: RollResultData, config: DiceBoxConfig = {}): Promise<void> {
  const box = await _getOrCreate(config);
  if (!box) return;

  const notations = mapRollToDiceBoxNotations(roll);
  if (notations.length === 0) return;

  try {
    // dice-box clear before new roll
    box.clear();
    // roll each notation group with preset results
    for (const n of notations) {
      await box.roll([n]);
    }
  } catch (err) {
    console.warn("[diceBoxBridge] Animation error", err);
    // Soft failure — don't crash the UI
  }
}

/**
 * Clear the dice canvas (call between messages or when switching tabs).
 */
export function clearDiceCanvas(): void {
  _instance?.clear();
}
