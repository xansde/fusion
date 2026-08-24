/**
 * pregen-parity.test.ts — correctness against an EXTERNAL source of truth
 * (issue #48).
 *
 * `varredura-classes.test.ts` compares our derived output against the class's
 * OWN pack table. That is a check of internal consistency and it structurally
 * cannot fail when the pack table is incomplete: expected and actual come from
 * the same source, so both are wrong together and the assertion passes. 80
 * green tests coexisted with 60 real defects for exactly this reason.
 *
 * This suite closes that hole by comparing against data WE DID NOT PRODUCE:
 *
 *  1. Paizo's official pregenerated iconic sheets, vendored at
 *     `tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics/` — 11 of our 12
 *     classes at levels 1, 3 and 5 (Magus has no official pregen). Each sheet
 *     carries the FINAL numbers a published character has, plus the VENDOR's
 *     own embedded `class` item — the chassis before our curation touched it.
 *
 *  2. Rules invariants that depend on no pack data at all (skill increase
 *     ceilings, rank bounds, HP monotonicity). A rule that simply is not
 *     implemented has nothing to compare against in the internal sweep, so it
 *     can never fail there; here it fails against the rule itself.
 *
 * KNOWN_DIVERGENCES is the baseline of defects this suite already found and
 * that have an open issue. It is a ratchet, not a mute button: a divergence
 * NOT in the list fails the suite (a new regression), and a listed divergence
 * that stopped happening ALSO fails (the entry must be deleted when its issue
 * is fixed, so the baseline can only shrink).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLASSES,
  RATFOLK,
  sysOf,
  docName,
  cloneDoc,
  runFullDerivation,
  abilityModOf,
  readAbilities,
  buildCharacterToLevel20,
} from "./helpers/classBuildHarness.js";
import { computeAbilityScores } from "../planVM.js";

// ---------------------------------------------------------------------------
// Loading the official pregens
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ICONICS_ROOT = resolve(
  __dirname,
  "../../../../../../../../../tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics",
);

/** One official sheet: the published numbers plus the vendor's own class item. */
interface Pregen {
  /** Iconic's folder name, e.g. "kyra". */
  iconic: string;
  /** Class name as the vendor spells it, e.g. "Cleric". */
  className: string;
  level: number;
  /** `system.attributes.hp.value` — the sheet's printed maximum HP. */
  hpTotal: number;
  /** `system.hp` of the embedded ancestry item. */
  ancestryHp: number;
  /** `system` of the embedded VENDOR class item (pre-curation chassis). */
  classSystem: Record<string, unknown>;
}

function loadPregens(): Pregen[] {
  const out: Pregen[] = [];
  for (const iconic of readdirSync(ICONICS_ROOT)) {
    const dir = resolve(ICONICS_ROOT, iconic);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const sheet = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as Record<
        string,
        unknown
      >;
      const items = (sheet["items"] as Array<Record<string, unknown>>) ?? [];
      const classItem = items.find((i) => i["type"] === "class");
      const ancestryItem = items.find((i) => i["type"] === "ancestry");
      if (!classItem || !ancestryItem) continue; // companion sheets have neither
      const sys = sysOf(sheet);
      const level = (
        (sys["details"] as Record<string, unknown> | undefined)?.["level"] as
          | { value?: number }
          | undefined
      )?.value;
      const hpTotal = (
        (sys["attributes"] as Record<string, unknown> | undefined)?.["hp"] as
          | { value?: number }
          | undefined
      )?.value;
      if (typeof level !== "number" || typeof hpTotal !== "number") continue;
      out.push({
        iconic,
        className: String(classItem["name"]),
        level,
        hpTotal,
        ancestryHp: Number(sysOf(ancestryItem)["hp"] ?? 0),
        classSystem: sysOf(classItem),
      });
    }
  }
  return out;
}

const ALL_PREGENS = loadPregens();
const OUR_CLASS_NAMES = new Set(CLASSES.map((c) => docName(c)));
/** Only the pregens whose class we actually ship (excludes Witch, Oracle, …). */
const PREGENS = ALL_PREGENS.filter((p) => OUR_CLASS_NAMES.has(p.className)).sort(
  (a, b) => a.className.localeCompare(b.className) || a.level - b.level,
);

/** Classes we ship that have no official pregen to check against. */
const CLASSES_WITHOUT_PREGEN = [...OUR_CLASS_NAMES].filter(
  (name) => !ALL_PREGENS.some((p) => p.className === name),
);

// ---------------------------------------------------------------------------
// Known divergences — the ratchet
// ---------------------------------------------------------------------------

/**
 * A defect this suite detects that already has an open issue. Key format:
 * `<Class>/<check>` (level-independent) — see the assertions for the exact key
 * each check builds.
 *
 * DELETE the entry when the issue is fixed; leaving a stale one fails the
 * "baseline only shrinks" test below.
 */
const KNOWN_DIVERGENCES: Record<string, string> = {
  // #50 — Cleric doctrine proficiencies were dropped in curation. The vendor
  // chassis grants a rank in the deity's favored weapon; ours has no such
  // entry, and the upgrade table covers neither Fortitude nor spellcasting.
  "Cleric/classSystem.attacks.other": "#50",

  // #49 — the skill increase ceiling (Master needs level 7, Legendary 15) is
  // not implemented anywhere, so EVERY class breaks it. This is the defect
  // that proves the point of this suite: the internal sweep has no pack table
  // to compare a missing rule against, so it could never fail there.
  "Barbarian/skillIncreaseCeiling": "#49",
  "Bard/skillIncreaseCeiling": "#49",
  "Champion/skillIncreaseCeiling": "#49",
  "Cleric/skillIncreaseCeiling": "#49",
  "Fighter/skillIncreaseCeiling": "#49",
  "Kineticist/skillIncreaseCeiling": "#49",
  "Magus/skillIncreaseCeiling": "#49",
  "Monk/skillIncreaseCeiling": "#49",
  "Ranger/skillIncreaseCeiling": "#49",
  "Rogue/skillIncreaseCeiling": "#49",
  "Sorcerer/skillIncreaseCeiling": "#49",
  "Wizard/skillIncreaseCeiling": "#49",
};

/** Every divergence actually observed in this run (filled by the assertions). */
const observed = new Set<string>();

function expectKnownOrFail(key: string, detail: string): void {
  observed.add(key);
  const issue = KNOWN_DIVERGENCES[key];
  expect(
    issue,
    `NEW divergence against the official pregen sheet — ${key}: ${detail}\n` +
      `If this is a known open defect, add "${key}" to KNOWN_DIVERGENCES with its issue number.`,
  ).toBeDefined();
}

// ---------------------------------------------------------------------------
// 1. Class chassis vs the vendor's own class item
// ---------------------------------------------------------------------------

describe("pregen parity — class chassis matches the official sheet", () => {
  it("has pregens to compare against", () => {
    expect(PREGENS.length).toBeGreaterThan(0);
    // 11 of 12 classes × 3 levels; Magus is the documented gap.
    expect(CLASSES_WITHOUT_PREGEN).toEqual(["Magus"]);
  });

  /**
   * True when a vendor chassis entry actually says something. The vendor ships
   * `attacks.other = { name: "", rank: 0 }` on nearly every class as an empty
   * placeholder; only an entry with a name or a rank above Untrained is a
   * proficiency we could have dropped.
   */
  function isMeaningfulChassisEntry(value: unknown): boolean {
    if (typeof value === "number") return value > 0;
    if (!value || typeof value !== "object") return false;
    const v = value as { name?: unknown; rank?: unknown };
    return (typeof v.name === "string" && v.name !== "") || Number(v.rank ?? 0) > 0;
  }

  /** Numeric chassis fields that must survive curation untouched. */
  const SCALARS = ["hp", "perception"] as const;
  const GROUPS = {
    savingThrows: ["fortitude", "reflex", "will"],
    attacks: ["unarmed", "simple", "martial", "advanced"],
    defenses: ["unarmored", "light", "medium", "heavy"],
  } as const;

  // One pregen per class is enough for the chassis (it does not vary by level).
  const BY_CLASS = [...new Map(PREGENS.map((p) => [p.className, p])).values()];

  it.each(BY_CLASS.map((p) => [p.className, p] as const))(
    "%s chassis survives curation",
    (className, pregen) => {
      const ourClass = CLASSES.find((c) => docName(c) === className);
      expect(ourClass, `${className} missing from classes-core`).toBeDefined();
      const ours = sysOf(ourClass!);

      for (const field of SCALARS) {
        const official = pregen.classSystem[field];
        if (typeof official !== "number") continue;
        expect(ours[field], `${className} system.${field}`).toBe(official);
      }

      for (const [group, keys] of Object.entries(GROUPS)) {
        const official = (pregen.classSystem[group] as Record<string, unknown>) ?? {};
        const mine = (ours[group] as Record<string, unknown>) ?? {};
        for (const key of keys) {
          const want = official[key];
          if (typeof want !== "number") continue;
          expect(mine[key], `${className} system.${group}.${key}`).toBe(want);
        }
        // A chassis entry the vendor has and we dropped entirely (e.g. the
        // Cleric's "Deity's favored weapon" attack proficiency) is a real gap
        // that plain field-by-field comparison misses, because the key is not
        // in our GROUPS whitelist. Only MEANINGFUL entries count: the vendor
        // ships `attacks.other = { name: "", rank: 0 }` on nearly every class
        // as an empty placeholder, and flagging those would be pure noise.
        for (const key of Object.keys(official)) {
          if (keys.includes(key as never)) continue;
          if (mine[key] !== undefined) continue;
          if (!isMeaningfulChassisEntry(official[key])) continue;
          expectKnownOrFail(
            `${className}/classSystem.${group}.${key}`,
            `the vendor class item declares ${group}.${key} = ${JSON.stringify(official[key])} and ours has no such entry`,
          );
        }
      }

      // keyAbility: vendor shape is { value: [...] }, ours is a bare array.
      const officialKey = (pregen.classSystem["keyAbility"] as { value?: string[] } | undefined)
        ?.value;
      if (officialKey) {
        expect([...((ours["keyAbility"] as string[]) ?? [])].sort()).toEqual(
          [...officialKey].sort(),
        );
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 2. HP against the official printed number
// ---------------------------------------------------------------------------

describe("pregen parity — HP", () => {
  /** Built once per class, reused across its three pregen levels. */
  const builtByClass = new Map<string, Record<string, unknown>>();

  beforeAll(() => {
    for (const className of new Set(PREGENS.map((p) => p.className))) {
      const classDoc = CLASSES.find((c) => docName(c) === className);
      if (!classDoc) continue;
      builtByClass.set(className, buildCharacterToLevel20(classDoc).doc);
    }
  });

  it.each(PREGENS.map((p) => [`${p.className} L${String(p.level)} (${p.iconic})`, p] as const))(
    "%s — the class's HP contribution matches the official sheet",
    (label, pregen) => {
      const built = builtByClass.get(pregen.className);
      expect(built, `${pregen.className} was not built`).toBeDefined();

      // What the official sheet says the class contributes per level, with the
      // published ancestry HP and Constitution factored out. `hpTotal =
      // ancestryHp + (classHp + conMod) * level`, so the per-level class+Con
      // term is exact arithmetic on Paizo's own numbers.
      const officialPerLevel = (pregen.hpTotal - pregen.ancestryHp) / pregen.level;
      const officialClassHp = Number(pregen.classSystem["hp"] ?? 0);
      const officialConMod = officialPerLevel - officialClassHp;
      expect(
        Number.isInteger(officialConMod),
        `${label}: official sheet is not consistent with the HP formula (per-level ${String(officialPerLevel)})`,
      ).toBe(true);

      // Now the same isolation on OUR derived sheet, which went through the
      // real pipeline (pack → build → derivation), and must land on the
      // official class HP once ITS ancestry and Constitution are removed.
      const clone = cloneDoc(built!);
      (sysOf(clone)["level"] as { value: number }).value = pregen.level;
      runFullDerivation(clone);

      const ourHpMax = (
        (sysOf(clone)["attributes"] as Record<string, unknown> | undefined)?.["hp"] as
          | { max?: number }
          | undefined
      )?.max;
      expect(ourHpMax, `${label}: our sheet produced no hp.max`).toBeTypeOf("number");

      const ourAncestryHp = Number(sysOf(RATFOLK!)["hp"] ?? 0);
      const ourConMod = abilityModOf(computeAbilityScores(readAbilities(built!), pregen.level).con);
      const ourClassHpPerLevel = (ourHpMax! - ourAncestryHp) / pregen.level - ourConMod;

      expect(ourClassHpPerLevel, `${label}: HP per level from the class`).toBe(officialClassHp);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Rules invariants — no pack data involved
// ---------------------------------------------------------------------------

describe("rules invariants — independent of any pack table", () => {
  const SKILL_SLUGS = [
    "acrobatics",
    "arcana",
    "athletics",
    "crafting",
    "deception",
    "diplomacy",
    "intimidation",
    "medicine",
    "nature",
    "occultism",
    "performance",
    "religion",
    "society",
    "stealth",
    "survival",
    "thievery",
  ] as const;

  /**
   * PF2e core: a skill can only reach Master (rank 3) at character level 7 and
   * Legendary (rank 4) at level 15. This rule lives in no pack table, so the
   * internal sweep has nothing to compare it against and can never catch it.
   */
  const RANK_MIN_LEVEL: Record<number, number> = { 3: 7, 4: 15 };

  const built = new Map<string, Record<string, unknown>>();
  beforeAll(() => {
    for (const classDoc of CLASSES) {
      built.set(docName(classDoc), buildCharacterToLevel20(classDoc).doc);
    }
  });

  it.each(CLASSES.map((c) => docName(c)))(
    "%s never exceeds the skill increase ceiling at any level",
    (className) => {
      const doc = built.get(className)!;
      const violations: string[] = [];

      for (let level = 1; level <= 20; level++) {
        const clone = cloneDoc(doc);
        (sysOf(clone)["level"] as { value: number }).value = level;
        runFullDerivation(clone);
        const skills = (sysOf(clone)["skills"] as Record<string, { rank?: number }>) ?? {};
        for (const slug of SKILL_SLUGS) {
          const rank = skills[slug]?.rank ?? 0;
          expect(
            rank,
            `${className} L${String(level)} ${slug} rank out of bounds`,
          ).toBeLessThanOrEqual(4);
          const minLevel = RANK_MIN_LEVEL[rank];
          if (minLevel !== undefined && level < minLevel) {
            violations.push(
              `${slug} reached rank ${String(rank)} at level ${String(level)} (needs ${String(minLevel)})`,
            );
          }
        }
      }

      if (violations.length > 0) {
        expectKnownOrFail(
          `${className}/skillIncreaseCeiling`,
          `${String(violations.length)} violation(s), first: ${violations[0]}`,
        );
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 4. The ratchet itself
// ---------------------------------------------------------------------------

describe("known-divergence baseline", () => {
  it("contains no entry that stopped diverging (baseline only shrinks)", () => {
    const stale = Object.keys(KNOWN_DIVERGENCES).filter((key) => !observed.has(key));
    expect(
      stale,
      `These divergences no longer happen — delete them from KNOWN_DIVERGENCES:\n${stale
        .map((k) => `  ${k} (${KNOWN_DIVERGENCES[k]!})`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
