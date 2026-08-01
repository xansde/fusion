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
}

export interface AbcCardModel {
  kind: AbcKind;
  filled: boolean;
  name?: string;
  subLine?: string;
  /** Locked chips (auto-conceded features + informative scalars) — r20-X4. */
  chips?: AbcChip[];
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
  | "skillTraining"
  | "skillIncrease"
  | "grantedFeat";

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
  skillTraining: "Skill Training",
  skillIncrease: "Skill Increase",
  grantedFeat: "Granted Feat",
};

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
  const abilities = getBuildAbilities(sys);

  const levels: LevelPlanModel[] = [];
  for (let lvl = 1; lvl <= level; lvl++) {
    levels.push(
      buildLevelPlan(lvl, classSystem, choices, items, freeArchetype, doc, abilities, level),
    );
  }

  return { abc, levels, needsClass: false };
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
  const featLevels = classSystem.featLevels ?? {};

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
  for (const choiceType of classChoiceSlotsAtLevel(classSystem, level)) {
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
  if ((featLevels.class ?? []).includes(level)) {
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
  for (const f of classSystem.featuresByLevel ?? []) {
    if (f.level !== level || isChoiceFeature(f)) continue;
    const norm = normalizeName(f.name);
    if (autoSeen.has(norm)) continue;
    autoSeen.add(norm);
    autoFeatures.push({ name: f.name, locked: true });
  }
  for (const chip of classGrantedActionChips(doc, level)) {
    const norm = normalizeName(chip.name);
    if (autoSeen.has(norm)) continue;
    autoSeen.add(norm);
    autoFeatures.push(chip);
  }

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
    out.push({ name, locked: true, detailsPackSlug: grantedItemPackSlug(it) });
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
 * - ancestryFeat slots require the ancestrySlug trait.
 *
 * Returns true/false — the caller decides whether to hide, gray out, or just
 * warn; this function never throws and never blocks the picker from
 * displaying an "ineligible" result.
 */
export function isFeatEligible(
  featDoc: FeatDocLike,
  slotType: PlanSlotType,
  charLevel: number,
  opts: { classSlug?: string; ancestrySlug?: string; gateElements?: readonly string[] } = {},
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
 * applyClass — doc:create the class item plus doc:create ops for its arcane
 * prepared spellcasting entry and, if the class grants a focus pool, a
 * focus entry.
 *
 * The embedded class item keeps the class's FULL `keyAbility` option list
 * (r11 live-verification fix): the actual key-ability CHOICE lives in
 * `system.build.abilities.classBoost` (picked in the "Dádivas de Atributo"
 * dialog's class group) and the server's stepCharApplyClass prefers it over
 * `keyAbility[0]`. Narrowing the item at apply time silently locked the
 * choice to the first option (Magus → always dex, Tobias's str impossible).
 *
 * Returns the ops in creation order (class item first — though doc:create
 * ops for different embedded items are independent and order doesn't matter
 * to the server, keeping the class item first makes test assertions and
 * debugging easier).
 */
export function applyClass(
  ctx: PlanOpBuilderContext,
  classDoc: Record<string, unknown>,
): DocOpPayload[] {
  if (!ctx.editable) return [];
  const classSystemRaw = asRecord(classDoc["system"]);
  const classSystem = classSystemRaw as unknown as ClassSystemLike;

  const ops: DocOpPayload[] = [];
  ops.push({
    type: "doc:create",
    documentType: "Item",
    data: embeddedItemPayload(classDoc),
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
          // Focus spells cast with the class's SPELLCASTING ability (Magus
          // conflux = INT), not the key ability (r11 fix — Pathbuilder's
          // focus block confirms int for Tobias).
          ability: { value: classSystem.spellcasting?.ability ?? "int" },
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
 * into `system.build.abilities.backgroundBoosts`, and reset/preserve its
 * FREE boosts into `system.build.abilities.backgroundFree` (R11 item 1: the
 * PF2e Remaster background boost table is normally two "free" choices — see
 * systems/pf2e/packs/backgrounds-core, e.g. Fireworks Performer:
 * `["free","free"]` — resolved later via
 * setAbilityBoosts(ctx, "backgroundFree", [...])). Same preserve-if-same-
 * count / reset-otherwise policy as applyAncestry's `ancestryFree` handling.
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

  const ops: DocOpPayload[] = [
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
  const trainings = readBackgroundTrainings(sys);
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

/**
 * loreSlug — a stable skill slug for a lore proficiency. Strips a trailing
 * "Lore" word, slugifies the rest, and re-appends "-lore" (matching the
 * "<topic>-lore" convention the character derivation already recognizes for
 * persisted Lore skills). "Piloting Lore" → "piloting-lore".
 */
export function loreSlug(name: string): string {
  const base = name
    .trim()
    .replace(/\s*lore\s*$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `${base}-lore` : "lore";
}

/**
 * backgroundTrainingOps — the `doc:update` ops that train a background's skills
 * + lores. Skills become `backgroundSkill-N` build choices; each lore ALSO gets
 * a `system.skills.<slug>` entry stamped `lore:true` (so the derivation treats
 * it as an INT-based custom Lore) plus a `backgroundLore-N` build choice at rank
 * 1. Idempotent inputs — the heal filters out already-present trainings before
 * calling — so re-applying never duplicates a choice.
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
      slot: `backgroundSkill-${String(i)}`,
      type: "skillTraining",
      skill: slug,
      rank: 1,
    });
  });

  // Each lore needs its persisted `system.skills` entry (lore:true) so the
  // character derivation surfaces it; the build choice raises it to trained.
  const loreEntries: Record<string, unknown> = {};
  trainings.lores.forEach((lore, i) => {
    loreEntries[`system.skills.${lore.slug}`] = { rank: 0, lore: true, label: lore.label };
    newChoices.push({
      level: 1,
      slot: `backgroundLore-${String(i)}`,
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

  if (newChoices.length > 0) {
    const existingChoices = getBuildChoices(getSystem(ctx.doc));
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

  const missing = trainings.lores.filter(
    (lore) => !trainedSlugs.has(lore.slug) && !existingSkills[lore.slug],
  );
  if (missing.length === 0) return [];

  const loreEntries: Record<string, unknown> = {};
  const newChoices: BuildChoice[] = [];
  // Continue the backgroundLore-N numbering past any that already exist.
  const usedLoreSlots = new Set(existingChoices.map((c) => c.slot));
  let n = 0;
  for (const lore of missing) {
    loreEntries[`system.skills.${lore.slug}`] = { rank: 0, lore: true, label: lore.label };
    while (usedLoreSlots.has(`backgroundLore-${String(n)}`)) n++;
    usedLoreSlots.add(`backgroundLore-${String(n)}`);
    newChoices.push({
      level: 1,
      slot: `backgroundLore-${String(n)}`,
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
  return chooseFeat(
    ctx,
    { slotId: "hybridStudy-1", type: "hybridStudy" } as PlanSlotModel,
    level,
    featureDoc,
  );
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
 * keyed `lore-<slug(name)>`. Pure `doc:update` — the dialog calls this BEFORE
 * offering the new lore as a pickable row (it must exist on the ledger to be
 * targetable by a skillTraining pick in the same session).
 */
export function addLoreSkill(ctx: PlanOpBuilderContext, name: string): DocUpdatePayload | null {
  if (!ctx.editable) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const slug = `lore-${trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
  if (!slug || slug === "lore-") return null;
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
      }
    }
  }

  const existingChoices = getBuildChoices(getSystem(ctx.doc));
  const remaining = existingChoices.filter(
    (c) => c.slot !== slot.slotId && !c.slot.startsWith(subSlotPrefix),
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
// So resolution is uniform and NAME-based: search the right pack's index for
// an entry whose name matches, then getDocument(uuid) with the same
// on-demand cache the picker uses. featuresByLevel[].uuid is a bare Foundry
// id (e.g. "xvC1jNDkNdNtZQiF"), NOT a "Compendium.<pack>.Item.<id>" uuid, so
// it cannot feed compendium:get directly — name resolution is the reliable
// path for every case.
// ---------------------------------------------------------------------------

/** Minimal index-entry shape the details resolvers need (subset of PackIndexEntry). */
export interface PlanIndexEntryLike {
  name: string;
  uuid: string;
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

/** Resolve an embedded item's stored (EN or pt-BR) name to its bilingual display parts. */
export type ContentNameTranslator = (storedName: string) => ContentNameParts;

/** Read the pt-BR overlay name off an index entry — flat `namePt` first, then nested `i18n.ptBR.name`. */
function entryPtName(entry: PlanNameIndexEntry): string | undefined {
  const flat = entry.namePt;
  if (typeof flat === "string" && flat.trim()) return flat.trim();
  const nested = entry.i18n?.ptBR?.name;
  return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
}

/**
 * buildContentNameTranslator — EN/pt-BR → `{ namePt, nameEn }` map built from
 * one or more packs' index entries, joined by NORMALIZED NAME (the only
 * reliable key: `system.slug` is undefined everywhere, and the pack index does
 * NOT expose `flags.fusion.sourceId`). Mirrors `buildSpellNameTranslator`'s
 * shape: the index is keyed by the normalized EN name AND the normalized pt-BR
 * name (both point at the same `{ namePt, nameEn }`), so it resolves whether
 * the actor's embedded item name was copied in EN or pt-BR. First write wins
 * per key (deterministic given a stable index order).
 *
 * Names with no matching pack entry return `{ namePt: stored, nameEn: stored }`
 * — an EN-only fallback that still lets the caller render the "always both"
 * layout (identical main/subtitle) without crashing on unknown content.
 */
export function buildContentNameTranslator(
  entriesByPack: PlanNameIndexEntry[][],
): ContentNameTranslator {
  const map = new Map<string, ContentNameParts>();
  for (const entries of entriesByPack) {
    for (const entry of entries) {
      const nameEn = entry.name;
      if (!nameEn) continue;
      const namePt = entryPtName(entry) ?? nameEn;
      const parts: ContentNameParts = { namePt, nameEn };
      const enKey = normalizeName(nameEn);
      const ptKey = normalizeName(namePt);
      if (enKey && !map.has(enKey)) map.set(enKey, parts);
      if (ptKey && !map.has(ptKey)) map.set(ptKey, parts);
    }
  }
  return (storedName: string): ContentNameParts => {
    const fallback: ContentNameParts = { namePt: storedName, nameEn: storedName };
    if (!storedName) return fallback;
    return map.get(normalizeName(storedName)) ?? fallback;
  };
}

/** EN slot-type labels, exported for use as the ALWAYS-shown EN subtitle beside the pt-BR i18n label (r14 rule). */
export const SLOT_TYPE_LABELS_EN: Record<PlanSlotType, string> = SLOT_TYPE_LABELS;

/**
 * A request to open the details panel for a Plan item: which pack to search
 * and the item name to match. `level`/`rank` are display-only extras the
 * caller may already know; the resolver ignores them.
 */
export interface PlanDetailsRequest {
  /** Pack slug suffix, e.g. "class-features-core" / "feats-core". */
  packSlug: string;
  /** Item name to resolve against the pack index (accent/case-insensitive). */
  name: string;
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
 */
export function detailsRequestForSlot(slot: PlanSlotModel): PlanDetailsRequest | null {
  const name = slot.choiceName;
  if (!name || !slot.filled) return null;
  // A locked fixed-grant chip (B2 r14) carries its own pack hint so a granted
  // classFeature resolves in class-features-core, not the feats-core default.
  if (slot.detailsPackSlug) return { packSlug: slot.detailsPackSlug, name };
  switch (slot.type) {
    case "hybridStudy":
    case "kineticGate":
      return { packSlug: "class-features-core", name };
    case "ancestryFeat":
    case "classFeat":
    case "generalFeat":
    case "skillFeat":
    case "archetypeFeat":
    case "grantedFeat":
      return { packSlug: "feats-core", name };
    default:
      return null;
  }
}

/** The pack a locked auto-feature chip's description lives in (always a class feature). */
export function detailsRequestForAutoFeature(feature: AutoFeatureModel): PlanDetailsRequest {
  return { packSlug: feature.detailsPackSlug ?? "class-features-core", name: feature.name };
}

/**
 * The details request for a locked ABC chip (r20-X4), or null when the chip is
 * INFORMATIVE (a scalar, or an unresolved feature with no clean-room pack) — the
 * caller renders those non-clickable.
 */
export function detailsRequestForAbcChip(chip: AbcChip): PlanDetailsRequest | null {
  if (!chip.detailsPackSlug) return null;
  return { packSlug: chip.detailsPackSlug, name: chip.name };
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

export { readClassSystem as _readClassSystemForTests, readClassItemId as _readClassItemIdForTests };
