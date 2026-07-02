/**
 * @fusion/system-etmos — Derivations public API.
 *
 * Re-exports all DeriveStep arrays and a registration helper, mirroring
 * `systems/sf2e/src/derivations/index.ts` / `systems/pf2e/src/derivations/index.ts`.
 *
 * REGISTRATION: `systems/etmos/src/index.ts`'s `defineSystem` callback calls
 * `registerDerivations(registrar)` to wire these steps in, AND calls
 * `registrar.effectsMaterializer(...)` (returning an empty list for now) so
 * Etmos actors never fall back to the engine-2e 2e-effects collector in the
 * server's derive-runner. `registrar.degreeOfSuccess` is also registered
 * there with `etmosDegreeOfSuccessDefinition` from `../compositor/degree.ts`
 * under id `"etmos.conjuracao"` (design doc §2.6/E2). This module only
 * exposes the pure DeriveStep definitions and the helper to attach them.
 *
 * REQ-SYS-020, REQ-ETM-007..010.
 */

export * from "./orador.js";

import type { DeriveStep } from "@fusion/system-api";
import { ORADOR_DERIVE_STEPS } from "./orador.js";

/** All Etmos derivation steps (Orador; Antagonista has no derived formulas in the MVP). */
export const ALL_ETMOS_DERIVE_STEPS: readonly DeriveStep[] = [...ORADOR_DERIVE_STEPS];

/**
 * Register all Etmos derivation steps with the system registrar.
 *
 * Called from the `defineSystem` callback in `systems/etmos/src/index.ts`.
 */
export function registerDerivations(registrar: { derive(step: DeriveStep): void }): void {
  for (const step of ALL_ETMOS_DERIVE_STEPS) {
    registrar.derive(step);
  }
}
