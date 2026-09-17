/**
 * Additional system registries: conditions/status effects, chat cards,
 * declarative actions, settings, i18n, and sheets.
 *
 * This module defines the TYPE contracts and the STORAGE structures placed on
 * SystemModule. Consumption (server enforcement, client rendering, setting
 * persistence) is incremental and belongs to server/client packages.
 *
 * REQ-SYS-040: sheet registration.
 * REQ-SYS-043: condition/status effect registration.
 * REQ-SYS-044: condition operations contract (types only — implementation in server).
 * REQ-SYS-045: declarative action registration.
 * REQ-SYS-046: chat card registration.
 * REQ-SYS-047: setting registration.
 * REQ-SYS-048/049: i18n contract.
 *
 * REQ-ARQ-005: must NOT import from server or client.
 */
import type { z, ZodType } from "zod";
import type { EffectRule, StackingTable } from "./effects.js";
import type { DocumentType } from "./manifest.js";
import type { ActorSnapshot } from "./actor-mechanics.js";
import type { TurnHookContext } from "./combat.js";
import type {
  ActorApplyDamagePayload,
  FusionExpiry,
  ItemConsumePayload,
  ItemConsumeResult,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Sheets (REQ-SYS-040 / REQ-SYS-041)
// ---------------------------------------------------------------------------

/**
 * Context passed to a system sheet component by the engine.
 *
 * `system` is typed as `S` (inferred from the Zod schema), carrying the
 * post-prepareData derived state.
 *
 * REQ-SYS-041.
 */
export interface SystemSheetContext<S = unknown> {
  /** The full Document (contains _id, flags, ownership, etc.). */
  readonly document: Record<string, unknown>;
  /** The derived `system` data (post-prepareData). */
  readonly system: S;
  /**
   * Effective ownership level for the viewing user.
   * Maps to @fusion/shared OwnershipLevel; typed as number here
   * to avoid circular import.
   */
  readonly ownership: number;
  /**
   * Update the document. Merges `changes` into the document and
   * persists via the server CRUD pipeline.
   */
  update(changes: Record<string, unknown>): Promise<void>;
}

/**
 * Registration spec for a system sheet component.
 *
 * A `component` is a Svelte 5 component (Runes). Typed as `unknown` here
 * because Svelte types live in the client package.
 *
 * REQ-SYS-040.
 */
export interface SystemSheetSpec {
  readonly documentType: DocumentType;
  /** Subtypes this sheet handles. */
  readonly subtypes: string[];
  /**
   * The Svelte 5 component. Typed as unknown to avoid a hard dependency on
   * the Svelte runtime in system-api.
   */
  readonly component: unknown;
  /** When true, this is the default sheet for the listed subtypes. */
  readonly makeDefault?: boolean;
  /** Display label (shown in sheet selector). */
  readonly label: string;
}

/** Internal storage for a registered sheet. */
export interface RegisteredSheet extends SystemSheetSpec {
  readonly id: string; // generated: `${documentType}:${subtypes.join(",")}:${label}`
}

// ---------------------------------------------------------------------------
// Conditions / status effects (REQ-SYS-043 / REQ-SYS-044)
// ---------------------------------------------------------------------------

/**
 * Definition of a game condition or status effect.
 *
 * REQ-SYS-043.
 */
export interface ConditionDefinition {
  /**
   * Machine-readable stable identifier.
   * e.g., "frightened", "off-guard", "dying", "fatigued".
   */
  readonly slug: string;
  /** Localizable display label. */
  readonly label: string;
  /** Path to the condition icon (relative to system root or absolute URL). */
  readonly img: string;
  /**
   * When true, the condition carries a numeric value (e.g., Frightened 1-4).
   * `setCondition(slug, value)` and `increaseCondition`/`decreaseCondition`
   * are meaningful only for valued conditions.
   */
  readonly valued?: boolean;
  /**
   * Effect rules automatically applied when this condition is active.
   * A valued condition receives the value as context for parametrized effects.
   */
  readonly effects?: EffectRule[];
  /**
   * Slugs of conditions this condition overrides/removes on application
   * (e.g., "unconscious" overrides "dying" in PF2e).
   */
  readonly overrides?: string[];

  // -------------------------------------------------------------------------
  // Display contract (REQ-SYS-043, DEC-SYS-10 / DEC-CTT-11)
  //
  // The UI knows no condition: it paints what the system declared. All three
  // fields are OPTIONAL so an already-registered system stays valid, and their
  // absence degrades the display instead of hiding the condition
  // (REQ-CTT-035): no `tone` → drawn as a situation; no `help` → drawn with no
  // tooltip; no `critical` → drawn without the filled emphasis.
  // -------------------------------------------------------------------------

  /**
   * Effect on whoever carries the condition — never a severity judgement.
   * `"benefit"` helps, `"harm"` hinders, `"special"` is a situation
   * (detection, attitude, control). Absent ⇒ treated as `"special"`.
   */
  readonly tone?: ConditionTone;

  /**
   * Short help text, already translated by the system, shown in the UI's own
   * drawn tooltip. Absent ⇒ no tooltip.
   */
  readonly help?: string;

  /**
   * The condition takes the character out of the scene (dying, unconscious…).
   * Drawn as filled emphasis of the tone's own color — never a fourth color.
   */
  readonly critical?: boolean;
}

/**
 * Effect of a condition on whoever carries it (REQ-SYS-043).
 *
 * Deliberately NOT a severity scale: severity is a judgement no declared datum
 * supports, so the contract only carries direction.
 */
export type ConditionTone = "benefit" | "harm" | "special";

// ---------------------------------------------------------------------------
// Declarative actions (REQ-SYS-045)
// ---------------------------------------------------------------------------

/**
 * Context available when a declarative action `run()` is invoked.
 *
 * Typed loosely here; concrete types are in the client/server packages.
 */
export interface ActionContext {
  /** The actor executing the action. */
  readonly actor: Record<string, unknown>;
  /** The item providing the action (if any). */
  readonly item?: Record<string, unknown>;
  /** Active roll options at the time of invocation. */
  readonly rollOptions: ReadonlySet<string>;
}

/**
 * Definition of a declarative game action.
 *
 * Actions are invocable from sheets, macros, and chat cards. They may
 * post rolls via the roll engine and emit chat cards.
 *
 * REQ-SYS-045.
 */
export interface ActionDefinition {
  /** Machine-readable stable identifier. e.g., "trip", "demoralize". */
  readonly slug: string;
  /** Localizable display label. */
  readonly label: string;
  /** Optional icon path. */
  readonly img?: string;
  /**
   * Roll options injected into the roll context when this action executes.
   * e.g., ["action:trip", "trait:attack"].
   */
  readonly rollOptions?: string[];
  /**
   * The action implementation. May be async (post chat cards, await rolls).
   * I/O is allowed here — actions are not pure.
   */
  run(ctx: ActionContext): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Chat cards (REQ-SYS-046)
// ---------------------------------------------------------------------------

/**
 * Definition of a chat card renderer.
 *
 * A chat card renders a `ChatMessage` in the chat panel. The renderer
 * receives the message's system-specific payload and returns either an HTML
 * string (sanitized before display) or a Svelte component.
 *
 * Inline `data-action` attributes in the HTML are resolved via registered
 * ActionDefinitions (REQ-SYS-045).
 *
 * REQ-SYS-046.
 */
export interface ChatCardDefinition {
  /** Discriminator for the card type (e.g., "damage-roll", "check-result"). */
  readonly cardType: string;
  /**
   * Render the card from its payload.
   *
   * Return type is `unknown` to avoid hard deps on Svelte.
   * Callers cast to `SvelteComponent | string`.
   */
  render(payload: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Settings (REQ-SYS-047)
// ---------------------------------------------------------------------------

/**
 * Definition of a system setting.
 *
 * Settings are persisted by the engine (world-scope in world.db, client-scope
 * in localStorage). The `schema` Zod type is used to validate values in
 * get/set operations.
 *
 * REQ-SYS-047.
 */
export interface SettingDefinition<S extends ZodType = ZodType> {
  /**
   * Unique key within the system's namespace.
   * Access via `game.settings.get(systemId, key)`.
   */
  readonly key: string;
  /**
   * Persistence scope:
   * - `"world"` — shared across all users of the world.
   * - `"user"` — per-user within the world (persisted server-side).
   * - `"client"` — per-browser client (persisted in localStorage).
   */
  readonly scope: "world" | "user" | "client";
  /** Zod schema for the setting value. Infers the TypeScript type. */
  readonly schema: S;
  /** Default value (must satisfy the schema). */
  readonly default: z.infer<S>;
  /** Localizable label for the settings UI. */
  readonly label: string;
  /** Optional longer description hint. */
  readonly hint?: string;
  /**
   * When true, the engine shows a "Reload Required" notice after changing
   * this setting.
   */
  readonly requiresReload?: boolean;
  /**
   * Spec 37 REQ-CFG-082 / DEC-CFG-09: when true, turning this setting OFF
   * (from `true` to `false`) does NOT apply until the settings UI has asked
   * for confirmation showing how many of the world's actors are affected.
   * Turning it ON never confirms — this flag only gates the disable
   * direction. Meaningless outside a boolean setting.
   */
  readonly requiresConfirmOnDisable?: boolean;
  /**
   * Spec 37 REQ-CFG-082: counts how many of the world's Actor documents would
   * be left with an illegitimate choice if this setting were turned off —
   * the number the confirmation shows. Only consulted when
   * `requiresConfirmOnDisable` is true. Server-only, like `onChange`: never
   * crosses the wire (see settings-handlers.ts's `settings:impact`).
   */
  countAffectedActors?(actors: readonly Record<string, unknown>[]): number;
  /**
   * Called (on all clients for "world" scope) when the setting value changes.
   */
  onChange?(value: z.infer<S>): void;
}

/** Erased setting definition (schema's type parameter dropped for storage). */
export interface ErasedSettingDefinition {
  readonly key: string;
  readonly scope: "world" | "user" | "client";
  readonly schema: ZodType;
  readonly default: unknown;
  readonly label: string;
  // Note: optional properties without exactOptionalPropertyTypes issue — we use
  // `string | undefined` here so callers can set these from optional source fields.
  readonly hint: string | undefined;
  readonly requiresReload: boolean | undefined;
  readonly requiresConfirmOnDisable: boolean | undefined;
  readonly countAffectedActors:
    | ((actors: readonly Record<string, unknown>[]) => number)
    | undefined;
  readonly onChange: ((value: unknown) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Roll data (M5-A / E1)
// ---------------------------------------------------------------------------

/**
 * Definition of a registered roll-data builder for a (documentType, subtype)
 * pair.
 *
 * A system registers how to assemble the `rollData` object (the `@attr`
 * substitution source consumed by RollService/replaceFormulaData) from a
 * Document. This lets @-references such as `@perception` or
 * `@atributos.alma.value` resolve consistently wherever a roll is issued
 * server-side (chat rolls, initiative, future system-specific rolls) without
 * every call site re-deriving the same ad-hoc shape.
 *
 * Aditive/retrocompatible: when no system has registered a builder for a
 * given (documentType, subtype), callers fall back to whatever rollData they
 * already assemble/pass today (or none at all) — nothing breaks.
 *
 * REQ-ETM-015 / spec 15 §API de sistemas.
 */
export interface RollDataDefinition {
  readonly documentType: DocumentType;
  /** Subtypes this builder handles. Empty array = all subtypes of documentType. */
  readonly subtypes: string[];
  /**
   * Build the rollData object for a given document (typically an Actor).
   *
   * Pure function: reads the document, returns a plain object. No I/O.
   */
  build(doc: Record<string, unknown>): Record<string, unknown>;
}

/** Internal storage for a registered roll-data builder. */
export interface RegisteredRollData extends RollDataDefinition {
  readonly id: string; // generated: `${documentType}:${subtypes.join(",")}`
}

// ---------------------------------------------------------------------------
// Degree of success (M5-A / E2)
// ---------------------------------------------------------------------------

/**
 * Generic degree-of-success result.
 *
 * `degree` is a system-defined string — each system owns its own set (e.g.
 * PF2e/SF2e keep using the 4-degree engine-2e helper via their existing
 * pipeline; a non-2e-family system could register a simpler "success"/
 * "failure" pair instead). `meta` carries any extra system-specific data
 * (e.g. margin) alongside the degree.
 */
export interface DegreeOfSuccessResult {
  readonly degree: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Context passed to a registered degree-of-success comparator.
 * Loosely typed (kept generic — systems interpret their own fields).
 */
export type DegreeOfSuccessContext = Record<string, unknown>;

/**
 * Definition of a registered degree-of-success comparator.
 *
 * A system registers `compute(total, dc, ctx)` to classify a roll result
 * against a difficulty class using its own rules (e.g. a binary
 * success/failure + margin classification, REQ-ROL-038/039).
 *
 * Aditive/retrocompatible: this is a NEW, independent registry keyed by `id`
 * (not by documentType/subtype) — it does not replace or require migrating
 * the existing `postRoll` hook or the engine-2e 4-degree helper used by
 * PF2e/SF2e today. A system that does not register here simply has no entry
 * in `SystemModule.registries.degreeOfSuccess`; consumers fall back to
 * whatever degree computation they already perform (e.g. PF2e/SF2e keep
 * calling `calculateDegreeOfSuccess` from `@fusion/engine-2e` directly).
 */
export interface DegreeOfSuccessDefinition {
  /** Machine-readable stable identifier (e.g. "pf2e.strike"). */
  readonly id: string;
  /** Classify a roll total against a DC. Pure function. */
  compute(total: number, dc: number, ctx?: DegreeOfSuccessContext): DegreeOfSuccessResult;
}

// ---------------------------------------------------------------------------
// Effects materializer (M5-A / E4)
// ---------------------------------------------------------------------------

/**
 * A source of EffectRules attached to a document — structurally identical to
 * (and interchangeable with) `@fusion/engine-2e`'s `EffectSource`, redeclared
 * here so `system-api` can expose this surface WITHOUT depending on
 * `engine-2e` (REQ-ARQ-005: system-api may be depended on by system packages,
 * not the other way around; engine-2e itself already imports `EffectRule`
 * from `system-api`).
 *
 * A 2e-family system's materializer returns actual `EffectSource[]` values
 * (structurally compatible with this type); a non-2e-family system may
 * return an empty array or a different rule vocabulary entirely — the
 * `rules` field only needs to satisfy `EffectRule[]`'s discriminated shape,
 * consumption of those rules is entirely up to whatever engine the caller
 * feeds them into.
 */
export interface GenericEffectSource {
  readonly sourceId: string;
  readonly label: string;
  readonly rules: readonly EffectRule[];
  readonly active?: boolean;
  readonly isEquipped?: boolean;
  readonly isInvested?: boolean;
}

/**
 * Definition of a registered effects materializer for a (documentType,
 * subtype) pair.
 *
 * A system registers how to turn a Document's authored state (embedded
 * condition items, active effects, whatever the system models) into the flat
 * list of `EffectSource`s an effects engine consumes. This lets the
 * derive-runner delegate materialization to the ACTIVE system instead of
 * hardcoding the 2e-family (`collectEffects` from `@fusion/engine-2e`)
 * pipeline — see `packages/server/src/net/derive-runner.ts`.
 *
 * Aditive/retrocompatible: when no system has registered a materializer for
 * a given (documentType, subtype), callers fall back to their existing
 * hardcoded materialization (today: the derive-runner's 2e-family fallback,
 * used unchanged by PF2e/SF2e).
 */
export interface EffectsMaterializerDefinition {
  readonly documentType: DocumentType;
  /** Subtypes this materializer handles. Empty array = all subtypes of documentType. */
  readonly subtypes: string[];
  /**
   * Build the EffectSource list for a given document (typically an Actor).
   *
   * Pure function: reads the document, returns a plain array. No I/O.
   */
  build(doc: Record<string, unknown>): GenericEffectSource[];
}

/** Internal storage for a registered effects materializer. */
export interface RegisteredEffectsMaterializer extends EffectsMaterializerDefinition {
  readonly id: string; // generated: `${documentType}:${subtypes.join(",")}`
}

// ---------------------------------------------------------------------------
// i18n (REQ-SYS-048 / REQ-SYS-049)
// ---------------------------------------------------------------------------

/**
 * A language bundle declared by the system manifest.
 *
 * The engine loads each bundle and merges translations with precedence:
 *   Engine strings → System strings (system overrides engine only for
 *   keys namespaced under the system id).
 *
 * REQ-SYS-048.
 */
export interface LanguageBundle {
  /** BCP-47 language tag (e.g., "pt-BR", "en"). */
  readonly lang: string;
  /** Human-readable language name. */
  readonly name: string;
  /** Path to the translation JSON relative to the system root. */
  readonly path: string;
}

// ---------------------------------------------------------------------------
// Compendium packs (REQ-SYS-005)
// ---------------------------------------------------------------------------

/**
 * Compendium pack announced by the system in its manifest.
 *
 * The engine loads pack metadata at boot; the importer (spec 16) handles
 * actual item import. Systems only declare packs here.
 *
 * REQ-SYS-005.
 */
export interface PackDefinition {
  readonly name: string;
  readonly label: string;
  readonly documentType: string;
  readonly system: string;
  readonly path: string;
}

// ---------------------------------------------------------------------------
// ExtendedRegistrarAccumulator
// Additions to the internal accumulator inside defineSystem
// ---------------------------------------------------------------------------

/**
 * Additional accumulation slots added to the SystemRegistrar's internal state
 * for M3-A registries.
 */
export interface ExtendedAccumulator {
  sheets: RegisteredSheet[];
  conditions: Map<string, ConditionDefinition>;
  actions: Map<string, ActionDefinition>;
  chatCards: Map<string, ChatCardDefinition>;
  settings: Map<string, ErasedSettingDefinition>;
  stackingTable: StackingTable | null;
  rollData: RegisteredRollData[];
  degreeOfSuccess: Map<string, DegreeOfSuccessDefinition>;
  effectsMaterializers: RegisteredEffectsMaterializer[];
}

/** Build a blank ExtendedAccumulator. */
export function emptyExtendedAccumulator(): ExtendedAccumulator {
  return {
    sheets: [],
    conditions: new Map(),
    actions: new Map(),
    chatCards: new Map(),
    settings: new Map(),
    stackingTable: null,
    rollData: [],
    degreeOfSuccess: new Map(),
    effectsMaterializers: [],
  };
}

// ---------------------------------------------------------------------------
// Extended SystemModule fields
// ---------------------------------------------------------------------------

/**
 * The additional registry data exposed on a built SystemModule.
 *
 * These registries hold the system's declarations. The engine/client/server
 * consume them as needed (sheets → client, settings → server, etc.).
 */
export interface ExtendedSystemRegistries {
  /** Sheets registered by (documentType, subtype). */
  readonly sheets: ReadonlyArray<RegisteredSheet>;
  /** Conditions, keyed by slug. */
  readonly conditions: ReadonlyMap<string, ConditionDefinition>;
  /** Declarative actions, keyed by slug. */
  readonly actions: ReadonlyMap<string, ActionDefinition>;
  /** Chat card renderers, keyed by cardType. */
  readonly chatCards: ReadonlyMap<string, ChatCardDefinition>;
  /** Settings definitions, keyed by key. */
  readonly settings: ReadonlyMap<string, ErasedSettingDefinition>;
  /** System-declared stacking table for modifier aggregation. */
  readonly stackingTable: StackingTable | null;
  /** Roll-data builders, one per registered (documentType, subtypes) pair. REQ-ETM-015 / M5-A E1. */
  readonly rollData: ReadonlyArray<RegisteredRollData>;
  /** Degree-of-success comparators, keyed by id. M5-A E2. */
  readonly degreeOfSuccess: ReadonlyMap<string, DegreeOfSuccessDefinition>;
  /** Effects materializers, one per registered (documentType, subtypes) pair. M5-A E4. */
  readonly effectsMaterializers: ReadonlyArray<RegisteredEffectsMaterializer>;
}

// ---------------------------------------------------------------------------
// ConsumeItem — spec 15 REQ-SYS-143/144, spec 17 REQ-PF2-224..228, plan §2.6.
// Task ALQ-F2-11 (this contract's owner — "F2-11" in the plan's §2 table).
//
// Same split as ActorMechanics (DEC-SYS-12): `item:consume` is a CORE op
// (permission, atomicity, expectedVersion — packages/server); the RULE (what
// to spend, what effect to copy, what to roll, what card to post) is a pure
// function a system registers once via `registrar.registerConsumeItem`. The
// core applies the returned `ConsumePlan` — it never invents writes itself.
//
// Field-level shapes below are copied verbatim from spec 15's own fenced
// code block (§"Consumo de item e hooks de consumo") EXCEPT
// `ConsumePlanContext.roll`, which that block does not declare — spec 15
// carries the SAME "interfaces são ilustrativas, não-normativas em detalhes
// de campo" disclaimer `actor-mechanics.ts` already leans on for
// `ApplyConditionOptions.now`, and `roll` is this task's own necessary
// addition for the same reason: REQ-PF2-225 requires healing/damage
// "declarado pelo item" to be ROLLED server-side (CSPRNG, REQ-ROL-025), but
// `plan()` is synchronous and must not depend on `@dice-roller/rpg-dice-roller`
// directly (that library is server-only — `packages/server/src/chat/
// roll-service.ts` — and system-api/systems packages must never depend on
// `packages/server`, REQ-ARQ-005). The core injects a synchronous callback
// backed by the SAME audited RollService every other Fusion roll uses;
// `plan()` calls it and bakes the resolved total into `ConsumePlan.damage`
// BEFORE returning, so the returned plan is still a complete, self-contained
// description the core only has to APPLY (REQ-SYS-143 step 4: "aplica
// writes, effects, damage e cards atomicamente").
// ---------------------------------------------------------------------------

/**
 * Read-only Item document handed to `ConsumeItemDefinition`. Untyped beyond
 * `Record<string, unknown>` for the same reason `ActorSnapshot` is
 * (DEC-SYS-12: the engine does not know a system's `system` field shape) —
 * `null` in `mode: "resource"`, where no item is involved at all.
 */
export type ItemSnapshot = Record<string, unknown>;

/**
 * One write the core applies on behalf of a plan — REQ-SYS-143 step 4. The
 * SAME shape spec 15 reuses for daily preparation and crafting (§"Preparação
 * diária e fabricação"), so this type is intentionally generic rather than
 * consume-specific. `updateItem`/`deleteItem` address an EMBEDDED item on the
 * actor being consumed from (by its own `_id`); `createItem` adds a new
 * embedded item (e.g. a temporary/derived item — not used by this task's own
 * `plan()`, but part of the shared contract future tasks rely on).
 */
export type DocOp =
  | { readonly kind: "updateActor"; readonly diff: Record<string, unknown> }
  | { readonly kind: "createItem"; readonly data: Record<string, unknown> }
  | { readonly kind: "updateItem"; readonly itemId: string; readonly diff: Record<string, unknown> }
  | { readonly kind: "deleteItem"; readonly itemId: string };

/**
 * One effect to copy from a compendium pack onto an actor (DF-06: always a
 * COPY with origin/start, never a live reference — plan §2.5). `packId` is
 * typed optional (spec 15's own field), but the core does not guess a
 * default — DEC-SYS-12 (the engine does not hardcode game-pack knowledge
 * like "effectRefs live in equipment-effects"): a `plan()` that omits it has
 * that one effect skipped (logged, never a thrown/fatal error) rather than
 * silently resolved against a pack the core invented. The pf2e `plan()`
 * (ALQ-F2-11) always sets it.
 */
export interface PlannedEffect {
  readonly targetActorId: string;
  /** `flags.fusion.sourceId` of the Effect document in the pack — never the pack-local `_id` (DF-06 identity discipline). */
  readonly sourceId: string;
  readonly packId?: string;
  readonly origin: {
    readonly actorId: string;
    readonly itemSourceId?: string;
    readonly itemLevel?: number;
    readonly infused?: boolean;
  };
  /** Shape fixed by plan §2.5 (`FusionExpiry`, `@fusion/shared`). */
  readonly expiry: FusionExpiry;
}

/** Only present in `mode: "strike"` — out of this task's tested scope (ALQ-F2-13 owns strike derivation); carried here so the contract is complete for whichever task wires it. */
export interface PlannedStrike {
  readonly strikeId: string;
  readonly mapIndex: 0 | 1 | 2;
  readonly formula: string;
  readonly flavor: string;
  readonly rollContext: Record<string, unknown>;
}

/**
 * Context handed to `plan()` — REQ-SYS-143. `targets` mirrors the caster's
 * CURRENT live target selection (same shape `TargetSelection`/plan §2.3
 * resolves), independent of `mode: "use"`'s own default-to-self target.
 */
export interface ConsumePlanContext {
  readonly inCombat: boolean;
  readonly combatId: string | null;
  readonly round: number | null;
  readonly targets: ReadonlyArray<{ readonly tokenId: string; readonly actorId: string | null }>;
  /**
   * Server-authoritative dice roll (REQ-ROL-024/025) — this task's own
   * necessary addition; see this section's header comment. Returns only the
   * roll's total (no chat message is posted for it on its own — REQ-PF2-225
   * only requires the ONE combined consume card `plan()` already builds via
   * `ConsumePlan.cards`, not a second, separate roll card).
   */
  roll(formula: string): number;
}

/**
 * What `plan()` returns — REQ-SYS-143 step 4: pure, never writes. The core
 * applies `writes`/`effects`/`damage`/`cards` after a successful ownership +
 * `expectedVersion` check, inside the SAME operation.
 */
export interface ConsumePlan {
  /** Charge/quantity/resource bookkeeping — REQ-PF2-224. */
  readonly writes: readonly DocOp[];
  readonly consumed: ItemConsumeResult["consumed"];
  /** Effect copies to create — REQ-PF2-225, plan §2.5 (`EffectItem`). */
  readonly effects: readonly PlannedEffect[];
  /** Healing/damage the item declares, already rolled — REQ-PF2-225, passed to `ActorMechanicsService.applyDamage` with `actingAs: "system"` (REQ-SYS-142), never a direct actor write. */
  readonly damage: readonly ActorApplyDamagePayload[];
  /** Only meaningful in `mode: "strike"`. */
  readonly strike?: PlannedStrike;
  /** One or more chat cards describing what was consumed/applied — REQ-PF2-225. `flags` is opaque to the core, same discipline as `TurnHookContext.chat`'s own `flags?: Record<string, unknown>` (turn-hook-runner.ts). */
  readonly cards: ReadonlyArray<{
    readonly content: string;
    readonly flags?: Record<string, unknown>;
  }>;
  /** What the item does that the system does NOT automate — REQ-PF2-225 ("nota" for `automation !== "full"`). */
  readonly notes: readonly string[];
}

/**
 * The pure rule a system registers via `registrar.registerConsumeItem(def)`,
 * at most once per system (REQ-SYS-143). `appliesTo` decides whether this
 * definition has anything to say about a given (item, payload) pair — a
 * false answer (or no definition registered at all) resolves the whole op to
 * `NOT_SUPPORTED` without writing anything (REQ-SYS-143 step 6, same posture
 * as `ActorMechanics` having no registration for `actor:applyDamage`).
 */
export interface ConsumeItemDefinition {
  appliesTo(item: ItemSnapshot | null, payload: ItemConsumePayload): boolean;
  plan(
    actor: ActorSnapshot,
    item: ItemSnapshot | null,
    payload: ItemConsumePayload,
    ctx: ConsumePlanContext,
  ): ConsumePlan;
}

/**
 * Thrown by `plan()` to signal that THIS specific attempt is invalid — e.g.
 * an item already at zero charges with `autoDestroy: false` (REQ-PF2-224:
 * "recusa o próximo uso"). Distinct from `appliesTo` returning `false`
 * (which means "no rule at all applies here", answered `NOT_SUPPORTED`):
 * this is "the rule applies, but this call violates it", answered
 * `VALIDATION_FAILED` (REQ-SYS-143 step 1's own error code, extended to this
 * game-rule-level case since `plan()`'s return type has no room for an
 * error union — it must stay a plain, unconditional `ConsumePlan` so a
 * SUCCESSFUL plan is always a complete, self-contained description
 * (REQ-SYS-143 step 4) with nothing to branch on).
 */
export class ConsumePlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsumePlanValidationError";
  }
}

/**
 * `registerConsumeHook`'s callback — REQ-SYS-144, the SINGLE post-consume
 * extension point (no parallel `onConsume`/`onConsumed`, and consume must
 * NOT be observed via `hooks.on`, which is post-broadcast notification —
 * REQ-SYS-144's own wording). Runs after persisting the consume and before
 * the broadcast, same ordering/serialization/error-isolation as REQ-SYS-139,
 * same `TurnHookContext` as REQ-SYS-140.
 */
export type ConsumeHookFn = (
  e: {
    readonly actorId: string;
    /** `null` in `mode: "resource"` — no item is involved. */
    readonly item: ItemSnapshot | null;
    readonly payload: ItemConsumePayload;
    readonly result: ItemConsumeResult;
  },
  ctx: TurnHookContext,
) => void | Promise<void>;
