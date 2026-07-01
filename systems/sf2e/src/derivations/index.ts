/**
 * @fusion/system-sf2e — Derivations public API.
 *
 * Re-exports all DeriveStep arrays and their registration helper so that
 * `index.ts` can call `registerDerivations(registrar)` in one line.
 * Mirrors `systems/pf2e/src/derivations/index.ts` (REQ-SF2-004).
 *
 * REQ-SYS-020, REQ-SF2-002, REQ-SF2-004, REQ-SF2-007..008, REQ-SF2-018..020.
 */

export * from "./types.js";
export * from "./helpers.js";
export * from "./character.js";
export * from "./npc.js";

import type { DeriveStep } from "@fusion/system-api";
import { CHARACTER_DERIVE_STEPS } from "./character.js";
import { NPC_DERIVE_STEPS } from "./npc.js";

/** All SF2e derivation steps (character + NPC). */
export const ALL_SF2E_DERIVE_STEPS: readonly DeriveStep[] = [
  ...CHARACTER_DERIVE_STEPS,
  ...NPC_DERIVE_STEPS,
];

/**
 * Register all SF2e derivation steps with the system registrar.
 *
 * Called from `defineSystem` callback in `systems/sf2e/src/index.ts`.
 */
export function registerDerivations(registrar: { derive(step: DeriveStep): void }): void {
  for (const step of ALL_SF2E_DERIVE_STEPS) {
    registrar.derive(step);
  }
}
