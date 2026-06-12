/**
 * scan-rules.mjs
 * Scans system.rules[] across all items in the essential pf2e packs.
 * Produces frequency tables by rule element key and by property.
 *
 * Usage:
 *   node analysis/scan-rules.mjs
 *
 * No external dependencies required (Node 22 built-ins only).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_ROOT = join(
  __dirname,
  "../vendor/pf2e/packs/pf2e"
);

// Essential packs for MVP (equipment, spells, feats, monsters core)
const ESSENTIAL_PACKS = [
  "equipment",
  "equipment-effects",
  "spells",
  "spell-effects",
  "feats",
  "feat-effects",
  "class-features",
  "bestiary-effects",
  "pathfinder-monster-core",
  "pathfinder-monster-core-2",
  "pathfinder-bestiary",
  "pathfinder-bestiary-2",
  "pathfinder-bestiary-3",
  "ancestries",
  "ancestry-features",
  "backgrounds",
  "conditions",
  "heritages",
  "actions",
  "classes",
  "deities",
  "hazards",
];

/** Recursively collect all JSON files under a directory */
function collectJsonFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fp = join(dir, entry);
    const stat = statSync(fp);
    if (stat.isDirectory()) {
      results.push(...collectJsonFiles(fp));
    } else if (entry.endsWith(".json") && entry !== "_folders.json") {
      results.push(fp);
    }
  }
  return results;
}

/** Extract rules from an item (including embedded items inside actors) */
function extractRules(doc) {
  const rules = [];
  // Top-level rules
  if (Array.isArray(doc?.system?.rules)) {
    rules.push(...doc.system.rules);
  }
  // Embedded items inside actors (NPC monsters)
  if (Array.isArray(doc?.items)) {
    for (const item of doc.items) {
      if (Array.isArray(item?.system?.rules)) {
        rules.push(...item.system.rules);
      }
    }
  }
  return rules;
}

// ──────────────────────────────────────────────────────────
// Main scan
// ──────────────────────────────────────────────────────────

const keyFreq = {}; // key → count
const keyPackFreq = {}; // key → { pack: count }
const keyPropertyFreq = {}; // key → { property: count }
const keyModeFreq = {}; // key → { mode: count }

let totalDocs = 0;
let totalRules = 0;
let docsWithRules = 0;

for (const packName of ESSENTIAL_PACKS) {
  const packDir = join(PACKS_ROOT, packName);
  const files = collectJsonFiles(packDir);

  for (const fp of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    totalDocs++;
    const rules = extractRules(doc);
    if (rules.length > 0) docsWithRules++;

    for (const rule of rules) {
      totalRules++;
      const key = rule.key ?? "(no key)";
      keyFreq[key] = (keyFreq[key] ?? 0) + 1;

      if (!keyPackFreq[key]) keyPackFreq[key] = {};
      keyPackFreq[key][packName] = (keyPackFreq[key][packName] ?? 0) + 1;

      if (rule.property !== undefined) {
        if (!keyPropertyFreq[key]) keyPropertyFreq[key] = {};
        const prop = String(rule.property);
        keyPropertyFreq[key][prop] = (keyPropertyFreq[key][prop] ?? 0) + 1;
      }

      if (rule.mode !== undefined) {
        if (!keyModeFreq[key]) keyModeFreq[key] = {};
        const mode = String(rule.mode);
        keyModeFreq[key][mode] = (keyModeFreq[key][mode] ?? 0) + 1;
      }
    }
  }
}

// Sort by frequency descending
const sorted = Object.entries(keyFreq).sort((a, b) => b[1] - a[1]);
const top10 = sorted.slice(0, 10);

// ──────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────

console.log("=".repeat(72));
console.log("FUSION / PF2E — Rule Elements Frequency Analysis");
console.log("=".repeat(72));
console.log(`Total documents scanned : ${totalDocs}`);
console.log(`Documents with rules    : ${docsWithRules}`);
console.log(`Total rule entries      : ${totalRules}`);
console.log(`Unique rule element keys: ${sorted.length}`);
console.log();

console.log("── Full frequency table (key → count → % of total rules) ──");
console.log(
  "rank".padEnd(6) +
    "count".padEnd(8) +
    "%total".padEnd(9) +
    "cumul%".padEnd(9) +
    "key"
);
console.log("-".repeat(60));
let cumul = 0;
sorted.forEach(([key, count], i) => {
  cumul += count;
  const pct = ((count / totalRules) * 100).toFixed(1);
  const cumulPct = ((cumul / totalRules) * 100).toFixed(1);
  console.log(
    String(i + 1).padEnd(6) +
      String(count).padEnd(8) +
      (pct + "%").padEnd(9) +
      (cumulPct + "%").padEnd(9) +
      key
  );
});

console.log();
console.log("── Top 10 Rule Elements (detail) ──");
for (const [key, count] of top10) {
  console.log(`\n[${key}] — ${count} occurrences`);

  const props = keyPropertyFreq[key];
  if (props) {
    const topProps = Object.entries(props)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(
      "  properties: " +
        topProps.map(([p, c]) => `${p}(${c})`).join(", ")
    );
  }

  const modes = keyModeFreq[key];
  if (modes) {
    console.log(
      "  modes: " +
        Object.entries(modes)
          .sort((a, b) => b[1] - a[1])
          .map(([m, c]) => `${m}(${c})`)
          .join(", ")
    );
  }

  const packs = keyPackFreq[key];
  if (packs) {
    const topPacks = Object.entries(packs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    console.log(
      "  top packs: " +
        topPacks.map(([p, c]) => `${p}(${c})`).join(", ")
    );
  }
}

// JSON output for consumption by analysis docs
const jsonOut = {
  meta: { totalDocs, docsWithRules, totalRules, uniqueKeys: sorted.length },
  topKeys: sorted.map(([key, count], i) => ({
    rank: i + 1,
    key,
    count,
    pct: parseFloat(((count / totalRules) * 100).toFixed(2)),
  })),
};

import { writeFileSync } from "fs";
const outPath = join(__dirname, "scan-rules-output.json");
writeFileSync(outPath, JSON.stringify(jsonOut, null, 2));
console.log(`\nJSON output written to: ${outPath}`);
