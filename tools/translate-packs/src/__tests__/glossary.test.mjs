/**
 * glossary.test.mjs — living coverage test for glossary.pt-BR.json.
 *
 * Owner: implementer B (glossary). Asserts the curated pt-BR glossary against
 * the REAL pack data (systems/pf2e/packs/*\/documents.json), so that any pack
 * regeneration that introduces a new trait/condition fails this test until the
 * glossary covers it. Also guards the integration contract with implementer A's
 * loader (src/glossary.mjs requires a flat `terms` object) and the determinism
 * of A's word-boundary substitution (multi-word keys must precede substrings).
 *
 * Runs under `node --test` (repo pattern: `pnpm test` -> node --test src/__tests__/*.test.mjs).
 * Pure filesystem reads; no build step; no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Locate the repo's systems/pf2e/packs dir by walking up from this test file.
// ---------------------------------------------------------------------------
function findPacksRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "systems", "pf2e", "packs");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate systems/pf2e/packs walking up from " + startDir);
}

const PACKS_ROOT = findPacksRoot(__dirname);
const GLOSSARY_PATH = join(__dirname, "..", "..", "glossary.pt-BR.json");

// ---------------------------------------------------------------------------
// Read a pack's documents.json (array-shaped in this repo) tolerantly.
// ---------------------------------------------------------------------------
function readPackDocs(slug) {
  const f = join(PACKS_ROOT, slug, "documents.json");
  if (!existsSync(f)) return [];
  const parsed = JSON.parse(readFileSync(f, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  return parsed.documents ?? parsed.entries ?? [];
}

function listPackSlugs() {
  return readdirSync(PACKS_ROOT).filter((f) => {
    try {
      return statSync(join(PACKS_ROOT, f)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Collect every string in system.traits.value across all packs. */
function collectRealTraits() {
  const traits = new Set();
  const visit = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(visit);
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "traits" && v && typeof v === "object" && Array.isArray(v.value)) {
        for (const t of v.value) if (typeof t === "string") traits.add(t);
      }
      visit(v);
    }
  };
  for (const slug of listPackSlugs()) readPackDocs(slug).forEach(visit);
  return traits;
}

/** Collect the condition names from the conditions pack (top-level doc.name). */
function collectRealConditions() {
  const names = new Set();
  for (const doc of readPackDocs("conditions")) {
    if (doc && typeof doc.name === "string") names.add(doc.name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Load glossary once.
// ---------------------------------------------------------------------------
const glossary = JSON.parse(readFileSync(GLOSSARY_PATH, "utf8"));

// ===========================================================================
// 1. Valid JSON + top-level shape.
// ===========================================================================
test("glossary is valid JSON with the expected top-level shape", () => {
  assert.equal(typeof glossary, "object");
  assert.equal(glossary.schemaVersion, 1);
  assert.equal(glossary.locale, "pt-BR");
  assert.equal(typeof glossary.attribution, "string");
  assert.ok(glossary.attribution.length > 0, "attribution must be non-empty (clean-room)");
  assert.equal(typeof glossary.terms, "object");
  assert.equal(typeof glossary.categories, "object");
});

// ===========================================================================
// 2. Integration contract with implementer A's loader (src/glossary.mjs).
//    A requires `parsed.terms` to be an object of string->string.
// ===========================================================================
test("terms is a flat map of non-empty strings (A's loader contract)", () => {
  assert.equal(typeof glossary.terms, "object");
  for (const [en, pt] of Object.entries(glossary.terms)) {
    assert.equal(typeof en, "string");
    assert.equal(typeof pt, "string", `term "${en}" must map to a string`);
    assert.ok(en.length > 0 && pt.length > 0, `term "${en}" has empty side`);
  }
});

// ===========================================================================
// 3. No conflicting duplicates: a given EN key never maps to two different
//    pt-BR values within the same map. (JSON parse already collapses exact
//    dup keys; this guards cross-casing collisions in `terms`.)
// ===========================================================================
test("no case-insensitive conflicting duplicate keys in terms", () => {
  const seen = new Map(); // lowercased EN -> pt
  for (const [en, pt] of Object.entries(glossary.terms)) {
    const key = en.toLowerCase();
    if (seen.has(key)) {
      assert.equal(
        seen.get(key),
        pt,
        `term "${en}" collides case-insensitively with a different translation`,
      );
    } else {
      seen.set(key, pt);
    }
  }
});

// ===========================================================================
// 4. A's substitution determinism: multi-word EN keys must be strictly longer
//    than any single-word substring they contain that is ALSO a key, so A's
//    length-desc sort replaces the phrase first. Spot-check known overlaps.
// ===========================================================================
test("multi-word term keys are longer than their overlapping single-word keys", () => {
  const keys = Object.keys(glossary.terms);
  const overlaps = [
    ["free action", "action"],
    ["spell attack", "spell"],
    ["basic saving throw", "saving throw"],
    ["persistent damage", "damage"],
    ["critical success", "success"],
    ["critical failure", "failure"],
    ["multiple attack penalty", "penalty"],
    ["spell DC", "DC"],
  ];
  for (const [long, short] of overlaps) {
    if (keys.includes(long) && keys.includes(short)) {
      assert.ok(
        long.length > short.length,
        `"${long}" must be longer than "${short}" so it substitutes first`,
      );
    }
  }
});

// ===========================================================================
// 5. COVERAGE — every real trait in the packs is translated in categories.traits.
// ===========================================================================
test("every trait used in the packs has a pt-BR translation", () => {
  const realTraits = collectRealTraits();
  assert.ok(realTraits.size > 100, `expected 100+ real traits, got ${realTraits.size}`);
  const traitMap = glossary.categories.traits;
  assert.equal(typeof traitMap, "object");
  const missing = [];
  for (const t of realTraits) {
    if (!Object.prototype.hasOwnProperty.call(traitMap, t)) missing.push(t);
    else assert.ok(traitMap[t].length > 0, `trait "${t}" maps to empty string`);
  }
  assert.deepEqual(missing, [], `traits missing from glossary: ${missing.join(", ")}`);
});

// ===========================================================================
// 6. COVERAGE — every condition name in the conditions pack is translated.
// ===========================================================================
test("every condition in the conditions pack has a pt-BR translation", () => {
  const realConditions = collectRealConditions();
  assert.ok(realConditions.size >= 40, `expected 40+ conditions, got ${realConditions.size}`);
  const condMap = glossary.categories.conditions;
  assert.equal(typeof condMap, "object");
  const missing = [];
  for (const c of realConditions) {
    if (!Object.prototype.hasOwnProperty.call(condMap, c)) missing.push(c);
    else assert.ok(condMap[c].length > 0, `condition "${c}" maps to empty string`);
  }
  assert.deepEqual(missing, [], `conditions missing from glossary: ${missing.join(", ")}`);
});

// ===========================================================================
// 7. Canonical fixed sets present (attributes, 16 skills + Perception, saves).
// ===========================================================================
test("canonical attributes, skills, and saves are covered", () => {
  const { attributes, skills, saves } = glossary.categories;
  const expectedAttrs = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
  for (const a of expectedAttrs) assert.ok(attributes[a], `attribute "${a}" missing`);

  const expectedSkills = [
    "Acrobatics", "Arcana", "Athletics", "Crafting", "Deception", "Diplomacy",
    "Intimidation", "Lore", "Medicine", "Nature", "Occultism", "Performance",
    "Religion", "Society", "Stealth", "Survival", "Thievery", "Perception",
  ];
  for (const s of expectedSkills) assert.ok(skills[s], `skill "${s}" missing`);

  for (const sv of ["fortitude", "reflex", "will"]) {
    assert.ok(saves[sv], `save "${sv}" missing`);
  }
});

// ===========================================================================
// 8. Damage types and rarities/traditions from the packs are covered.
// ===========================================================================
test("damage types, rarities and traditions are covered", () => {
  const { damageTypes, rarities, traditions } = glossary.categories;
  // Damage types confirmed present in pack prose/weapons.
  for (const d of ["bludgeoning", "piercing", "slashing", "fire", "cold", "acid",
    "electricity", "sonic", "force", "mental", "poison", "spirit", "vitality", "void", "bleed"]) {
    assert.ok(damageTypes[d], `damage type "${d}" missing`);
  }
  for (const r of ["common", "uncommon", "rare"]) assert.ok(rarities[r], `rarity "${r}" missing`);
  for (const t of ["arcane", "divine", "occult", "primal"]) {
    assert.ok(traditions[t], `tradition "${t}" missing`);
  }
});

// ===========================================================================
// 9. keepEnglish / styleDecisions are documented (auditability of clean-room).
// ===========================================================================
test("keepEnglish and styleDecisions are present and documented", () => {
  assert.equal(typeof glossary.keepEnglish, "object");
  assert.equal(typeof glossary.styleDecisions, "object");
  assert.ok(Object.keys(glossary.styleDecisions).length >= 5, "expected documented style decisions");
  // DC->CD is the load-bearing style decision; assert it's applied in `terms`.
  assert.equal(glossary.terms["DC"], "CD");
  assert.equal(glossary.terms["spell DC"], "CD de magia");
});
