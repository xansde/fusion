/**
 * actionBarRegistry.test.ts — the action-bar provider contract (BAR-F1-02, DEC-BAR-05).
 *
 * Covers, in this order:
 *  1. the registry — exact → "*" → null, mirroring `sheetRegistry` (REQ-BAR-012);
 *  2. `composeActionBarProvider` — slice concatenation, `execute` routing by kind with the
 *     owner's `ctx` as the fourth argument, and the construction-time checks;
 *  3. `assertValidEntries` — the rules of tasks.md §2.2 (REQ-BAR-017, REQ-BAR-031/032, D-15);
 *  4. the stub provider that BAR-F1-04 reuses;
 *  5. what only a real Vite build can show: the production default is decided at BUILD time
 *     (`import.meta.env.PROD`), and the registry's reactivity comes from the Svelte runtime.
 *
 * The client's Vitest runs in `environment: "node"` (no DOM), so everything here is plain
 * logic: no component is rendered. Section 5 runs `vite build` in memory and evaluates the
 * bundle — it is the only way to exercise what Vitest cannot (Vitest evaluates
 * `import.meta.env` live and compiles runes for the server, where `$effect` never runs).
 */

import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build } from "vite";
import type { PluginOption, Rollup } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionBarRegistryImpl,
  actionBarRegistry,
  assertValidEntries,
  composeActionBarProvider,
} from "../actionBarRegistry.js";
import type {
  ActionBarChoice,
  ActionBarContext,
  ActionBarEntry,
  ActionBarEntryKind,
  ActionBarProvider,
  ActionBarServices,
  ActionBarSlice,
} from "../types.js";
import {
  STUB_ACTOR_ID,
  createStubProvider,
  makeChoice,
  makeContext,
  makeEntry,
  makeServices,
  makeStubEntries,
  makeStubStatus,
} from "./stubProvider.js";
import type { observeRegistryReaders } from "./registryReactivityProbe.svelte.js";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** A provider that does nothing — only its identity matters to the registry tests. */
function fakeProvider(): ActionBarProvider {
  return {
    entries: () => [],
    status: () => makeStubStatus(),
    execute: () => Promise.resolve(),
  };
}

type ExecuteArgs = [ActionBarEntry, ActionBarChoice, ActionBarServices, ActionBarContext];

/** A slice that records what it was called with. */
function spySlice(kinds: ActionBarEntryKind[], produced: ActionBarEntry[] = []) {
  const entriesCalls: ActionBarContext[] = [];
  const executeCalls: ExecuteArgs[] = [];
  const slice: ActionBarSlice = {
    kinds,
    entries: (ctx) => {
      entriesCalls.push(ctx);
      return produced;
    },
    execute: (entry, choice, services, ctx) => {
      executeCalls.push([entry, choice, services, ctx]);
      return Promise.resolve();
    },
  };
  return { slice, entriesCalls, executeCalls };
}

const status = () => makeStubStatus();

function silenceWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. Registry
// ---------------------------------------------------------------------------

describe("ActionBarRegistryImpl.resolve (REQ-BAR-012: same criterion as the sheet)", () => {
  let registry: ActionBarRegistryImpl;

  beforeEach(() => {
    registry = new ActionBarRegistryImpl();
  });

  it("returns null when nothing is registered: the actor gets no bar", () => {
    expect(registry.resolve("Actor", "character")).toBeNull();
  });

  it("resolves the provider registered for the exact (documentType, subtype)", () => {
    const character = fakeProvider();
    const npc = fakeProvider();
    registry.register("Actor", "character", character);
    registry.register("Actor", "npc", npc);

    expect(registry.resolve("Actor", "character")).toBe(character);
    expect(registry.resolve("Actor", "npc")).toBe(npc);
  });

  it('falls back to the "*" provider of the same documentType when there is no exact match', () => {
    const fallback = fakeProvider();
    registry.register("Actor", "*", fallback);

    expect(registry.resolve("Actor", "familiar")).toBe(fallback);
  });

  it('prefers the exact match over "*"', () => {
    const exact = fakeProvider();
    registry.register("Actor", "*", fakeProvider());
    registry.register("Actor", "character", exact);

    expect(registry.resolve("Actor", "character")).toBe(exact);
  });

  it('returns null for a subtype with neither an exact match nor a "*" fallback', () => {
    registry.register("Actor", "character", fakeProvider());

    expect(registry.resolve("Actor", "npc")).toBeNull();
  });

  it('does not leak a "*" fallback across documentTypes', () => {
    registry.register("Actor", "*", fakeProvider());

    expect(registry.resolve("Item", "weapon")).toBeNull();
    expect(registry.resolve("Scene", "*")).toBeNull();
  });

  it("keeps documentTypes apart: a provider registered for Item is not an Actor provider", () => {
    const item = fakeProvider();
    registry.register("Item", "weapon", item);

    expect(registry.resolve("Item", "weapon")).toBe(item);
    expect(registry.resolve("Actor", "weapon")).toBeNull();
  });

  it("replaces the provider of an already registered key (registering twice at boot is safe)", () => {
    const first = fakeProvider();
    const second = fakeProvider();
    registry.register("Actor", "character", first);
    registry.register("Actor", "character", second);

    expect(registry.resolve("Actor", "character")).toBe(second);
  });

  it("finds a provider registered AFTER an earlier miss (the system registers once the table is mounted)", () => {
    expect(registry.resolve("Actor", "character")).toBeNull();

    const late = fakeProvider();
    registry.register("Actor", "character", late);

    expect(registry.resolve("Actor", "character")).toBe(late);
  });

  it("reset() forgets every registration", () => {
    registry.register("Actor", "character", fakeProvider());
    registry.register("Actor", "*", fakeProvider());

    registry.reset();

    expect(registry.resolve("Actor", "character")).toBeNull();
    expect(registry.resolve("Actor", "anything")).toBeNull();
  });
});

describe("actionBarRegistry (the singleton systems register into)", () => {
  beforeEach(() => {
    actionBarRegistry.reset();
  });
  afterEach(() => {
    actionBarRegistry.reset();
  });

  it("is an ActionBarRegistryImpl that starts empty", () => {
    expect(actionBarRegistry).toBeInstanceOf(ActionBarRegistryImpl);
    expect(actionBarRegistry.resolve("Actor", "character")).toBeNull();
  });

  it("is a different registry from a fresh instance (no shared state between instances)", () => {
    actionBarRegistry.register("Actor", "character", fakeProvider());

    expect(new ActionBarRegistryImpl().resolve("Actor", "character")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. composeActionBarProvider
// ---------------------------------------------------------------------------

describe("composeActionBarProvider.entries", () => {
  it("concatenates the entries of the slices in the order the slices come", () => {
    const strikes = spySlice(["strike"], [makeEntry("strike:a"), makeEntry("strike:b")]);
    const spells = spySlice(["spell"], [makeEntry("spell:main:x")]);

    const spellsFirst = composeActionBarProvider({
      slices: [spells.slice, strikes.slice],
      status,
    });
    const strikesFirst = composeActionBarProvider({
      slices: [strikes.slice, spells.slice],
      status,
    });
    const ctx = makeContext();

    expect(spellsFirst.entries(ctx).map((e) => e.id)).toEqual([
      "spell:main:x",
      "strike:a",
      "strike:b",
    ]);
    expect(strikesFirst.entries(ctx).map((e) => e.id)).toEqual([
      "strike:a",
      "strike:b",
      "spell:main:x",
    ]);
  });

  it("hands every slice the very same ctx", () => {
    const strikes = spySlice(["strike"]);
    const spells = spySlice(["spell"]);
    const provider = composeActionBarProvider({ slices: [strikes.slice, spells.slice], status });
    const ctx = makeContext();

    provider.entries(ctx);

    expect(strikes.entriesCalls).toHaveLength(1);
    expect(strikes.entriesCalls[0]).toBe(ctx);
    expect(spells.entriesCalls).toHaveLength(1);
    expect(spells.entriesCalls[0]).toBe(ctx);
  });

  it("re-reads the slices on every call (no memoisation: the shell calls it inside a $derived)", () => {
    const strikes = spySlice(["strike"], [makeEntry("strike:a")]);
    const provider = composeActionBarProvider({ slices: [strikes.slice], status });
    const ctx = makeContext();

    provider.entries(ctx);
    provider.entries(ctx);

    expect(strikes.entriesCalls).toHaveLength(2);
  });

  it("returns an empty list for no slices", () => {
    expect(composeActionBarProvider({ slices: [], status }).entries(makeContext())).toEqual([]);
  });
});

describe("composeActionBarProvider.execute", () => {
  it("routes by entry.kind to the slice that declares it, passing (entry, choice, services, ctx) untouched", async () => {
    const strikes = spySlice(["strike"]);
    const spells = spySlice(["spell"]);
    const actions = spySlice(["action", "reaction", "toggle"]);
    const provider = composeActionBarProvider({
      slices: [strikes.slice, spells.slice, actions.slice],
      status,
    });
    const entry = makeEntry("reaction:reactive-strike");
    const choice = makeChoice({ via: "key" });
    const services = makeServices();
    const ctx = makeContext();

    await provider.execute(entry, choice, services, ctx);

    expect(actions.executeCalls).toHaveLength(1);
    const [gotEntry, gotChoice, gotServices, gotCtx] = actions.executeCalls[0] as ExecuteArgs;
    expect(gotEntry).toBe(entry);
    expect(gotChoice).toBe(choice);
    expect(gotServices).toBe(services);
    expect(gotCtx).toBe(ctx);
    expect(strikes.executeCalls).toHaveLength(0);
    expect(spells.executeCalls).toHaveLength(0);
  });

  it("gives each call the ctx of the actor that owns the entry (a group runs once per actor, BAR-F4-03)", async () => {
    const strikes = spySlice(["strike"]);
    const provider = composeActionBarProvider({ slices: [strikes.slice], status });
    const entry = makeEntry("strike:shared-id");
    const ctxA = makeContext({ actorId: "actor-a" });
    const ctxB = makeContext({ actorId: "actor-b" });

    await provider.execute(entry, makeChoice(), makeServices(), ctxA);
    await provider.execute(entry, makeChoice(), makeServices(), ctxB);

    expect(strikes.executeCalls.map((call) => call[3])).toEqual([ctxA, ctxB]);
  });

  it("stays pending until the slice settles (the shell keeps the slot busy meanwhile)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slice: ActionBarSlice = { kinds: ["strike"], entries: () => [], execute: () => gate };
    const provider = composeActionBarProvider({ slices: [slice], status });
    let settled = false;

    const run = provider
      .execute(makeEntry("strike:a"), makeChoice(), makeServices(), makeContext())
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await run;
    expect(settled).toBe(true);
  });

  it("rejects, instead of throwing, for a kind that no slice declares", async () => {
    const provider = composeActionBarProvider({ slices: [spySlice(["strike"]).slice], status });
    let pending: Promise<void> | undefined;

    expect(() => {
      pending = provider.execute(
        makeEntry("spell:main:x"),
        makeChoice(),
        makeServices(),
        makeContext(),
      );
    }).not.toThrow();

    await expect(pending).rejects.toThrow(/no slice.*"spell"/);
  });

  it("propagates the refusal of the slice as the same Error (the shell turns it into a notice)", async () => {
    const refusal = new Error("Sem alvo");
    const slice: ActionBarSlice = {
      kinds: ["strike"],
      entries: () => [],
      execute: () => Promise.reject(refusal),
    };
    const provider = composeActionBarProvider({ slices: [slice], status });

    await expect(
      provider.execute(makeEntry("strike:a"), makeChoice(), makeServices(), makeContext()),
    ).rejects.toBe(refusal);
  });

  it("also turns a synchronous throw of a slice into a rejection", async () => {
    const slice: ActionBarSlice = {
      kinds: ["strike"],
      entries: () => [],
      execute: () => {
        throw new Error("boom");
      },
    };
    const provider = composeActionBarProvider({ slices: [slice], status });

    await expect(
      provider.execute(makeEntry("strike:a"), makeChoice(), makeServices(), makeContext()),
    ).rejects.toThrow("boom");
  });
});

describe("composeActionBarProvider — construction and pass-through", () => {
  it("throws when two slices declare the same kind", () => {
    expect(() =>
      composeActionBarProvider({
        slices: [spySlice(["strike", "spell"]).slice, spySlice(["spell"]).slice],
        status,
      }),
    ).toThrow(/two slices.*"spell"/);
  });

  it("accepts disjoint kinds, including a slice with none", () => {
    expect(() =>
      composeActionBarProvider({
        slices: [spySlice(["strike"]).slice, spySlice([]).slice, spySlice(["spell"]).slice],
        status,
      }),
    ).not.toThrow();
  });

  it("passes status, seed and details through untouched", () => {
    const statusFn = vi.fn(() => makeStubStatus());
    const seed = () => ["strike:a"];
    const details = (() => undefined) as unknown as NonNullable<ActionBarProvider["details"]>;
    const provider = composeActionBarProvider({ slices: [], status: statusFn, seed, details });
    const ctx = makeContext();

    expect(provider.status(ctx)).toEqual(makeStubStatus());
    expect(statusFn).toHaveBeenCalledWith(ctx);
    expect(provider.seed).toBe(seed);
    expect(provider.details).toBe(details);
  });

  it("leaves seed and details out when the system does not declare them", () => {
    const provider = composeActionBarProvider({ slices: [], status });

    expect("seed" in provider).toBe(false);
    expect("details" in provider).toBe(false);
  });
});

describe("composeActionBarProvider — the entries are validated", () => {
  it("throws outside production when a slice produces the same id twice", () => {
    const provider = composeActionBarProvider({
      slices: [spySlice(["strike"], [makeEntry("strike:a"), makeEntry("strike:a")]).slice],
      status,
    });

    expect(() => provider.entries(makeContext())).toThrow(/repeated/);
  });

  it("throws outside production when a slice produces an invalid entry", () => {
    const provider = composeActionBarProvider({
      slices: [spySlice(["action"], [makeEntry("action:a", { state: "unavailable" })]).slice],
      status,
    });

    expect(() => provider.entries(makeContext())).toThrow(/reason/);
  });

  it("throws outside production when a slice produces a kind it did not declare", () => {
    const provider = composeActionBarProvider({
      slices: [spySlice(["strike"], [makeEntry("spell:main:x")]).slice],
      status,
    });

    expect(() => provider.entries(makeContext())).toThrow(/declare/);
  });

  it("in production drops the offending entries, warns, and still serves the rest", () => {
    vi.stubEnv("PROD", true);
    const warn = silenceWarn();
    const provider = composeActionBarProvider({
      slices: [
        spySlice(["strike"], [makeEntry("strike:ok"), makeEntry("strike:stray", { kind: "spell" })])
          .slice,
        spySlice(["spell"], [makeEntry("spell:main:ok")]).slice,
      ],
      status,
    });

    const ids = provider.entries(makeContext()).map((e) => e.id);

    expect(ids).toEqual(["strike:ok", "spell:main:ok"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("strike:stray");
  });
});

// ---------------------------------------------------------------------------
// 3. assertValidEntries
// ---------------------------------------------------------------------------

describe("assertValidEntries — valid lists", () => {
  it("returns the same entries, in order, and does not touch them", () => {
    const entries = makeStubEntries();
    const snapshot = structuredClone(entries);

    const result = assertValidEntries(entries);

    expect(result).toHaveLength(entries.length);
    result.forEach((entry, i) => {
      expect(entry).toBe(entries[i]);
    });
    expect(entries).toEqual(snapshot);
  });

  it("accepts a state with a reason, a ready state without one, and one default per axis", () => {
    const entries = [
      makeEntry("action:a", { state: "unavailable", reason: "Já usado neste turno" }),
      makeEntry("action:b", { state: "spent-until-recharge", reason: "Recarrega ao descansar" }),
      makeEntry("action:c", { state: "ready" }),
      makeEntry("action:d", { state: "active" }),
      makeEntry("strike:e", {
        variants: [
          { id: "map:0", axis: "map", label: "1º", isDefault: true },
          { id: "map:1", axis: "map", label: "2º" },
          { id: "cost:1", axis: "cost", label: "1 ação", isDefault: true },
        ],
      }),
    ];

    expect(() => assertValidEntries(entries)).not.toThrow();
  });

  it("accepts the id shapes of §2.2: ':', '.', '_' and '-' inside the origin, up to 120 characters", () => {
    const ids = [
      "strike:abc123",
      "spell:entry-1:spell-9",
      "action:take-cover",
      "item:tool.kit",
      "reaction:reactive-strike",
      "toggle:raging",
      "toggle:some_flag",
      "check:skill-athletics",
      "check:lore-underworld",
      `strike:${"a".repeat(120)}`,
    ];

    expect(() => assertValidEntries(ids.map((id) => makeEntry(id)))).not.toThrow();
  });

  it("treats cost, badge, uses and groupUses as display only (D-15): nothing counts, blocks or rewrites", () => {
    const heavy = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`action:heavy-${String(i)}`, {
        cost: { kind: "action", count: 3 },
        badge: "+0",
        uses: { value: 0, max: 0 },
        groupUses: { value: 0, max: 0, style: "pips" },
      }),
    );
    const snapshot = structuredClone(heavy);

    const result = assertValidEntries(heavy);

    expect(result).toHaveLength(5);
    expect(heavy).toEqual(snapshot);
    expect(heavy.every((entry) => entry.state === undefined)).toBe(true);
  });
});

describe("assertValidEntries — invalid lists throw outside production (REQ-BAR-017, REQ-BAR-031)", () => {
  const cases: Array<[string, () => ActionBarEntry[], RegExp]> = [
    [
      "a repeated id",
      () => [makeEntry("strike:a"), makeEntry("strike:b"), makeEntry("strike:a")],
      /repeated/,
    ],
    [
      "an id whose prefix differs from the kind",
      () => [makeEntry("spell:main:x", { kind: "strike" })],
      /prefix/,
    ],
    [
      "an id without the <kind>: prefix",
      () => [makeEntry("strike:x", { id: "x" })],
      /does not match/,
    ],
    ["an id with a forbidden character", () => [makeEntry("strike:ab cd")], /does not match/],
    ["an empty origin", () => [makeEntry("strike:")], /does not match/],
    [
      "an id with an origin of 121 characters",
      () => [makeEntry(`strike:${"a".repeat(121)}`)],
      /does not match/,
    ],
    [
      'state "unavailable" without a reason',
      () => [makeEntry("action:a", { state: "unavailable" })],
      /reason/,
    ],
    [
      'state "spent-until-recharge" without a reason',
      () => [makeEntry("action:a", { state: "spent-until-recharge" })],
      /reason/,
    ],
    [
      "a blank reason",
      () => [makeEntry("action:a", { state: "unavailable", reason: "   " })],
      /reason/,
    ],
    [
      "two default variants on the same axis",
      () => [
        makeEntry("strike:a", {
          variants: [
            { id: "map:0", axis: "map", label: "1º", isDefault: true },
            { id: "map:1", axis: "map", label: "2º", isDefault: true },
          ],
        }),
      ],
      /2 default/,
    ],
    [
      "an axis with no default variant",
      () => [
        makeEntry("strike:a", {
          variants: [
            { id: "map:0", axis: "map", label: "1º" },
            { id: "map:1", axis: "map", label: "2º" },
          ],
        }),
      ],
      /0 default/,
    ],
    [
      "a repeated variant id inside one entry",
      () => [
        makeEntry("strike:a", {
          variants: [
            { id: "map:0", axis: "map", label: "1º", isDefault: true },
            { id: "map:0", axis: "cost", label: "1 ação", isDefault: true },
          ],
        }),
      ],
      /variant id/,
    ],
    ["an empty label", () => [makeEntry("strike:a", { label: "  " })], /label/],
  ];

  it.each(cases)("%s", (_name, build, message) => {
    expect(() => assertValidEntries(build())).toThrow(message);
  });

  it("names the offending entry in the error", () => {
    expect(() => assertValidEntries([makeEntry("action:a", { state: "unavailable" })])).toThrow(
      /action:a/,
    );
  });

  it("is the default outside a production build", () => {
    // Under Vitest `import.meta.env.PROD` is false: no option needed to get the strict behaviour.
    expect(() => assertValidEntries([makeEntry("strike:a"), makeEntry("strike:a")])).toThrow();
  });
});

describe("assertValidEntries — production drops the entry and warns (never breaks the table)", () => {
  it("drops only the offending entries, keeps the others in order, and warns once per drop", () => {
    const warn = silenceWarn();
    const good1 = makeEntry("strike:one");
    const dup = makeEntry("strike:one");
    const noReason = makeEntry("action:two", { state: "unavailable" });
    const good2 = makeEntry("spell:main:three");

    const result = assertValidEntries([good1, dup, noReason, good2], { onInvalid: "drop" });

    expect(result).toEqual([good1, good2]);
    expect(result[0]).toBe(good1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain("strike:one");
    expect(String(warn.mock.calls[1]?.[0])).toContain("action:two");
  });

  it("keeps the FIRST occurrence of a repeated id", () => {
    silenceWarn();
    const first = makeEntry("strike:a", { label: "primeira" });
    const second = makeEntry("strike:a", { label: "segunda" });

    const result = assertValidEntries([first, second], { onInvalid: "drop" });

    expect(result).toEqual([first]);
    expect(result[0]).toBe(first);
  });

  it("reads import.meta.env.PROD at call time: under Vitest a stubbed PROD switches the default to drop", () => {
    // Only the Vitest side of the switch; that a real build bakes PROD in is section 5.
    vi.stubEnv("PROD", true);
    const warn = silenceWarn();

    const result = assertValidEntries([makeEntry("action:a", { state: "unavailable" })]);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an explicit onInvalid beats the build mode", () => {
    vi.stubEnv("PROD", true);

    expect(() =>
      assertValidEntries([makeEntry("strike:a"), makeEntry("strike:a")], { onInvalid: "throw" }),
    ).toThrow(/repeated/);
  });

  it("does not warn when nothing is invalid", () => {
    const warn = silenceWarn();

    assertValidEntries(makeStubEntries(), { onInvalid: "drop" });

    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. The stub provider BAR-F1-04 reuses
// ---------------------------------------------------------------------------

describe("stub provider (shared with BAR-F1-04)", () => {
  beforeEach(() => {
    actionBarRegistry.reset();
  });
  afterEach(() => {
    actionBarRegistry.reset();
  });

  it("is what the registry hands back for (Actor, character)", () => {
    const { provider } = createStubProvider();
    actionBarRegistry.register("Actor", "character", provider);

    expect(actionBarRegistry.resolve("Actor", "character")).toBe(provider);
  });

  it("serves entries that pass the contract validation and cover all six tabs and all four states", () => {
    const { provider } = createStubProvider();

    const entries = provider.entries(makeContext());

    expect(() => assertValidEntries(entries)).not.toThrow();
    expect(new Set(entries.map((e) => e.tab))).toEqual(
      new Set(["strikes", "spells", "actions", "items", "reactions", "checks"]),
    );
    expect(new Set(entries.map((e) => e.state ?? "ready"))).toEqual(
      new Set(["ready", "active", "unavailable", "spent-until-recharge"]),
    );
  });

  it("serves a status with everything the strip draws", () => {
    const { provider } = createStubProvider();

    const strip = provider.status(makeContext());

    expect(strip.hp.temp).toBeGreaterThan(0);
    expect(strip.resources.map((r) => r.id)).toEqual(["focus", "hero"]);
    expect(strip.conditions).toHaveLength(1);
    expect(strip.nextAttack).toEqual({ mapPenalty: -5 });
    expect(strip.target).not.toBeNull();
    expect(strip.gmOnly).toBeUndefined();
  });

  it("runs execute through the composed provider and records the exact four arguments", async () => {
    const stub = createStubProvider();
    const entry = stub.entries.find((e) => e.kind === "strike") as ActionBarEntry;
    const choice = makeChoice();
    const services = makeServices();
    const ctx = makeContext();

    await stub.provider.execute(entry, choice, services, ctx);

    expect(stub.calls.execute).toHaveLength(1);
    expect(stub.calls.execute[0]?.entry).toBe(entry);
    expect(stub.calls.execute[0]?.choice).toBe(choice);
    expect(stub.calls.execute[0]?.services).toBe(services);
    expect(stub.calls.execute[0]?.ctx).toBe(ctx);
  });

  it("is a spy: each context it is called with is recorded once per call, never once per slice", () => {
    const stub = createStubProvider();
    const mine = makeContext();
    const foreign = makeContext({ actorId: "npc-not-mine" });

    stub.provider.entries(mine);
    stub.provider.status(mine);
    stub.provider.entries(foreign);

    expect(stub.calls.entries.map((c) => c.actorId)).toEqual([STUB_ACTOR_ID, "npc-not-mine"]);
    expect(stub.calls.status.map((c) => c.actorId)).toEqual([STUB_ACTOR_ID]);
  });

  it("lets a test refuse execute (a server refusal reaches the shell as a rejection)", async () => {
    const refusal = new Error("Sem foco");
    const stub = createStubProvider({ onExecute: () => Promise.reject(refusal) });
    const entry = stub.entries[0] as ActionBarEntry;

    await expect(
      stub.provider.execute(entry, makeChoice(), makeServices(), makeContext()),
    ).rejects.toBe(refusal);
    expect(stub.calls.execute).toHaveLength(1);
  });

  it("lets a test hold execute open (the slot stays busy until it settles)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stub = createStubProvider({ onExecute: () => gate });
    const entry = stub.entries[0] as ActionBarEntry;
    let settled = false;

    const run = stub.provider
      .execute(entry, makeChoice(), makeServices(), makeContext())
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await run;
    expect(settled).toBe(true);
  });

  it("serves its entries grouped by kind, in order of first appearance, and exposes that same order", () => {
    // One slice per kind: an interleaved list comes back regrouped, and `.entries` says so.
    const given = [makeEntry("strike:a"), makeEntry("check:b"), makeEntry("strike:c")];
    const stub = createStubProvider({ entries: given });

    const served = stub.provider.entries(makeContext());

    expect(served.map((e) => e.id)).toEqual(["strike:a", "strike:c", "check:b"]);
    expect(stub.entries.map((e) => e.id)).toEqual(["strike:a", "strike:c", "check:b"]);
  });

  it("serves the default entries in the very order it lists them", () => {
    const stub = createStubProvider();

    expect(stub.provider.entries(makeContext())).toEqual(stub.entries);
    expect(stub.entries).toEqual(makeStubEntries());
  });
});

// ---------------------------------------------------------------------------
// 5. What only a real Vite build can show
// ---------------------------------------------------------------------------

const CLIENT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REGISTRY_ENTRY = fileURLToPath(new URL("../actionBarRegistry.ts", import.meta.url));
const REACTIVITY_PROBE = fileURLToPath(
  new URL("./registryReactivityProbe.svelte.ts", import.meta.url),
);

/**
 * Bundle `entry` the way `vite build` does — minified, `import.meta.env` baked in — and return
 * the CommonJS text. `NODE_ENV` is what Vite reads for `import.meta.env.PROD`; Vitest sets it
 * to "test", so each test stubs it before calling this.
 */
async function bundle(
  entry: string,
  options: { mode: "production" | "development"; external?: RegExp[]; plugins?: PluginOption[] },
): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: "silent",
    root: CLIENT_ROOT,
    mode: options.mode,
    plugins: options.plugins ?? [],
    build: {
      write: false,
      minify: "esbuild",
      lib: { entry, formats: ["cjs"], fileName: "bundle" },
      rollupOptions: { external: options.external ?? [] },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const first = (Array.isArray(result) ? result[0] : result)?.output[0];
  if (first?.type !== "chunk") throw new Error("vite build produced no chunk");
  return first.code;
}

/** Evaluate CommonJS text; `requireModule` answers its `require` calls. */
function evaluate<T>(code: string, requireModule: (id: string) => unknown): T {
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, requireModule);
  return module.exports as T;
}

/** `svelte/reactivity` outside the bundle: a plain Map stands in for the reactive one. */
function requireOnlySvelteReactivity(id: string): unknown {
  if (id === "svelte/reactivity") return { SvelteMap: Map };
  throw new Error(`unexpected require("${id}")`);
}

describe("built by Vite — the production default is decided at build time", () => {
  type BuiltRegistry = {
    assertValidEntries: typeof assertValidEntries;
    composeActionBarProvider: typeof composeActionBarProvider;
  };
  const invalid = () => [makeEntry("action:a", { state: "unavailable" }), makeEntry("strike:ok")];
  /** The provider the shell really calls: composed, with a slice that hands back `invalid()`. */
  const composedFrom = (built: BuiltRegistry) =>
    built.composeActionBarProvider({
      slices: [{ kinds: ["action", "strike"], entries: invalid, execute: () => Promise.resolve() }],
      status,
    });

  it("a production build drops the invalid entry and warns, instead of throwing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const code = await bundle(REGISTRY_ENTRY, { mode: "production", external: [/^svelte/] });
    const built = evaluate<BuiltRegistry>(code, requireOnlySvelteReactivity);
    const warn = silenceWarn();

    const kept = built.assertValidEntries(invalid());
    expect(kept.map((e) => e.id)).toEqual(["strike:ok"]);
    expect(warn).toHaveBeenCalledTimes(1);

    // The composed provider is what the shell calls inside a $derived: same decision.
    const served = composedFrom(built).entries(makeContext());
    expect(served.map((e) => e.id)).toEqual(["strike:ok"]);
    expect(warn).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("a development build still throws (control: the harness tells the two builds apart)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const code = await bundle(REGISTRY_ENTRY, { mode: "development", external: [/^svelte/] });
    const built = evaluate<BuiltRegistry>(code, requireOnlySvelteReactivity);

    expect(() => built.assertValidEntries(invalid())).toThrow(/reason/);
    expect(() => composedFrom(built).entries(makeContext())).toThrow(/reason/);
  }, 60_000);
});

describe("built by Vite — the registry is reactive (SvelteMap)", () => {
  it("an effect that found no provider re-runs when one registers later, and when the registry resets", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const code = await bundle(REACTIVITY_PROBE, { mode: "production", plugins: [svelte()] });
    const probe = evaluate<{ observeRegistryReaders: typeof observeRegistryReaders }>(
      code,
      (id) => {
        throw new Error(`unexpected require("${id}")`);
      },
    );
    const provider = createStubProvider().provider;

    const seen = probe.observeRegistryReaders(provider);

    // What the effect saw, in order: no provider yet → the provider that came late → none after reset().
    expect(seen.exact).toEqual([null, provider, null]);
    // A reader that asked for a concrete subtype also sees a "*" provider registered late.
    expect(seen.wildcard).toEqual([null, provider]);
  }, 60_000);
});
