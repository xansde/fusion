/**
 * settings-impact.test.ts — the server side of REQ-CFG-082's "quantos são
 * afetados" (spec 37 §5.4/§5.9, G103, Q-CFG-03).
 *
 * Mirrors settings-declarations.test.ts's fixtures: a hand-written fake
 * system, never `pf2e`, proving `buildSettingsImpactHandler` has no branch
 * keyed on any one setting's key or system id (REQ-CFG-031) — what "affected"
 * means is entirely the declaring system's own `countAffectedActors`.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildSettingsImpactHandler,
  type ErasedSettingDefinitionLike,
  type SettingsActorStoreSource,
  type SettingsRegistrySource,
} from "../net/handlers/settings-handlers.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { UserRole } from "../documents/ownership.js";

function fakeSystemWith(
  systemId: string,
  defs: ErasedSettingDefinitionLike[],
): SettingsRegistrySource {
  return {
    manifest: { id: systemId },
    registries: { settings: new Map(defs.map((def) => [def.key, def])) },
  };
}

function fakeActors(actors: Record<string, unknown>[]): SettingsActorStoreSource {
  return { getAll: () => actors };
}

function ctx(role: number): HandlerContext {
  return { userId: "user-1", role, worldId: "world-1" };
}

async function ask(
  systemModule: SettingsRegistrySource | undefined,
  actorStore: SettingsActorStoreSource | undefined,
  key: string,
  role = UserRole.GAMEMASTER,
) {
  const ack = await buildSettingsImpactHandler(systemModule, actorStore)({ key }, ctx(role));
  if (!("ok" in ack) || !ack.ok) throw new Error("handler refused");
  return ack.result;
}

// ---------------------------------------------------------------------------
// A fake system's variant-rule-shaped setting — never `pf2e` (REQ-CFG-031).
// ---------------------------------------------------------------------------

const FAKE_ACTORS = [
  { _id: "actor-1", type: "character", system: { build: { freeArchetype: true } } },
  { _id: "actor-2", type: "character", system: { build: { freeArchetype: false } } },
  { _id: "actor-3", type: "character", system: { build: { freeArchetype: true } } },
  { _id: "actor-4", type: "npc", system: { build: { freeArchetype: true } } },
];

const FAKE_SETTING_WITH_COUNTER: ErasedSettingDefinitionLike = {
  key: "freeArchetype",
  scope: "world",
  schema: z.boolean(),
  default: false,
  label: "Free Archetype (fake)",
  requiresConfirmOnDisable: true,
  countAffectedActors: (actors) =>
    actors.filter(
      (a) =>
        a["type"] === "character" &&
        (a["system"] as Record<string, unknown> | undefined)?.["build"] &&
        ((a["system"] as Record<string, unknown>)["build"] as Record<string, unknown>)[
          "freeArchetype"
        ] === true,
    ).length,
};

describe("buildSettingsImpactHandler — REQ-CFG-082: a real count, from the system's own predicate", () => {
  it("counts exactly what the declaring system's countAffectedActors says (2 characters, not the npc)", async () => {
    const system = fakeSystemWith("fake-system", [FAKE_SETTING_WITH_COUNTER]);
    const result = await ask(system, fakeActors(FAKE_ACTORS), "fake-system:freeArchetype");
    expect(result).toEqual({ count: 2 });
  });

  it("REQ-CFG-031: two systems with identically-shaped counters answer identically — nothing branches on the key or system id", async () => {
    const systemA = fakeSystemWith("system-a", [FAKE_SETTING_WITH_COUNTER]);
    const systemB = fakeSystemWith("system-b", [
      { ...FAKE_SETTING_WITH_COUNTER, key: "someOtherToggle" },
    ]);
    const resultA = await ask(systemA, fakeActors(FAKE_ACTORS), "system-a:freeArchetype");
    const resultB = await ask(systemB, fakeActors(FAKE_ACTORS), "system-b:someOtherToggle");
    expect(resultA).toEqual(resultB);
  });

  it("degrades to { count: 0 } — never an error — when no system is resolved", async () => {
    const result = await ask(undefined, fakeActors(FAKE_ACTORS), "fake-system:freeArchetype");
    expect(result).toEqual({ count: 0 });
  });

  it("degrades to { count: 0 } when the key does not belong to this system (wrong namespace prefix)", async () => {
    const system = fakeSystemWith("fake-system", [FAKE_SETTING_WITH_COUNTER]);
    const result = await ask(system, fakeActors(FAKE_ACTORS), "another-system:freeArchetype");
    expect(result).toEqual({ count: 0 });
  });

  it("degrades to { count: 0 } when the local key is not declared at all", async () => {
    const system = fakeSystemWith("fake-system", [FAKE_SETTING_WITH_COUNTER]);
    const result = await ask(system, fakeActors(FAKE_ACTORS), "fake-system:neverDeclared");
    expect(result).toEqual({ count: 0 });
  });

  it("degrades to { count: 0 } when the declared setting registered no countAffectedActors (an unconfirmable setting has nothing to confirm)", async () => {
    const withoutCounter: ErasedSettingDefinitionLike = {
      key: "plainToggle",
      scope: "world",
      schema: z.boolean(),
      default: false,
      label: "Plain toggle",
    };
    const system = fakeSystemWith("fake-system", [withoutCounter]);
    const result = await ask(system, fakeActors(FAKE_ACTORS), "fake-system:plainToggle");
    expect(result).toEqual({ count: 0 });
  });

  it("degrades to { count: 0 } on a malformed payload instead of throwing", async () => {
    const system = fakeSystemWith("fake-system", [FAKE_SETTING_WITH_COUNTER]);
    const ack = await buildSettingsImpactHandler(system, fakeActors(FAKE_ACTORS))(
      { notAKey: 123 },
      ctx(UserRole.GAMEMASTER),
    );
    expect("ok" in ack && ack.ok && ack.result).toEqual({ count: 0 });
  });

  it("REQ-GAV-034/DEC-CFG-05: a PLAYER is refused with PERMISSION_DENIED — never runs countAffectedActors for them", async () => {
    const system = fakeSystemWith("fake-system", [FAKE_SETTING_WITH_COUNTER]);
    const ack = await buildSettingsImpactHandler(system, fakeActors(FAKE_ACTORS))(
      { key: "fake-system:freeArchetype" },
      ctx(UserRole.PLAYER),
    );
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("ASSISTANT_GM (role 3) is refused too — DEC-CFG-05 says GAMEMASTER, not the generic privileged threshold", async () => {
    const system = fakeSystemWith("fake-system", [FAKE_SETTING_WITH_COUNTER]);
    const ack = await buildSettingsImpactHandler(system, fakeActors(FAKE_ACTORS))(
      { key: "fake-system:freeArchetype" },
      ctx(UserRole.ASSISTANT_GM),
    );
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });
});
