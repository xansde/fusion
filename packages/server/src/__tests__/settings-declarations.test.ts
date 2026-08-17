/**
 * settings-declarations.test.ts — G102 (Fase 9 — Aba Configurações), Seção
 * Mundo: the door a declared `world`-scope setting crosses to reach the tab
 * (spec 37 §5.4, REQ-CFG-030, REQ-CFG-031, RNF-CFG-02).
 *
 * These assertions are about the PAYLOAD `buildSettingsDeclarationsHandler`
 * answers with, not a screen — mirrors `system-conditions.test.ts`'s shape.
 * The point proved here is genericity: the handler has no branch keyed on any
 * one setting's key, so a system that declares a setting it has never seen
 * before (a FAKE system, never `pf2e`) still gets rendered correctly, without
 * a line of this file — or the handler — needing to change (RNF-CFG-02).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pf2eSystem } from "@fusion/system-pf2e";

import {
  buildSettingsDeclarationsHandler,
  classifySettingSchema,
  type ErasedSettingDefinitionLike,
  type SettingsRegistrySource,
  type SettingsStoreSource,
} from "../net/handlers/settings-handlers.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { UserRole } from "../documents/ownership.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A stand-in for the world's SystemModule — written by hand, exactly like
 * `system-conditions.test.ts`'s `systemWith`, so the test proves the wire
 * contract instead of a Map round-tripping through itself.
 */
function fakeSystemWith(
  systemId: string,
  defs: ErasedSettingDefinitionLike[],
): SettingsRegistrySource {
  return {
    manifest: { id: systemId },
    registries: { settings: new Map(defs.map((def) => [def.key, def])) },
  };
}

function fakeStore(docs: { _id: string; key: string; value: unknown }[]): SettingsStoreSource {
  return {
    getAll: () => docs.map((d) => ({ _id: d._id, key: d.key, value: d.value })),
  };
}

function ctx(role: number): HandlerContext {
  return { userId: "user-1", role, worldId: "world-1" };
}

function ask(
  systemModule: SettingsRegistrySource | undefined,
  store?: SettingsStoreSource,
  role = UserRole.GAMEMASTER,
) {
  const ack = buildSettingsDeclarationsHandler(systemModule, store)({}, ctx(role));
  if (!("ok" in ack) || !ack.ok) throw new Error("handler refused");
  return ack.result;
}

// ---------------------------------------------------------------------------
// Schema → kind classification (the piece REQ-CFG-030 names)
// ---------------------------------------------------------------------------

describe("classifySettingSchema — REQ-CFG-030's three shapes", () => {
  it("a boolean schema classifies as a toggle", () => {
    expect(classifySettingSchema(z.boolean())).toEqual({ kind: "boolean" });
  });

  it("a number schema classifies as a numeric field", () => {
    expect(classifySettingSchema(z.number())).toEqual({ kind: "number" });
  });

  it("an enum schema classifies as a selector, carrying its options", () => {
    expect(classifySettingSchema(z.enum(["low", "medium", "high"]))).toEqual({
      kind: "enum",
      options: ["low", "medium", "high"],
    });
  });

  it("a schema wrapped in .default()/.optional() still classifies by its inner shape", () => {
    expect(classifySettingSchema(z.boolean().default(false))).toEqual({ kind: "boolean" });
    expect(classifySettingSchema(z.number().optional())).toEqual({ kind: "number" });
  });

  it("a schema outside the three declared shapes is unsupported, not a crash", () => {
    expect(classifySettingSchema(z.string()).kind).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
// Genericity — RNF-CFG-02: a brand-new setting from a system the handler has
// never seen renders correctly with zero code changes.
// ---------------------------------------------------------------------------

describe("a fake system's brand-new setting reaches the tab untouched (RNF-CFG-02)", () => {
  const FAKE = fakeSystemWith("fake-system", [
    {
      key: "neverSeenBeforeToggle",
      scope: "world",
      schema: z.boolean(),
      default: false,
      label: "Nunca visto antes",
    },
    {
      key: "verbosityLevel",
      scope: "world",
      schema: z.enum(["quiet", "loud"]),
      default: "quiet",
      label: "Verbosidade",
      hint: "Controla o volume do log.",
    },
    {
      key: "maxRetries",
      scope: "world",
      schema: z.number(),
      default: 3,
      label: "Máximo de tentativas",
      requiresReload: true,
    },
  ]);

  it("REQ-CFG-030: renders boolean → toggle, enum → selection, number → numeric field", () => {
    const byKey = new Map(ask(FAKE).settings.map((s) => [s.key, s]));

    expect(byKey.get("fake-system:neverSeenBeforeToggle")).toEqual({
      id: null,
      key: "fake-system:neverSeenBeforeToggle",
      kind: "boolean",
      label: "Nunca visto antes",
      value: false,
    });
    expect(byKey.get("fake-system:verbosityLevel")).toEqual({
      id: null,
      key: "fake-system:verbosityLevel",
      kind: "enum",
      options: ["quiet", "loud"],
      label: "Verbosidade",
      hint: "Controla o volume do log.",
      value: "quiet",
    });
    expect(byKey.get("fake-system:maxRetries")).toEqual({
      id: null,
      key: "fake-system:maxRetries",
      kind: "number",
      label: "Máximo de tentativas",
      requiresReload: true,
      value: 3,
    });
  });

  it("RNF-CFG-02: lists exactly the declared settings — nothing hardcoded, nothing dropped", () => {
    expect(ask(FAKE).settings).toHaveLength(3);
  });

  it("REQ-CFG-071: a stored Setting document's value wins over the declared default", () => {
    const store = fakeStore([
      { _id: "setting-abc", key: "fake-system:neverSeenBeforeToggle", value: true },
    ]);
    const entry = ask(FAKE, store).settings.find(
      (s) => s.key === "fake-system:neverSeenBeforeToggle",
    );

    expect(entry).toEqual({
      id: "setting-abc",
      key: "fake-system:neverSeenBeforeToggle",
      kind: "boolean",
      label: "Nunca visto antes",
      value: true,
    });
  });

  it("REQ-CFG-082: requiresConfirmOnDisable, when the system declared it, rides along in the declaration", () => {
    const withConfirm = fakeSystemWith("fake-system", [
      {
        key: "freeArchetype",
        scope: "world",
        schema: z.boolean(),
        default: false,
        label: "Free Archetype (fake)",
        requiresConfirmOnDisable: true,
      },
    ]);

    const entry = ask(withConfirm).settings.find((s) => s.key === "fake-system:freeArchetype");
    expect(entry?.requiresConfirmOnDisable).toBe(true);
  });

  it("a setting that never declared requiresConfirmOnDisable omits the field, not `false`", () => {
    const entry = ask(FAKE).settings.find((s) => s.key === "fake-system:neverSeenBeforeToggle");
    expect(entry).not.toHaveProperty("requiresConfirmOnDisable");
  });

  it("a setting outside world scope (user/client) is excluded from the Mundo section", () => {
    const withOtherScopes = fakeSystemWith("fake-system", [
      { key: "worldOne", scope: "world", schema: z.boolean(), default: true, label: "Um" },
      { key: "userOnly", scope: "user", schema: z.boolean(), default: true, label: "Do usuário" },
      {
        key: "clientOnly",
        scope: "client",
        schema: z.boolean(),
        default: true,
        label: "Do cliente",
      },
    ]);

    const keys = ask(withOtherScopes).settings.map((s) => s.key);
    expect(keys).toEqual(["fake-system:worldOne"]);
  });

  it("a declared schema outside the three shapes is skipped, not served broken", () => {
    const withUnsupported = fakeSystemWith("fake-system", [
      { key: "freeText", scope: "world", schema: z.string(), default: "", label: "Texto livre" },
    ]);

    expect(ask(withUnsupported).settings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Degradation — same shape as system:conditions
// ---------------------------------------------------------------------------

describe("a world with no system answers with an empty list, never an error", () => {
  it("degrades open", () => {
    expect(ask(undefined)).toEqual({ systemId: null, settings: [] });
  });
});

// ---------------------------------------------------------------------------
// Who gets it — REQ-GAV-034/DEC-CFG-05: the Mundo section is "só GAMEMASTER"
// on the read too, not just the write; the trilho hiding the section from a
// player is ergonomics (REQ-CFG-005), never the boundary the server trusts.
// ---------------------------------------------------------------------------

describe("settings:declarations — GAMEMASTER-strict gate (REQ-GAV-034, DEC-CFG-05)", () => {
  const FAKE = fakeSystemWith("fake-system", [
    { key: "shared", scope: "world", schema: z.boolean(), default: true, label: "Compartilhada" },
  ]);

  it("a PLAYER is refused with PERMISSION_DENIED, never handed the settings table", () => {
    const ack = buildSettingsDeclarationsHandler(FAKE, undefined)({}, ctx(UserRole.PLAYER));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("ASSISTANT (role 3) is refused too — DEC-CFG-05 says GAMEMASTER, not the generic privileged threshold", () => {
    const ack = buildSettingsDeclarationsHandler(FAKE, undefined)({}, ctx(UserRole.ASSISTANT));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("the GAMEMASTER is admitted and receives the declarations", () => {
    expect(ask(FAKE, undefined, UserRole.GAMEMASTER).settings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The REAL pf2e system, not a stand-in — REQ-CFG-032/033, REQ-MCL-001/004.
//
// Every other describe() above proves genericity with a system this handler
// has never seen (RNF-CFG-02) — that is by design, not a gap: it is the
// proof that the handler carries zero pf2e-specific code. What it does NOT
// prove is that pf2e itself actually calls `registrar.setting(...)` for the
// two variant rules the Mundo section exists to surface. `pf2eSystem.
// registries.settings` already asserts the declarations are shaped right
// (system-registration.test.ts); this closes the last link by running them
// through the real generic handler and checking the wire keys a GM's browser
// would actually receive.
// ---------------------------------------------------------------------------

describe("the real pf2e system's variant-rule settings reach the wire (REQ-CFG-032/033)", () => {
  it("answers with pf2e:variantRules.freeArchetype and pf2e:variantRules.classLevels as boolean, confirm-gated toggles", () => {
    const byKey = new Map(ask(pf2eSystem).settings.map((s) => [s.key, s]));

    const freeArchetype = byKey.get("pf2e:variantRules.freeArchetype");
    expect(freeArchetype).toMatchObject({
      kind: "boolean",
      requiresConfirmOnDisable: true,
      value: false,
    });

    const classLevels = byKey.get("pf2e:variantRules.classLevels");
    expect(classLevels).toMatchObject({
      kind: "boolean",
      requiresConfirmOnDisable: true,
      value: false,
    });
  });

  it("REQ-CFG-071: a GM-written Setting document's value wins over pf2e's declared default", () => {
    const store = fakeStore([
      { _id: "setting-fa", key: "pf2e:variantRules.freeArchetype", value: true },
    ]);
    const entry = ask(pf2eSystem, store).settings.find(
      (s) => s.key === "pf2e:variantRules.freeArchetype",
    );
    expect(entry).toMatchObject({ id: "setting-fa", value: true });
  });
});
