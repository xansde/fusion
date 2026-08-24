/**
 * actionsVM.test.ts — headless unit tests for the Actions tab VM helpers.
 *
 * Mirrors the pure-VM test shape used across lib/sheets/pf2e. Covers:
 *   - shape-robust cost/group resolution (flattened scalar AND {value} wrapper)
 *   - row construction from pack index entries and embedded actor items
 *   - merge + dedupe (embedded/character action wins over same-slug pack action)
 *   - filtering (group toggles, cost filter, accent/case-insensitive search)
 *   - sorting (character actions first, then alphabetical)
 *   - load-error classification
 */

import { describe, it, expect } from "vitest";
import type { PackIndexEntry } from "@fusion/shared";
import { SocketUnavailableError } from "$lib/compendium/compendiumApi.js";
import {
  resolveActionCost,
  resolveActionGroup,
  fusionCategoryOf,
  hasImpulseTrait,
  slugFromName,
  rowFromIndexEntry,
  rowFromEmbeddedItem,
  actionRowNameParts,
  mergeActionRows,
  buildActionNameIndex,
  buildActionSourceIdIndex,
  mergeEmbeddedNameOverlay,
  filterActionRows,
  filterRelevantRows,
  deriveCharacterProfile,
  isActionRelevant,
  sortActionRows,
  defaultFilterState,
  classifyLoadError,
  paginate,
  buildEmbeddedDetailsDoc,
  descriptionHtmlOf,
  needsFallbackDescription,
  withFallbackDescription,
  parseImpulseSaveCue,
  parseImpulseDamage,
  kineticistClassDc,
  buildImpulseUseAnnouncement,
  buildImpulseCard,
  readElementalBlasts,
  buildElementalBlastAttackOp,
  buildElementalBlastCard,
  ACTIONS_PAGE_SIZE,
  type ActionRow,
  type BlastRowVM,
  type ActionCostFilter,
} from "../actionsVM.js";
import { AbilityCardSchema } from "@fusion/shared";
import type { ActionGroup } from "../actionCategories.js";

// ---------------------------------------------------------------------------
// resolveActionCost — both shapes
// ---------------------------------------------------------------------------

describe("resolveActionCost()", () => {
  it("reads a flattened actionType/actions (post-transform pack shape)", () => {
    expect(resolveActionCost({ actionType: "action", actions: 1 }).kind).toBe("1");
    expect(resolveActionCost({ actionType: "action", actions: 2 }).kind).toBe("2");
    expect(resolveActionCost({ actionType: "action", actions: 3 }).kind).toBe("3");
    expect(resolveActionCost({ actionType: "reaction", actions: null }).kind).toBe("reaction");
    expect(resolveActionCost({ actionType: "free", actions: null }).kind).toBe("free");
    expect(resolveActionCost({ actionType: "passive" }).kind).toBe("passive");
  });

  it("reads the nested {value} vendor wrapper shape", () => {
    expect(resolveActionCost({ actionType: { value: "action" }, actions: { value: 2 } }).kind).toBe(
      "2",
    );
    expect(
      resolveActionCost({ actionType: { value: "reaction" }, actions: { value: null } }).kind,
    ).toBe("reaction");
  });

  it("maps kinds to the expected glyphs", () => {
    expect(resolveActionCost({ actionType: "action", actions: 1 }).glyphs).toBe("◆");
    expect(resolveActionCost({ actionType: "action", actions: 2 }).glyphs).toBe("◆◆");
    expect(resolveActionCost({ actionType: "action", actions: 3 }).glyphs).toBe("◆◆◆");
    expect(resolveActionCost({ actionType: "reaction" }).glyphs).toBe("⟳");
    expect(resolveActionCost({ actionType: "free" }).glyphs).toBe("◇");
    expect(resolveActionCost({ actionType: "passive" }).glyphs).toBe("");
  });

  it("falls back to unknown when nothing usable is present", () => {
    expect(resolveActionCost({}).kind).toBe("unknown");
    expect(resolveActionCost({ actionType: "action" }).kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// resolveActionGroup — folder axis, then mechanical axis, then other
// ---------------------------------------------------------------------------

describe("resolveActionGroup()", () => {
  it("prefers system.fusionCategory (the real importer-written field)", () => {
    const doc = { system: { category: "offensive", fusionCategory: "skill" } };
    expect(resolveActionGroup(doc)).toBe<ActionGroup>("skill");
  });

  it("maps every fusionCategory value the actions-core pack actually ships", () => {
    expect(resolveActionGroup({ system: { fusionCategory: "class" } })).toBe<ActionGroup>("class");
    expect(resolveActionGroup({ system: { fusionCategory: "archetype" } })).toBe<ActionGroup>(
      "archetype",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "ancestry" } })).toBe<ActionGroup>(
      "ancestry",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "heritage" } })).toBe<ActionGroup>(
      "ancestry",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "background" } })).toBe<ActionGroup>(
      "background",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "basic" } })).toBe<ActionGroup>("basic");
    expect(resolveActionGroup({ system: { fusionCategory: "skill" } })).toBe<ActionGroup>("skill");
    expect(resolveActionGroup({ system: { fusionCategory: "equipment" } })).toBe<ActionGroup>(
      "equipment",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "exploration" } })).toBe<ActionGroup>(
      "exploration",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "downtime" } })).toBe<ActionGroup>(
      "downtime",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "spells" } })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({ system: { fusionCategory: "stamina" } })).toBe<ActionGroup>(
      "other",
    );
    expect(resolveActionGroup({ system: { fusionCategory: "mythic" } })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({ system: { fusionCategory: "familiar" } })).toBe<ActionGroup>(
      "other",
    );
  });

  it("falls back to a re-injected legacy folder field (flags.fusion.actionFolder)", () => {
    const doc = { system: { category: "offensive" }, flags: { fusion: { actionFolder: "skill" } } };
    expect(resolveActionGroup(doc)).toBe<ActionGroup>("skill");
  });

  it("reads a system-level folder field too", () => {
    expect(resolveActionGroup({ system: { actionFolder: "class" } })).toBe<ActionGroup>("class");
  });

  it("falls back to the mechanical system.category axis", () => {
    expect(resolveActionGroup({ system: { category: "offensive" } })).toBe<ActionGroup>("basic");
    expect(resolveActionGroup({ system: { category: "interaction" } })).toBe<ActionGroup>("basic");
  });

  it("falls back to 'other' when nothing resolves", () => {
    expect(resolveActionGroup({ system: {} })).toBe<ActionGroup>("other");
    expect(resolveActionGroup({})).toBe<ActionGroup>("other");
  });
});

// ---------------------------------------------------------------------------
// slugFromName
// ---------------------------------------------------------------------------

describe("slugFromName()", () => {
  it("kebab-cases and strips accents", () => {
    expect(slugFromName("Raise a Shield")).toBe("raise-a-shield");
    expect(slugFromName("Sense Motive")).toBe("sense-motive");
    expect(slugFromName("Açúcar Doce")).toBe("acucar-doce");
  });

  it("trims leading/trailing separators", () => {
    expect(slugFromName("  Fly!  ")).toBe("fly");
  });
});

// ---------------------------------------------------------------------------
// rowFromIndexEntry
// ---------------------------------------------------------------------------

function packEntry(name: string, index: Record<string, unknown>, namePt?: string): PackIndexEntry {
  return {
    _id: slugFromName(name),
    uuid: `Compendium.pf2e.actions-core.Item.${slugFromName(name)}`,
    name,
    img: null,
    type: "action",
    index,
    ...(namePt !== undefined ? { namePt, i18n: { ptBR: { name: namePt } } } : {}),
  };
}

describe("rowFromIndexEntry()", () => {
  it("builds a pack row from flattened index fields", () => {
    const entry = packEntry("Seek", {
      "system.actionType": "action",
      "system.actions": 1,
      "system.category": "interaction",
      "system.traits.value": ["concentrate", "secret"],
    });
    const row = rowFromIndexEntry(entry);
    expect(row.name).toBe("Seek");
    expect(row.slug).toBe("seek");
    expect(row.uuid).toBe(entry.uuid);
    expect(row.cost.kind).toBe("1");
    expect(row.traits).toEqual(["concentrate", "secret"]);
    expect(row.fromCharacter).toBe(false);
    expect(row.group).toBe<ActionGroup>("basic"); // via mechanical axis
  });

  it("reads system.fusionCategory from the index (real actions-core shape)", () => {
    const entry = packEntry("Anadi Venom", {
      "system.actionType": "action",
      "system.actions": 1,
      "system.category": "offensive",
      "system.fusionCategory": "ancestry",
      "system.traits.value": ["anadi"],
    });
    const row = rowFromIndexEntry(entry);
    expect(row.group).toBe<ActionGroup>("ancestry"); // folder axis wins over mechanical
  });

  it("builds a pack row from nested {value} index fields", () => {
    const entry = packEntry("Aid", {
      "system.actionType.value": "reaction",
      "system.actions.value": null,
      "system.traits.value": [],
    });
    const row = rowFromIndexEntry(entry);
    expect(row.cost.kind).toBe("reaction");
    expect(row.cost.glyphs).toBe("⟳");
  });

  it("carries the EN name and the server-attached pt-BR name (T1)", () => {
    const entry = packEntry(
      "Raise a Shield",
      { "system.actionType": "action", "system.actions": 1 },
      "Erguer Escudo",
    );
    const row = rowFromIndexEntry(entry);
    expect(row.name).toBe("Raise a Shield");
    expect(row.nameEn).toBe("Raise a Shield");
    expect(row.namePt).toBe("Erguer Escudo");
  });

  it("reads pt-BR name from nested i18n.ptBR.name when the flat namePt is absent", () => {
    const entry: PackIndexEntry = {
      ...packEntry("Seek", { "system.actionType": "action", "system.actions": 1 }),
      i18n: { ptBR: { name: "Procurar" } },
    };
    expect(rowFromIndexEntry(entry).namePt).toBe("Procurar");
  });

  it("leaves namePt null for an untranslated entry", () => {
    const entry = packEntry("Seek", { "system.actionType": "action", "system.actions": 1 });
    expect(rowFromIndexEntry(entry).namePt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// actionRowNameParts — bilingual display (reuses shared localizedNameParts)
// ---------------------------------------------------------------------------

describe("actionRowNameParts()", () => {
  it("shows the pt-BR name with the EN name as subtitle on the pt-BR locale", () => {
    const r = row({
      name: "Raise a Shield",
      slug: "raise-a-shield",
      group: "basic",
      namePt: "Erguer Escudo",
    });
    const parts = actionRowNameParts(r, "pt-BR");
    expect(parts.display).toBe("Erguer Escudo");
    expect(parts.subtitleEn).toBe("Raise a Shield");
  });

  it("shows only the EN name (no subtitle) when untranslated", () => {
    const r = row({ name: "Seek", slug: "seek", group: "basic" });
    const parts = actionRowNameParts(r, "pt-BR");
    expect(parts.display).toBe("Seek");
    expect(parts.subtitleEn).toBeNull();
  });

  it("shows the EN name and no subtitle on the 'en' locale even when translated", () => {
    const r = row({
      name: "Raise a Shield",
      slug: "raise-a-shield",
      group: "basic",
      namePt: "Erguer Escudo",
    });
    const parts = actionRowNameParts(r, "en");
    expect(parts.display).toBe("Raise a Shield");
    expect(parts.subtitleEn).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rowFromEmbeddedItem
// ---------------------------------------------------------------------------

describe("rowFromEmbeddedItem()", () => {
  it("surfaces an embedded feat that is itself an action", () => {
    const item = {
      _id: "abc123",
      type: "feat",
      name: "Bon Mot",
      system: {
        actionType: "action",
        actions: 1,
        slug: "bon-mot",
        traits: { value: ["auditory"] },
      },
    };
    const row = rowFromEmbeddedItem(item);
    expect(row).not.toBeNull();
    expect(row?.fromCharacter).toBe(true);
    expect(row?.slug).toBe("bon-mot");
    expect(row?.key).toBe("embedded:abc123");
    expect(row?.uuid).toBeNull();
    expect(row?.cost.kind).toBe("1");
  });

  it("surfaces an embedded action-type item with a reaction cost", () => {
    const item = {
      _id: "r1",
      type: "action",
      name: "Attack of Opportunity",
      system: { actionType: "reaction", actions: null, traits: { value: [] } },
    };
    expect(rowFromEmbeddedItem(item)?.cost.kind).toBe("reaction");
  });

  it("returns null for a passive feat (not an action)", () => {
    const item = { _id: "p1", type: "feat", name: "Toughness", system: { actionType: "passive" } };
    expect(rowFromEmbeddedItem(item)).toBeNull();
  });

  it("returns null for non-action-bearing item types", () => {
    const item = { _id: "w1", type: "weapon", name: "Longsword", system: { actionType: "action" } };
    expect(rowFromEmbeddedItem(item)).toBeNull();
  });

  it("derives a slug from the name when system.slug is absent", () => {
    const item = {
      _id: "x",
      type: "action",
      name: "Raise a Shield",
      system: { actionType: "action", actions: 1 },
    };
    expect(rowFromEmbeddedItem(item)?.slug).toBe("raise-a-shield");
  });
});

// ---------------------------------------------------------------------------
// Impulse detection + surfacing (r19-W3) — Kineticist impulses are activities
// that must always appear as character rows with an "Impulso" flag.
// ---------------------------------------------------------------------------

describe("hasImpulseTrait()", () => {
  it("detects the impulse trait case-insensitively", () => {
    expect(hasImpulseTrait(["air", "impulse", "kineticist", "primal"])).toBe(true);
    expect(hasImpulseTrait(["IMPULSE"])).toBe(true);
    expect(hasImpulseTrait(["air", "kineticist"])).toBe(false);
    expect(hasImpulseTrait([])).toBe(false);
  });
});

describe("impulse rows (rowFromEmbeddedItem / rowFromIndexEntry)", () => {
  it("flags an embedded impulse feat (Four Winds) as isImpulse", () => {
    const item = {
      _id: "fw1",
      type: "feat",
      name: "Four Winds",
      system: {
        actionType: "action",
        actions: 2,
        traits: { value: ["air", "impulse", "kineticist", "primal"] },
      },
    };
    const row = rowFromEmbeddedItem(item);
    expect(row?.isImpulse).toBe(true);
    expect(row?.fromCharacter).toBe(true);
    expect(row?.cost.kind).toBe("2");
    expect(row?.cost.glyphs).toBe("◆◆");
  });

  it("still surfaces an impulse feat even if actionType was not preserved (never vanishes)", () => {
    // Belt-and-suspenders: a mis-imported impulse with no usable actionType must
    // still show (the user's report: 'Como Quatro Ventos … não mostram na ficha').
    const item = {
      _id: "sw1",
      type: "feat",
      name: "Solar Shield",
      system: { traits: { value: ["impulse", "kineticist", "fire"] } },
    };
    const row = rowFromEmbeddedItem(item);
    expect(row).not.toBeNull();
    expect(row?.isImpulse).toBe(true);
    expect(row?.cost.kind).toBe("unknown"); // no glyphs, but the row is present
  });

  it("leaves a normal (non-impulse) action row isImpulse false", () => {
    const item = {
      _id: "s1",
      type: "action",
      name: "Seek",
      system: { actionType: "action", actions: 1 },
    };
    expect(rowFromEmbeddedItem(item)?.isImpulse).toBe(false);
  });

  it("still returns null for a non-impulse passive feat (Toughness unchanged)", () => {
    const item = {
      _id: "t1",
      type: "feat",
      name: "Toughness",
      system: { actionType: "passive", traits: { value: ["general"] } },
    };
    expect(rowFromEmbeddedItem(item)).toBeNull();
  });

  it("flags a pack index row carrying the impulse trait", () => {
    const entry = packEntry("Elemental Blast", {
      "system.actionType": "action",
      "system.actions": 1,
      "system.traits.value": ["impulse", "kineticist"],
    });
    expect(rowFromIndexEntry(entry).isImpulse).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// "Usar" impulse announcement (r19-W3) — @Check parse, class DC, chat:send op
// ---------------------------------------------------------------------------

describe("parseImpulseSaveCue()", () => {
  it("extracts save + basic from a save @Check (Shard Strike)", () => {
    const desc = "<p>…@Check[reflex|against:kineticist|basic|options:area-effect]…</p>";
    expect(parseImpulseSaveCue(desc)).toEqual({ save: "reflex", basic: true });
  });

  it("extracts a non-basic save", () => {
    expect(parseImpulseSaveCue("@Check[fortitude|against:kineticist]")).toEqual({
      save: "fortitude",
      basic: false,
    });
  });

  it("returns null for an attack @Check (defense:ac) and for no @Check", () => {
    expect(
      parseImpulseSaveCue("Make ranged @Check[impulse|defense:ac]{impulse attack} rolls"),
    ).toBeNull();
    expect(parseImpulseSaveCue("<p>Four willing creatures Stride.</p>")).toBeNull();
    expect(parseImpulseSaveCue("")).toBeNull();
    expect(parseImpulseSaveCue(null)).toBeNull();
  });

  it("takes the first save @Check when several are present", () => {
    expect(parseImpulseSaveCue("@Check[will|basic] then @Check[reflex]")).toEqual({
      save: "will",
      basic: true,
    });
  });
});

describe("kineticistClassDc()", () => {
  it("reads system.derived.classDC.dc", () => {
    expect(kineticistClassDc({ system: { derived: { classDC: { dc: 19 } } } })).toBe(19);
  });

  it("returns null when absent", () => {
    expect(kineticistClassDc({})).toBeNull();
    expect(kineticistClassDc({ system: {} })).toBeNull();
    expect(kineticistClassDc({ system: { derived: { classDC: {} } } })).toBeNull();
  });
});

describe("buildImpulseUseAnnouncement()", () => {
  const base = { worldId: "w1", speakerActorId: "a1" };

  it("assembles verb + name + glyphs + pt-BR traits (Four Winds)", () => {
    const op = buildImpulseUseAnnouncement({
      verb: "usa",
      displayName: "Quatro Ventos",
      glyphs: "◆◆",
      traitLabels: ["ar", "impulso", "cineticista", "primal"],
      ...base,
    });
    expect(op).toEqual({
      type: "chat:send",
      content: "usa Quatro Ventos ◆◆ (ar, impulso, cineticista, primal)",
      worldId: "w1",
      rollMode: "public",
      speakerActorId: "a1",
    });
  });

  it("appends the save line when present (Shard Strike)", () => {
    const op = buildImpulseUseAnnouncement({
      verb: "usa",
      displayName: "Shard Strike",
      glyphs: "◆◆",
      traitLabels: ["impulso", "cineticista", "metal"],
      saveLine: "CD 19, Reflexos básico",
      ...base,
    });
    expect(op?.content).toBe(
      "usa Shard Strike ◆◆ (impulso, cineticista, metal) — CD 19, Reflexos básico",
    );
  });

  it("omits glyphs and traits when empty", () => {
    const op = buildImpulseUseAnnouncement({
      verb: "usa",
      displayName: "X",
      glyphs: "",
      traitLabels: [],
      ...base,
    });
    expect(op?.content).toBe("usa X");
  });

  it("returns null without a speaker actor", () => {
    expect(
      buildImpulseUseAnnouncement({
        verb: "usa",
        displayName: "X",
        glyphs: "◆",
        traitLabels: [],
        worldId: "w1",
        speakerActorId: "",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Elemental Blast shortcut rows (r19-W3 item 2) — read from derived, roll MAP-0
// ---------------------------------------------------------------------------

describe("readElementalBlasts()", () => {
  const doc = {
    system: {
      derived: {
        elementalBlasts: [
          {
            element: "air",
            damageType: "electricity",
            attackBonus: 9,
            damageFormula: "1d6+4",
            isRanged: true,
            range: 60,
            variants: [
              { mapPenalty: 0, total: 9, formula: "1d20 + 9" },
              { mapPenalty: -5, total: 4, formula: "1d20 + 4" },
              { mapPenalty: -10, total: -1, formula: "1d20 - 1" },
            ],
          },
          {
            element: "metal",
            damageType: "slashing",
            attackBonus: 9,
            damageFormula: "1d8+4",
            isRanged: false,
            range: null,
            variants: [{ total: 9, formula: "1d20+9" }, {}, {}],
          },
        ],
      },
    },
  };

  it("reads one row per gate element with the MAP-0 attack + damage", () => {
    const rows = readElementalBlasts(doc);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      element: "air",
      damageType: "electricity",
      attackTotal: 9,
      attackFormula: "1d20 + 9",
      damageFormula: "1d6+4",
      isRanged: true,
      range: 60,
    });
    expect(rows[1]?.element).toBe("metal");
    expect(rows[1]?.isRanged).toBe(false);
    expect(rows[1]?.range).toBeNull();
  });

  it("returns [] for a non-kineticist / missing derived", () => {
    expect(readElementalBlasts({})).toEqual([]);
    expect(readElementalBlasts({ system: {} })).toEqual([]);
    expect(readElementalBlasts({ system: { derived: {} } })).toEqual([]);
    expect(readElementalBlasts({ system: { derived: { elementalBlasts: [] } } })).toEqual([]);
  });

  it("skips malformed blast entries but keeps the valid ones", () => {
    const partial = {
      system: { derived: { elementalBlasts: [null, { element: "fire", variants: [] }, "x"] } },
    };
    const rows = readElementalBlasts(partial);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.element).toBe("fire");
    expect(rows[0]?.attackFormula).toBe(""); // no MAP-0 variant → inert roll button
  });
});

describe("buildElementalBlastAttackOp()", () => {
  const base = { worldId: "w1", speakerActorId: "a1" };

  it("builds a /r attack op, stripping whitespace from the derived formula", () => {
    const op = buildElementalBlastAttackOp({
      attackFormula: "1d20 + 9",
      flavor: "Rajada Elemental (Ar) (MAP 0)",
      ...base,
    });
    expect(op).toEqual({
      type: "chat:send",
      content: "/r 1d20+9 # Rajada Elemental (Ar) (MAP 0)",
      worldId: "w1",
      rollMode: "public",
      speakerActorId: "a1",
    });
  });

  it("returns null when the formula or speaker is empty", () => {
    expect(buildElementalBlastAttackOp({ attackFormula: "", flavor: "x", ...base })).toBeNull();
    expect(
      buildElementalBlastAttackOp({
        attackFormula: "1d20+9",
        flavor: "x",
        worldId: "w1",
        speakerActorId: "",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseImpulseDamage — @Damage → rollable formula (r20-X1)
// ---------------------------------------------------------------------------

describe("parseImpulseDamage()", () => {
  it("parses a clean dice formula + type", () => {
    expect(parseImpulseDamage("<p>@Damage[2d6[bludgeoning]]</p>")).toEqual({
      formula: "2d6",
      damageType: "bludgeoning",
    });
  });

  it("keeps a parenthesized clean formula and skips category markers", () => {
    expect(parseImpulseDamage("deals @Damage[(1d4+2)[persistent,fire]]")).toEqual({
      formula: "(1d4+2)",
      damageType: "fire",
    });
  });

  it("drops trailing |options flags", () => {
    expect(parseImpulseDamage("@Damage[3d6[cold]|options:area-damage]")).toEqual({
      formula: "3d6",
      damageType: "cold",
    });
  });

  it("returns null for level-scaled formulas (chat:send cannot resolve @actor)", () => {
    expect(parseImpulseDamage("@Damage[ceil(@actor.level/2)d6[fire]]")).toBeNull();
    expect(parseImpulseDamage("@Damage[ternary(gte(@actor.level,18),7,5)d6[acid]]")).toBeNull();
  });

  it("returns null when there is no @Damage token", () => {
    expect(parseImpulseDamage("<p>Push targets with @Check[reflex|basic]</p>")).toBeNull();
    expect(parseImpulseDamage(null)).toBeNull();
    expect(parseImpulseDamage("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildImpulseCard — impulse "Usar" as an interactive AbilityCard (r20-X1)
// ---------------------------------------------------------------------------

describe("buildImpulseCard()", () => {
  const base = {
    verb: "usa",
    displayName: "Quatro Ventos",
    glyphs: "◆◆",
    traitLabels: ["ar", "impulso"],
    traitSlugs: ["air", "impulse"],
    worldId: "w1",
    speakerActorId: "finn",
  };

  it("builds a save impulse card (class DC) with text content + flag", () => {
    const op = buildImpulseCard({
      ...base,
      saveCue: { save: "reflex", basic: true },
      classDc: 21,
      saveLine: "CD 21, Reflexos básico",
      damage: null,
    });
    expect(op).not.toBeNull();
    expect(op!.content).toBe("usa Quatro Ventos ◆◆ (ar, impulso) — CD 21, Reflexos básico");
    const card = op!.flags?.pf2e?.abilityCard;
    expect(card).toBeDefined();
    expect(AbilityCardSchema.safeParse(card).success).toBe(true);
    expect(card!.kind).toBe("impulse");
    expect(card!.dcValue).toBe(21);
    expect(card!.saveType).toBe("reflex");
    expect(card!.basicSave).toBe(true);
    expect(card!.damageFormula).toBeUndefined();
    expect(card!.traits).toEqual(["air", "impulse"]);
  });

  it("includes a clean damage formula when present", () => {
    const op = buildImpulseCard({
      ...base,
      displayName: "Estilhaço",
      saveCue: null,
      classDc: 21,
      saveLine: null,
      damage: { formula: "2d6", damageType: "piercing" },
    });
    const card = op!.flags?.pf2e?.abilityCard;
    expect(card!.damageFormula).toBe("2d6");
    expect(card!.damageType).toBe("piercing");
    expect(card!.saveType).toBeUndefined();
  });

  it("omits the DC when the class DC is unknown (save display-only)", () => {
    const op = buildImpulseCard({
      ...base,
      saveCue: { save: "reflex", basic: false },
      classDc: null,
      saveLine: null,
      damage: null,
    });
    const card = op!.flags?.pf2e?.abilityCard;
    expect(card!.dcValue).toBeUndefined();
    expect(card!.saveType).toBeUndefined();
  });

  it("returns null without a speaker actor", () => {
    expect(
      buildImpulseCard({ ...base, speakerActorId: "", saveCue: null, classDc: null, damage: null }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildElementalBlastCard — Rajada as attack + damage card (r20-X1)
// ---------------------------------------------------------------------------

describe("buildElementalBlastCard()", () => {
  const blast: BlastRowVM = {
    element: "air",
    damageType: "electricity",
    attackTotal: 9,
    attackFormula: "1d20 + 9",
    damageFormula: "1d6+4 electricity",
    damageRoll: "1d6+4",
    twoActionDamageBonus: 3,
    isRanged: true,
    range: 60,
  };

  it("builds an announcement (card) + a nested-able MAP-0 attack", () => {
    const built = buildElementalBlastCard({
      blast,
      cardName: "Rajada Elemental (Ar)",
      attackFlavor: "Rajada Elemental (Ar) (MAP 0)",
      worldId: "w1",
      speakerActorId: "finn",
    });
    expect(built).not.toBeNull();
    // Attack op is a plain roll (whitespace stripped) — nested by the caller.
    expect(built!.attack.content).toBe("/r 1d20+9 # Rajada Elemental (Ar) (MAP 0)");
    expect(built!.attack.flags).toBeUndefined();
    // Announcement carries the impulse card with rollable damage.
    const card = built!.announcement.flags?.pf2e?.abilityCard;
    expect(AbilityCardSchema.safeParse(card).success).toBe(true);
    expect(card!.kind).toBe("impulse");
    expect(card!.name).toBe("Rajada Elemental (Ar)");
    expect(card!.damageFormula).toBe("1d6+4");
    expect(card!.damageType).toBe("electricity");
  });

  it("returns null when the attack formula or speaker is missing", () => {
    expect(
      buildElementalBlastCard({
        blast: { ...blast, attackFormula: "" },
        cardName: "x",
        attackFlavor: "x",
        worldId: "w1",
        speakerActorId: "finn",
      }),
    ).toBeNull();
    expect(
      buildElementalBlastCard({
        blast,
        cardName: "x",
        attackFlavor: "x",
        worldId: "w1",
        speakerActorId: "",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeActionRows — dedupe, embedded wins
// ---------------------------------------------------------------------------

describe("mergeActionRows()", () => {
  it("dedupes by slug with the embedded (character) row winning", () => {
    const pack = [
      packEntry("Raise a Shield", { "system.actionType": "action", "system.actions": 1 }),
      packEntry("Seek", { "system.actionType": "action", "system.actions": 1 }),
    ];
    const embedded = [
      {
        _id: "ras",
        type: "action",
        name: "Raise a Shield",
        system: { actionType: "action", actions: 1 },
      },
    ];
    const merged = mergeActionRows(pack, embedded);
    const raise = merged.filter((r) => r.slug === "raise-a-shield");
    expect(raise).toHaveLength(1);
    expect(raise[0]?.fromCharacter).toBe(true);
    expect(raise[0]?.key).toBe("embedded:ras");
    // Seek stays as the pack row.
    expect(merged.find((r) => r.slug === "seek")?.fromCharacter).toBe(false);
  });

  it("ignores embedded items that are not actions", () => {
    const embedded = [
      { _id: "t", type: "feat", name: "Toughness", system: { actionType: "passive" } },
    ];
    const merged = mergeActionRows(
      [packEntry("Seek", { "system.actionType": "action", "system.actions": 1 })],
      embedded,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Seek");
  });

  it("keeps a character-only action with no matching pack row", () => {
    const embedded = [
      {
        _id: "s1",
        type: "feat",
        name: "Spellstrike",
        system: { actionType: "action", actions: 2, slug: "spellstrike" },
      },
    ];
    const merged = mergeActionRows([], embedded);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.fromCharacter).toBe(true);
    expect(merged[0]?.cost.kind).toBe("2");
  });

  it("preserves the deduped pack row's uuid as fallbackUuid on the embedded row", () => {
    // Embedded Bon Mot has an EMPTY description (pre-r11 embed); the pack has
    // the same-slug action with the ORC/OGL description behind its uuid.
    const packBonMot = packEntry("Bon Mot", { "system.actionType": "action", "system.actions": 1 });
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot",
        system: { actionType: "action", actions: 1, slug: "bon-mot", description: "" },
      },
    ];
    const merged = mergeActionRows([packBonMot], embedded);
    const bonMot = merged.find((r) => r.slug === "bon-mot");
    expect(bonMot?.fromCharacter).toBe(true);
    expect(bonMot?.uuid).toBeNull();
    expect(bonMot?.fallbackUuid).toBe(packBonMot.uuid);
  });

  it("leaves fallbackUuid null for an embedded row with no matching pack row", () => {
    const embedded = [
      {
        _id: "ma1",
        type: "feat",
        name: "Magus's Analysis",
        system: { actionType: "action", actions: 1, slug: "maguss-analysis" },
      },
    ];
    const merged = mergeActionRows(
      [packEntry("Seek", { "system.actionType": "action", "system.actions": 1 })],
      embedded,
    );
    const analysis = merged.find((r) => r.fromCharacter);
    expect(analysis?.fallbackUuid).toBeNull();
  });

  it("leaves fallbackUuid null on plain pack rows (they already carry uuid)", () => {
    const merged = mergeActionRows(
      [packEntry("Seek", { "system.actionType": "action", "system.actions": 1 })],
      [],
    );
    expect(merged[0]?.fallbackUuid).toBeNull();
    expect(merged[0]?.uuid).not.toBeNull();
  });

  it("inherits the deduped pack row's pt-BR name onto the embedded (character) row", () => {
    // The embedded Bon Mot is EN of birth; the same-slug pack row carries the
    // translated name, so the character row should display it (T1).
    const packBonMot = packEntry(
      "Bon Mot",
      { "system.actionType": "action", "system.actions": 1 },
      "Bom Mot",
    );
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot",
        system: { actionType: "action", actions: 1, slug: "bon-mot" },
      },
    ];
    const merged = mergeActionRows([packBonMot], embedded);
    const bonMot = merged.find((r) => r.slug === "bon-mot");
    expect(bonMot?.fromCharacter).toBe(true);
    expect(bonMot?.namePt).toBe("Bom Mot");
    expect(bonMot?.nameEn).toBe("Bon Mot");
  });

  it("leaves the character row's namePt null when the deduped pack row is untranslated", () => {
    const packBonMot = packEntry("Bon Mot", { "system.actionType": "action", "system.actions": 1 });
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot",
        system: { actionType: "action", actions: 1, slug: "bon-mot" },
      },
    ];
    const merged = mergeActionRows([packBonMot], embedded);
    expect(merged.find((r) => r.slug === "bon-mot")?.namePt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildActionNameIndex + mergeActionRows enrichment (B1 r14 #4/#5) — character
// feats that ARE actions live in feats-core, not actions-core, so they need a
// supplementary index to resolve pt-BR name + description-fallback uuid.
// ---------------------------------------------------------------------------

/** A feats-core-shaped index entry (uuid points at feats-core, not actions-core). */
function featsPackEntry(name: string, namePt?: string): PackIndexEntry {
  return {
    _id: slugFromName(name),
    uuid: `Compendium.pf2e.feats-core.Item.${slugFromName(name)}`,
    name,
    img: null,
    type: "feat",
    index: {},
    ...(namePt !== undefined ? { namePt, i18n: { ptBR: { name: namePt } } } : {}),
  };
}

describe("buildActionNameIndex()", () => {
  it("indexes supplementary entries by name-slug with namePt + uuid", () => {
    const index = buildActionNameIndex([
      featsPackEntry("Magus's Analysis", "Análise do Magus"),
      featsPackEntry("Bon Mot", "Bon Mot"),
    ]);
    expect(index.get("magus-s-analysis")).toEqual({
      namePt: "Análise do Magus",
      fallbackUuid: "Compendium.pf2e.feats-core.Item.magus-s-analysis",
    });
    expect(index.get("bon-mot")?.namePt).toBe("Bon Mot");
  });

  it("leaves namePt null for an untranslated supplementary entry", () => {
    const index = buildActionNameIndex([featsPackEntry("Sudden Charge")]);
    expect(index.get("sudden-charge")).toEqual({
      namePt: null,
      fallbackUuid: "Compendium.pf2e.feats-core.Item.sudden-charge",
    });
  });

  it("first entry per slug wins (deterministic)", () => {
    const index = buildActionNameIndex([
      featsPackEntry("Bon Mot", "Primeira"),
      featsPackEntry("Bon Mot", "Segunda"),
    ]);
    expect(index.get("bon-mot")?.namePt).toBe("Primeira");
  });
});

describe("mergeActionRows() with feats-core enrichment", () => {
  // The real Tobias scenario: the embedded feat has NO system.slug (undefined),
  // so its slug is derived from the name; there is NO actions-core pack row for
  // it; the feats-core index supplies namePt + fallbackUuid.
  it("enriches a character feat (no actions-core row) with feats-core namePt + fallbackUuid", () => {
    const embedded = [
      {
        _id: "ma1",
        type: "feat",
        name: "Magus's Analysis",
        system: { actionType: "action", actions: 1 },
      },
    ];
    const nameIndex = buildActionNameIndex([
      featsPackEntry("Magus's Analysis", "Análise do Magus"),
    ]);
    const merged = mergeActionRows(
      [packEntry("Seek", { "system.actionType": "action", "system.actions": 1 })],
      embedded,
      nameIndex,
    );
    const analysis = merged.find((r) => r.fromCharacter);
    expect(analysis?.name).toBe("Magus's Analysis");
    expect(analysis?.namePt).toBe("Análise do Magus");
    expect(analysis?.fallbackUuid).toBe("Compendium.pf2e.feats-core.Item.magus-s-analysis");
  });

  it("still shows the EN subtitle for an identical pt-BR name (Bon Mot) via enrichment", () => {
    const embedded = [
      { _id: "bm1", type: "feat", name: "Bon Mot", system: { actionType: "action", actions: 1 } },
    ];
    const nameIndex = buildActionNameIndex([featsPackEntry("Bon Mot", "Bon Mot")]);
    const merged = mergeActionRows([], embedded, nameIndex);
    const bonMot = merged.find((r) => r.fromCharacter);
    expect(bonMot?.namePt).toBe("Bon Mot");
    expect(bonMot?.nameEn).toBe("Bon Mot");
    // A namePt (even identical) drives the "always both" render via actionRowNameParts.
    expect(bonMot?.fallbackUuid).toBe("Compendium.pf2e.feats-core.Item.bon-mot");
  });

  it("does NOT override an actions-core pack row's namePt/fallbackUuid (pack wins)", () => {
    const packBonMot = packEntry(
      "Bon Mot",
      { "system.actionType": "action", "system.actions": 1 },
      "Pack pt-BR",
    );
    const embedded = [
      { _id: "bm1", type: "feat", name: "Bon Mot", system: { actionType: "action", actions: 1 } },
    ];
    const nameIndex = buildActionNameIndex([featsPackEntry("Bon Mot", "Feats pt-BR")]);
    const merged = mergeActionRows([packBonMot], embedded, nameIndex);
    const bonMot = merged.find((r) => r.slug === "bon-mot");
    // actions-core row wins for BOTH fields.
    expect(bonMot?.namePt).toBe("Pack pt-BR");
    expect(bonMot?.fallbackUuid).toBe(packBonMot.uuid);
  });

  it("is a no-op when no nameIndex is passed (prior behavior preserved)", () => {
    const embedded = [
      {
        _id: "ma1",
        type: "feat",
        name: "Magus's Analysis",
        system: { actionType: "action", actions: 1 },
      },
    ];
    const merged = mergeActionRows([], embedded);
    const analysis = merged.find((r) => r.fromCharacter);
    expect(analysis?.namePt).toBeNull();
    expect(analysis?.fallbackUuid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildActionSourceIdIndex + mergeActionRows sourceId-primary matching
// (issue #42 — the persisted i18n bag is a cache, not the source of truth;
// re-resolving via `flags.fusion.sourceId` on every load heals an embedded
// item to the pack's CURRENT translation as packs keep getting translated).
// ---------------------------------------------------------------------------

function packEntryWithSourceId(name: string, sourceId: string, namePt?: string): PackIndexEntry {
  return {
    ...packEntry(name, { "flags.fusion.sourceId": sourceId }, namePt),
  };
}

describe("buildActionSourceIdIndex()", () => {
  it("indexes entries by flags.fusion.sourceId with namePt + uuid", () => {
    const entry = packEntryWithSourceId("Raise a Shield", "src-1", "Erguer Escudo");
    const index = buildActionSourceIdIndex([entry]);
    expect(index.get("src-1")).toEqual({ namePt: "Erguer Escudo", fallbackUuid: entry.uuid });
  });

  it("skips entries with no sourceId in the index bag", () => {
    const entry = packEntry("Seek", { "system.actionType": "action" });
    const index = buildActionSourceIdIndex([entry]);
    expect(index.size).toBe(0);
  });

  it("first entry per sourceId wins (deterministic)", () => {
    const index = buildActionSourceIdIndex([
      packEntryWithSourceId("Bon Mot", "src-x", "Primeira"),
      packEntryWithSourceId("Bon Mot Dup", "src-x", "Segunda"),
    ]);
    expect(index.get("src-x")?.namePt).toBe("Primeira");
  });
});

describe("mergeActionRows() with sourceId-primary enrichment (issue #42)", () => {
  it("resolves fallbackUuid/namePt via sourceId even when no slug matches any pack row", () => {
    // The embedded item's slug ("bon-mot-renamed") does NOT match any pack
    // row's slug — only its flags.fusion.sourceId does. Prior slug-only
    // matching would have left this row untranslated with no fallbackUuid.
    const packBonMot = packEntryWithSourceId("Bon Mot", "src-bonmot", "Bom Mot Atual");
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot Renamed",
        system: { actionType: "action", actions: 1, slug: "bon-mot-renamed" },
        flags: { fusion: { sourceId: "src-bonmot" } },
      },
    ];
    const sourceIdIndex = buildActionSourceIdIndex([packBonMot]);
    const merged = mergeActionRows([packBonMot], embedded, undefined, sourceIdIndex);
    const row = merged.find((r) => r.fromCharacter);
    expect(row?.namePt).toBe("Bom Mot Atual");
    expect(row?.fallbackUuid).toBe(packBonMot.uuid);
  });

  it("sourceId match wins over a same-slug pack row match", () => {
    // Two different pack docs: the SLUG-matched one carries a stale name, the
    // SOURCE-ID-matched one (a different uuid) carries the current one. The
    // embedded item's own sourceId must decide, not the slug dedup.
    const slugMatchedPack = packEntry(
      "Bon Mot",
      { "flags.fusion.sourceId": "src-other" },
      "Nome Via Slug (stale)",
    );
    const sourceIdMatchedPack = packEntryWithSourceId(
      "Bon Mot Atual",
      "src-real",
      "Nome Via SourceId (current)",
    );
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot",
        system: { actionType: "action", actions: 1, slug: "bon-mot" },
        flags: { fusion: { sourceId: "src-real" } },
      },
    ];
    const sourceIdIndex = buildActionSourceIdIndex([slugMatchedPack, sourceIdMatchedPack]);
    const merged = mergeActionRows([slugMatchedPack], embedded, undefined, sourceIdIndex);
    const row = merged.find((r) => r.fromCharacter);
    expect(row?.namePt).toBe("Nome Via SourceId (current)");
    expect(row?.fallbackUuid).toBe(sourceIdMatchedPack.uuid);
  });

  it("falls back to slug matching for an embedded item with no sourceId at all (homebrew)", () => {
    const packBonMot = packEntry(
      "Bon Mot",
      { "system.actionType": "action", "system.actions": 1 },
      "Bom Mot",
    );
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot",
        system: { actionType: "action", actions: 1, slug: "bon-mot" },
        // no flags.fusion.sourceId — homebrew/manual entry.
      },
    ];
    const sourceIdIndex = buildActionSourceIdIndex([packBonMot]);
    const merged = mergeActionRows([packBonMot], embedded, undefined, sourceIdIndex);
    const row = merged.find((r) => r.fromCharacter);
    expect(row?.namePt).toBe("Bom Mot");
    expect(row?.fallbackUuid).toBe(packBonMot.uuid);
  });

  it("combines actions-core + feats-core sourceId entries, actions-core winning on collision", () => {
    const actionsCoreEntry = packEntryWithSourceId("Bon Mot", "src-shared", "Da actions-core");
    const featsCoreEntry = featsPackEntry("Bon Mot", "Da feats-core");
    featsCoreEntry.index = { "flags.fusion.sourceId": "src-shared" };
    const combined = buildActionSourceIdIndex([actionsCoreEntry, featsCoreEntry]);
    expect(combined.get("src-shared")?.namePt).toBe("Da actions-core");
  });

  it("is a no-op when no sourceIdIndex is passed (prior slug-only behavior preserved)", () => {
    const packBonMot = packEntry(
      "Bon Mot",
      { "system.actionType": "action", "system.actions": 1 },
      "Bom Mot",
    );
    const embedded = [
      {
        _id: "bm1",
        type: "feat",
        name: "Bon Mot",
        system: { actionType: "action", actions: 1, slug: "bon-mot" },
        flags: { fusion: { sourceId: "src-real" } },
      },
    ];
    const merged = mergeActionRows([packBonMot], embedded);
    const row = merged.find((r) => r.fromCharacter);
    expect(row?.namePt).toBe("Bom Mot");
    expect(row?.fallbackUuid).toBe(packBonMot.uuid);
  });
});

// ---------------------------------------------------------------------------
// paginate — the "show more" arithmetic (r12 blocker: list capped at 60)
// ---------------------------------------------------------------------------

describe("paginate()", () => {
  const many = Array.from({ length: 521 }, (_, i) => i); // 521 actions in the pack

  it("caps the visible slice at PAGE_SIZE and flags there is more", () => {
    const p = paginate(many, ACTIONS_PAGE_SIZE);
    expect(ACTIONS_PAGE_SIZE).toBe(60);
    expect(p.visible).toHaveLength(60);
    expect(p.hasMore).toBe(true);
    expect(p.remaining).toBe(521 - 60);
  });

  it("reveals the next page when visibleCount is incremented (button works)", () => {
    const p1 = paginate(many, ACTIONS_PAGE_SIZE);
    const p2 = paginate(many, ACTIONS_PAGE_SIZE * 2);
    expect(p2.visible).toHaveLength(120);
    expect(p2.remaining).toBeLessThan(p1.remaining);
    expect(p2.hasMore).toBe(true);
  });

  it("lets the user reach EVERY row across successive increments", () => {
    let visibleCount = ACTIONS_PAGE_SIZE;
    let guard = 0;
    while (paginate(many, visibleCount).hasMore && guard < 100) {
      visibleCount += ACTIONS_PAGE_SIZE;
      guard += 1;
    }
    const final = paginate(many, visibleCount);
    expect(final.hasMore).toBe(false);
    expect(final.remaining).toBe(0);
    expect(final.visible).toHaveLength(many.length); // all 521 reachable
  });

  it("shows all rows and hides 'show more' when count >= length", () => {
    const p = paginate([1, 2, 3], 60);
    expect(p.visible).toEqual([1, 2, 3]);
    expect(p.hasMore).toBe(false);
    expect(p.remaining).toBe(0);
  });

  it("clamps a negative visibleCount to zero", () => {
    const p = paginate(many, -10);
    expect(p.visible).toHaveLength(0);
    expect(p.hasMore).toBe(true);
    expect(p.remaining).toBe(521);
  });

  it("handles an empty list", () => {
    const p = paginate<number>([], 60);
    expect(p.visible).toEqual([]);
    expect(p.hasMore).toBe(false);
    expect(p.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildEmbeddedDetailsDoc — character actions render their OWN description
// ---------------------------------------------------------------------------

describe("descriptionHtmlOf()", () => {
  it("passes through a flattened string description", () => {
    expect(descriptionHtmlOf({ description: "<p>Hit them.</p>" })).toBe("<p>Hit them.</p>");
  });

  it("unwraps the vendor {value} description wrapper", () => {
    expect(descriptionHtmlOf({ description: { value: "<p>Cast it.</p>" } })).toBe(
      "<p>Cast it.</p>",
    );
  });

  it("returns empty string when the description is missing or non-textual", () => {
    expect(descriptionHtmlOf({})).toBe("");
    expect(descriptionHtmlOf({ description: 42 })).toBe("");
    expect(descriptionHtmlOf({ description: { value: null } })).toBe("");
  });
});

describe("buildEmbeddedDetailsDoc()", () => {
  it("builds a panel doc from an embedded item, preserving name/type/system", () => {
    const item = {
      _id: "abc",
      type: "feat",
      name: "Bon Mot",
      system: {
        actionType: "action",
        actions: 1,
        description: "<p>Sling an insult.</p>",
        traits: { value: ["auditory"] },
      },
    };
    const doc = buildEmbeddedDetailsDoc(item);
    expect(doc).not.toBeNull();
    expect(doc?.["name"]).toBe("Bon Mot");
    expect(doc?.["type"]).toBe("feat");
    const system = doc?.["system"] as Record<string, unknown>;
    expect(system["description"]).toBe("<p>Sling an insult.</p>"); // string, panel-sanitizable
    expect(system["actions"]).toBe(1); // mechanical fields preserved for the panel
  });

  it("normalizes a {value}-wrapped description to a plain string", () => {
    const doc = buildEmbeddedDetailsDoc({
      _id: "x",
      type: "action",
      name: "Spellstrike",
      system: { description: { value: "<p>Channel a spell.</p>" } },
    });
    expect((doc?.["system"] as Record<string, unknown>)["description"]).toBe(
      "<p>Channel a spell.</p>",
    );
  });

  it("does not mutate the original item's system object", () => {
    const item = {
      _id: "y",
      type: "action",
      name: "Foo",
      system: { description: { value: "<p>x</p>" } },
    };
    buildEmbeddedDetailsDoc(item);
    // Original wrapper is untouched (we clone system before normalizing).
    expect(item.system.description).toEqual({ value: "<p>x</p>" });
  });

  it("falls back to defaults for a description-less item and empty system", () => {
    const doc = buildEmbeddedDetailsDoc({ _id: "z", type: "action", name: "Bare" });
    expect((doc?.["system"] as Record<string, unknown>)["description"]).toBe("");
  });

  it("returns null for a non-record input", () => {
    expect(buildEmbeddedDetailsDoc(null)).toBeNull();
    expect(buildEmbeddedDetailsDoc(undefined)).toBeNull();
  });

  // Issue #10: the persisted i18n bag was silently dropped, so an item with a
  // correctly persisted pt-BR description still rendered EN in the panel.
  it("preserves a persisted i18n bag (issue #10)", () => {
    const item = {
      _id: "abc",
      type: "feat",
      name: "Bon Mot",
      system: { actionType: "action", actions: 1, description: "<p>Sling an insult.</p>" },
      i18n: { ptBR: { name: "Bom Mot", description: "<p>Insultar.</p>" } },
    };
    const doc = buildEmbeddedDetailsDoc(item);
    expect(doc?.["i18n"]).toEqual({ ptBR: { name: "Bom Mot", description: "<p>Insultar.</p>" } });
  });

  it("omits the i18n key entirely when the item carries none", () => {
    const doc = buildEmbeddedDetailsDoc({ _id: "z", type: "action", name: "Bare" });
    expect(doc).not.toHaveProperty("i18n");
  });

  it("ignores a non-record i18n value on the item", () => {
    const doc = buildEmbeddedDetailsDoc({ _id: "w", type: "action", name: "Weird", i18n: "nope" });
    expect(doc).not.toHaveProperty("i18n");
  });
});

// ---------------------------------------------------------------------------
// mergeEmbeddedNameOverlay — merge (not overwrite) the i18n bag (issue #10)
// ---------------------------------------------------------------------------

describe("mergeEmbeddedNameOverlay()", () => {
  it("returns the doc unchanged when there is nothing to merge", () => {
    const doc = { name: "Bon Mot", system: {} };
    expect(mergeEmbeddedNameOverlay(doc, null)).toBe(doc);
  });

  it("returns null unchanged", () => {
    expect(mergeEmbeddedNameOverlay(null, "Bom Mot")).toBeNull();
  });

  it("fills in i18n.ptBR.name when the doc has no persisted bag", () => {
    const doc = { name: "Bon Mot", system: {} };
    const merged = mergeEmbeddedNameOverlay(doc, "Bom Mot");
    expect(merged?.["i18n"]).toEqual({ ptBR: { name: "Bom Mot" } });
  });

  it("MERGES into an already-persisted bag, keeping the description (issue #10 core bug)", () => {
    // The prior implementation replaced the whole bag with {ptBR:{name}},
    // wiping out a persisted description whenever the slug match provided a
    // namePt — this is the exact regression the fix targets.
    const doc = {
      name: "Bon Mot",
      system: {},
      i18n: { ptBR: { description: "<p>Insultar.</p>" } },
    };
    const merged = mergeEmbeddedNameOverlay(doc, "Bom Mot");
    expect(merged?.["i18n"]).toEqual({
      ptBR: { name: "Bom Mot", description: "<p>Insultar.</p>" },
    });
  });

  it("keeps a persisted name over the enrichment namePt (persisted bag wins)", () => {
    const doc = {
      name: "Bon Mot",
      system: {},
      i18n: { ptBR: { name: "Nome Persistido", description: "<p>x</p>" } },
    };
    const merged = mergeEmbeddedNameOverlay(doc, "Nome do Slug");
    expect(merged?.["i18n"]).toEqual({
      ptBR: { name: "Nome Persistido", description: "<p>x</p>" },
    });
  });
});

// ---------------------------------------------------------------------------
// needsFallbackDescription — heal-on-read decision for empty embedded descs
// ---------------------------------------------------------------------------

describe("needsFallbackDescription()", () => {
  it("is true when the details doc has no/empty/whitespace description", () => {
    expect(
      needsFallbackDescription(buildEmbeddedDetailsDoc({ _id: "a", type: "action", name: "Bare" })),
    ).toBe(true);
    expect(needsFallbackDescription({ system: { description: "" } })).toBe(true);
    expect(needsFallbackDescription({ system: { description: "   \n  " } })).toBe(true);
    // Bare markup with no text content counts as empty.
    expect(needsFallbackDescription({ system: { description: "<p></p>" } })).toBe(true);
    expect(needsFallbackDescription({ system: { description: "<p>&nbsp;</p>" } })).toBe(true);
  });

  it("is true for a null/non-record doc or a doc with no system", () => {
    expect(needsFallbackDescription(null)).toBe(true);
    expect(needsFallbackDescription(undefined)).toBe(true);
    expect(needsFallbackDescription({})).toBe(true);
  });

  it("is false when the description has real text content", () => {
    expect(needsFallbackDescription({ system: { description: "<p>Sling an insult.</p>" } })).toBe(
      false,
    );
    expect(needsFallbackDescription({ system: { description: "Plain text" } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withFallbackDescription — splice pack description into the embedded doc
// ---------------------------------------------------------------------------

describe("withFallbackDescription()", () => {
  it("splices the pack doc's description while keeping the embedded identity", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "bm",
      type: "feat",
      name: "Bon Mot",
      system: {
        actionType: "action",
        actions: 1,
        description: "",
        traits: { value: ["auditory"] },
      },
    });
    const packDoc = {
      name: "Bon Mot",
      type: "action",
      system: { description: "<p>Sling an insult.</p>" },
    };
    const merged = withFallbackDescription(embedded, packDoc);
    expect(merged?.["name"]).toBe("Bon Mot"); // embedded identity kept
    expect(merged?.["type"]).toBe("feat");
    const system = merged?.["system"] as Record<string, unknown>;
    expect(system["description"]).toBe("<p>Sling an insult.</p>"); // pack description
    expect(system["actions"]).toBe(1); // embedded mechanical fields kept
  });

  it("unwraps a {value}-wrapped pack description", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "x",
      type: "action",
      name: "Foo",
      system: { description: "" },
    });
    const packDoc = { system: { description: { value: "<p>Wrapped.</p>" } } };
    const merged = withFallbackDescription(embedded, packDoc);
    expect((merged?.["system"] as Record<string, unknown>)["description"]).toBe("<p>Wrapped.</p>");
  });

  it("returns the embedded doc unchanged when the pack doc has no description", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "y",
      type: "action",
      name: "Foo",
      system: { description: "" },
    });
    expect(withFallbackDescription(embedded, { system: {} })).toBe(embedded);
    expect(withFallbackDescription(embedded, null)).toBe(embedded);
  });

  it("does not mutate the embedded doc's system", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "z",
      type: "action",
      name: "Foo",
      system: { description: "" },
    });
    const before = (embedded?.["system"] as Record<string, unknown>)["description"];
    withFallbackDescription(embedded, { system: { description: "<p>new</p>" } });
    expect((embedded?.["system"] as Record<string, unknown>)["description"]).toBe(before);
  });

  it("returns the input unchanged for a non-record embedded doc", () => {
    expect(withFallbackDescription(null, { system: { description: "<p>x</p>" } })).toBeNull();
  });

  it("prefers the pack doc's pt-BR description on the pt-BR locale (T1)", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "bm",
      type: "feat",
      name: "Bon Mot",
      system: { description: "" },
    });
    const packDoc = {
      name: "Bon Mot",
      type: "action",
      system: { description: "<p>Sling an insult.</p>" },
      i18n: { ptBR: { name: "Bom Mot", description: "<p>Lance um insulto.</p>" } },
    };
    const merged = withFallbackDescription(embedded, packDoc, "pt-BR");
    expect((merged?.["system"] as Record<string, unknown>)["description"]).toBe(
      "<p>Lance um insulto.</p>",
    );
  });

  it("uses the EN pack description on the 'en' locale even when a pt-BR translation exists", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "bm",
      type: "feat",
      name: "Bon Mot",
      system: { description: "" },
    });
    const packDoc = {
      system: { description: "<p>Sling an insult.</p>" },
      i18n: { ptBR: { description: "<p>Lance um insulto.</p>" } },
    };
    const merged = withFallbackDescription(embedded, packDoc, "en");
    expect((merged?.["system"] as Record<string, unknown>)["description"]).toBe(
      "<p>Sling an insult.</p>",
    );
  });

  it("falls back to the EN pack description when no pt-BR translation exists (pt-BR locale)", () => {
    const embedded = buildEmbeddedDetailsDoc({
      _id: "bm",
      type: "feat",
      name: "Bon Mot",
      system: { description: "" },
    });
    const packDoc = { system: { description: "<p>Sling an insult.</p>" } };
    const merged = withFallbackDescription(embedded, packDoc, "pt-BR");
    expect((merged?.["system"] as Record<string, unknown>)["description"]).toBe(
      "<p>Sling an insult.</p>",
    );
  });
});

// ---------------------------------------------------------------------------
// fusionCategoryOf — raw fine-grained folder axis for the relevance filter
// ---------------------------------------------------------------------------

describe("fusionCategoryOf()", () => {
  it("reads system.fusionCategory lower-cased", () => {
    expect(fusionCategoryOf({ system: { fusionCategory: "Class" } })).toBe("class");
    expect(fusionCategoryOf({ system: { fusionCategory: "heritage" } })).toBe("heritage");
  });

  it("falls back to legacy re-injection sites", () => {
    expect(fusionCategoryOf({ flags: { fusion: { actionFolder: "archetype" } } })).toBe(
      "archetype",
    );
    expect(fusionCategoryOf({ system: { actionFolder: "skill" } })).toBe("skill");
  });

  it("returns null when absent", () => {
    expect(fusionCategoryOf({ system: {} })).toBeNull();
    expect(fusionCategoryOf({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterActionRows
// ---------------------------------------------------------------------------

function row(
  partial: Partial<ActionRow> & { name: string; slug: string; group: ActionGroup },
): ActionRow {
  return {
    key: partial.key ?? partial.slug,
    uuid: partial.uuid ?? null,
    fallbackUuid: partial.fallbackUuid ?? null,
    slug: partial.slug,
    name: partial.name,
    nameEn: partial.nameEn ?? partial.name,
    namePt: partial.namePt ?? null,
    group: partial.group,
    cost: partial.cost ?? { kind: "1", glyphs: "◆" },
    traits: partial.traits ?? [],
    fusionCategory: partial.fusionCategory ?? null,
    fromCharacter: partial.fromCharacter ?? false,
    isImpulse: partial.isImpulse ?? false,
  };
}

describe("filterActionRows()", () => {
  const rows: ActionRow[] = [
    row({ name: "Seek", slug: "seek", group: "basic", cost: { kind: "1", glyphs: "◆" } }),
    row({
      name: "Demoralize",
      slug: "demoralize",
      group: "skill",
      cost: { kind: "1", glyphs: "◆" },
    }),
    row({ name: "Aid", slug: "aid", group: "basic", cost: { kind: "reaction", glyphs: "⟳" } }),
    row({
      name: "Battle Medicine",
      slug: "battle-medicine",
      group: "skill",
      cost: { kind: "1", glyphs: "◆" },
    }),
    row({
      name: "Investigate",
      slug: "investigate",
      group: "exploration",
      cost: { kind: "unknown", glyphs: "" },
    }),
  ];

  it("shows all rows with the default filter state", () => {
    expect(filterActionRows(rows, defaultFilterState())).toHaveLength(rows.length);
  });

  it("hides rows whose group is disabled", () => {
    const f = defaultFilterState();
    f.groups.delete("skill");
    const out = filterActionRows(rows, f);
    expect(out.map((r) => r.slug)).not.toContain("demoralize");
    expect(out.map((r) => r.slug)).not.toContain("battle-medicine");
  });

  it("applies a cost filter (reaction only)", () => {
    const f = defaultFilterState();
    f.costs = new Set<ActionCostFilter>(["reaction"]);
    const out = filterActionRows(rows, f);
    expect(out.map((r) => r.slug)).toEqual(["aid"]);
  });

  it("excludes unknown/passive cost rows when any cost filter is active", () => {
    const f = defaultFilterState();
    f.costs = new Set<ActionCostFilter>(["1"]);
    const out = filterActionRows(rows, f);
    expect(out.map((r) => r.slug)).not.toContain("investigate");
  });

  it("searches by name accent/case-insensitively", () => {
    const f = defaultFilterState();
    f.search = "SEEK";
    expect(filterActionRows(rows, f).map((r) => r.slug)).toEqual(["seek"]);
    const f2 = defaultFilterState();
    f2.search = "medicine";
    expect(filterActionRows(rows, f2).map((r) => r.slug)).toEqual(["battle-medicine"]);
  });

  it("matches the pt-BR name as well as the EN name (bilingual search, T1)", () => {
    const bilingual: ActionRow[] = [
      row({
        name: "Raise a Shield",
        slug: "raise-a-shield",
        group: "basic",
        namePt: "Erguer Escudo",
      }),
      row({ name: "Seek", slug: "seek", group: "basic" }),
    ];
    // Portuguese query hits the pt-BR name...
    const fPt = defaultFilterState();
    fPt.search = "erguer";
    expect(filterActionRows(bilingual, fPt).map((r) => r.slug)).toEqual(["raise-a-shield"]);
    // ...and accent-insensitively.
    const fAccent = defaultFilterState();
    fAccent.search = "ESCUDO";
    expect(filterActionRows(bilingual, fAccent).map((r) => r.slug)).toEqual(["raise-a-shield"]);
    // The English name still matches the same row.
    const fEn = defaultFilterState();
    fEn.search = "shield";
    expect(filterActionRows(bilingual, fEn).map((r) => r.slug)).toEqual(["raise-a-shield"]);
  });
});

// ---------------------------------------------------------------------------
// sortActionRows
// ---------------------------------------------------------------------------

describe("sortActionRows()", () => {
  it("floats character actions to the top, then sorts alphabetically", () => {
    const rows: ActionRow[] = [
      row({ name: "Zephyr", slug: "zephyr", group: "basic" }),
      row({ name: "Alpha", slug: "alpha", group: "basic" }),
      row({ name: "Beta", slug: "beta", group: "class", fromCharacter: true }),
      row({ name: "Aardvark", slug: "aardvark", group: "class", fromCharacter: true }),
    ];
    const sorted = sortActionRows(rows);
    expect(sorted.map((r) => r.name)).toEqual(["Aardvark", "Beta", "Alpha", "Zephyr"]);
  });
});

// ---------------------------------------------------------------------------
// classifyLoadError
// ---------------------------------------------------------------------------

describe("classifyLoadError()", () => {
  it("maps SocketUnavailableError to not-connected", () => {
    expect(classifyLoadError(new SocketUnavailableError())).toBe("not-connected");
  });

  it("maps any other error to load", () => {
    expect(classifyLoadError(new Error("boom"))).toBe("load");
    expect(classifyLoadError("nope")).toBe("load");
  });
});

// ---------------------------------------------------------------------------
// Character relevance filter — deriveCharacterProfile / isActionRelevant /
// filterRelevantRows. Scenario: a Magus + Ratfolk with an Alchemist Dedication.
// ---------------------------------------------------------------------------

/** A Magus / Ratfolk character carrying an Alchemist Dedication feat. */
const magusRatfolkItems: Array<Record<string, unknown>> = [
  { _id: "cls", type: "class", name: "Magus", system: {} },
  { _id: "anc", type: "ancestry", name: "Ratfolk", system: {} },
  {
    _id: "ded",
    type: "feat",
    name: "Alchemist Dedication",
    system: { actionType: "passive", traits: { value: ["archetype", "dedication", "multiclass"] } },
  },
];

describe("deriveCharacterProfile()", () => {
  it("collects class, ancestry/heritage, and archetype-dedication slugs", () => {
    const p = deriveCharacterProfile(magusRatfolkItems);
    expect([...p.classSlugs]).toEqual(["magus"]);
    expect([...p.ancestrySlugs]).toEqual(["ratfolk"]);
    expect([...p.archetypeSlugs]).toEqual(["alchemist"]);
  });

  it("reads heritage items into the ancestry slug set", () => {
    const p = deriveCharacterProfile([{ _id: "h", type: "heritage", name: "Sylph", system: {} }]);
    expect([...p.ancestrySlugs]).toEqual(["sylph"]);
  });

  it("ignores non-dedication feats for the archetype set", () => {
    const p = deriveCharacterProfile([
      { _id: "f", type: "feat", name: "Toughness", system: { traits: { value: ["general"] } } },
    ]);
    expect(p.archetypeSlugs.size).toBe(0);
  });

  it("returns empty sets for an item-less character", () => {
    const p = deriveCharacterProfile([]);
    expect(p.classSlugs.size).toBe(0);
    expect(p.ancestrySlugs.size).toBe(0);
    expect(p.archetypeSlugs.size).toBe(0);
  });
});

describe("isActionRelevant()", () => {
  const profile = deriveCharacterProfile(magusRatfolkItems);

  const packRow = (
    partial: Partial<ActionRow> & {
      name: string;
      group: ActionGroup;
      fusionCategory: string | null;
    },
  ): ActionRow => row({ slug: slugFromName(partial.name), ...partial });

  it("always shows embedded character actions (Magus's Analysis)", () => {
    const analysis = packRow({
      name: "Magus's Analysis",
      group: "class",
      fusionCategory: "class",
      traits: [],
      fromCharacter: true,
    });
    expect(isActionRelevant(analysis, profile)).toBe(true);
  });

  it("always shows universal categories (basic/skill/exploration/downtime/equipment)", () => {
    for (const fc of ["basic", "skill", "exploration", "downtime", "equipment"]) {
      const r = packRow({ name: `Uni ${fc}`, group: "basic", fusionCategory: fc });
      expect(isActionRelevant(r, profile)).toBe(true);
    }
  });

  it("shows a class action only when a trait matches the character's class (Arcane Cascade)", () => {
    const arcaneCascade = packRow({
      name: "Arcane Cascade",
      group: "class",
      fusionCategory: "class",
      traits: ["concentrate", "magus", "stance"],
    });
    expect(isActionRelevant(arcaneCascade, profile)).toBe(true);

    // A different class's action (barbarian) is not relevant.
    const mightyRage = packRow({
      name: "Mighty Rage",
      group: "class",
      fusionCategory: "class",
      traits: ["barbarian"],
    });
    expect(isActionRelevant(mightyRage, profile)).toBe(false);
  });

  it("hides class/archetype actions that carry NO class/archetype trait (no confident match)", () => {
    // "A Challenge for Heroes" (class) — traits carry no class slug.
    const challenge = packRow({
      name: "A Challenge for Heroes",
      group: "class",
      fusionCategory: "class",
      traits: ["concentrate", "mental", "spirit", "transcendence"],
    });
    expect(isActionRelevant(challenge, profile)).toBe(false);

    // "Blazing Conflagration" (archetype) — traits carry no archetype slug.
    const blazing = packRow({
      name: "Blazing Conflagration",
      group: "archetype",
      fusionCategory: "archetype",
      traits: ["fire", "healing", "light", "visual"],
    });
    expect(isActionRelevant(blazing, profile)).toBe(false);
  });

  it("shows an archetype action whose trait matches a character archetype slug", () => {
    const alchemistArch = packRow({
      name: "Some Alchemist Trick",
      group: "archetype",
      fusionCategory: "archetype",
      traits: ["alchemist"],
    });
    expect(isActionRelevant(alchemistArch, profile)).toBe(true);
  });

  it("shows an ancestry/heritage action only when its trait matches the character's ancestry", () => {
    const ratfolkAction = packRow({
      name: "Rat Scurry",
      group: "ancestry",
      fusionCategory: "ancestry",
      traits: ["ratfolk"],
    });
    expect(isActionRelevant(ratfolkAction, profile)).toBe(true);

    const anadiAction = packRow({
      name: "Anadi Venom",
      group: "ancestry",
      fusionCategory: "ancestry",
      traits: ["anadi"],
    });
    expect(isActionRelevant(anadiAction, profile)).toBe(false);

    // heritage-category action matches against the same ancestry slug set.
    const sylphAction = packRow({
      name: "Smoke Blending",
      group: "ancestry",
      fusionCategory: "heritage",
      traits: ["sylph"],
    });
    expect(isActionRelevant(sylphAction, profile)).toBe(false); // char is ratfolk, not sylph
  });

  it("hides default-hidden and unknown categories (background/familiar/spells/stamina/mythic/null)", () => {
    for (const fc of ["background", "familiar", "spells", "stamina", "mythic", null]) {
      const r = packRow({ name: `Hidden ${fc}`, group: "other", fusionCategory: fc });
      expect(isActionRelevant(r, profile)).toBe(false);
    }
  });

  it("shows an impulse row to a Kineticist, but not to a non-Kineticist (r19-W3)", () => {
    const kineticistProfile = deriveCharacterProfile([
      { _id: "k", type: "class", name: "Kineticist", system: {} },
    ]);
    const impulseRow = packRow({
      name: "Aerial Boomerang",
      group: "class",
      fusionCategory: "class",
      traits: ["air", "impulse", "kineticist", "primal"],
      isImpulse: true,
    });
    expect(isActionRelevant(impulseRow, kineticistProfile)).toBe(true);
    // The Magus (magusRatfolkItems profile) has no kineticist class and the row
    // carries no magus trait, so the impulse clause does not fire.
    expect(isActionRelevant(impulseRow, profile)).toBe(false);
  });
});

describe("filterRelevantRows()", () => {
  const profile = deriveCharacterProfile(magusRatfolkItems);

  const rows: ActionRow[] = [
    row({ name: "Seek", slug: "seek", group: "basic", fusionCategory: "basic" }),
    row({
      name: "Arcane Cascade",
      slug: "arcane-cascade",
      group: "class",
      fusionCategory: "class",
      traits: ["magus"],
    }),
    row({
      name: "Mighty Rage",
      slug: "mighty-rage",
      group: "class",
      fusionCategory: "class",
      traits: ["barbarian"],
    }),
    row({
      name: "Blazing Conflagration",
      slug: "blazing-conflagration",
      group: "archetype",
      fusionCategory: "archetype",
      traits: ["fire"],
    }),
    row({
      name: "Magus's Analysis",
      slug: "maguss-analysis",
      group: "class",
      fusionCategory: "class",
      traits: [],
      fromCharacter: true,
    }),
  ];

  it("keeps only relevant rows by default (magus sees Analysis & Arcane Cascade, not Blazing/Rage)", () => {
    const out = filterRelevantRows(rows, profile, false).map((r) => r.slug);
    expect(out).toContain("maguss-analysis");
    expect(out).toContain("arcane-cascade");
    expect(out).toContain("seek");
    expect(out).not.toContain("blazing-conflagration");
    expect(out).not.toContain("mighty-rage");
  });

  it("reveals every row when showAll is true", () => {
    const out = filterRelevantRows(rows, profile, true);
    expect(out).toHaveLength(rows.length);
    expect(out.map((r) => r.slug)).toContain("blazing-conflagration");
    expect(out.map((r) => r.slug)).toContain("mighty-rage");
  });
});
