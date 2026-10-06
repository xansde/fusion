/**
 * @fusion/shared — combat subsystem public API
 *
 * Exports all types, Zod schemas, comparator utilities, and protocol payloads
 * for the Combat/Combatant subsystem.
 *
 * ## Documents
 *   CombatDocumentSchema       / CombatDocumentData
 *   CombatantDocumentSchema    / CombatantDocumentData
 *   CombatTurnSnapshotSchema   / CombatTurnSnapshotData
 *
 * ## Interfaces (pure TypeScript, no Zod)
 *   CombatDocument             — full in-memory shape
 *   CombatantDocument          — embedded combatant
 *   CombatTurnSnapshot         — immutable turn boundary snapshot
 *   CombatLifecycleEvent       — discriminated union for server EventBus
 *   CombatLifecycleEventName   — "combatStart" | "roundStart" | …
 *   InitiativeFormula          — pluggable formula contract (engine registry)
 *   InitiativeFormulaResult    — spec-literal result of a system InitiativeFormulaFn
 *   InitiativeFormulaFn        — spec-literal system-API formula function type
 *   InitiativeRollContext      — context passed to formula.roll()
 *   InitiativeRollResult       — return value of formula.roll()
 *   InitiativeEntry            — entry passed to formula.compare()
 *
 * ## Initiative utilities
 *   defaultInitiativeComparator — pure sort function (desc total, desc tiebreaker, nulls last)
 *   sortCombatants             — apply comparator to a combatants array (returns new array)
 *   activeCombatant            — get the combatant at the current turn index
 *   nextTurnIndex              — compute next (turn, round) with skipDefeated support
 *   previousTurnIndex          — compute previous (turn, round) with skipDefeated support
 *   GENERIC_1D20_FORMULA_ID    — constant id for the built-in formula
 *
 * ## Protocol payloads (Zod schemas + inferred types)
 *   COMBAT_ENVELOPE_TYPES      — all envelope type literals
 *   CombatCreatePayloadSchema / CombatCreatePayload
 *   CombatBeginPayloadSchema / CombatBeginPayload          (combat:beginCombat)
 *   CombatAddCombatantPayloadSchema / CombatAddCombatantPayload
 *   CombatRemoveCombatantPayloadSchema / CombatRemoveCombatantPayload
 *   CombatRollInitiativePayloadSchema / CombatRollInitiativePayload
 *   CombatSetInitiativePayloadSchema / CombatSetInitiativePayload
 *   CombatResetInitiativePayloadSchema / CombatResetInitiativePayload
 *   CombatNextPayloadSchema / CombatNextPayload            (combat:nextTurn)
 *   CombatPreviousPayloadSchema / CombatPreviousPayload    (combat:previousTurn)
 *   CombatSetDefeatedPayloadSchema / CombatSetDefeatedPayload
 *   CombatSetHiddenPayloadSchema / CombatSetHiddenPayload
 *   CombatReorderPayloadSchema / CombatReorderPayload
 *   CombatEndPayloadSchema / CombatEndPayload              (combat:endCombat)
 *   CombatTargetPayloadSchema / CombatTargetPayload        (combat:target)
 *   CombatCreatedPayloadSchema / CombatCreatedPayload
 *   CombatUpdatedPayloadSchema / CombatUpdatedPayload
 *   CombatDeletedPayloadSchema / CombatDeletedPayload
 *   CombatTurnChangePayloadSchema / CombatTurnChangePayload
 *   CombatInitiativeSetPayloadSchema / CombatInitiativeSetPayload
 *   TokenTargetedPayloadSchema / TokenTargetedPayload
 *
 * Spec: 10-combate-e-iniciativa.md
 * Spec: 02-modelo-de-dados.md §Combat / Combatant
 * Spec: 15-api-de-sistemas.md §InitiativeFormula, §REQ-SYS-042
 * REQ-DOC-012: Zod schemas with derived TypeScript types.
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

// ---------------------------------------------------------------------------
// Core types (pure TS interfaces)
// ---------------------------------------------------------------------------

export type {
  CombatantDocument,
  CombatDocument,
  CombatTurnSnapshot,
  CombatLifecycleEvent,
  CombatLifecycleEventName,
  InitiativeFormula,
  InitiativeFormulaResult,
  InitiativeFormulaFn,
  InitiativeRollContext,
  InitiativeRollResult,
  InitiativeEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Zod schemas + inferred types
// ---------------------------------------------------------------------------

export {
  CombatantDocumentSchema,
  CombatDocumentSchema,
  CombatTurnSnapshotSchema,
} from "./schemas.js";

export type {
  CombatantDocumentData,
  CombatDocumentData,
  CombatTurnSnapshotData,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Initiative utilities
// ---------------------------------------------------------------------------

export {
  GENERIC_1D20_FORMULA_ID,
  defaultInitiativeComparator,
  sortCombatants,
  activeCombatant,
  computeActiveCombatantId,
  nextTurnIndex,
  previousTurnIndex,
} from "./initiative.js";

// ---------------------------------------------------------------------------
// Protocol payloads
// ---------------------------------------------------------------------------

export { COMBAT_ENVELOPE_TYPES } from "./protocol.js";
export type { CombatEnvelopeType } from "./protocol.js";

// client → server
export {
  CombatCreatePayloadSchema,
  CombatBeginPayloadSchema,
  CombatAddCombatantPayloadSchema,
  CombatRemoveCombatantPayloadSchema,
  CombatRollInitiativePayloadSchema,
  CombatSetInitiativePayloadSchema,
  CombatResetInitiativePayloadSchema,
  CombatNextPayloadSchema,
  CombatPreviousPayloadSchema,
  CombatSetDefeatedPayloadSchema,
  CombatSetHiddenPayloadSchema,
  CombatReorderPayloadSchema,
  CombatEndPayloadSchema,
  CombatTargetPayloadSchema,
} from "./protocol.js";

export type {
  CombatCreatePayload,
  CombatBeginPayload,
  CombatAddCombatantPayload,
  CombatRemoveCombatantPayload,
  CombatRollInitiativePayload,
  CombatSetInitiativePayload,
  CombatResetInitiativePayload,
  CombatNextPayload,
  CombatPreviousPayload,
  CombatSetDefeatedPayload,
  CombatSetHiddenPayload,
  CombatReorderPayload,
  CombatEndPayload,
  CombatTargetPayload,
} from "./protocol.js";

// server → clients
export {
  CombatCreatedPayloadSchema,
  CombatUpdatedPayloadSchema,
  CombatDeletedPayloadSchema,
  CombatTurnChangePayloadSchema,
  CombatInitiativeSetPayloadSchema,
  TokenTargetedPayloadSchema,
} from "./protocol.js";

export type {
  CombatCreatedPayload,
  CombatUpdatedPayload,
  CombatDeletedPayload,
  CombatTurnChangePayload,
  CombatInitiativeSetPayload,
  TokenTargetedPayload,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// TokenMark (BHR-F3-06) — the Prey persisted on the marking actor
// ---------------------------------------------------------------------------

export {
  TOKEN_MARKS_FLAG_NAMESPACE,
  TOKEN_MARKS_FLAG_KEY,
  HUNTED_PREY_MARK_SLUG,
  MONSTER_HUNTER_MARK_SLUG,
  EXCLUSIVE_MARK_SLUGS,
  TokenMarkSchema,
  MarkSetPayloadSchema,
  MarkClearPayloadSchema,
  readTokenMarks,
  touchesTokenMarksFlag,
  stripTokenMarksOnCreate,
} from "./token-mark.js";
export type { TokenMark, MarkSetPayload, MarkClearPayload } from "./token-mark.js";

// ---------------------------------------------------------------------------
// MountState (BHR-F5-02) — who rides whom, on the two tokens
// ---------------------------------------------------------------------------

export {
  MOUNT_FLAG_NAMESPACE,
  MOUNT_FLAG_KEY,
  MountMountPayloadSchema,
  MountDismountPayloadSchema,
  readMountState,
  isMounted,
} from "./mount-state.js";
export type {
  MountState,
  MountMovedTurn,
  MountMountPayload,
  MountDismountPayload,
} from "./mount-state.js";
