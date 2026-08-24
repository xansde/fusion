/**
 * classBuildHarness.ts — the shared, headless "build a real PF2e character"
 * rig extracted from varredura-classes.test.ts (issue #48).
 *
 * It fills every slot the Plan opens with the REAL planVM.ts op builders and
 * runs the REAL server-side derivation pipeline, dispatching purely by
 * `slot.type` — never by class name — so a class this harness has never heard
 * of is still exercised correctly.
 *
 * Two suites consume it:
 *   - varredura-classes.test.ts — internal-consistency sweep of all 12 classes.
 *   - pregen-parity.test.ts     — parity against Paizo's official pregen sheets,
 *                                 the EXTERNAL source of truth that the
 *                                 internal sweep structurally cannot be.
 *
 * This file exports building blocks only; it contains no assertions.
 */

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
  CLASS_CHOICE_SLOT_OPTIONS,
  ABILITY_SLUGS,
  type PlanOpBuilderContext,
  type PlanSlotModel,
  type FeatDocLike,
  type BuildAbilities,
} from "../../planVM.js";
import type { DocOpPayload } from "../../characterSheetVM.js";

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
import { pf2eSystem } from "../../../../../../../../../../systems/pf2e/src/index.js";
import {
  emptySynthetics,
  type DeriveContext,
} from "../../../../../../../../../../packages/system-api/src/index.js";
import { collectEffects } from "../../../../../../../../../../systems/engine-2e/src/index.js";
// ---------------------------------------------------------------------------
// Pack loading (mirrors systems/pf2e/src/__tests__/packs-validation.test.ts)
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PACKS_ROOT = resolve(__dirname, "../../../../../../../../../../systems/pf2e/packs");

export function loadDocuments(slug: string): Array<Record<string, unknown>> {
  const raw = readFileSync(resolve(PACKS_ROOT, slug, "documents.json"), "utf-8");
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

export const CLASSES = loadDocuments("classes-core");
export const CLASS_FEATURES = loadDocuments("class-features-core");
export const FEATS = loadDocuments("feats-core");
export const ANCESTRIES = loadDocuments("ancestries-core");
export const BACKGROUNDS = loadDocuments("backgrounds-core");

export function sysOf(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

export function docName(doc: Record<string, unknown>): string {
  return String(doc["name"] ?? "?");
}

/** Deterministic ancestry/background fixtures for every class's build (a real
 * ancestry/background from the pack, picked by name so the choice is
 * reproducible run-to-run). Ratfolk carries real ancestry feats (26, across
 * levels 1/5/9/13/17) — Fleshwarp carries ZERO (see the dedicated pack-gap
 * test below), so Ratfolk is the only choice that lets every class's
 * ancestryFeat slots actually fill. */
export const RATFOLK = ANCESTRIES.find((a) => docName(a) === "Ratfolk");
export const AERONAUT = BACKGROUNDS.find((a) => docName(a) === "Aeronaut");
if (!RATFOLK || !AERONAUT) {
  throw new Error("varredura-classes fixture setup: Ratfolk/Aeronaut not found in packs");
}

// ---------------------------------------------------------------------------
// Plain-doc op application (no server, no socket — a tiny in-memory mirror
// of what packages/server/src/net/doc-handlers.ts does to a real doc, just
// enough to keep derivePlan/the op builders happy across 20 levels).
// ---------------------------------------------------------------------------

let nextId = 1;
export function freshId(): string {
  return `gen-${String(nextId++)}`;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
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

export function applyOps(
  doc: Record<string, unknown>,
  ops: DocOpPayload[] | DocOpPayload | null,
): void {
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

export function cloneDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Real server-side derivation runner (mirrors packages/server/src/net/
// derive-runner.ts's runActorDerivation — that file lives under
// packages/server and can't be imported from here, so this is a small,
// faithful re-implementation using the exact same public building blocks:
// pf2eSystem.deriveSteps.sortedForPhase + collectEffects + emptySynthetics).
// ---------------------------------------------------------------------------

export function runFullDerivation(doc: Record<string, unknown>): void {
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

export interface Finding {
  klass: string;
  level: number;
  slotId: string;
  reason: string;
}

export function abilityModOf(score: number): number {
  return Math.floor((score - 10) / 2);
}

export interface ProficiencyUpgrade {
  level: number;
  stat: string;
  rank: number;
}

/** Mirror of systems/pf2e/src/derivations/build.ts's private `effectiveRank`. */
export function expectedEffectiveRank(
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

export function readAbilities(doc: Record<string, unknown>): BuildAbilities {
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
            // Spread condicional em TODOS os campos opcionais: o tsconfig usa
            // exactOptionalPropertyTypes, então passar `undefined` explícito é
            // erro de tipo (frente 3) — e `adoptedAncestrySlug` entrou com a
            // frente 2.
            ...(pctx.classSlug !== undefined ? { classSlug: pctx.classSlug } : {}),
            ...(pctx.ancestrySlug !== undefined ? { ancestrySlug: pctx.ancestrySlug } : {}),
            ...(pctx.adoptedAncestrySlug !== undefined
              ? { adoptedAncestrySlug: pctx.adoptedAncestrySlug }
              : {}),
            ...(gateElements !== undefined ? { gateElements } : {}),
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

export interface BuildResult {
  doc: Record<string, unknown>;
  findings: Finding[];
}

export function buildCharacterToLevel20(classDoc: Record<string, unknown>): BuildResult {
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
