/**
 * Roll resolution on the server — BHR-F2-05 (imports ALQ-F4-09).
 *
 * Spec 52 REQ-BHR-051..053, REQ-BHR-069/070; plan of the Alquimista §2.8
 * ("RuleElementRegistry e RollNotes"); DF-16/DF-17: the roll's CONTEXT travels
 * in the op (`flags.fusion.rollContext`), and the notes, the degree and the
 * conditional modifiers are resolved HERE, never on the client.
 *
 * Steps, as `chat-handler.ts` drives them for a `/r` command that carries a
 * `rollContext`:
 *
 *   1. `prepareRollResolution` — BEFORE the dice: validates that the roller may
 *      speak for `rollContext.actorId` (OWNER, or a privileged role), keeps only the
 *      `action:*` options the client sent (every other option is the server's to
 *      write), RE-DERIVES the actor from the stored row (a stale
 *      `system.derived` is never what a bonus is read from), gathers the options
 *      of the roll's single target (its marks from the `TokenMarkSource`, its
 *      conditions from its own row) and asks the system's resolver for the
 *      conditional modifiers and notes. The modifiers' stacked total is then
 *      appended to the client's formula, so the server's roll — total, terms
 *      and degree — already counts them.
 *   2. `finalizeRollResolution` — AFTER grading: keeps only the notes whose
 *      `outcome` matches the graded degree and writes `flags.fusion.rollContext`,
 *      `flags.fusion.rollNotes` and `flags.fusion.conditionalModifiers`.
 *   3. `runRollResolvedHooks` — after the message is persisted and before it is
 *      broadcast: the system's `onRollResolved` callbacks, ONCE per roll, in
 *      series, each error-isolated (REQ-SYS-139 discipline).
 *
 * THE TARGET. The roll's target is the ONE the chat handler resolved from
 * `payload.target` — the same that grades the roll and feeds the MAP (B1): with
 * exactly one entry, that token is the target; with none, the resolver is told
 * there is no target and a `target:`-predicated modifier stays unresolved (an absent option is false, so `not target:x` would otherwise pass
 * — the warning of BHR-F2-02). `origin` (the attacker, when the roller defends)
 * has no source yet: it is always `null` until a defence roll carries its
 * attacker.
 *
 * THE MARKS. `TokenMark` (BHR-F3-06) does not exist yet. The marks a target
 * carries come from an injectable `TokenMarkSource`; the default source knows
 * none. BHR-F3-06 plugs its reader (`getMarksOn`) in through
 * `WorldNamespaceOptions.tokenMarkSource`.
 */

import type { Logger } from "pino";
import { extractFlavor } from "@fusion/shared";
import type {
  ChatMessage,
  FusionRollContext,
  ResolvedRollModifier,
  ResolvedRollNote,
} from "@fusion/shared";
import type {
  ResolvedExtraDamage,
  RollResolutionParty,
  RollTargetSnapshotEntry,
  SystemModule,
  TurnHookContext,
} from "@fusion/system-api";

import type { DocumentStore } from "../documents/store.js";
import { isRolePrivileged, testOwnership, OwnershipLevel } from "../documents/ownership.js";
import type { Ownership, UserRole } from "../documents/ownership.js";
import { runActorDerivation } from "../net/derive-runner.js";
import { resolveWorldVariantRules } from "../documents/world-variant-rules.js";
import { createStubTurnHookContextServices } from "../combat/turn-hook-runner.js";
import { activeCompanionMasterId } from "../combat/companion-active-handler.js";

// ---------------------------------------------------------------------------
// Injectable sources
// ---------------------------------------------------------------------------

/**
 * Where the marks on a roll's target come from (`target:mark:<slug>`). Answers
 * the slugs of the marks the ROLLER placed on that token (or, once BHR-F3-06 and
 * the CompanionLink land, its owner's — DC-08). BHR-F3-06 provides the real one.
 */
export interface TokenMarkSource {
  marksOn(query: {
    rollerActorId: string;
    targetTokenId: string;
    targetActorId: string | null;
  }): readonly string[];
}

/** The default until `TokenMark` exists: no token carries a mark. */
export const NO_TOKEN_MARKS: TokenMarkSource = { marksOn: () => [] };

// ---------------------------------------------------------------------------
// Flag keys — flags.fusion.*
// ---------------------------------------------------------------------------

const FUSION_FLAG_NAMESPACE = "fusion" as const;
export const ROLL_CONTEXT_FLAG_KEY = "rollContext" as const;
export const ROLL_NOTES_FLAG_KEY = "rollNotes" as const;
export const CONDITIONAL_MODIFIERS_FLAG_KEY = "conditionalModifiers" as const;

/**
 * The only options the client may DESCRIBE a roll with (I2, DF-17). Everything
 * else — `target:`/`origin:`, `feat:`, `effect:`, `item:`, switches... — is the
 * server's to write, derived from the re-derived actor and the resolved target.
 */
const CLIENT_OPTION_PREFIXES = ["action:"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RollResolutionDeps {
  store?: DocumentStore;
  systemModule?: SystemModule;
  tokenMarkSource?: TokenMarkSource;
  logger?: Pick<Logger, "error">;
}

export interface PreparedRollResolution {
  rollContext: FusionRollContext;
  modifiers: readonly ResolvedRollModifier[];
  /** Stacked sum of `modifiers` — appended to the client's formula. */
  total: number;
  notes: readonly ResolvedRollNote[];
  /**
   * The options of the roll's single target, as the SERVER resolved them for the resolver
   * (`mark:<slug>`, `condition:<slug>`): the same list, handed to `onRollResolved` so an
   * `after-roll` predicate over `target:*` judges the very target the roll was graded against.
   */
  targetOptions: readonly string[];
  /**
   * Extra damage dice the roller's effects earn (BHR-F4-09). NOT folded into `total`: the server gates them
   * (the Strike hit, the companion's reach) in `settleExtraDamage` before they join the formula.
   */
  extraDamage: readonly ResolvedExtraDamage[];
}

// ---------------------------------------------------------------------------
// 1. Before the dice
// ---------------------------------------------------------------------------

/**
 * Resolve the roll's context, or `null` when there is nothing to resolve: no
 * `rollContext` in the payload, no store/system to resolve with, or an actor
 * the roller may not speak for (a forged `actorId` buys nothing — the roll
 * goes out as a plain roll of the client's formula, without a context).
 */
export function prepareRollResolution(
  deps: RollResolutionDeps,
  rawContext: FusionRollContext | undefined,
  roller: { userId: string; role: UserRole },
  snapshot: readonly RollTargetSnapshotEntry[],
): PreparedRollResolution | null {
  if (rawContext === undefined) return null;
  const { store, systemModule } = deps;
  if (!store || !systemModule) return null;

  const actor = readActor(store, rawContext.actorId);
  if (actor === null) return null;
  if (!mayRollFor(actor, roller)) return null;

  const rollContext: FusionRollContext = {
    ...rawContext,
    options: rawContext.options.filter((o) =>
      CLIENT_OPTION_PREFIXES.some((prefix) => o.startsWith(prefix)),
    ),
  };

  const resolver = systemModule.rollResolver;
  if (!resolver) {
    return { rollContext, modifiers: [], total: 0, notes: [], targetOptions: [], extraDamage: [] };
  }

  // The resolver is system code: a throw must not take the roll down with it.
  // The roll then goes out as it did before this task — the client's formula,
  // no context, no hook (an `after-roll` effect must not be consumed by a roll
  // whose bonus was never counted).
  let resolution: ReturnType<typeof resolver.resolve>;
  let targetOptions: readonly string[] = [];
  try {
    const derived = rederive(actor, store, systemModule);
    const target =
      snapshot.length === 1 && snapshot[0] !== undefined
        ? targetParty(
            store,
            deps.tokenMarkSource ?? NO_TOKEN_MARKS,
            rollContext.actorId,
            snapshot[0],
          )
        : null;
    // An ACTIVE animal companion rolls with its owner at hand (DC-08): the system decides what is shared.
    const masterId = activeCompanionMasterId(actor);
    const master = masterId === undefined ? null : readActor(store, masterId);
    resolution = resolver.resolve({
      actor: derived,
      rollContext,
      target,
      origin: null,
      companions: companionsOf(store, rollContext.actorId),
      masterActor: master === null ? null : rederive(master, store, systemModule),
    });
    targetOptions = target?.options ?? [];
  } catch (err) {
    deps.logger?.error(
      { err, systemId: systemModule.manifest.id, actorId: rollContext.actorId },
      "[roll-resolution] roll resolver threw — roll delivered without its context",
    );
    return null;
  }
  return {
    rollContext,
    modifiers: resolution.modifiers,
    total: Number.isFinite(resolution.total) ? Math.trunc(resolution.total) : 0,
    notes: resolution.notes,
    targetOptions,
    extraDamage: resolution.extraDamage ?? [],
  };
}

/**
 * The formula the server rolls: the client's, with the server-settled
 * conditional total appended before the flavor (`1d20+5 # Golpe` → `1d20+5 + 2`,
 * flavor `Golpe`). Unchanged when there is nothing to add.
 */
export function conditionalRollFormula(
  commandFormula: string,
  prepared: PreparedRollResolution | null,
): { formula: string; flavor?: string } {
  if (prepared === null || prepared.total === 0) return { formula: commandFormula };
  const { formula, flavor } = extractFlavor(commandFormula);
  const total = prepared.total;
  const appended = total > 0 ? `${formula} + ${String(total)}` : `${formula} - ${String(-total)}`;
  return flavor !== undefined ? { formula: appended, flavor } : { formula: appended };
}

// ---------------------------------------------------------------------------
// 2. After grading
// ---------------------------------------------------------------------------

/** Write the resolved context, notes (filtered by `degree`) and modifiers onto the message. */
export function finalizeRollResolution(
  msg: ChatMessage,
  prepared: PreparedRollResolution,
  degree: string | null,
): void {
  const notes = prepared.notes.filter((note) => {
    if (note.outcome === undefined || note.outcome.length === 0) return true;
    return degree !== null && note.outcome.includes(degree);
  });
  const fusion = msg.flags[FUSION_FLAG_NAMESPACE] ?? {};
  msg.flags = {
    ...msg.flags,
    [FUSION_FLAG_NAMESPACE]: {
      ...fusion,
      [ROLL_CONTEXT_FLAG_KEY]: prepared.rollContext,
      [ROLL_NOTES_FLAG_KEY]: notes.map((n) => ({ ...n })),
      [CONDITIONAL_MODIFIERS_FLAG_KEY]: prepared.modifiers.map((m) => ({ ...m })),
    },
  };
}

// ---------------------------------------------------------------------------
// 3. onRollResolved
// ---------------------------------------------------------------------------

/**
 * Run the system's `onRollResolved` callbacks ONCE for this roll (REQ-BHR-053),
 * in series, priority order, each one error-isolated: a throwing listener is
 * logged and the roll still goes out.
 */
export async function runRollResolvedHooks(
  systemModule: SystemModule | undefined,
  event: {
    message: ChatMessage;
    rollContext: FusionRollContext;
    degree: string | null;
    targets: readonly RollTargetSnapshotEntry[];
    targetOptions?: readonly string[];
  },
  hookContext: (() => TurnHookContext) | undefined,
  logger?: Pick<Logger, "error">,
): Promise<void> {
  const hooks = systemModule?.onRollResolved;
  if (!hooks || hooks.length === 0) return;
  const ctx = hookContext ? hookContext() : stubHookContext();
  // Each listener gets its own copy: a listener that mutated the event must not
  // change the message about to be broadcast.
  const systemId = systemModule.manifest.id;
  for (const hook of hooks) {
    try {
      await hook.fn(structuredClone(event), ctx);
    } catch (err) {
      logger?.error(
        { err, systemId, hookId: hook.id },
        `[roll-resolution] "onRollResolved" hook "${hook.id}" (system "${systemId}") threw/rejected — isolated`,
      );
    }
  }
}

function stubHookContext(): TurnHookContext {
  return { ...createStubTurnHookContextServices(), worldTime: { round: 0, turn: 0 } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readActor(store: DocumentStore, actorId: string): Record<string, unknown> | null {
  try {
    return store.get("actors", actorId);
  } catch {
    return null;
  }
}

/** The animal companions whose master is `masterActorId` (`system.masterActorId`), active or not. */
function companionsOf(store: DocumentStore, masterActorId: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const actor of store.getAll("actors")) {
    const system = actor["system"];
    if (typeof system !== "object" || system === null) continue;
    const sys = system as Record<string, unknown>;
    if (sys["companionKind"] === "animalCompanion" && sys["masterActorId"] === masterActorId) {
      found.push(actor);
    }
  }
  return found;
}

function mayRollFor(
  actor: Record<string, unknown>,
  roller: { userId: string; role: UserRole },
): boolean {
  if (isRolePrivileged(roller.role)) return true;
  const ownership = (actor["ownership"] ?? {}) as Ownership;
  return testOwnership(ownership, roller.userId, roller.role, OwnershipLevel.OWNER);
}

/**
 * The actor as the system sees it right now: `system` deep-cloned (the derive
 * steps write sibling cache fields — see derive-runner.ts) and re-derived. A
 * derivation failure falls back to the stored row, like `recomputeDerivedIfNeeded`.
 */
function rederive(
  actor: Record<string, unknown>,
  store: DocumentStore,
  systemModule: SystemModule,
): Record<string, unknown> {
  const sys = actor["system"];
  const working: Record<string, unknown> = {
    ...actor,
    system:
      sys && typeof sys === "object" && !Array.isArray(sys)
        ? structuredClone(sys as Record<string, unknown>)
        : {},
  };
  try {
    runActorDerivation(working, systemModule, resolveWorldVariantRules(store, systemModule));
    return working;
  } catch {
    return actor;
  }
}

/** The target's own options, unprefixed: `mark:<slug>` and `condition:<slug>` (+ `condition:<slug>:<value>`). */
function targetParty(
  store: DocumentStore,
  marks: TokenMarkSource,
  rollerActorId: string,
  entry: RollTargetSnapshotEntry,
): RollResolutionParty {
  const options: string[] = [];
  // No token (the roll named an actor directly) = nothing a mark could sit on.
  const markSlugs =
    entry.tokenId.length === 0
      ? []
      : marks.marksOn({
          rollerActorId,
          targetTokenId: entry.tokenId,
          targetActorId: entry.actorId,
        });
  for (const slug of markSlugs) {
    options.push(`mark:${slug}`);
  }
  const targetActor = entry.actorId !== null ? readActor(store, entry.actorId) : null;
  const items = targetActor?.["items"];
  if (Array.isArray(items)) {
    for (const raw of items as Record<string, unknown>[]) {
      if (raw["type"] !== "condition") continue;
      const system = raw["system"] as Record<string, unknown> | undefined;
      const slug = system?.["slug"];
      if (typeof slug !== "string" || slug.length === 0) continue;
      options.push(`condition:${slug}`);
      const value = system?.["value"];
      if (typeof value === "number") options.push(`condition:${slug}:${String(value)}`);
    }
  }
  return { tokenId: entry.tokenId, actorId: entry.actorId, options };
}
