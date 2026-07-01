/**
 * @fusion/system-sf2e — SF2e modifier stacking table.
 *
 * SINGLE SOURCE OF TRUTH: thin re-export of the canonical
 * `PF2E_STACKING_TABLE` from `@fusion/engine-2e`. SF2e uses the exact same
 * stacking rules as PF2e (circumstance/item/status/proficiency/ability/
 * potency = highest bonus/lowest penalty only; untyped = additive) — no
 * SF2e-specific override exists in the spec or the researched mechanics.
 * REQ-SF2-004, REQ-SYS-085.
 *
 * Clean-room: stacking rules are ORC game mechanics.
 */

import type { StackingTable } from "@fusion/system-api";
import { PF2E_STACKING_TABLE as ENGINE_STACKING_TABLE } from "@fusion/engine-2e";

export const SF2E_STACKING_TABLE: StackingTable = ENGINE_STACKING_TABLE;
