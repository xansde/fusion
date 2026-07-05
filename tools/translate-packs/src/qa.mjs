#!/usr/bin/env node
/**
 * qa.mjs — Stage 4 of the translate-packs pipeline (CLI wrapper).
 *
 * Runs the automated per-doc translation checks (see qa-checks.mjs for the
 * check definitions: dice-formulas, balanced-tags, glossary-applied,
 * length-ratio, no-new-enrichers) against every translated doc in a pack's
 * i18n.pt-BR.json, and writes a JSON report.
 *
 * A failing doc should go back for retranslation.
 *
 * Usage:
 *   node src/qa.mjs [--packs pack1,pack2] [--out out/qa-report.json]
 *
 * Exit code is non-zero if any doc fails any check (so CI can gate on it).
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSystemPacksDir, listPackSlugs, readPackDocuments, readOverlay } from "./pack-io.mjs";
import { I18N_FILENAME } from "./i18n-overlay.mjs";
import { loadGlossary } from "./glossary.mjs";
import { runQaForPack } from "./qa-checks.mjs";

function parseArgs(argv) {
  const args = { packs: null, out: "out/qa-report.json", packsRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--packs-root") args.packsRoot = argv[++i];
  }
  return args;
}

export function runQa({ packsRoot, packs, glossary }) {
  const slugs = packs ?? listPackSlugs(packsRoot);
  const report = { generatedAt: new Date().toISOString(), packs: {} };
  let anyFailure = false;

  for (const slug of slugs) {
    const docsPath = join(packsRoot, slug, "documents.json");
    if (!existsSync(docsPath)) {
      report.packs[slug] = { error: "documents.json not found" };
      continue;
    }

    const docs = readPackDocuments(packsRoot, slug);
    const overlay = readOverlay(packsRoot, slug, I18N_FILENAME);
    const results = runQaForPack(docs, overlay, glossary);
    const failed = results.filter((r) => !r.pass);

    report.packs[slug] = { checked: results.length, failed: failed.length, failures: failed };
    if (failed.length > 0) anyFailure = true;
  }

  return { report, anyFailure };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = args.packsRoot ?? resolveSystemPacksDir("pf2e");
  const glossary = loadGlossary();

  const { report, anyFailure } = runQa({ packsRoot, packs: args.packs, glossary });

  for (const [slug, result] of Object.entries(report.packs)) {
    if (result.error) {
      console.error(`[qa] ${slug}: ${result.error}`);
      continue;
    }
    if (result.failed > 0) {
      console.log(`[qa] ${slug}: ${result.failed}/${result.checked} doc(s) FAILED`);
      for (const f of result.failures) {
        console.log(`  - ${f.id} "${f.name}": ${f.failures.join("; ")}`);
      }
    } else {
      console.log(`[qa] ${slug}: ${result.checked} doc(s) checked, all passed`);
    }
  }

  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[qa] report written to ${args.out}`);

  if (anyFailure) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
