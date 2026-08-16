/**
 * @fusion/system-pf2e — System registration tests.
 *
 * Verifies that the pf2eSystem module:
 *   - Has the correct manifest.
 *   - Registers all expected (documentType, subtype) models.
 *   - Passes validateSystemModule contract check.
 *   - Registers conditions, stacking rules, and initiative formula.
 *
 * REQ-PF2-001..005, REQ-SYS-011.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { pf2eSystem } from "../index.js";
import { SystemRegistry, validateSystemModule } from "@fusion/system-api";
import { PF2E_CONDITIONS } from "../conditions.js";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("pf2eSystem manifest", () => {
  it("has id 'pf2e'", () => {
    expect(pf2eSystem.manifest.id).toBe("pf2e");
  });

  it("has title", () => {
    expect(pf2eSystem.manifest.title).toContain("Pathfinder");
  });

  it("declares Actor subtypes: character, npc, hazard, loot", () => {
    const actorTypes = pf2eSystem.manifest.documentTypes["Actor"];
    expect(actorTypes).toContain("character");
    expect(actorTypes).toContain("npc");
    expect(actorTypes).toContain("hazard");
    expect(actorTypes).toContain("loot");
  });

  it("declares all MVP Item subtypes", () => {
    const itemTypes = pf2eSystem.manifest.documentTypes["Item"];
    const expected = [
      "weapon",
      "armor",
      "shield",
      "equipment",
      "consumable",
      "treasure",
      "container",
      "condition",
      "effect",
      "spell",
      "spellcastingEntry",
      "feat",
      "action",
      "melee",
      "lore",
      "ancestry",
      "heritage",
      "background",
      "class",
    ];
    for (const t of expected) {
      expect(itemTypes).toContain(t);
    }
  });

  it("declares pt-BR as a language", () => {
    const langs = pf2eSystem.manifest.languages ?? [];
    const ptBr = langs.find((l) => l.lang === "pt-BR");
    expect(ptBr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

describe("pf2eSystem models", () => {
  const EXPECTED_ACTOR_SUBTYPES = ["character", "npc", "hazard", "loot"];
  const EXPECTED_ITEM_SUBTYPES = [
    "weapon",
    "armor",
    "shield",
    "equipment",
    "consumable",
    "treasure",
    "container",
    "condition",
    "effect",
    "spell",
    "spellcastingEntry",
    "feat",
    "action",
    "melee",
    "lore",
    "ancestry",
    "heritage",
    "background",
    "class",
  ];

  for (const subtype of EXPECTED_ACTOR_SUBTYPES) {
    it(`has model for Actor:${subtype}`, () => {
      expect(pf2eSystem.models.has(`Actor:${subtype}`)).toBe(true);
    });
  }

  for (const subtype of EXPECTED_ITEM_SUBTYPES) {
    it(`has model for Item:${subtype}`, () => {
      expect(pf2eSystem.models.has(`Item:${subtype}`)).toBe(true);
    });
  }

  it("each model schema is a valid Zod schema", () => {
    for (const [, model] of pf2eSystem.models) {
      expect(model.schema).toBeDefined();
      expect(typeof model.schema.safeParse).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// Contract validation
// ---------------------------------------------------------------------------

describe("validateSystemModule contract", () => {
  it("passes the system API contract test", () => {
    const report = validateSystemModule(pf2eSystem);
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SystemRegistry integration
// ---------------------------------------------------------------------------

describe("SystemRegistry with pf2e", () => {
  let registry: SystemRegistry;

  beforeEach(() => {
    registry = new SystemRegistry();
  });

  it("registers successfully", () => {
    registry.register(pf2eSystem);
    expect(registry.has("pf2e")).toBe(true);
  });

  it("retrieves by id", () => {
    registry.register(pf2eSystem);
    expect(registry.get("pf2e").manifest.id).toBe("pf2e");
  });

  it("throws on duplicate registration", () => {
    registry.register(pf2eSystem);
    expect(() => registry.register(pf2eSystem)).toThrow(/already registered/);
  });
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

describe("pf2eSystem conditions", () => {
  it("registers all PF2E_CONDITIONS", () => {
    for (const cond of PF2E_CONDITIONS) {
      expect(pf2eSystem.registries.conditions.has(cond.slug)).toBe(true);
    }
  });

  it("has 'off-guard' with circumstance AC modifier", () => {
    const offGuard = pf2eSystem.registries.conditions.get("off-guard");
    expect(offGuard).toBeDefined();
    expect(offGuard?.effects).toBeDefined();
    const acMod = offGuard?.effects?.find(
      (e) => e.type === "flatModifier" && (e as { selector?: string }).selector === "ac",
    );
    expect(acMod).toBeDefined();
  });

  it("has 'frightened' as a valued condition", () => {
    const frightened = pf2eSystem.registries.conditions.get("frightened");
    expect(frightened?.valued).toBe(true);
  });

  it("has 'dying' registered", () => {
    expect(pf2eSystem.registries.conditions.has("dying")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stacking rules
// ---------------------------------------------------------------------------

describe("pf2eSystem stackingTable", () => {
  it("is not null", () => {
    expect(pf2eSystem.registries.stackingTable).not.toBeNull();
  });

  it("includes circumstance, status, item, untyped types", () => {
    const table = pf2eSystem.registries.stackingTable ?? [];
    const types = table.map((r) => r.type);
    expect(types).toContain("circumstance");
    expect(types).toContain("status");
    expect(types).toContain("item");
    expect(types).toContain("untyped");
  });

  it("circumstance has highest-only bonus behaviour", () => {
    const table = pf2eSystem.registries.stackingTable ?? [];
    const circ = table.find((r) => r.type === "circumstance");
    expect(circ?.bonusBehaviour).toBe("highest-only");
  });
});

// ---------------------------------------------------------------------------
// Initiative formula
// ---------------------------------------------------------------------------

describe("pf2eSystem initiative formula", () => {
  it("registers 'pf2e' initiative formula", () => {
    expect(pf2eSystem.combat.initiativeFormulas.has("pf2e")).toBe(true);
  });

  it("returns Perception formula for actor with derived perception", () => {
    const fn = pf2eSystem.combat.initiativeFormulas.get("pf2e");
    expect(fn).toBeDefined();

    const actor = {
      system: {
        derived: {
          perception: { total: 8 },
        },
      },
    };
    // Cast _combatant as any to match the interface without importing full type.
    const result = fn?.({} as never, actor as Record<string, unknown>);
    expect(result).toBeDefined();
    if (result && !(result instanceof Promise)) {
      expect(result.formula).toBe("1d20 + 8");
      expect(result.tiebreaker).toBe(8);
      expect(result.statistic).toBe("Perception");
    }
  });

  it("returns 1d20 when actor is null", () => {
    const fn = pf2eSystem.combat.initiativeFormulas.get("pf2e");
    const result = fn?.({} as never, null);
    if (result && !(result instanceof Promise)) {
      expect(result.formula).toBe("1d20");
    }
  });

  it("uses alternative skill when options.skill is set", () => {
    const fn = pf2eSystem.combat.initiativeFormulas.get("pf2e");
    const actor = {
      system: {
        derived: {
          skills: { stealth: { total: 12 } },
        },
      },
    };
    const result = fn?.({} as never, actor as Record<string, unknown>, { skill: "stealth" });
    if (result && !(result instanceof Promise)) {
      expect(result.formula).toBe("1d20 + 12");
      expect(result.statistic).toBe("Stealth");
    }
  });
});

// ---------------------------------------------------------------------------
// Variant rule settings (REQ-MCL-001, DEC-MCL-09, spec 37 REQ-CFG-032/033)
//
// G103 review finding: the free-archetype/multiclass-by-class-levels variant
// rules moved out of the actor and into world-scope settings, but nothing in
// the pf2e system ever called `registrar.setting(...)` for either — the
// Configurações tab's Mundo section (WorldSection.svelte, REQ-CFG-030) is a
// pure renderer of whatever the active system declares, so with zero
// declarations the section rendered empty and the rules had no write surface
// at all. These tests prove the declaration exists, not just the client
// plumbing that would consume it.
// ---------------------------------------------------------------------------

describe("pf2eSystem variant rule settings", () => {
  it("declares 'variantRules.freeArchetype' as a world-scope boolean, default off (REQ-MCL-001, REQ-CFG-032)", () => {
    const def = pf2eSystem.registries.settings.get("variantRules.freeArchetype");
    expect(def).toBeDefined();
    expect(def!.scope).toBe("world");
    expect(def!.default).toBe(false);
    expect(def!.schema.safeParse(true).success).toBe(true);
    expect(def!.schema.safeParse("yes").success).toBe(false);
  });

  it("declares 'variantRules.classLevels' as a world-scope boolean, default off (REQ-MCL-001, REQ-CFG-032, REQ-MCL-004)", () => {
    const def = pf2eSystem.registries.settings.get("variantRules.classLevels");
    expect(def).toBeDefined();
    expect(def!.scope).toBe("world");
    expect(def!.default).toBe(false);
    expect(def!.schema.safeParse(true).success).toBe(true);
    expect(def!.schema.safeParse("yes").success).toBe(false);
  });

  it("both settings require the disable confirmation gate (REQ-CFG-082) and count affected actors", () => {
    const freeArchetype = pf2eSystem.registries.settings.get("variantRules.freeArchetype");
    const classLevels = pf2eSystem.registries.settings.get("variantRules.classLevels");
    expect(freeArchetype!.requiresConfirmOnDisable).toBe(true);
    expect(classLevels!.requiresConfirmOnDisable).toBe(true);

    const actorWithFreeArchetype = { system: { build: { freeArchetype: true } } };
    const actorWithout = { system: { build: {} } };
    expect(
      freeArchetype!.countAffectedActors?.([actorWithFreeArchetype, actorWithout, actorWithout]),
    ).toBe(1);

    const actorWithClassLevels = {
      system: { build: { variantRules: { classLevels: true } } },
    };
    expect(
      classLevels!.countAffectedActors?.([actorWithClassLevels, actorWithout, actorWithout]),
    ).toBe(1);
  });
});
