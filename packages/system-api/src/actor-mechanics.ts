/**
 * ActorMechanics — the game-specific RULE half of ApplyDamage/ApplyCondition.
 *
 * DEC-SYS-12 (spec 15): `actor:applyDamage`/`actor:applyCondition` are CORE
 * ops (ActorMechanicsService, packages/server) — they validate the payload,
 * reread the montante/alvos from the persisted roll (never the client), and
 * persist + broadcast. What the core does NOT know is the RULE (IWR,
 * hardness, temp HP, dying/wounded/doomed, condition immunity, "greater value
 * wins"…) — that is a pure function a system registers once via
 * `registrar.registerActorMechanics({ applyDamage, applyCondition })`
 * (system-module.ts), returning an `ActorMechanicsPatch` and never writing
 * anything itself.
 *
 * TYPE-LEVEL ONLY (ALQ-F1-02): the ActorMechanicsService that calls these
 * functions is server behavior for ALQ-F1-05/F1-08, out of this task's scope.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142 (interfaces there are illustrative,
 * "não-normativas em detalhes de campo" per its own disclaimer — the fields
 * below follow that shape but are this task's own naming/typing choices
 * where the spec did not pin one down, e.g. `ActorSnapshot`,
 * `ResolvedDamageInstance`, `ApplyDamageOptions`).
 * Plan: docs/design/alquimista/tasks.md §2.1 (ApplyDamage contract table).
 *
 * REQ-ARQ-005: system-api may import from shared; must NOT import server/client.
 */
import type { ActorApplyConditionPayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// ActorSnapshot
// ---------------------------------------------------------------------------

/**
 * Read-only Actor document handed to a registered ActorMechanics function.
 *
 * Deliberately untyped beyond `Record<string, unknown>` — the engine does not
 * know a system's `system` field shape (DEC-SYS-12: the engine does not
 * hardcode game rules); a system reads whatever it needs off the document
 * using its OWN `defineModel` schema. Mirrors the existing untyped
 * `actor: Record<string, unknown> | null` already used by
 * `CombatSystemHooks.turnStart`/`TurnHookFn` (combat.ts) for the same reason.
 */
export type ActorSnapshot = Record<string, unknown>;

// ---------------------------------------------------------------------------
// ResolvedDamageInstance — the server-settled counterpart of
// DamageInstanceInput (@fusion/shared/protocol.ts). By the time the core
// calls ActorMechanics.applyDamage, every field the server owns has already
// been resolved (from `source` when present, from the payload when the
// caller is privileged/"system") — `amount` is no longer optional and
// `source` itself is gone: the system never needs to know which chat message
// or roll index the damage came from.
// ---------------------------------------------------------------------------

export interface ResolvedDamageInstance {
  readonly type: string;
  readonly amount: number;
  readonly category?: "persistent" | "splash" | "precision";
  readonly traits?: readonly string[];
  readonly materials?: readonly string[];
  readonly critical?: boolean;
  readonly nonlethal?: boolean;
}

/**
 * Non-instance options accompanying a resolved `applyDamage` call — the rest
 * of `ActorApplyDamagePayload` (@fusion/shared) minus `instances` and
 * `targetTokenIds`/`selfActorId` (the core already resolved those into "which
 * actor" before calling the mechanics function once per target, REQ-SYS-142
 * step 4).
 */
export interface ApplyDamageOptions {
  /** Who/what is applying the damage — "system" for TurnHookContext-driven automations. */
  readonly actingAs: { userId: string; role: string } | "system";
  readonly multiplier?: 0 | 0.5 | 1 | 2;
  readonly basicSave?: { degree: string };
  readonly hardness?: number;
  readonly ignoreResistance?: ReadonlyArray<{ type: string; value: number }>;
}

// ---------------------------------------------------------------------------
// DamageBreakdownStep — audit trail shown in the actor:damageApplied summary.
//
// `step` is a system-defined string, not a fixed union: the engine does not
// hardcode which stages a system's damage pipeline has (DEC-SYS-12) — same
// discipline as `RuleElementHandler.kind`/`ConditionDefinition.slug`
// elsewhere in this package. A PF2e-specific breakdown (already implemented
// pre-Alchemist in the satellite's `applyDamagePipeline`,
// systems/pf2e/src/actions/damage.ts) adapts into this shape; it is not
// required to reuse the exact same `step` labels.
// ---------------------------------------------------------------------------

export interface DamageBreakdownStep {
  readonly step: string;
  readonly label: string;
  readonly amount: number;
  readonly note?: string;
}

/**
 * Pure result of one ActorMechanics call — a diff to persist plus embedded
 * Item writes, never applied by the mechanics function itself (DEC-SYS-12:
 * "nunca escreve nada").
 *
 * `embeddedCreate` carries raw Item data (validated downstream by the
 * system's own item schema) — same "wire-level unknown, system-level typed"
 * discipline as `DocCreatePayload.data: unknown[]` (@fusion/shared/protocol.ts).
 */
export interface ActorMechanicsPatch {
  readonly diff: Record<string, unknown>;
  readonly embeddedCreate: ReadonlyArray<Record<string, unknown>>;
  readonly embeddedDelete: ReadonlyArray<string>;
  readonly breakdown: ReadonlyArray<DamageBreakdownStep>;
  readonly flags: {
    readonly droppedToZero: boolean;
    readonly dead: boolean;
    readonly dyingChanged: boolean;
  };
}

/**
 * The game-specific rule a system registers via
 * `registrar.registerActorMechanics(m)` (system-module.ts), at most once.
 *
 * Both functions are PURE: given a snapshot and resolved input, return the
 * patch to apply. The core (ActorMechanicsService) persists it, publishes the
 * redacted summary, and runs `onDamageApplied` — none of that is this
 * function's job.
 */
export interface ActorMechanics {
  applyDamage(
    actor: ActorSnapshot,
    instances: ReadonlyArray<ResolvedDamageInstance>,
    opts: ApplyDamageOptions,
  ): ActorMechanicsPatch;
  applyCondition(actor: ActorSnapshot, req: ActorApplyConditionPayload): ActorMechanicsPatch;
}
