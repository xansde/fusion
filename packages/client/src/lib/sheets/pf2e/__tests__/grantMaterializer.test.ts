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
    expect(mapVendorToFusionPack("feats-srd")).toBe("feats-core");
    expect(mapVendorToFusionPack("actionspf2e")).toBe("actions-core");
    expect(mapVendorToFusionPack("spells-srd")).toBe("spells-core");
    expect(mapVendorToFusionPack("classfeatures")).toBe("class-features-core");
  });

  it("maps ancestryfeatures to ancestry-features-core (r20-X5), not class-features-core", () => {
    // Before r20-X5 this vendor pointed at class-features-core (which never
    // holds ancestry features) so grants silently no-op'd. Both the vendor
    // compendium id (ancestryfeatures) and the pack folder name
    // (ancestry-features) resolve to the new clean-room pack.
    expect(mapVendorToFusionPack("ancestryfeatures")).toBe("ancestry-features-core");
    expect(mapVendorToFusionPack("ancestry-features")).toBe("ancestry-features-core");
  });

  it("returns undefined for an unknown vendor", () => {
    expect(mapVendorToFusionPack("some-unknown-pack")).toBeUndefined();
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

  function collectingCtx(
    byPack: Record<string, Record<string, unknown>[]> = {},
  ): { mctx: MaterializeContext; failures: GrantFailure[] } {
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
