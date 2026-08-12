/**
 * planVM.ts — Pure view-model for the PF2e level-by-level character builder
 * ("Plano" column, DEC-R10-05/DEC-R10-08, R10-D item D1).
 *
 * 100% testable TypeScript — no PIXI, no Svelte, no browser APIs, and no
 * import from `@fusion/system-pf2e` (arch boundary REQ-ARQ-005: the client
 * package must not depend on systems/pf2e). Any small pure helper the server
 * derivation module already has (e.g. `spellSlotsForLevel` from
 * systems/pf2e/src/derivations/build.ts) is mirrored here with a comment
 * pointing at the source of truth, exactly like `characterSheetVM.ts` already
 * does for `SKILL_LABELS`/`SKILL_ABILITY`.
 *
 * Responsibilities:
 *   - derivePlan(doc, classDoc?): compute the "Plano" column's data model
 *     (ABC cards + one LevelCard per level, each with its slots resolved
 *     filled/empty from the embedded items' `flags.fusion.build` +
 *     `system.build.choices`).
 *   - Op builders for every builder action (applyClass, applyAncestry,
 *     applyHeritage, applyBackground, chooseFeat, chooseClassChoice,
 *     chooseSkillTraining/Increase, setAbilityBoosts, setFreeArchetype,
 *     removeChoice, levelUp/levelSet). Every builder returns plain op
 *     payload(s) — same DocUpdatePayload/DocCreateEmbeddedPayload/
 *     DocDeleteEmbeddedPayload shapes as characterSheetVM.ts — the caller
 *     (Svelte component) sends them via sendOpFn/makeSendOpFn.
 *   - isFeatEligible(): pure, non-blocking eligibility check for the feat
 *     picker.
 *
 * Clean-room: PF2e Remaster mechanics from ORC/OGL (Archives of Nethys). No
 * Foundry code copied. Structural facts (featLevels, hybrid study otherTags,
 * archetype dedication traits) come from systems/pf2e/packs/*, which are
 * themselves clean-room authored per DEC-R10-06.
 *
 * REQ-PF2-010, REQ-PF2-011, REQ-PF2-012, REQ-PF2-083.
 * Spec: 17-sistema-pf2e.md; DEC-R10-01/02/05/07/08 (.fusion-build/r10-plan.md).
 */

import type {
  DocCreateEmbeddedPayload,
  DocDeleteEmbeddedPayload,
  DocOpPayload,
  DocUpdatePayload,
} from "./characterSheetVM.js";
import { translatePrerequisite } from "../../compendium/prerequisiteTranslation.js";
import { isLoreSlug, legacyLoreSlug, loreSlug, migrateLoreSlug } from "./loreSlug.js";

/**
 * `loreSlug` is re-exported so the historical `planVM.loreSlug` entry point
 * keeps working — this module used to own a SECOND, divergent implementation
 * (the legacy `<subject>-lore` form) that no reader in the app understood.
 * `./loreSlug.ts` is now the single convention (contract C3).
 */
export { loreSlug };

// ---------------------------------------------------------------------------
// Local mirrors of systems/pf2e/src/types.ts canonical sets.
//
// Kept in sync BY HAND (documented here, like characterSheetVM.ts's
// CANONICAL_SKILL_SLUGS) — the client package cannot import systems/pf2e.
// ---------------------------------------------------------------------------

/** Mirrors ABILITY_SLUGS (systems/pf2e/src/types.ts). */
export const ABILITY_SLUGS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilitySlug = (typeof ABILITY_SLUGS)[number];

// ---------------------------------------------------------------------------
// Document accessor helpers (mirrors characterSheetVM.ts's private helpers,
// duplicated here since this is a sibling module, not a subclass).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function itemName(item: Record<string, unknown> | undefined): string | undefined {
  const name = item?.["name"];
  return typeof name === "string" ? name : undefined;
}

/**
 * Build an object with `key` present only when `value` is defined.
 * Needed under `exactOptionalPropertyTypes: true` (tsconfig) — an object
 * literal with `key: undefined` is NOT assignable to an optional `key?: T`
 * field; the key must be entirely absent instead.
 */
function withOptional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return asRecord(doc["system"]);
}

function getItems(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = doc["items"];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function getLevel(doc: Record<string, unknown>): number {
  const sys = getSystem(doc);
  const level = asRecord(sys["level"]);
  const value = level["value"];
  return typeof value === "number" ? value : 1;
}

/** Read `flags.fusion.build` off an embedded item, if present. */
function getItemBuildFlag(item: Record<string, unknown>): { level: number; slot: string } | null {
  const flags = asRecord(item["flags"]);
  const fusion = asRecord(flags["fusion"]);
  const build = fusion["build"];
  if (!build || typeof build !== "object") return null;
  const b = build as Record<string, unknown>;
  const level = b["level"];
  const slot = b["slot"];
  if (typeof level !== "number" || typeof slot !== "string") return null;
  return { level, slot };
}

function findItemsByType(
  doc: Record<string, unknown>,
  type: string,
): Array<Record<string, unknown>> {
  return getItems(doc).filter((item) => item["type"] === type);
}

function findFirstItemByType(
  doc: Record<string, unknown>,
  type: string,
): Record<string, unknown> | undefined {
  return getItems(doc).find((item) => item["type"] === type);
}

// ---------------------------------------------------------------------------
// system.build accessors
// ---------------------------------------------------------------------------

export interface BuildChoice {
  level: number;
  slot: string;
  type: string;
  ref?: string;
  itemId?: string;
  skill?: string;
  rank?: number;
}

export interface BuildAbilities {
  ancestryBoosts: string[];
  ancestryFlaws: string[];
  ancestryFree: string[];
  backgroundBoosts: string[];
  backgroundFree: string[];
  classBoost: string[];
  levelledBoosts: Record<string, string[]>;
}

function getBuildAbilities(sys: Record<string, unknown>): BuildAbilities {
  const build = asRecord(sys["build"]);
  const abilities = asRecord(build["abilities"]);
  return {
    ancestryBoosts: asStringArray(abilities["ancestryBoosts"]),
    ancestryFlaws: asStringArray(abilities["ancestryFlaws"]),
    ancestryFree: asStringArray(abilities["ancestryFree"]),
    backgroundBoosts: asStringArray(abilities["backgroundBoosts"]),
    backgroundFree: asStringArray(abilities["backgroundFree"]),
    classBoost: asStringArray(abilities["classBoost"]),
    levelledBoosts: asStringArrayRecord(abilities["levelledBoosts"]),
  };
}

/**
 * computeAbilityScores — pure mirror of systems/pf2e/src/derivations/
 * build.ts's `computeAbilityScores` (same origin order, same +2/+1-below-18
 * math). Needed here so the client builder can preview the CURRENT ability
 * scores (post-boosts) without importing systems/pf2e — used by
 * `trainedSkillCount` (issue #4: level-1 skill training slots = additional +
 * Int mod AFTER boosts) and by any future preview UI.
 *
 * MUST stay in sync with the server-side implementation.
 */
export function computeAbilityScores(
  abilities: BuildAbilities,
  level: number,
): Record<AbilitySlug, number> {
  const scores: Record<AbilitySlug, number> = {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  };

  const applyBoost = (slug: string): void => {
    if (!ABILITY_SLUGS.includes(slug as AbilitySlug)) return;
    const ability = slug as AbilitySlug;
    scores[ability] += scores[ability] < 18 ? 2 : 1;
  };
  const applyFlaw = (slug: string): void => {
    if (!ABILITY_SLUGS.includes(slug as AbilitySlug)) return;
    const ability = slug as AbilitySlug;
    scores[ability] -= 2;
  };

  for (const slug of abilities.ancestryBoosts) applyBoost(slug);
  for (const slug of abilities.ancestryFlaws) applyFlaw(slug);
  for (const slug of abilities.ancestryFree) applyBoost(slug);
  for (const slug of abilities.backgroundBoosts) applyBoost(slug);
  for (const slug of abilities.backgroundFree) applyBoost(slug);
  for (const slug of abilities.classBoost) applyBoost(slug);

  const levelledLevels = Object.keys(abilities.levelledBoosts)
    .map((lvl) => Number(lvl))
    .filter((lvl) => !Number.isNaN(lvl) && lvl <= level)
    .sort((a, b) => a - b);
  for (const lvl of levelledLevels) {
    const boosts = abilities.levelledBoosts[String(lvl)] ?? [];
    for (const slug of boosts) applyBoost(slug);
  }

  return scores;
}

/** Ability modifier from score: floor((score-10)/2) — PF2e Remaster rule. */
function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function getBuildChoices(sys: Record<string, unknown>): BuildChoice[] {
  const build = asRecord(sys["build"]);
  const raw = build["choices"];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c): BuildChoice | null => {
      const r = asRecord(c);
      const level = r["level"];
      const slot = r["slot"];
      const type = r["type"];
      if (typeof level !== "number" || typeof slot !== "string" || typeof type !== "string") {
        return null;
      }
      const choice: BuildChoice = { level, slot, type };
      if (typeof r["ref"] === "string") choice.ref = r["ref"];
      if (typeof r["itemId"] === "string") choice.itemId = r["itemId"];
      if (typeof r["skill"] === "string") choice.skill = r["skill"];
      if (typeof r["rank"] === "number") choice.rank = r["rank"];
      return choice;
    })
    .filter((c): c is BuildChoice => c !== null);
}

function getFreeArchetype(sys: Record<string, unknown>): boolean {
  const build = asRecord(sys["build"]);
  return build["freeArchetype"] === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = asStringArray(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Class doc accessors — the caller passes the class ITEM's `system` block
// (either the embedded item's system, or a compendium classDoc's system when
// previewing before applying).
// ---------------------------------------------------------------------------

export interface ClassFeatLevels {
  ancestry: number[];
  class: number[];
  general: number[];
  skill: number[];
}

export interface ClassFeatureRef {
  level: number;
  uuid: string;
  name: string;
}

export interface ClassSpellcastingTable {
  /** null for a class whose tradition is determined by a chosen bloodline/axis option (r22 — Sorcerer). */
  tradition: string | null;
  type: "prepared" | "spontaneous";
  ability: string;
  cantripsKnown?: Array<{ level: number; count: number }>;
  slots?: Array<{ level: number; slots: Record<string, number> }>;
  /** Bloodline slug (lowercase, e.g. "aberrant") → tradition, when `tradition` is null. A bloodline entry can itself be null (unresolved this round, e.g. Sorcerer's Draconic — see resolveBloodlineTradition). */
  traditionByBloodline?: Record<string, string | null>;
}

/** Minimal shape planVM needs from a class item's `system` block. */
export interface ClassSystemLike {
  hp?: number;
  keyAbility?: string[];
  featLevels?: Partial<ClassFeatLevels>;
  skillIncreaseLevels?: number[];
  abilityBoostLevels?: number[];
  trainedSkills?: { value?: string[]; additional?: number };
  spellcasting?: ClassSpellcastingTable;
  featuresByLevel?: ClassFeatureRef[];
}

function readClassSystem(doc: Record<string, unknown>): ClassSystemLike | undefined {
  const classItem = findFirstItemByType(doc, "class");
  if (!classItem) return undefined;
  return asRecord(classItem["system"]);
}

function readClassItemId(doc: Record<string, unknown>): string | undefined {
  const classItem = findFirstItemByType(doc, "class");
  const id = classItem?.["_id"];
  return typeof id === "string" ? id : undefined;
}

// ---------------------------------------------------------------------------
// spellSlotsForLevel — pure mirror of systems/pf2e/src/derivations/build.ts
// (same function, same semantics). Kept here so the R10-D builder can
// preview a level-up's spellcasting slots without importing systems/pf2e.
// MUST stay in sync with the server-side implementation.
// ---------------------------------------------------------------------------

export function spellSlotsForLevel(
  progression: ClassSpellcastingTable,
  characterLevel: number,
): { cantripsKnown: number; slotsByRank: Record<string, number> } {
  const bestAtOrBelow = <T extends { level: number }>(entries: T[]): T | undefined => {
    let best: T | undefined;
    for (const entry of entries) {
      if (entry.level <= characterLevel && (!best || entry.level > best.level)) {
        best = entry;
      }
    }
    return best;
  };

  const cantripEntry = bestAtOrBelow(progression.cantripsKnown ?? []);
  const slotEntry = bestAtOrBelow(progression.slots ?? []);

  return {
    cantripsKnown: cantripEntry?.count ?? 0,
    slotsByRank: slotEntry?.slots ?? {},
  };
}

// ---------------------------------------------------------------------------
// Plan model types
// ---------------------------------------------------------------------------

export type AbcKind = "ancestry" | "heritage" | "background" | "class";

/**
 * A locked chip rendered under an ABC card (r20-X4): an auto-conceded feature
 * from the ABC doc's `system.items` map (Unusual Anatomy, Sharp Teeth,
 * Fascinating Performance…) OR an informative scalar derived from the doc
 * (ancestry Size / Vision). Mirrors the level cards' locked auto-feature chips.
 */
export interface AbcChip {
  /** Stable key for the `#each` block. */
  key: string;
  /** Display name (source/EN name; the component adds the pt-BR bilingual split). */
  name: string;
  /** Feature level from the `system.items` map (undefined for scalar chips). */
  level?: number;
  /**
   * When the chip maps to a resolvable compendium doc (a MATERIALIZED grant on
   * the actor), the pack its description lives in — makes the chip clickable
   * (opens PlanDetailsDialog). Absent for an informative chip (scalar, or a
   * feature whose vendor has no clean-room pack yet).
   */
  detailsPackSlug?: string;
  /**
   * The MATERIALIZED grant item's `flags.fusion.sourceId` (issue #44). Only
   * present alongside `detailsPackSlug` — a materialized chip always has the
   * backing embedded item in hand, so there's never a reason to fall back to
   * name matching for one. Lets the details panel resolve the EXACT document
   * instead of by name (PF2e homonyms are the norm — "Unusual Anatomy" is
   * both a spell in spells-core and a feature in ancestry-features-core, with
   * distinct ids).
   */
  sourceId?: string;
}

/**
 * RequirementIssue — a non-blocking "this pick no longer meets its
 * requirements" marker (Frente 3, DEC-BC-05: REQUISITO ORDENA E MARCA, NUNCA
 * BLOQUEIA). Attached to an ALREADY-FILLED slot/card whose backing item's
 * requirements (level, class, ancestry) no longer hold — e.g. after the
 * player swaps class/ancestry out from under a prior pick. The pick itself is
 * NEVER removed by this — it stays on the sheet, visually flagged, until the
 * player explicitly re-selects or removes it.
 *
 * `reasonKey` is an i18n key (FUSION.Sheet.Plan.Requirement.*); `params` are
 * its `{{var}}` interpolation values (already-readable strings, e.g. a class
 * name or a level number) — the caller renders via `t(reasonKey, params)`.
 */
export interface RequirementIssue {
  reasonKey: string;
  params?: Record<string, string>;
}

export interface AbcCardModel {
  kind: AbcKind;
  filled: boolean;
  name?: string;
  subLine?: string;
  /** Locked chips (auto-conceded features + informative scalars) — r20-X4. */
  chips?: AbcChip[];
  /** Non-blocking "requirements not met" marker (Frente 3) — e.g. a heritage whose declared ancestry no longer matches the character's current ancestry. */
  requirementIssue?: RequirementIssue;
}

export type PlanSlotType =
  | "abilityBoosts"
  | "ancestryFeat"
  | "classFeat"
  | "generalFeat"
  | "skillFeat"
  | "archetypeFeat"
  | "hybridStudy"
  | "kineticGate"
  | "instinct"
  | "racket"
  | "huntersEdge"
  | "arcaneThesis"
  | "arcaneSchool"
  | "bloodline"
  | "muse"
  | "cause"
  | "doctrine"
  /** Druidic Order (r28) — the Druid's level-1 axis, 9 options. */
  | "order"
  | "blessing"
  | "skillTraining"
  | "skillIncrease"
  | "grantedFeat"
  | "adoptedAncestryChoice"
  /** Which class received this character level — multiclass variant (specs/30). */
  | "classLevel";

export interface PlanSlotModel {
  slotId: string;
  type: PlanSlotType;
  label: string;
  filled: boolean;
  choiceName?: string;
  itemId?: string;
  optional?: boolean;
  /**
   * Present ONLY on a collapsed group slot (R11 item 3 — the Plan column
   * shows one "Treinamento de Perícias (x/N)" entry per level+type instead
   * of N one-per-slot rows). `filledCount`/`totalCount` drive the "(x/N)"
   * label; `groupSlotIds` lists every underlying slotId this group
   * represents, in order — the caller (PlanColumn) passes the group's level+
   * type to `skillTrainingDialogContext`, which recomputes the authoritative
   * empty-slot list itself rather than trusting this snapshot.
   */
  filledCount?: number;
  totalCount?: number;
  groupSlotIds?: string[];
  /**
   * Present ONLY on a `grantedFeat` sub-slot (W1-D — feats that grant a
   * nested feat choice, e.g. Basic Concoction → 1st-/2nd-level alchemist
   * feat). Rendered INDENTED inside the parent's card (Pathbuilder-style
   * nested pick). `parentSlotId` is the slot id of the feat that granted
   * this choice — `removeChoice` on the parent cascades to remove every
   * sub-slot whose `parentSlotId` matches it.
   */
  parentSlotId?: string;
  /** The grant's declarative filter — carried on the sub-slot so the picker can apply it without re-deriving the parent's grant lookup. */
  grantFilter?: GrantedFeatFilter;
  /**
   * Present ONLY on a FIXED-grant chip (B2 r14 — a feat/class-feature
   * materialized automatically by a `GrantItem` rule element, e.g. Alchemist
   * Dedication → Alchemical Crafting). Rendered indented under its granter
   * like a `grantedFeat` sub-slot, but LOCKED: no remove/edit affordance (its
   * lifecycle follows the granter — removeChoice on the granter cascades to
   * it), details-only. `parentSlotId` points at the granter slot for
   * indentation.
   */
  lockedGrant?: true;
  /**
   * Present on a locked fixed-grant chip (B2 r14): the pack the granted item's
   * description lives in ("feats-core" for a feat, "class-features-core" for a
   * classFeature), so `detailsRequestForSlot` resolves it in the right pack
   * rather than defaulting every `grantedFeat` slot to feats-core.
   */
  detailsPackSlug?: string;
  /** Non-blocking "requirements not met" marker (Frente 3) — set only on a FILLED, item-backed slot whose backing item no longer satisfies its level/class/ancestry requirement. */
  requirementIssue?: RequirementIssue;
  /**
   * The backing embedded item's `flags.fusion.sourceId` (issue #44), when the
   * slot is ITEM-backed (a feat/hybridStudy/axis pick or a locked fixed-grant
   * chip). Absent for a CHOICE-backed slot (abilityBoosts, skillTraining,
   * skillIncrease, adoptedAncestryChoice) — those never materialize an
   * embedded item, so there's no sourceId to carry; name resolution stays the
   * only option there (rule: never invent an id the data doesn't have).
   * Lets `detailsRequestForSlot` resolve the EXACT document instead of by
   * name — defusing the risk `findEntryUuidByName`'s prefix fallback
   * otherwise carries (e.g. two feats where one's name is a prefix of the
   * other's).
   */
  sourceId?: string;
}

export interface AutoFeatureModel {
  name: string;
  locked: true;
  /**
   * Pack the chip's description lives in. Defaults to class-features-core (a
   * class feature named by `featuresByLevel`); a class-granted ACTION chip
   * (r20-X4 — Elemental Blast / Base Kinesis / Channel Elements / Spellstrike /
   * Arcane Cascade materialized from a class feature's GrantItem) sets
   * "actions-core" so the details panel resolves it in the right pack.
   */
  detailsPackSlug?: string;
  /**
   * The pack-scoped document id (issue #44) for a feature NAMED directly by
   * `classSystem.featuresByLevel[].uuid` — which, despite its name, IS the
   * feature's own `_id` in class-features-core (measured: 221/221 non-choice
   * featuresByLevel entries across the 12 classes resolve this way), NOT a
   * Foundry compendium uuid. Lets the details panel skip name matching
   * entirely for the common case.
   */
  docId?: string;
  /**
   * The `flags.fusion.sourceId` of a MATERIALIZED class-granted action item
   * (r20-X4 — `classGrantedActionChips`). Mutually exclusive with `docId`:
   * a featuresByLevel-named feature carries `docId`; a granted action (which
   * has no featuresByLevel entry of its own) carries `sourceId` from its
   * embedded copy instead.
   */
  sourceId?: string;
}

export interface LevelPlanModel {
  level: number;
  slots: PlanSlotModel[];
  autoFeatures: AutoFeatureModel[];
}

export interface PlanModel {
  abc: AbcCardModel[];
  levels: LevelPlanModel[];
  /** True when no embedded `type: 'class'` item exists — CTA-only mode. */
  needsClass: boolean;
}

// ---------------------------------------------------------------------------
// derivePlan
// ---------------------------------------------------------------------------

const SLOT_TYPE_LABELS: Record<PlanSlotType, string> = {
  abilityBoosts: "Ability Boosts",
  ancestryFeat: "Ancestry Feat",
  classFeat: "Class Feat",
  generalFeat: "General Feat",
  skillFeat: "Skill Feat",
  archetypeFeat: "Archetype Feat",
  hybridStudy: "Hybrid Study",
  kineticGate: "Kinetic Gate",
  instinct: "Instinct",
  racket: "Rogue's Racket",
  huntersEdge: "Hunter's Edge",
  arcaneThesis: "Arcane Thesis",
  arcaneSchool: "Arcane School",
  bloodline: "Bloodline",
  muse: "Muse",
  cause: "Cause",
  doctrine: "Doctrine",
  order: "Druidic Order",
  blessing: "Blessing of the Devoted",
  skillTraining: "Skill Training",
  skillIncrease: "Skill Increase",
  grantedFeat: "Granted Feat",
  adoptedAncestryChoice: "Adopted Ancestry",
  classLevel: "Class Level",
};

// ---------------------------------------------------------------------------
// Multiclass by class levels — the variant's Plan surface (specs/30)
// ---------------------------------------------------------------------------

/** Is the class-levels variant on for this actor? */
export function getClassLevelsVariant(sys: Record<string, unknown>): boolean {
  const build = asRecord(sys["build"]);
  const variantRules = asRecord(build["variantRules"]);
  return variantRules["classLevels"] === true;
}

/** A class the character already has on the sheet. */
export interface SheetClassOption {
  /** Stable identity — `flags.fusion.sourceId`, never the name. */
  sourceId: string;
  name: string;
  itemId: string | undefined;
}

/** Every embedded `type: 'class'` item, in sheet order. */
export function classesOnSheet(doc: Record<string, unknown>): SheetClassOption[] {
  const out: SheetClassOption[] = [];
  const seen = new Set<string>();
  for (const item of getItems(doc)) {
    if (item["type"] !== "class") continue;
    const fusion = asRecord(asRecord(item["flags"])["fusion"]);
    const sourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
    const itemId = typeof item["_id"] === "string" ? item["_id"] : undefined;
    const key = sourceId ?? itemId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceId: key, name: itemName(item) ?? "", itemId });
  }
  return out;
}

/**
 * Can a BRAND NEW class be taken at this character level?
 *
 * House rule of this table: a new class enters only at level 1 (the first
 * class) or at an EVEN level — the same cadence as the class feat, so picking
 * up a class costs the level where the class would have paid you a feat.
 * Odd levels must continue a class the character already has.
 *
 * Deliberately a pure function of the level: it is a rule, not a lookup, and
 * the Plan, the picker and the op builder all have to agree on it.
 */
export function canTakeNewClassAt(level: number): boolean {
  return level === 1 || level % 2 === 0;
}

/**
 * The classes offerable at `level`: everything when a new class may enter,
 * only the ones already on the sheet otherwise.
 *
 * Returns `null` for "no restriction" (any class from the compendium is
 * allowed); an array restricts the picker to those sourceIds.
 */
export function classOptionsAt(
  doc: Record<string, unknown>,
  level: number,
): SheetClassOption[] | null {
  if (canTakeNewClassAt(level)) return null;
  return classesOnSheet(doc);
}

/** The `classLevel` choice recorded for a character level, if any. */
function classLevelChoiceAt(choices: BuildChoice[], level: number): BuildChoice | undefined {
  return choices.find((c) => c.type === "classLevel" && c.level === level);
}

/**
 * Resolve a choice's `ref` to a class on the sheet.
 *
 * `ref` may be the bare sourceId (what `chooseClassLevel` writes) or a full
 * compendium uuid ending in it (what an import or a hand-authored sheet may
 * carry). The SERVER already matches tolerantly — `resolveClassLevels` in
 * systems/pf2e uses `ref.includes(key)` — so the client has to as well, or the
 * same sheet reads as "Guerreiro 1" on one side and as a raw uuid on the
 * other.
 */
export function resolveClassRef(
  ref: string | undefined,
  sheetClasses: SheetClassOption[],
): SheetClassOption | undefined {
  if (!ref) return undefined;
  return (
    sheetClasses.find((c) => c.sourceId === ref) ??
    sheetClasses.find((c) => ref.includes(c.sourceId)) ??
    sheetClasses.find((c) => c.itemId !== undefined && ref.includes(c.itemId))
  );
}

/**
 * How many levels the character has in each class, counting only up to
 * `upTo` — the running tally the Plan shows as "Guerreiro 3".
 */
export function classLevelTally(
  choices: BuildChoice[],
  upTo: number,
  sheetClasses: SheetClassOption[] = [],
): Map<string, number> {
  const tally = new Map<string, number>();
  for (let lvl = 1; lvl <= upTo; lvl++) {
    const choice = classLevelChoiceAt(choices, lvl);
    const ref = choice?.ref;
    if (!ref) continue;
    // Normalize to the sheet's own identity so a uuid ref and a bare sourceId
    // ref for the SAME class count as one class, not two.
    const key = resolveClassRef(ref, sheetClasses)?.sourceId ?? ref;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return tally;
}

/** The build choices recorded on a document (convenience for callers holding a doc). */
export function buildChoicesOf(doc: Record<string, unknown>): BuildChoice[] {
  return getBuildChoices(getSystem(doc));
}

/** The class that bought a character level, plus that class's own level there. */
export interface ClassLevelOwner {
  sourceId: string;
  name: string;
  system: ClassSystemLike;
  /** Nth level IN that class — what its features and feats are indexed by. */
  classLevel: number;
}

/**
 * Which class bought `level`, and its class level there.
 *
 * Returns undefined when no class is assigned to the level yet — the caller
 * falls back to the sheet's primary class so an unfilled level still shows a
 * plausible plan instead of going blank.
 */
export function classOwnerAt(
  doc: Record<string, unknown>,
  choices: BuildChoice[],
  level: number,
): ClassLevelOwner | undefined {
  const choice = classLevelChoiceAt(choices, level);
  if (!choice?.ref) return undefined;
  const sheetClasses = classesOnSheet(doc);
  const resolved = resolveClassRef(choice.ref, sheetClasses);
  if (!resolved) return undefined;

  const item = getItems(doc).find((it) => {
    if (it["type"] !== "class") return false;
    const fusion = asRecord(asRecord(it["flags"])["fusion"]);
    const sourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
    return (sourceId ?? it["_id"]) === resolved.sourceId;
  });
  if (!item) return undefined;

  const classLevel = classLevelTally(choices, level, sheetClasses).get(resolved.sourceId) ?? 1;
  return {
    sourceId: resolved.sourceId,
    name: resolved.name,
    system: asRecord(item["system"]) as unknown as ClassSystemLike,
    classLevel,
  };
}

/**
 * The "Nível de classe" slot for one character level.
 *
 * Label carries the running class level ("Guerreiro 3") because that number —
 * not the character level — is what gates this class's features and feats.
 */
function resolveClassLevelSlot(
  level: number,
  choices: BuildChoice[],
  doc: Record<string, unknown>,
): PlanSlotModel {
  const slotId = `classLevel-${String(level)}`;
  const choice = classLevelChoiceAt(choices, level);
  const sheetClasses = classesOnSheet(doc);
  const chosen = resolveClassRef(choice?.ref, sheetClasses);

  if (!choice?.ref) {
    return {
      slotId,
      type: "classLevel",
      label: SLOT_TYPE_LABELS.classLevel,
      filled: false,
    };
  }

  const tally = classLevelTally(choices, level, sheetClasses);
  const classLevel = tally.get(chosen?.sourceId ?? choice.ref) ?? 1;
  // Falling back to the raw ref would print a uuid at the player; when the
  // class cannot be resolved the slot says so instead of pretending.
  const name = chosen?.name ?? "?";

  return {
    slotId,
    type: "classLevel",
    label: SLOT_TYPE_LABELS.classLevel,
    filled: true,
    choiceName: `${name} ${String(classLevel)}`,
  };
}

// ---------------------------------------------------------------------------
// Class-declared CHOICE slots (r19-W2b — end of the Magus/hybridStudy hardcode)
//
// Some classes declare a level-1 (or later) CHOICE POINT as a placeholder
// entry in their `featuresByLevel` table: the Magus's "Hybrid Study", the
// Kineticist's "Kinetic Gate". Those become a pickable Plan slot instead of a
// locked auto-feature chip. This map is the SINGLE declarative source of truth
// for "which class-feature placeholder name materializes which slot type" —
// 100% fed by the pack's own featuresByLevel data (the class doc carries only
// `{level, uuid, name}` per feature, so the reliable structural key is the
// placeholder NAME the pack author wrote, exactly as `classHasKineticGate`
// already keyed on it in r18-N2c). Adding a new choice-driven class feature =
// one entry here + its picker wiring in PlanColumn; NEVER an `if (className ===
// "magus")` branch. A class gets the hybridStudy slot ONLY when its
// featuresByLevel declares "Hybrid Study" — so a Kineticist (Finn) no longer
// shows a phantom Estudo Híbrido, and any future class lights up its own
// choice slots just by shipping the right pack data.
// ---------------------------------------------------------------------------

export const CLASS_CHOICE_SLOTS: Record<string, PlanSlotType> = {
  "Hybrid Study": "hybridStudy",
  "Kinetic Gate": "kineticGate",
  Instinct: "instinct",
  "Rogue's Racket": "racket",
  "Hunter's Edge": "huntersEdge",
  "Arcane Thesis": "arcaneThesis",
  "Arcane School": "arcaneSchool",
  Bloodline: "bloodline",
  Muses: "muse",
  Cause: "cause",
  Doctrine: "doctrine",
  // r28: the Druid's axis feature is named "Druidic Order" in the vendor's
  // items{} map (the 9 options are "<Name> Order", tagged `druid-order`).
  "Druidic Order": "order",
  "Blessing of the Devoted": "blessing",
};

/**
 * The choice-slot types a class declares at `level`, read from its
 * `featuresByLevel` via CLASS_CHOICE_SLOTS (in declaration order). Pure — the
 * only signal is the class doc's own data, never the class name.
 */
function classChoiceSlotsAtLevel(classSystem: ClassSystemLike, level: number): PlanSlotType[] {
  const out: PlanSlotType[] = [];
  for (const feature of classSystem.featuresByLevel ?? []) {
    if (feature.level !== level) continue;
    const slotType = CLASS_CHOICE_SLOTS[feature.name];
    if (slotType) out.push(slotType);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Granted feat choices (W1-D) — feats that grant a NESTED feat choice via the
// vendor's ChoiceSet+GrantItem rule pair (unconverted — see
// systems/pf2e/packs/feats-core's `flags.fusion.unconvertedRules`, e.g. Basic
// Concoction: `{"key":"ChoiceSet","choices":{"itemType":"feat","filter":
// ["item:category:class","item:trait:alchemist",{"lte":["item:level",2]}]}}`
// paired with a `rules[].kind === "grant-item"` whose uuid is the in-memory
// ChoiceSet placeholder `{item|flags.system.rulesSelections.<flag>}`).
//
// The server does NOT resolve ChoiceSet (V2 — generic ChoiceSet interpretation
// is explicitly out of scope for R11). This table is a CLIENT-SIDE, hand-
// curated mirror of the handful of core feats whose grant is "pick a feat
// meeting these declarative predicates" — extend it as new cases are found,
// one entry per granting feat's name (matched via `nameToSlug`, the same
// name→slug convention `planContext` already uses for class/ancestry — core
// feat docs carry no dedicated `system.slug` field, see W1-D investigation).
// ---------------------------------------------------------------------------

/** A single declarative predicate the granted feat's compendium index entry must satisfy. */
export type GrantedFeatPredicate =
  | { kind: "category"; value: string }
  | { kind: "trait"; value: string }
  | { kind: "levelAtMost"; value: number };

export interface GrantedFeatFilter {
  /** i18n key suffix for the sub-slot's label, e.g. "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction". */
  labelKey: string;
  predicates: GrantedFeatPredicate[];
}

/**
 * GRANTED_FEAT_CHOICES — keyed by `nameToSlug(grantingFeat.name)`.
 *
 * Basic Concoction (feats-core, Pathfinder Player Core 2): "You gain a 1st-
 * or 2nd-level alchemist feat." — filter confirmed against the vendor's
 * unconverted ChoiceSet: category "class", trait "alchemist", level <= 2.
 */
export const GRANTED_FEAT_CHOICES: Record<string, GrantedFeatFilter> = {
  "basic concoction": {
    labelKey: "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction",
    predicates: [
      { kind: "category", value: "class" },
      { kind: "trait", value: "alchemist" },
      { kind: "levelAtMost", value: 2 },
    ],
  },
};

/** Look up a granting feat's nested-choice filter by its (embedded item) name. */
export function grantedFeatChoiceFor(featName: string | undefined): GrantedFeatFilter | undefined {
  const slug = nameToSlug(featName);
  return slug ? GRANTED_FEAT_CHOICES[slug] : undefined;
}

/**
 * Evaluate a `GrantedFeatFilter` against a candidate feat's minimal doc shape
 * (same `FeatDocLike` shape `isFeatEligible` already consumes) — pure,
 * non-blocking, mirrors `isFeatEligible`'s style exactly.
 */
export function matchesGrantedFeatFilter(featDoc: FeatDocLike, filter: GrantedFeatFilter): boolean {
  const sys = featDoc.system ?? {};
  const category = sys.category ?? "general";
  const level = sys.level ?? 1;
  const traits = sys.traits?.value ?? [];

  return filter.predicates.every((p) => {
    switch (p.kind) {
      case "category":
        return category === p.value;
      case "trait":
        return traits.includes(p.value);
      case "levelAtMost":
        return level <= p.value;
    }
  });
}

// ---------------------------------------------------------------------------
// Adopted Ancestry sub-slot — keyed by `nameToSlug(grantingFeat.name)`, same
// hand-authored-table convention as GRANTED_FEAT_CHOICES above (a feat NAME
// unlocks a nested pick; here the pick is an ANCESTRY, not another feat).
//
// SOURCE — the vendor's unconverted ChoiceSet/set-property rule pair on
// "Adopted Ancestry" (feats-core, _id pP1ESEvFaPyF2OFM,
// `flags.fusion.unconvertedRules`: `{key:"ChoiceSet", choices:{itemType:
// "ancestry", filter:[{not:"item:slug:{actor|system.details.ancestry.trait}"}]}}`
// paired with `set-property` writing the pick to
// `system.details.ancestry.adopted`) is ALSO already summarized, structurally,
// by the importer's overlay at systems/pf2e/packs/feats-core/mechanics.json
// (key "pP1ESEvFaPyF2OFM" → `unlocks: [{kind: "ancestry-feat-eligibility",
// mechanism: "adopted-ancestry", filters: {excludeOwnAncestry: true}}]`). The
// client does not consume mechanics.json anywhere yet (only GRANTED_FEAT_
// CHOICES's hand-authored table pattern is wired up) — this table is the
// SAME kind of hand-authored mirror, kept in sync by hand like its sibling.
// A future client-side mechanics.json consumer could replace both tables at
// once; doing so here would be a much larger, out-of-scope change (a new pack-
// loading/consumption layer) for a single feat.
//
// FUSION MODEL: Fusion's actor has no `system.details.ancestry` scalar field
// at all (ancestry is an embedded `type: "ancestry"` ITEM, see
// `findFirstItemByType(doc, "ancestry")` — planContext's own `ancestrySlug`).
// So the adopted pick is recorded the same way skill training/increase
// choices are (a `system.build.choices` entry, no embedded item), using the
// otherwise-unused `BuildChoice.ref` field to carry the picked ancestry's
// NAME (not slug — the stored name flows through PlanColumn's existing
// pt-BR/EN content-name translator, same as every other pack-sourced choice
// name). `planContext.adoptedAncestrySlug` derives the slug from it for
// ancestry-feat eligibility (`isFeatEligible`).
// ---------------------------------------------------------------------------

/** Declares that a feat NAME unlocks an adopted-ancestry sub-slot. Only one entry today ("Adopted Ancestry" itself), structured as a table (not a single flag) so a future feat with the same mechanism needs only a new entry. */
export interface AncestryChoiceGrant {
  /** i18n key for the sub-slot's label, e.g. "FUSION.Sheet.Plan.SlotLabel.adoptedAncestryChoice". */
  labelKey: string;
}

export const ANCESTRY_CHOICE_GRANTS: Record<string, AncestryChoiceGrant> = {
  "adopted ancestry": {
    labelKey: "FUSION.Sheet.Plan.SlotLabel.adoptedAncestryChoice",
  },
};

/** Look up a granting feat's adopted-ancestry sub-slot config by its (embedded item) name. */
export function ancestryChoiceGrantFor(
  featName: string | undefined,
): AncestryChoiceGrant | undefined {
  const slug = nameToSlug(featName);
  return slug ? ANCESTRY_CHOICE_GRANTS[slug] : undefined;
}

/**
 * isAncestryAdoptable — the `adoptedAncestryChoice` picker's eligibility
 * predicate (PlanColumn's pickerConfigFor filterFn): a candidate
 * ancestries-core doc is offered as long as its name is NOT the character's
 * OWN ancestry. Mirrors the vendor ChoiceSet's `{not: "item:slug:{actor|
 * system.details.ancestry.trait}"}` filter (see the ANCESTRY_CHOICE_GRANTS
 * doc comment above) — exported/pure so both the picker AND its tests share
 * the exact same comparison, same split responsibility as
 * `matchesGrantedFeatFilter`/`isClassChoiceOption` for their own pickers.
 */
export function isAncestryAdoptable(
  candidateName: string,
  ownAncestrySlug: string | undefined,
): boolean {
  return nameToSlug(candidateName) !== ownAncestrySlug;
}

/**
 * planContext — small bundle of facts the Plan column's pickers need beyond
 * the slot model itself: the character's level, and the class/ancestry
 * "slug" used to match feat traits (feats-core tags feats with the class/
 * ancestry NAME lowercased, e.g. "Magus" → "magus" — confirmed against
 * systems/pf2e/packs/{classes,ancestries,feats}-core; there is no dedicated
 * `slug` field on class/ancestry item docs as of R10-B).
 */
export interface PlanContext {
  level: number;
  classSlug?: string;
  ancestrySlug?: string;
  /**
   * The ancestry the character ADOPTED via the "Adopted Ancestry" general
   * feat (see ADOPTED_ANCESTRY_GRANTS below) — read from the
   * `adoptedAncestryChoice` sub-slot's recorded choice, if any. Mirrors the
   * vendor rule element's `system.details.ancestry.adopted` (Fusion has no
   * such actor field; the pick lives in `system.build.choices` instead, see
   * `chooseAdoptedAncestry`). Feeds `isFeatEligible`'s ancestryFeat branch so
   * the adopted ancestry's OWN feats become eligible in the ancestry-feat
   * slot alongside the character's real ancestry.
   */
  adoptedAncestrySlug?: string;
  /** The class's chosen key ability (system.keyAbility[0] once narrowed by applyClass). */
  keyAbility?: string;
}

/** Lowercase/trim a content NAME into the slug convention feats-core tags traits with (e.g. "Magus" → "magus"). Exported for pickers that need to compare a candidate doc's name against `ancestrySlug`/`adoptedAncestrySlug` (see PlanColumn's Adopted Ancestry picker filter). */
export function nameToSlug(name: string | undefined): string | undefined {
  return name?.trim().toLowerCase() || undefined;
}

/**
 * The adopted ancestry NAME recorded by an `adoptedAncestryChoice` sub-slot
 * choice (see `chooseAdoptedAncestry`), if the player has picked one anywhere
 * in the build. There is at most one Adopted Ancestry feat per character
 * (not repeatable), so the first match is authoritative.
 */
function readAdoptedAncestryName(sys: Record<string, unknown>): string | undefined {
  const choice = getBuildChoices(sys).find(
    (c) => c.type === "adoptedAncestryChoice" && c.ref !== undefined,
  );
  return choice?.ref;
}

export function planContext(doc: Record<string, unknown>): PlanContext {
  const classItem = findFirstItemByType(doc, "class");
  const ancestryItem = findFirstItemByType(doc, "ancestry");
  const classSys = asRecord(classItem?.["system"]);
  const keyAbilityArr = asStringArray(classSys["keyAbility"]);
  return {
    level: getLevel(doc),
    ...withOptional("classSlug", nameToSlug(itemName(classItem))),
    ...withOptional("ancestrySlug", nameToSlug(itemName(ancestryItem))),
    ...withOptional("adoptedAncestrySlug", nameToSlug(readAdoptedAncestryName(getSystem(doc)))),
    ...withOptional("keyAbility", keyAbilityArr[0]),
  };
}

/**
 * Compute the "Plano" column's data model.
 *
 * `doc` is the live actor document (with `system.build` + embedded items).
 * Without an embedded `type: 'class'` item, only the ABC cards are returned
 * (ancestry/heritage/background if present) plus `needsClass: true` and an
 * empty `levels` array — the caller renders the "Escolher classe" CTA
 * instead of level cards (DEC-R10-01 compat gate).
 */
export function derivePlan(doc: Record<string, unknown>): PlanModel {
  const sys = getSystem(doc);
  const classSystem = readClassSystem(doc);
  const level = getLevel(doc);

  const abc = buildAbcCards(doc);

  if (!classSystem) {
    return { abc, levels: [], needsClass: true };
  }

  const choices = getBuildChoices(sys);
  const freeArchetype = getFreeArchetype(sys);
  const items = getItems(doc);
  const abilities = getBuildAbilities(sys);

  const levels: LevelPlanModel[] = [];
  for (let lvl = 1; lvl <= level; lvl++) {
    levels.push(
      buildLevelPlan(lvl, classSystem, choices, items, freeArchetype, doc, abilities, level),
    );
  }

  return { abc, levels, needsClass: false };
}

/**
 * heritageAncestryIssue — a heritage is only valid for the SPECIFIC ancestry
 * it declares (`system.ancestry.slug`, e.g. "ratfolk" — see
 * systems/pf2e/packs/heritages-core). Frente 3: after an ancestry swap, a
 * heritage picked under the OLD ancestry stays on the sheet (never
 * auto-removed) but gets marked, since it no longer matches.
 */
function heritageAncestryIssue(
  heritage: Record<string, unknown> | undefined,
  ancestry: Record<string, unknown> | undefined,
): RequirementIssue | undefined {
  if (!heritage) return undefined;
  const heritageAncestrySlug = asRecord(asRecord(heritage["system"])["ancestry"])["slug"];
  if (typeof heritageAncestrySlug !== "string") return undefined;
  const currentAncestrySlug = nameToSlug(itemName(ancestry));
  if (!currentAncestrySlug || heritageAncestrySlug === currentAncestrySlug) return undefined;
  return {
    reasonKey: "FUSION.Sheet.Plan.Requirement.HeritageWrongAncestry",
    params: { ancestry: capitalizeSlug(heritageAncestrySlug) },
  };
}

function buildAbcCards(doc: Record<string, unknown>): AbcCardModel[] {
  const cards: AbcCardModel[] = [];
  const items = getItems(doc);

  const ancestry = findFirstItemByType(doc, "ancestry");
  cards.push({
    kind: "ancestry",
    filled: ancestry !== undefined,
    ...withOptional("name", itemName(ancestry)),
    ...withOptional("chips", abcChipsFor(ancestry, items, "ancestry")),
  });

  const heritage = findFirstItemByType(doc, "heritage");
  cards.push({
    kind: "heritage",
    filled: heritage !== undefined,
    ...withOptional("name", itemName(heritage)),
    ...withOptional("chips", abcChipsFor(heritage, items, "heritage")),
    ...withOptional("requirementIssue", heritageAncestryIssue(heritage, ancestry)),
  });

  const background = findFirstItemByType(doc, "background");
  cards.push({
    kind: "background",
    filled: background !== undefined,
    ...withOptional("name", itemName(background)),
    ...withOptional("chips", abcChipsFor(background, items, "background")),
  });

  const classItem = findFirstItemByType(doc, "class");
  const hybridStudy = findHybridStudyChoiceName(doc);
  cards.push({
    kind: "class",
    filled: classItem !== undefined,
    ...withOptional("name", itemName(classItem)),
    ...withOptional("subLine", hybridStudy ? `Hybrid Study: ${hybridStudy}` : undefined),
  });

  return cards;
}

/** English display labels for PF2e size codes (informative ancestry chip). */
const SIZE_LABELS: Record<string, string> = {
  tiny: "Tiny",
  sm: "Small",
  med: "Medium",
  lg: "Large",
  huge: "Huge",
  grg: "Gargantuan",
};

/** English display labels for the ancestry `system.vision` scalar. */
const VISION_LABELS: Record<string, string> = {
  "low-light-vision": "Low-Light Vision",
  darkvision: "Darkvision",
  "greater-darkvision": "Greater Darkvision",
  normal: "Normal Vision",
};

/**
 * abcChipsFor — the locked chips shown under an ABC card (r20-X4). Two sources:
 *
 *  1. The ABC item's `system.items` map of auto-conceded features. A feature
 *     that MATERIALIZED (an embedded item tagged `grantedBy === <abcSourceId>`,
 *     matched by normalized name) becomes a CLICKABLE chip routed to that
 *     item's pack; an unresolved feature (no clean-room pack, e.g. Unusual
 *     Anatomy / Sharp Teeth) becomes an INFORMATIVE chip from the map metadata.
 *  2. For ancestry only: informative scalar chips for Size + Vision.
 *
 * Deduplicated by normalized name so a materialized feature and its map entry
 * never both render. Returns undefined (not an empty array) when there are no
 * chips, so `withOptional` omits the field on cards that have none.
 */
function abcChipsFor(
  abcItem: Record<string, unknown> | undefined,
  items: Array<Record<string, unknown>>,
  kind: AbcKind,
): AbcChip[] | undefined {
  if (!abcItem) return undefined;
  const chips: AbcChip[] = [];
  const seen = new Set<string>();
  const sys = asRecord(abcItem["system"]);
  const abcSourceId = itemFusionSourceId(abcItem);

  // Materialized grants of THIS ABC (embedded items tagged grantedBy=abcSourceId).
  if (abcSourceId) {
    for (const it of items) {
      if (itemFusion(it)["grantedBy"] !== abcSourceId) continue;
      const name = itemName(it);
      if (!name) continue;
      const norm = normalizeName(name);
      if (seen.has(norm)) continue;
      seen.add(norm);
      chips.push({
        key: `grant:${typeof it["_id"] === "string" ? it["_id"] : norm}`,
        name,
        detailsPackSlug: grantedItemPackSlug(it),
        ...withOptional("sourceId", itemFusionSourceId(it)),
      });
    }
  }

  // Remaining `system.items` map entries that did NOT materialize → informative.
  const map = asRecord(sys["items"]);
  for (const [mapKey, raw] of Object.entries(map)) {
    const entry = asRecord(raw);
    const name = typeof entry["name"] === "string" ? entry["name"] : undefined;
    if (!name) continue;
    const norm = normalizeName(name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const level = typeof entry["level"] === "number" ? entry["level"] : undefined;
    chips.push({ key: `item:${mapKey}`, name, ...withOptional("level", level) });
  }

  // Ancestry-only informative scalars: Size + Vision.
  if (kind === "ancestry") {
    const size = sys["size"];
    if (typeof size === "string") {
      chips.push({ key: "scalar:size", name: SIZE_LABELS[size] ?? `Size: ${size}` });
    }
    const vision = sys["vision"];
    if (typeof vision === "string" && vision !== "normal") {
      chips.push({ key: "scalar:vision", name: VISION_LABELS[vision] ?? vision });
    }
  }

  return chips.length > 0 ? chips : undefined;
}

function findHybridStudyChoiceName(doc: Record<string, unknown>): string | undefined {
  const items = getItems(doc);
  for (const item of items) {
    if (item["type"] !== "classFeature") continue;
    const flag = getItemBuildFlag(item);
    if (flag?.slot !== "hybridStudy-1") continue;
    const name = item["name"];
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

/**
 * Build the slots for a single level from the class's progression tables,
 * cross-referenced with the actor's embedded items (via
 * `flags.fusion.build`) and `system.build.choices`.
 *
 * Slot id convention: `<type>-<level>` for single-slot-per-level types
 * (abilityBoosts, hybridStudy), `<type>-<level>-<index>` when a level can
 * carry more than one slot of the same type (e.g. level 1's ancestry feat +
 * skill trainings — though ancestry/class/general/skill feats only ever
 * grant one slot per level in the PF2e Remaster cadence, so the `-<index>`
 * suffix is defensive for future classes/homebrew).
 */
function buildLevelPlan(
  level: number,
  classSystem: ClassSystemLike,
  choices: BuildChoice[],
  items: Array<Record<string, unknown>>,
  freeArchetype: boolean,
  doc: Record<string, unknown>,
  abilities: BuildAbilities,
  charLevel: number,
): LevelPlanModel {
  const slots: PlanSlotModel[] = [];

  // Multiclass variant: FIRST slot of every level is "which class bought it".
  // It comes first because every other slot in the level is downstream of the
  // answer — the class decides which features and feats this level offers.
  const variantOn = getClassLevelsVariant(getSystem(doc));
  if (variantOn) {
    slots.push(resolveClassLevelSlot(level, choices, doc));
  }

  // Under the variant, the CLASS side of this level (features, class-choice
  // slots, class feat) belongs to whichever class bought the level, read at
  // ITS OWN class level — taking the 1st level of Magus at character level 3
  // grants Magus's level-1 package, not Magus's level-3 one.
  //
  // The CHARACTER side (ancestry/general/skill feats, ability boosts, skill
  // increases) is deliberately NOT rerouted: that cadence follows the
  // character level and does not change with the split (REQ-MCL-042).
  const levelOwner = variantOn ? classOwnerAt(doc, choices, level) : undefined;
  const classSource = levelOwner?.system ?? classSystem;
  const classSourceLevel = levelOwner?.classLevel ?? level;
  const featLevels = classSource.featLevels ?? {};

  // Level 1: 4 ability boosts (fixed PF2e Remaster rule).
  if (level === 1) {
    slots.push(resolveAbilityBoostsSlot(`abilityBoosts-1`, level, doc));
  }

  // Class-declared CHOICE slots (hybrid study, kinetic gate, …) — 100% DATA-
  // DRIVEN from featuresByLevel via CLASS_CHOICE_SLOTS (r19-W2b: no
  // `if (className === "magus")`). A class gets the hybridStudy slot ONLY when
  // it declares a "Hybrid Study" placeholder, the kineticGate slot ONLY when it
  // declares "Kinetic Gate", etc. Emitted at whatever level the placeholder is
  // declared (both are level 1 in the current packs, but this is level-agnostic).
  for (const choiceType of classChoiceSlotsAtLevel(classSource, classSourceLevel)) {
    const choiceSlot = resolveSlot(
      choiceType,
      `${choiceType}-${String(level)}`,
      level,
      choices,
      items,
    );
    slots.push(choiceSlot);
    // r15 A2: a filled study/feature may materialize fixed grants (Starlit Span
    // → Shooting Star) — surface them as locked nested chips under the choice.
    pushFixedGrantChips(slots, choiceSlot, items);
    // r19-W2b: a chosen Kinetic Gate grants impulse sub-slots — one per gate
    // element — Pathbuilder-style nested picks filtered to that element.
    if (choiceType === "kineticGate") {
      pushGateImpulseSubSlots(slots, choiceSlot, level, choices, items, doc);
    }
  }

  // Levelled ability boosts (5/10/15/20 by default, or the class's own set).
  const abilityBoostLevels = classSystem.abilityBoostLevels ?? [5, 10, 15, 20];
  if (level !== 1 && abilityBoostLevels.includes(level)) {
    slots.push(resolveAbilityBoostsSlot(`abilityBoosts-${String(level)}`, level, doc));
  }

  // Feat slots by category. Each pushes its own resolved slot immediately
  // followed by a nested `grantedFeat` sub-slot (W1-D) when the chosen feat
  // grants one (see `pushFeatSlotWithGrant`) — keeping the parent and its
  // sub-slot adjacent in `slots[]` is what lets LevelCard render the sub-slot
  // indented directly under its parent without a second pass.
  if ((featLevels.ancestry ?? []).includes(level)) {
    pushFeatSlotWithGrant(
      slots,
      "ancestryFeat",
      `ancestryFeat-${String(level)}`,
      level,
      choices,
      items,
    );
  }
  // Class feat: the CADENCE stays on the character level (a class feat at 1
  // and on every even level — REQ-MCL-040), because rerouting it to the class
  // level would hand out an extra feat every time a new class enters. What the
  // class of this level decides is WHICH feats are offerable, not how many.
  const classFeatHere = variantOn
    ? level === 1 || level % 2 === 0
    : (featLevels.class ?? []).includes(level);
  if (classFeatHere) {
    pushFeatSlotWithGrant(slots, "classFeat", `classFeat-${String(level)}`, level, choices, items);
  }
  if ((featLevels.general ?? []).includes(level)) {
    pushFeatSlotWithGrant(
      slots,
      "generalFeat",
      `generalFeat-${String(level)}`,
      level,
      choices,
      items,
    );
  }
  if ((featLevels.skill ?? []).includes(level)) {
    pushFeatSlotWithGrant(slots, "skillFeat", `skillFeat-${String(level)}`, level, choices, items);
  }

  // Free Archetype: an extra archetype feat slot on even levels.
  if (freeArchetype && level % 2 === 0) {
    const slot = resolveSlot(
      "archetypeFeat",
      `archetypeFeat-${String(level)}`,
      level,
      choices,
      items,
    );
    slot.optional = true;
    slots.push(slot);
    pushGrantedFeatSubSlot(slots, slot, level, choices, items);
    pushFixedGrantChips(slots, slot, items);
  }

  // Skill increases.
  if ((classSystem.skillIncreaseLevels ?? []).includes(level)) {
    slots.push(
      resolveSlot("skillIncrease", `skillIncrease-${String(level)}`, level, choices, items),
    );
  }

  // Level 1: trained-skill free choices — trainedSkills.additional PLUS the
  // Int modifier computed from the CURRENT boost ledger (issue #4 / audit
  // r10 final #4): a character with Int +3 gets 3 extra skill slots on top
  // of the class's additional count. Recomputed from `abilities` on every
  // derivePlan call, so it reacts immediately when boosts change (no stale
  // slot count after the player edits ability boosts).
  if (level === 1) {
    const additional = classSystem.trainedSkills?.additional ?? 0;
    const total = trainedSkillCount(additional, abilities, charLevel);
    for (let i = 0; i < total; i++) {
      slots.push(
        resolveSlot("skillTraining", `skillTraining-1-${String(i)}`, level, choices, items),
      );
    }
  }

  // Class features named directly by featuresByLevel (Impulses, Kinetic Aura,
  // Spellstrike, Arcane Cascade, Conflux Spells…) — locked NAME chips — PLUS the
  // actions those features concede via GrantItem (r20-X4 — Elemental Blast +
  // Base Kinesis from Impulses, Channel Elements from Kinetic Aura). A conceded
  // action whose NAME matches a feature already listed (Magus's Spellstrike
  // feature vs the Spellstrike action) is skipped so the strip carries no
  // duplicate chip (a duplicate would also collide on the render key).
  const autoFeatures: AutoFeatureModel[] = [];
  const autoSeen = new Set<string>();
  for (const f of classSource.featuresByLevel ?? []) {
    if (f.level !== classSourceLevel || isChoiceFeature(f)) continue;
    const norm = normalizeName(f.name);
    if (autoSeen.has(norm)) continue;
    autoSeen.add(norm);
    autoFeatures.push({
      name: f.name,
      locked: true,
      ...withOptional(
        "docId",
        typeof f.uuid === "string" && f.uuid.length > 0 ? f.uuid : undefined,
      ),
    });
  }
  for (const chip of classGrantedActionChips(doc, level)) {
    const norm = normalizeName(chip.name);
    if (autoSeen.has(norm)) continue;
    autoSeen.add(norm);
    autoFeatures.push(chip);
  }

  // Frente 3 (DEC-BC-05): mark, never hide/block, a filled slot whose
  // backing item no longer meets its requirement (a class/ancestry swap
  // elsewhere, or simply outgrowing its level window). Reads the CURRENT
  // class/ancestry off `doc` — the same source `planContext()` uses — so this
  // always reflects the character's LATEST class/ancestry, not the one the
  // pick was originally made under.
  attachRequirementIssues(slots, items, charLevel, planContext(doc), classSystem);

  return { level, slots: collapseSkillSlotGroups(slots), autoFeatures };
}

/**
 * classGrantSlot — the `flags.fusion.grantedSlot` marker stamped on an action
 * conceded by a class feature (r20-X4). Encodes the granting feature's LEVEL +
 * normalized name so the Plan can nest the chip at the right level card and the
 * heal stays idempotent. Format: `classFeature:<level>:<normName>`.
 */
export function classGrantSlot(level: number, featureName: string): string {
  return `classFeature:${String(level)}:${normalizeName(featureName)}`;
}

/**
 * classGrantedActionChips — locked chips for the actions a class's features
 * concede at `level` (materialized as embedded items tagged
 * grantedBy=<classSourceId>, grantedSlot=`classFeature:<level>:…`). Deduped by
 * normalized name. Empty for a class whose features grant no fixed actions.
 */
function classGrantedActionChips(doc: Record<string, unknown>, level: number): AutoFeatureModel[] {
  const classItem = findFirstItemByType(doc, "class");
  const classSourceId = classItem ? itemFusionSourceId(classItem) : undefined;
  if (!classSourceId) return [];
  const out: AutoFeatureModel[] = [];
  const seen = new Set<string>();
  for (const it of getItems(doc)) {
    const fusion = itemFusion(it);
    if (fusion["grantedBy"] !== classSourceId) continue;
    const slot = fusion["grantedSlot"];
    if (typeof slot !== "string" || !slot.startsWith("classFeature:")) continue;
    if (Number(slot.split(":")[1]) !== level) continue;
    const name = itemName(it);
    if (!name) continue;
    const norm = normalizeName(name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({
      name,
      locked: true,
      detailsPackSlug: grantedItemPackSlug(it),
      ...withOptional("sourceId", itemFusionSourceId(it)),
    });
  }
  return out;
}

/**
 * collapseSkillSlotGroups — merge every skillTraining/skillIncrease slot of
 * this level into a SINGLE group slot per type (R11 item 3 — Pathbuilder-
 * style "Treinamento de Perícias (x/N)" entry instead of N one-per-slot
 * rows). Only these two types collapse — every other slot type (feats,
 * abilityBoosts, hybridStudy) still renders one row per slot, since only
 * skillTraining ever produces more than one slot per level in the current
 * model (skillIncrease is always exactly one, but collapsing it too keeps
 * PlanColumn's rendering uniform and future-proofs classes with >1/level).
 *
 * The group slot is "filled" only when EVERY underlying slot is filled
 * (x === N) — a partially-filled group still shows as an open pick with the
 * "(x/N)" progress in its `choiceName`.
 */
function collapseSkillSlotGroups(slots: PlanSlotModel[]): PlanSlotModel[] {
  const rest = slots.filter((s) => s.type !== "skillTraining" && s.type !== "skillIncrease");
  const groups: PlanSlotModel[] = [];
  for (const groupType of ["skillTraining", "skillIncrease"] as const) {
    const members = slots.filter((s) => s.type === groupType);
    const head = members[0];
    if (head === undefined) continue;
    const filledCount = members.filter((s) => s.filled).length;
    const totalCount = members.length;
    groups.push({
      slotId: head.slotId,
      type: groupType,
      label: SLOT_TYPE_LABELS[groupType],
      filled: filledCount === totalCount,
      choiceName: `${String(filledCount)}/${String(totalCount)}`,
      filledCount,
      totalCount,
      groupSlotIds: members.map((s) => s.slotId),
    });
  }
  return [...rest, ...groups];
}

/**
 * Class features that are actually a CHOICE slot (Hybrid Study, Kinetic Gate)
 * must not ALSO appear as a locked auto-feature chip — they're represented by
 * their own choice slot instead. Derived from CLASS_CHOICE_SLOTS (r19-W2b) so
 * the "is this a choice placeholder?" test and the "which slot does it
 * materialize?" map can never drift.
 */
function isChoiceFeature(ref: ClassFeatureRef): boolean {
  return ref.name in CLASS_CHOICE_SLOTS;
}

/**
 * pushFeatSlotWithGrant — resolve a feat slot and, if it ends up filled with
 * a feat that grants a nested feat choice (W1-D), push the resulting
 * `grantedFeat` sub-slot right after it in `slots`.
 */
function pushFeatSlotWithGrant(
  slots: PlanSlotModel[],
  type: PlanSlotType,
  slotId: string,
  level: number,
  choices: BuildChoice[],
  items: Array<Record<string, unknown>>,
): void {
  const slot = resolveSlot(type, slotId, level, choices, items);
  slots.push(slot);
  pushGrantedFeatSubSlot(slots, slot, level, choices, items);
  pushAdoptedAncestrySubSlot(slots, slot, level, choices, items);
  pushFixedGrantChips(slots, slot, items);
}

/**
 * pushFixedGrantChips — for a FILLED feat/feature slot, surface EVERY item the
 * actor holds that was materialized as a FIXED grant of this slot's item
 * (B2 r14 + r15 A2 — `flags.fusion.grantedBy === granterSourceId`). Each
 * becomes a LOCKED nested chip (details-only, no remove) indented under the
 * granter, mirroring the `grantedFeat` sub-slot layout.
 *
 * r15 A2: ALL granted item types render a chip now — feat/classFeature (e.g.
 * Alchemist Dedication → Alchemical Crafting), ACTION (→ Quick Alchemy) and
 * SPELL (Starlit Span → Shooting Star) — so the "Talento concedido" surface
 * shows everything that was conceded, nested to its granter. Each chip's
 * `detailsPackSlug` routes the details panel to the right pack. The Actions/
 * Spells tabs keep showing the same items independently (unchanged).
 *
 * Matched on the granter's `flags.fusion.sourceId` (+ build slot when present)
 * so two copies of the same granting feat in different slots each own their
 * own grants.
 */
function pushFixedGrantChips(
  slots: PlanSlotModel[],
  parentSlot: PlanSlotModel,
  items: Array<Record<string, unknown>>,
): void {
  if (!parentSlot.filled) return;
  const granter = items.find(
    (it) => typeof it["_id"] === "string" && it["_id"] === parentSlot.itemId,
  );
  if (!granter) return;
  const granterSourceId = itemFusionSourceId(granter);
  if (!granterSourceId) return;

  const granted = items.filter((it) => {
    const fusion = itemFusion(it);
    if (fusion["grantedBy"] !== granterSourceId) return false;
    const type = it["type"];
    return type === "feat" || type === "classFeature" || type === "action" || type === "spell";
  });

  for (const item of granted) {
    const itemId = item["_id"];
    const detailsPackSlug = grantedItemPackSlug(item);
    slots.push({
      slotId: `${parentSlot.slotId}:grant:${typeof itemId === "string" ? itemId : (itemName(item) ?? "?")}`,
      type: "grantedFeat",
      label: SLOT_TYPE_LABELS.grantedFeat,
      filled: true,
      parentSlotId: parentSlot.slotId,
      lockedGrant: true,
      detailsPackSlug,
      ...withOptional("choiceName", itemName(item)),
      ...withOptional("itemId", typeof itemId === "string" ? itemId : undefined),
      ...withOptional("sourceId", itemFusionSourceId(item)),
    });
  }
}

/**
 * The Fusion pack a granted item's description lives in, by embedded item
 * type (and, for feats, category). Takes the whole item because an ancestry
 * FEATURE (r20-X5 — Unusual Anatomy, Sharp Teeth) is `type: "feat"` just like a
 * selectable feat, but lives in ancestry-features-core, not feats-core; the
 * `system.category === "ancestryfeature"` marker is the only way to tell them
 * apart. Routing to the wrong pack makes the details dialog resolve the name in
 * a pack that doesn't hold it (empty panel).
 */
function grantedItemPackSlug(item: Record<string, unknown>): string {
  switch (item["type"]) {
    case "classFeature":
      return "class-features-core";
    case "action":
      return "actions-core";
    case "spell":
      return "spells-core";
    case "feat":
      return asRecord(item["system"])["category"] === "ancestryfeature"
        ? "ancestry-features-core"
        : "feats-core";
    default:
      return "feats-core";
  }
}

/** Read `flags.fusion` off an embedded item (never null). */
function itemFusion(item: Record<string, unknown>): Record<string, unknown> {
  const flags = asRecord(item["flags"]);
  return asRecord(flags["fusion"]);
}

/** Read `flags.fusion.sourceId` off an embedded item, if a string. */
function itemFusionSourceId(item: Record<string, unknown>): string | undefined {
  const sid = itemFusion(item)["sourceId"];
  return typeof sid === "string" ? sid : undefined;
}

/**
 * pushGrantedFeatSubSlot — if `parentSlot` is filled with a feat whose name
 * matches `GRANTED_FEAT_CHOICES`, resolve the nested sub-slot (slot id
 * convention `<parentSlotId>:granted`, per the task's lesson-encoded
 * convention) and push it onto `slots`.
 *
 * The sub-slot is item-backed exactly like a normal feat slot — filled when
 * an embedded item carries `flags.fusion.build = { level, slot:
 * "<parentSlotId>:granted" }` — so `resolveSlot`'s own item-lookup logic
 * covers it unchanged; only the sub-slot's extra `parentSlotId`/`grantFilter`
 * fields (for indentation + picker filtering) are added here.
 */
function pushGrantedFeatSubSlot(
  slots: PlanSlotModel[],
  parentSlot: PlanSlotModel,
  level: number,
  choices: BuildChoice[],
  items: Array<Record<string, unknown>>,
): void {
  if (!parentSlot.filled) return;
  const grant = grantedFeatChoiceFor(parentSlot.choiceName);
  if (!grant) return;

  const subSlotId = `${parentSlot.slotId}:granted`;
  const subSlot = resolveSlot("grantedFeat", subSlotId, level, choices, items);
  // Override the generic "Granted Feat" fallback label with the grant's own
  // (still-English, matching every other SLOT_TYPE_LABELS entry's fallback
  // role — the real translation happens in PlanColumn's slotLabel()/i18n via
  // `grantFilter.labelKey`, same split responsibility resolveSlot already has
  // for every other slot type).
  subSlot.label = GRANTED_FEAT_FALLBACK_LABELS[grant.labelKey] ?? SLOT_TYPE_LABELS.grantedFeat;
  subSlot.parentSlotId = parentSlot.slotId;
  subSlot.grantFilter = grant;
  slots.push(subSlot);
}

/** English fallback label per grant labelKey — mirrors SLOT_TYPE_LABELS' role for the fixed slot types. */
const GRANTED_FEAT_FALLBACK_LABELS: Record<string, string> = {
  "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction": "Alchemist Feat (1st-2nd Level)",
};

/**
 * pushAdoptedAncestrySubSlot — if `parentSlot` is filled with a feat whose
 * name matches `ANCESTRY_CHOICE_GRANTS` (today: "Adopted Ancestry"), resolve
 * the nested ancestry-pick sub-slot (slot id convention `<parentSlotId>:
 * ancestry`) and push it onto `slots`, mirroring `pushGrantedFeatSubSlot`'s
 * shape (`parentSlotId` for indentation) but CHOICE-backed only — no embedded
 * item is ever created for this pick (see `chooseAdoptedAncestry`), so
 * `resolveSlot`'s choice-lookup branch (not its item-lookup branch) is what
 * fills it. `removeChoice`'s existing `<slot.slotId>:` prefix cascade already
 * strips this sub-slot's choice entry when the parent feat is removed — no
 * extra cleanup code needed here or there.
 */
function pushAdoptedAncestrySubSlot(
  slots: PlanSlotModel[],
  parentSlot: PlanSlotModel,
  level: number,
  choices: BuildChoice[],
  items: Array<Record<string, unknown>>,
): void {
  if (!parentSlot.filled) return;
  const grant = ancestryChoiceGrantFor(parentSlot.choiceName);
  if (!grant) return;

  const subSlotId = `${parentSlot.slotId}:ancestry`;
  const subSlot = resolveSlot("adoptedAncestryChoice", subSlotId, level, choices, items);
  subSlot.parentSlotId = parentSlot.slotId;
  slots.push(subSlot);
}

function resolveSlot(
  type: PlanSlotType,
  slotId: string,
  level: number,
  choices: BuildChoice[],
  items: Array<Record<string, unknown>>,
): PlanSlotModel {
  // An item-backed slot (feat, hybridStudy) is filled when some embedded
  // item carries flags.fusion.build = { level, slot: slotId }.
  const item = items.find((it) => {
    const flag = getItemBuildFlag(it);
    return flag !== null && flag.level === level && flag.slot === slotId;
  });
  if (item) {
    return {
      slotId,
      type,
      label: SLOT_TYPE_LABELS[type],
      filled: true,
      ...withOptional("choiceName", itemName(item)),
      ...withOptional("itemId", typeof item["_id"] === "string" ? item["_id"] : undefined),
      ...withOptional("sourceId", itemFusionSourceId(item)),
    };
  }

  // A choice-backed slot (abilityBoosts, skillTraining, skillIncrease) is
  // filled when a system.build.choices entry matches this slotId.
  const choice = choices.find((c) => c.slot === slotId && c.level === level);
  if (choice) {
    return {
      slotId,
      type,
      label: SLOT_TYPE_LABELS[type],
      filled: true,
      choiceName: choiceDisplayName(choice),
      ...withOptional("itemId", choice.itemId),
    };
  }

  return { slotId, type, label: SLOT_TYPE_LABELS[type], filled: false };
}

function choiceDisplayName(choice: BuildChoice): string {
  if (choice.skill) {
    const rankLabel = choice.rank !== undefined ? ` (rank ${String(choice.rank)})` : "";
    return `${choice.skill}${rankLabel}`;
  }
  // adoptedAncestryChoice (and any future ref-only pick) stores the picked
  // pack doc's NAME in `ref` — same content-name string PlanColumn's
  // pt-BR/EN translator already resolves for every other choice.
  if (choice.ref) return choice.ref;
  return choice.type;
}

/**
 * resolveAbilityBoostsSlot — an abilityBoosts-N slot's `filled` state is
 * DERIVED from the actual boost ledger (via `abilityBoostsSlotContext` +
 * `isAbilityBoostsSlotFilled`), NOT from a `system.build.choices` marker
 * (R11 item 2 fix — the production bug: a doc can have an `abilityBoosts-1`
 * choice marker recorded with NO backing ancestryFree/backgroundFree/
 * levelledBoosts data at all, which must show as UNFILLED so the player is
 * prompted to actually complete the picks).
 *
 * `choiceName` summarizes the picked free slugs across all groups for
 * display (e.g. "cha, int, dex" for a filled slot), or is omitted while
 * incomplete.
 */
function resolveAbilityBoostsSlot(
  slotId: string,
  level: number,
  doc: Record<string, unknown>,
): PlanSlotModel {
  const slotCtx = abilityBoostsSlotContext(doc, level);
  const filled = isAbilityBoostsSlotFilled(slotCtx);
  const pickedSlugs = slotCtx.groups.flatMap((g) => g.initialFreeSlugs);
  return {
    slotId,
    type: "abilityBoosts",
    label: SLOT_TYPE_LABELS.abilityBoosts,
    filled,
    ...withOptional(
      "choiceName",
      filled && pickedSlugs.length > 0 ? pickedSlugs.join(", ") : undefined,
    ),
  };
}

// ---------------------------------------------------------------------------
// Ability-boosts grid (B1 r14 #6) — the filled abilityBoosts slot renders a
// 3×2 grid of the NET per-ability outcome instead of a raw slug string
// ("con, dex, int, ..."). For the level-1 boost step (which folds ancestry +
// background + class + level-1 boosts AND ancestry flaws) the "net" is the
// final ability MODIFIER per attribute — the number the sheet shows (Tobias:
// STR 8 → -1, DEX 16 → +3, CON 14 → +2, INT 18 → +4, WIS 10 → +0, CHA 12 → +1),
// computed from the same ledger `computeAbilityScores` uses so the grid always
// matches the header. A levelled milestone slot (5/10/15/20) shows the running
// modifier at that level too (its own 4 boosts are already folded in).
// ---------------------------------------------------------------------------

/** Display order for the ability grid (PF2e sheet order: STR/DEX/CON/INT/WIS/CHA). */
export const ABILITY_GRID_ORDER: readonly AbilitySlug[] = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
] as const;

export interface AbilityGridCell {
  slug: AbilitySlug;
  /** Net ability modifier at this level (floor((score-10)/2)). */
  mod: number;
  /** Signed modifier string, always with a sign ("+4", "-1", "+0"). */
  modFormatted: string;
}

/**
 * abilityBoostsGrid — the 3×2 net-per-ability grid for a FILLED abilityBoosts
 * slot (B1 r14 #6). Returns the six abilities in `ABILITY_GRID_ORDER` with the
 * final modifier each has at `level` (the ledger up to and including this
 * level's boosts), so the Plan renders "FOR +0 · DES +3 …" instead of the raw
 * "con, dex, int, …" pick list. Pure — reuses `computeAbilityScores`.
 */
export function abilityBoostsGrid(doc: Record<string, unknown>, level: number): AbilityGridCell[] {
  const abilities = getBuildAbilities(getSystem(doc));
  const scores = computeAbilityScores(abilities, level);
  return ABILITY_GRID_ORDER.map((slug) => {
    const mod = abilityMod(scores[slug]);
    return { slug, mod, modFormatted: mod >= 0 ? `+${String(mod)}` : String(mod) };
  });
}

/**
 * trainedSkillCount — level-1 free skill-training slot count (issue #4 /
 * audit r10 final #4): `trainedSkills.additional` PLUS the Int modifier
 * computed from the CURRENT boost ledger (`abilities`), floored at 0 (a
 * negative Int modifier never REDUCES the class's guaranteed additional
 * slots — PF2e Remaster rule: `max(0, intMod)` extra trained skills at
 * character creation).
 */
function trainedSkillCount(
  additional: number,
  abilities: BuildAbilities,
  charLevel: number,
): number {
  const scores = computeAbilityScores(abilities, charLevel);
  const intMod = abilityMod(scores.int);
  return additional + Math.max(0, intMod);
}

// ---------------------------------------------------------------------------
// Feat eligibility (pure, non-blocking UI validation)
// ---------------------------------------------------------------------------

export interface FeatDocLike {
  system?: {
    category?: string;
    level?: number;
    traits?: { value?: string[] };
  };
}

/**
 * Non-blocking eligibility check for the feat picker (R10-D item 3): does
 * `featDoc` fit the given `slotType` at `charLevel`, for a character with
 * `classSlug`/`ancestrySlug`?
 *
 * - category must match the slot's expected category (ancestryFeat →
 *   "ancestry", classFeat → "class", generalFeat → "general", skillFeat →
 *   "skill").
 * - archetypeFeat slots accept category "class" feats that carry the
 *   "archetype" trait (dedications and other archetype feats are stored as
 *   category:"class" + trait:"archetype" in feats-core — see
 *   systems/pf2e/packs/feats-core).
 * - feat level must be <= charLevel.
 * - classFeat slots additionally require the classSlug trait on the feat
 *   (shared class feats carry no class trait and are always eligible).
 * - ancestryFeat slots require the ancestrySlug trait, OR — when the
 *   character has picked an "Adopted Ancestry" feat (`opts.
 *   adoptedAncestrySlug`, see `chooseAdoptedAncestry`) — the adoptedAncestrySlug
 *   trait instead. This is the mechanical payoff the Adopted Ancestry feat
 *   exists for: it unlocks the ADOPTED ancestry's own feats in the same
 *   ancestry-feat slot, alongside the character's real ancestry's feats.
 *
 * Returns true/false — the caller decides whether to hide, gray out, or just
 * warn; this function never throws and never blocks the picker from
 * displaying an "ineligible" result.
 */
export function isFeatEligible(
  featDoc: FeatDocLike,
  slotType: PlanSlotType,
  charLevel: number,
  opts: {
    classSlug?: string;
    ancestrySlug?: string;
    adoptedAncestrySlug?: string;
    gateElements?: readonly string[];
  } = {},
): boolean {
  const sys = featDoc.system ?? {};
  const category = sys.category ?? "general";
  const level = sys.level ?? 1;
  const traits = sys.traits?.value ?? [];

  if (level > charLevel) return false;

  switch (slotType) {
    case "archetypeFeat":
      return category === "class" && traits.includes("archetype");
    case "classFeat":
      if (category !== "class") return false;
      if (traits.includes("archetype")) return false;
      if (opts.classSlug && traits.length > 0 && !traits.includes(opts.classSlug)) {
        // Shared class feats (no class-specific trait at all) remain
        // eligible; feats tagged for a DIFFERENT class are not.
        const looksClassTagged = traits.some((t) => KNOWN_CLASS_TRAITS.has(t));
        if (looksClassTagged) return false;
      }
      // Kineticist impulse feats are element-gated: an `impulse` feat that
      // carries an element trait (air/metal/…) is only eligible when that
      // element is one of the character's chosen gates. Impulses with no
      // element trait, and non-impulse class feats, are unaffected. Only
      // applied when the caller supplies `gateElements` (a kineticist actor).
      const gateElements = opts.gateElements;
      if (gateElements && traits.includes("impulse")) {
        const featElements = traits.filter((t) =>
          (KINETIC_ELEMENTS as readonly string[]).includes(t),
        );
        if (featElements.length > 0 && !featElements.some((e) => gateElements.includes(e))) {
          return false;
        }
      }
      return true;
    case "ancestryFeat":
      if (category !== "ancestry") return false;
      if (!opts.ancestrySlug) return true;
      if (traits.includes(opts.ancestrySlug)) return true;
      if (opts.adoptedAncestrySlug && traits.includes(opts.adoptedAncestrySlug)) return true;
      return false;
    case "generalFeat":
      return category === "general";
    case "skillFeat":
      return category === "skill";
    default:
      return false;
  }
}

/**
 * Known class trait slugs used to distinguish "this class feat belongs to a
 * DIFFERENT class" from "this is a shared/general class feat" in
 * isFeatEligible's classFeat branch. MVP set — extend as new classes ship.
 */
const KNOWN_CLASS_TRAITS = new Set([
  "magus",
  "alchemist",
  "barbarian",
  "bard",
  "champion",
  "cleric",
  "druid",
  "fighter",
  "gunslinger",
  "inventor",
  "investigator",
  "kineticist",
  "monk",
  "oracle",
  "ranger",
  "rogue",
  "sorcerer",
  "summoner",
  "swashbuckler",
  "witch",
  "wizard",
]);

/**
 * CLASS_CHOICE_SLOT_OPTIONS — for every class-choice slot type whose OPTIONS
 * come from a tagged list of class-features-core docs (r21-W1: generalizes
 * the r19-W2b hybridStudy-only hardcode), the pack to search and the
 * `system.traits.otherTags` value that marks a doc as eligible for that slot
 * (e.g. Starlit Span carries "magus-hybrid-study", Animal Instinct carries
 * "barbarian-instinct" — see systems/pf2e/packs/class-features-core's vendor
 * data). `kineticGate` is deliberately ABSENT: its "options" aren't a tagged
 * doc list but a single element/damage-type dialog (chooseKineticGate) — see
 * the Kinetic Gate section below.
 *
 * `requiredClass` (issue #25): every entry's `category` follows the
 * `<classSlug>-...` convention CHOICE_SLOT_REQUIRED_CLASS derives from below
 * — EXCEPT "blessing", whose vendor otherTags value is the bare
 * "blessing-of-the-devoted" (no "champion-" prefix; confirmed against
 * vendor/pf2e/packs/pf2e/class-features/blessed-{armament,shield,swiftness}
 * .json, unlike every other axis's otherTag). Declaring it explicitly here
 * keeps the derivation below correct without special-casing "blessing" in
 * the derivation itself.
 */
export const CLASS_CHOICE_SLOT_OPTIONS: Partial<
  Record<PlanSlotType, { packSlug: string; category: string; requiredClass?: string }>
> = {
  hybridStudy: { packSlug: "class-features-core", category: "magus-hybrid-study" },
  instinct: { packSlug: "class-features-core", category: "barbarian-instinct" },
  racket: { packSlug: "class-features-core", category: "rogue-racket" },
  huntersEdge: { packSlug: "class-features-core", category: "ranger-hunters-edge" },
  arcaneThesis: { packSlug: "class-features-core", category: "wizard-arcane-thesis" },
  arcaneSchool: { packSlug: "class-features-core", category: "wizard-arcane-school" },
  bloodline: { packSlug: "class-features-core", category: "sorcerer-bloodline" },
  muse: { packSlug: "class-features-core", category: "bard-muse" },
  cause: { packSlug: "class-features-core", category: "champion-cause" },
  doctrine: { packSlug: "class-features-core", category: "cleric-doctrine" },
  order: { packSlug: "class-features-core", category: "druid-order" },
  blessing: {
    packSlug: "class-features-core",
    category: "blessing-of-the-devoted",
    requiredClass: "champion",
  },
};

/**
 * isClassChoiceOption — true when `classFeatureDoc` carries the otherTags
 * value CLASS_CHOICE_SLOT_OPTIONS[slotType].category, i.e. it's a valid
 * OPTION for that class-choice slot (Starlit Span → hybridStudy, Animal
 * Instinct → instinct, …). `otherTags` isn't part of the strict Zod schema
 * (TraitsBlockSchema) but survives via `.passthrough()`, so it's read here as
 * an untyped extra. A `slotType` with no CLASS_CHOICE_SLOT_OPTIONS entry
 * (kineticGate, or any non-choice slot) always returns false — generic over
 * the target category, never an `if (slotType === "hybridStudy")` branch.
 */
export function isClassChoiceOption(
  classFeatureDoc: { system?: { traits?: { otherTags?: unknown } } },
  slotType: PlanSlotType,
): boolean {
  const category = CLASS_CHOICE_SLOT_OPTIONS[slotType]?.category;
  if (!category) return false;
  const otherTags = classFeatureDoc.system?.traits?.otherTags;
  if (!Array.isArray(otherTags)) return false;
  return otherTags.includes(category);
}

// ---------------------------------------------------------------------------
// Requirement marking (Frente 3, DEC-BC-05) — a FILLED slot/card never gets
// hidden or blocked once its backing item stops meeting its requirements
// (a class swap, an ancestry swap, or simply having outgrown its level
// window); it gets MARKED instead, with a readable reason. Filtering by
// requirement stays exclusive to the PICKER's `filterFn` (isFeatEligible,
// isClassChoiceOption) — this section is the mirror-image, non-filtering
// check run against an ALREADY-CHOSEN item.
// ---------------------------------------------------------------------------

/** `slug` capitalized for display in a requirement reason ("fighter" → "Fighter") — matches how PF2e class/ancestry traits are cased in prose. */
function capitalizeSlug(slug: string): string {
  return slug.length > 0 ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug;
}

/**
 * The class a CLASS_CHOICE_SLOT_OPTIONS slot type requires, taken from its
 * OWN explicit `requiredClass` when declared (issue #25 — "blessing"'s
 * category doesn't carry a class-slug prefix to derive from), else derived
 * from its category tag's `<classSlug>-...` prefix (e.g. "magus-hybrid-study"
 * → "magus") — every other entry follows this convention (see
 * CLASS_CHOICE_SLOT_OPTIONS's own doc comment for the full list). Computed
 * once at module load, not per-call.
 */
const CHOICE_SLOT_REQUIRED_CLASS: Partial<Record<PlanSlotType, string>> = Object.fromEntries(
  Object.entries(CLASS_CHOICE_SLOT_OPTIONS).map(([slotType, opt]) => {
    const requiredClass = opt.requiredClass ?? opt.category.split("-")[0] ?? opt.category;
    return [slotType, requiredClass];
  }),
);

/**
 * checkSlotRequirement — non-blocking check for an ALREADY-FILLED slot's
 * backing item: does it still meet the requirements it was picked under?
 * Returns `undefined` when it does (or when the slot type has no requirement
 * this function understands — abilityBoosts/skillTraining/skillIncrease/
 * kineticGate/grantedFeat are not item-requirement-checkable and always pass).
 *
 * Checks, in order (first hit wins — one reason is enough to mark a slot):
 *  1. Level: the item's `system.level` (stamped at pick time — the item's OWN
 *     level, not the slot's) must be <= the character's CURRENT level. A
 *     level-up doesn't invalidate anything (level only ever grows), but a
 *     class swap that resets `featLevels` timing could put a pick at a level
 *     the new progression hasn't reached yet — same mechanism, same check.
 *  2. Class-choice slots (hybridStudy/instinct/racket/huntersEdge/
 *     arcaneThesis/arcaneSchool): the slot type itself requires a specific
 *     class (CHOICE_SLOT_REQUIRED_CLASS) — mismatched against the
 *     character's CURRENT classSlug.
 *  3. classFeat: the item's own class trait (if any) must match the
 *     character's CURRENT classSlug — mirrors isFeatEligible's classFeat
 *     branch, run in reverse against a picked item instead of a picker
 *     candidate.
 *  4. ancestryFeat: the item's ancestry trait must match the character's
 *     CURRENT ancestrySlug.
 *
 * Free-text `system.prerequisites` (feat-chain prose like "Alchemist
 * Dedication" or ability-score/proficiency prose like "Intelligence +2") is
 * NOT resolved here — the pack data mixes item-name prose with non-item
 * prose (proficiency ranks, ability scores, OR-lists) with no structured way
 * to tell them apart, so a blind text match would flag legitimately-satisfied
 * picks as invalid far more often than it would catch a real gap. The
 * narrower, safely-resolvable slice of `system.prerequisites` (subclass-axis
 * prose like "dragon instinct") is handled separately by
 * `checkFeatPrerequisites` below (A1, r21 achado) and layered on top of this
 * function's result by `attachRequirementIssues`.
 */
export function checkSlotRequirement(
  item: Record<string, unknown>,
  slotType: PlanSlotType,
  charLevel: number,
  planCtx: Pick<PlanContext, "classSlug" | "ancestrySlug">,
): RequirementIssue | undefined {
  const sys = asRecord(item["system"]);
  const level = sys["level"];
  if (typeof level === "number" && level > charLevel) {
    return {
      reasonKey: "FUSION.Sheet.Plan.Requirement.LevelTooHigh",
      params: { required: String(level), current: String(charLevel) },
    };
  }

  const requiredClass = CHOICE_SLOT_REQUIRED_CLASS[slotType];
  if (requiredClass && planCtx.classSlug && planCtx.classSlug !== requiredClass) {
    return {
      reasonKey: "FUSION.Sheet.Plan.Requirement.WrongClass",
      params: { class: capitalizeSlug(requiredClass) },
    };
  }

  const traits = asStringArray(asRecord(sys["traits"])["value"]);

  if (slotType === "classFeat") {
    // A feat shared by several classes carries one trait PER class, in
    // alphabetical order — so the first one is almost never the character's
    // (issue #17: 99 feats in feats-core carry 2+ class traits, e.g. Reach
    // Spell's bard+cleric+druid+oracle+sorcerer+witch+wizard). The test is
    // "is my class in the list?", matching the sibling `isFeatEligible`,
    // which already did `traits.includes(opts.classSlug)` — the mismatch is
    // why the picker OFFERED these feats and the plan then marked them wrong.
    const classTraits = traits.filter((tr) => KNOWN_CLASS_TRAITS.has(tr));
    const [firstClassTrait] = classTraits;
    const { classSlug } = planCtx;
    // No class on the sheet yet keeps the pre-#17 answer: a class-tagged feat
    // in a class-feat slot is still flagged.
    if (
      firstClassTrait !== undefined &&
      (classSlug === undefined || !classTraits.includes(classSlug))
    ) {
      return {
        reasonKey: "FUSION.Sheet.Plan.Requirement.WrongClass",
        params: { class: capitalizeSlug(firstClassTrait) },
      };
    }
  }

  if (slotType === "ancestryFeat" && planCtx.ancestrySlug) {
    const ancestryTrait = traits[0];
    if (ancestryTrait && ancestryTrait !== planCtx.ancestrySlug) {
      return {
        reasonKey: "FUSION.Sheet.Plan.Requirement.WrongAncestry",
        params: { ancestry: capitalizeSlug(ancestryTrait) },
      };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Free-text prerequisite marking (A1, r21 achado) — `system.prerequisites`
// is free-form prose (`[{value: "dragon instinct"}]`), and most of it isn't
// safely resolvable client-side: proficiency ranks ("trained in Athletics"),
// ability scores ("Intelligence +2"), and feat-chain prose ("Alchemist
// Dedication") all require either the full feats-core index (not available
// to this pure, doc-only VM — see `derivePlan`'s doc comment) or game-state
// this model doesn't track. A blind text match against those would flag
// legitimately-satisfied picks as invalid, which DEC-BC-05 forbids (mark,
// never falsely block/flag).
//
// The one slice that IS safely resolvable without a pack index: subclass-AXIS
// prose ("dragon instinct", "eldritch trickster racket", "sparkling targe
// hybrid study", generic "arcane school"/"hunter's edge"). The vendor packs
// consistently suffix axis-option prerequisite text with the axis's own noun
// (confirmed against systems/pf2e/packs/feats-core's actual prerequisite
// strings), and the character's CURRENT pick for that axis is always known
// (it's an item-backed slot, same as any feat slot) — so "does the chosen
// axis option match the required one" is answerable with certainty, not a
// guess. Everything else stays `unresolved` → the requirement entry as a
// whole reports `unknown` and is never marked (see `evaluatePrerequisiteEntry`).
// ---------------------------------------------------------------------------

/** Requirement-text normalization mirroring tools/importer-pf2e/src/curation/grafo-de-feats.mjs's `normalizar` (lowercase, strip accents/punctuation, collapse whitespace). Kept independent — the client can't import the importer script — but semantically identical, so an item NAME and a `system.prerequisites` free-text VALUE compare equal after normalization. */
function normalizePrereqText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Ricochet Stance (Rogue)" → "ricochet stance" — mirrors the importer's `semSufixo`, for a candidate/name that carries a disambiguating parenthetical suffix. */
function stripParentheticalSuffix(name: string): string {
  return normalizePrereqText(name.replace(/\s*\([^)]*\)\s*$/, ""));
}

/**
 * "A or B" / "A, B" / "A, B, or C" → ["A", "B", "C"] — mirrors the importer's
 * `candidatosDoRequisito`: every form is treated as alternatives (satisfying
 * ONE is enough) since the vendor packs use them interchangeably.
 *
 * The `,\s*or\s+` branch MUST come first (issue #31). Without it the bare
 * comma matched first on an Oxford list, leaving the last alternative as
 * "or Twin Riposte" — a candidate that can never match anything. 27
 * prerequisites in feats-core use ", or"; all 27 produced a broken last
 * candidate.
 */
function prerequisiteCandidates(text: string): string[] {
  return text
    .split(/\s*,\s*or\s+|\s+or\s+|\s*,\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Axis noun phrases (already run through `normalizePrereqText`, so
 * apostrophes are spaces) mapped to the `PlanSlotType` they name, ordered
 * longest/most-specific first so "arcane school" and "hunter's edge" match
 * before their generic single-word tails. Verified against every
 * axis-shaped `system.prerequisites` string in systems/pf2e/packs/feats-core
 * (e.g. "dragon instinct", "eldritch trickster racket", "sparkling targe
 * hybrid study", generic "arcane school", generic "hunter's edge").
 */
const AXIS_SUFFIX_TO_SLOT_TYPE: ReadonlyArray<{ phrase: string; slotType: PlanSlotType }> = [
  { phrase: "hybrid study", slotType: "hybridStudy" },
  { phrase: "hunter s edge", slotType: "huntersEdge" },
  { phrase: "arcane school", slotType: "arcaneSchool" },
  { phrase: "arcane thesis", slotType: "arcaneThesis" },
  { phrase: "racket", slotType: "racket" },
  { phrase: "instinct", slotType: "instinct" },
  // r22 axes (issue #19). Measured in feats-core: 36 `<X> muse`, 7 `<X>
  // cause`, 1 `<X> doctrine` — all silent before this entry existed. They
  // resolve by name because `chooseClassChoice` stores the CHOSEN option's
  // own document in the slot ("Maestro" / bard-muse, "Justice" /
  // champion-cause, "Warpriest" / cleric-doctrine), so the item name carries
  // the pick.
  { phrase: "muse", slotType: "muse" },
  { phrase: "cause", slotType: "cause" },
  { phrase: "doctrine", slotType: "doctrine" },
  { phrase: "thesis", slotType: "arcaneThesis" },
  { phrase: "school", slotType: "arcaneSchool" },
  { phrase: "edge", slotType: "huntersEdge" },
  // DELIBERATELY ABSENT — adding either would only ever produce a FALSE
  // "unmet", which DEC-BC-05 rates worse than no mark at all:
  //
  //  - "gate" (issue #21): `chooseKineticGate` keeps the pick in
  //    `system.kineticGates`, so the slot item is ALWAYS literally named
  //    "Kinetic Gate". "Nourishing Gate" would strip to "nourishing" and
  //    compare against a name that can never be anything but "kinetic" —
  //    a permanent false positive for every Kineticist.
  //  - "bloodline": those docs are named "Bloodline: <Name>", so the core
  //    name is "bloodline aberrant", which never equals a prerequisite's
  //    stripped "aberrant". Zero prerequisites in feats-core end in
  //    " bloodline" today (the 12 that mention one are prose, e.g.
  //    "a bloodline that corresponds with a creature trait"), so nothing is
  //    lost by leaving it out.
];

/**
 * Does `normalized` (already `normalizePrereqText`-ed) end in a known axis
 * noun phrase? Returns the axis's slot type and the text with the phrase
 * stripped (e.g. "dragon instinct" → {slotType: "instinct", stripped:
 * "dragon"}; the bare generic phrase itself, e.g. "arcane school", strips to
 * `""` — a requirement for "any option of this axis", not a specific one).
 * `undefined` when no axis phrase matches — the text isn't axis-shaped and
 * this module can't resolve it.
 */
function matchAxisSuffix(
  normalized: string,
): { slotType: PlanSlotType; stripped: string } | undefined {
  for (const { phrase, slotType } of AXIS_SUFFIX_TO_SLOT_TYPE) {
    if (normalized === phrase) return { slotType, stripped: "" };
    if (normalized.endsWith(` ${phrase}`)) {
      return { slotType, stripped: normalized.slice(0, -(phrase.length + 1)).trim() };
    }
  }
  return undefined;
}

/** A name's "core" identity with any trailing axis noun stripped (e.g. both "Dragon Instinct" — a barbarian-instinct item name — and a prerequisite's "dragon instinct" reduce to "dragon"), so the two sides of the comparison line up even though only ONE of them (the vendor item name, for the instinct axis specifically) actually carries the noun. */
function axisCoreName(name: string): string {
  const normalized = normalizePrereqText(name);
  return matchAxisSuffix(normalized)?.stripped ?? normalized;
}

/** Every subclass-axis `PlanSlotType` this module can resolve a prerequisite against. */
const AXIS_SLOT_TYPES = new Set<PlanSlotType>([
  "instinct",
  "racket",
  "huntersEdge",
  "arcaneThesis",
  "arcaneSchool",
  "hybridStudy",
  "kineticGate",
  // issue #19 — see AXIS_SUFFIX_TO_SLOT_TYPE for why `bloodline` is absent.
  "muse",
  "cause",
  "doctrine",
]);

/**
 * The character's CURRENT pick for each subclass-axis slot type (by display
 * name), read off the item-backed axis slots (`instinct-1`, `racket-1`, …
 * per `resolveSlot`'s `<type>-<level>` convention) the same way `resolveSlot`
 * itself finds them — via `flags.fusion.build.slot`, not by re-deriving the
 * slot list. A character has at most one item per axis (the choice isn't
 * repeatable), so first match wins.
 */
function axisChoiceNames(
  items: Array<Record<string, unknown>>,
): Partial<Record<PlanSlotType, string>> {
  const result: Partial<Record<PlanSlotType, string>> = {};
  for (const it of items) {
    const flag = getItemBuildFlag(it);
    if (!flag) continue;
    const dashIdx = flag.slot.indexOf("-");
    const slotType = (dashIdx >= 0 ? flag.slot.slice(0, dashIdx) : flag.slot) as PlanSlotType;
    if (!AXIS_SLOT_TYPES.has(slotType) || slotType in result) continue;
    const name = itemName(it);
    if (name) result[slotType] = name;
  }
  return result;
}

/**
 * The set of names (normalized, both full and parenthetical-suffix-stripped
 * forms) the character DIRECTLY possesses: every picked feat, every
 * materialized class feature (including axis choices — they're
 * `classFeature`-typed items too), plus every non-choice class feature the
 * class's progression grants at or below `charLevel` (those are named by the
 * class doc's `featuresByLevel`, not embedded as actor items — see
 * `classGrantRefsFromClassDoc`'s doc comment). Used for a direct-name-match
 * prerequisite ("Rage", a picked feat's own name, …) — deliberately NOT a
 * general feats-core lookup, since this VM has no pack index.
 */
function knownPossessedNames(
  items: Array<Record<string, unknown>>,
  classSystem: ClassSystemLike | undefined,
  charLevel: number,
): Set<string> {
  const names = new Set<string>();
  const add = (name: string | undefined): void => {
    if (!name) return;
    names.add(normalizePrereqText(name));
    names.add(stripParentheticalSuffix(name));
  };
  for (const it of items) {
    const type = it["type"];
    if (type === "feat" || type === "classFeature") add(itemName(it));
  }
  for (const f of classSystem?.featuresByLevel ?? []) {
    if (f.level <= charLevel) add(f.name);
  }
  return names;
}

/**
 * Axis-shaped prerequisite phrases (already run through `normalizePrereqText`)
 * that name a REAL PF2e subclass axis belonging to a class Fusion doesn't
 * curate (issue #45 — "untamed order" is the Druid's order axis; Druid isn't
 * one of the 12 curated classes). No character can EVER possess this axis's
 * pick today, so unlike a truly unknown phrase (downgraded to "unresolved" —
 * "maybe satisfiable through data this module doesn't model"), this one
 * resolves definitively to "unmet": a Fusion character's `axisNames` will
 * never carry an entry for it, so it behaves exactly like a tracked axis
 * whose option was never chosen.
 *
 * Without this, "animal instinct or untamed order" (3 Barbarian feats: Brutal
 * Crush, Creature Comforts, Rip and Tear) silently fell back to "unknown"
 * (no mark) for any barbarian NOT on Animal instinct, while their "animal
 * instinct"-only siblings (Animal Skin, Animal Rage, Predator's Pounce)
 * correctly show "unmet" for the exact same character — an inconsistent
 * signal for the identical mistake (DEC-BC-05 leniency is meant to protect
 * against FALSE negatives, not to hide a REAL one just because it's phrased
 * as an "A or B").
 */
const UNMODELED_AXIS_PHRASES = new Set(["untamed order"]);

/** One `system.prerequisites` candidate's resolution against what the character possesses. `"unresolved"` means this module has no way to tell — never treated as unmet. */
function evaluatePrerequisiteCandidate(
  raw: string,
  knownNames: Set<string>,
  axisNames: Partial<Record<PlanSlotType, string>>,
): "met" | "unmet" | "unresolved" {
  const normalized = normalizePrereqText(raw);
  const short = stripParentheticalSuffix(raw);
  if (knownNames.has(normalized) || knownNames.has(short)) return "met";

  if (UNMODELED_AXIS_PHRASES.has(normalized)) return "unmet";

  const axisMatch = matchAxisSuffix(normalized);
  if (!axisMatch) return "unresolved";

  const chosenName = axisNames[axisMatch.slotType];
  // Axis not picked yet → this module cannot tell, so it must not mark. The
  // requirement may well be satisfied one click later, and `checkFeat-
  // Prerequisites`'s own contract says a character mid-build never gets a
  // false mark. Returning "unmet" here (the pre-#19 behaviour) put a red mark
  // on every feat whose axis the player simply hadn't reached yet — invisible
  // while only `instinct` resolved, but it would have hit all 44 measured
  // muse/cause/doctrine prerequisites the moment #19 landed.
  if (chosenName === undefined) return "unresolved";

  if (axisMatch.stripped === "") {
    // Generic axis requirement ("arcane school", "hunter's edge"): met as
    // soon as ANY option of that axis is chosen.
    return "met";
  }
  return axisCoreName(chosenName) === axisMatch.stripped ? "met" : "unmet";
}

/**
 * One `system.prerequisites[].value` entry (which may itself be an "A or B"
 * OR-list — satisfying ONE candidate is enough). Returns `"unmet"` ONLY when
 * EVERY candidate resolved (none were `"unresolved"`) and NONE were met —
 * i.e. this module is certain the requirement isn't satisfied. A single
 * unresolved candidate downgrades the whole entry to `"unknown"`: the
 * OTHER candidate in an "A or B" might be satisfied through data this VM
 * doesn't model, and DEC-BC-05 makes a false "unmet" worse than no mark.
 */
function evaluatePrerequisiteEntry(
  text: string,
  knownNames: Set<string>,
  axisNames: Partial<Record<PlanSlotType, string>>,
): "met" | "unmet" | "unknown" {
  const candidates = prerequisiteCandidates(text);
  if (candidates.length === 0) return "unknown";
  let allResolved = true;
  for (const candidate of candidates) {
    const status = evaluatePrerequisiteCandidate(candidate, knownNames, axisNames);
    if (status === "met") return "met";
    if (status === "unresolved") allResolved = false;
  }
  return allResolved ? "unmet" : "unknown";
}

/**
 * checkFeatPrerequisites — non-blocking check of a FILLED slot's backing
 * item against its own `system.prerequisites` (A1, r21 achado: a Bloodrager
 * -instinct Barbarian could pick Draconic Arrogance, which declares
 * `prerequisites: [{value: "dragon instinct"}]`, with no mark at all — this
 * VM never read the field). Only the axis-resolvable slice is evaluated (see
 * this section's header comment); everything else is silently `"unknown"`
 * and produces no issue. Returns `undefined` when every entry is met or
 * unknown, so a character mid-build (axis not yet chosen) or a feat with
 * only unresolvable prose never gets a false mark.
 */
export function checkFeatPrerequisites(
  item: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  classSystem: ClassSystemLike | undefined,
  charLevel: number,
): RequirementIssue | undefined {
  const sys = asRecord(item["system"]);
  const prereqsRaw = sys["prerequisites"];
  if (!Array.isArray(prereqsRaw) || prereqsRaw.length === 0) return undefined;

  const knownNames = knownPossessedNames(items, classSystem, charLevel);
  const axisNames = axisChoiceNames(items);

  const missing: string[] = [];
  for (const entry of prereqsRaw) {
    const value = typeof entry === "string" ? entry : asRecord(entry)["value"];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    if (evaluatePrerequisiteEntry(value, knownNames, axisNames) === "unmet") {
      missing.push(translatePrerequisite(value.trim()));
    }
  }
  if (missing.length === 0) return undefined;
  return {
    reasonKey: "FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet",
    params: { prerequisite: missing.join(", ") },
  };
}

/**
 * attachRequirementIssues — walk every FILLED, item-backed slot in `slots`
 * and stamp `requirementIssue` on the ones whose backing item no longer
 * meets its requirement (Frente 3), OR whose `system.prerequisites` resolve
 * to definitively unmet (A1, r21 achado — see `checkFeatPrerequisites`).
 * `checkSlotRequirement` runs first (it's the more certain of the two
 * checks); `checkFeatPrerequisites` only runs when it found nothing, so a
 * slot never carries two competing reasons. Mutates the slot objects in
 * place (they are freshly built by `buildLevelPlan` for this `derivePlan`
 * call, never shared/cached), so callers just call this once before
 * returning.
 */
function attachRequirementIssues(
  slots: PlanSlotModel[],
  items: Array<Record<string, unknown>>,
  charLevel: number,
  planCtx: Pick<PlanContext, "classSlug" | "ancestrySlug">,
  classSystem: ClassSystemLike,
): void {
  for (const slot of slots) {
    if (!slot.filled || !slot.itemId || slot.lockedGrant) continue;
    const item = items.find((it) => it["_id"] === slot.itemId);
    if (!item) continue;
    const issue =
      checkSlotRequirement(item, slot.type, charLevel, planCtx) ??
      checkFeatPrerequisites(item, items, classSystem, charLevel);
    if (issue) slot.requirementIssue = issue;
  }
}

// ---------------------------------------------------------------------------
// Kinetic Gate (Kineticist — Rage of Elements)
//
// The kineticist picks a Kinetic Gate at level 1: a SINGLE gate (one element)
// or a DUAL gate (two elements). Each chosen element opens that element's
// impulses and a base Elemental Blast. The client drives this choice (the
// server does not resolve the vendor ChoiceSet rules — V2), then emits a copy
// of the "Kinetic Gate" classFeature with `system.kineticGates: [{element,
// damageType}]` — the exact shape `stepCharElementalBlasts` (r18-N2b,
// systems/pf2e/src/derivations/elementalBlast.ts) reads to derive the blasts.
//
// The element list + valid damage types per element MIRROR the derivation's
// ELEMENT_BLAST_TABLE (kept in sync by hand, same discipline as SKILL_ABILITY
// vs characterSheetVM). Only the damage types the derivation accepts for an
// element are offered, so an invalid choice can never be recorded.
// ---------------------------------------------------------------------------

/** Kineticist element slug. */
export type KineticElement = "air" | "earth" | "fire" | "metal" | "water" | "wood";

export const KINETIC_ELEMENTS: readonly KineticElement[] = [
  "air",
  "earth",
  "fire",
  "metal",
  "water",
  "wood",
];

/**
 * Valid damage-type options per element — MUST match ELEMENT_BLAST_TABLE in
 * systems/pf2e/src/derivations/elementalBlast.ts (the derivation rejects any
 * damageType not in its own list, falling back to the first option). Kept in
 * sync by hand; the kineticGate test asserts the two never drift.
 */
export const KINETIC_ELEMENT_DAMAGE_TYPES: Record<KineticElement, readonly string[]> = {
  air: ["electricity", "slashing"],
  earth: ["bludgeoning", "slashing"],
  fire: ["fire"],
  metal: ["piercing", "slashing"],
  water: ["bludgeoning", "cold"],
  wood: ["bludgeoning", "vitality"],
};

export type KineticGateMode = "single-gate" | "dual-gate";

/** A single gate pick: an element and (optionally) its chosen damage type. */
export interface KineticGatePick {
  element: KineticElement;
  damageType?: string;
}

/**
 * True when this class declares a "Kinetic Gate" choice feature — the signal
 * that a `kineticGate` slot must be offered. Read from the class's own
 * `featuresByLevel` via CLASS_CHOICE_SLOTS (r19-W2b), so any future class that
 * grants a kinetic gate lights up the slot with no name special-case here.
 */
export function classHasKineticGate(classSystem: ClassSystemLike): boolean {
  return (classSystem.featuresByLevel ?? []).some(
    (f) => CLASS_CHOICE_SLOTS[f.name] === "kineticGate",
  );
}

// ---------------------------------------------------------------------------
// Kinetic Gate impulse sub-slots (r19-W2b)
//
// SOURCE — Kinetic Gate (PF2e Rage of Elements; Archives of Nethys, Kineticist
// class, https://2e.aonprd.com/Classes.aspx?ID=23):
//   - Single Gate: choose ONE element; you select TWO 1st-level impulse feats
//     with that element's trait, and gain that element's impulse junction.
//   - Dual Gate: choose TWO elements; you select TWO 1st-level impulse feats,
//     one with the trait of each element, and gain NO impulse junction at
//     level 1 (you can pick one up later via Gate's Threshold at 5th level).
//
// FUSION MODEL (Pathbuilder/dossiê the user builds against): the gate's
// impulse feats are surfaced as nested sub-slots DISTINCT from the level-1
// `classFeat-1` pick — ONE impulse sub-slot per chosen gate element (single →
// 1 element → 1 sub-slot; dual → 2 elements → 2 sub-slots). Combined with the
// normal level-1 class feat this yields the Pathbuilder counts the user
// expects: single = classFeat + 1 same-element impulse (= AoN's two impulse
// feats of the one element); dual = classFeat + one impulse PER element (Finn:
// Four Winds in classFeat-1, plus an Air sub-slot for Aerial Boomerang and a
// Metal sub-slot for Magnetic Pinions). The impulse junction is a passive
// benefit (not a pickable slot) and is documented here rather than modeled as
// a slot.
//
// Each sub-slot reuses the W1-D granted-sub-slot machinery (grantedFeat type +
// `grantFilter` + `parentSlotId`): rendered indented under the gate, its picker
// filtered to `impulse` + the element trait + 1st-level feats, and its
// lifecycle cascaded by removeChoice's prefix rule when the gate is removed.
// CRUCIALLY it is DERIVED FROM STATE (readGateElements on the embedded Kinetic
// Gate feature), so the sub-slots appear the moment Finn's already-saved
// dual gate is loaded — not only through the choose-gate flow.
// ---------------------------------------------------------------------------

/** English fallback labels for the per-element impulse sub-slot (i18n via `grantFilter.labelKey`). */
const GATE_IMPULSE_FALLBACK_LABELS: Record<KineticElement, string> = {
  air: "Air Impulse",
  earth: "Earth Impulse",
  fire: "Fire Impulse",
  metal: "Metal Impulse",
  water: "Water Impulse",
  wood: "Wood Impulse",
};

/**
 * The declarative picker filter for an element's impulse sub-slot: a 1st-level
 * feat carrying BOTH the `impulse` trait and the element's own trait. Reuses
 * `GrantedFeatFilter`/`matchesGrantedFeatFilter` (same shape PlanColumn already
 * runs against the pack index), so the picker offers exactly that element's
 * 1st-level impulses (Air → Aerial Boomerang/Four Winds; Metal → Magnetic
 * Pinions; …) and nothing else.
 */
export function impulseGateFilter(element: KineticElement): GrantedFeatFilter {
  return {
    labelKey: `FUSION.Sheet.Plan.SlotLabel.impulseGate.${element}`,
    predicates: [
      { kind: "trait", value: "impulse" },
      { kind: "trait", value: element },
      { kind: "levelAtMost", value: 1 },
    ],
  };
}

/**
 * pushGateImpulseSubSlots — for a FILLED kineticGate slot, push one impulse
 * sub-slot per chosen gate element (read from the embedded gate feature's
 * `system.kineticGates` via readGateElements). Each is a `grantedFeat` sub-slot
 * (item-backed via `flags.fusion.build.slot = "<gateSlotId>:impulse:<element>"`)
 * so `resolveSlot`'s own item lookup fills it, and the extra
 * `parentSlotId`/`grantFilter`/`label` fields drive indentation + the
 * element-filtered picker. Derived from state (not the choose flow), so a
 * saved gate surfaces its impulse picks on open.
 */
function pushGateImpulseSubSlots(
  slots: PlanSlotModel[],
  gateSlot: PlanSlotModel,
  level: number,
  choices: BuildChoice[],
  items: Array<Record<string, unknown>>,
  doc: Record<string, unknown>,
): void {
  if (!gateSlot.filled) return;
  for (const element of readGateElements(doc)) {
    const subSlotId = `${gateSlot.slotId}:impulse:${element}`;
    const subSlot = resolveSlot("grantedFeat", subSlotId, level, choices, items);
    subSlot.parentSlotId = gateSlot.slotId;
    subSlot.grantFilter = impulseGateFilter(element);
    subSlot.label = GATE_IMPULSE_FALLBACK_LABELS[element];
    slots.push(subSlot);
  }
}

/**
 * Read the gate elements the character has already chosen from the embedded
 * "Kinetic Gate" classFeature's `system.kineticGates`. Returns [] when the
 * gate isn't chosen yet (or the character isn't a kineticist). Used both to
 * filter impulse feats (only impulses of a gate element are eligible) and to
 * render the filled gate slot.
 */
export function readGateElements(doc: Record<string, unknown>): KineticElement[] {
  const items = getItems(doc);
  const out: KineticElement[] = [];
  for (const item of items) {
    if (item["type"] !== "classFeature") continue;
    const sys = asRecord(item["system"]);
    const gates = sys["kineticGates"];
    if (!Array.isArray(gates)) continue;
    for (const g of gates) {
      const element = asRecord(g)["element"];
      if (
        typeof element === "string" &&
        (KINETIC_ELEMENTS as readonly string[]).includes(element)
      ) {
        out.push(element as KineticElement);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Op builders
// ---------------------------------------------------------------------------

export interface PlanOpBuilderContext {
  actorId: string;
  doc: Record<string, unknown>;
  editable: boolean;
}

/**
 * Strip `_id` from a compendium document so doc:create assigns a fresh one,
 * and normalize `flags.fusion.build` onto it.
 */
function embeddedItemPayload(
  compendiumDoc: Record<string, unknown>,
  buildFlag?: { level: number; slot: string },
): Record<string, unknown> {
  const { _id: _drop, ...rest } = compendiumDoc;
  if (!buildFlag) return rest;
  const existingFlags = asRecord(rest["flags"]);
  const existingFusion = asRecord(existingFlags["fusion"]);
  return {
    ...rest,
    flags: {
      ...existingFlags,
      fusion: { ...existingFusion, build: buildFlag },
    },
  };
}

/**
 * replaceAbcItem — Frente 3 root-cause fix: `type: 'class'`/`'ancestry'`/
 * `'heritage'`/`'background'` is a ONE-PER-ACTOR slot, but the apply*
 * builders used to be doc:create-only — re-selecting an ABC card just
 * ACCRETED a second embedded item of the same type instead of replacing the
 * first one. Every reader (`findFirstItemByType`) picks the FIRST match, so
 * the sheet kept showing the OLD pick forever and the swap silently did
 * nothing — this is the "não consigo trocar a classe" bug.
 *
 * Deletes the existing item of `itemType` (if any) plus every item it
 * granted (`flags.fusion.grantedBy === <old item's sourceId>` — e.g. the
 * class-conceded Elemental Blast/Spellstrike actions, or an ancestry's
 * materialized feature grants), so a swap doesn't leave orphaned grants
 * behind. Returns `[]` when there's nothing to replace (first-time apply).
 */
function replaceAbcItem(
  ctx: PlanOpBuilderContext,
  itemType: "ancestry" | "heritage" | "background" | "class",
): DocOpPayload[] {
  const old = findFirstItemByType(ctx.doc, itemType);
  const oldId = old?.["_id"];
  if (!old || typeof oldId !== "string") return [];

  const ops: DocOpPayload[] = [
    {
      type: "doc:delete",
      documentType: "Item",
      id: oldId,
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocDeleteEmbeddedPayload,
  ];

  const oldSourceId = itemFusionSourceId(old);
  for (const it of getItems(ctx.doc)) {
    const isGrant = oldSourceId && itemFusion(it)["grantedBy"] === oldSourceId;
    // The class's own auxiliary items (arcane/focus spellcasting entries)
    // aren't `grantedBy`-tagged — they're tagged with a `class:`-prefixed
    // build-flag slot (see applyClass) so this same cascade catches them too.
    const isClassAux =
      itemType === "class" && (getItemBuildFlag(it)?.slot.startsWith("class:") ?? false);
    if (!isGrant && !isClassAux) continue;
    const id = it["_id"];
    if (typeof id === "string") {
      ops.push({
        type: "doc:delete",
        documentType: "Item",
        id,
        parent: { type: "Actor", id: ctx.actorId },
      } satisfies DocDeleteEmbeddedPayload);
    }
  }

  return ops;
}

/**
 * applyClass — doc:create the class item plus doc:create ops for its arcane
 * prepared spellcasting entry and, if the class grants a focus pool, a
 * focus entry. Re-selecting (a class already applied) REPLACES the old class
 * + its spellcasting/focus entries + its granted actions instead of
 * accreting a second class item (Frente 3 — see `replaceAbcItem`).
 *
 * The embedded class item keeps the class's FULL `keyAbility` option list
 * (r11 live-verification fix): the actual key-ability CHOICE lives in
 * `system.build.abilities.classBoost` (picked in the "Dádivas de Atributo"
 * dialog's class group) and the server's stepCharApplyClass prefers it over
 * `keyAbility[0]`. Narrowing the item at apply time silently locked the
 * choice to the first option (Magus → always dex, Tobias's str impossible).
 *
 * Returns the ops in order (any REPLACE deletes first, then class item,
 * then its spellcasting/focus entries — though doc:create ops for different
 * embedded items are independent and order doesn't matter to the server,
 * keeping this order makes test assertions and debugging easier).
 */
export function applyClass(
  ctx: PlanOpBuilderContext,
  classDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const classSystemRaw = asRecord(classDoc["system"]);
  const classSystem = classSystemRaw as unknown as ClassSystemLike;

  const ops: DocOpPayload[] = [...replaceAbcItem(ctx, "class")];
  // The class item's OWN build flag (`slot: "class"`) doesn't feed any slot
  // resolution (only feat/choice slotIds do) — it exists purely so a FUTURE
  // re-select's `replaceAbcItem` can find this class's own auxiliary items
  // (below) via the `class:`-prefix cascade.
  ops.push({
    type: "doc:create",
    documentType: "Item",
    data: embeddedItemPayload(classDoc, { level: 1, slot: "class" }),
    parent: { type: "Actor", id: ctx.actorId },
  } satisfies DocCreateEmbeddedPayload);

  const level = getLevel(ctx.doc);
  // r22 (Sorcerer): a class whose tradition is determined by a chosen
  // bloodline (spellcasting.tradition === null) can't get its spellcasting/
  // focus entries built yet — there's no tradition to stamp on them until
  // the "bloodline" choice slot is filled. `chooseClassChoice` creates them
  // (with the resolved tradition) once that happens. Every other class keeps
  // creating them immediately here, unchanged.
  if (classSystem.spellcasting?.tradition) {
    ops.push(
      buildSpellcastingEntryOp(
        ctx,
        classSystem.spellcasting,
        classSystem.spellcasting.tradition,
        level,
      ),
    );
  }

  // Focus pool: derived from `classSystem.spellcasting` (Bard/Magus — a
  // spellcasting class whose focus feature shares the class's own
  // tradition/ability) when present. Champion has NO `spellcasting` block at
  // all (Devotion Spells are divine spells cast with Charisma, per fixed
  // class rules text — not player-chosen data, so there's nothing in the
  // pack to derive it from) — `NON_SPELLCASTER_FOCUS_TRADITION` covers that
  // narrow case WITHOUT fabricating a fake `spellcasting` table on the class
  // (see the doc comment there). Sorcerer (spellcasting present but
  // `tradition: null`, bloodline-deferred) falls into neither branch here —
  // `bloodlineSpellcastingOps` builds its focus entry once the bloodline
  // choice resolves the tradition.
  let focusEntryCreated = false;
  if (hasFocusFeature(classSystem)) {
    if (classSystem.spellcasting?.tradition) {
      ops.push(
        buildFocusEntryOp(
          ctx,
          classSystem.spellcasting.ability,
          classSystem.spellcasting.tradition,
        ),
      );
      focusEntryCreated = true;
    } else if (!classSystem.spellcasting) {
      const fallback = NON_SPELLCASTER_FOCUS_TRADITION[itemName(classDoc) ?? ""];
      if (fallback) {
        ops.push(buildFocusEntryOp(ctx, fallback.ability, fallback.tradition));
        focusEntryCreated = true;
      }
    }
  }
  // The entry alone is inert: `system.resources.focusPoints` stays {0,0} and
  // the sheet's Cast button is `disabled={vm.focusPoints.value <= 0}`, so no
  // focus spell was castable in ANY class (issue #4). PF2e gives a pool of
  // one point with your first focus spell — the pool travels with the entry,
  // which is why it is emitted here and not from a separate code path.
  if (focusEntryCreated) ops.push(buildFocusPoolOp(ctx, INITIAL_FOCUS_POOL));

  return ops;
}

/**
 * A first focus spell opens a one-point pool (PF2e core rules). Growing it to
 * the cap of 3 is a separate concern: it happens when a LATER feat or class
 * feature grants another focus spell, which this VM does not model yet
 * (issue #5 tracks the recognition side of that).
 */
const INITIAL_FOCUS_POOL = 1;

/** Opens the actor's focus pool at `points`, full — a fresh pool starts unspent. */
function buildFocusPoolOp(ctx: PlanOpBuilderContext, points: number): DocUpdatePayload {
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: {
      "system.resources.focusPoints.value": points,
      "system.resources.focusPoints.max": points,
    },
  } satisfies DocUpdatePayload;
}

/**
 * Fixed tradition/ability for a class's focus pool when the class has NO
 * `spellcasting` block at all — Champion's "Devotion Spells" classFeature
 * (system/pf2e/packs/class-features-core, level 1) grants divine focus
 * spells cast with Charisma; that's core rules text, not a build-time
 * choice, and the compiled class doc carries no structured field for it
 * (curation/classes/champion.json even stamps `"spellcasting": null`
 * deliberately — verified against the pack). Keyed by the class item's
 * display `name` (compiled docs carry no stable slug field). Every OTHER
 * class with a level-1 focus feature (Bard, Magus, Sorcerer) HAS a
 * `spellcasting` block and never consults this map.
 */
const NON_SPELLCASTER_FOCUS_TRADITION: Record<string, { tradition: string; ability: string }> = {
  Champion: { tradition: "divine", ability: "cha" },
};

/** Builds the doc:create op for the class's non-focus ("class:spellcasting") entry — factored out so `chooseBloodline`-style deferred creation (r22) can build the identical shape once the tradition is resolved from a chosen axis option. */
function buildSpellcastingEntryOp(
  ctx: PlanOpBuilderContext,
  spellcasting: ClassSpellcastingTable,
  tradition: string,
  level: number,
): DocCreateEmbeddedPayload {
  const { cantripsKnown, slotsByRank } = spellSlotsForLevel(spellcasting, level);
  return {
    type: "doc:create",
    documentType: "Item",
    data: {
      name: `${tradition} Spells`,
      type: "spellcastingEntry",
      flags: { fusion: { build: { level: 1, slot: "class:spellcasting" } } },
      system: {
        prepared: { value: spellcasting.type },
        tradition: { value: tradition },
        ability: { value: spellcasting.ability },
        proficiency: { value: 1 },
        slots: buildSlotsMap(slotsByRank, cantripsKnown),
        isFocusPool: false,
      },
    },
    parent: { type: "Actor", id: ctx.actorId },
  } satisfies DocCreateEmbeddedPayload;
}

/**
 * Builds the doc:create op for the class's focus ("class:focus") entry —
 * see `buildSpellcastingEntryOp`. Takes `ability`/`tradition` directly
 * (rather than a `ClassSpellcastingTable`) so a class with no spellcasting
 * table of its own (Champion) can still build its focus entry without a
 * fabricated stand-in table — see `NON_SPELLCASTER_FOCUS_TRADITION`.
 */
function buildFocusEntryOp(
  ctx: PlanOpBuilderContext,
  ability: string,
  tradition: string,
): DocCreateEmbeddedPayload {
  return {
    type: "doc:create",
    documentType: "Item",
    data: {
      name: "Focus Spells",
      type: "spellcastingEntry",
      flags: { fusion: { build: { level: 1, slot: "class:focus" } } },
      system: {
        prepared: { value: "innate" },
        tradition: { value: tradition },
        // Focus spells cast with the class's SPELLCASTING ability (Magus
        // conflux = INT), not the key ability (r11 fix — Pathbuilder's
        // focus block confirms int for Tobias). No `?? "int"` fallback: the
        // parameter is a required string and every caller reads it from a
        // typed source, so the fallback was unreachable — and its sibling
        // buildSpellcastingEntryOp never had one either (issue #69).
        ability: { value: ability },
        proficiency: { value: 1 },
        slots: {},
        isFocusPool: true,
      },
    },
    parent: { type: "Actor", id: ctx.actorId },
  } satisfies DocCreateEmbeddedPayload;
}

/**
 * Does the class grant a focus pool at level 1? PF2e's own naming
 * convention names every level-1 focus-granting classFeature "<X> Spells"
 * (Composition Spells [Bard], Devotion Spells [Champion], Conflux Spells
 * [Magus], Bloodline Spells [Sorcerer]) — distinct from a class's MAIN
 * spellcasting feature, always named "<X> Spellcasting" (e.g. "Occult
 * Spellcasting", "Wizard Spellcasting"), so the suffix never collides.
 * Verified against all 12 classes in classes-core (r22 audit): exactly
 * these 4 level-1 features end in " Spells", and no non-focus level-1
 * feature does. Preferred over a hardcoded per-class name list — a future
 * class shipping a "<X> Spells" feature is picked up automatically, no
 * planVM.ts change needed.
 */
function hasFocusFeature(classSystem: ClassSystemLike): boolean {
  return (classSystem.featuresByLevel ?? []).some(
    (f) => f.level === 1 && f.name.endsWith(" Spells"),
  );
}

function buildSlotsMap(
  slotsByRank: Record<string, number>,
  cantripsKnown: number,
): Record<
  string,
  { value: number; max: number; prepared: Array<{ id: string; expended: boolean }> }
> {
  const slots: Record<
    string,
    { value: number; max: number; prepared: Array<{ id: string; expended: boolean }> }
  > = {};
  if (cantripsKnown > 0) {
    slots["0"] = {
      value: cantripsKnown,
      max: cantripsKnown,
      prepared: Array.from({ length: cantripsKnown }, () => ({ id: "", expended: false })),
    };
  }
  for (const [rank, max] of Object.entries(slotsByRank)) {
    slots[rank] = {
      value: max,
      max,
      prepared: Array.from({ length: max }, () => ({ id: "", expended: false })),
    };
  }
  return slots;
}

/**
 * applyAncestry — doc:create the ancestry item + merge its fixed boosts into
 * `system.build.abilities.ancestryBoosts`/`ancestryFlaws`/`ancestryFree`
 * (arrays sent whole per the diff-applier's array-path rule — see
 * characterSheetVM.ts's `_preparedArrayWith` doc comment for the same
 * constraint applied to a different array). Re-selecting REPLACES the old
 * ancestry item + its granted features (Frente 3 — see `replaceAbcItem`)
 * instead of accreting a second one.
 *
 * `ancestryDoc.system.boosts` mixes fixed ability slugs and the sentinel
 * string `"free"` for unrestricted boosts (see systems/pf2e/packs/
 * ancestries-core/documents.json, e.g. Ratfolk: `["dex","int","free"]`).
 *
 * Deliberately does NOT touch an already-picked heritage/ancestry feats: a
 * swap may leave them no longer matching this ancestry, but per DEC-BC-05
 * they stay on the sheet and get MARKED (see `heritageAncestryIssue`/
 * `checkSlotRequirement`), never silently removed.
 */
export function applyAncestry(
  ctx: PlanOpBuilderContext,
  ancestryDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const sys = asRecord(ancestryDoc["system"]);
  const boosts = asStringArray(sys["boosts"]);
  const flaws = asStringArray(sys["flaws"]);
  const fixedBoosts = boosts.filter((b) => b !== "free");
  const freeCount = boosts.filter((b) => b === "free").length;

  const ops: DocOpPayload[] = [
    ...replaceAbcItem(ctx, "ancestry"),
    {
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(ancestryDoc),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload,
  ];

  const existing = getBuildAbilities(getSystem(ctx.doc));
  const speedValue = sys["speed"];
  ops.push({
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: {
      "system.build.abilities.ancestryBoosts": fixedBoosts,
      "system.build.abilities.ancestryFlaws": flaws,
      // Free boosts default to empty until the player picks — the picker UI
      // calls setAbilityBoosts("ancestryFree", [...]) once slugs are chosen.
      // Preserve any existing picks if this ancestry grants the SAME count
      // (re-applying); otherwise reset (a new ancestry invalidates old picks).
      "system.build.abilities.ancestryFree":
        existing.ancestryFree.length === freeCount ? existing.ancestryFree : [],
      // The ancestry item carries its base land speed at `system.speed` (a raw
      // number — Ratfolk 25); the speed derivation reads the ACTOR's
      // `system.attributes.speed.value` (falling back to `system.speed`, then
      // 0 — see systems/pf2e/src/derivations/speed.ts), so applying OR changing
      // an ancestry must stamp that value onto the actor. r19-W2b bug fix:
      // applyAncestry wrote the boosts but never the speed, so a freshly-built
      // character's sheet showed 0 ft. Set on every apply → covers first pick
      // AND swap (a new ancestry overwrites the prior speed).
      ...(typeof speedValue === "number" ? { "system.attributes.speed.value": speedValue } : {}),
    },
  } satisfies DocUpdatePayload);

  return ops;
}

/**
 * applyHeritage — doc:create the heritage item. Re-selecting REPLACES the old
 * heritage + its granted features (Frente 3 — see `replaceAbcItem`) instead
 * of accreting a second one.
 */
export function applyHeritage(
  ctx: PlanOpBuilderContext,
  heritageDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  return [
    ...replaceAbcItem(ctx, "heritage"),
    {
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(heritageDoc),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload,
  ];
}

/**
 * applyBackground — doc:create the background item + merge its fixed boosts
 * into `system.build.abilities.backgroundBoosts`, and reset/preserve its
 * FREE boosts into `system.build.abilities.backgroundFree` (R11 item 1: the
 * PF2e Remaster background boost table is normally two "free" choices — see
 * systems/pf2e/packs/backgrounds-core, e.g. Fireworks Performer:
 * `["free","free"]` — resolved later via
 * setAbilityBoosts(ctx, "backgroundFree", [...])). Same preserve-if-same-
 * count / reset-otherwise policy as applyAncestry's `ancestryFree` handling.
 *
 * Re-selecting REPLACES the old background item + its granted features
 * (Frente 3 — see `replaceAbcItem`) instead of accreting a second one; its
 * skill/lore training grants are replaced too (see `backgroundTrainingOps`).
 */
export function applyBackground(
  ctx: PlanOpBuilderContext,
  backgroundDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const sys = asRecord(backgroundDoc["system"]);
  const boosts = asStringArray(sys["boosts"]);
  const fixedBoosts = boosts.filter((b) => b !== "free");
  const freeCount = boosts.filter((b) => b === "free").length;

  // What the incoming background grants — read up front because the Lore
  // cleanup below has to know which of the OUTGOING background's Lores are
  // re-granted (those stay) before anything is deleted.
  const trainings = readBackgroundTrainings(sys);

  const ops: DocOpPayload[] = [
    // Before the swap: drop the Lore ledger entries the outgoing background
    // created. Reads `ctx.doc`, which is still the pre-swap state.
    ...backgroundLoreCleanupOps(ctx, trainings),
    ...replaceAbcItem(ctx, "background"),
    {
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(backgroundDoc),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload,
  ];

  const existing = getBuildAbilities(getSystem(ctx.doc));
  ops.push({
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: {
      "system.build.abilities.backgroundBoosts": fixedBoosts,
      "system.build.abilities.backgroundFree":
        existing.backgroundFree.length === freeCount ? existing.backgroundFree : [],
    },
  } satisfies DocUpdatePayload);

  // Background-granted skill proficiencies (e.g. Fireworks Performer →
  // Performance trained AND Fireworks Lore trained) apply as level-1
  // skillTraining build choices so stepCharBuildSkills picks them up uniformly
  // with other training sources. r20-X4: the Lore branch was previously DROPPED
  // — the pack shape is `system.trainedSkills = {value:["performance"],
  // lore:["Fireworks Lore"]}` but the old reader only understood the normalized
  // `system.skills = {performance:{value:1}}` shape and never trained the lore.
  const buildSkillOps = backgroundTrainingOps(ctx, trainings);
  ops.push(...buildSkillOps);

  return ops;
}

/** A background's granted skill/lore proficiencies, normalized across pack shapes. */
export interface BackgroundTrainings {
  /** Canonical skill slugs trained at rank 1 (e.g. "athletics", "performance"). */
  skills: string[];
  /** Lore proficiencies: a slug + a human label (e.g. { slug:"piloting-lore", label:"Piloting Lore" }). */
  lores: Array<{ slug: string; label: string }>;
}

/**
 * readBackgroundTrainings — extract a background's granted skills + lores from
 * EITHER pack shape:
 *   - `system.trainedSkills = { value:[skill…], lore:[loreName…] }` (raw vendor
 *     shape carried by the importer, r20-X4 — the shape that has the LORE);
 *   - `system.skills = { <slug>: { value:rank } }` (older normalized shape) as a
 *     fallback for skills (no lore in that shape).
 * The two are unioned (deduped) so a re-imported pack that carries both never
 * double-counts. Malformed entries degrade to "none" (r11 posture).
 */
export function readBackgroundTrainings(sys: Record<string, unknown>): BackgroundTrainings {
  const skills = new Set<string>();
  const lores = new Map<string, string>(); // slug → label

  const trained = asRecord(sys["trainedSkills"]);
  for (const s of asStringArray(trained["value"])) skills.add(s);
  for (const loreName of asStringArray(trained["lore"])) {
    const label = loreName.trim();
    if (label) lores.set(loreSlug(label), label);
  }

  // Fallback: the normalized `system.skills` map (skills only; no lore there).
  const normalized = asRecord(sys["skills"]);
  for (const [slug, val] of Object.entries(normalized)) {
    if (typeof asRecord(val)["value"] === "number") skills.add(slug);
  }

  return {
    skills: [...skills],
    lores: [...lores].map(([slug, label]) => ({ slug, label })),
  };
}

/** Build-choice slot prefixes a background owns — everything it grants, and
 * nothing else, is keyed under one of these two. */
const BACKGROUND_SKILL_SLOT = "backgroundSkill-";
const BACKGROUND_LORE_SLOT = "backgroundLore-";

/**
 * The rank persisted straight on `system.skills.<slug>`, 0 when the entry is
 * absent or malformed.
 *
 * A background's own Lore is always persisted at rank 0 (see
 * `backgroundTrainingOps`) — what makes it trained is the `backgroundLore-N`
 * build choice, resolved in the derivation. So a persisted rank ABOVE 0 can
 * only have been put there by the player, through the row's rank `<select>`
 * (`characterSheetVM.updateSkillRank` → `system.skills.<slug>.rank`), which
 * leaves no build choice behind to prove it.
 */
function persistedSkillRank(persistedSkills: Record<string, unknown>, slug: string): number {
  const rank = asRecord(persistedSkills[slug])["rank"];
  return typeof rank === "number" ? rank : 0;
}

/**
 * backgroundLoreCleanupOps — the `doc:update` that REMOVES the `system.skills`
 * entries the OUTGOING background granted (S2).
 *
 * Dropping a background's build choices untrains a canonical skill (its rank is
 * derived from the choices), but a Lore is different: it has no canonical slug,
 * so the background also had to CREATE the `system.skills.<slug>` ledger entry.
 * Nothing ever removed it, so every background a character had ever worn kept
 * its Lore on the sheet forever. `null` inside `system` is deleteKey
 * (REQ-DOC-037, see packages/server/src/documents/merge.ts).
 *
 * Five things must survive the swap, hence the guards below:
 *   - a Lore the INCOMING background grants under the very same key;
 *   - a Lore the player created by hand (`addLoreSkill` — no background choice
 *     points at it, so it is never a candidate);
 *   - a Lore the player invested one of their OWN training/increase slots in;
 *   - a Lore whose PERSISTED rank the player raised through the row's rank
 *     `<select>` (see `persistedSkillRank`) — that path writes no build choice,
 *     so the two guards above are blind to it;
 *   - anything that is not a Lore at all.
 *
 * A legacy sheet holds the Lore under `<subject>-lore` while the incoming
 * background emits `lore-<subject>`, so a swap that re-grants the same subject
 * deletes the legacy key and writes the canonical one — the migration falls out
 * of the swap for free.
 */
function backgroundLoreCleanupOps(
  ctx: PlanOpBuilderContext,
  incoming: BackgroundTrainings,
): DocOpPayload[] {
  const actorSys = getSystem(ctx.doc);
  const persistedSkills = asRecord(actorSys["skills"]);
  const choices = getBuildChoices(actorSys);

  // Exactly the keys the incoming background is about to (re)write.
  const incomingSlugs = new Set(incoming.lores.map((l) => l.slug));
  // The LEGACY spelling of each of those keys. Such an entry is still deleted
  // (that is the free migration described above) even when its rank was raised
  // by hand, because `backgroundTrainingOps` rewrites the same proficiency —
  // rank included — under the canonical key in the same batch. Without this
  // exemption the hand-raised-rank guard below would keep the legacy key alive
  // next to the canonical one: two rows for one Lore.
  const incomingLegacySlugs = new Set(incoming.lores.map((l) => legacyLoreSlug(l.label)));

  // Candidates come from two sources because either can be incomplete: the
  // embedded background item may be a STALE import (no `trainedSkills`), while
  // the `backgroundLore-*` choices may have been lost. Both slug conventions
  // are probed for the item-derived ones — existing sheets were written legacy.
  const candidates = new Set<string>();
  const outgoing = findFirstItemByType(ctx.doc, "background");
  if (outgoing) {
    for (const lore of readBackgroundTrainings(asRecord(outgoing["system"])).lores) {
      candidates.add(lore.slug);
      candidates.add(legacyLoreSlug(lore.label));
    }
  }
  for (const c of choices) {
    if (c.slot.startsWith(BACKGROUND_LORE_SLOT) && c.skill) candidates.add(c.skill);
  }

  const playerOwned = new Set(
    choices
      .filter((c) => !c.slot.startsWith(BACKGROUND_LORE_SLOT) && c.skill !== undefined)
      .map((c) => c.skill),
  );

  const diff: Record<string, unknown> = {};
  for (const slug of candidates) {
    if (incomingSlugs.has(slug)) continue;
    if (playerOwned.has(slug)) continue;
    if (persistedSkillRank(persistedSkills, slug) > 0 && !incomingLegacySlugs.has(slug)) continue;
    if (!isLoreSlug(slug)) continue;
    if (!(slug in persistedSkills)) continue;
    diff[`system.skills.${slug}`] = null;
  }

  if (Object.keys(diff).length === 0) return [];
  return [
    {
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff,
    } satisfies DocUpdatePayload,
  ];
}

/**
 * backgroundTrainingOps — the `doc:update` ops that train a background's skills
 * + lores. Skills become `backgroundSkill-N` build choices; each lore ALSO gets
 * a `system.skills.<slug>` entry stamped `lore:true` (so the derivation treats
 * it as an INT-based custom Lore) plus a `backgroundLore-N` build choice at rank
 * 1. Idempotent inputs — the heal filters out already-present trainings before
 * calling — so re-applying never duplicates a choice.
 *
 * Frente 3: always strips any PRIOR `backgroundSkill-*`/`backgroundLore-*`
 * choices before appending the new ones, so re-selecting the background card
 * (a different background, fewer/more granted skills) REPLACES the old
 * background's training grants instead of accreting alongside them under
 * colliding index-based slot ids (where `resolveSlot`'s `.find()` would keep
 * reporting the OLD background's skill, masking the swap).
 */
function backgroundTrainingOps(
  ctx: PlanOpBuilderContext,
  trainings: BackgroundTrainings,
): DocOpPayload[] {
  const ops: DocOpPayload[] = [];
  const newChoices: BuildChoice[] = [];

  trainings.skills.forEach((slug, i) => {
    newChoices.push({
      level: 1,
      slot: `${BACKGROUND_SKILL_SLOT}${String(i)}`,
      type: "skillTraining",
      skill: slug,
      rank: 1,
    });
  });

  // Each lore needs its persisted `system.skills` entry (lore:true) so the
  // character derivation surfaces it; the build choice raises it to trained.
  const persistedSkills = asRecord(getSystem(ctx.doc)["skills"]);
  const loreEntries: Record<string, unknown> = {};
  trainings.lores.forEach((lore, i) => {
    // The entry is written whole, so it must never land BELOW what the sheet
    // already holds: re-selecting the same background would otherwise reset a
    // rank the player set by hand on the row's rank select back to 0. The
    // legacy spelling counts as the same proficiency — this write is what
    // migrates it to the canonical key, so its rank has to ride along.
    const rank = Math.max(
      0,
      persistedSkillRank(persistedSkills, lore.slug),
      persistedSkillRank(persistedSkills, legacyLoreSlug(lore.label)),
    );
    loreEntries[`system.skills.${lore.slug}`] = { rank, lore: true, label: lore.label };
    newChoices.push({
      level: 1,
      slot: `${BACKGROUND_LORE_SLOT}${String(i)}`,
      type: "skillTraining",
      skill: lore.slug,
      rank: 1,
    });
  });

  if (Object.keys(loreEntries).length > 0) {
    ops.push({
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: loreEntries,
    } satisfies DocUpdatePayload);
  }

  const existingChoices = getBuildChoices(getSystem(ctx.doc));
  const keptChoices = existingChoices.filter(
    (c) =>
      !c.slot.startsWith(BACKGROUND_SKILL_SLOT) && !c.slot.startsWith(BACKGROUND_LORE_SLOT),
  );
  // The strip has to run even when the incoming background grants NOTHING
  // (Hermit, Raised by Belief): it used to sit behind `newChoices.length > 0`,
  // so swapping to one of those left the character trained in the PREVIOUS
  // background's skill and Lore with no background left to justify them.
  if (newChoices.length > 0 || keptChoices.length !== existingChoices.length) {
    ops.push({
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: { "system.build.choices": [...keptChoices, ...newChoices] },
    } satisfies DocUpdatePayload);
  }

  return ops;
}

/**
 * backgroundLoreHealOps — for an ALREADY-applied background missing its lore
 * training (r20-X4 heal: the real Finn/Tobias were built before the lore branch
 * existed), emit the ops to add each missing lore's `system.skills` entry + a
 * `backgroundLore-N` build choice. Idempotent: a lore already present (a build
 * choice targeting its slug, OR a `system.skills.<slug>` entry) is skipped, so
 * re-running the heal is a no-op. Skills already handled by the original apply
 * are NOT re-added here (this heal is lore-only — the historical gap).
 */
export function backgroundLoreHealOps(
  ctx: PlanOpBuilderContext,
  backgroundDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const sys = asRecord(backgroundDoc["system"]);
  const trainings = readBackgroundTrainings(sys);
  if (trainings.lores.length === 0) return [];

  const actorSys = getSystem(ctx.doc);
  const existingChoices = getBuildChoices(actorSys);
  const existingSkills = asRecord(actorSys["skills"]);
  const trainedSlugs = new Set(
    existingChoices.map((c) => c.skill).filter((s): s is string => typeof s === "string"),
  );

  // Probe BOTH slug conventions: a sheet written before ./loreSlug.ts holds the
  // Lore under the legacy `<subject>-lore` key, with its build choice pointing
  // at that same legacy slug. Without this the heal would consider the Lore
  // missing and re-add it under the canonical key at rank 0, leaving the sheet
  // with two entries for one proficiency. Renaming the legacy key is
  // `loreSlugHealOps`'s job, not this one's.
  const missing = trainings.lores.filter((lore) => {
    const legacy = legacyLoreSlug(lore.label);
    return (
      !trainedSlugs.has(lore.slug) &&
      !trainedSlugs.has(legacy) &&
      !existingSkills[lore.slug] &&
      !existingSkills[legacy]
    );
  });
  if (missing.length === 0) return [];

  const loreEntries: Record<string, unknown> = {};
  const newChoices: BuildChoice[] = [];
  // Continue the backgroundLore-N numbering past any that already exist.
  const usedLoreSlots = new Set(existingChoices.map((c) => c.slot));
  let n = 0;
  for (const lore of missing) {
    loreEntries[`system.skills.${lore.slug}`] = { rank: 0, lore: true, label: lore.label };
    while (usedLoreSlots.has(`${BACKGROUND_LORE_SLOT}${String(n)}`)) n++;
    usedLoreSlots.add(`${BACKGROUND_LORE_SLOT}${String(n)}`);
    newChoices.push({
      level: 1,
      slot: `${BACKGROUND_LORE_SLOT}${String(n)}`,
      type: "skillTraining",
      skill: lore.slug,
      rank: 1,
    });
  }

  return [
    {
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: loreEntries,
    } satisfies DocUpdatePayload,
    {
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: { "system.build.choices": [...existingChoices, ...newChoices] },
    } satisfies DocUpdatePayload,
  ];
}

/**
 * loreSlugHealOps — rename every legacy `<subject>-lore` entry on
 * `system.skills` to the canonical `lore-<subject>` (contract C3) and repoint
 * the build choices that referenced the old key.
 *
 * Every sheet built before `./loreSlug.ts` carries its background Lore under
 * the legacy key, which no reader in the app understands: the row renders as
 * the raw slug and the skill-training dialog lists it in a namespace nothing
 * else can match. Renaming is the whole fix — the proficiency (rank, label)
 * rides along untouched.
 *
 * `migrateLoreSlug` returns `null` for anything already canonical AND for
 * anything that is not a Lore, so a canonical skill can never be renamed (which
 * would silently untrain it) and a second pass is a no-op.
 */
export function loreSlugHealOps(ctx: PlanOpBuilderContext): DocOpPayload[] {
  if (!ctx.editable) return [];
  const sys = getSystem(ctx.doc);
  const skills = asRecord(sys["skills"]);

  const renames = new Map<string, string>(); // legacy slug → canonical slug
  for (const slug of Object.keys(skills)) {
    const canonical = migrateLoreSlug(slug);
    if (canonical !== null) renames.set(slug, canonical);
  }
  if (renames.size === 0) return [];

  const diff: Record<string, unknown> = {};
  for (const [legacy, canonical] of renames) {
    const legacyEntry = asRecord(skills[legacy]);
    const canonicalEntry = asRecord(skills[canonical]);
    // Both conventions can coexist on one subject — e.g. a heal that ran before
    // this one added the canonical entry at rank 0 next to a legacy entry the
    // player had trained. Keep the HIGHER rank so the merge never demotes a
    // proficiency; the canonical entry otherwise wins field by field.
    const legacyRank = typeof legacyEntry["rank"] === "number" ? legacyEntry["rank"] : 0;
    const canonicalRank = typeof canonicalEntry["rank"] === "number" ? canonicalEntry["rank"] : 0;
    diff[`system.skills.${canonical}`] = {
      ...legacyEntry,
      ...canonicalEntry,
      rank: Math.max(legacyRank, canonicalRank),
      lore: true,
    };
    diff[`system.skills.${legacy}`] = null; // deleteKey (REQ-DOC-037)
  }

  const ops: DocOpPayload[] = [
    {
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff,
    } satisfies DocUpdatePayload,
  ];

  // A choice still pointing at the old key would leave the renamed Lore
  // untrained — the rank comes from the choice, not from the ledger entry.
  const choices = getBuildChoices(sys);
  const repointed = choices.map((c) => {
    const canonical = c.skill === undefined ? undefined : renames.get(c.skill);
    return canonical === undefined ? c : { ...c, skill: canonical };
  });
  if (repointed.some((c, i) => c !== choices[i])) {
    ops.push({
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: { "system.build.choices": repointed },
    } satisfies DocUpdatePayload);
  }

  return ops;
}

/**
 * featIdentity — stable key used to recognize "the same feat" across a
 * picker candidate doc and an already-embedded actor item:
 * `flags.fusion.sourceId` (the importer-stamped vendor-stable id, preserved
 * across `embeddedItemPayload` — never stripped, unlike the pack's own
 * `_id`) when present, else the doc's `name` — the same identity fallback
 * this file already relies on elsewhere (classSlug/ancestrySlug derivation
 * above uses `itemName` the same way).
 */
function featIdentity(featDoc: Record<string, unknown>): string | undefined {
  return itemFusionSourceId(featDoc) ?? itemName(featDoc);
}

/**
 * featMaxTakable — normalized repeat cap for a feat doc, mirroring feats-core's
 * vendor convention. Three cases, and the middle one is easy to get wrong:
 *
 *   - field ABSENT → 1. The overwhelming majority; taking it twice is illegal.
 *   - `maxTakable: null` → **unlimited**. 22 feats in the pack declare this —
 *     Assurance, Additional Lore, Multilingual, Skill Training, Domain
 *     Initiate, Terrain Expertise, Weapon Proficiency… — and every one of them
 *     is legitimately taken many times, once per skill/language/domain. This
 *     used to collapse to 1 along with every other non-number, so the second
 *     pick was refused (issue #57).
 *   - `maxTakable: N > 1` → N (e.g. "Armor Proficiency" → 3).
 */
function featMaxTakable(featDoc: Record<string, unknown>): number {
  const system = asRecord(featDoc["system"]);
  if (!("maxTakable" in system)) return 1;
  const raw = system["maxTakable"];
  if (raw === null) return Number.POSITIVE_INFINITY;
  return typeof raw === "number" && raw > 1 ? raw : 1;
}

/**
 * isFeatAtRepeatCap — true when `featDoc` (a picker candidate) has already
 * been chosen on `doc` as many times as its `maxTakable` allows (W2 frente 1:
 * a non-repeatable feat, e.g. "Acupuncturist", is at cap after the FIRST
 * pick; a `maxTakable: N` feat, e.g. "Armor Proficiency", after N picks).
 *
 * Counts embedded `type: "feat"` items matching `featIdentity` — the
 * reliable "one act of choosing = one embedded item" source.
 * `system.build.choices` entries are NOT used for counting: `chooseFeat`
 * never stamps a choice's `ref`, so those entries carry no feat identity —
 * counting from them would either miss the match entirely or, if summed
 * alongside the items array, double-count the SAME act of choice.
 *
 * `featDoc.type` must be `"feat"` — classFeature docs (hybridStudy, instinct,
 * racket, …) are routed through this same op-builder machinery
 * (`chooseClassChoice` → `chooseFeat`) but never carry `maxTakable`, so they
 * are always exempt from this gate.
 */
export function isFeatAtRepeatCap(
  doc: Record<string, unknown>,
  featDoc: Record<string, unknown>,
  /**
   * Item que está sendo SUBSTITUÍDO nesta mesma operação (r21, integração das
   * frentes 1 e 3). Sem isto, re-selecionar o mesmo talento no mesmo slot —
   * um no-op legítimo — seria recusado: a frente 3 remove o item antigo, mas
   * a contagem da frente 1 roda antes da remoção e ainda o enxerga.
   */
  excludeItemId?: string,
): boolean {
  if (featDoc["type"] !== "feat") return false;
  const identity = featIdentity(featDoc);
  if (!identity) return false;
  const taken = getItems(doc).filter(
    (item) =>
      item["type"] === "feat" &&
      featIdentity(item) === identity &&
      (excludeItemId === undefined || item["_id"] !== excludeItemId),
  ).length;
  return taken >= featMaxTakable(featDoc);
}

/**
 * chooseFeat — doc:create the feat item tagged with `flags.fusion.build =
 * {level, slot}`, plus append a matching entry to `system.build.choices` so
 * removeChoice() can find and clean it up symmetrically.
 *
 * Frente 3: re-selecting an ALREADY-FILLED slot (feat, hybrid study, kinetic
 * gate, …) REPLACES the previous pick — its item, any nested sub-slot it
 * granted (W1-D), and any fixed grant it materialized — via the same
 * cascade `removeChoice` runs on an explicit remove, instead of silently
 * accreting a second item under the same slot id (which left the OLD pick
 * winning every lookup, since `resolveSlot`/`effectiveSkillRank` match the
 * FIRST item/choice for a given slot). The existing item is looked up FRESH
 * from `ctx.doc` (not trusted from the `slot` param) so this is correct even
 * when the caller builds a synthetic slot object with no `itemId` (
 * `chooseClassChoice`/`chooseKineticGate` both do).
 *
 * Frente 1: REQUISITO ORDENA E MARCA, NUNCA BLOQUEIA (specs/31, DEC-BC-05)
 * não cobre repetibilidade: um talento não-repetível escolhido duas vezes
 * (ou um repetível além do seu `maxTakable`) não é "elegível-mas-marcado", é
 * ficha inválida — então este builder RECUSA a op (devolve `[]`, igual à
 * guarda `!ctx.editable`). A contagem ignora o item que esta mesma operação
 * vai substituir, senão re-escolher o mesmo talento no mesmo slot cairia na
 * guarda.
 */
export function chooseFeat(
  ctx: PlanOpBuilderContext,
  slot: PlanSlotModel,
  level: number,
  featDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];

  const existingItem = getItems(ctx.doc).find((it) => {
    const flag = getItemBuildFlag(it);
    return flag !== null && flag.level === level && flag.slot === slot.slotId;
  });
  const existingItemId = existingItem?.["_id"];

  // Teto de repetição (frente 1), medido DEPOIS de saber quem sai: o item que
  // está sendo trocado neste mesmo slot não conta contra o teto.
  if (
    isFeatAtRepeatCap(
      ctx.doc,
      featDoc,
      typeof existingItemId === "string" ? existingItemId : undefined,
    )
  ) {
    return [];
  }

  const ops: DocOpPayload[] = [];
  if (existingItem && typeof existingItemId === "string") {
    ops.push(...removeChoice(ctx, { ...slot, filled: true, itemId: existingItemId }));
  }

  const buildFlag = { level, slot: slot.slotId };
  ops.push({
    type: "doc:create",
    documentType: "Item",
    data: embeddedItemPayload(featDoc, buildFlag),
    parent: { type: "Actor", id: ctx.actorId },
  } satisfies DocCreateEmbeddedPayload);

  // Filtered by slotId regardless of the replace branch above: removeChoice's
  // own choices-diff op (if any) is computed from the SAME stale `ctx.doc`
  // snapshot, so this final write must independently exclude the slot's old
  // entry to stay correct as the LAST write in the sequence.
  const existingChoices = getBuildChoices(getSystem(ctx.doc)).filter((c) => c.slot !== slot.slotId);
  const newChoice: BuildChoice = { level, slot: slot.slotId, type: slot.type };
  ops.push({
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...existingChoices, newChoice] },
  } satisfies DocUpdatePayload);

  return ops;
}

/**
 * chooseAdoptedAncestry — record the ancestry picked for an
 * `adoptedAncestryChoice` sub-slot (Adopted Ancestry's nested pick, see
 * `pushAdoptedAncestrySubSlot`). CHOICE-ONLY, unlike `chooseFeat`: no
 * embedded item is created — the vendor rule element this feat carries only
 * writes a scalar (`system.details.ancestry.adopted`), and Fusion's actor has
 * no such field to mirror it onto, so the pick is recorded purely as a
 * `system.build.choices` entry (same shape as `chooseSkillTraining`'s
 * choice-only marker), carrying the picked ancestry doc's NAME in `ref`.
 * Replaces any prior pick for the SAME sub-slot (re-choosing swaps, not
 * duplicates) — `removeChoice`'s existing `<parentSlotId>:` prefix cascade
 * already strips this entry when the parent "Adopted Ancestry" feat itself is
 * removed.
 */
export function chooseAdoptedAncestry(
  ctx: PlanOpBuilderContext,
  slot: PlanSlotModel,
  level: number,
  ancestryDoc: Record<string, unknown>,
): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  const name = itemName(ancestryDoc);
  if (!name) return null;
  const existingChoices = getBuildChoices(getSystem(ctx.doc)).filter((c) => c.slot !== slot.slotId);
  const newChoice: BuildChoice = { level, slot: slot.slotId, type: slot.type, ref: name };
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...existingChoices, newChoice] },
  };
}

/**
 * chooseClassChoice — same shape as chooseFeat but for a classFeature doc,
 * for any class-declared choice slot (hybridStudy, instinct, racket,
 * huntersEdge, arcaneThesis, arcaneSchool, …). The slot id follows
 * `buildLevelPlan`'s own `<slotType>-<level>` convention (every current
 * CLASS_CHOICE_SLOTS placeholder is declared at level 1, so this is
 * `<slotType>-1` today — level-agnostic in principle, like
 * classChoiceSlotsAtLevel itself). Generic over `slotType` — no per-class
 * branch (r21-W1: generalizes the r19-W2b hybridStudy-only chooseHybridStudy).
 */
export function chooseClassChoice(
  ctx: PlanOpBuilderContext,
  slotType: PlanSlotType,
  level: number,
  featureDoc: Record<string, unknown>,
): DocOpPayload[] {
  const ops = chooseFeat(
    ctx,
    { slotId: `${slotType}-${String(level)}`, type: slotType } as PlanSlotModel,
    level,
    featureDoc,
  );
  if (slotType === "bloodline") {
    ops.push(...bloodlineSpellcastingOps(ctx, featureDoc));
  }
  return ops;
}

/**
 * Bloodline slug from a "Bloodline: <Name>" classFeature doc's name (e.g.
 * "Bloodline: Aberrant" → "aberrant") — matches the lowercase keys
 * `traditionByBloodline` uses (curation/classes/sorcerer.json).
 */
function bloodlineSlugFromDocName(name: string | undefined): string | undefined {
  const stripped = name?.replace(/^Bloodline:\s*/, "").trim();
  return stripped ? stripped.toLowerCase() : undefined;
}

/**
 * Resolves the tradition for a chosen bloodline option. Falls back to
 * "arcane" (same documented default the focus entry already used pre-r22)
 * when the map has no entry, or the entry is explicitly null — a bloodline
 * whose tradition needs a sub-choice this round doesn't model (Draconic; see
 * sorcerer.json's PENDENCIA DE CONTRATO 1 note).
 */
function resolveBloodlineTradition(
  spellcasting: ClassSpellcastingTable,
  bloodlineDoc: Record<string, unknown>,
): string {
  const slug = bloodlineSlugFromDocName(itemName(bloodlineDoc));
  const resolved = slug ? spellcasting.traditionByBloodline?.[slug] : undefined;
  return resolved ?? "arcane";
}

/**
 * r22 — when a class's tradition depends on the chosen bloodline
 * (spellcasting.tradition === null), `applyClass` defers creating the
 * "class:spellcasting"/"class:focus" entries. This builds them (first pick)
 * or re-stamps their tradition (re-pick, swapping bloodlines) once the
 * "Bloodline" choice slot is filled. No-op for any class with a fixed
 * tradition (spellcasting.tradition already set) or no spellcasting at all.
 */
function bloodlineSpellcastingOps(
  ctx: PlanOpBuilderContext,
  bloodlineDoc: Record<string, unknown>,
): DocOpPayload[] {
  const classSystem = readClassSystem(ctx.doc);
  const spellcasting = classSystem?.spellcasting;
  if (!spellcasting || spellcasting.tradition) return [];

  const tradition = resolveBloodlineTradition(spellcasting, bloodlineDoc);
  const level = getLevel(ctx.doc);
  const items = getItems(ctx.doc);
  const ops: DocOpPayload[] = [];

  // Defect fix: swapping bloodlines (e.g. Aberrant → Angelic) re-stamps
  // `system.tradition.value`, but the "class:spellcasting" entry was CREATED
  // with `name: \`${tradition} Spells\`` (buildSpellcastingEntryOp) — leaving
  // the diff at just the tradition value left the entry's NAME stale ("occult
  // Spells" surviving a switch to a divine bloodline). The focus entry's name
  // is fixed ("Focus Spells", never tradition-suffixed — see
  // buildFocusEntryOp), so only the spellcasting slot needs the rename.
  const restamp = (slot: "class:spellcasting" | "class:focus"): boolean => {
    const existing = items.find((it) => getItemBuildFlag(it)?.slot === slot);
    const id = existing?.["_id"];
    if (typeof id !== "string") return false;
    const diff: Record<string, unknown> = { "system.tradition.value": tradition };
    if (slot === "class:spellcasting") {
      diff["name"] = `${tradition} Spells`;
    }
    ops.push({
      type: "doc:update",
      documentType: "Item",
      id,
      embedded: { type: "Item", id: ctx.actorId },
      diff,
    } satisfies DocUpdatePayload);
    return true;
  };

  if (!restamp("class:spellcasting")) {
    ops.push(buildSpellcastingEntryOp(ctx, spellcasting, tradition, level));
  }
  if (hasFocusFeature(classSystem)) {
    if (!restamp("class:focus")) {
      ops.push(buildFocusEntryOp(ctx, spellcasting.ability, tradition));
      // Same pairing as applyClass (issue #4): the Sorcerer's focus entry is
      // created HERE, once the bloodline resolves the tradition, so the pool
      // has to open here too. A restamp is a bloodline SWAP — the pool is
      // already open and its spent points are the player's, not ours to reset.
      ops.push(buildFocusPoolOp(ctx, INITIAL_FOCUS_POOL));
    }
  }
  return ops;
}

/**
 * chooseKineticGate — emit the "Kinetic Gate" classFeature with the chosen
 * gate picks stamped into `system.kineticGates` (the shape
 * stepCharElementalBlasts reads to derive the Elemental Blasts).
 *
 * `featureDoc` is the vendor "Kinetic Gate" classFeature (class-features-core);
 * `picks` is 1 element (single gate) or 2 (dual gate), each with its chosen
 * damage type. Invalid damage types are dropped defensively (the derivation
 * would fall back anyway), but the dialog only ever offers valid ones.
 *
 * Records the choice both as an embedded item (with `flags.fusion.build`) and
 * a `system.build.choices` marker, exactly like a feat — so removeChoice and
 * the slot's `filled` state work with no special case.
 */
export function chooseKineticGate(
  ctx: PlanOpBuilderContext,
  level: number,
  featureDoc: Record<string, unknown>,
  picks: KineticGatePick[],
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const kineticGates = picks
    .filter((p) => (KINETIC_ELEMENTS as readonly string[]).includes(p.element))
    .map((p) => {
      const valid = KINETIC_ELEMENT_DAMAGE_TYPES[p.element];
      const damageType = p.damageType && valid.includes(p.damageType) ? p.damageType : valid[0];
      return { element: p.element, damageType };
    });

  const featureSystem = asRecord(featureDoc["system"]);
  const gateDoc: Record<string, unknown> = {
    ...featureDoc,
    system: { ...featureSystem, kineticGates },
  };

  const slot = { slotId: "kineticGate-1", type: "kineticGate" } as PlanSlotModel;
  return chooseFeat(ctx, slot, level, gateDoc);
}

/**
 * chooseSkillTraining/chooseSkillIncrease — append a `system.build.choices`
 * entry (no embedded item involved). `explicitRank` overrides the
 * type-implied default (training → 1, increase → current+1) — the caller
 * passes the derived VM's current effective rank for the skill when known,
 * so the recorded choice always carries a concrete resulting rank (avoids
 * relying on stepCharBuildSkills's fallback — see build.ts's doc comment on
 * that fallback, "audit r10-A, low issue 3").
 */
export function chooseSkillTraining(
  ctx: PlanOpBuilderContext,
  slot: PlanSlotModel,
  level: number,
  skillSlug: string,
): DocUpdatePayload | null {
  return upsertSkillChoice(ctx, slot, level, skillSlug, "skillTraining", 1);
}

export function chooseSkillIncrease(
  ctx: PlanOpBuilderContext,
  slot: PlanSlotModel,
  level: number,
  skillSlug: string,
  currentRank: number,
): DocUpdatePayload | null {
  const nextRank = Math.min(currentRank + 1, 4);
  return upsertSkillChoice(ctx, slot, level, skillSlug, "skillIncrease", nextRank);
}

function upsertSkillChoice(
  ctx: PlanOpBuilderContext,
  slot: PlanSlotModel,
  level: number,
  skillSlug: string,
  type: "skillTraining" | "skillIncrease",
  rank: number,
): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  const existingChoices = getBuildChoices(getSystem(ctx.doc)).filter((c) => c.slot !== slot.slotId);
  const newChoice: BuildChoice = { level, slot: slot.slotId, type, skill: skillSlug, rank };
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...existingChoices, newChoice] },
  };
}

// ---------------------------------------------------------------------------
// Bulk skill training/increase dialog (R11 item 1 — Pathbuilder-style mass
// picker replacing the one-at-a-time skillTraining/skillIncrease mini-dialog).
//
// The Plan column collapses every skillTraining-<level>-* (or
// skillIncrease-<level>) slot of the SAME level into a single UI entry
// ("Treinamento de Perícias (x/N)") that opens `SkillTrainingDialog`. This
// dialog needs, for every one of the 16 canonical skills + lores: the
// CURRENT rank/modifier, the TARGET rank/modifier if picked, a TEML badge
// pair, and the ability/proficiency breakdown — all pure, no socket.
// ---------------------------------------------------------------------------

/** Mirrors characterSheetVM.ts's SKILL_ABILITY (kept in sync by hand — same rule as ABILITY_SLUGS above). */
export const SKILL_ABILITY: Record<string, AbilitySlug> = {
  acrobatics: "dex",
  arcana: "int",
  athletics: "str",
  crafting: "int",
  deception: "cha",
  diplomacy: "cha",
  intimidation: "cha",
  medicine: "wis",
  nature: "wis",
  occultism: "int",
  performance: "cha",
  religion: "wis",
  society: "int",
  stealth: "dex",
  survival: "wis",
  thievery: "dex",
};

/** The 16 canonical PF2e skill slugs (REQ-PF2-012) — mirrors CANONICAL_SKILL_SLUGS in characterSheetVM.ts. */
export const CANONICAL_SKILL_SLUGS: readonly string[] = Object.keys(SKILL_ABILITY);

/**
 * proficiencyBonus — pure mirror of systems/pf2e/src/derivations/helpers.ts's
 * `proficiencyBonus`/`calculateProficiencyBonus`: untrained (rank 0) = +0
 * (level NOT added); trained..legendary = rank*2 + level. MUST stay in sync
 * with the server-side implementation.
 */
export function skillProficiencyBonus(rank: number, level: number): number {
  return rank === 0 ? 0 : rank * 2 + level;
}

/** Read the persisted (manual) rank of a skill from `system.skills`, tolerating a missing entry. */
function manualSkillRank(sys: Record<string, unknown>, slug: string): number {
  const skills = asRecord(sys["skills"]);
  const entry = asRecord(skills[slug]);
  const rank = entry["rank"];
  return typeof rank === "number" ? rank : 0;
}

/**
 * effectiveSkillRank — pure mirror of systems/pf2e/src/derivations/build.ts's
 * `stepCharBuildSkills`: the rank a skill has RIGHT NOW once the class's
 * `trainedSkills.value` and every `system.build.choices` entry of type
 * skillTraining/skillIncrease with `level <= charLevel` are folded in as a
 * FLOOR over the manually-persisted `system.skills.<slug>.rank` (never an
 * override — same `max(manualRank, buildRank)` merge policy).
 *
 * This is what makes `skillTrainingDialogContext` see a skill as "already
 * trained" from a build choice ALONE, even on a doc where `system.skills`
 * itself was never explicitly derived/persisted (e.g. a freshly-built
 * in-memory doc, or a unit test fixture) — the same doc shape
 * `stepCharBuildSkills` reads server-side. MUST stay in sync with that
 * server-side implementation.
 */
function effectiveSkillRank(
  doc: Record<string, unknown>,
  slug: string,
  charLevel: number,
  /**
   * Slot ids to EXCLUDE from the build-choice fold (R12 item 1): when the
   * skill-training dialog reopens to re-edit a level+kind group, the group's
   * OWN choices must not count toward the row's current rank — otherwise a
   * skill trained by this very group would report `currentRank >= 1` and so
   * become ineligible/irreversible, making it impossible to swap or remove
   * within the same dialog. Empty set = the normal "rank right now" reading.
   */
  ignoreSlotIds?: ReadonlySet<string>,
): number {
  const sys = getSystem(doc);
  let rank = manualSkillRank(sys, slug);

  const classSystem = readClassSystem(doc);
  if ((classSystem?.trainedSkills?.value ?? []).includes(slug)) {
    rank = Math.max(rank, 1);
  }

  const choices = getBuildChoices(sys)
    .filter(
      (c) =>
        (c.type === "skillTraining" || c.type === "skillIncrease") &&
        c.level <= charLevel &&
        c.skill === slug,
    )
    .filter((c) => !ignoreSlotIds?.has(c.slot))
    .sort((a, b) => a.level - b.level);
  for (const choice of choices) {
    const target = choice.rank ?? (choice.type === "skillTraining" ? 1 : Math.min(rank + 1, 4));
    rank = Math.max(rank, target);
  }

  return rank;
}

/** Every lore skill slug present on `system.skills` (flagged `lore: true`), sorted alphabetically. */
function existingLoreSlugs(sys: Record<string, unknown>): string[] {
  const skills = asRecord(sys["skills"]);
  return Object.keys(skills)
    .filter((slug) => asRecord(skills[slug])["lore"] === true)
    .sort((a, b) => a.localeCompare(b));
}

export type SkillTrainingDialogKind = "skillTraining" | "skillIncrease";

export interface SkillTrainingRow {
  slug: string;
  isLore: boolean;
  ability: AbilitySlug;
  /** Current rank (0-4, TEML) BEFORE this dialog's picks are applied. */
  currentRank: number;
  currentMod: number;
  currentModFormatted: string;
  /** Rank/mod this row would have if selected (current picks + this pick). Equals current when not selected. */
  targetRank: number;
  targetMod: number;
  targetModFormatted: string;
  abilityMod: number;
  /** Whether this row can be selected at all for the dialog's kind (skillTraining: untrained only; skillIncrease: trained..master). */
  eligible: boolean;
}

export interface SkillTrainingDialogContext {
  kind: SkillTrainingDialogKind;
  level: number;
  /** Total slots of this kind at this level (e.g. trainedSkills.additional + Int mod). */
  totalSlots: number;
  /**
   * ALL slot ids of this level+kind, in order (both filled and empty). The
   * dialog reconciles its FULL pick list against these 1:1 on confirm, so a
   * re-open pre-populated with the already-picked skills can substitute the
   * whole group at once (R12 item 1 — in-place re-editing of a filled slot),
   * not merely append to the empty tail.
   */
  groupSlotIds: string[];
  /** Slot ids (in order) still unfilled — kept for callers that only append. */
  emptySlotIds: string[];
  /**
   * Skill slugs already picked for this level+kind, aligned to the FILLED
   * subset of `groupSlotIds` in slot order (R12 item 1). The dialog seeds its
   * initial selection with these so a re-opened filled slot shows the current
   * ledger picks pre-selected and reversible.
   */
  filledPicks: string[];
  rows: SkillTrainingRow[];
}

/**
 * skillTrainingDialogContext — everything `SkillTrainingDialog` needs to
 * render the mass picker for every skillTraining-<level>-* (or the single
 * skillIncrease-<level>) slot of one level, computed from the live doc: the
 * remaining slot count, which slot ids are still empty, and one row per
 * canonical skill + existing lore with current/target rank+modifier.
 *
 * `kind` selects eligibility: "skillTraining" only offers currently
 * untrained skills (rank 0 -> 1); "skillIncrease" only offers skills already
 * trained but below Legendary (rank 1-3 -> +1), matching PF2e Remaster rules
 * (you cannot "train" an already-trained skill via a training slot, and you
 * cannot "increase" an untrained one).
 */
export function skillTrainingDialogContext(
  doc: Record<string, unknown>,
  level: number,
  kind: SkillTrainingDialogKind,
): SkillTrainingDialogContext {
  const sys = getSystem(doc);
  const abilities = getBuildAbilities(sys);
  const charLevel = getLevel(doc);
  const scores = computeAbilityScores(abilities, charLevel);

  // Reuse derivePlan's own level model (which already collapses every
  // skillTraining-<level>-*/skillIncrease-<level> slot into one group slot
  // per DEC — see collapseSkillSlotGroups) rather than re-deriving the raw
  // per-slot list here: the group slot's `groupSlotIds` already carries the
  // authoritative ordered list of underlying slot ids, and `filledCount`
  // already tells us how many of them are taken.
  const plan = derivePlan(doc);
  const levelPlan = plan.levels.find((l) => l.level === level);
  const groupSlot = levelPlan?.slots.find((s) => s.type === kind);
  const groupSlotIds = groupSlot?.groupSlotIds ?? [];
  const totalSlots = groupSlot?.totalCount ?? 0;

  // Re-derive which of the group's member slot ids are actually filled —
  // resolveSlot's own filled predicate (choices matching level+slotId), kept
  // here as a thin re-check since collapseSkillSlotGroups doesn't expose the
  // per-member filled flags, only the aggregate count.
  const choices = getBuildChoices(sys);
  const skillBySlot = new Map(
    choices
      .filter((c) => c.type === kind && c.level === level && typeof c.skill === "string")
      .map((c) => [c.slot, c.skill as string]),
  );
  const emptySlotIds = groupSlotIds.filter((id) => !skillBySlot.has(id));
  // The already-picked slugs, aligned to filled slots in group order (R12
  // item 1) — seeds the dialog so a re-opened filled slot shows current picks.
  const filledPicks = groupSlotIds
    .map((id) => skillBySlot.get(id))
    .filter((skill): skill is string => skill !== undefined);

  const loreSlugs = existingLoreSlugs(sys);
  const allSlugs = [...CANONICAL_SKILL_SLUGS, ...loreSlugs];

  // Exclude THIS group's own choices from each row's current-rank reading
  // (R12 item 1) so a re-opened filled slot shows every already-picked skill
  // as still-eligible/reversible instead of frozen at the rank its own pick
  // granted. Ranks from OTHER levels/kinds still count as a floor (you can't
  // "train" a skill this level made Expert elsewhere).
  const groupSlotIdSet = new Set(groupSlotIds);

  const rows: SkillTrainingRow[] = allSlugs.map((slug) => {
    const isLore = loreSlugs.includes(slug);
    const ability: AbilitySlug = isLore ? "int" : (SKILL_ABILITY[slug] ?? "int");
    const abilityModValue = abilityMod(scores[ability]);
    const currentRank = effectiveSkillRank(doc, slug, charLevel, groupSlotIdSet);
    const currentMod = abilityModValue + skillProficiencyBonus(currentRank, charLevel);

    const targetRank = kind === "skillTraining" ? 1 : Math.min(currentRank + 1, 4);
    const targetMod = abilityModValue + skillProficiencyBonus(targetRank, charLevel);

    const eligible =
      kind === "skillTraining" ? currentRank === 0 : currentRank >= 1 && currentRank < 4;

    return {
      slug,
      isLore,
      ability,
      currentRank,
      currentMod,
      currentModFormatted: fmtModLocal(currentMod),
      targetRank,
      targetMod,
      targetModFormatted: fmtModLocal(targetMod),
      abilityMod: abilityModValue,
      eligible,
    };
  });

  return { kind, level, totalSlots, groupSlotIds, emptySlotIds, filledPicks, rows };
}

function fmtModLocal(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/**
 * confirmSkillTraining — persist ALL of the dialog's picks in a SINGLE
 * doc:update carrying the whole `system.build.choices` array (lesson r10:
 * diffs never index arrays — the entire array is always sent whole).
 *
 * `picks` is the dialog's COMPLETE selection (already-picked skills that
 * survived + newly chosen ones), zipped 1:1 onto `dialogCtx.groupSlotIds` in
 * order — reconciling the WHOLE level+kind group, not merely appending to the
 * empty tail (R12 item 1 — in-place re-editing of an already-filled group).
 * Any group slot that receives no pick (because the player deselected a skill
 * it previously held) has its `choices` entry dropped, so a reopened filled
 * slot can genuinely swap or remove a pick. Picks beyond `groupSlotIds.length`
 * are ignored (defensive; the dialog disables "Concluído" until
 * picks.length === totalSlots).
 *
 * Choices of OTHER levels/kinds are byte-preserved — only this level+kind's
 * group slot ids are reconciled, so re-editing one level's skill trainings
 * never disturbs another level's or the ability-boost marker.
 */
export function confirmSkillTraining(
  ctx: PlanOpBuilderContext,
  dialogCtx: SkillTrainingDialogContext,
  picks: string[],
): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  const existingChoices = getBuildChoices(getSystem(ctx.doc));
  const rowBySlug = new Map(dialogCtx.rows.map((r) => [r.slug, r]));

  const newChoices: BuildChoice[] = [];
  for (let i = 0; i < dialogCtx.groupSlotIds.length && i < picks.length; i++) {
    const slotId = dialogCtx.groupSlotIds[i];
    const skillSlug = picks[i];
    if (!slotId || !skillSlug) continue;
    const row = rowBySlug.get(skillSlug);
    const rank = row?.targetRank ?? (dialogCtx.kind === "skillTraining" ? 1 : 2);
    newChoices.push({
      level: dialogCtx.level,
      slot: slotId,
      type: dialogCtx.kind,
      skill: skillSlug,
      rank,
    });
  }

  // Drop EVERY prior choice occupying one of this group's slot ids (whether it
  // received a new pick or was deselected), then re-append the reconciled set
  // — a full substitution of the level+kind group, leaving all other choices
  // untouched.
  const groupSlotIdSet = new Set(dialogCtx.groupSlotIds);
  const remaining = existingChoices.filter((c) => !groupSlotIdSet.has(c.slot));

  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...remaining, ...newChoices] },
  };
}

/**
 * addLoreSkill — create a new custom Lore skill (rank 0) on `system.skills`,
 * keyed by the canonical `loreSlug(name)`. Pure `doc:update` — the dialog calls
 * this BEFORE offering the new lore as a pickable row (it must exist on the
 * ledger to be targetable by a skillTraining pick in the same session).
 *
 * Contract C3: one subject, ONE key. This used to build its own slug inline —
 * a third convention that kept the trailing "Lore" word ("Nature Lore" →
 * `lore-nature-lore`) and did not fold accents, so a hand-added Lore forked
 * away from the `lore-nature` a background grant produces for the same subject
 * and the sheet showed two rows for one proficiency.
 */
export function addLoreSkill(ctx: PlanOpBuilderContext, name: string): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const slug = loreSlug(trimmed);
  // A subject-less Lore ("Lore", "  Lore ") is meaningless — and would claim
  // the bare `lore` key that every future subject-less entry collides on.
  if (slug === "lore") return null;
  const sys = getSystem(ctx.doc);
  const skills = asRecord(sys["skills"]);
  if (skills[slug]) return null; // already exists — no-op (caller should filter its own list too)
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { [`system.skills.${slug}`]: { rank: 0, lore: true, label: trimmed } },
  };
}

/**
 * setAbilityBoosts — overwrite one origin's boost slugs (ancestryFree,
 * backgroundFree, backgroundBoosts, classBoost, or a levelled-boosts level)
 * with the player's picks. `origin` "levelled" requires `level` to key
 * `levelledBoosts`.
 */
export function setAbilityBoosts(
  ctx: PlanOpBuilderContext,
  origin: "ancestryFree" | "backgroundFree" | "backgroundBoosts" | "classBoost" | "levelled",
  slugs: string[],
  level?: number,
): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  if (origin === "levelled") {
    if (level === undefined) return null;
    const existing = getBuildAbilities(getSystem(ctx.doc)).levelledBoosts;
    return {
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: {
        "system.build.abilities.levelledBoosts": { ...existing, [String(level)]: slugs },
      },
    };
  }
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { [`system.build.abilities.${origin}`]: slugs },
  };
}

/**
 * markAbilityBoostsChoice — upsert a `system.build.choices` marker entry for
 * an `abilityBoosts-<level>` slot (R10-D item 2, D2 fix).
 *
 * HISTORICAL NOTE (R11 item 2 fix): this marker is NO LONGER what makes the
 * Plan column render the abilityBoosts-N slot as filled — `resolveSlot` for
 * that type was replaced by `resolveAbilityBoostsSlot`, which derives
 * "filled" from the actual `system.build.abilities.*` ledger via
 * `abilityBoostsSlotContext`/`isAbilityBoostsSlotFilled`. This was exactly
 * the production bug: a doc could carry this marker with ZERO backing boost
 * data (Tobias's real-world doc) and render as filled while every ability
 * score stayed wrong.
 *
 * Kept only for `removeChoice`'s symmetry (it strips whatever `choices`
 * entry matches a slot id, including this legacy marker type, on old docs
 * that still carry one) and because emitting it alongside `setAbilityBoosts`
 * is harmless — it no longer has any effect on `derivePlan`'s filled state.
 */
export function markAbilityBoostsChoice(
  ctx: PlanOpBuilderContext,
  slotId: string,
  level: number,
): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  const existingChoices = getBuildChoices(getSystem(ctx.doc)).filter((c) => c.slot !== slotId);
  const newChoice: BuildChoice = { level, slot: slotId, type: "abilityBoosts" };
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...existingChoices, newChoice] },
  };
}

/** Which BuildAbilities field a free-boost group's confirmed slugs are written to. */
export type AbilityBoostsOrigin = "ancestryFree" | "backgroundFree" | "classBoost" | "levelled";

/**
 * One selectable group inside the abilityBoosts-N dialog: a origin (where
 * the confirmed slugs are persisted) + how many free picks it grants +
 * whatever slugs are already picked (pre-seeds the dialog on reopen).
 *
 * Boosts from the SAME origin never repeat an ability (PF2e Remaster rule) —
 * enforced by the dialog not double-counting a slug within one group; a
 * later group MAY reuse an ability another group already boosted (e.g.
 * ancestryFree picking cha and the level-1 free boosts also picking cha is
 * legal — different origins).
 */
export interface AbilityBoostsGroup {
  origin: AbilityBoostsOrigin;
  freeCount: number;
  initialFreeSlugs: string[];
  /**
   * Ability slugs this group may NOT pick — only the abilities already
   * boosted by the SAME origin (PF2e rule: one boost set never applies two
   * boosts to the same ability, but DIFFERENT origins may repeat — that's
   * how 16s exist at level 1). Live-verification finding (r11): blocking the
   * global fixedSlugs in every group made Tobias's real allocation
   * (dex/int repeated across ancestry, background and level-1 boosts)
   * impossible to enter.
   */
  excludedSlugs: string[];
  /**
   * When present, ONLY these slugs are offered (class boost: the class's
   * keyAbility options — Magus offers str|dex). Absent = all six abilities.
   */
  allowedSlugs?: string[];
}

/**
 * abilityBoostsSlotContext — everything the "Dádivas de Atributo" dialog
 * needs to render one abilityBoosts slot (R10-D item 2/D2, extended R11 item
 * 1 for the FULL level-1 dádivas model):
 *
 *   - level 1: `fixedSlugs` = ancestryBoosts + ancestryFlaws-adjusted +
 *     backgroundBoosts + classBoost (all read-only in the UI — already
 *     decided by the ABC picks); THREE independent free-pick groups:
 *       1. ancestryFree — count = the embedded ancestry item's `system.
 *          boosts` "free" entries (0 if no ancestry yet).
 *       2. backgroundFree — count = the embedded background item's `system.
 *          boosts` "free" entries (0 if no background yet).
 *       3. levelled (keyed "1") — ALWAYS 4 free boosts (PF2e Remaster level-1
 *          rule, independent of ancestry/background/class picks).
 *   - a levelled milestone (5/10/15/20 by default): no fixed slugs, a single
 *     "levelled" group of 4 free picks, pre-seeded from `levelledBoosts[level]`.
 *
 * Ancestry/background free-boost COUNTS are read from the embedded item's
 * OWN `system.boosts` array (counting `"free"` sentinel entries) rather than
 * from a dedicated ledger field — the compendium doc is the source of truth
 * for how many free boosts that origin grants, and every ancestry/background
 * in the core packs varies this count (Ratfolk: 1 free; Fireworks Performer:
 * 2 free) — see systems/pf2e/packs/{ancestries,backgrounds}-core.
 */
export interface AbilityBoostsSlotContext {
  /** Ability slugs already fixed for this level's boost step (read-only in the UI). */
  fixedSlugs: string[];
  /** One or more independent free-pick groups (level 1 has up to 3; a levelled milestone has exactly 1). */
  groups: AbilityBoostsGroup[];
}

/**
 * The class's key-ability OPTIONS for the classBoost group, read from the
 * embedded class item's `system.keyAbility` (kept as the full option list —
 * Magus ships ["str","dex"]; applyClass narrowing may reduce it to one).
 * Returns undefined (no restriction) when unreadable, so a malformed class
 * item degrades to "any ability" instead of an empty, unfillable group.
 */
function classKeyAbilityOptions(
  classItem: Record<string, unknown> | undefined,
): string[] | undefined {
  if (!classItem) return undefined;
  const sys = asRecord(classItem["system"]);
  const options = asStringArray(sys["keyAbility"]);
  // A single-option list means either a genuinely fixed-key class OR a doc
  // narrowed by the pre-r11 applyClass bug (the user's real Tobias carries
  // Magus keyAbility ["dex"]). Restricting to it would make the true pick
  // (str) permanently unreachable — so only lists with a real choice
  // restrict the group; everything else offers all six (the ledger records
  // whatever is picked, and the server derives from the ledger).
  return options.length > 1 ? options : undefined;
}

function countFreeBoostSlots(itemDoc: Record<string, unknown> | undefined): number {
  if (!itemDoc) return 0;
  const sys = asRecord(itemDoc["system"]);
  const boosts = asStringArray(sys["boosts"]);
  return boosts.filter((b) => b === "free").length;
}

export function abilityBoostsSlotContext(
  doc: Record<string, unknown>,
  level: number,
): AbilityBoostsSlotContext {
  const abilities = getBuildAbilities(getSystem(doc));
  if (level === 1) {
    const ancestryItem = findFirstItemByType(doc, "ancestry");
    const backgroundItem = findFirstItemByType(doc, "background");
    const groups: AbilityBoostsGroup[] = [
      {
        origin: "ancestryFree",
        freeCount: countFreeBoostSlots(ancestryItem),
        initialFreeSlugs: abilities.ancestryFree,
        excludedSlugs: abilities.ancestryBoosts,
      },
      {
        origin: "backgroundFree",
        freeCount: countFreeBoostSlots(backgroundItem),
        initialFreeSlugs: abilities.backgroundFree,
        excludedSlugs: abilities.backgroundBoosts,
      },
      {
        origin: "classBoost",
        // The class grants exactly one key-ability boost; the options come
        // from the EMBEDDED class item's keyAbility array (Magus: str|dex).
        // Missing class item → 0 choices (group hidden by the dialog).
        // Live-verification finding (r11): without this group the class
        // boost never reached the ledger and STR stayed 8 instead of 10.
        freeCount: findFirstItemByType(doc, "class") ? 1 : 0,
        initialFreeSlugs: abilities.classBoost,
        excludedSlugs: [],
        ...withOptional("allowedSlugs", classKeyAbilityOptions(findFirstItemByType(doc, "class"))),
      },
      {
        origin: "levelled",
        freeCount: 4,
        initialFreeSlugs: abilities.levelledBoosts["1"] ?? [],
        excludedSlugs: [],
      },
    ];
    return {
      fixedSlugs: [...abilities.ancestryBoosts, ...abilities.backgroundBoosts],
      groups,
    };
  }
  return {
    fixedSlugs: [],
    groups: [
      {
        origin: "levelled",
        freeCount: 4,
        initialFreeSlugs: abilities.levelledBoosts[String(level)] ?? [],
        excludedSlugs: [],
      },
    ],
  };
}

/**
 * previewAbilityScores — LIVE preview of the resulting ability scores/mods
 * for the AbilityBoostsDialog (R11 item 2), given the player's IN-PROGRESS
 * picks for each of `slotCtx.groups` (not yet persisted). Overlays
 * `selectedByGroup[i]` onto `slotCtx.groups[i].origin`'s slot in a COPY of
 * the doc's current `BuildAbilities` ledger, then runs the same
 * `computeAbilityScores` the rest of the builder uses — so the dialog always
 * shows exactly what `derivePlan`/`isAbilityBoostsSlotFilled` will see once
 * "Concluído" is pressed, with no separate preview math to keep in sync.
 */
export function previewAbilityScores(
  doc: Record<string, unknown>,
  level: number,
  groups: AbilityBoostsGroup[],
  selectedByGroup: string[][],
): Record<AbilitySlug, number> {
  const abilities: BuildAbilities = { ...getBuildAbilities(getSystem(doc)) };
  abilities.levelledBoosts = { ...abilities.levelledBoosts };

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group) continue;
    const slugs = selectedByGroup[i] ?? [];
    switch (group.origin) {
      case "ancestryFree":
        abilities.ancestryFree = slugs;
        break;
      case "backgroundFree":
        abilities.backgroundFree = slugs;
        break;
      case "classBoost":
        // r11 live-verification fix: without this case the class group's
        // pick was silently dropped from the preview (the confirm path was
        // already generic over origins and persisted it correctly).
        abilities.classBoost = slugs;
        break;
      case "levelled":
        abilities.levelledBoosts[String(level)] = slugs;
        break;
    }
  }

  return computeAbilityScores(abilities, getLevel(doc));
}

/**
 * isAbilityBoostsSlotFilled — a level's abilityBoosts slot is "filled" when
 * EVERY group in its context has exactly as many slugs picked as its
 * freeCount (a group with freeCount 0 — e.g. no ancestry/background applied
 * yet — is trivially satisfied). This is what makes the slot's filled state
 * DERIVED from the actual ledger (R11 item 2 fix) instead of a marker choice
 * recorded separately from the data — a doc missing boosts (like the
 * Tobias production bug: an `abilityBoosts-1` choice marker with NO
 * ancestryFree/backgroundFree/levelledBoosts data at all) now correctly
 * reports unfilled, and self-corrects the moment the player finishes the
 * dialog for real.
 */
export function isAbilityBoostsSlotFilled(slotCtx: AbilityBoostsSlotContext): boolean {
  return slotCtx.groups.every(
    (g) => g.freeCount === 0 || g.initialFreeSlugs.length === g.freeCount,
  );
}

/** setFreeArchetype — toggle the Free Archetype variant rule. */
export function setFreeArchetype(ctx: PlanOpBuilderContext, on: boolean): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  return {
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.freeArchetype": on },
  };
}

/**
 * setClassLevelsVariant — turn the multiclass-by-class-levels variant on/off
 * (specs/30 REQ-MCL-001, REQ-MCL-004).
 *
 * Turning it ON seeds the split with "every level so far in the class that is
 * already on the sheet" (REQ-MCL-003): an existing character must keep
 * deriving exactly what it derived before, and an empty split would read as
 * "no class bought any level".
 *
 * Turning it OFF leaves the `classLevel` choices in place rather than deleting
 * them — the server ignores them entirely while the toggle is false, and
 * keeping them means flipping the switch back does not lose the plan.
 */
export function setClassLevelsVariant(
  ctx: PlanOpBuilderContext,
  on: boolean,
): DocUpdatePayload | null {
  if (!ctx.editable) return null;

  const diff: Record<string, unknown> = { "system.build.variantRules.classLevels": on };

  if (on) {
    const sys = getSystem(ctx.doc);
    const choices = getBuildChoices(sys);
    const alreadySplit = choices.some((c) => c.type === "classLevel");
    const primary = classesOnSheet(ctx.doc)[0];
    if (!alreadySplit && primary) {
      const level = getLevel(ctx.doc);
      const seeded: BuildChoice[] = [];
      for (let lvl = 1; lvl <= level; lvl++) {
        seeded.push({
          level: lvl,
          slot: `classLevel-${String(lvl)}`,
          type: "classLevel",
          ref: primary.sourceId,
        });
      }
      diff["system.build.choices"] = [...choices, ...seeded];
    }
  }

  return { type: "doc:update", documentType: "Actor", id: ctx.actorId, diff };
}

/**
 * chooseClassLevel — assign a character level to a class.
 *
 * Two things can happen:
 *   - the class is already on the sheet → only the choice is recorded;
 *   - the class is NEW → its `type: 'class'` item is materialized too, so the
 *     server sees one item per distinct class (REQ-MCL-011) and can derive
 *     proficiencies, HP and spell slots from it.
 *
 * The new-class case is gated by the table's rule (`canTakeNewClassAt`): a new
 * class enters at level 1 or at an even level. The gate lives here as well as
 * in the picker because an op builder that trusts the UI to have filtered
 * correctly is one bug away from writing an illegal build.
 */
export function chooseClassLevel(
  ctx: PlanOpBuilderContext,
  level: number,
  classDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];

  const fusion = asRecord(asRecord(classDoc["flags"])["fusion"]);
  const sourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
  if (!sourceId) return [];

  const sheetClasses = classesOnSheet(ctx.doc);
  const isNew = !sheetClasses.some((c) => c.sourceId === sourceId);
  if (isNew && !canTakeNewClassAt(level)) return [];

  // Idempotence guard: the class may already be on the sheet even though this
  // snapshot of `ctx.doc` does not show it — two picks in quick succession
  // share the same stale doc, and the second one would create a SECOND item
  // for a class the character already has. Seen live: a duplicated Cleric.
  const alreadyRecorded = getBuildChoices(getSystem(ctx.doc)).some(
    (c) => c.type === "classLevel" && c.ref !== undefined && c.ref.includes(sourceId),
  );
  const shouldCreateItem = isNew && !alreadyRecorded;

  const ops: DocOpPayload[] = [];
  const slotId = `classLevel-${String(level)}`;

  if (shouldCreateItem) {
    // A second class item — NOT a replacement. `applyClass` would swap the
    // existing class out (that is its job, for re-picking a single class);
    // here both classes must coexist.
    ops.push({
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(classDoc, { level, slot: `class:${sourceId}` }),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload);

    // Its spellcasting entry, when the class casts and its tradition is fixed.
    // `classKey` is what lets the server attribute the entry to THIS class —
    // with two casting classes and no flag it refuses to guess.
    const classSystem = asRecord(classDoc["system"]) as unknown as ClassSystemLike;
    const spellcasting = classSystem.spellcasting;
    if (spellcasting?.tradition) {
      const entryOp = buildSpellcastingEntryOp(ctx, spellcasting, spellcasting.tradition, level);
      const data = asRecord(entryOp.data);
      const flags = asRecord(data["flags"]);
      const fusionFlags = asRecord(flags["fusion"]);
      data["flags"] = { ...flags, fusion: { ...fusionFlags, classKey: sourceId } };
      ops.push(entryOp);
    }
  }

  const existingChoices = getBuildChoices(getSystem(ctx.doc)).filter((c) => c.slot !== slotId);
  const newChoice: BuildChoice = { level, slot: slotId, type: "classLevel", ref: sourceId };
  ops.push({
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...existingChoices, newChoice] },
  } satisfies DocUpdatePayload);

  return ops;
}

/**
 * removeChoice — clean up a filled slot: doc:delete the backing item (if
 * any) and strip the matching `system.build.choices` entry (if any). A slot
 * may have EITHER (item-backed: feat/hybridStudy) OR (choice-only:
 * abilityBoosts/skillTraining/skillIncrease) OR — defensively — both; this
 * builder handles all three by inspecting the slot model itself, so it never
 * needs to duplicate `resolveSlot`'s matching logic.
 */
export function removeChoice(ctx: PlanOpBuilderContext, slot: PlanSlotModel): DocOpPayload[] {
  if (!ctx.editable) return [];
  const ops: DocOpPayload[] = [];
  /** Build slots whose item the grantedBy cascade deletes (issue #15). */
  const cascadedBuildSlots = new Set<string>();

  if (slot.itemId) {
    ops.push({
      type: "doc:delete",
      documentType: "Item",
      id: slot.itemId,
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocDeleteEmbeddedPayload);
  }

  // Cascade: removing a slot must also remove every NESTED sub-slot item whose
  // `flags.fusion.build.slot` is prefixed by `<slot.slotId>:` — covers the
  // W1-D `:granted` feat sub-slot (Basic Concoction → nested alchemist feat)
  // AND the Kinetic Gate's `:impulse:<element>` sub-slots (r19-W2b: one per
  // gate element). A single prefix rule handles any current or future nested
  // convention, so a sub-slot's own `resolveSlot` lookup reports unfilled/
  // absent after the parent (or gate) is removed.
  const subSlotPrefix = `${slot.slotId}:`;
  for (const it of getItems(ctx.doc)) {
    const flagSlot = getItemBuildFlag(it)?.slot;
    if (flagSlot === undefined || !flagSlot.startsWith(subSlotPrefix)) continue;
    const subItemId = it["_id"];
    if (typeof subItemId === "string") {
      ops.push({
        type: "doc:delete",
        documentType: "Item",
        id: subItemId,
        parent: { type: "Actor", id: ctx.actorId },
      } satisfies DocDeleteEmbeddedPayload);
    }
  }

  // Cascade (B2 r14): removing a granter also removes every FIXED grant it
  // materialized — items tagged `flags.fusion.grantedBy === granterSourceId`
  // (feats, actions, spells alike, incl. nested grants, since materializeGrants
  // tags the whole subtree by the ROOT granter's sourceId). Idempotent with the
  // W1-D cascade above: a grantedFeat sub-slot item is `flags.fusion.build`-
  // tagged, not `grantedBy`-tagged, so the two never double-delete.
  if (slot.itemId) {
    const granter = getItems(ctx.doc).find(
      (it) => typeof it["_id"] === "string" && it["_id"] === slot.itemId,
    );
    const granterSourceId = granter ? itemFusionSourceId(granter) : undefined;
    if (granterSourceId) {
      for (const it of getItems(ctx.doc)) {
        if (itemFusion(it)["grantedBy"] !== granterSourceId) continue;
        const id = it["_id"];
        if (typeof id === "string") {
          ops.push({
            type: "doc:delete",
            documentType: "Item",
            id,
            parent: { type: "Actor", id: ctx.actorId },
          } satisfies DocDeleteEmbeddedPayload);
        }
        // If the cascade deletes an item that ALSO occupied a build slot, that
        // slot's choice has to go with it (issue #15). Otherwise resolveSlot
        // reads the leftover choice as `filled: true` — a phantom slot, marked
        // taken with no item behind it. This is the shape the old
        // findAdoptableItem produced by adopting a paid slot; the adoption is
        // fixed, but actors already carrying the damage still remove cleanly.
        const cascadedSlot = getItemBuildFlag(it)?.slot;
        if (cascadedSlot !== undefined) cascadedBuildSlots.add(cascadedSlot);
      }
    }
  }

  const existingChoices = getBuildChoices(getSystem(ctx.doc));
  const remaining = existingChoices.filter(
    (c) =>
      c.slot !== slot.slotId &&
      !c.slot.startsWith(subSlotPrefix) &&
      !cascadedBuildSlots.has(c.slot),
  );
  if (remaining.length !== existingChoices.length) {
    ops.push({
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: { "system.build.choices": remaining },
    } satisfies DocUpdatePayload);
  }

  return ops;
}

/**
 * levelUp/levelSet — bump `system.level.value` + `system.details.level`
 * (same dual-write as characterSheetVM.updateLevel) and, when the class has
 * a spellcasting progression, sync every non-focus spellcasting entry's
 * `slots.<rank>.max` to the new level's table — preserving already-prepared
 * spells and extending/shrinking the `prepared` array to match the new max.
 */
export function levelSet(ctx: PlanOpBuilderContext, newLevel: number): DocOpPayload[] {
  if (!ctx.editable) return [];
  const clamped = Math.max(1, Math.min(20, newLevel));
  const ops: DocOpPayload[] = [
    {
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: {
        "system.level.value": clamped,
        "system.details.level": clamped,
      },
    } satisfies DocUpdatePayload,
  ];

  const classSystem = readClassSystem(ctx.doc);
  if (classSystem?.spellcasting) {
    const { cantripsKnown, slotsByRank } = spellSlotsForLevel(classSystem.spellcasting, clamped);
    const entries = findItemsByType(ctx.doc, "spellcastingEntry").filter(
      (e) => asRecord(e["system"])["isFocusPool"] !== true,
    );
    for (const entry of entries) {
      const entryId = entry["_id"];
      if (typeof entryId !== "string") continue;
      const targetRanks: Record<string, number> = { ...slotsByRank };
      if (cantripsKnown > 0) targetRanks["0"] = cantripsKnown;
      for (const [rank, max] of Object.entries(targetRanks)) {
        ops.push(syncSlotMaxOp(ctx.actorId, entry, entryId, rank, max));
      }
    }
  }

  return ops;
}

export function levelUp(ctx: PlanOpBuilderContext): DocOpPayload[] {
  return levelSet(ctx, getLevel(ctx.doc) + 1);
}

// ---------------------------------------------------------------------------
// Ghost spellcasting-entry cleanup (B2 r14, gap #12)
//
// Some pre-r11 imports left a DUPLICATE spellcasting entry with an auto-
// generated name ("<tradition> Spells", e.g. "arcane Spells") alongside the
// real, translated one ("Magias Arcanas"). The Tobias world has exactly this:
// "arcane Spells" (id sAbd2jdXSJVrTtkX) is a zero-spell duplicate of "Magias
// Arcanas" (id BNyJ0gsmNlULtcai), same tradition + prepared type.
//
// Removal criteria are DELIBERATELY NARROW (when in doubt, keep):
//   (a) the entry holds zero spells and zero grimoire (no spell item's
//       `location` points at it, and no prepared slot references a spell);
//   (b) another NON-empty entry exists with the SAME tradition + SAME
//       prepared type;
//   (c) the ghost's name is the auto-generated `"<tradition> Spells"` pattern
//       (case-sensitive lowercase tradition prefix — the real entry is renamed
//       to pt-BR so it never matches this shape).
// Focus pools are never touched. Log emitted by the caller.
// ---------------------------------------------------------------------------

function entrySpellCount(entryId: string, items: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const it of items) {
    if (it["type"] !== "spell") continue;
    const location = it["location"] ?? it["spellcastingEntry"];
    if (location === entryId) count++;
  }
  return count;
}

/** True if any prepared slot on the entry references a (non-empty) spell id. */
function entryHasPreparedSpell(entry: Record<string, unknown>): boolean {
  const sys = asRecord(entry["system"]);
  const slots = asRecord(sys["slots"]);
  for (const rank of Object.values(slots)) {
    const prepared = asRecord(rank)["prepared"];
    if (!Array.isArray(prepared)) continue;
    for (const p of prepared) {
      const id = asRecord(p)["id"];
      if (typeof id === "string" && id.trim()) return true;
    }
  }
  return false;
}

function entryTradition(entry: Record<string, unknown>): string {
  const sys = asRecord(entry["system"]);
  const trad = asRecord(sys["tradition"])["value"];
  return typeof trad === "string"
    ? trad
    : typeof sys["tradition"] === "string"
      ? sys["tradition"]
      : "";
}

function entryPreparedType(entry: Record<string, unknown>): string {
  const sys = asRecord(entry["system"]);
  const prep = asRecord(sys["prepared"])["value"];
  return typeof prep === "string"
    ? prep
    : typeof sys["prepared"] === "string"
      ? sys["prepared"]
      : "";
}

function isFocusEntry(entry: Record<string, unknown>): boolean {
  return asRecord(entry["system"])["isFocusPool"] === true;
}

/**
 * planGhostEntryCleanup — delete ops for every ghost spellcasting entry that
 * meets ALL of criteria (a)/(b)/(c) above. Returns [] when nothing qualifies
 * (the common case). Never touches focus pools. Read-only on `doc`.
 */
export function planGhostEntryCleanup(ctx: PlanOpBuilderContext): DocDeleteEmbeddedPayload[] {
  if (!ctx.editable) return [];
  const items = getItems(ctx.doc);
  const entries = items.filter((it) => it["type"] === "spellcastingEntry" && !isFocusEntry(it));
  const ops: DocDeleteEmbeddedPayload[] = [];

  for (const entry of entries) {
    const entryId = entry["_id"];
    if (typeof entryId !== "string") continue;

    // (a) empty: no spells located here and no prepared slot references a spell.
    if (entrySpellCount(entryId, items) > 0) continue;
    if (entryHasPreparedSpell(entry)) continue;

    const tradition = entryTradition(entry);
    const preparedType = entryPreparedType(entry);

    // (c) auto-generated name pattern "<tradition> Spells".
    const name = itemName(entry);
    if (name !== `${tradition} Spells`) continue;

    // (b) a DIFFERENT non-empty entry with same tradition + prepared type.
    const hasNonEmptyTwin = entries.some((other) => {
      if (other === entry) return false;
      if (other["_id"] === entryId) return false;
      if (entryTradition(other) !== tradition) return false;
      if (entryPreparedType(other) !== preparedType) return false;
      const otherId = other["_id"];
      const nonEmpty =
        (typeof otherId === "string" && entrySpellCount(otherId, items) > 0) ||
        entryHasPreparedSpell(other);
      return nonEmpty;
    });
    if (!hasNonEmptyTwin) continue;

    ops.push({
      type: "doc:delete",
      documentType: "Item",
      id: entryId,
      parent: { type: "Actor", id: ctx.actorId },
    });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Grant heal — detecting already-applied granters missing their fixed grants
// (B2 r14, gap #11 for sheets built before B2). The actual materialization is
// async (needs the compendium socket to resolve granted docs by name) and
// lives in grantMaterializer.ts; here we expose the pure INPUT: the list of
// embedded granter items whose docs should be re-scanned for missing grants.
// ---------------------------------------------------------------------------

/** A granter embedded item to re-scan during the on-open heal. */
export interface HealGranterRef {
  /** The granter's embedded `_id`. */
  itemId: string;
  /** The granter's stable sourceId (the grant marker's `grantedBy`). */
  sourceId: string;
  /** The granter's build slot, if any (the grant marker's `grantedSlot`). */
  slot?: string;
  /** The granter's display name (for the compendium name→doc resolution + logging). */
  name: string;
  /** The pack the granter's doc lives in (feat → feats-core, classFeature → class-features-core). */
  packSlug: string;
}

/**
 * healGranterRefs — every embedded feat/classFeature that COULD declare fixed
 * grants (has a sourceId + name), so the caller can re-fetch each one's pack
 * doc and run `materializeGrants` for any that are missing. Cheap pure scan;
 * the caller decides which actually declare grants (by inspecting the fetched
 * doc's `system.rules`) — keeping this planner free of the pack data.
 *
 * Excludes items that are THEMSELVES grants (`flags.fusion.grantedBy` set) to
 * avoid re-materializing a grant's own already-present nested grants as if the
 * grant were a top-level granter (the recursion in materializeGrants already
 * walks nested grants under their root).
 */
export function healGranterRefs(doc: Record<string, unknown>): HealGranterRef[] {
  const refs: HealGranterRef[] = [];
  for (const it of getItems(doc)) {
    const type = it["type"];
    if (type !== "feat" && type !== "classFeature") continue;
    const fusion = itemFusion(it);
    if (typeof fusion["grantedBy"] === "string") continue; // itself a grant
    const sourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
    if (!sourceId) continue;
    const itemId = it["_id"];
    if (typeof itemId !== "string") continue;
    const name = itemName(it);
    if (!name) continue;
    const build = asRecord(fusion["build"]);
    const slot = typeof build["slot"] === "string" ? build["slot"] : undefined;
    refs.push({
      itemId,
      sourceId,
      ...(slot !== undefined ? { slot } : {}),
      name,
      packSlug: type === "classFeature" ? "class-features-core" : "feats-core",
    });
  }
  return refs;
}

/**
 * A class feature to re-scan for the actions it concedes (r20-X4). Unlike
 * `healGranterRefs` (embedded feat/classFeature granters), the class's
 * `featuresByLevel` features are NOT embedded on the actor — they're named by
 * the class doc — so the heal must resolve each feature's own pack doc and run
 * `materializeGrants` on it, tagging every conceded action with the CLASS as
 * the root granter (so removing the class cascades to them).
 */
export interface ClassGrantRef {
  /** The class feature's display name (resolve in class-features-core). */
  name: string;
  /**
   * The feature's document id in the pack, taken from `featuresByLevel[].uuid`
   * — the IDENTITY the resolver should use, per the project rule that a
   * document is its id and never its name (issue #14). Measured across the 12
   * classes: 221/221 entries resolve by this id, while 5 carry a name the pack
   * does not have ("Debilitating Strikes" vs "Debilitating Strike", "Deity" vs
   * "Deity (Cleric)", …). Absent only for homebrew data with no uuid, where
   * the name stays the sole fallback.
   */
  docId?: string;
  /** Pack the feature doc lives in (always class-features-core). */
  packSlug: string;
  /** The CLASS item's sourceId — root grantedBy for every conceded action. */
  classSourceId: string;
  /** The grantedSlot marker (encodes feature level + name). */
  slot: string;
  /** The feature's level (diagnostics). */
  level: number;
}

/**
 * classFeatureGrantRefs — every non-CHOICE class feature at or below the
 * character level whose pack doc should be re-scanned for conceded actions.
 * Choice features (Hybrid Study, Kinetic Gate) are excluded — they're picked
 * via their own slots and their grants materialize through that path.
 */
export function classFeatureGrantRefs(doc: Record<string, unknown>): ClassGrantRef[] {
  const classItem = findFirstItemByType(doc, "class");
  if (!classItem) return [];
  const classSourceId = itemFusionSourceId(classItem);
  if (!classSourceId) return [];
  return classGrantRefsFromClassDoc(classItem["system"], classSourceId, getLevel(doc));
}

/**
 * classGrantRefsFromClassDoc — the pure core of `classFeatureGrantRefs`, taking
 * an explicit class `system` block + sourceId + char level. Used on FRESH apply
 * (the class item isn't embedded on the actor yet, so the picker's class doc is
 * the only source) as well as by `classFeatureGrantRefs` (embedded path).
 */
export function classGrantRefsFromClassDoc(
  classSystemRaw: unknown,
  classSourceId: string,
  charLevel: number,
): ClassGrantRef[] {
  const classSystem = asRecord(classSystemRaw) as unknown as ClassSystemLike;
  const refs: ClassGrantRef[] = [];
  const seen = new Set<string>();
  for (const f of classSystem.featuresByLevel ?? []) {
    if (f.level > charLevel) continue;
    if (isChoiceFeature(f)) continue;
    const norm = normalizeName(f.name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    refs.push({
      name: f.name,
      ...(typeof f.uuid === "string" && f.uuid.length > 0 ? { docId: f.uuid } : {}),
      packSlug: "class-features-core",
      classSourceId,
      slot: classGrantSlot(f.level, f.name),
      level: f.level,
    });
  }
  return refs;
}

/** The actor's spellcasting entries in the minimal shape grantMaterializer needs (for placing granted spells). */
export function actorSpellEntries(
  doc: Record<string, unknown>,
): Array<{ id: string; isFocusPool: boolean; tradition: string }> {
  const out: Array<{ id: string; isFocusPool: boolean; tradition: string }> = [];
  for (const it of getItems(doc)) {
    if (it["type"] !== "spellcastingEntry") continue;
    const id = it["_id"];
    if (typeof id !== "string") continue;
    out.push({ id, isFocusPool: isFocusEntry(it), tradition: entryTradition(it) });
  }
  return out;
}

function syncSlotMaxOp(
  actorId: string,
  entry: Record<string, unknown>,
  entryId: string,
  rank: string,
  newMax: number,
): DocUpdatePayload {
  const sys = asRecord(entry["system"]);
  const slots = asRecord(sys["slots"]);
  const currentSlot = asRecord(slots[rank]);
  const currentPrepared = Array.isArray(currentSlot["prepared"])
    ? (currentSlot["prepared"] as unknown[])
    : [];

  const nextPrepared = currentPrepared.slice(0, newMax).map((e) => {
    const el = asRecord(e);
    return { id: typeof el["id"] === "string" ? el["id"] : "", expended: el["expended"] === true };
  });
  while (nextPrepared.length < newMax) {
    nextPrepared.push({ id: "", expended: false });
  }

  return {
    type: "doc:update",
    documentType: "Item",
    id: entryId,
    embedded: { type: "Item", id: actorId },
    diff: {
      [`system.slots.${rank}`]: { value: newMax, max: newMax, prepared: nextPrepared },
    },
  };
}

// ---------------------------------------------------------------------------
// Details-panel resolution (R12 — "explain what each item means")
//
// Both the compendium picker (unchosen slots) and the Plan column's inline
// affordances (locked auto-feature chips, already-filled feat/hybrid-study
// slots) need to show the ORC/OGL description of a compendium document. The
// picker already holds the pack's index entries (each carrying the full
// compendium uuid), but the chips/filled slots only know an item NAME — and
// the embedded actor item may have an empty description (pre-r11 imports).
//
// Resolution PREFERS an exact id match over name matching (issue #44 — a
// document's identity is its id, never its name; PF2e homonyms are the norm,
// e.g. "Unusual Anatomy" exists as both a spell in spells-core and a feature
// in ancestry-features-core, with distinct ids). featuresByLevel[].uuid is
// actually the feature's own `_id` in class-features-core (NOT a Foundry
// compendium uuid, despite the field's name — measured: 221/221 non-choice
// entries across the 12 classes resolve this way); a materialized item's own
// `flags.fusion.sourceId` is the other identity anchor, matched against the
// pack index's `index["flags.fusion.sourceId"]` (exposed since issue #41).
// `resolveDetailsEntryUuid` tries both before falling back to
// `findEntryUuidByName` — the ONLY path left for data with no id at all
// (choice-backed slots with no embedded item, or homebrew with no sourceId).
// ---------------------------------------------------------------------------

/** Minimal index-entry shape the details resolvers need (subset of PackIndexEntry). */
export interface PlanIndexEntryLike {
  name: string;
  uuid: string;
  /** Pack-scoped document id (`_id`) — issue #44's docId-match anchor. Optional so hand-built test fixtures with no id still type-check. */
  _id?: string;
  /** Extra indexed fields (issue #41 exposed `flags.fusion.sourceId` here as `index["flags.fusion.sourceId"]`). */
  index?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Content-name translation (B1 r14 — pt-BR display for embedded pack content)
//
// Embedded actor items (feats, class features, ABC docs) are EN of birth and
// carry NO `system.slug` (undefined on BOTH the embedded item and the pack
// doc — the reliable index-side join is the NORMALIZED NAME, exactly like
// `buildSpellNameTranslator` in characterSheetVM.ts). The compendium index a
// pack ships carries `namePt` (denormalized pt-BR overlay) per entry; loading
// the relevant packs (feats-core / class-features-core / ancestries-core /
// heritages-core / backgrounds-core / spells-core) once lets the Plano column
// resolve every embedded item's display name to `{ namePt, nameEn }`.
//
// USER RULE (r14): pt-BR is ALWAYS the main line + EN is ALWAYS the subtitle,
// even when identical (Bon Mot / Bon Mot) — so this returns BOTH parts and the
// component always renders the EN subtitle (unlike `localizedNameParts`, which
// suppresses the subtitle when the two match).
// ---------------------------------------------------------------------------

/** Minimal index-entry shape the content-name translator consumes (subset of PackIndexEntry). */
export interface PlanNameIndexEntry {
  name: string;
  /** The pack doc id. Present on every real pack index entry; it is what
   * `featuresByLevel[].uuid` (stored as `AutoFeatureModel.docId`) points at, and
   * the only key that survives a name that drifted from the document's own. */
  _id?: string | undefined;
  namePt?: string | undefined;
  i18n?: { ptBR?: { name?: string | undefined } | undefined } | undefined;
}

/** Bilingual display parts for a piece of pack content: pt-BR main + EN subtitle (always present). */
export interface ContentNameParts {
  /** pt-BR display name when a translation exists, else the EN name. */
  namePt: string;
  /** The EN source-of-truth name (always present, shown as the subtitle). */
  nameEn: string;
}

/**
 * Resolve an embedded item's stored (EN or pt-BR) name to its bilingual display
 * parts. `docId` (when the caller has one) is tried FIRST: the stored name can
 * legitimately differ from the document's own name, and only the id is exact.
 */
export type ContentNameTranslator = (storedName: string, docId?: string) => ContentNameParts;

/** Read the pt-BR overlay name off an index entry — flat `namePt` first, then nested `i18n.ptBR.name`. */
function entryPtName(entry: PlanNameIndexEntry): string | undefined {
  const flat = entry.namePt;
  if (typeof flat === "string" && flat.trim()) return flat.trim();
  const nested = entry.i18n?.ptBR?.name;
  return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
}

/**
 * buildContentNameTranslator — EN/pt-BR → `{ namePt, nameEn }` map built from
 * one or more packs' index entries. Two independent indexes:
 *
 * 1. **By doc id** (`entry._id`) — EXACT, and tried first when the caller has an
 *    id. This is what fixes issue #65: the class doc's `featuresByLevel` stores
 *    a literal `name` that can differ from the referenced document's own name
 *    ("Deity" vs "Deity (Cleric)", "Debilitating Strikes" vs "Debilitating
 *    Strike" — 5 such entries across the 12 classes), so name matching silently
 *    falls through to EN while the correct translation sits one id away. The
 *    `uuid` in `featuresByLevel` IS that doc id, and it already travels to the
 *    UI as `AutoFeatureModel.docId` (issue #14).
 * 2. **By normalized name**, EN and pt-BR (both point at the same parts), for
 *    every caller that only has an embedded item's stored name — which may have
 *    been copied in either language. First write wins per key (deterministic
 *    given a stable index order).
 *
 * (An earlier version of this comment claimed name was "the only reliable key"
 * because the pack index did not expose `flags.fusion.sourceId`. That stopped
 * being true with issue #41; the id path above is the reliable one.)
 *
 * Names with no matching pack entry return `{ namePt: stored, nameEn: stored }`
 * — an EN-only fallback that still lets the caller render the "always both"
 * layout (identical main/subtitle) without crashing on unknown content.
 */
export function buildContentNameTranslator(
  entriesByPack: PlanNameIndexEntry[][],
): ContentNameTranslator {
  const byName = new Map<string, ContentNameParts>();
  const byId = new Map<string, ContentNameParts>();
  for (const entries of entriesByPack) {
    for (const entry of entries) {
      const nameEn = entry.name;
      if (!nameEn) continue;
      const namePt = entryPtName(entry) ?? nameEn;
      const parts: ContentNameParts = { namePt, nameEn };
      const id = entry._id;
      if (typeof id === "string" && id && !byId.has(id)) byId.set(id, parts);
      const enKey = normalizeName(nameEn);
      const ptKey = normalizeName(namePt);
      if (enKey && !byName.has(enKey)) byName.set(enKey, parts);
      if (ptKey && !byName.has(ptKey)) byName.set(ptKey, parts);
    }
  }
  return (storedName: string, docId?: string): ContentNameParts => {
    const fallback: ContentNameParts = { namePt: storedName, nameEn: storedName };
    if (docId) {
      const byIdHit = byId.get(docId);
      if (byIdHit) return byIdHit;
    }
    if (!storedName) return fallback;
    return byName.get(normalizeName(storedName)) ?? fallback;
  };
}

/** EN slot-type labels, exported for use as the ALWAYS-shown EN subtitle beside the pt-BR i18n label (r14 rule). */
export const SLOT_TYPE_LABELS_EN: Record<PlanSlotType, string> = SLOT_TYPE_LABELS;

/**
 * A request to open the details panel for a Plan item: which pack to search
 * and the item name to match. `level` is a display-only extra the caller may
 * already know; the NAME resolver (`findEntryUuidByName` + pack search)
 * ignores it — it only reaches the details panel.
 */
export interface PlanDetailsRequest {
  /** Pack slug suffix, e.g. "class-features-core" / "feats-core". */
  packSlug: string;
  /** Item name to resolve against the pack index (accent/case-insensitive). */
  name: string;
  /**
   * The level at which THIS plan actually grants the item — the enclosing
   * `LevelPlanModel.level` the caller (PlanColumn) already has in scope.
   * Overrides a shared class-features-core document's own divergent
   * `system.level` in the details panel (issue #58: 17 documents are reused
   * across classes that grant them at different levels — 35 divergences
   * across 11/12 classes, per the r22 varredura). Omitted when the caller
   * has no class context (e.g. `detailsRequestForAbcChip`'s ABC card
   * chips) — the panel then falls back to the document's own level.
   */
  level?: number;
  /**
   * Pack-scoped document id (issue #44), when the caller knows it — matched
   * against a pack index entry's own `_id`. Preferred over name matching:
   * exact identity, immune to the homonym/prefix risk `findEntryUuidByName`
   * otherwise carries. See {@link PlanIndexEntryLike._id}.
   */
  docId?: string;
  /**
   * `flags.fusion.sourceId` of the backing embedded/materialized item (issue
   * #44), when the caller knows it — matched against a pack index entry's
   * `index["flags.fusion.sourceId"]`. Same preference rule as `docId`; the
   * two are mutually exclusive identity spaces (docId = pack's own `_id`,
   * sourceId = the doc's stable `flags.fusion.sourceId`) but either resolves
   * the exact document when present.
   */
  sourceId?: string;
}

/** Normalize a name for matching — mirrors normalizeSearchText (accent/case-fold). */
function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Which pack a FILLED slot's description lives in. Hybrid Study picks are
 * class features; every feat slot (class/ancestry/general/skill/archetype/
 * granted) is a feat. Ability-boost/skill-training slots have no single
 * compendium document to describe, so they return null (the Plan column
 * never opens a details panel for those — they're edited in their own
 * dialogs instead).
 *
 * `level` (issue #58) is the caller's known grant level — see
 * {@link PlanDetailsRequest.level}. Optional and built via a conditional
 * spread (not `level: level` directly): `exactOptionalPropertyTypes` rejects
 * assigning `undefined` to an optional field that doesn't spell out
 * `| undefined`, and every existing caller/test that omits `level` expects
 * the key itself to be absent, not present-and-undefined.
 */
export function detailsRequestForSlot(
  slot: PlanSlotModel,
  level?: number,
): PlanDetailsRequest | null {
  const name = slot.choiceName;
  if (!name || !slot.filled) return null;
  const withLevel = (packSlug: string): PlanDetailsRequest => ({
    packSlug,
    name,
    ...(level === undefined ? {} : { level }),
    ...withOptional("sourceId", slot.sourceId),
  });
  // A locked fixed-grant chip (B2 r14) carries its own pack hint so a granted
  // classFeature resolves in class-features-core, not the feats-core default.
  if (slot.detailsPackSlug) return withLevel(slot.detailsPackSlug);
  switch (slot.type) {
    case "hybridStudy":
    case "kineticGate":
    case "instinct":
    case "racket":
    case "huntersEdge":
    case "arcaneThesis":
    case "arcaneSchool":
      return withLevel("class-features-core");
    case "ancestryFeat":
    case "classFeat":
    case "generalFeat":
    case "skillFeat":
    case "archetypeFeat":
    case "grantedFeat":
      return withLevel("feats-core");
    case "adoptedAncestryChoice":
      return withLevel("ancestries-core");
    default:
      return null;
  }
}

/**
 * The pack a locked auto-feature chip's description lives in (always a
 * class feature). `level` (issue #58) is the caller's known grant level —
 * see {@link PlanDetailsRequest.level}.
 */
export function detailsRequestForAutoFeature(
  feature: AutoFeatureModel,
  level?: number,
): PlanDetailsRequest | null {
  // An Isekai blessing has no compendium document: the layer's content lives
  // in `./isekai/`. Falling through to the name search below would hunt for
  // "Plot Armor" in class-features-core and, on a hit, show something that
  // isn't this blessing at all. The chip carries its own text — the caller
  // renders it directly.
  if (feature.isekai) return null;
  const packSlug = feature.detailsPackSlug ?? "class-features-core";
  return {
    packSlug,
    name: feature.name,
    ...(level === undefined ? {} : { level }),
    ...withOptional("docId", feature.docId),
    ...withOptional("sourceId", feature.sourceId),
  };
}

/**
 * The details request for a locked ABC chip (r20-X4), or null when the chip is
 * INFORMATIVE (a scalar, or an unresolved feature with no clean-room pack) — the
 * caller renders those non-clickable.
 */
export function detailsRequestForAbcChip(chip: AbcChip): PlanDetailsRequest | null {
  if (!chip.detailsPackSlug) return null;
  return {
    packSlug: chip.detailsPackSlug,
    name: chip.name,
    ...withOptional("sourceId", chip.sourceId),
  };
}

/**
 * Find the compendium uuid of the index entry whose name matches `name`
 * (accent/case-insensitive), or null if none. An exact normalized match wins;
 * failing that, a unique prefix match is accepted (vendor chip names like
 * "Arcane Spellcasting (Magus)" already carry their parenthetical, so exact
 * match is the common path — the prefix fallback only helps when a chip name
 * is a shortened form of the pack entry's name).
 */
export function findEntryUuidByName(entries: PlanIndexEntryLike[], name: string): string | null {
  const target = normalizeName(name);
  if (!target) return null;
  const exact = entries.find((e) => normalizeName(e.name) === target);
  if (exact) return exact.uuid;
  const prefixed = entries.filter((e) => normalizeName(e.name).startsWith(target));
  return prefixed.length === 1 ? (prefixed[0]?.uuid ?? null) : null;
}

/** Read an index entry's `flags.fusion.sourceId` off its `index` bag (present since issue #41 indexed it). */
function entryFusionSourceId(entry: PlanIndexEntryLike): string | undefined {
  const sid = entry.index?.["flags.fusion.sourceId"];
  return typeof sid === "string" ? sid : undefined;
}

/**
 * Resolve a details request to a compendium uuid, PREFERRING an exact id
 * match over name matching (issue #44 — see the "Details-panel resolution"
 * section header above). Tries, in order:
 *   1. `request.docId` against the entry's own pack `_id`.
 *   2. `request.sourceId` against the entry's indexed
 *      `flags.fusion.sourceId`.
 *   3. `findEntryUuidByName` — the only path left when neither id is known
 *      or neither matches (rule: never invent an id the data doesn't have).
 */
export function resolveDetailsEntryUuid(
  entries: PlanIndexEntryLike[],
  request: PlanDetailsRequest,
): string | null {
  if (request.docId) {
    const byId = entries.find((e) => e._id === request.docId);
    if (byId) return byId.uuid;
  }
  if (request.sourceId) {
    const bySource = entries.find((e) => entryFusionSourceId(e) === request.sourceId);
    if (bySource) return bySource.uuid;
  }
  return findEntryUuidByName(entries, request.name);
}

/**
 * The entry to select by default when a picker opens: the first of the
 * already-sorted/filtered list, so the details panel is never empty. Returns
 * null for an empty list.
 */
export function pickDefaultEntryUuid(entries: PlanIndexEntryLike[]): string | null {
  return entries[0]?.uuid ?? null;
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export {
  readClassSystem as _readClassSystemForTests,
  readClassItemId as _readClassItemIdForTests,
  // issue #44 evidence #4: knownPossessedNames deliberately excludes spell
  // items — re-exported so a test can assert that CONTRACT directly instead
  // of through checkFeatPrerequisites' output, where "met" and "unresolved"
  // are indistinguishable (both yield no mark under DEC-BC-05) and so
  // couldn't actually catch a future regression that starts counting spells.
  knownPossessedNames as _knownPossessedNamesForTests,
};
