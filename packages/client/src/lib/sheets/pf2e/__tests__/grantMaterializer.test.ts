/**
 * grantMaterializer.test.ts — unit tests for the pure fixed-`GrantItem`
 * materializer (B2 r14). 100% headless: the async resolvers are mocked, so no
 * socket/compendium is touched. Every generated create op is validated against
 * the real wire Zod schema (DocCreatePayloadSchema).
 *
 * Acceptance cases (from .fusion-build/r14-plan.md Fase 2, B2):
 *   - Alchemist Dedication → Alchemical Crafting (feat) + Quick Alchemy (action)
 *   - idempotency: re-running with the grants present yields no ops
 *   - nested grants resolve up to maxDepth without cycling
 *   - Starlit Span (empty rules) → no-op
 *   - granted spell placement: focus trait → focus pool; else tradition entry
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseGrantItems,
  parseGrantUuid,
  parseMechanicsGrants,
  parseSystemItemsGrants,
  mapVendorToFusionPack,
  materializeGrants,
  pickSpellEntryId,
  granterIdentity,
  buildGrantCreateOp,
  type MaterializeContext,
  type GrantIndexEntry,
  type GrantFailure,
} from "../grantMaterializer.js";
import { DocCreatePayloadSchema } from "@fusion/shared";
import type { DocOpPayload, DocCreateEmbeddedPayload } from "../characterSheetVM.js";

/** Narrow a materializeGrants result to just its `doc:create` ops (for `.data`/`.parent` assertions). */
function createOps(ops: DocOpPayload[]): DocCreateEmbeddedPayload[] {
  return ops.filter((o): o is DocCreateEmbeddedPayload => o.type === "doc:create");
}

// ---------------------------------------------------------------------------
// Fixtures — the exact shapes from systems/pf2e/packs/*-core/documents.json.
// ---------------------------------------------------------------------------

/** Alchemist Dedication's real system.rules (2 upgrades + 2 GrantItem). */
function alchemistDedicationRules(): unknown[] {
  return [
    {
      kind: "set-property",
      selector: "system.skills.crafting.rank",
      value: 1,
      mode: "upgrade",
      raw: {
        key: "ActiveEffectLike",
        mode: "upgrade",
        path: "system.skills.crafting.rank",
        value: 1,
      },
    },
    {
      kind: "set-property",
      selector: "system.proficiencies.attacks.weapon-base-alchemical-bomb.rank",
      value: 1,
      mode: "upgrade",
      raw: { key: "ActiveEffectLike" },
    },
    {
      kind: "grant-item",
      uuid: "Compendium.pf2e.feats-srd.Item.Alchemical Crafting",
      inMemoryOnly: false,
      raw: { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Alchemical Crafting" },
    },
    {
      kind: "grant-item",
      uuid: "Compendium.pf2e.actionspf2e.Item.Quick Alchemy",
      inMemoryOnly: false,
      raw: {
        allowDuplicate: false,
        key: "GrantItem",
        uuid: "Compendium.pf2e.actionspf2e.Item.Quick Alchemy",
      },
    },
  ];
}

function alchemistDedicationDoc(): Record<string, unknown> {
  return {
    _id: "zbqmJqI5T5Q7fgMS",
    name: "Alchemist Dedication",
    type: "feat",
    flags: { fusion: { sourceId: "CJMkxlxHiHZQYDCz" } },
    system: { rules: alchemistDedicationRules() },
  };
}

function alchemicalCraftingDoc(): Record<string, unknown> {
  return {
    _id: "841vrgW8uY2CFhgt",
    name: "Alchemical Crafting",
    type: "feat",
    flags: { fusion: { sourceId: "is3Oz9wt11lNq62K" } },
    system: { rules: [], traits: { value: ["general", "skill"] } },
  };
}

function quickAlchemyDoc(): Record<string, unknown> {
  return {
    _id: "2z2zNhvnsFEHsAKY",
    name: "Quick Alchemy",
    type: "action",
    flags: { fusion: { sourceId: "yzNJgwzV9XqEhKc6" } },
    system: { rules: [] },
  };
}

/** A resolver pair backed by an in-memory pack map. */
function makeResolvers(byPack: Record<string, Record<string, unknown>[]>): {
  resolveIndex: MaterializeContext["resolveIndex"];
  resolveDoc: MaterializeContext["resolveDoc"];
} {
  const uuidToDoc = new Map<string, Record<string, unknown>>();
  const indexByPack = new Map<string, GrantIndexEntry[]>();
  for (const [pack, docs] of Object.entries(byPack)) {
    const entries: GrantIndexEntry[] = docs.map((d) => {
      const uuid = `Compendium.pf2e.${pack}.Item.${String(d["_id"])}`;
      uuidToDoc.set(uuid, d);
      return {
        name: String(d["name"]),
        uuid,
        ...(typeof d["type"] === "string" ? { type: d["type"] as string } : {}),
      };
    });
    indexByPack.set(pack, entries);
  }
  return {
    resolveIndex: async (packSlug) => indexByPack.get(packSlug) ?? [],
    resolveDoc: async (uuid) => uuidToDoc.get(uuid) ?? null,
  };
}

function ctxFor(
  byPack: Record<string, Record<string, unknown>[]>,
  existingItems: Array<Record<string, unknown>> = [],
  spellEntries: MaterializeContext["spellEntries"] = [],
): MaterializeContext {
  const { resolveIndex, resolveDoc } = makeResolvers(byPack);
  return { actorId: "actor-1", existingItems, spellEntries, resolveIndex, resolveDoc };
}

// ---------------------------------------------------------------------------
// parseGrantUuid / parseGrantItems / mapVendorToFusionPack
// ---------------------------------------------------------------------------

describe("parseGrantUuid", () => {
  it("splits vendor + name from a compendium Item uuid", () => {
    expect(parseGrantUuid("Compendium.pf2e.feats-srd.Item.Alchemical Crafting")).toEqual({
      vendor: "feats-srd",
      name: "Alchemical Crafting",
      uuid: "Compendium.pf2e.feats-srd.Item.Alchemical Crafting",
    });
  });

  it("keeps multi-word names intact", () => {
    expect(parseGrantUuid("Compendium.pf2e.actionspf2e.Item.Quick Alchemy")?.name).toBe(
      "Quick Alchemy",
    );
  });

  it("rejects an in-memory ChoiceSet placeholder uuid", () => {
    expect(
      parseGrantUuid("Compendium.pf2e.feats-srd.Item.{item|flags.system.rulesSelections.feat}"),
    ).toBeNull();
  });

  it("rejects a non-compendium / malformed uuid", () => {
    expect(parseGrantUuid("Actor.abc.Item.def")).toBeNull();
    expect(parseGrantUuid("garbage")).toBeNull();
  });
});

describe("parseGrantItems", () => {
  it("extracts only the GrantItem rules, ignoring upgrades", () => {
    const grants = parseGrantItems(alchemistDedicationRules());
    expect(grants.map((g) => g.name)).toEqual(["Alchemical Crafting", "Quick Alchemy"]);
    expect(grants.map((g) => g.vendor)).toEqual(["feats-srd", "actionspf2e"]);
  });

  it("skips inMemoryOnly grants (ChoiceSet placeholders)", () => {
    const grants = parseGrantItems([
      { kind: "grant-item", uuid: "Compendium.pf2e.feats-srd.Item.{item|x}", inMemoryOnly: true },
    ]);
    expect(grants).toEqual([]);
  });

  it("recognizes the unconverted raw.key === 'GrantItem' shape", () => {
    const grants = parseGrantItems([
      { raw: { key: "GrantItem", uuid: "Compendium.pf2e.spells-srd.Item.Shield" } },
    ]);
    expect(grants).toEqual([
      { vendor: "spells-srd", name: "Shield", uuid: "Compendium.pf2e.spells-srd.Item.Shield" },
    ]);
  });

  it("returns [] for non-array / empty rules", () => {
    expect(parseGrantItems(undefined)).toEqual([]);
    expect(parseGrantItems([])).toEqual([]);
  });
});

describe("mapVendorToFusionPack", () => {
  it("maps the known vendors", () => {
    expect(mapVendorToFusionPack("feats-srd")).toEqual(["feats-core"]);
    expect(mapVendorToFusionPack("actionspf2e")).toEqual(["actions-core"]);
    expect(mapVendorToFusionPack("spells-srd")).toEqual(["spells-core"]);
    expect(mapVendorToFusionPack("classfeatures")).toEqual(["class-features-core"]);
  });

  it("maps ancestryfeatures to ancestry-features-core (r20-X5), not class-features-core", () => {
    // Before r20-X5 this vendor pointed at class-features-core (which never
    // holds ancestry features) so grants silently no-op'd. Both the vendor
    // compendium id (ancestryfeatures) and the pack folder name
    // (ancestry-features) resolve to the new clean-room pack.
    expect(mapVendorToFusionPack("ancestryfeatures")).toEqual(["ancestry-features-core"]);
    expect(mapVendorToFusionPack("ancestry-features")).toEqual(["ancestry-features-core"]);
  });

  it("returns an empty list for an unknown vendor", () => {
    expect(mapVendorToFusionPack("some-unknown-pack")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // issue #47
  // -------------------------------------------------------------------------

  it("maps conditionitems to the conditions pack", () => {
    // 18 grants across the packs point at `conditionitems` (Off-Guard,
    // Unconscious, Clumsy, Immobilized, Blinded, Prone, Quickened) and the
    // vendor had no switch entry at all, so every one failed as unknown-vendor
    // even though `conditions` holds all seven.
    expect(mapVendorToFusionPack("conditionitems")).toEqual(["conditions"]);
    expect(mapVendorToFusionPack("conditions")).toEqual(["conditions"]);
  });

  it("searches BOTH weapons-core and equipment-core for an equipment grant", () => {
    // equipment-srd pointed only at weapons-core ("best-effort"), so the
    // 18-document equipment-core pack was never consulted and any non-weapon
    // equipment grant was unsolvable by construction.
    expect(mapVendorToFusionPack("equipment-srd")).toEqual(["weapons-core", "equipment-core"]);
    expect(mapVendorToFusionPack("equipment")).toEqual(["weapons-core", "equipment-core"]);
  });

  it("falls through to the second candidate pack when the first has no match", async () => {
    const equipmentOnlyDoc = {
      _id: "eq-1",
      name: "Everlight Crystal",
      type: "equipment",
      flags: { fusion: { sourceId: "EVERLIGHT" } },
      system: { rules: [] },
    };
    const granter = {
      _id: "granter-eq",
      name: "Equipment Granter",
      type: "feat",
      flags: { fusion: { sourceId: "SRC-EQ" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.equipment-srd.Item.Everlight Crystal",
            inMemoryOnly: false,
          },
        ],
      },
    };
    // weapons-core is searched first and is empty; equipment-core has it.
    const mctx = ctxFor({ "weapons-core": [], "equipment-core": [equipmentOnlyDoc] });
    const ops = createOps(await materializeGrants(granter, "SRC-EQ", undefined, mctx));

    expect(ops).toHaveLength(1);
    expect((ops[0]?.data as Record<string, unknown>)["name"]).toBe("Everlight Crystal");
  });

  it("reports target-not-found once, listing every pack searched", async () => {
    const granter = {
      _id: "granter-eq2",
      name: "Equipment Granter",
      type: "feat",
      flags: { fusion: { sourceId: "SRC-EQ2" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.equipment-srd.Item.Clan Dagger",
            inMemoryOnly: false,
          },
        ],
      },
    };
    const failures: GrantFailure[] = [];
    const base = ctxFor({ "weapons-core": [], "equipment-core": [] });
    await materializeGrants(granter, "SRC-EQ2", undefined, {
      ...base,
      onGrantFailure: (f) => failures.push(f),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe("target-not-found");
    expect(failures[0]?.packSlug).toBe("weapons-core, equipment-core");
  });
});

// ---------------------------------------------------------------------------
// materializeGrants — the headline acceptance case
// ---------------------------------------------------------------------------

describe("materializeGrants — Alchemist Dedication", () => {
  it("materializes Alchemical Crafting (feat) + Quick Alchemy (action), tagged by the granter", async () => {
    const mctx = ctxFor({
      "feats-core": [alchemicalCraftingDoc()],
      "actions-core": [quickAlchemyDoc()],
    });
    const ops = createOps(
      await materializeGrants(
        alchemistDedicationDoc(),
        "CJMkxlxHiHZQYDCz",
        "archetypeFeat-2",
        mctx,
      ),
    );
    expect(ops).toHaveLength(2);

    const names = ops.map((o) => o.data["name"]);
    expect(names.sort()).toEqual(["Alchemical Crafting", "Quick Alchemy"]);

    for (const op of ops) {
      expect(op.data["_id"]).toBeUndefined();
      const fusion = (op.data["flags"] as Record<string, unknown>)["fusion"] as Record<
        string,
        unknown
      >;
      expect(fusion["grantedBy"]).toBe("CJMkxlxHiHZQYDCz");
      expect(fusion["grantedSlot"]).toBe("archetypeFeat-2");
      // sourceId preserved from the granted pack doc.
      expect(typeof fusion["sourceId"]).toBe("string");
      const wire = { documentType: op.documentType, data: [op.data], parent: op.parent };
      expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
    }
  });

  it("is idempotent — no ops when both grants already exist on the actor", async () => {
    const existing = [
      {
        _id: "e1",
        type: "feat",
        name: "Alchemical Crafting",
        flags: { fusion: { grantedBy: "CJMkxlxHiHZQYDCz", sourceId: "is3Oz9wt11lNq62K" } },
      },
      {
        _id: "e2",
        type: "action",
        name: "Quick Alchemy",
        flags: { fusion: { grantedBy: "CJMkxlxHiHZQYDCz", sourceId: "yzNJgwzV9XqEhKc6" } },
      },
    ];
    const mctx = ctxFor(
      { "feats-core": [alchemicalCraftingDoc()], "actions-core": [quickAlchemyDoc()] },
      existing,
    );
    const ops = await materializeGrants(
      alchemistDedicationDoc(),
      "CJMkxlxHiHZQYDCz",
      "archetypeFeat-2",
      mctx,
    );
    expect(ops).toEqual([]);
  });

  it("materializes only the MISSING grant when one is already present (partial heal)", async () => {
    const existing = [
      {
        _id: "e1",
        type: "feat",
        name: "Alchemical Crafting",
        flags: { fusion: { grantedBy: "CJMkxlxHiHZQYDCz", sourceId: "is3Oz9wt11lNq62K" } },
      },
    ];
    const mctx = ctxFor(
      { "feats-core": [alchemicalCraftingDoc()], "actions-core": [quickAlchemyDoc()] },
      existing,
    );
    const ops = createOps(
      await materializeGrants(
        alchemistDedicationDoc(),
        "CJMkxlxHiHZQYDCz",
        "archetypeFeat-2",
        mctx,
      ),
    );
    expect(ops.map((o) => o.data["name"])).toEqual(["Quick Alchemy"]);
  });

  it("skips a grant whose vendor has no Fusion pack mapping", async () => {
    const doc = {
      name: "Weird Feat",
      type: "feat",
      flags: { fusion: { sourceId: "WEIRD" } },
      system: { rules: [{ kind: "grant-item", uuid: "Compendium.pf2e.unknownpack.Item.Nope" }] },
    };
    const ops = await materializeGrants(doc, "WEIRD", undefined, ctxFor({}));
    expect(ops).toEqual([]);
  });

  it("skips a grant whose named doc has no clean-room equivalent in the Fusion pack", async () => {
    const doc = {
      name: "Feat With Missing Grant",
      type: "feat",
      flags: { fusion: { sourceId: "MISS" } },
      system: {
        rules: [{ kind: "grant-item", uuid: "Compendium.pf2e.feats-srd.Item.Nonexistent" }],
      },
    };
    const ops = await materializeGrants(
      doc,
      "MISS",
      undefined,
      ctxFor({ "feats-core": [alchemicalCraftingDoc()] }),
    );
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Starlit Span — empty rules → no-op (audit note: does NOT grant Shooting Star)
// ---------------------------------------------------------------------------

describe("materializeGrants — Starlit Span (no grants)", () => {
  it("returns no ops for a granter with empty system.rules", async () => {
    const starlitSpan = {
      _id: "starlit",
      name: "Starlit Span",
      type: "classFeature",
      flags: { fusion: { sourceId: "Pew7duAozEeAemif" } },
      system: { rules: [] },
    };
    const ops = await materializeGrants(
      starlitSpan,
      "Pew7duAozEeAemif",
      "hybridStudy-1",
      ctxFor({ "spells-core": [] }),
    );
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Nested grants (depth-bounded)
// ---------------------------------------------------------------------------

describe("materializeGrants — nested grants", () => {
  it("resolves a grant chain A → B → C up to depth", async () => {
    const c = {
      _id: "C",
      name: "Feat C",
      type: "feat",
      flags: { fusion: { sourceId: "cid" } },
      system: { rules: [] },
    };
    const b = {
      _id: "B",
      name: "Feat B",
      type: "feat",
      flags: { fusion: { sourceId: "bid" } },
      system: { rules: [{ kind: "grant-item", uuid: "Compendium.pf2e.feats-srd.Item.Feat C" }] },
    };
    const a = {
      _id: "A",
      name: "Feat A",
      type: "feat",
      flags: { fusion: { sourceId: "aid" } },
      system: { rules: [{ kind: "grant-item", uuid: "Compendium.pf2e.feats-srd.Item.Feat B" }] },
    };
    const ops = createOps(
      await materializeGrants(a, "aid", "classFeat-2", ctxFor({ "feats-core": [b, c] })),
    );
    // Both B and C, all tagged by the ROOT granter (aid), so removeChoice on A cascades to both.
    expect(ops.map((o) => o.data["name"]).sort()).toEqual(["Feat B", "Feat C"]);
    for (const op of ops) {
      expect(
        ((op.data["flags"] as Record<string, unknown>)["fusion"] as Record<string, unknown>)[
          "grantedBy"
        ],
      ).toBe("aid");
    }
  });

  it("does not exceed maxDepth (breaks a self-referential cycle)", async () => {
    const selfRef = {
      _id: "S",
      name: "Loop Feat",
      type: "feat",
      flags: { fusion: { sourceId: "sid" } },
      system: { rules: [{ kind: "grant-item", uuid: "Compendium.pf2e.feats-srd.Item.Loop Feat" }] },
    };
    // Grants itself → without the `scheduled` guard + depth cap this would loop.
    const ops = createOps(
      await materializeGrants(selfRef, "sid", undefined, ctxFor({ "feats-core": [selfRef] }), 3),
    );
    // Materialized once (the first level's grant); the guard prevents re-adding.
    expect(ops).toHaveLength(1);
    expect(ops[0]!.data["name"]).toBe("Loop Feat");
  });
});

// ---------------------------------------------------------------------------
// pickSpellEntryId — granted spell placement
// ---------------------------------------------------------------------------

describe("pickSpellEntryId", () => {
  const focus = { id: "focus-entry", isFocusPool: true, tradition: "arcane" };
  const arcane = { id: "arcane-entry", isFocusPool: false, tradition: "arcane" };
  const divine = { id: "divine-entry", isFocusPool: false, tradition: "divine" };

  it("routes a focus-trait spell to the focus pool", () => {
    const spell = { system: { traits: { value: ["focus", "magus"] } } };
    expect(pickSpellEntryId(spell, [arcane, focus])).toBe("focus-entry");
  });

  it("routes a non-focus spell to the tradition-matching entry", () => {
    const spell = { system: { traits: { value: [] }, traditions: ["divine"] } };
    expect(pickSpellEntryId(spell, [arcane, divine])).toBe("divine-entry");
  });

  it("falls back to the first non-focus entry when no tradition matches", () => {
    const spell = { system: { traits: { value: [] }, traditions: ["primal"] } };
    expect(pickSpellEntryId(spell, [arcane, divine])).toBe("arcane-entry");
  });

  it("returns undefined when there is no suitable entry", () => {
    const spell = { system: { traits: { value: ["focus"] } } };
    expect(pickSpellEntryId(spell, [])).toBeUndefined();
  });
});

describe("buildGrantCreateOp — spell placement", () => {
  it("sets location to the focus entry for a focus spell", () => {
    const spell = {
      _id: "sp",
      name: "Shooting Star",
      type: "spell",
      system: { traits: { value: ["focus", "magus"] } },
    };
    const mctx = ctxFor({}, [], [{ id: "focus-entry", isFocusPool: true, tradition: "arcane" }]);
    const op = buildGrantCreateOp(spell, { grantedBy: "g", sourceId: "s" }, mctx);
    expect(op.data["location"]).toBe("focus-entry");
    expect(op.data["_id"]).toBeUndefined();
  });
});

describe("granterIdentity", () => {
  it("reads sourceId + build slot off an embedded granter item", () => {
    const item = {
      _id: "x",
      flags: { fusion: { sourceId: "sid", build: { level: 2, slot: "archetypeFeat-2" } } },
    };
    expect(granterIdentity(item)).toEqual({ sourceId: "sid", slot: "archetypeFeat-2" });
  });

  it("tolerates a granter without a build slot", () => {
    const item = { _id: "x", flags: { fusion: { sourceId: "sid" } } };
    expect(granterIdentity(item)).toEqual({ sourceId: "sid" });
  });
});

// ---------------------------------------------------------------------------
// r15 A2 — fixed-item grants from the mechanics overlay (conflux spell)
// ---------------------------------------------------------------------------

/** Shooting Star's clean-room spell doc (focus trait → focus pool). */
function shootingStarDoc(): Record<string, unknown> {
  return {
    _id: "nVfP43Xbs6I1PO8v",
    name: "Shooting Star",
    type: "spell",
    flags: { fusion: { sourceId: "SHOOT_SID" } },
    system: { rules: [], traits: { value: ["focus", "magus"] } },
  };
}

/** Starlit Span with EMPTY system.rules but a conflux fixed-item grant in doc.mechanics (as served). */
function starlitSpanWithMechanics(): Record<string, unknown> {
  return {
    _id: "RD63JAZ4zd2UvGQ4",
    name: "Starlit Span",
    type: "classFeature",
    flags: { fusion: { sourceId: "Pew7duAozEeAemif" } },
    system: { rules: [] },
    mechanics: {
      grants: [
        {
          kind: "fixed-item",
          vendor: "spells-srd",
          name: "Shooting Star",
          uuid: "Compendium.pf2e.spells-srd.Item.Shooting Star",
          source: "curated",
          confidence: 1.0,
        },
      ],
      unlocks: [],
    },
  };
}

describe("parseMechanicsGrants", () => {
  it("extracts fixed-item grants, ignoring feat-choice grants", () => {
    const mechanics = {
      grants: [
        { kind: "feat-choice", category: "class", filters: {} },
        {
          kind: "fixed-item",
          vendor: "spells-srd",
          name: "Shooting Star",
          uuid: "Compendium.pf2e.spells-srd.Item.Shooting Star",
        },
      ],
    };
    expect(parseMechanicsGrants(mechanics)).toEqual([
      {
        vendor: "spells-srd",
        name: "Shooting Star",
        uuid: "Compendium.pf2e.spells-srd.Item.Shooting Star",
      },
    ]);
  });

  it("synthesizes a uuid when the grant omits one", () => {
    const grants = parseMechanicsGrants({
      grants: [{ kind: "fixed-item", vendor: "spells-srd", name: "Spinning Staff" }],
    });
    expect(grants[0]!.uuid).toBe("Compendium.pf2e.spells-srd.Item.Spinning Staff");
  });

  it("returns [] for absent / malformed mechanics", () => {
    expect(parseMechanicsGrants(undefined)).toEqual([]);
    expect(parseMechanicsGrants({})).toEqual([]);
    expect(parseMechanicsGrants({ grants: "nope" })).toEqual([]);
  });
});

describe("parseSystemItemsGrants (r20-X4 — ABC system.items map)", () => {
  it("extracts every uuid-bearing entry from the system.items map", () => {
    const system = {
      items: {
        wr9b9: {
          img: "x.webp",
          level: 1,
          name: "Fascinating Performance",
          uuid: "Compendium.pf2e.feats-srd.Item.Fascinating Performance",
        },
        jkllM: {
          img: "y.webp",
          level: 1,
          name: "Sharp Teeth",
          uuid: "Compendium.pf2e.ancestryfeatures.Item.Sharp Teeth",
        },
      },
    };
    expect(parseSystemItemsGrants(system)).toEqual([
      {
        vendor: "feats-srd",
        name: "Fascinating Performance",
        uuid: "Compendium.pf2e.feats-srd.Item.Fascinating Performance",
      },
      {
        vendor: "ancestryfeatures",
        name: "Sharp Teeth",
        uuid: "Compendium.pf2e.ancestryfeatures.Item.Sharp Teeth",
      },
    ]);
  });

  it("returns [] for an empty / absent / malformed items map", () => {
    expect(parseSystemItemsGrants({ items: {} })).toEqual([]);
    expect(parseSystemItemsGrants({})).toEqual([]);
    expect(parseSystemItemsGrants(undefined)).toEqual([]);
    expect(parseSystemItemsGrants({ items: "nope" })).toEqual([]);
    expect(parseSystemItemsGrants({ items: { bad: { name: "no uuid" } } })).toEqual([]);
  });
});

describe("materializeGrants — ABC system.items map (r20-X4)", () => {
  function ratfolkDoc(): Record<string, unknown> {
    return {
      _id: "anc-ratfolk",
      name: "Ratfolk",
      type: "ancestry",
      flags: { fusion: { sourceId: "P6PcVnCkh4XMdefw" } },
      system: {
        size: "sm",
        vision: "low-light-vision",
        rules: [],
        items: {
          jkllM: {
            level: 1,
            name: "Sharp Teeth",
            uuid: "Compendium.pf2e.ancestryfeatures.Item.Sharp Teeth",
          },
        },
      },
    };
  }
  function fireworksPerformerDoc(): Record<string, unknown> {
    return {
      _id: "bg-fireworks",
      name: "Fireworks Performer",
      type: "background",
      flags: { fusion: { sourceId: "2lk5NOcu1aUglUdK" } },
      system: {
        rules: [],
        items: {
          wr9b9: {
            level: 1,
            name: "Fascinating Performance",
            uuid: "Compendium.pf2e.feats-srd.Item.Fascinating Performance",
          },
        },
      },
    };
  }
  function fascinatingPerformanceDoc(): Record<string, unknown> {
    return {
      _id: "feat-fasc",
      name: "Fascinating Performance",
      type: "feat",
      flags: { fusion: { sourceId: "7LB00jkh6JaJr3vS" } },
      system: { rules: [], traits: { value: ["skill"] } },
    };
  }

  it("materializes a resolvable background free feat, tagged by the background", async () => {
    const mctx = ctxFor({ "feats-core": [fascinatingPerformanceDoc()] });
    const ops = await materializeGrants(
      fireworksPerformerDoc(),
      "2lk5NOcu1aUglUdK",
      undefined,
      mctx,
    );
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    if (op.type !== "doc:create") throw new Error("expected create");
    expect(op.data["name"]).toBe("Fascinating Performance");
    const fusion = (op.data["flags"] as Record<string, unknown>)["fusion"] as Record<
      string,
      unknown
    >;
    expect(fusion["grantedBy"]).toBe("2lk5NOcu1aUglUdK");
    expect(fusion["grantedSlot"]).toBeUndefined();
  });

  function sharpTeethDoc(): Record<string, unknown> {
    return {
      _id: "af-sharp-teeth",
      name: "Sharp Teeth",
      type: "feat",
      flags: { fusion: { sourceId: "SharpTeethSrc001" } },
      system: { category: "ancestryfeature", rules: [], traits: { value: ["ratfolk"] } },
    };
  }

  it("materializes an ancestry feature from ancestry-features-core, tagged by the ancestry (r20-X5)", async () => {
    // Ratfolk → Sharp Teeth now resolves in ancestry-features-core (the vendor
    // ancestryfeatures uuid maps there) → a real grant, not just an informative
    // chip. This is the core r20-X5 fix.
    const mctx = ctxFor({ "ancestry-features-core": [sharpTeethDoc()] });
    const ops = await materializeGrants(ratfolkDoc(), "P6PcVnCkh4XMdefw", undefined, mctx);
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    if (op.type !== "doc:create") throw new Error("expected create");
    expect(op.data["name"]).toBe("Sharp Teeth");
    const fusion = (op.data["flags"] as Record<string, unknown>)["fusion"] as Record<
      string,
      unknown
    >;
    expect(fusion["grantedBy"]).toBe("P6PcVnCkh4XMdefw");
  });

  it("skips gracefully when ancestry-features-core lacks the referenced feature (no throw)", async () => {
    const mctx = ctxFor({ "ancestry-features-core": [] });
    const ops = await materializeGrants(ratfolkDoc(), "P6PcVnCkh4XMdefw", undefined, mctx);
    expect(ops).toEqual([]);
  });

  it("is idempotent — a re-run with the feat already granted produces no op", async () => {
    const existing = [
      {
        _id: "e1",
        name: "Fascinating Performance",
        type: "feat",
        flags: { fusion: { sourceId: "7LB00jkh6JaJr3vS", grantedBy: "2lk5NOcu1aUglUdK" } },
      },
    ];
    const mctx = ctxFor({ "feats-core": [fascinatingPerformanceDoc()] }, existing);
    const ops = await materializeGrants(
      fireworksPerformerDoc(),
      "2lk5NOcu1aUglUdK",
      undefined,
      mctx,
    );
    expect(ops).toEqual([]);
  });
});

describe("materializeGrants — Starlit Span conflux spell (fixed-item from mechanics)", () => {
  it("materializes Shooting Star into the focus pool, tagged by Starlit Span", async () => {
    const mctx = ctxFor(
      { "spells-core": [shootingStarDoc()] },
      [],
      [{ id: "focus-entry", isFocusPool: true, tradition: "arcane" }],
    );
    const ops = await materializeGrants(
      starlitSpanWithMechanics(),
      "Pew7duAozEeAemif",
      "hybridStudy-1",
      mctx,
    );
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.type).toBe("doc:create");
    if (op.type !== "doc:create") throw new Error("expected create");
    expect(op.data["name"]).toBe("Shooting Star");
    expect(op.data["location"]).toBe("focus-entry");
    const fusion = (op.data["flags"] as Record<string, unknown>)["fusion"] as Record<
      string,
      unknown
    >;
    expect(fusion["grantedBy"]).toBe("Pew7duAozEeAemif");
    expect(fusion["grantedSlot"]).toBe("hybridStudy-1");
    expect(
      DocCreatePayloadSchema.safeParse({
        documentType: op.documentType,
        data: [op.data],
        parent: op.parent,
      }).success,
    ).toBe(true);
  });

  it("ADOPTS a manually-added Shooting Star (no grantedBy) instead of duplicating (critical)", async () => {
    // The real Tobias already has Shooting Star in the focus pool, added by hand.
    const existing = [
      {
        _id: "manual-shooting-star",
        name: "Shooting Star",
        type: "spell",
        location: "focus-entry",
        flags: { fusion: { sourceId: "SHOOT_SID" } }, // NO grantedBy — a manual add
      },
    ];
    const mctx = ctxFor({ "spells-core": [shootingStarDoc()] }, existing, [
      { id: "focus-entry", isFocusPool: true, tradition: "arcane" },
    ]);
    const ops = await materializeGrants(
      starlitSpanWithMechanics(),
      "Pew7duAozEeAemif",
      "hybridStudy-1",
      mctx,
    );
    // No duplicate create — a single ADOPT update stamping grantedBy on the existing item.
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.type).toBe("doc:update");
    if (op.type !== "doc:update") throw new Error("expected update");
    expect(op.id).toBe("manual-shooting-star");
    expect(op.embedded).toEqual({ type: "Item", id: "actor-1" });
    expect(op.diff["flags.fusion.grantedBy"]).toBe("Pew7duAozEeAemif");
    expect(op.diff["flags.fusion.grantedSlot"]).toBe("hybridStudy-1");
  });

  it("adopts by normalized NAME even when the manual add carries no sourceId", async () => {
    const existing = [
      { _id: "manual", name: "shooting star", type: "spell", flags: {} }, // no sourceId, different case
    ];
    const mctx = ctxFor({ "spells-core": [shootingStarDoc()] }, existing, [
      { id: "focus-entry", isFocusPool: true, tradition: "arcane" },
    ]);
    const ops = await materializeGrants(
      starlitSpanWithMechanics(),
      "Pew7duAozEeAemif",
      "hybridStudy-1",
      mctx,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("doc:update");
  });

  it("is idempotent once Shooting Star is already a grant of Starlit Span", async () => {
    const existing = [
      {
        _id: "g1",
        name: "Shooting Star",
        type: "spell",
        flags: { fusion: { grantedBy: "Pew7duAozEeAemif", sourceId: "SHOOT_SID" } },
      },
    ];
    const mctx = ctxFor({ "spells-core": [shootingStarDoc()] }, existing, [
      { id: "focus-entry", isFocusPool: true, tradition: "arcane" },
    ]);
    const ops = await materializeGrants(
      starlitSpanWithMechanics(),
      "Pew7duAozEeAemif",
      "hybridStudy-1",
      mctx,
    );
    expect(ops).toEqual([]);
  });

  it("does NOT adopt an unrelated item of a different type with the same name", async () => {
    // A feat named "Shooting Star" must not be adopted for a spell grant.
    const existing = [{ _id: "wrongtype", name: "Shooting Star", type: "feat", flags: {} }];
    const mctx = ctxFor({ "spells-core": [shootingStarDoc()] }, existing, [
      { id: "focus-entry", isFocusPool: true, tradition: "arcane" },
    ]);
    const ops = await materializeGrants(
      starlitSpanWithMechanics(),
      "Pew7duAozEeAemif",
      "hybridStudy-1",
      mctx,
    );
    // Creates a new spell (type mismatch blocks adoption of the feat).
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("doc:create");
  });
});

// ---------------------------------------------------------------------------
// Unresolved-grant diagnostics (issue #35)
//
// Three silent `continue`s used to swallow every failed grant: unknown vendor,
// target not found in the clean-room pack, and an unresolved ChoiceSet
// placeholder uuid. 43 grants fail per class build with no console line and no
// mark on the sheet. These tests pin the diagnostic channel.
// ---------------------------------------------------------------------------

describe("grant failure reporting", () => {
  /** A granter whose single grant points at a vendor we do not map. */
  function unknownVendorGranter(): Record<string, unknown> {
    return {
      _id: "granter-uv",
      name: "Unknown Vendor Granter",
      type: "feat",
      flags: { fusion: { sourceId: "SRC-UV" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.bestiary-ability-glossary-srd.Item.Grab",
            inMemoryOnly: false,
          },
        ],
      },
    };
  }

  /** A granter pointing at a real vendor but a document no pack holds. */
  function missingTargetGranter(): Record<string, unknown> {
    return {
      _id: "granter-mt",
      name: "Battle Creed",
      type: "classFeature",
      flags: { fusion: { sourceId: "SRC-MT" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.feats-srd.Item.Battle Harbinger Dedication",
            inMemoryOnly: false,
          },
        ],
      },
    };
  }

  /** A granter with an unresolved ChoiceSet placeholder (not flagged inMemoryOnly). */
  function placeholderGranter(): Record<string, unknown> {
    return {
      _id: "granter-ph",
      name: "Deity's Domain",
      type: "classFeature",
      flags: { fusion: { sourceId: "SRC-PH" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.classfeatures.Item.{item|flags.system.rulesSelections.deity}",
          },
        ],
      },
    };
  }

  function collectingCtx(byPack: Record<string, Record<string, unknown>[]> = {}): {
    mctx: MaterializeContext;
    failures: GrantFailure[];
  } {
    const failures: GrantFailure[] = [];
    const base = ctxFor(byPack);
    return { mctx: { ...base, onGrantFailure: (f) => failures.push(f) }, failures };
  }

  it("reports an unmapped vendor instead of skipping silently", async () => {
    const { mctx, failures } = collectingCtx();
    const ops = await materializeGrants(unknownVendorGranter(), "SRC-UV", "feat:1", mctx);

    expect(ops).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe("unknown-vendor");
    expect(failures[0]?.vendor).toBe("bestiary-ability-glossary-srd");
    expect(failures[0]?.granterSourceId).toBe("SRC-UV");
    expect(failures[0]?.granterName).toBe("Unknown Vendor Granter");
  });

  it("reports a target that exists in no clean-room pack", async () => {
    const { mctx, failures } = collectingCtx({ "feats-core": [] });
    const ops = await materializeGrants(missingTargetGranter(), "SRC-MT", undefined, mctx);

    expect(ops).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe("target-not-found");
    expect(failures[0]?.name).toBe("Battle Harbinger Dedication");
    expect(failures[0]?.packSlug).toBe("feats-core");
  });

  it("reports an unresolved ChoiceSet placeholder uuid", async () => {
    const { mctx, failures } = collectingCtx();
    const ops = await materializeGrants(placeholderGranter(), "SRC-PH", undefined, mctx);

    expect(ops).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe("unresolved-placeholder");
    expect(failures[0]?.uuid).toContain("rulesSelections.deity");
  });

  it("stays silent for grants explicitly deferred to the picker (inMemoryOnly)", async () => {
    const granter = {
      _id: "granter-im",
      name: "Muses",
      type: "classFeature",
      flags: { fusion: { sourceId: "SRC-IM" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.classfeatures.Item.{item|flags.system.rulesSelections.muse}",
            inMemoryOnly: true,
          },
        ],
      },
    };
    const { mctx, failures } = collectingCtx();
    await materializeGrants(granter, "SRC-IM", undefined, mctx);

    // inMemoryOnly is the picker path by design, not a failure.
    expect(failures).toHaveLength(0);
  });

  it("stays silent when every grant resolves", async () => {
    const { mctx, failures } = collectingCtx({
      "feats-core": [alchemicalCraftingDoc()],
      "actions-core": [quickAlchemyDoc()],
    });
    const ops = await materializeGrants(
      alchemistDedicationDoc(),
      "CJMkxlxHiHZQYDCz",
      "classFeat:2",
      mctx,
    );

    expect(createOps(ops)).toHaveLength(2);
    expect(failures).toHaveLength(0);
  });

  it("works with no reporter attached (channel is optional)", async () => {
    const mctx = ctxFor({});
    await expect(
      materializeGrants(unknownVendorGranter(), "SRC-UV", undefined, mctx),
    ).resolves.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Adoption must not swallow a PAID build slot (issue #15)
//
// findAdoptableItem only refused items that already carry `grantedBy`. An item
// the player placed into a feat slot carries `flags.fusion.build = {level,
// slot}` and NO grantedBy, so it looked adoptable — and buildAdoptOp stamped
// grantedBy onto it. From then on, swapping or removing the granter deleted
// the feat the player paid for, and left the slot's `build.choices` entry
// behind as a phantom "filled" slot.
//
// The Bard's five muses are the live case: each grants a LEVEL 1 Bard class
// feat that is pickable in the very `classFeat-1` slot offered at the same
// level (Maestro → Lingering Composition, Enigma → Bardic Lore, …).
// ---------------------------------------------------------------------------

describe("findAdoptableItem vs a paid build slot (issue #15)", () => {
  /** "Lingering Composition" as the pack ships it. */
  function lingeringCompositionDoc(): Record<string, unknown> {
    return {
      _id: "lc-pack",
      name: "Lingering Composition",
      type: "feat",
      flags: { fusion: { sourceId: "LINGERING" } },
      system: { rules: [], traits: { value: ["bard", "class"] } },
    };
  }

  /** The Maestro muse, which grants exactly that feat. */
  function maestroDoc(): Record<string, unknown> {
    return {
      _id: "maestro-pack",
      name: "Maestro",
      type: "classFeature",
      flags: { fusion: { sourceId: "MAESTRO" } },
      system: {
        rules: [
          {
            kind: "grant-item",
            uuid: "Compendium.pf2e.feats-srd.Item.Lingering Composition",
            inMemoryOnly: false,
          },
        ],
      },
    };
  }

  /** The same feat, embedded because the PLAYER spent their classFeat-1 slot on it. */
  function paidSlotItem(): Record<string, unknown> {
    return {
      _id: "embedded-lc",
      name: "Lingering Composition",
      type: "feat",
      flags: { fusion: { sourceId: "LINGERING", build: { level: 1, slot: "classFeat-1" } } },
      system: { rules: [], traits: { value: ["bard", "class"] } },
    };
  }

  it("creates its own copy instead of adopting the item occupying a build slot", async () => {
    const base = ctxFor({ "feats-core": [lingeringCompositionDoc()] });
    const mctx: MaterializeContext = { ...base, existingItems: [paidSlotItem()] };
    const ops = await materializeGrants(maestroDoc(), "MAESTRO", "muse-1", mctx);

    // An adopt op would be a doc:update stamping grantedBy on the PAID item.
    const adopts = ops.filter((o) => o.type === "doc:update" && o.id === "embedded-lc");
    expect(adopts, "the paid classFeat-1 item must never be adopted").toHaveLength(0);

    const creates = createOps(ops);
    expect(creates).toHaveLength(1);
    expect((creates[0]?.data as Record<string, unknown>)["name"]).toBe("Lingering Composition");
  });

  it("still adopts a genuinely MANUAL add (no build slot, no grantedBy)", async () => {
    // The r15 case this behaviour exists for: Shooting Star added by hand.
    const manual = {
      _id: "embedded-manual",
      name: "Lingering Composition",
      type: "feat",
      flags: { fusion: { sourceId: "LINGERING" } },
      system: { rules: [] },
    };
    const base = ctxFor({ "feats-core": [lingeringCompositionDoc()] });
    const mctx: MaterializeContext = { ...base, existingItems: [manual] };
    const ops = await materializeGrants(maestroDoc(), "MAESTRO", "muse-1", mctx);

    expect(createOps(ops), "a manual add must be adopted, not duplicated").toHaveLength(0);
    const adopts = ops.filter((o) => o.type === "doc:update" && o.id === "embedded-manual");
    expect(adopts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// issue #16 — census of every declared grant across the 14 real packs
//
// This is deliberately NOT a re-implementation of the resolution logic under
// test (that would be circular — see the r22 "circular test" lesson: 80 green
// tests coexisting with 60 real defects because the test checked derivation
// against its own table). Instead it drives the REAL `materializeGrants`
// (same function PlanColumn.svelte calls in the app) over every document of
// every committed pack on disk, with `resolveIndex`/`resolveDoc` backed by
// those same real packs — so a grant that fails here would fail in the app.
//
// Before this fix, 12 targets across 6 granters resolved to nothing: the
// Kineticist's 4 "Gate's Threshold" features (-> classfeatures:Gate
// Junction), the Ranger's 3 Hunter's Edge picks (-> classfeatures:Masterful
// Hunter (Flurry/Outwit/Precision)), the Wizard's "Runelord" archetype
// school (-> classfeatures:School of Thassilonian Rune Magic +
// feats-srd:Runelord Dedication), the Rogue's "Avenger" racket (->
// feats-srd:Avenger Dedication), the Ranger's "Vindicator" edge (->
// feats-srd:Vindicator Dedication) and the Barbarian's "Bloodrager" instinct
// (-> feats-srd:Bloodrager Dedication) — see issue #16.
//
// Two other groups of `target-not-found` are DELIBERATELY left unresolved
// (out of this issue's scope, per the issue text): the Cleric's "Battle
// Creed" chain (8 targets, "the already known hole") and 6 equipment items
// granted by ancestry/general feats (Clan Dagger, Clan Pistol, Head Gem,
// Pilgrim's Token, plus Lucky Keepsake and Orc Warmask — newly surfaced by
// this census because issue #1 added the Leshy/Orc ancestries and their
// feats after issue #16 was filed) that the vendor files under a pack
// Fusion doesn't curate equipment from at that granularity — a candidate
// for its own follow-up issue, not fixed here. "Scare to Death" —
// originally a 7th equipment-adjacent gap — resolves as a side effect of
// issue #24 (it's a level-15 skill feat) and is asserted explicitly below.
// The regression guard pins the exact remaining set so a future fix (or an
// accidental regression) is caught either way.
// ---------------------------------------------------------------------------

describe("issue #16: every declared grant across the 14 real packs resolves (or is a documented pre-existing gap)", () => {
  interface RawPackDoc {
    _id: string;
    name: string;
    type: string;
    system?: Record<string, unknown>;
    [key: string]: unknown;
  }

  function packsRoot(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "../../../../../../../systems/pf2e/packs");
  }

  function listPackSlugs(): string[] {
    const root = packsRoot();
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((slug) => existsSync(path.join(root, slug, "documents.json")));
  }

  function loadPack(slug: string): RawPackDoc[] {
    const raw = readFileSync(path.join(packsRoot(), slug, "documents.json"), "utf8");
    return JSON.parse(raw) as RawPackDoc[];
  }

  function loadMechanics(slug: string): Record<string, { grants?: unknown[] }> {
    const p = path.join(packsRoot(), slug, "mechanics.json");
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, "utf8")) as { entries?: Record<string, unknown> };
    return (raw.entries ?? {}) as Record<string, { grants?: unknown[] }>;
  }

  /** Run materializeGrants for every doc in every pack, one hop deep, collecting every dropped grant. */
  async function censusFailures(): Promise<Array<GrantFailure & { granterPack: string }>> {
    const slugs = listPackSlugs();
    const docsBySlug = new Map(slugs.map((slug) => [slug, loadPack(slug)]));
    const syntheticUuid = (slug: string, id: string): string => `test://${slug}/${id}`;
    const docsByUuid = new Map<string, RawPackDoc>();
    const indexBySlug = new Map<string, GrantIndexEntry[]>();
    for (const [slug, docs] of docsBySlug) {
      const entries: GrantIndexEntry[] = [];
      for (const doc of docs) {
        const uuid = syntheticUuid(slug, doc._id);
        docsByUuid.set(uuid, doc);
        entries.push({ _id: doc._id, name: doc.name, uuid, type: doc.type });
      }
      indexBySlug.set(slug, entries);
    }

    const failures: Array<GrantFailure & { granterPack: string }> = [];
    const baseMctx: Omit<MaterializeContext, "onGrantFailure"> = {
      actorId: "census-actor",
      existingItems: [],
      spellEntries: [],
      resolveIndex: async (packSlug) => indexBySlug.get(packSlug) ?? [],
      resolveDoc: async (uuid) =>
        (docsByUuid.get(uuid) as Record<string, unknown> | undefined) ?? null,
    };

    for (const slug of slugs) {
      const docs = docsBySlug.get(slug)!;
      const mechanics = loadMechanics(slug);
      for (const doc of docs) {
        // Attach the doc's mechanics overlay exactly as CompendiumService does
        // (packages/server/src/compendium/service.ts) — grants of kind
        // "fixed-item" live there, not in system.rules.
        const mechEntry = mechanics[doc._id];
        const docWithMechanics = mechEntry ? { ...doc, mechanics: mechEntry } : doc;
        // maxDepth=1: process only THIS doc's own declared grants. Every doc is
        // ALSO visited as its own top-level granter in this loop, so nested
        // targets (e.g. Bloodrager Dedication -> Harvest Blood) still get their
        // own one-hop check when Bloodrager Dedication itself is the root.
        await materializeGrants(
          docWithMechanics as unknown as Record<string, unknown>,
          doc._id,
          undefined,
          {
            ...baseMctx,
            onGrantFailure: (failure) => failures.push({ ...failure, granterPack: slug }),
          },
          1,
        );
      }
    }
    return failures;
  }

  it("the 12 issue #16 targets all resolve", async () => {
    const failures = await censusFailures();
    const stillFailing = new Set(failures.map((f) => f.name));
    const issue16Targets = [
      "Gate Junction",
      "Masterful Hunter (Flurry)",
      "Masterful Hunter (Outwit)",
      "Masterful Hunter (Precision)",
      "School of Thassilonian Rune Magic",
      "Runelord Dedication",
      "Avenger Dedication",
      "Vindicator Dedication",
      "Bloodrager Dedication",
    ];
    const notResolved = issue16Targets.filter((name) => stillFailing.has(name));
    expect(notResolved, `issue #16 targets still failing: ${notResolved.join(", ")}`).toEqual([]);
  });

  it("Scare to Death resolves as a side effect of issue #24 (Raging Intimidation's grant)", async () => {
    const failures = await censusFailures();
    expect(failures.some((f) => f.name === "Scare to Death")).toBe(false);
  });

  it("regression guard: no unknown-vendor failures, and target-not-found is exactly the documented pre-existing gap", async () => {
    const failures = await censusFailures();
    const unknownVendor = failures.filter((f) => f.reason === "unknown-vendor");
    expect(
      unknownVendor,
      `unexpected unknown-vendor grants: ${JSON.stringify(unknownVendor)}`,
    ).toEqual([]);

    const notFound = failures.filter((f) => f.reason === "target-not-found");
    const expectedRemainingGap = [
      // Cleric's "Battle Creed" chain — the already-known hole (issue #16 text), out of scope here.
      "Initial Creed",
      "Lesser Creed",
      "Moderate Creed",
      "Greater Creed",
      "Major Creed",
      "True Creed",
      "Final Creed",
      "Battle Harbinger Dedication",
      // Equipment items granted by ancestry/general feats — out of scope here (no equipment
      // pack curates these vendor items at this granularity). Lucky Keepsake (Leshy) and Orc
      // Warmask (Orc) are newly surfaced by this census (issue #1 landed after #16 was filed).
      "Clan Dagger",
      "Clan Pistol",
      "Head Gem",
      "Lucky Keepsake",
      "Orc Warmask",
      "Pilgrim's Token",
      // r27: same equipment-grant shape, surfaced by the Player Core 2 ancestry
      // feat census (a Tengu feat grants this vendor equipment item).
      "Tengu Feather Fan",
    ].sort();
    expect(notFound.map((f) => f.name).sort()).toEqual(expectedRemainingGap);
  });
});
