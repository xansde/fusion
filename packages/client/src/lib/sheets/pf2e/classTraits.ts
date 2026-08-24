/**
 * Class trait slugs of the PF2e system — the single source of truth for
 * "does this document belong to a specific class?".
 *
 * Two consumers need the same answer and used to keep two hand-synced copies
 * of this list (planVM's `isFeatEligible`, to tell a DIFFERENT class's feat
 * from a shared class feat; characterSheetVM's `filterSpellPicker`, to do the
 * same for focus spells — issue #7). The copies could not import each other
 * (planVM already imports from characterSheetVM, so the reverse would cycle),
 * so they were duplicated with a comment asking future editors to keep them in
 * sync by hand. Nothing enforced it.
 *
 * What that cost: the Psychic shipped in the packs (PR #95) without its slug
 * being added, so its feats stopped "looking class-tagged" and became eligible
 * for EVERY class — 44 feats leaking into every picker, found only when the
 * r29 class survey went looking. Extracting the list into this third module
 * breaks the cycle and gives both sides one list to extend.
 *
 * The list is the classes of the SYSTEM, not the classes currently curated
 * into the packs: an entry costs nothing before its class is imported, while a
 * missing entry is the silent leak above. `classTraits.test.ts` derives the
 * curated slugs from `classes-core` and asserts the behaviour, so a class
 * imported without its slug here fails the suite instead of shipping broken.
 */
export const KNOWN_CLASS_TRAITS: ReadonlySet<string> = new Set([
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
]);
