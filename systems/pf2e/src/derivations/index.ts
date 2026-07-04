/**
 * @fusion/system-pf2e — Derivations public API.
 *
 * Re-exports all DeriveStep arrays and their registration helper so that
 * `index.ts` can call `registerDerivations(registrar)` in one line.
 *
 * REQ-SYS-020, REQ-PF2-010..022, REQ-PF2-030..034.
 */

export * from "./types.js";
export * from "./helpers.js";
export * from "./equipment.js";
export * from "./spellcasting.js";
export * from "./character.js";
export * from "./npc.js";

import type { DeriveStep } from "@fusion/system-api";
import { CHARACTER_DERIVE_STEPS } from "./character.js";
import { NPC_DERIVE_STEPS } from "./npc.js";

/** All PF2e derivation steps (character + NPC). */
export const ALL_PF2E_DERIVE_STEPS: readonly DeriveStep[] = [
  ...CHARACTER_DERIVE_STEPS,
  ...NPC_DERIVE_STEPS,
];

/**
 * Register all PF2e derivation steps with the system registrar.
 *
 * Called from `defineSystem` callback in `systems/pf2e/src/index.ts`.
 * Replaces the `// [HOOK: M3-C will register derive steps here]` comment.
 */
export function registerDerivations(registrar: { derive(step: DeriveStep): void }): void {
  for (const step of ALL_PF2E_DERIVE_STEPS) {
    registrar.derive(step);
  }
}
