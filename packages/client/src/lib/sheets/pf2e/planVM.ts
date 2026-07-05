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
 *     applyHeritage, applyBackground, chooseFeat, chooseHybridStudy,
 *     chooseSkillTraining/Increase, setAbilityBoosts, setFreeArchetype,
 *     removeChoice, levelUp/levelSet). Every builder returns plain op
 *     payload(s) — same DocUpdatePayload/DocCreateEmbeddedPayload/
 *     DocDeleteEmbeddedPayload shapes as characterSheetVM.ts — the caller
 *     (Svelte component) sends them via sendOpFn/makeSendOpFn.
 *   - featElegivel(): pure, non-blocking eligibility check for the feat
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
    classBoost: asStringArray(abilities["classBoost"]),
    levelledBoosts: asStringArrayRecord(abilities["levelledBoosts"]),
  };
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
  tradition: string;
  type: "prepared" | "spontaneous";
  ability: string;
  cantripsKnown?: Array<{ level: number; count: number }>;
  slots?: Array<{ level: number; slots: Record<string, number> }>;
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

export interface AbcCardModel {
  kind: AbcKind;
  filled: boolean;
  name?: string;
  subLine?: string;
}

export type PlanSlotType =
  | "abilityBoosts"
  | "ancestryFeat"
  | "classFeat"
  | "generalFeat"
  | "skillFeat"
  | "archetypeFeat"
  | "hybridStudy"
  | "skillTraining"
  | "skillIncrease";

export interface PlanSlotModel {
  slotId: string;
  type: PlanSlotType;
  label: string;
  filled: boolean;
  choiceName?: string;
  itemId?: string;
  optional?: boolean;
}

export interface AutoFeatureModel {
  name: string;
  locked: true;
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
  skillTraining: "Skill Training",
  skillIncrease: "Skill Increase",
};

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
  /** The class's chosen key ability (system.keyAbility[0] once narrowed by applyClass). */
  keyAbility?: string;
}

function nameToSlug(name: string | undefined): string | undefined {
  return name?.trim().toLowerCase() || undefined;
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

  const levels: LevelPlanModel[] = [];
  for (let lvl = 1; lvl <= level; lvl++) {
    levels.push(buildLevelPlan(lvl, classSystem, choices, items, freeArchetype));
  }

  return { abc, levels, needsClass: false };
}

function buildAbcCards(doc: Record<string, unknown>): AbcCardModel[] {
  const cards: AbcCardModel[] = [];

  const ancestry = findFirstItemByType(doc, "ancestry");
  cards.push({
    kind: "ancestry",
    filled: ancestry !== undefined,
    ...withOptional("name", itemName(ancestry)),
  });

  const heritage = findFirstItemByType(doc, "heritage");
  cards.push({
    kind: "heritage",
    filled: heritage !== undefined,
    ...withOptional("name", itemName(heritage)),
  });

  const background = findFirstItemByType(doc, "background");
  cards.push({
    kind: "background",
    filled: background !== undefined,
    ...withOptional("name", itemName(background)),
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
): LevelPlanModel {
  const slots: PlanSlotModel[] = [];
  const featLevels = classSystem.featLevels ?? {};

  // Level 1: 4 ability boosts (fixed PF2e Remaster rule) + hybrid study
  // (Magus-specific, but slotted generically as "hybridStudy" — the picker
  // only offers it when the class actually has hybrid-study features).
  if (level === 1) {
    slots.push(resolveSlot("abilityBoosts", `abilityBoosts-1`, level, choices, items));
    slots.push(resolveSlot("hybridStudy", `hybridStudy-1`, level, choices, items));
  }

  // Levelled ability boosts (5/10/15/20 by default, or the class's own set).
  const abilityBoostLevels = classSystem.abilityBoostLevels ?? [5, 10, 15, 20];
  if (level !== 1 && abilityBoostLevels.includes(level)) {
    slots.push(resolveSlot("abilityBoosts", `abilityBoosts-${String(level)}`, level, choices, items));
  }

  // Feat slots by category.
  if ((featLevels.ancestry ?? []).includes(level)) {
    slots.push(resolveSlot("ancestryFeat", `ancestryFeat-${String(level)}`, level, choices, items));
  }
  if ((featLevels.class ?? []).includes(level)) {
    slots.push(resolveSlot("classFeat", `classFeat-${String(level)}`, level, choices, items));
  }
  if ((featLevels.general ?? []).includes(level)) {
    slots.push(resolveSlot("generalFeat", `generalFeat-${String(level)}`, level, choices, items));
  }
  if ((featLevels.skill ?? []).includes(level)) {
    slots.push(resolveSlot("skillFeat", `skillFeat-${String(level)}`, level, choices, items));
  }

  // Free Archetype: an extra archetype feat slot on even levels.
  if (freeArchetype && level % 2 === 0) {
    const slot = resolveSlot("archetypeFeat", `archetypeFeat-${String(level)}`, level, choices, items);
    slot.optional = true;
    slots.push(slot);
  }

  // Skill increases.
  if ((classSystem.skillIncreaseLevels ?? []).includes(level)) {
    slots.push(resolveSlot("skillIncrease", `skillIncrease-${String(level)}`, level, choices, items));
  }

  // Level 1: trained-skill free choices (trainedSkills.additional) — one
  // slot per additional free choice, distinct slot ids so each can be
  // filled independently.
  if (level === 1) {
    const additional = classSystem.trainedSkills?.additional ?? 0;
    for (let i = 0; i < additional; i++) {
      slots.push(resolveSlot("skillTraining", `skillTraining-1-${String(i)}`, level, choices, items));
    }
  }

  const autoFeatures: AutoFeatureModel[] = (classSystem.featuresByLevel ?? [])
    .filter((f) => f.level === level)
    .filter((f) => !isChoiceFeature(f))
    .map((f) => ({ name: f.name, locked: true as const }));

  return { level, slots, autoFeatures };
}

/**
 * Class features that are actually a CHOICE slot (Hybrid Study) must not
 * also appear as a locked auto-feature chip — they're represented by the
 * `hybridStudy` slot instead. Identified by name for the MVP (the vendor's
 * own "Hybrid Study" placeholder entry in featuresByLevel represents the
 * choice point, not a concrete feature).
 */
function isChoiceFeature(ref: ClassFeatureRef): boolean {
  return ref.name === "Hybrid Study";
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
  return choice.type;
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
 * - ancestryFeat slots require the ancestrySlug trait.
 *
 * Returns true/false — the caller decides whether to hide, gray out, or just
 * warn; this function never throws and never blocks the picker from
 * displaying an "ineligible" result.
 */
export function featElegivel(
  featDoc: FeatDocLike,
  slotType: PlanSlotType,
  charLevel: number,
  opts: { classSlug?: string; ancestrySlug?: string } = {},
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
      return true;
    case "ancestryFeat":
      if (category !== "ancestry") return false;
      if (opts.ancestrySlug && !traits.includes(opts.ancestrySlug)) return false;
      return true;
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
 * featElegivel's classFeat branch. MVP set — extend as new classes ship.
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
 * Hybrid-study eligibility: `classFeatureDoc` must carry the
 * "magus-hybrid-study" tag in `system.traits.otherTags` (class-features-core
 * pack shape — see systems/pf2e/packs/class-features-core/documents.json).
 * `otherTags` isn't part of the strict Zod schema (TraitsBlockSchema) but
 * survives via `.passthrough()`, so it's read here as an untyped extra.
 */
export function isHybridStudyOption(classFeatureDoc: {
  system?: { traits?: { otherTags?: unknown } };
}): boolean {
  const otherTags = classFeatureDoc.system?.traits?.otherTags;
  if (!Array.isArray(otherTags)) return false;
  return otherTags.includes("magus-hybrid-study");
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
 * applyClass — doc:create the class item (key ability narrowed to the
 * player's pick) plus doc:create ops for its arcane prepared spellcasting
 * entry and, if the class grants a focus pool, a focus entry.
 *
 * Returns the ops in creation order (class item first — though doc:create
 * ops for different embedded items are independent and order doesn't matter
 * to the server, keeping the class item first makes test assertions and
 * debugging easier).
 */
export function applyClass(
  ctx: PlanOpBuilderContext,
  classDoc: Record<string, unknown>,
  keyAbilityChoice: string,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const classSystemRaw = asRecord(classDoc["system"]);
  const classSystem = classSystemRaw as unknown as ClassSystemLike;

  const narrowedClassDoc: Record<string, unknown> = {
    ...classDoc,
    system: { ...classSystemRaw, keyAbility: [keyAbilityChoice] },
  };

  const ops: DocOpPayload[] = [];
  ops.push({
    type: "doc:create",
    documentType: "Item",
    data: embeddedItemPayload(narrowedClassDoc),
    parent: { type: "Actor", id: ctx.actorId },
  } satisfies DocCreateEmbeddedPayload);

  const level = getLevel(ctx.doc);
  if (classSystem.spellcasting) {
    const { cantripsKnown, slotsByRank } = spellSlotsForLevel(classSystem.spellcasting, level);
    ops.push({
      type: "doc:create",
      documentType: "Item",
      data: {
        name: `${classSystem.spellcasting.tradition} Spells`,
        type: "spellcastingEntry",
        system: {
          prepared: { value: classSystem.spellcasting.type },
          tradition: { value: classSystem.spellcasting.tradition },
          ability: { value: classSystem.spellcasting.ability },
          proficiency: { value: 1 },
          slots: buildSlotsMap(slotsByRank, cantripsKnown),
          isFocusPool: false,
        },
      },
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload);
  }

  if (hasFocusFeature(classSystem)) {
    ops.push({
      type: "doc:create",
      documentType: "Item",
      data: {
        name: "Focus Spells",
        type: "spellcastingEntry",
        system: {
          prepared: { value: "innate" },
          tradition: { value: classSystem.spellcasting?.tradition ?? "arcane" },
          ability: { value: keyAbilityChoice },
          proficiency: { value: 1 },
          slots: {},
          isFocusPool: true,
        },
      },
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload);
  }

  return ops;
}

/** Does the class grant a focus pool at level 1 (e.g. Magus's Conflux Spells)? */
function hasFocusFeature(classSystem: ClassSystemLike): boolean {
  return (classSystem.featuresByLevel ?? []).some(
    (f) => f.level === 1 && (f.name.includes("Conflux") || f.name.toLowerCase().includes("focus")),
  );
}

function buildSlotsMap(
  slotsByRank: Record<string, number>,
  cantripsKnown: number,
): Record<string, { value: number; max: number; prepared: Array<{ id: string; expended: boolean }> }> {
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
 * constraint applied to a different array).
 *
 * `ancestryDoc.system.boosts` mixes fixed ability slugs and the sentinel
 * string `"free"` for unrestricted boosts (see systems/pf2e/packs/
 * ancestries-core/documents.json, e.g. Ratfolk: `["dex","int","free"]`).
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
    {
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(ancestryDoc),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload,
  ];

  const existing = getBuildAbilities(getSystem(ctx.doc));
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
    },
  } satisfies DocUpdatePayload);

  return ops;
}

export function applyHeritage(
  ctx: PlanOpBuilderContext,
  heritageDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  return [
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
 * into `system.build.abilities.backgroundBoosts`. Background boosts in the
 * PF2e Remaster are two "free" choices from the applicable ability list
 * (see systems/pf2e/packs/backgrounds-core, e.g. Fireworks Performer:
 * `["free","free"]`) — like ancestry free boosts, resolved later via
 * setAbilityBoosts("backgroundBoosts", [...]).
 */
export function applyBackground(
  ctx: PlanOpBuilderContext,
  backgroundDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const sys = asRecord(backgroundDoc["system"]);
  const boosts = asStringArray(sys["boosts"]);
  const fixedBoosts = boosts.filter((b) => b !== "free");

  const ops: DocOpPayload[] = [
    {
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(backgroundDoc),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload,
  ];

  if (fixedBoosts.length > 0) {
    ops.push({
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: { "system.build.abilities.backgroundBoosts": fixedBoosts },
    } satisfies DocUpdatePayload);
  }

  // Background-granted skill proficiencies (e.g. Fireworks Performer →
  // Performance trained) apply as a level-1 skillTraining build choice so
  // stepCharBuildSkills picks them up uniformly with other training sources.
  const skills = asRecord(sys["skills"]);
  const skillChoices = Object.entries(skills)
    .map(([slug, val]) => {
      const rank = asRecord(val)["value"];
      return typeof rank === "number" ? { slug, rank } : null;
    })
    .filter((s): s is { slug: string; rank: number } => s !== null);

  if (skillChoices.length > 0) {
    const existingChoices = getBuildChoices(getSystem(ctx.doc));
    const newChoices: BuildChoice[] = skillChoices.map((s, i) => ({
      level: 1,
      slot: `backgroundSkill-${String(i)}`,
      type: "skillTraining",
      skill: s.slug,
      rank: s.rank,
    }));
    ops.push({
      type: "doc:update",
      documentType: "Actor",
      id: ctx.actorId,
      diff: { "system.build.choices": [...existingChoices, ...newChoices] },
    } satisfies DocUpdatePayload);
  }

  return ops;
}

/**
 * chooseFeat — doc:create the feat item tagged with `flags.fusion.build =
 * {level, slot}`, plus append a matching entry to `system.build.choices` so
 * removeChoice() can find and clean it up symmetrically.
 */
export function chooseFeat(
  ctx: PlanOpBuilderContext,
  slot: PlanSlotModel,
  level: number,
  featDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const buildFlag = { level, slot: slot.slotId };
  const ops: DocOpPayload[] = [
    {
      type: "doc:create",
      documentType: "Item",
      data: embeddedItemPayload(featDoc, buildFlag),
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocCreateEmbeddedPayload,
  ];

  const existingChoices = getBuildChoices(getSystem(ctx.doc));
  const newChoice: BuildChoice = { level, slot: slot.slotId, type: slot.type };
  ops.push({
    type: "doc:update",
    documentType: "Actor",
    id: ctx.actorId,
    diff: { "system.build.choices": [...existingChoices, newChoice] },
  } satisfies DocUpdatePayload);

  return ops;
}

/** chooseHybridStudy — same shape as chooseFeat but for a classFeature doc. */
export function chooseHybridStudy(
  ctx: PlanOpBuilderContext,
  level: number,
  featureDoc: Record<string, unknown>,
): DocOpPayload[] {
  return chooseFeat(ctx, { slotId: "hybridStudy-1", type: "hybridStudy" } as PlanSlotModel, level, featureDoc);
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

/**
 * setAbilityBoosts — overwrite one origin's boost slugs (ancestryFree,
 * backgroundBoosts, classBoost, or a levelled-boosts level) with the
 * player's picks. `origin` "levelled" requires `level` to key
 * `levelledBoosts`.
 */
export function setAbilityBoosts(
  ctx: PlanOpBuilderContext,
  origin: "ancestryFree" | "backgroundBoosts" | "classBoost" | "levelled",
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
 * `setAbilityBoosts` above only writes the actual ability data into
 * `system.build.abilities.*` — it does NOT touch `system.build.choices`, so
 * on its own `resolveSlot`'s abilityBoosts branch (which checks `choices`
 * for the item-less slot types) never reports the slot as filled. Call this
 * alongside `setAbilityBoosts` (same op batch) whenever the player confirms
 * a level's ability boosts, so the Plan column's LevelCard renders the slot
 * as a filled Slot instead of perpetually empty.
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

/**
 * abilityBoostsSlotContext — everything the "Dádivas de Atributo" dialog
 * needs to render one abilityBoosts slot (R10-D item 2, D2 helper):
 *   - level 1: fixed = ancestryBoosts + classBoost (if already set); free
 *     count = 1 (ancestryFree) + background's free count (from the
 *     background item's `system.boosts` "free" entries, already resolved
 *     into `backgroundBoosts` length by applyBackground... but that field
 *     stores FIXED boosts, not a count — see note below).
 *   - a levelled milestone (5/10/15/20 by default): no fixed slugs, free
 *     count is always 4 (PF2e Remaster rule), pre-seeded from
 *     `levelledBoosts[level]`.
 *
 * NOTE on level 1: `applyAncestry`/`applyBackground` already resolve each
 * origin's FIXED boosts into `ancestryBoosts`/`backgroundBoosts` at
 * apply-time (the sentinel "free" slots in the compendium doc's own
 * `system.boosts` are counted, not stored) — only `ancestryFree` remains a
 * genuinely free pick after applying an ancestry. Background's free boosts
 * are NOT tracked by a dedicated count field in `BuildAbilities`; this
 * helper conservatively reports 0 background-origin free slots until a
 * dedicated field exists, so today's level-1 free count reflects only
 * `ancestryFree`. This mirrors the exact fields available in `system.build`
 * as of R10-A/D1 — extending the schema is out of D2's scope.
 */
export interface AbilityBoostsSlotContext {
  /** Ability slugs already fixed for this level's boost step (read-only in the UI). */
  fixedSlugs: string[];
  /** How many additional slugs the player may pick freely. */
  freeCount: number;
  /** Already-selected free slugs (pre-seeds the dialog). */
  initialFreeSlugs: string[];
  /** Which BuildAbilities field the confirmed free slugs should be written to. */
  origin: "ancestryFree" | "levelled";
}

export function abilityBoostsSlotContext(
  doc: Record<string, unknown>,
  level: number,
): AbilityBoostsSlotContext {
  const abilities = getBuildAbilities(getSystem(doc));
  if (level === 1) {
    return {
      fixedSlugs: [...abilities.ancestryBoosts, ...abilities.classBoost],
      freeCount: 1,
      initialFreeSlugs: abilities.ancestryFree,
      origin: "ancestryFree",
    };
  }
  return {
    fixedSlugs: [],
    freeCount: 4,
    initialFreeSlugs: abilities.levelledBoosts[String(level)] ?? [],
    origin: "levelled",
  };
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

  if (slot.itemId) {
    ops.push({
      type: "doc:delete",
      documentType: "Item",
      id: slot.itemId,
      parent: { type: "Actor", id: ctx.actorId },
    } satisfies DocDeleteEmbeddedPayload);
  }

  const existingChoices = getBuildChoices(getSystem(ctx.doc));
  const remaining = existingChoices.filter((c) => c.slot !== slot.slotId);
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

  const nextPrepared = currentPrepared
    .slice(0, newMax)
    .map((e) => {
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
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { readClassSystem as _readClassSystemForTests, readClassItemId as _readClassItemIdForTests };
