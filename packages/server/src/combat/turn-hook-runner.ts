/**
 * TurnHookRunner — executes a system's turn/round/combatEnd hooks in series,
 * awaited, with per-callback error isolation.
 *
 * DEC-CBT-09 (specs/10-combate-e-iniciativa.md): the system turn hooks
 * registered via `registrar.onTurnStart/onTurnEnd/onRoundStart/onRoundEnd/
 * onCombatEnd` (@fusion/system-api/combat.ts, ALQ-F1-02) run in series,
 * AWAITED, in the order `turnEnd(atual) → roundEnd → roundStart →
 * turnStart(próximo)` when advancing a turn (REQ-CBT-057), after persisting
 * the transition and before the broadcast (REQ-CBT-058); `combatEnd` runs
 * with every actorId of the encounter, deduped, BEFORE the Combat document
 * is archived (REQ-CBT-060) — the one exception to the "after persist"
 * timing. A callback that throws or rejects is logged (with the system id
 * and the hook id, REQ-SYS-139) and isolated: it neither stops the
 * remaining callbacks nor undoes the already-persisted transition.
 *
 * `CombatEventBus` (combat-event-bus.ts) is untouched by this module — its
 * fire-and-forget listeners keep firing at their existing call sites
 * (DEC-CBT-09: "os ouvintes internos do CombatEventBus seguem notificados
 * como hoje").
 *
 * TYPE-LEVEL contracts (`TurnHookContext`, `TurnHookFn`, `RoundHookFn`,
 * `CombatEndHookFn`, `TurnHookRegistrations`) come from ALQ-F1-02
 * (@fusion/system-api/combat.ts) — this module only executes them; it does
 * not redefine or duplicate their shapes.
 *
 * `TurnHookContextServices` (everything on `TurnHookContext` except
 * `worldTime`, which this runner computes per call from the CombatDocument
 * passed in) is INJECTED. `createStubTurnHookContextServices` below is the
 * placeholder wired in production (packages/server/src/net/socket-manager.ts)
 * until ALQ-F1-08 (applyDamage/ActorMechanicsService), ALQ-F1-09
 * (applyCondition) and the roll/chat/document-write plumbing land. No hook
 * registered as of this task calls into these services — pf2e/sf2e do not
 * yet register onTurnStart/onTurnEnd/etc. (that starts at ALQ-F1-12) — so
 * the stub only needs to satisfy the type and fail safely: this runner's own
 * per-callback isolation (above) catches a stub rejection exactly like any
 * other hook failure, so a future hook that calls one too early degrades to
 * "this one automation did not run" rather than a broken turn transition.
 *
 * Spec: 10-combate-e-iniciativa.md REQ-CBT-057..060, DEC-CBT-09.
 * Spec: 15-api-de-sistemas.md REQ-SYS-138..141.
 * Plan: docs/design/alquimista/tasks.md §2.2 (TurnHooks), task ALQ-F1-04.
 */

import type { Logger } from "pino";
import type {
  ActorApplyConditionPayload,
  ActorApplyDamagePayload,
  ApplyConditionAck,
  ApplyDamageAck,
  CombatDocument,
  CombatantDocument,
  RollResultData,
} from "@fusion/shared";
import type { SystemModule, TurnHookContext } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Stub TurnHookContext services (ALQ-F1-08/F1-09 replace these)
// ---------------------------------------------------------------------------

/**
 * Everything on `TurnHookContext` except `worldTime`, which this runner
 * computes per call from the `CombatDocument` being processed (see
 * `createTurnHookRunner`'s `contextFor`).
 */
export type TurnHookContextServices = Omit<TurnHookContext, "worldTime">;

/**
 * Thrown by every stub service below. The runner's per-callback isolation
 * (REQ-SYS-139) catches and logs it exactly like any other hook failure.
 */
export class TurnHookContextStubError extends Error {
  constructor(method: string) {
    super(
      `TurnHookContext.${method} is a stub — the real service lands in ALQ-F1-08 ` +
        `(applyDamage/ActorMechanicsService) / ALQ-F1-09 (applyCondition) / a later ` +
        `roll+chat+document-write wiring task. No turn hook may rely on it yet.`,
    );
    this.name = "TurnHookContextStubError";
  }
}

/**
 * Placeholder `TurnHookContext` services, wired in production until
 * ALQ-F1-08/F1-09 land the real `ActorMechanicsService` and roll/chat/
 * document-write plumbing.
 *
 * `applyDamage`/`applyCondition` resolve to the same `NOT_SUPPORTED` ack
 * shape ALQ-F1-08 documents for "no mechanics registered" — forward-
 * compatible messaging, and an Ack a caller can branch on instead of a
 * thrown error. The rest reject with `TurnHookContextStubError`: there is no
 * Ack envelope for `roll`/`chat`/`updateActor`/`createEmbedded`/
 * `deleteEmbedded` to report "not supported" through.
 */
export function createStubTurnHookContextServices(): TurnHookContextServices {
  return {
    applyDamage(_p: ActorApplyDamagePayload): Promise<ApplyDamageAck> {
      return Promise.resolve({
        ok: false,
        code: "NOT_SUPPORTED",
        message: "TurnHookContext.applyDamage is not wired yet (ALQ-F1-08)",
      });
    },
    applyCondition(_p: ActorApplyConditionPayload): Promise<ApplyConditionAck> {
      return Promise.resolve({
        ok: false,
        code: "NOT_SUPPORTED",
        message: "TurnHookContext.applyCondition is not wired yet (ALQ-F1-09)",
      });
    },
    roll(): Promise<RollResultData> {
      return Promise.reject(new TurnHookContextStubError("roll"));
    },
    chat(): Promise<void> {
      return Promise.reject(new TurnHookContextStubError("chat"));
    },
    updateActor(): Promise<void> {
      return Promise.reject(new TurnHookContextStubError("updateActor"));
    },
    createEmbedded(): Promise<void> {
      return Promise.reject(new TurnHookContextStubError("createEmbedded"));
    },
    deleteEmbedded(): Promise<void> {
      return Promise.reject(new TurnHookContextStubError("deleteEmbedded"));
    },
  };
}

// ---------------------------------------------------------------------------
// TurnHookRunner
// ---------------------------------------------------------------------------

export interface TurnHookRunnerDeps {
  /** Undefined when no system package is loaded for this world — every run* below becomes a no-op. */
  systemModule: SystemModule | undefined;
  /** Services injected into every TurnHookContext built by this runner (see stub above). */
  services: TurnHookContextServices;
  logger?: Logger;
}

export interface TurnHookRunner {
  /** REQ-CBT-057/058: awaited, in series, after persist, before broadcast. */
  runTurnEnd(
    combat: CombatDocument,
    combatant: CombatantDocument,
    actor: Record<string, unknown> | null,
  ): Promise<void>;
  /** REQ-CBT-057/058: awaited, in series, after persist, before broadcast. */
  runTurnStart(
    combat: CombatDocument,
    combatant: CombatantDocument,
    actor: Record<string, unknown> | null,
  ): Promise<void>;
  /** REQ-CBT-057/058: awaited, in series, after persist, before broadcast. */
  runRoundEnd(combat: CombatDocument, round: number): Promise<void>;
  /** REQ-CBT-057/058: awaited, in series, after persist, before broadcast. */
  runRoundStart(combat: CombatDocument, round: number): Promise<void>;
  /** REQ-CBT-060: awaited, in series, BEFORE persisting/archiving the Combat document. */
  runCombatEnd(combat: CombatDocument, actorIds: readonly string[]): Promise<void>;
}

/** Log + swallow a single callback's failure (REQ-SYS-139) — never rethrown. */
function logHookError(
  logger: Logger | undefined,
  systemId: string,
  hookId: string,
  eventName: string,
  err: unknown,
): void {
  logger?.error(
    { err, systemId, hookId, event: eventName },
    `[turn-hook-runner] "${eventName}" hook "${hookId}" (system "${systemId}") threw/rejected — isolated (REQ-SYS-139)`,
  );
}

/**
 * Run one event's registered hooks in series, awaiting each. The hooks array
 * is already sorted priority-descending / registration-order by
 * system-module.ts (REQ-SYS-139) — this function just walks it in order. A
 * hook that throws or rejects is logged and does NOT stop the remaining
 * hooks; this function itself never rejects.
 */
async function runSeries<H extends { readonly id: string }>(
  hooks: ReadonlyArray<H> | undefined,
  invoke: (hook: H) => void | Promise<void>,
  eventName: string,
  systemId: string,
  logger: Logger | undefined,
): Promise<void> {
  if (!hooks || hooks.length === 0) return;
  for (const hook of hooks) {
    try {
      await invoke(hook);
    } catch (err) {
      logHookError(logger, systemId, hook.id, eventName, err);
    }
  }
}

export function createTurnHookRunner(deps: TurnHookRunnerDeps): TurnHookRunner {
  const systemId = deps.systemModule?.manifest.id ?? "(no system loaded)";

  /** worldTime always mirrors the CombatDocument passed to that specific call. */
  function contextFor(combat: CombatDocument): TurnHookContext {
    return { ...deps.services, worldTime: { round: combat.round, turn: combat.turnIndex } };
  }

  return {
    async runTurnEnd(combat, combatant, actor) {
      const ctx = contextFor(combat);
      await runSeries(
        deps.systemModule?.combat.turnHooks.onTurnEnd,
        (hook) => hook.fn({ combat, combatant, actor }, ctx),
        "turnEnd",
        systemId,
        deps.logger,
      );
    },
    async runTurnStart(combat, combatant, actor) {
      const ctx = contextFor(combat);
      await runSeries(
        deps.systemModule?.combat.turnHooks.onTurnStart,
        (hook) => hook.fn({ combat, combatant, actor }, ctx),
        "turnStart",
        systemId,
        deps.logger,
      );
    },
    async runRoundEnd(combat, round) {
      const ctx = contextFor(combat);
      await runSeries(
        deps.systemModule?.combat.turnHooks.onRoundEnd,
        (hook) => hook.fn({ combat, round }, ctx),
        "roundEnd",
        systemId,
        deps.logger,
      );
    },
    async runRoundStart(combat, round) {
      const ctx = contextFor(combat);
      await runSeries(
        deps.systemModule?.combat.turnHooks.onRoundStart,
        (hook) => hook.fn({ combat, round }, ctx),
        "roundStart",
        systemId,
        deps.logger,
      );
    },
    async runCombatEnd(combat, actorIds) {
      const ctx = contextFor(combat);
      await runSeries(
        deps.systemModule?.combat.turnHooks.onCombatEnd,
        (hook) => hook.fn({ combat, actorIds: [...actorIds] }, ctx),
        "combatEnd",
        systemId,
        deps.logger,
      );
    },
  };
}
