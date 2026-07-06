#!/usr/bin/env node
/**
 * grants-from-rules.mjs — Stage 2 of the translate-packs pipeline.
 *
 * Deterministic mechanics extraction: normalizes ChoiceSet/GrantItem rule
 * elements (via normalize-rules.mjs) into the Grant/Unlock schema from the
 * T1 design contract, writing:
 *
 *   out/mechanics/<pack>.rules.json
 *
 * Every emitted grant/unlock has source: "rule-element" (100% deterministic,
 * derived straight from vendor rule elements preserved on the doc — no LLM
 * involved at this stage; T2 confirms/extends coverage separately).
 *
 * Calibration (mandatory — see calibration.mjs):
 *   - Basic Concoction    -> grant {category:"class", trait:"alchemist", maxLevel:2}
 *   - Ancestral Paragon   -> grant {category:"ancestry", levelExpr:"item:level:1"} (dynamic traits, confidence 0.6)
 *   - Adopted Ancestry    -> unlock {mechanism:"adopted-ancestry", excludeOwnAncestry:true}
 *   - Alchemist Dedication -> no grant (fixed grant-item targets, not a ChoiceSet-driven choice)
 * These are asserted in src/__tests__/mechanics-parity.test.mjs against the
 * live pf2e feats-core pack AND against packages/client's own
 * GRANTED_FEAT_CHOICES table (planVM.ts) for the Basic Concoction case.
 *
 * Usage:
 *   node src/grants-from-rules.mjs [--packs pack1,pack2] [--out out/mechanics]
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSystemPacksDir,
  listPackSlugs,
  readPackDocuments,
  resolvePackId,
  writeOverlay,
} from "./pack-io.mjs";
import { extractMechanicsForPack } from "./mechanics-overlay.mjs";
import { applyLabelKeys } from "./calibration.mjs";
import { extractConfluxGrantsForPack, mergeConfluxIntoEntries } from "./conflux-grants.mjs";

function parseArgs(argv) {
  const args = { packs: null, outDir: "out/mechanics", packsRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--out") args.outDir = argv[++i];
    else if (arg === "--packs-root") args.packsRoot = argv[++i];
  }
  return args;
}

export function runGrantsFromRules({ packsRoot, packs, outDir }) {
  const slugs = packs ?? listPackSlugs(packsRoot);
  const summary = [];

  for (const slug of slugs) {
    const docsPath = join(packsRoot, slug, "documents.json");
    if (!existsSync(docsPath)) {
      summary.push({ pack: slug, error: "documents.json not found" });
      continue;
    }

    const docs = readPackDocuments(packsRoot, slug);
    const packId = resolvePackId(packsRoot, slug);
    const { entries } = extractMechanicsForPack(docs);
    applyLabelKeys(entries, docs);

    // Curated fixed-item grants from class-feature descriptions (the Magus
    // hybrid studies' "Conflux Spell", r15 A2). Merged additively into the
    // rule-element entries — a no-op for packs without the prose pattern.
    const confluxEntries = extractConfluxGrantsForPack(docs);
    mergeConfluxIntoEntries(entries, confluxEntries);

    let grantCount = 0;
    let unlockCount = 0;
    for (const entry of Object.values(entries)) {
      grantCount += entry.grants.length;
      unlockCount += entry.unlocks.length;
    }

    writeOverlay(outDir, "", `${slug}.rules.json`, {
      pack: slug,
      packId,
      entries,
    });

    summary.push({ pack: slug, docsScanned: docs.length, entriesWithMechanics: Object.keys(entries).length, grantCount, unlockCount });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = args.packsRoot ?? resolveSystemPacksDir("pf2e");
  const summary = runGrantsFromRules({ packsRoot, packs: args.packs, outDir: args.outDir });

  for (const row of summary) {
    if (row.error) {
      console.error(`[grants-from-rules] ${row.pack}: ${row.error}`);
      continue;
    }
    console.log(
      `[grants-from-rules] ${row.pack}: ${row.docsScanned} docs scanned, ` +
        `${row.entriesWithMechanics} with mechanics (${row.grantCount} grants, ${row.unlockCount} unlocks)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
