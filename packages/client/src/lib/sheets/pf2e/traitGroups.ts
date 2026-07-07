/**
 * traitGroups.ts — Semantic grouping for PF2e trait filter chips (W2-F).
 *
 * Problem: the "More filters" trait chip list in SpellPickerDialog (and any
 * other picker that exposes a flat trait-chip filter) rendered every distinct
 * `system.traits.value` string in a single flat, alphabetically-sorted row.
 * With 100+ distinct traits across spells/feats/class-features, that reads as
 * unstructured noise — a GM/player scanning for "give me all the elemental
 * damage traits" has to eyeball the whole alphabet.
 *
 * This module classifies the real trait vocabulary (extracted from
 * systems/pf2e/packs/{spells-core,feats-core,class-features-core} — see
 * decisions log for the extraction script) into curated PF2e-remaster
 * semantic groups. The mapping is DATA, not behavior: `TRAIT_GROUPS` is the
 * source of truth, `groupTraits()` is a pure function that buckets a runtime
 * trait list against it.
 *
 * Group order is fixed and curated (not alphabetical) — it mirrors how a
 * PF2e-literate reader mentally sorts traits: rarity/affinity first (rare
 * outliers you scan for), then tradition, then "what does this effect do to
 * the mind/senses", then "what kind of damage/element", then mechanical
 * housekeeping, then who-can-take-it (class/ancestry/archetype) last. Traits
 * absent from the curated map fall into the terminal "Outros"/"Other" group
 * (GROUP_OTHER_KEY) — see traitGroups.test.ts for the live coverage
 * assertion against the actual packs (kept under the <10% budget agreed for
 * this task; 0/107 traits fell through as of the initial curation).
 *
 * IMPORTANT: PF2e remaster's `rarity` (common/uncommon/rare/unique) and
 * `traditions` (arcane/divine/occult/primal — mostly) are SEPARATE fields on
 * `system.traits` (`traits.rarity`, `traits.traditions`), not members of
 * `traits.value`. The trait-chip filter this module feeds only ever sees
 * `traits.value` entries (see SpellPickerDialog's `availableTraits`/
 * `traitsOf`). A handful of tradition-shaped strings (arcane/divine/occult/
 * primal) DO also appear inside `traits.value` on some documents (e.g. a
 * spell tagged with its own tradition trait) — the "traditions" group below
 * exists for those, it is not a duplicate of the rarity/traditions fields.
 */

/** Sentinel group key for traits with no curated home. Always sorts last. */
export const GROUP_OTHER_KEY = "other";

export interface TraitGroupDef {
  /** i18n key for the group's display label (FUSION.Sheet.TraitGroups.*). */
  labelKey: string;
  /** Traits belonging to this group, as they appear in system.traits.value. */
  traits: readonly string[];
}

export interface GroupedTraits {
  key: string;
  labelKey: string;
  /** Traits present in the input, alphabetically sorted within the group. */
  traits: string[];
}

/**
 * Curated group order (source of truth). Each trait should appear in
 * exactly one group — traitGroups.test.ts asserts there are no duplicates
 * across groups and reports current pack coverage.
 */
export const TRAIT_GROUPS: ReadonlyArray<readonly [string, TraitGroupDef]> = [
  [
    "rarityAffinity",
    {
      labelKey: "FUSION.Sheet.TraitGroups.RarityAffinity",
      traits: ["mythic", "sanctified"],
    },
  ],
  [
    "traditions",
    {
      labelKey: "FUSION.Sheet.TraitGroups.Traditions",
      traits: ["arcane", "divine", "occult", "primal"],
    },
  ],
  [
    "mentalEffect",
    {
      labelKey: "FUSION.Sheet.TraitGroups.MentalEffect",
      traits: [
        "curse",
        "death",
        "disease",
        "emotion",
        "fear",
        "healing",
        "incapacitation",
        "mental",
        "morph",
        "polymorph",
        "sleep",
      ],
    },
  ],
  [
    "senseIllusion",
    {
      labelKey: "FUSION.Sheet.TraitGroups.SenseIllusion",
      traits: [
        "auditory",
        "darkness",
        "detection",
        "illusion",
        "light",
        "olfactory",
        "prediction",
        "revelation",
        "scrying",
        "secret",
        "shadow",
        "visual",
      ],
    },
  ],
  [
    "damageEnergy",
    {
      labelKey: "FUSION.Sheet.TraitGroups.DamageEnergy",
      traits: [
        "acid",
        "cold",
        "electricity",
        "evil",
        "fire",
        "force",
        "good",
        "holy",
        "poison",
        "sonic",
        "unholy",
        "vitality",
        "void",
      ],
    },
  ],
  [
    "physicalMaterial",
    {
      labelKey: "FUSION.Sheet.TraitGroups.PhysicalMaterial",
      traits: ["air", "earth", "metal", "plant", "water", "wood"],
    },
  ],
  [
    "planarOtherworldly",
    {
      labelKey: "FUSION.Sheet.TraitGroups.PlanarOtherworldly",
      traits: [
        "aura",
        "extradimensional",
        "incarnate",
        "spirit",
        "structure",
        "summon",
        "teleportation",
        "true-name",
      ],
    },
  ],
  [
    "mechanicUsage",
    {
      labelKey: "FUSION.Sheet.TraitGroups.MechanicUsage",
      traits: [
        "attack",
        "bravado",
        "cantrip",
        "circus",
        "composite",
        "composition",
        "concentrate",
        "contingency",
        "cursebound",
        "downtime",
        "exploration",
        "focus",
        "fortune",
        "general",
        "hex",
        "impulse",
        "lineage",
        "linguistic",
        "manipulate",
        "misfortune",
        "move",
        "nonlethal",
        "overflow",
        "reckless",
        "skill",
        "social",
        "spellshape",
        "stamina",
        "stance",
        "subtle",
      ],
    },
  ],
  [
    "classTrait",
    {
      labelKey: "FUSION.Sheet.TraitGroups.ClassTrait",
      traits: [
        "alchemist",
        "animist",
        "barbarian",
        "bard",
        "champion",
        "cleric",
        "commander",
        "druid",
        "exemplar",
        "fighter",
        "guardian",
        "gunslinger",
        "inventor",
        "investigator",
        "kineticist",
        "magus",
        "monk",
        "oracle",
        "psychic",
        "ranger",
        "rogue",
        "sorcerer",
        "summoner",
        "swashbuckler",
        "thaumaturge",
        "witch",
        "wizard",
      ],
    },
  ],
  [
    "ancestryTrait",
    {
      labelKey: "FUSION.Sheet.TraitGroups.AncestryTrait",
      traits: [
        // Planar scions / elemental-blooded heritages (Rage of Elements +
        // core) — the vocabulary Finn's Sylph heritage lives in.
        "ardande",
        "eidolon",
        "fleshwarp",
        "fungus",
        "naari",
        "nephilim",
        "oread",
        "ratfolk",
        "suli",
        "sylph",
        "talos",
        "undine",
      ],
    },
  ],
  [
    "archetypeTrait",
    {
      labelKey: "FUSION.Sheet.TraitGroups.ArchetypeTrait",
      traits: ["archetype", "dedication", "multiclass"],
    },
  ],
];

/** Reverse lookup: trait string -> group key. Built once at module load. */
const TRAIT_TO_GROUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [key, def] of TRAIT_GROUPS) {
    for (const trait of def.traits) {
      map.set(trait, key);
    }
  }
  return map;
})();

/**
 * Group a runtime list of trait strings (e.g. the distinct traits collected
 * from a pack index) into ordered, labeled buckets.
 *
 * - Group order follows the curated TRAIT_GROUPS order; "Outros"/"Other"
 *   (GROUP_OTHER_KEY) always sorts last, regardless of curated order.
 * - Traits within a group are alphabetically sorted.
 * - Empty groups (no matching trait in the input) are omitted entirely —
 *   callers render exactly the sections that have content.
 * - Duplicate input traits are de-duplicated (Set semantics).
 */
export function groupTraits(traits: readonly string[]): GroupedTraits[] {
  const inputSet = new Set(traits);
  const buckets = new Map<string, string[]>();

  for (const trait of inputSet) {
    const groupKey = TRAIT_TO_GROUP.get(trait) ?? GROUP_OTHER_KEY;
    const bucket = buckets.get(groupKey);
    if (bucket) {
      bucket.push(trait);
    } else {
      buckets.set(groupKey, [trait]);
    }
  }

  const result: GroupedTraits[] = [];
  for (const [key, def] of TRAIT_GROUPS) {
    const bucket = buckets.get(key);
    if (bucket && bucket.length > 0) {
      result.push({ key, labelKey: def.labelKey, traits: [...bucket].sort() });
    }
  }

  const otherBucket = buckets.get(GROUP_OTHER_KEY);
  if (otherBucket && otherBucket.length > 0) {
    result.push({
      key: GROUP_OTHER_KEY,
      labelKey: "FUSION.Sheet.TraitGroups.Other",
      traits: [...otherBucket].sort(),
    });
  }

  return result;
}
