#!/usr/bin/env node
/**
 * apply-mechanics-llm.mjs — CLI runner for the LLM mechanics merge.
 *
 * Reads out/mechanics-llm/<pack>/chunk-*.json, folds the surviving
 * feat-choice grants (and ancestry-feat-eligibility unlocks) into each pack's
 * mechanics.json overlay WITHOUT ever overriding a rule-element entry, then
 * validates the result against PackMechanicsOverlaySchema and writes it back.
 *
 * Usage:
 *   node src/apply-mechanics-llm.mjs [--packs feats-core,class-features-core]
 *                                    [--llm-dir out/mechanics-llm]
 *                                    [--dry-run]
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSystemPacksDir,
  readPackDocuments,
  resolvePackId,
  readOverlay,
  writeOverlay,
  findMonorepoRoot,
} from "./pack-io.mjs";
import { MECHANICS_FILENAME } from "./mechanics-overlay.mjs";
import {
  readLlmChunks,
  buildLlmAdditions,
  mergeLlmIntoOverlay,
  loadOverlaySchema,
} from "./merge-mechanics-llm.mjs";

function parseArgs(argv) {
  const args = { packs: ["feats-core", "class-features-core"], llmDir: "out/mechanics-llm", dryRun: false, packsRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--llm-dir") args.llmDir = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--packs-root") args.packsRoot = argv[++i];
  }
  return args;
}

export async function runApplyLlm({ packsRoot, packs, llmDir, dryRun, root = findMonorepoRoot() }) {
  const OverlaySchema = await loadOverlaySchema(root);
  const summary = [];

  for (const slug of packs) {
    const docsPath = join(packsRoot, slug, "documents.json");
    if (!existsSync(docsPath)) {
      summary.push({ pack: slug, error: "documents.json not found" });
      continue;
    }

    const docs = readPackDocuments(packsRoot, slug);
    const docsById = new Map(docs.map((d) => [d._id, d]));
    const packId = resolvePackId(packsRoot, slug);

    const llmChunks = readLlmChunks(llmDir, slug);
    const existingOverlay = readOverlay(packsRoot, slug, MECHANICS_FILENAME);

    const { added, stats } = buildLlmAdditions({ llmChunks, existingOverlay, docsById });

    const merged = mergeLlmIntoOverlay({ packId, existingOverlay, additions: added });

    // Validate before writing — a schema failure must abort, never write.
    const parsed = OverlaySchema.safeParse(merged);
    if (!parsed.success) {
      summary.push({ pack: slug, error: `schema validation failed: ${parsed.error.message}` });
      continue;
    }

    // Don't create an empty mechanics.json out of nothing: if the pack had no
    // pre-existing overlay AND the LLM contributed no entries, writing would
    // only add an empty-entries file (pure noise — same guard apply.mjs uses).
    const wouldBeEmpty = !existingOverlay && Object.keys(merged.entries).length === 0;

    let written = false;
    if (!dryRun && !wouldBeEmpty) {
      writeOverlay(packsRoot, slug, MECHANICS_FILENAME, merged);
      written = true;
    }

    summary.push({
      pack: slug,
      llmDocs: Object.keys(llmChunks).length,
      addedEntries: Object.keys(added).length,
      addedGrants: stats.addedGrantCount,
      addedUnlocks: stats.addedUnlockCount,
      conflicts: stats.conflicts,
      denied: stats.denied,
      missingDocs: stats.missingDocs,
      droppedGrants: stats.droppedGrants,
      droppedUnlocks: stats.droppedUnlocks,
      totalEntries: Object.keys(merged.entries).length,
      written,
    });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = findMonorepoRoot();
  const packsRoot = args.packsRoot ?? resolveSystemPacksDir("pf2e", root);
  const summary = await runApplyLlm({
    packsRoot,
    packs: args.packs,
    llmDir: args.llmDir,
    dryRun: args.dryRun,
    root,
  });

  for (const row of summary) {
    if (row.error) {
      console.error(`[apply-llm] ${row.pack}: ${row.error}`);
      continue;
    }
    console.log(
      `[apply-llm] ${row.pack}: +${row.addedEntries} entries (${row.addedGrants} grants, ${row.addedUnlocks} unlocks) | ` +
        `conflicts(rule-element wins)=${row.conflicts.length} denied(review)=${row.denied.length} ` +
        `droppedGrants=${row.droppedGrants.length} droppedUnlocks=${row.droppedUnlocks.length} ` +
        `missingDocs=${row.missingDocs.length} | ` +
        `total entries=${row.totalEntries}${row.written ? "" : " (dry-run)"}`,
    );
  }
}

// Only run main when invoked directly (not when imported by tests).
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
