/**
 * types.ts — the action-bar provider contract (BAR-F1-02, DEC-BAR-05, REQ-BAR-011..020).
 *
 * The CORE owns the shell of the action bar (position, strip, tabs, slots, tooltip, menu,
 * keyboard); a game SYSTEM supplies the content through a provider registered in
 * `actionBarRegistry`, the same way `registerPf2eSheets` fills `sheetRegistry` and
 * `skillNameRegistry`. The satellite imports these types and the registry from the core
 * through the `$lib/…` alias; the core NEVER imports the satellite (dependency-cruiser rule
 * `client-core-must-not-import-system-sheets`).
 *
 * Types only — no runtime code, and no barrel `index.ts` in this folder: every importer
 * names the module it needs. The names and shapes are fixed by `docs/design/barra-de-acoes/
 * tasks.md` §2.1–§2.3 (reconciled with spec 53 §7.1); change them there first.
 *
 * Nothing in these types counts, spends or blocks an action (D-15): `cost`, `badge`,
 * `uses` and `groupUses` are display data, and `state` comes from a real resource or state
 * of the actor, never from a per-turn action count.
 */

import type { Component } from "svelte";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Provider and slices (§2.1)
// ---------------------------------------------------------------------------

/** What a system registers, one per (documentType, subtype) — see `actionBarRegistry`. */
export interface ActionBarProvider {
  /** Entries of the active actor. Only the doc in `ctx` + the reactive reads the sheet already uses. Never opens the sheet. */
  entries(ctx: ActionBarContext): ActionBarEntry[];
  /** Status strip: hit points, resources, conditions, target, MAP of the next attack. */
  status(ctx: ActionBarContext): ActionBarStatus;
  /**
   * Runs the entry through the SAME functions the sheet uses; the server validates everything.
   * A refusal or an error rejects with an `Error`.
   *
   * `ctx` is the context of the ACTOR THAT OWNS THE ENTRY (the same one `entries(ctx)` came
   * from): the provider is one per actor type and an entry id is unique only within its actor,
   * so it is through `ctx.actor` / `ctx.actorId` that the provider finds the document and
   * builds the sheet view-model.
   */
  execute(
    entry: ActionBarEntry,
    choice: ActionBarChoice,
    services: ActionBarServices,
    ctx: ActionBarContext,
  ): Promise<void>;
  /** The system's detail panel (the same one the sheet shows), opened with Alt on the tooltip. */
  details?: Component<{ entry: ActionBarEntry }>;
  /**
   * Ids that seed the favourites the first time the bar opens (BAR-F3-01): up to 12, in slot order,
   * each the id of an entry this provider lists. `[]` means "nothing to seed (yet)": the shell asks
   * again when the entries change, and writes only a non-empty answer. For an actor that was already
   * seeded (`flags.fusion.actionBar.seeded`) it answers `[]` — after the seed nothing enters by
   * itself (D-BA08).
   */
  seed?(ctx: ActionBarContext): string[];
}

/** One piece of a provider: what each module of the system supplies. The system composes the slices. */
export interface ActionBarSlice {
  /** The entry kinds this slice BOTH builds AND executes. Two slices never declare the same kind. */
  readonly kinds: readonly ActionBarEntryKind[];
  entries(ctx: ActionBarContext): ActionBarEntry[];
  execute(
    entry: ActionBarEntry,
    choice: ActionBarChoice,
    services: ActionBarServices,
    ctx: ActionBarContext,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Entry, variants and cost (§2.2)
// ---------------------------------------------------------------------------

/**
 * Tabs of the bar. Labels are fixed in the core (pt-BR): Golpes, Magias, Ações, Itens,
 * Reações, Testes. "Favoritos" is not a tab of entries: it is the main row of 12 slots.
 * A tab without entries shows the empty state.
 */
export type ActionBarTab = "strikes" | "spells" | "actions" | "items" | "reactions" | "checks";

export type ActionBarEntryKind =
  | "strike"
  | "spell"
  | "action"
  | "item"
  | "reaction"
  | "toggle"
  | "check";

/**
 * Cost shown in the corner of a slot. Display data only (D-15): nothing counts, nothing blocks.
 *
 * Same shape as the cost of the Alchemist plan (ALQ-F7-02), under ANOTHER NAME on purpose: the
 * client already exports a display type for the compendium (`{ icons, label, isText }`, in
 * `lib/compendium/documentDetails.ts`), and two types with one name in one package is the error
 * Q-BAR-06 exists to prevent. The core does not import the satellite; since the shape is the
 * same, the satellite's value is accepted here by structural typing.
 *
 * To SHOW it, the shell uses `actionBarCostToken` + the existing `formatActionCost`, so glyphs
 * and labels have a single source (action ◆ ◆◆ ◆◆◆ · reaction ⟳ · free ◇). A variable cost
 * (Heal from 1 to 3 actions, a Burst) is `{ kind: "activity", min: 1, max: 3, unit: "action" }`.
 */
export type ActionBarCost =
  | { kind: "action"; count: 1 | 2 | 3 }
  | { kind: "reaction" }
  | { kind: "free" }
  | { kind: "activity"; min: number; max?: number; unit: "action" | "minute" | "hour" | "day" }
  | { kind: "passive" }
  | { kind: "none" };

export interface ActionBarVariant {
  /** Stable within the entry: "map:0|1|2", "cost:1|2|3", "rank:<n>", "element:<slug>". */
  id: string;
  axis: "map" | "cost" | "rank" | "element";
  label: string; // pt-BR: "1º ataque", "2 ações", "3º grau", "Fogo"
  badge?: string; // what the slot shows while this variant is in use: "+9", "−1", "CD 18"
  hint?: string; // what changes next: "depois deste: MAP −10"
  isDefault?: boolean; // exactly one per axis
  reason?: string; // present ⇒ the variant is drawn faded, with the reason
}

export interface ActionBarEntry {
  /** "<kind>:<origin>", stable within the actor; it is what a favourite and a custom icon store. */
  id: string;
  kind: ActionBarEntryKind;
  tab: ActionBarTab;
  group?: string; // "Truques", "2º grau", "Atletismo"…
  label: string; // pt-BR, the pack's name — the bar has no names of its own
  shortLabel?: string; // D-BA15: short name under the icon; without it the core abbreviates `label`
  icon?: string; // key of the core's free icon set (never Paizo art)
  cost?: ActionBarCost;
  traits?: string[];
  badge?: string; // final bonus or DC: "+4", "CD 18"
  uses?: { value: number; max?: number }; // quantity, uses, charges
  groupUses?: { value: number; max: number; style: "count" | "pips" }; // group header: "1º grau 2/3", "Foco ●○"
  rank?: number; // rank seal on the slot (T3)
  countsForMap?: boolean; // MAP seal (T4): Grapple, Shove, Trip…
  state?: "ready" | "unavailable" | "spent-until-recharge" | "active"; // absent = "ready"
  reason?: string; // why it is faded; required for "unavailable" and "spent-until-recharge"
  variants?: ActionBarVariant[];
  target?: "none" | "one" | "many";
  range?: { kind: "reach" | "range"; feet: number };
  effect?: string; // one line for the short tooltip
}

// ---------------------------------------------------------------------------
// Context, status, choice and services (§2.3)
// ---------------------------------------------------------------------------

export interface ActionBarTargetRef {
  tokenId: string;
  actorId: string;
  /** What the token ALREADY shows this user (same identity as `getMyTargets()`); never the real name of a hidden NPC. */
  name: string;
}

export interface ActionBarCombatContext {
  inCombat: boolean; // there is an encounter in progress
  round: number | null;
  isMyTurn: boolean; // the participant on the clock is the user's (`activeCombatantIsOwnedBy`)
  targets: ReadonlyArray<ActionBarTargetRef>; // getMyTargets(), name redacted
}

export interface ActionBarContext {
  actorId: string;
  /** The actor document in the mirror, current version. Only an actor the ownership gate let through gets here (§2.4). */
  actor: Readonly<Record<string, unknown>>;
  /** `actor.system.derived`, which the server recalculates and persists (the sheet VM reads from there). The bar never writes it. */
  derived: Readonly<Record<string, unknown>>;
  tokenId: string | null; // the bar's token in the current scene; null = the player's character has no token in the scene
  viewer: { userId: string; isGm: boolean };
  combat: ActionBarCombatContext;
}

export interface ActionBarResource {
  id: string; // "focus" | "hero" | "class:<slug>" (BAR-F7-06)
  label: string;
  style: "pips" | "count";
  value: number;
  max: number;
}

export interface ActionBarStatus {
  name: string;
  subtitle?: string; // "Ladino 1 / Investigador 2"
  portrait?: string; // path /assets/… already served to whoever sees the actor
  hp: { value: number; max: number; temp: number };
  /** Only with `ctx.viewer.isGm` (T6). For a player this field is NEVER filled. */
  gmOnly?: { ac?: number };
  resources: ActionBarResource[]; // Focus and Hero (T1, T3); class resource in BAR-F7-06
  conditions: Array<{ id: string; name: string; value?: number; effect?: string }>; // only the name on the strip; `effect` opens on click (D-B23)
  nextAttack?: { mapPenalty: 0 | -5 | -10 }; // MAP of the NEXT attack, from the server
  target: { tokenId: string; name: string } | null; // target chip; `name` = ActionBarTargetRef.name (redacted)
}

export interface ActionBarChoice {
  /** axis → id of the chosen variant. An absent axis = the entry's `isDefault` variant. */
  variants: Partial<Record<ActionBarVariant["axis"], string>>;
  /** Targets marked at the instant of the trigger. The shell reads `getMyTargets()`; the provider NEVER reads a target on its own. */
  targetTokenIds: readonly string[];
  via: "click" | "key" | "menu";
}

export interface ActionBarServices {
  /** Live socket, resolved on every op (the frozen socket of a stale window was a real bug of `makeSendOpFn`). */
  getSocket(): Socket | null;
  worldId: string;
  userId: string;
  isGm: boolean;
  /** The sheet's `makeSendOpFn`: a FLAT op `{ type, ...fields }` (includes posting to chat, `chat:send`); fills `expectedVersion` itself, returns nothing. */
  sendOp(op: unknown): void;
  /** Envelope with a reply, `sendOp(socket, { type, payload })` of `lib/docs/sendOp.ts`; rejects with `OpError`. For what returns a result (`item:consume`). */
  request<R = unknown>(type: string, payload: Record<string, unknown>): Promise<R>;
  /** "Open on the sheet" (`openActorSheet`). */
  openActorSheet(actorId: string): void;
  /** Short message on the bar's strip (server refusal, "no target"). Fades on its own. */
  notify(message: string): void;
  /** Enters aim mode and resolves with the marked tokens; `null` if cancelled. Only exists after BAR-F8-02. */
  requestTargets?(opts: { count: "one" | "many" }): Promise<readonly string[] | null>;
}
