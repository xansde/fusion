/**
 * stubProvider.ts — test double for the action-bar provider contract (BAR-F1-02).
 *
 * NOT a test file (Vitest only runs `*.test.ts`): it is the helper that
 * `actionBarRegistry.test.ts` uses and that BAR-F1-04 reuses to render the bar
 * shell before any game system exists. It builds the provider the same way a
 * system does — slices composed by `composeActionBarProvider` — so a test that
 * uses it also exercises the real composition and validation path.
 *
 * It is also a SPY: every `ctx` the shell hands to `entries`, `status` and
 * `execute` is recorded in `calls`, which is what the ownership-gate tests
 * (BAR-F1-01 / BAR-F1-04, D-BA01) read to prove a provider is never called with
 * an actor the viewer does not own.
 *
 * No Vitest import on purpose: calls are recorded in plain arrays, so the helper
 * works with any runner and the caller decides whether to wrap them in `vi.fn`.
 */

import { composeActionBarProvider } from "../actionBarRegistry.js";
import type {
  ActionBarChoice,
  ActionBarContext,
  ActionBarEntry,
  ActionBarEntryKind,
  ActionBarProvider,
  ActionBarServices,
  ActionBarSlice,
  ActionBarStatus,
} from "../types.js";

export const STUB_ACTOR_ID = "actor-stub";
export const STUB_USER_ID = "user-stub";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** A full, valid `ActionBarContext` for the stub actor; override only what the test is about. */
export function makeContext(overrides: Partial<ActionBarContext> = {}): ActionBarContext {
  return {
    actorId: STUB_ACTOR_ID,
    actor: { _id: STUB_ACTOR_ID, type: "character", name: "Personagem Stub", system: {} },
    derived: {},
    tokenId: null,
    viewer: { userId: STUB_USER_ID, isGm: false },
    combat: { inCombat: false, round: null, isMyTurn: false, targets: [] },
    ...overrides,
  };
}

/** The choice of a plain click: no variant picked (the entry default applies), no targets. */
export function makeChoice(overrides: Partial<ActionBarChoice> = {}): ActionBarChoice {
  return { variants: {}, targetTokenIds: [], via: "click", ...overrides };
}

const TAB_OF_KIND: Record<ActionBarEntryKind, ActionBarEntry["tab"]> = {
  strike: "strikes",
  spell: "spells",
  action: "actions",
  item: "items",
  reaction: "reactions",
  toggle: "actions",
  check: "checks",
};

/**
 * A minimal valid entry. `kind` and `tab` are derived from the id prefix
 * (`"strike:x"` → strike / strikes); `overrides` win, which is how a test builds
 * an INVALID entry on purpose (`makeEntry("spell:x", { kind: "strike" })`).
 */
export function makeEntry(id: string, overrides: Partial<ActionBarEntry> = {}): ActionBarEntry {
  const kind = id.slice(0, id.indexOf(":")) as ActionBarEntryKind;
  return { id, kind, tab: TAB_OF_KIND[kind], label: `Entrada ${id}`, ...overrides };
}

/** The services handed to `execute`, with everything the provider did recorded for assertions. */
export interface RecordingServices extends ActionBarServices {
  readonly sentOps: unknown[];
  readonly requests: Array<{ type: string; payload: Record<string, unknown> }>;
  readonly notices: string[];
  readonly openedSheets: string[];
}

export function makeServices(overrides: Partial<ActionBarServices> = {}): RecordingServices {
  const sentOps: unknown[] = [];
  const requests: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const notices: string[] = [];
  const openedSheets: string[] = [];
  return {
    sentOps,
    requests,
    notices,
    openedSheets,
    getSocket: () => null,
    worldId: "world-stub",
    userId: STUB_USER_ID,
    isGm: false,
    sendOp: (op) => {
      sentOps.push(op);
    },
    request: <R = unknown>(type: string, payload: Record<string, unknown>): Promise<R> => {
      requests.push({ type, payload });
      return Promise.resolve(undefined as R);
    },
    openActorSheet: (actorId) => {
      openedSheets.push(actorId);
    },
    notify: (message) => {
      notices.push(message);
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The stub provider
// ---------------------------------------------------------------------------

/**
 * Thirteen entries that cover what the shell has to draw: all six tabs, the four
 * entry states (`ready`, `active`, `unavailable`, `spent-until-recharge`), cost
 * seals (action, reaction, free, variable), the MAP variants of a strike, the
 * header counter of a spell group and a stack count. Fresh objects on every
 * call, so one test cannot leak a mutation into another.
 */
export function makeStubEntries(): ActionBarEntry[] {
  return [
    {
      id: "strike:stub-sword",
      kind: "strike",
      tab: "strikes",
      label: "Espada Longa",
      shortLabel: "Espada",
      icon: "sword",
      cost: { kind: "action", count: 1 },
      traits: ["versátil"],
      badge: "+9",
      target: "one",
      range: { kind: "reach", feet: 5 },
      effect: "1d8 cortante",
      variants: [
        {
          id: "map:0",
          axis: "map",
          label: "1º ataque",
          badge: "+9",
          hint: "depois deste: MAP −5",
          isDefault: true,
        },
        {
          id: "map:1",
          axis: "map",
          label: "2º ataque",
          badge: "+4",
          hint: "depois deste: MAP −10",
        },
        { id: "map:2", axis: "map", label: "3º ataque", badge: "−1" },
      ],
    },
    {
      id: "strike:stub-bow",
      kind: "strike",
      tab: "strikes",
      label: "Arco Curto",
      icon: "bow",
      cost: { kind: "action", count: 1 },
      badge: "+7",
      target: "one",
      range: { kind: "range", feet: 60 },
    },
    {
      id: "spell:stub-main:burst",
      kind: "spell",
      tab: "spells",
      group: "Truques",
      label: "Rajada",
      icon: "spark",
      cost: { kind: "activity", min: 1, max: 3, unit: "action" },
      badge: "CD 18",
      target: "many",
      range: { kind: "range", feet: 30 },
    },
    {
      id: "spell:stub-main:heal",
      kind: "spell",
      tab: "spells",
      group: "1º grau",
      groupUses: { value: 2, max: 3, style: "count" },
      label: "Cura",
      icon: "heart",
      rank: 1,
      cost: { kind: "activity", min: 1, max: 3, unit: "action" },
      target: "one",
      range: { kind: "range", feet: 30 },
      variants: [
        { id: "cost:1", axis: "cost", label: "1 ação" },
        { id: "cost:2", axis: "cost", label: "2 ações", isDefault: true },
        { id: "cost:3", axis: "cost", label: "3 ações" },
      ],
    },
    {
      id: "action:stub-seek",
      kind: "action",
      tab: "actions",
      label: "Investigar",
      icon: "eye",
      cost: { kind: "action", count: 1 },
    },
    {
      id: "action:stub-stride",
      kind: "action",
      tab: "actions",
      label: "Deslocar",
      icon: "boot",
      cost: { kind: "action", count: 1 },
    },
    {
      id: "action:stub-command",
      kind: "action",
      tab: "actions",
      label: "Comandar um Animal",
      icon: "paw",
      cost: { kind: "action", count: 1 },
      state: "unavailable",
      reason: "Já usado neste turno",
    },
    {
      id: "toggle:stub-guard",
      kind: "toggle",
      tab: "actions",
      label: "Postura de Guarda",
      icon: "shield",
      cost: { kind: "free" },
      state: "active",
    },
    {
      id: "reaction:stub-reactive-strike",
      kind: "reaction",
      tab: "reactions",
      label: "Golpe Reativo",
      icon: "sword",
      cost: { kind: "reaction" },
      state: "spent-until-recharge",
      reason: "Reação já gasta nesta rodada",
    },
    {
      id: "item:stub-potion",
      kind: "item",
      tab: "items",
      label: "Poção de Cura Menor",
      icon: "flask",
      cost: { kind: "action", count: 1 },
      uses: { value: 2, max: 3 },
    },
    {
      id: "item:stub-rope",
      kind: "item",
      tab: "items",
      label: "Corda",
      icon: "rope",
    },
    {
      id: "check:stub-perception",
      kind: "check",
      tab: "checks",
      label: "Percepção",
      icon: "eye",
      badge: "+8",
    },
    {
      id: "check:skill-athletics",
      kind: "check",
      tab: "checks",
      group: "Perícias",
      label: "Atletismo",
      icon: "fist",
      badge: "+6",
    },
  ];
}

/** A full `ActionBarStatus` (strip content): hit points with temporary, pips, a condition, MAP and a target. */
export function makeStubStatus(overrides: Partial<ActionBarStatus> = {}): ActionBarStatus {
  return {
    name: "Personagem Stub",
    subtitle: "Ladino 1",
    hp: { value: 18, max: 24, temp: 3 },
    resources: [
      { id: "focus", label: "Foco", style: "pips", value: 1, max: 2 },
      { id: "hero", label: "Herói", style: "pips", value: 1, max: 3 },
    ],
    conditions: [
      { id: "frightened", name: "Assustado", value: 1, effect: "Penalidade de status nos testes." },
    ],
    nextAttack: { mapPenalty: -5 },
    target: { tokenId: "token-target", name: "Alvo Stub" },
    ...overrides,
  };
}

/** One recorded `execute` call, with the four arguments exactly as the shell passed them. */
export interface StubExecuteCall {
  entry: ActionBarEntry;
  choice: ActionBarChoice;
  services: ActionBarServices;
  ctx: ActionBarContext;
}

export interface StubProviderOptions {
  /** Entries to serve; default is {@link makeStubEntries}. One slice is built per distinct kind, so they are served grouped by kind. */
  entries?: readonly ActionBarEntry[];
  /** Status to serve; default is {@link makeStubStatus}. */
  status?: ActionBarStatus;
  /**
   * What `execute` does after being recorded. Default resolves at once. Pass a deferred
   * promise to hold a slot busy, or a rejection to simulate a server refusal.
   */
  onExecute?: (call: StubExecuteCall) => Promise<void>;
}

export interface StubProvider {
  readonly provider: ActionBarProvider;
  /** The entries in the order `provider.entries(ctx)` serves them (grouped by kind). */
  readonly entries: readonly ActionBarEntry[];
  /** Every context the provider was called with, in call order — once per call, not once per slice. */
  readonly calls: {
    readonly entries: ActionBarContext[];
    readonly status: ActionBarContext[];
    readonly execute: StubExecuteCall[];
  };
}

export function createStubProvider(options: StubProviderOptions = {}): StubProvider {
  const given = options.entries ?? makeStubEntries();
  const status = options.status ?? makeStubStatus();
  const onExecute = options.onExecute ?? (() => Promise.resolve());
  const calls: StubProvider["calls"] = { entries: [], status: [], execute: [] };

  // One slice per kind, in order of first appearance: the provider serves the entries GROUPED by
  // kind, so `entries` (the public list) is regrouped the same way and always equals what it serves.
  const kinds = [...new Set(given.map((entry) => entry.kind))];
  const entries = kinds.flatMap((kind) => given.filter((entry) => entry.kind === kind));
  const slices = kinds.map(
    (kind): ActionBarSlice => ({
      kinds: [kind],
      entries: () => entries.filter((entry) => entry.kind === kind),
      execute: (entry, choice, services, ctx) => onExecute({ entry, choice, services, ctx }),
    }),
  );
  const composed = composeActionBarProvider({ slices, status: () => status });

  // The spy sits OUTSIDE the composed provider: it records what the shell called.
  const provider: ActionBarProvider = {
    entries: (ctx) => {
      calls.entries.push(ctx);
      return composed.entries(ctx);
    },
    status: (ctx) => {
      calls.status.push(ctx);
      return composed.status(ctx);
    },
    execute: (entry, choice, services, ctx) => {
      calls.execute.push({ entry, choice, services, ctx });
      return composed.execute(entry, choice, services, ctx);
    },
  };

  return { provider, entries, calls };
}
