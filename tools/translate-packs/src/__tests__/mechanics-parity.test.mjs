/**
 * mechanics-parity.test.mjs — MANDATORY calibration test (T1 design contract
 * §3.a): the mechanics.json overlay generated for "Basic Concoction" MUST
 * reproduce exactly the same filter as the hardcoded
 * `GRANTED_FEAT_CHOICES["basic concoction"]` table in
 * packages/client/src/lib/sheets/pf2e/planVM.ts — same category, same
 * trait, same maxLevel, same labelKey. A divergence here is a talent-gating
 * bug (see the design contract's "Notas de risco").
 *
 * This test does NOT import planVM.ts (a .ts file — not loadable under
 * plain `node --test`, same constraint documented in
 * tools/importer-pf2e/src/__tests__/transform.test.mjs). Instead it reads
 * the file as text and extracts the literal values from the
 * GRANTED_FEAT_CHOICES["basic concoction"] block via a narrow, well-anchored
 * regex — sufficient because that table is hand-authored literal data, not
 * computed. If planVM.ts's block is ever reshaped beyond recognition, this
 * test fails loudly (extraction assertions) rather than silently
 * false-passing.
 *
 * Owner: implementer A (pipeline). Runs under `node --test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractMechanicsForPack } from "../mechanics-overlay.mjs";
import { applyLabelKeys, nameToSlug } from "../calibration.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findMonorepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate monorepo root walking up from ${startDir}`);
}

const ROOT = findMonorepoRoot(__dirname);
const PLAN_VM_PATH = join(
  ROOT,
  "packages",
  "client",
  "src",
  "lib",
  "sheets",
  "pf2e",
  "planVM.ts",
);
const FEATS_CORE_DOCS_PATH = join(ROOT, "systems", "pf2e", "packs", "feats-core", "documents.json");

/**
 * Extracts the "basic concoction" entry from GRANTED_FEAT_CHOICES in
 * planVM.ts's source text. Returns { labelKey, category, trait, maxLevel }.
 * Throws (failing the test) if the expected literal shape isn't found —
 * this is intentional: a reshape of planVM.ts's hardcode should force a
 * human to look at this test, not silently pass.
 */
function extractBasicConcoctionFromPlanVM(source) {
  const blockMatch = /GRANTED_FEAT_CHOICES[\s\S]*?"basic concoction":\s*\{([\s\S]*?)\n {2}\},/.exec(
    source,
  );
  assert.ok(blockMatch, 'Could not locate "basic concoction" block in planVM.ts GRANTED_FEAT_CHOICES');
  const block = blockMatch[1];

  const labelKeyMatch = /labelKey:\s*"([^"]+)"/.exec(block);
  const categoryMatch = /\{\s*kind:\s*"category",\s*value:\s*"([^"]+)"\s*\}/.exec(block);
  const traitMatch = /\{\s*kind:\s*"trait",\s*value:\s*"([^"]+)"\s*\}/.exec(block);
  const maxLevelMatch = /\{\s*kind:\s*"levelAtMost",\s*value:\s*(\d+)\s*\}/.exec(block);

  assert.ok(labelKeyMatch, "labelKey not found in basic concoction block");
  assert.ok(categoryMatch, "category predicate not found in basic concoction block");
  assert.ok(traitMatch, "trait predicate not found in basic concoction block");
  assert.ok(maxLevelMatch, "levelAtMost predicate not found in basic concoction block");

  return {
    labelKey: labelKeyMatch[1],
    category: categoryMatch[1],
    trait: traitMatch[1],
    maxLevel: Number(maxLevelMatch[1]),
  };
}

function readFeatsCoreDocs() {
  const raw = JSON.parse(readFileSync(FEATS_CORE_DOCS_PATH, "utf8"));
  return Array.isArray(raw) ? raw : (raw.documents ?? raw.entries ?? Object.values(raw));
}

test("planVM.ts's GRANTED_FEAT_CHOICES basic-concoction block is readable and has the expected literal shape", () => {
  assert.ok(existsSync(PLAN_VM_PATH), `planVM.ts not found at ${PLAN_VM_PATH}`);
  const source = readFileSync(PLAN_VM_PATH, "utf8");
  const extracted = extractBasicConcoctionFromPlanVM(source);
  assert.equal(extracted.category, "class");
  assert.equal(extracted.trait, "alchemist");
  assert.equal(extracted.maxLevel, 2);
  assert.equal(extracted.labelKey, "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction");
});

test("PARITY: mechanics.json grant for Basic Concoction matches planVM.ts's GRANTED_FEAT_CHOICES exactly", () => {
  const planVmSource = readFileSync(PLAN_VM_PATH, "utf8");
  const expected = extractBasicConcoctionFromPlanVM(planVmSource);

  const docs = readFeatsCoreDocs();
  const basicConcoctionDoc = docs.find((d) => d.name === "Basic Concoction");
  assert.ok(basicConcoctionDoc, "Basic Concoction doc not found in feats-core pack");

  // nameToSlug(doc.name) must land on the same key planVM.ts uses.
  assert.equal(nameToSlug(basicConcoctionDoc.name), "basic concoction");

  const { entries } = extractMechanicsForPack(docs);
  applyLabelKeys(entries, docs);

  const entry = entries[basicConcoctionDoc._id];
  assert.ok(entry, "Basic Concoction produced no mechanics entry");
  assert.equal(entry.grants.length, 1, "Basic Concoction must produce exactly one grant");

  const grant = entry.grants[0];
  assert.equal(grant.category, expected.category, "category mismatch vs planVM.ts");
  assert.deepEqual(grant.filters.traits, [expected.trait], "trait filter mismatch vs planVM.ts");
  assert.equal(grant.filters.maxLevel, expected.maxLevel, "maxLevel mismatch vs planVM.ts");
  assert.equal(grant.labelKey, expected.labelKey, "labelKey mismatch vs planVM.ts");
  assert.equal(grant.confidence, 1.0, "fully literal filter must have confidence 1.0");
});

test("calibration.nameToSlug matches planVM.ts's nameToSlug exactly (trim + lowercase, no whitespace collapsing)", () => {
  const planVmSource = readFileSync(PLAN_VM_PATH, "utf8");
  assert.match(
    planVmSource,
    /function nameToSlug\(name: string \| undefined\): string \| undefined \{\s*return name\?\.trim\(\)\.toLowerCase\(\) \|\| undefined;/,
    "planVM.ts's nameToSlug implementation changed — calibration.mjs's copy must be updated to match",
  );
  assert.equal(nameToSlug("  Basic Concoction  "), "basic concoction");
  assert.equal(nameToSlug(""), undefined);
  assert.equal(nameToSlug(undefined), undefined);
});
