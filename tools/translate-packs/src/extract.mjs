#!/usr/bin/env node
/**
 * extract.mjs — Stage 1 of the translate-packs pipeline.
 *
 * Scans systems/pf2e/packs/*\/documents.json and emits translation +
 * mechanics work-units as chunk files:
 *
 *   out/translate/<pack>/chunk-NNN.json
 *
 * Each chunk holds ~CHUNK_SIZE docs (default 20) with:
 *   { id, name, description, sourceHash, unconvertedRules, systemRules }
 *
 * Re-runnable: docs whose current sourceHash already has a non-stale
 * translation in the pack's i18n.pt-BR.json are skipped (the translation
 * work is already done and its source hasn't changed since).
 *
 * Usage:
 *   node src/extract.mjs [--packs pack1,pack2] [--chunk-size 20] [--out out/translate]
 *                         [--packs-root <path>]
 *
 * --packs-root overrides the default systems/pf2e/packs resolution (walking
 * up to the monorepo's pnpm-workspace.yaml) — used by pipeline-e2e.test.mjs
 * to point the CLI at an isolated fixture pack root instead of the real repo.
 *
 * Pure work-unit logic lives in i18n-overlay.mjs (buildWorkUnitsForPack) so
 * it can be unit-tested without triggering this file's CLI side effects.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSystemPacksDir,
  listPackSlugs,
  readPackDocuments,
  readOverlay,
  ensureDir,
  writeOverlay,
} from "./pack-io.mjs";
import { buildWorkUnitsForPack, I18N_FILENAME } from "./i18n-overlay.mjs";

function parseArgs(argv) {
  const args = { packs: null, chunkSize: 20, outDir: "out/translate", packsRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--chunk-size") args.chunkSize = Number(argv[++i]);
    else if (arg === "--out") args.outDir = argv[++i];
    else if (arg === "--packs-root") args.packsRoot = argv[++i];
  }
  return args;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function runExtract({ packsRoot, packs, chunkSize, outDir }) {
  const slugs = packs ?? listPackSlugs(packsRoot);
  const summary = [];

  for (const slug of slugs) {
    const docsPath = join(packsRoot, slug, "documents.json");
    if (!existsSync(docsPath)) {
      summary.push({ pack: slug, error: "documents.json not found" });
      continue;
    }

    const docs = readPackDocuments(packsRoot, slug);
    const existingOverlay = readOverlay(packsRoot, slug, I18N_FILENAME);
    const { units, skipped } = buildWorkUnitsForPack(docs, existingOverlay);
    const chunks = chunkArray(units, chunkSize);

    ensureDir(join(outDir, slug));

    chunks.forEach((chunk, index) => {
      const chunkNumber = String(index + 1).padStart(3, "0");
      writeOverlay(outDir, slug, `chunk-${chunkNumber}.json`, {
        pack: slug,
        chunkIndex: index + 1,
        chunkCount: chunks.length,
        docs: chunk,
      });
    });

    summary.push({
      pack: slug,
      totalDocs: docs.length,
      skipped,
      pending: units.length,
      chunks: chunks.length,
    });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = args.packsRoot ?? resolveSystemPacksDir("pf2e");
  const summary = runExtract({
    packsRoot,
    packs: args.packs,
    chunkSize: args.chunkSize,
    outDir: args.outDir,
  });

  for (const row of summary) {
    if (row.error) {
      console.error(`[extract] ${row.pack}: ${row.error}`);
      continue;
    }
    console.log(
      `[extract] ${row.pack}: ${row.totalDocs} docs, ${row.skipped} already translated (skipped), ` +
        `${row.pending} pending in ${row.chunks} chunk(s)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
