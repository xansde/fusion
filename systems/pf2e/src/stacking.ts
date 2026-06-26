/**
 * @fusion/system-pf2e — PF2e modifier stacking table.
 *
 * Declares how modifiers of each type combine for the same selector.
 * Injected via `registrar.stackingRules(table)` during system registration and
 * passed to `resolveStacking` by `actions/strikes.ts`.
 *
 * SINGLE SOURCE OF TRUTH: this is a thin re-export of the canonical
 * `PF2E_STACKING_TABLE` from `@fusion/engine-2e`. The PF2e system package must
 * NOT diverge from the engine's stacking rules (REQ-SYS-085, DEC-PF2-04).
 *
 * Engine table (PF2e Remaster, research 13 §3.2):
 *   - circumstance / item / status: highest bonus only / lowest penalty only
 *   - proficiency / ability:        highest bonus only / lowest penalty only
 *   - potency:                      highest bonus only / lowest penalty only
 *   - untyped:                      highest bonus only (PF2e RAW) / penalty additive
 *
 * Clean-room: stacking rules are ORC/OGL game mechanics.
 */

import type { StackingTable } from "@fusion/system-api";
import { PF2E_STACKING_TABLE as ENGINE_PF2E_STACKING_TABLE } from "@fusion/engine-2e";

/**
 * PF2e stacking table, re-exported from the engine so the system layer stays
 * thin and cannot drift from the canonical rules.
 *
 * Typed as the system-api `StackingTable` contract for use with
 * `registrar.stackingRules()` and `aggregateModifiers()`.
 */
export const PF2E_STACKING_TABLE: StackingTable = ENGINE_PF2E_STACKING_TABLE;
