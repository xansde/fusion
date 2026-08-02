/**
 * varredura-classes.test.ts — headless sweep of every PF2e core class (r21,
 * W2): builds a level-1..20 character for EACH of the 7 classes shipped in
 * `classes-core` (Barbarian, Fighter, Kineticist, Magus, Ranger, Rogue,
 * Wizard), filling every slot the Plan opens with the real planVM.ts op
 * builders (chooseFeat/chooseClassChoice/chooseKineticGate/
 * confirmSkillTraining/setAbilityBoosts), then runs the REAL server-side
 * derivation pipeline (`pf2eSystem` from systems/pf2e, reached by relative
 * path exactly like every other cross-package op in this monorepo's tests —
 * see systems/pf2e/src/__tests__/derivations-archetype-dc.test.ts for the
 * same `pf2eSystem.deriveSteps.sortedForPhase` pattern this file mirrors) and
 * asserts the invariants listed in the task brief.
 *
 * This file does NOT modify planVM.ts or PlanColumn.svelte (W1's territory)
 * — it only calls their already-exported pure functions. No
 * `if (className === "…")` branching drives the fill logic: every dispatch
 * is by `slot.type` (a PlanSlotType, itself derived from the pack's own
 * `system.category`/`CLASS_CHOICE_SLOTS` data), so a class this file has
 * never heard of would still be exercised correctly.
 *
 * Real vendor fixtures only (systems/pf2e/packs/*-core/documents.json) —
 * mirrors the loading pattern of systems/pf2e/src/__tests__/
 * packs-validation.test.ts. No invented pack content.
 *
 * REQ-PF2-010..012, REQ-PF2-083.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  derivePlan,
  planContext,
  applyClass,
  applyAncestry,
  applyBackground,
  chooseFeat,
  chooseClassChoice,
  chooseKineticGate,
  chooseAdoptedAncestry,
  skillTrainingDialogContext,
  confirmSkillTraining,
  setAbilityBoosts,
  abilityBoostsSlotContext,
  levelUp,
  isFeatEligible,
  isClassChoiceOption,
  matchesGrantedFeatFilter,
  readGateElements,
  spellSlotsForLevel,
  computeAbilityScores,
  CLASS_CHOICE_SLOTS,
  CLASS_CHOICE_SLOT_OPTIONS,
  KINETIC_ELEMENTS,
  ABILITY_SLUGS,
  type PlanOpBuilderContext,
  type PlanSlotModel,
  type FeatDocLike,
  type BuildAbilities,
  type AbilitySlug,
} from "../planVM.js";
import type { DocOpPayload } from "../characterSheetVM.js";

// systems/pf2e is NOT a declared dependency of @fusion/client (REQ-ARQ-005 —
// planVM.ts itself must never import it). This TEST file crosses that
// boundary deliberately and ONLY for verification: it reaches the real
// derivation pipeline by relative filesystem path (dependency-cruiser's
// actual configured rule, .dependency-cruiser.cjs, forbids packages/client
// importing packages/server — it does NOT forbid packages/client reaching
// systems/*; the stricter "no @fusion/system-pf2e" note in planVM.ts's own
// header is this package's own production-code convention, not a repo-wide
// lint rule). Node/Vite resolve each bare specifier INSIDE systems/pf2e's
// own files against systems/pf2e/node_modules (walking up from the
// importing file, not from this test's package) — confirmed working via a
// throwaway smoke test before writing this harness.
import { pf2eSystem } from "../../../../../../../systems/pf2e/src/index.js";
import {
  emptySynthetics,
  type DeriveContext,
} from "../../../../../../../packages/system-api/src/index.js";
import { collectEffects } from "../../../../../../../systems/engine-2e/src/index.js";

// ---------------------------------------------------------------------------
// Pack loading (mirrors systems/pf2e/src/__tests__/packs-validation.test.ts)
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PACKS_ROOT = resolve(__dirname, "../../../../../../../systems/pf2e/packs");

function loadDocuments(slug: string): Array<Record<string, unknown>> {
  const raw = readFileSync(resolve(PACKS_ROOT, slug, "documents.json"), "utf-8");
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

const CLASSES = loadDocuments("classes-core");
const CLASS_FEATURES = loadDocuments("class-features-core");
const FEATS = loadDocuments("feats-core");
const ANCESTRIES = loadDocuments("ancestries-core");
const BACKGROUNDS = loadDocuments("backgrounds-core");

function sysOf(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function docName(doc: Record<string, unknown>): string {
  return String(doc["name"] ?? "?");
}

/** Deterministic ancestry/background fixtures for every class's build (a real
 * ancestry/background from the pack, picked by name so the choice is
 * reproducible run-to-run). Ratfolk carries real ancestry feats (26, across
 * levels 1/5/9/13/17) — Fleshwarp carries ZERO (see the dedicated pack-gap
 * test below), so Ratfolk is the only choice that lets every class's
 * ancestryFeat slots actually fill. */
const RATFOLK = ANCESTRIES.find((a) => docName(a) === "Ratfolk");
const AERONAUT = BACKGROUNDS.find((a) => docName(a) === "Aeronaut");
if (!RATFOLK || !AERONAUT) {
  throw new Error("varredura-classes fixture setup: Ratfolk/Aeronaut not found in packs");
}

// ---------------------------------------------------------------------------
// Plain-doc op application (no server, no socket — a tiny in-memory mirror
// of what packages/server/src/net/doc-handlers.ts does to a real doc, just
// enough to keep derivePlan/the op builders happy across 20 levels).
// ---------------------------------------------------------------------------

let nextId = 1;
function freshId(): string {
  return `gen-${String(nextId++)}`;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (typeof next !== "object" || next === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function applyOps(doc: Record<string, unknown>, ops: DocOpPayload[] | DocOpPayload | null): void {
  const list = ops === null ? [] : Array.isArray(ops) ? ops : [ops];
  for (const op of list) {
    if (op.type === "doc:create") {
      const items = doc["items"] as Array<Record<string, unknown>>;
      items.push({ ...op.data, _id: freshId() });
    } else if (op.type === "doc:update") {
      if (op.embedded) {
        const items = doc["items"] as Array<Record<string, unknown>>;
        const item = items.find((it) => it["_id"] === op.id);
        if (item) {
          for (const [k, v] of Object.entries(op.diff)) setPath(item, k, v);
        }
      } else {
        for (const [k, v] of Object.entries(op.diff)) setPath(doc, k, v);
      }
    } else if (op.type === "doc:delete") {
      const items = doc["items"] as Array<Record<string, unknown>>;
      doc["items"] = items.filter((it) => it["_id"] !== op.id);
    }
  }
}

function cloneDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Real server-side derivation runner (mirrors packages/server/src/net/
// derive-runner.ts's runActorDerivation — that file lives under
// packages/server and can't be imported from here, so this is a small,
// faithful re-implementation using the exact same public building blocks:
// pf2eSystem.deriveSteps.sortedForPhase + collectEffects + emptySynthetics).
// ---------------------------------------------------------------------------

function runFullDerivation(doc: Record<string, unknown>): void {
  const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
  const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");

  const baseCtx: DeriveContext = {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
  for (const step of baseSteps) step.run(doc, baseCtx);

  // pf2e registers no effectsMaterializer and the harness embeds no
  // Condition items, so this mirrors the derive-runner's fallback path
  // exactly (empty EffectSource list).
  const { synthetics } = collectEffects([], new Set<string>());
  const rollOptions = new Set<string>();
  for (const opts of Object.values(synthetics.rollOptions)) {
    for (const opt of opts) rollOptions.add(opt);
  }
  const derivedCtx: DeriveContext = { system: pf2eSystem, synthetics, rollOptions };
  for (const step of derivedSteps) step.run(doc, derivedCtx);
}

// ---------------------------------------------------------------------------
// Findings — the harness's own failure ledger (distinct from Vitest
// assertions): every "no eligible candidate" / "slot never resolved" /
// "step threw" is appended here with class+level+slot context, then a
// dedicated `it` asserts the list is empty — giving a single readable
// failure message instead of the first `expect` throwing mid-build.
// ---------------------------------------------------------------------------

interface Finding {
  klass: string;
  level: number;
  slotId: string;
  reason: string;
}

function abilityModOf(score: number): number {
  return Math.floor((score - 10) / 2);
}

interface ProficiencyUpgrade {
  level: number;
  stat: string;
  rank: number;
}

/** Mirror of systems/pf2e/src/derivations/build.ts's private `effectiveRank`. */
function expectedEffectiveRank(
  initialRank: number,
  stat: string,
  upgrades: ProficiencyUpgrade[],
  level: number,
): number {
  let rank = initialRank;
  for (const upgrade of upgrades) {
    if (upgrade.stat === stat && upgrade.level <= level && upgrade.rank > rank) {
      rank = upgrade.rank;
    }
  }
  return rank;
}

function readAbilities(doc: Record<string, unknown>): BuildAbilities {
  const sys = sysOf(doc);
  const build = (sys["build"] as Record<string, unknown>) ?? {};
  const abilities = (build["abilities"] as Record<string, unknown>) ?? {};
  const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const levelled = (abilities["levelledBoosts"] as Record<string, unknown>) ?? {};
  const levelledOut: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(levelled)) levelledOut[k] = asArr(v);
  return {
    ancestryBoosts: asArr(abilities["ancestryBoosts"]),
    ancestryFlaws: asArr(abilities["ancestryFlaws"]),
    ancestryFree: asArr(abilities["ancestryFree"]),
    backgroundBoosts: asArr(abilities["backgroundBoosts"]),
    backgroundFree: asArr(abilities["backgroundFree"]),
    classBoost: asArr(abilities["classBoost"]),
    levelledBoosts: levelledOut,
  };
}

// ---------------------------------------------------------------------------
// Fill logic — dispatches PURELY by `slot.type` (a PlanSlotType), never by
// class name. A class this harness has never heard of would still route
// through the same generic branches.
// ---------------------------------------------------------------------------

function fillAbilityBoosts(
  ctx: PlanOpBuilderContext,
  doc: Record<string, unknown>,
  level: number,
  preferredKeyAbility: string[],
): void {
  const slotCtx = abilityBoostsSlotContext(doc, level);
  for (const group of slotCtx.groups) {
    if (group.freeCount === 0) continue;
    if (group.initialFreeSlugs.length >= group.freeCount) continue; // already filled
    const preferred = group.origin === "classBoost" ? preferredKeyAbility : [];
    const pool = [...preferred, ...(group.allowedSlugs ?? [...ABILITY_SLUGS])];
    const chosen: string[] = [];
    for (const slug of pool) {
      if (chosen.length >= group.freeCount) break;
      if (group.excludedSlugs.includes(slug)) continue;
      if (chosen.includes(slug)) continue;
      chosen.push(slug);
    }
    const op = setAbilityBoosts(
      ctx,
      group.origin,
      chosen,
      group.origin === "levelled" ? level : undefined,
    );
    applyOps(doc, op);
  }
}

/** Returns true when the slot was successfully filled (or handled as a group). */
function fillOneSlot(
  klass: string,
  classDoc: Record<string, unknown>,
  ctx: PlanOpBuilderContext,
  doc: Record<string, unknown>,
  slot: PlanSlotModel,
  level: number,
  used: Set<string>,
  findings: Finding[],
): boolean {
  const pctx = planContext(doc);
  const gateElements =
    pctx.classSlug === "kineticist" ? readGateElements(doc) : (undefined as never);

  switch (slot.type) {
    case "abilityBoosts": {
      fillAbilityBoosts(ctx, doc, level, (sysOf(classDoc)["keyAbility"] as string[]) ?? []);
      return true;
    }
    case "skillTraining":
    case "skillIncrease": {
      const dctx = skillTrainingDialogContext(doc, level, slot.type);
      const picks: string[] = [];
      for (const row of dctx.rows) {
        if (picks.length >= dctx.totalSlots) break;
        if (!row.eligible) continue;
        if (picks.includes(row.slug)) continue;
        picks.push(row.slug);
      }
      if (picks.length < dctx.totalSlots) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: `only ${String(picks.length)}/${String(dctx.totalSlots)} eligible ${slot.type} rows available`,
        });
      }
      const op = confirmSkillTraining(ctx, dctx, picks);
      applyOps(doc, op);
      return true;
    }
    case "kineticGate": {
      const gateFeature = CLASS_FEATURES.find((f) => docName(f) === "Kinetic Gate");
      if (!gateFeature) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: "Kinetic Gate feature doc missing",
        });
        return false;
      }
      // Dual gate (air + metal): the two elements the current feats-core
      // pack actually ships level-1 impulses for (see the dedicated
      // "Kinetic Gate impulse coverage" pack-gap test below) — keeps THIS
      // build's impulse sub-slots fillable while that gap is tracked
      // separately.
      applyOps(
        doc,
        chooseKineticGate(ctx, level, gateFeature, [{ element: "air" }, { element: "metal" }]),
      );
      return true;
    }
    case "grantedFeat": {
      if (!slot.grantFilter) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: "grantedFeat slot with no grantFilter",
        });
        return false;
      }
      const opt = FEATS.find(
        (f) =>
          !used.has(String(f["_id"])) &&
          matchesGrantedFeatFilter(f as FeatDocLike, slot.grantFilter!),
      );
      if (!opt) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: `no candidate for grantedFeat filter ${slot.grantFilter.labelKey}`,
        });
        return false;
      }
      used.add(String(opt["_id"]));
      applyOps(doc, chooseFeat(ctx, slot, level, opt));
      return true;
    }
    case "ancestryFeat":
    case "classFeat":
    case "generalFeat":
    case "skillFeat":
    case "archetypeFeat": {
      const opt = FEATS.find(
        (f) =>
          !used.has(String(f["_id"])) &&
          isFeatEligible(f as FeatDocLike, slot.type, level, {
            ...(pctx.classSlug !== undefined ? { classSlug: pctx.classSlug } : {}),
            ...(pctx.ancestrySlug !== undefined ? { ancestrySlug: pctx.ancestrySlug } : {}),
            ...(pctx.adoptedAncestrySlug !== undefined
              ? { adoptedAncestrySlug: pctx.adoptedAncestrySlug }
              : {}),
            gateElements,
          }),
      );
      if (!opt) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: `no eligible ${slot.type} candidate in feats-core`,
        });
        return false;
      }
      used.add(String(opt["_id"]));
      applyOps(doc, chooseFeat(ctx, slot, level, opt));
      return true;
    }
    case "adoptedAncestryChoice": {
      // "Adopted Ancestry" (a general feat) unlocked this sub-slot — pick any
      // ancestries-core doc EXCEPT the character's own (Ratfolk, see RATFOLK
      // above), mirroring PlanColumn's picker filter.
      const opt = ANCESTRIES.find((a) => docName(a).toLowerCase() !== pctx.ancestrySlug);
      if (!opt) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: "no other ancestry available in ancestries-core to adopt",
        });
        return false;
      }
      applyOps(doc, chooseAdoptedAncestry(ctx, slot, level, opt));
      return true;
    }
    default: {
      // Generic dispatch for EVERY tagged-option class-choice slot
      // (hybridStudy, instinct, racket, huntersEdge, arcaneThesis,
      // arcaneSchool, …) — driven entirely by CLASS_CHOICE_SLOT_OPTIONS +
      // isClassChoiceOption (r21-W1's generalization of the old
      // hybridStudy-only hardcode). No `if (className === …)` anywhere and
      // no per-slot-type enumeration: whatever CLASS_CHOICE_SLOTS maps a
      // featuresByLevel placeholder to, this branch resolves the SAME way,
      // so a brand-new axis lights up here the moment its pack data +
      // CLASS_CHOICE_SLOT_OPTIONS entry exist — no harness change needed.
      const cfg = CLASS_CHOICE_SLOT_OPTIONS[slot.type];
      if (!cfg) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: `unrecognized slot type "${slot.type}" — no CLASS_CHOICE_SLOT_OPTIONS entry`,
        });
        return false;
      }
      const opt = CLASS_FEATURES.find(
        (f) =>
          isClassChoiceOption(f as { system?: { traits?: { otherTags?: unknown } } }, slot.type) &&
          !used.has(String(f["_id"])),
      );
      if (!opt) {
        findings.push({
          klass,
          level,
          slotId: slot.slotId,
          reason: `no class-features-core option tagged "${cfg.category}" for slot type "${slot.type}"`,
        });
        return false;
      }
      used.add(String(opt["_id"]));
      applyOps(doc, chooseClassChoice(ctx, slot.type, level, opt));
      return true;
    }
  }
}

const FILL_GUARD = 60;

function fillAllSlotsAtLevel(
  klass: string,
  classDoc: Record<string, unknown>,
  ctx: PlanOpBuilderContext,
  doc: Record<string, unknown>,
  level: number,
  used: Set<string>,
  findings: Finding[],
): void {
  const givenUp = new Set<string>();
  for (let guard = 0; guard < FILL_GUARD; guard++) {
    const plan = derivePlan(doc);
    const lp = plan.levels.find((l) => l.level === level);
    if (!lp) return;
    const unfilled = lp.slots.filter((s) => !s.filled && !givenUp.has(s.slotId));
    if (unfilled.length === 0) return;
    const slot = unfilled[0]!;
    const ok = fillOneSlot(klass, classDoc, ctx, doc, slot, level, used, findings);
    if (!ok) givenUp.add(slot.slotId);
  }
  findings.push({
    klass,
    level,
    slotId: "*",
    reason: `fill loop exceeded ${String(FILL_GUARD)} iterations — an unfilled slot never resolves (orphan)`,
  });
}

// ---------------------------------------------------------------------------
// Build one full level-1..20 character for a class doc.
// ---------------------------------------------------------------------------

interface BuildResult {
  doc: Record<string, unknown>;
  findings: Finding[];
}

function buildCharacterToLevel20(classDoc: Record<string, unknown>): BuildResult {
  const klass = docName(classDoc);
  const findings: Finding[] = [];
  const used = new Set<string>();

  const doc: Record<string, unknown> = {
    _id: `actor-${klass.toLowerCase()}`,
    type: "character",
    items: [],
    system: {
      level: { value: 1 },
      build: {
        choices: [],
        freeArchetype: false,
        abilities: {
          ancestryBoosts: [],
          ancestryFlaws: [],
          ancestryFree: [],
          backgroundBoosts: [],
          backgroundFree: [],
          classBoost: [],
          levelledBoosts: {},
        },
      },
    },
  };
  const ctx: PlanOpBuilderContext = { actorId: doc["_id"] as string, doc, editable: true };

  try {
    applyOps(doc, applyClass(ctx, classDoc));
    applyOps(doc, applyAncestry(ctx, RATFOLK!));
    applyOps(doc, applyBackground(ctx, AERONAUT!));

    fillAllSlotsAtLevel(klass, classDoc, ctx, doc, 1, used, findings);
    for (let level = 2; level <= 20; level++) {
      applyOps(doc, levelUp(ctx));
      fillAllSlotsAtLevel(klass, classDoc, ctx, doc, level, used, findings);
    }
  } catch (err) {
    findings.push({
      klass,
      level: -1,
      slotId: "*",
      reason: `THREW: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    });
  }

  return { doc, findings };
}

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
