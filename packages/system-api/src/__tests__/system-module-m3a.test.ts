/**
 * Integration tests for the M3-A additions to defineSystem / SystemModule:
 *   - registrar.derive()
 *   - registrar.sheet()
 *   - registrar.condition()
 *   - registrar.action()
 *   - registrar.chatCard()
 *   - registrar.setting()
 *   - registrar.stackingRules()
 *   - SystemModule.deriveSteps / SystemModule.registries
 *
 * REQ-SYS-020 / REQ-SYS-040..047 / REQ-SYS-085.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineSystem } from "../system-module.js";

const BASE_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: { Actor: ["hero"] },
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

// ---------------------------------------------------------------------------
// derive()
// ---------------------------------------------------------------------------

describe("SystemModule.deriveSteps (via registrar.derive)", () => {
  it("registers a DeriveStep on the module", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.derive({
        id: "test.step-a",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "base",
        reads: [],
        writes: ["system.x"],
        run: () => {},
      });
    });

    expect(module.deriveSteps.all).toHaveLength(1);
    expect(module.deriveSteps.all[0].id).toBe("test.step-a");
  });

  it("sortedForPhase returns step in correct order", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });

      r.derive({
        id: "test.b",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "base",
        reads: ["system.score"],
        writes: ["system.mod"],
        run: (doc) => {
          (doc as { system: { mod: number; score: number } }).system.mod = Math.floor(
            ((doc as { system: { score: number } }).system.score - 10) / 2,
          );
        },
      });

      r.derive({
        id: "test.a",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "base",
        reads: [],
        writes: ["system.score"],
        run: (doc) => {
          (doc as { system: { score: number } }).system.score = 14;
        },
      });
    });

    const steps = module.deriveSteps.sortedForPhase("base", "Actor", "hero");
    expect(steps[0].id).toBe("test.a"); // writes score first
    expect(steps[1].id).toBe("test.b"); // reads score

    // Execute and verify correctness
    const doc = { system: { score: 0, mod: 0 } };
    const ctx = { system: module, synthetics: {} as never, rollOptions: new Set<string>() };
    for (const step of steps) step.run(doc, ctx);

    expect(doc.system.score).toBe(14);
    expect(doc.system.mod).toBe(2); // floor((14-10)/2) = 2
  });
});

// ---------------------------------------------------------------------------
// sheet()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.sheets (via registrar.sheet)", () => {
  it("registers a sheet and makes it accessible", () => {
    const FakeComponent = {};
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.sheet({
        documentType: "Actor",
        subtypes: ["hero"],
        component: FakeComponent,
        makeDefault: true,
        label: "Hero Sheet",
      });
    });

    expect(module.registries.sheets).toHaveLength(1);
    const sheet = module.registries.sheets[0];
    expect(sheet.documentType).toBe("Actor");
    expect(sheet.subtypes).toEqual(["hero"]);
    expect(sheet.component).toBe(FakeComponent);
    expect(sheet.makeDefault).toBe(true);
    expect(sheet.label).toBe("Hero Sheet");
  });

  it("can register multiple sheets for different subtypes", () => {
    const module = defineSystem(
      { ...BASE_MANIFEST, documentTypes: { Actor: ["hero", "villain"] } },
      (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.defineModel({ documentType: "Actor", subtype: "villain", schema: z.object({}) });
        r.sheet({ documentType: "Actor", subtypes: ["hero"], component: {}, label: "Hero" });
        r.sheet({ documentType: "Actor", subtypes: ["villain"], component: {}, label: "Villain" });
      },
    );

    expect(module.registries.sheets).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// condition()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.conditions (via registrar.condition)", () => {
  it("registers a condition", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.condition({
        slug: "frightened",
        label: "Frightened",
        img: "icons/frightened.svg",
        valued: true,
        effects: [
          { type: "flatModifier", selector: "attack-roll", value: -1, modifierType: "status" },
        ],
        overrides: [],
      });
    });

    const cond = module.registries.conditions.get("frightened");
    expect(cond).toBeDefined();
    expect(cond!.slug).toBe("frightened");
    expect(cond!.valued).toBe(true);
    expect(cond!.effects).toHaveLength(1);
  });

  it("throws on duplicate condition slug", () => {
    expect(() =>
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.condition({ slug: "frightened", label: "F", img: "" });
        r.condition({ slug: "frightened", label: "F2", img: "" });
      }),
    ).toThrow(/duplicate condition slug "frightened"/);
  });
});

// ---------------------------------------------------------------------------
// action()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.actions (via registrar.action)", () => {
  it("registers a declarative action", () => {
    const runFn = vi.fn();
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.action({
        slug: "trip",
        label: "Trip",
        rollOptions: ["action:trip", "trait:attack"],
        run: runFn,
      });
    });

    const action = module.registries.actions.get("trip");
    expect(action).toBeDefined();
    expect(action!.slug).toBe("trip");
    expect(action!.rollOptions).toEqual(["action:trip", "trait:attack"]);
  });

  it("throws on duplicate action slug", () => {
    expect(() =>
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.action({ slug: "trip", label: "Trip", run: vi.fn() });
        r.action({ slug: "trip", label: "Trip2", run: vi.fn() });
      }),
    ).toThrow(/duplicate action slug "trip"/);
  });
});

// ---------------------------------------------------------------------------
// chatCard()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.chatCards (via registrar.chatCard)", () => {
  it("registers a chat card renderer", () => {
    const renderFn = vi.fn(() => "<p>Card</p>");
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.chatCard({ cardType: "check-result", render: renderFn });
    });

    const card = module.registries.chatCards.get("check-result");
    expect(card).toBeDefined();
    expect(card!.cardType).toBe("check-result");
    // Verify render is callable
    card!.render({ total: 15 });
    expect(renderFn).toHaveBeenCalledWith({ total: 15 });
  });

  it("throws on duplicate cardType", () => {
    expect(() =>
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.chatCard({ cardType: "check-result", render: vi.fn() });
        r.chatCard({ cardType: "check-result", render: vi.fn() });
      }),
    ).toThrow(/duplicate chatCard type "check-result"/);
  });
});

// ---------------------------------------------------------------------------
// setting()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.settings (via registrar.setting)", () => {
  it("registers a world setting", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.setting({
        key: "automation",
        scope: "world",
        schema: z.boolean(),
        default: true,
        label: "Enable Automation",
        hint: "Toggle rule automation",
        requiresReload: false,
      });
    });

    const setting = module.registries.settings.get("automation");
    expect(setting).toBeDefined();
    expect(setting!.key).toBe("automation");
    expect(setting!.scope).toBe("world");
    expect(setting!.default).toBe(true);
    expect(setting!.label).toBe("Enable Automation");
  });

  it("setting schema validates values correctly", () => {
    const module = defineSystem({ ...BASE_MANUSCRIPT }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.setting({
        key: "maxLevel",
        scope: "world",
        schema: z.number().int().min(1).max(20),
        default: 1,
        label: "Max Level",
      });
    });

    const setting = module.registries.settings.get("maxLevel");
    expect(setting!.schema.safeParse(10).success).toBe(true);
    expect(setting!.schema.safeParse(0).success).toBe(false);
    expect(setting!.schema.safeParse(21).success).toBe(false);
  });

  it("throws on duplicate setting key", () => {
    expect(() =>
      defineSystem({ ...BASE_MANUSCRIPT }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.setting({ key: "foo", scope: "world", schema: z.boolean(), default: true, label: "Foo" });
        r.setting({
          key: "foo",
          scope: "world",
          schema: z.boolean(),
          default: false,
          label: "Foo2",
        });
      }),
    ).toThrow(/duplicate setting key "foo"/);
  });
});

// ---------------------------------------------------------------------------
// stackingRules()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.stackingTable (via registrar.stackingRules)", () => {
  it("is null when no stacking table is declared", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
    });
    expect(module.registries.stackingTable).toBeNull();
  });

  it("stores the declared stacking table", () => {
    const table = [
      {
        type: "circumstance",
        bonusBehaviour: "highest-only" as const,
        penaltyBehaviour: "lowest-only" as const,
      },
    ];
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.stackingRules(table);
    });
    expect(module.registries.stackingTable).toBe(table);
  });
});

// ---------------------------------------------------------------------------
// Full integration: a realistic system registration
// ---------------------------------------------------------------------------

describe("defineSystem — full M3-A integration", () => {
  it("can register all M3-A features in a single defineSystem call", () => {
    const module = defineSystem(
      {
        id: "engine-2e-test",
        title: "Engine 2e Test System",
        version: "0.1.0",
        engineCompat: ">=0.1.0 <1.0.0",
        authors: [{ name: "Fusion" }],
        documentTypes: { Actor: ["character"], Item: ["weapon"] },
        languages: [{ lang: "pt-BR", name: "Português (Brasil)", path: "lang/pt-BR.json" }],
      },
      (r) => {
        r.defineModel({
          documentType: "Actor",
          subtype: "character",
          schema: z.object({ level: z.number() }),
        });
        r.defineModel({
          documentType: "Item",
          subtype: "weapon",
          schema: z.object({ damage: z.string() }),
        });

        r.derive({
          id: "engine-2e-test.str-mod",
          documentType: "Actor",
          subtypes: ["character"],
          phase: "base",
          reads: ["system.abilities.str.score"],
          writes: ["system.abilities.str.mod"],
          run: () => {},
        });

        r.sheet({
          documentType: "Actor",
          subtypes: ["character"],
          component: {},
          label: "Character Sheet",
          makeDefault: true,
        });

        r.condition({
          slug: "off-guard",
          label: "Off-Guard",
          img: "",
          effects: [
            { type: "flatModifier", selector: "ac", value: -2, modifierType: "circumstance" },
          ],
        });

        r.action({ slug: "demoralize", label: "Demoralize", run: vi.fn() });

        r.chatCard({ cardType: "skill-check", render: () => "<p>Skill Check</p>" });

        r.setting({
          key: "variant-encumbrance",
          scope: "world",
          schema: z.boolean(),
          default: false,
          label: "Variant: Encumbrance",
        });

        r.stackingRules([
          { type: "circumstance", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
          { type: "status", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
          { type: "untyped", bonusBehaviour: "additive", penaltyBehaviour: "additive" },
        ]);
      },
    );

    expect(module.manifest.id).toBe("engine-2e-test");
    expect(module.models.size).toBe(2);
    expect(module.deriveSteps.all).toHaveLength(1);
    expect(module.registries.sheets).toHaveLength(1);
    expect(module.registries.conditions.size).toBe(1);
    expect(module.registries.actions.size).toBe(1);
    expect(module.registries.chatCards.size).toBe(1);
    expect(module.registries.settings.size).toBe(1);
    expect(module.registries.stackingTable).toHaveLength(3);
  });
});

// Alias to avoid duplicate const name issues
const BASE_MANUSCRIPT = BASE_MANIFEST;
