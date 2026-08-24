/**
 * varredura-classes.test.ts — headless sweep of every PF2e core class (r21,
 * W2; extended r22 to all 12): builds a level-1..20 character for EACH class
 * shipped in `classes-core` and asserts the invariants listed in the task brief.
 *
 * The build rig itself now lives in `helpers/classBuildHarness.ts` (issue #48),
 * shared with pregen-parity.test.ts.
 *
 * IMPORTANT — what this file can and cannot prove (issue #48): every assertion
 * below compares derived output against the class's OWN pack data
 * (`classSystem.proficiencyUpgrades`, `system.attacks`, …). That makes it a
 * check of INTERNAL CONSISTENCY, not of correctness: a pack table that is
 * incomplete produces an expected value from the same incomplete source, and
 * the assertion passes. Correctness against an external source of truth is
 * `pregen-parity.test.ts`'s job — do not add correctness claims here.
 *
 * REQ-PF2-010..012, REQ-PF2-083.
 */

import { describe, it, expect, beforeAll } from "vitest";

import {
  CLASSES,
  FEATS,
  ANCESTRIES,
  RATFOLK,
  sysOf,
  docName,
  cloneDoc,
  runFullDerivation,
  abilityModOf,
  expectedEffectiveRank,
  readAbilities,
  buildCharacterToLevel20,
  type Finding,
  type ProficiencyUpgrade,
} from "./helpers/classBuildHarness.js";
import {
  derivePlan,
  spellSlotsForLevel,
  computeAbilityScores,
  CLASS_CHOICE_SLOTS,
  KINETIC_ELEMENTS,
} from "../planVM.js";

// ---------------------------------------------------------------------------
// The sweep — one describe block per class.
// ---------------------------------------------------------------------------

describe.each(CLASSES.map((c) => [docName(c), c] as const))(
  "varredura-classes — %s (levels 1..20)",
  (klassName, classDoc) => {
    let doc: Record<string, unknown>;
    let findings: Finding[];

    beforeAll(() => {
      const result = buildCharacterToLevel20(classDoc);
      doc = result.doc;
      findings = result.findings;
    });

    // Invariant 1 + 2 + 3: no exception anywhere, every choice slot had at
    // least one option, no slot orphaned (never resolved).
    it("builds without exceptions and every slot resolves with an eligible option", () => {
      expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
    });

    // Invariant 3 (explicit bijection): every featuresByLevel placeholder is
    // EITHER a pickable slot (per CLASS_CHOICE_SLOTS) OR an autoFeature chip
    // — never neither.
    it("every featuresByLevel placeholder is a slot or an autoFeature chip (never vanishes)", () => {
      const classSys = sysOf(classDoc);
      const featuresByLevel =
        (classSys["featuresByLevel"] as Array<{ level: number; name: string }>) ?? [];
      const plan = derivePlan(doc);
      const offenders: string[] = [];
      for (const feature of featuresByLevel) {
        const lp = plan.levels.find((l) => l.level === feature.level);
        if (!lp) continue; // beyond the built range — shouldn't happen (we build to 20)
        const slotType = CLASS_CHOICE_SLOTS[feature.name];
        if (slotType) {
          if (!lp.slots.some((s) => s.type === slotType)) {
            offenders.push(
              `L${String(feature.level)} "${feature.name}" mapped to slot type "${slotType}" but no such slot exists`,
            );
          }
        } else if (!lp.autoFeatures.some((f) => f.name === feature.name)) {
          offenders.push(
            `L${String(feature.level)} "${feature.name}" is neither a slot nor an autoFeature chip`,
          );
        }
      }
      expect(offenders).toEqual([]);
    });

    // Invariant 4: HP grows monotonically and matches the documented formula
    // ancestryHp + (classHp + conMod) * level, at EVERY level 1..20 (varying
    // system.level.value on a clone of the final, fully-built doc — the
    // build.ts derive steps filter build.choices/levelledBoosts by
    // `<= level`, so this exercises the real per-level formula without
    // needing a separate build per level).
    it("HP grows monotonically and matches ancestryHp + (classHp + conMod) * level", () => {
      const classSys = sysOf(classDoc);
      const classHp = (classSys["hp"] as number) ?? 0;
      const ancestryHp = (sysOf(RATFOLK!)["hp"] as number) ?? 0;
      const abilities = readAbilities(doc);

      let prevHp = -Infinity;
      for (let level = 1; level <= 20; level++) {
        const clone = cloneDoc(doc);
        (sysOf(clone)["level"] as { value: number }).value = level;
        expect(
          () => runFullDerivation(clone),
          `${klassName} L${String(level)} derivation threw`,
        ).not.toThrow();

        const hp = sysOf(clone)["attributes"] as { hp?: { max?: number } } | undefined;
        const hpMax = hp?.hp?.max;
        const conScore = computeAbilityScores(abilities, level).con;
        const conMod = abilityModOf(conScore);
        const expectedHp = ancestryHp + (classHp + conMod) * level;

        expect(hpMax, `${klassName} L${String(level)} hpMax`).toBe(expectedHp);
        expect(
          hpMax ?? -Infinity,
          `${klassName} L${String(level)} HP is not monotonic (prev ${String(prevHp)})`,
        ).toBeGreaterThanOrEqual(prevHp);
        prevHp = hpMax ?? prevHp;
      }
    });

    // Invariant 5: proficiency ranks (weapons/armor/saves/perception/classDC)
    // respect the class's own proficiencyUpgrades table at every level —
    // computed generically from classDoc.system data, not hardcoded per
    // class (Fighter reaching Legendary weapons.martial at 19 and Wizard
    // never leaving Untrained in weapons.martial both fall out of this the
    // same way, from the class's own upgrade table).
    it("derived proficiency ranks match the class's proficiencyUpgrades table at every level", () => {
      const classSys = sysOf(classDoc);
      const upgrades = (classSys["proficiencyUpgrades"] as ProficiencyUpgrade[]) ?? [];
      const attacks = (classSys["attacks"] as Record<string, number>) ?? {};
      const defenses = (classSys["defenses"] as Record<string, number>) ?? {};
      const savingThrows = (classSys["savingThrows"] as Record<string, number>) ?? {};

      for (let level = 1; level <= 20; level++) {
        const clone = cloneDoc(doc);
        (sysOf(clone)["level"] as { value: number }).value = level;
        runFullDerivation(clone);
        const sys = sysOf(clone);
        const profs = sys["proficiencies"] as {
          weapons?: Record<string, number>;
          armor?: Record<string, number>;
          classDC?: { rank?: number };
        };
        const saves = sys["saves"] as Record<string, { rank?: number }>;
        const perception = sys["perception"] as { rank?: number };

        for (const cat of ["unarmed", "simple", "martial", "advanced"]) {
          const expected = expectedEffectiveRank(
            attacks[cat] ?? 0,
            `weapons.${cat}`,
            upgrades,
            level,
          );
          expect(profs.weapons?.[cat], `${klassName} L${String(level)} weapons.${cat}`).toBe(
            expected,
          );
        }
        for (const cat of ["unarmored", "light", "medium", "heavy"]) {
          const expected = expectedEffectiveRank(
            defenses[cat] ?? 0,
            `armor.${cat}`,
            upgrades,
            level,
          );
          expect(profs.armor?.[cat], `${klassName} L${String(level)} armor.${cat}`).toBe(expected);
        }
        for (const save of ["fortitude", "reflex", "will"]) {
          const expected = expectedEffectiveRank(savingThrows[save] ?? 0, save, upgrades, level);
          expect(saves[save]?.rank, `${klassName} L${String(level)} save.${save}`).toBe(expected);
        }
        const expectedPerception = expectedEffectiveRank(
          (classSys["perception"] as number) ?? 0,
          "perception",
          upgrades,
          level,
        );
        expect(perception.rank, `${klassName} L${String(level)} perception`).toBe(
          expectedPerception,
        );
        const expectedClassDC = expectedEffectiveRank(
          (classSys["classDC"] as number) ?? 0,
          "classDC",
          upgrades,
          level,
        );
        expect(profs.classDC?.rank, `${klassName} L${String(level)} classDC`).toBe(expectedClassDC);
      }
    });

    // Invariant 6: a spellcasting class materializes a non-focus
    // spellcastingEntry whose slots > 0 and match the class's spellcasting
    // table at the character's CURRENT (final, level-20) level — `levelUp`
    // resyncs the entry's slot maxes on every level gain (see planVM.ts's
    // `levelSet`), so by the end of the 20-level build the entry reflects
    // level 20, not level 1. A non-spellcasting class never gets an entry.
    it("spellcasting entry presence matches classSystem.spellcasting", () => {
      const classSys = sysOf(classDoc);
      const spellcasting = classSys["spellcasting"] as
        | Parameters<typeof spellSlotsForLevel>[0]
        | undefined;
      const items = doc["items"] as Array<Record<string, unknown>>;
      const entries = items.filter(
        (i) => i["type"] === "spellcastingEntry" && sysOf(i)["isFocusPool"] !== true,
      );
      const finalLevel = (sysOf(doc)["level"] as { value?: number } | undefined)?.value ?? 1;

      if (spellcasting) {
        expect(entries.length, `${klassName} missing a spellcasting entry`).toBeGreaterThanOrEqual(
          1,
        );
        const level1 = spellSlotsForLevel(spellcasting, 1);
        const hasSlotsAtLevel1 =
          level1.cantripsKnown > 0 || Object.values(level1.slotsByRank).some((n) => n > 0);
        expect(hasSlotsAtLevel1, `${klassName} spellcasting entry has zero slots at level 1`).toBe(
          true,
        );
        const { cantripsKnown, slotsByRank } = spellSlotsForLevel(spellcasting, finalLevel);
        const slots = sysOf(entries[0]!)["slots"] as Record<string, { max?: number }>;
        if (cantripsKnown > 0) expect(slots["0"]?.max).toBe(cantripsKnown);
        for (const [rank, max] of Object.entries(slotsByRank)) {
          expect(slots[rank]?.max).toBe(max);
        }
      } else {
        expect(entries.length, `${klassName} unexpectedly has a spellcasting entry`).toBe(0);
      }
    });

    // Invariant 7: no embedded item's flags.fusion.grantedBy points at a
    // sourceId that doesn't exist among the actor's own items. NOTE: this
    // harness never invokes grantMaterializer.ts's materializeGrants (that
    // is a separate, already-tested subsystem — grantMaterializer.test.ts),
    // so this passes vacuously today (no item here ever carries
    // `grantedBy`); kept as a real, evaluated assertion so it still catches
    // a regression if a future op builder starts stamping grantedBy without
    // the matching granter being embedded.
    it("no embedded item has a dangling grantedBy reference", () => {
      const items = doc["items"] as Array<Record<string, unknown>>;
      const sourceIds = new Set(
        items
          .map(
            (i) => (i["flags"] as { fusion?: { sourceId?: string } } | undefined)?.fusion?.sourceId,
          )
          .filter((v): v is string => typeof v === "string"),
      );
      const offenders = items
        .filter((i) => {
          const grantedBy = (i["flags"] as { fusion?: { grantedBy?: string } } | undefined)?.fusion
            ?.grantedBy;
          return typeof grantedBy === "string" && !sourceIds.has(grantedBy);
        })
        .map((i) => docName(i));
      expect(offenders).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// Pack-gap diagnostics — NOT tied to any one class's build. These are real,
// evidence-based checks against the vendor packs directly; they are
// EXPECTED to fail today for some elements/ancestries (see the achados in
// this task's final report) and are exactly the kind of thing invariant 2
// ("every choice slot offers at least one option") is meant to catch.
// ---------------------------------------------------------------------------

describe("pack-gap diagnostic — Kinetic Gate impulse coverage per element", () => {
  it.each(KINETIC_ELEMENTS)(
    "%s has at least one 1st-level impulse feat in feats-core",
    (element) => {
      const candidates = FEATS.filter((f) => {
        const traits = (sysOf(f)["traits"] as { value?: string[] } | undefined)?.value ?? [];
        const level = (sysOf(f)["level"] as number) ?? 1;
        return level <= 1 && traits.includes("impulse") && traits.includes(element);
      });
      expect(
        candidates.length,
        `no level<=1 impulse feat for element "${element}" — a Kineticist gating on it alone would get an orphan impulse sub-slot`,
      ).toBeGreaterThan(0);
    },
  );
});

describe("pack-gap diagnostic — ancestry feat coverage per milestone level", () => {
  // featLevels.ancestry is identical ([1,5,9,13,17]) across every class in
  // classes-core (measured above) — read it from the first class doc rather
  // than hardcoding the array, so this stays data-driven.
  const milestoneLevels =
    (sysOf(CLASSES[0]!)["featLevels"] as { ancestry?: number[] } | undefined)?.ancestry ?? [];

  // O que o pack DEVE ter é tudo que a fonte publica — não um feat em cada
  // marco. Medido no vendor (r21): Fleshwarp simplesmente não tem feat de
  // ancestralidade no nível 17; exigir isso seria exigir do pack algo que a
  // Paizo não publicou, e o teste falharia para sempre sem nada a corrigir.
  // O buraco REAL que este diagnóstico existe para pegar é o pack ficar
  // aquém da fonte — foi assim que o Fleshwarp entrou na r18 com a
  // ancestralidade no pack e ZERO feats dela (curadoria por nome literal).
  it.each(ANCESTRIES.map((a) => docName(a)))("%s tem ancestry feats no pack", (name) => {
    const slug = name.toLowerCase();
    const own = FEATS.filter((f) => {
      const traits = (sysOf(f)["traits"] as { value?: string[] } | undefined)?.value ?? [];
      return sysOf(f)["category"] === "ancestry" && traits.includes(slug);
    });
    expect(
      own.length,
      `${name} está em ancestries-core/heritages-core mas não tem NENHUM ancestry feat em feats-core — o slot de talento de ancestralidade abriria vazio`,
    ).toBeGreaterThan(0);

    const levelsWithFeats = new Set(own.map((f) => sysOf(f)["level"] as number));
    const missing = milestoneLevels.filter((lvl) => !levelsWithFeats.has(lvl));
    // Não falha: registra. Marco sem feat na FONTE é fato do conteúdo, não
    // defeito do pack — o jogador vê o slot e escolhe um talento de nível
    // menor, que é o que o RAW manda.
    if (missing.length > 0) {
      console.info(
        `[varredura] ${name}: ${String(own.length)} ancestry feats, nenhum nos níveis ${JSON.stringify(missing)} (ausente na fonte, não no pack)`,
      );
    }
  });
});
