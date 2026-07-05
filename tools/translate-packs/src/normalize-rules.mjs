/**
 * normalize-rules.mjs — deterministic ChoiceSet/GrantItem → Grant/Unlock
 * normalizer.
 *
 * Implements the algorithm decided in the T1 design contract §3.c:
 *
 *   for each doc:
 *     choiceSets = unconvertedRules.filter(r => r.key === "ChoiceSet")
 *     grantItems = system.rules.filter(r => r.kind === "grant-item")
 *
 *     for each cs in choiceSets:
 *       if cs.choices is an ARRAY (static choices: skill/prof/terrain) -> IGNORE
 *       if cs.choices.itemType === "feat":
 *          paired = grantItems.some(g => g.uuid includes
 *                     `rulesSelections.${cs.flag}`)
 *          if paired -> emit GRANT (category/traits/maxLevel/levelExpr/count)
 *          else -> ignore (ChoiceSet feat without paired grant)
 *       if cs.choices.itemType is "ancestry"/"heritage" and NOT paired:
 *          -> emit UNLOCK (eligibility expansion)
 *
 * Only literal predicates (fixed category/trait/level) produce
 * confidence 1.0. Dynamic predicates (`{actor|...}`) are preserved verbatim
 * in `levelExpr`/left out of `filters.traits`, with confidence lowered to
 * 0.6/0.7 — T2 (LLM) confirms/completes those.
 *
 * This module is pure (no I/O) so it can be unit-tested against literal RE
 * fixtures pulled straight from systems/pf2e/packs/*\/documents.json.
 */

const GRANT_CATEGORIES = new Set(["class", "ancestry", "skill", "general", "archetype"]);

/** True if a value is a Foundry-style dynamic predicate placeholder, e.g. "{actor|system.details.ancestry.trait}". */
function isDynamicPlaceholder(value) {
  return typeof value === "string" && value.includes("{actor|") ;
}

function isGrantItemPairedWithFlag(grantItems, flag) {
  if (!flag) return false;
  const needle = `rulesSelections.${flag}`;
  return grantItems.some((g) => typeof g.uuid === "string" && g.uuid.includes(needle));
}

/**
 * Parses the `filter` array of a ChoiceSet with `choices.itemType === "feat"`
 * into { category, traits, maxLevel, levelExpr, allLiteral }.
 *
 * Recognized literal predicate shapes (verified against feats-core):
 *   - "item:category:<slug>"      -> category
 *   - "item:trait:<slug>"         -> traits[] (literal slug, no `{actor|..}`)
 *   - "item:level:<N>"            -> levelExpr (literal exact-level predicate)
 *   - { lte: ["item:level", N] }  -> maxLevel = N
 *   - { or: [...] } / { not: ... } containing any dynamic placeholder
 *     -> allLiteral = false (predicate preserved nowhere; confidence reduced)
 */
function parseFeatChoiceFilter(filter) {
  const predicates = Array.isArray(filter) ? filter : [];
  const traits = [];
  let category;
  let maxLevel;
  let levelExpr;
  let allLiteral = true;

  for (const predicate of predicates) {
    if (typeof predicate === "string") {
      const categoryMatch = /^item:category:(.+)$/.exec(predicate);
      if (categoryMatch) {
        category = categoryMatch[1];
        continue;
      }
      const traitMatch = /^item:trait:(.+)$/.exec(predicate);
      if (traitMatch) {
        if (isDynamicPlaceholder(traitMatch[1])) {
          allLiteral = false;
        } else {
          traits.push(traitMatch[1]);
        }
        continue;
      }
      const levelMatch = /^item:level:(.+)$/.exec(predicate);
      if (levelMatch) {
        levelExpr = predicate;
        if (isDynamicPlaceholder(levelMatch[1])) allLiteral = false;
        continue;
      }
      // Unrecognized literal string predicate — keep confidence but don't
      // fail; it simply doesn't map to a known filter field.
      continue;
    }

    if (predicate && typeof predicate === "object") {
      if (Array.isArray(predicate.lte) && predicate.lte[0] === "item:level") {
        const n = predicate.lte[1];
        if (typeof n === "number") {
          maxLevel = n;
          continue;
        }
      }
      // { or: [...] }, { not: ... }, or any other compound predicate shape:
      // dynamic/compound predicates are not translated into literal filter
      // fields. Mark as non-literal so confidence reflects the gap; T2 (LLM)
      // resolves these using the full predicate tree (not this pass).
      allLiteral = false;
      continue;
    }
  }

  return { category, traits, maxLevel, levelExpr, allLiteral };
}

/**
 * Normalizes a single doc's rules into { grants, unlocks } per the T1
 * contract's Grant/Unlock schema shape (see packages/shared/src/mechanics.ts
 * once implemented by track C — this module produces plain objects with the
 * identical field names/shapes so the JSON output matches that schema).
 *
 * @param {object} doc - a raw Fusion doc as stored in documents.json.
 * @returns {{ grants: object[], unlocks: object[] }}
 */
export function normalizeDocMechanics(doc) {
  const unconvertedRules = doc?.flags?.fusion?.unconvertedRules ?? [];
  const systemRules = doc?.system?.rules ?? [];

  const choiceSets = unconvertedRules.filter((r) => r?.key === "ChoiceSet");
  const grantItems = systemRules.filter((r) => r?.kind === "grant-item");

  const grants = [];
  const unlocks = [];

  for (const cs of choiceSets) {
    const choices = cs?.choices;

    // Static value choices (skill/prof/terrain pick lists) are arrays —
    // never a feat/ancestry grant or unlock. Ignore.
    if (Array.isArray(choices)) continue;
    if (!choices || typeof choices !== "object") continue;

    const itemType = choices.itemType;
    const paired = isGrantItemPairedWithFlag(grantItems, cs.flag);

    if (itemType === "feat") {
      if (!paired) continue; // ChoiceSet(feat) without a paired grant-item is not a grant.

      const { category, traits, maxLevel, levelExpr, allLiteral } = parseFeatChoiceFilter(
        choices.filter,
      );

      const filters = {};
      if (traits.length > 0) filters.traits = traits;
      if (maxLevel !== undefined) filters.maxLevel = maxLevel;
      if (levelExpr !== undefined) filters.levelExpr = levelExpr;

      grants.push({
        kind: "feat-choice",
        category: GRANT_CATEGORIES.has(category) ? category : (category ?? "general"),
        count: typeof choices.count === "number" ? choices.count : 1,
        filters,
        source: "rule-element",
        confidence: allLiteral ? 1.0 : 0.6,
        // Internal bookkeeping fields consumed by mechanics-overlay.mjs to
        // build labelKey / calibration bindings; stripped before the
        // overlay's `grants[]` is serialized if not part of the schema.
        _flag: cs.flag,
        _docId: doc?._id,
      });
      continue;
    }

    if ((itemType === "ancestry" || itemType === "heritage") && !paired) {
      const filters = {};
      const filterArr = Array.isArray(choices.filter) ? choices.filter : [];
      let excludeOwnAncestry = false;
      for (const predicate of filterArr) {
        if (
          predicate &&
          typeof predicate === "object" &&
          typeof predicate.not === "string" &&
          /^item:slug:\{actor\|/.test(predicate.not)
        ) {
          excludeOwnAncestry = true;
        }
      }
      if (excludeOwnAncestry) filters.excludeOwnAncestry = true;

      unlocks.push({
        kind: "ancestry-feat-eligibility",
        // Derived from the granting doc's own name (e.g. "Adopted Ancestry"
        // -> "adopted-ancestry"), not the vendor's internal ChoiceSet flag
        // (e.g. "ancestry") — the doc name is the stable, human-legible
        // identifier for the mechanism; the flag is an arbitrary vendor
        // variable name that collides across docs (see e.g. multiple feats
        // using flag "ancestry").
        mechanism: deriveMechanismSlug(doc?.name, cs.flag),
        filters,
        source: "rule-element",
        confidence: 1.0,
      });
      continue;
    }

    // itemType "ancestry"/"heritage" WITH a paired grant, or any other
    // itemType we don't yet recognize: not covered by this pass; leave for
    // T2 (LLM) confirmation. Nothing emitted.
  }

  return { grants, unlocks };
}

/** Derives a stable kebab-case mechanism slug from a doc name (falls back to the ChoiceSet flag). */
function deriveMechanismSlug(name, fallbackFlag) {
  const source = name || fallbackFlag || "unknown";
  return String(source)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
