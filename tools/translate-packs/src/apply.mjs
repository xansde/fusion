#!/usr/bin/env node
/**
 * apply.mjs — Stage 3 of the translate-packs pipeline.
 *
 * Merges:
 *   1. Translation results (format { [id]: { name, description? } }) from
 *      out/translate/<pack>/translated-*.json into the pack's
 *      systems/pf2e/packs/<pack>/i18n.pt-BR.json overlay.
 *   2. Mechanics results from out/mechanics/<pack>.rules.json into the
 *      pack's systems/pf2e/packs/<pack>/mechanics.json overlay.
 *
 * Both merges are idempotent (stable key ordering; re-applying the same
 * inputs produces byte-identical output — clean diffs across runs).
 *
 * Translation input format (one or more files per pack, merged left-to-right
 * in filename order; later files win on id conflicts):
 *   out/translate/<pack>/translated-*.json:
 *     { [docId]: { name: string, description?: string } }
 *
 * Usage:
 *   node src/apply.mjs [--packs pack1,pack2]
 *                       [--translated-dir out/translate]
 *                       [--mechanics-dir out/mechanics]
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSystemPacksDir,
  listPackSlugs,
  readPackDocuments,
  resolvePackId,
  readOverlay,
  writeOverlay,
} from "./pack-io.mjs";
import {
  I18N_FILENAME,
  mergeI18nOverlay,
  computeSourceHashesById,
} from "./i18n-overlay.mjs";
import { MECHANICS_FILENAME, mergeMechanicsOverlay } from "./mechanics-overlay.mjs";

function parseArgs(argv) {
  const args = {
    packs: null,
    translatedDir: "out/translate",
    mechanicsDir: "out/mechanics",
    packsRoot: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--translated-dir") args.translatedDir = argv[++i];
    else if (arg === "--mechanics-dir") args.mechanicsDir = argv[++i];
    else if (arg === "--packs-root") args.packsRoot = argv[++i];
  }
  return args;
}

/**
 * Reads and left-to-right merges every `translated-*.json` file for a pack
 * in a translated-work directory. Returns {} if the pack has no
 * translated-*.json files yet (nothing to apply — not an error, since a
 * pack may only have mechanics work pending).
 */
function readTranslatedFiles(translatedDir, slug) {
  const packDir = join(translatedDir, slug);
  if (!existsSync(packDir)) return {};

  const files = readdirSync(packDir)
    .filter((name) => name.startsWith("translated-") && name.endsWith(".json"))
    .sort();

  const merged = {};
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(packDir, file), "utf8"));
    Object.assign(merged, data);
  }
  return merged;
}

/** Reads out/mechanics/<pack>.rules.json (the deterministic rule-element extraction), or null. */
function readMechanicsRulesFile(mechanicsDir, slug) {
  const path = join(mechanicsDir, `${slug}.rules.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runApply({ packsRoot, packs, translatedDir, mechanicsDir }) {
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

    // --- i18n merge ---------------------------------------------------
    const translations = readTranslatedFiles(translatedDir, slug);
    const translatedCount = Object.keys(translations).length;
    let i18nWritten = false;
    if (translatedCount > 0) {
      const existingI18n = readOverlay(packsRoot, slug, I18N_FILENAME);
      const sourceHashesById = computeSourceHashesById(docs);
      const merged = mergeI18nOverlay({
        packId,
        existingOverlay: existingI18n,
        translations,
        sourceHashesById,
      });
      writeOverlay(packsRoot, slug, I18N_FILENAME, merged);
      i18nWritten = true;
    }

    // --- mechanics merge ------------------------------------------------
    // Skip writing mechanics.json when there is nothing to say: a pack with
    // zero fresh entries AND no pre-existing overlay would only produce an
    // empty-entries file (pure noise — most packs have no ChoiceSet/GrantItem
    // pair at all, e.g. spells-core/conditions/weapons-core).
    const rulesResult = readMechanicsRulesFile(mechanicsDir, slug);
    const existingMechanics = readOverlay(packsRoot, slug, MECHANICS_FILENAME);
    const hasFreshEntries = rulesResult && Object.keys(rulesResult.entries).length > 0;
    let mechanicsWritten = false;
    if (hasFreshEntries || existingMechanics) {
      const merged = mergeMechanicsOverlay({
        packId,
        existingOverlay: existingMechanics,
        freshEntries: rulesResult?.entries ?? {},
      });
      writeOverlay(packsRoot, slug, MECHANICS_FILENAME, merged);
      mechanicsWritten = true;
    }

    summary.push({
      pack: slug,
      translatedCount,
      i18nWritten,
      mechanicsEntryCount: rulesResult ? Object.keys(rulesResult.entries).length : 0,
      mechanicsWritten,
    });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = args.packsRoot ?? resolveSystemPacksDir("pf2e");
  const summary = runApply({
    packsRoot,
    packs: args.packs,
    translatedDir: args.translatedDir,
    mechanicsDir: args.mechanicsDir,
  });

  for (const row of summary) {
    if (row.error) {
      console.error(`[apply] ${row.pack}: ${row.error}`);
      continue;
    }
    const parts = [];
    parts.push(
      row.i18nWritten
        ? `i18n: ${row.translatedCount} translation(s) merged`
        : "i18n: nothing to apply",
    );
    parts.push(
      row.mechanicsWritten
        ? `mechanics: ${row.mechanicsEntryCount} entries merged`
        : "mechanics: nothing to apply",
    );
    console.log(`[apply] ${row.pack}: ${parts.join("; ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
