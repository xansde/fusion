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
import { pf2eSf2eSystem } from "@fusion/system-pf2e-sf2e";

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

  it("a schema outside the declared shapes is unsupported, not a crash", () => {
    expect(classifySettingSchema(z.string()).kind).toBe("unsupported");
    // A list of free strings has no option set to draw — still unsupported.
    expect(classifySettingSchema(z.array(z.string())).kind).toBe("unsupported");
  });

  // HJ-09 (#434): a list drawn from a closed set (the campaign's trained
  // skills) classifies as an enum list, carrying the same options an enum does.
  it("an array of enum values classifies as an enum list, carrying its options", () => {
    expect(classifySettingSchema(z.array(z.enum(["arcana", "occultism"])).default([]))).toEqual({
      kind: "enumList",
      options: ["arcana", "occultism"],
    });
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
//
// Issue #266 narrows this from an outright refusal to a per-key allowlist:
// a non-GAMEMASTER role now gets `ok: true`, filtered down to
// `PLAYER_READABLE_SETTING_KEYS` — never PERMISSION_DENIED, and never the
// full table either.
// ---------------------------------------------------------------------------

describe("settings:declarations — GAMEMASTER-strict gate (REQ-GAV-034, DEC-CFG-05)", () => {
  const FAKE = fakeSystemWith("fake-system", [
    { key: "shared", scope: "world", schema: z.boolean(), default: true, label: "Compartilhada" },
  ]);

  it("a PLAYER is admitted (never PERMISSION_DENIED) but sees an empty list — no allowlisted key here", () => {
    const ack = buildSettingsDeclarationsHandler(FAKE, undefined)({}, ctx(UserRole.PLAYER));
    expect(ack).toMatchObject({ ok: true, result: { systemId: "fake-system", settings: [] } });
  });

  it("ASSISTANT (role 3) gets the same narrow, filtered result as PLAYER — not the generic privileged threshold", () => {
    const ack = buildSettingsDeclarationsHandler(FAKE, undefined)({}, ctx(UserRole.ASSISTANT));
    expect(ack).toMatchObject({ ok: true, result: { systemId: "fake-system", settings: [] } });
  });

  it("the GAMEMASTER is admitted and receives every declaration, unfiltered", () => {
    expect(ask(FAKE, undefined, UserRole.GAMEMASTER).settings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Issue #266 — PLAYER_READABLE_SETTING_KEYS: the narrow read exception a
// PLAYER needs so the ficha can show whether "multiclasse por nível" /
// "Arquétipo livre" are active, without opening the rest of the Mundo
// section. A key outside this allowlist stays invisible to a non-GM role,
// even when it sits right next to an allowlisted one in the same system.
// ---------------------------------------------------------------------------

describe("settings:declarations — PLAYER_READABLE_SETTING_KEYS allowlist (issue #266)", () => {
  const PF2E_LIKE = fakeSystemWith("pf2e", [
    {
      key: "variantRules.classLevels",
      scope: "world",
      schema: z.boolean(),
      default: false,
      label: "Multiclasse por nível",
    },
    {
      key: "variantRules.freeArchetype",
      scope: "world",
      schema: z.boolean(),
      default: false,
      label: "Arquétipo livre",
    },
    {
      key: "someOtherSensitiveWorldSetting",
      scope: "world",
      schema: z.boolean(),
      default: false,
      label: "Outra configuração sensível",
    },
  ]);

  it("a PLAYER reads pf2e:variantRules.classLevels — the exact regression from issue #266", () => {
    const ack = buildSettingsDeclarationsHandler(PF2E_LIKE, undefined)({}, ctx(UserRole.PLAYER));
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("unreachable");
    const byKey = new Map(ack.result.settings.map((s) => [s.key, s]));
    expect(byKey.get("pf2e:variantRules.classLevels")).toMatchObject({
      kind: "boolean",
      value: false,
    });
  });

  it("a PLAYER also reads pf2e:variantRules.freeArchetype", () => {
    const entry = ask(PF2E_LIKE, undefined, UserRole.PLAYER).settings.find(
      (s) => s.key === "pf2e:variantRules.freeArchetype",
    );
    expect(entry).toMatchObject({ kind: "boolean", value: false });
  });

  it("a PLAYER does NOT read a sibling world setting outside the allowlist — negative permission test", () => {
    const settings = ask(PF2E_LIKE, undefined, UserRole.PLAYER).settings;
    expect(settings.some((s) => s.key === "pf2e:someOtherSensitiveWorldSetting")).toBe(false);
    // Only the two allowlisted keys reach the player, nothing else leaks.
    expect(settings.map((s) => s.key).sort()).toEqual([
      "pf2e:variantRules.classLevels",
      "pf2e:variantRules.freeArchetype",
    ]);
  });

  it("the GAMEMASTER still sees all three, including the non-allowlisted one", () => {
    const settings = ask(PF2E_LIKE, undefined, UserRole.GAMEMASTER).settings;
    expect(settings).toHaveLength(3);
  });

  it("a stored GM-written value for an allowlisted key is visible to the PLAYER too (REQ-CFG-071)", () => {
    const store = fakeStore([
      { _id: "setting-cl", key: "pf2e:variantRules.classLevels", value: true },
    ]);
    const entry = ask(PF2E_LIKE, store, UserRole.PLAYER).settings.find(
      (s) => s.key === "pf2e:variantRules.classLevels",
    );
    expect(entry).toMatchObject({ id: "setting-cl", value: true });
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

  it("issue #266: a PLAYER (not just the GAMEMASTER) reads both real pf2e variant-rule settings", () => {
    const settings = ask(pf2eSystem, undefined, UserRole.PLAYER).settings;
    expect(settings.map((s) => s.key).sort()).toEqual([
      "pf2e:variantRules.classLevels",
      "pf2e:variantRules.freeArchetype",
    ]);
  });

  it("issue #266: in the combined pf2e-sf2e system (the world the issue reproduced in), a PLAYER reads the same two keys under that system's namespace", () => {
    const store = fakeStore([
      { _id: "setting-cl2", key: "pf2e-sf2e:variantRules.classLevels", value: true },
    ]);
    const settings = ask(pf2eSf2eSystem, store, UserRole.PLAYER).settings;
    const keys = settings.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "pf2e-sf2e:variantRules.classLevels",
        "pf2e-sf2e:variantRules.freeArchetype",
      ]),
    );
    // Nothing off the allowlist leaks: the variant rules plus (from the pin
    // that carries HJ-09) the campaign's trained skills, and only those.
    expect(
      keys.every((k) =>
        /^pf2e-sf2e:(variantRules\.(classLevels|freeArchetype)|campaign\.trainedSkills)$/.test(k),
      ),
    ).toBe(true);
    expect(settings.find((s) => s.key === "pf2e-sf2e:variantRules.classLevels")).toMatchObject({
      id: "setting-cl2",
      value: true,
    });
  });

  it("issue #266: a PLAYER sees the world's real classLevels value, not just the default", () => {
    const store = fakeStore([
      { _id: "setting-cl", key: "pf2e:variantRules.classLevels", value: true },
    ]);
    const entry = ask(pf2eSystem, store, UserRole.PLAYER).settings.find(
      (s) => s.key === "pf2e:variantRules.classLevels",
    );
    expect(entry).toMatchObject({ id: "setting-cl", value: true });
  });
});

// ---------------------------------------------------------------------------
// HJ-09 (#434, D4) — "perícias treinadas pela campanha": a world setting that
// is a LIST drawn from a closed set. The Mundo section must draw it, a PLAYER
// must read it (the Plano shows the origin "Campanha" and the sheet marks the
// skill as already trained), and nobody but the GM writes it (that part is
// proven over the wire in campaign-trained-skills.test.ts).
// ---------------------------------------------------------------------------

describe("settings:declarations — campaign.trainedSkills (HJ-09)", () => {
  const CAMPAIGN = fakeSystemWith("fake-system", [
    {
      key: "campaign.trainedSkills",
      scope: "world",
      schema: z.array(z.enum(["arcana", "occultism", "stealth"])),
      default: [],
      label: "Perícias treinadas pela campanha",
      hint: "Todo personagem recebe estas perícias treinadas.",
      optionLabels: { arcana: "Arcanismo", occultism: "Ocultismo", stealth: "Furtividade" },
    },
    {
      key: "someOtherSensitiveWorldSetting",
      scope: "world",
      schema: z.boolean(),
      default: false,
      label: "Outra configuração sensível",
    },
  ]);

  it("the GM gets an enum-list row carrying the options and the declared default", () => {
    const entry = ask(CAMPAIGN).settings.find((s) => s.key === "fake-system:campaign.trainedSkills");
    expect(entry).toEqual({
      id: null,
      key: "fake-system:campaign.trainedSkills",
      kind: "enumList",
      options: ["arcana", "occultism", "stealth"],
      optionLabels: { arcana: "Arcanismo", occultism: "Ocultismo", stealth: "Furtividade" },
      label: "Perícias treinadas pela campanha",
      hint: "Todo personagem recebe estas perícias treinadas.",
      value: [],
    });
  });

  it("the stored list wins over the default", () => {
    const store = fakeStore([
      { _id: "s1", key: "fake-system:campaign.trainedSkills", value: ["occultism"] },
    ]);
    const entry = ask(CAMPAIGN, store).settings.find(
      (s) => s.key === "fake-system:campaign.trainedSkills",
    );
    expect(entry).toMatchObject({ id: "s1", value: ["occultism"] });
  });

  it("a PLAYER reads the campaign skills and nothing else beside them", () => {
    const settings = ask(CAMPAIGN, undefined, UserRole.PLAYER).settings;
    expect(settings.map((s) => s.key)).toEqual(["fake-system:campaign.trainedSkills"]);
  });
});
