#!/usr/bin/env node
/**
 * fix-enricher-structural.mjs — repairs translated enricher STRUCTURAL parts
 * in a pack's i18n.pt-BR.json overlay.
 *
 * Translators must keep everything inside `@Tag[...]` verbatim (only the
 * optional trailing `{label}` may be translated). When a batch slips —
 * e.g. `@Template[emanacao|...]`, `@Damage[3d6[perfuracao]]`,
 * `@Check[atletismo|cd:5]` — this script restores the EN structural part
 * positionally: doc by doc, the Nth PT enricher gets the Nth EN enricher's
 * structural part, while any PT `{label}` is preserved.
 *
 * Docs whose EN/PT enricher COUNTS differ are never auto-fixed — they are
 * reported for manual review instead (positional mapping would be unsafe).
 *
 * Only docs currently failing the structural comparison are touched; the
 * merge is idempotent.
 *
 * Usage:
 *   node src/fix-enricher-structural.mjs [--packs pack1,pack2] [--dry-run]
 */

import {
  resolveSystemPacksDir,
  listPackSlugs,
  readPackDocuments,
  readOverlay,
  writeOverlay,
} from "./pack-io.mjs";

const I18N_FILENAME = "i18n.pt-BR.json";
const ENRICHER_OPEN = /@[A-Za-z]+\[/g;

/** Depth-aware enricher span extraction: `@Tag[...balanced...]` + optional `{label}`. */
export function extractEnricherSpans(text) {
  const spans = [];
  ENRICHER_OPEN.lastIndex = 0;
  let m;
  while ((m = ENRICHER_OPEN.exec(text)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") depth--;
      i++;
    }
    if (depth !== 0) break; // unbalanced tail — stop rather than mangle.
    const structuralEnd = i;
    let end = structuralEnd;
    let label = null;
    if (text[end] === "{") {
      const close = text.indexOf("}", end);
      if (close !== -1) {
        label = text.slice(end, close + 1);
        end = close + 1;
      }
    }
    spans.push({ start: m.index, end, structural: text.slice(m.index, structuralEnd), label });
    ENRICHER_OPEN.lastIndex = end;
  }
  return spans;
}

/**
 * Restores EN structural parts into the PT text positionally. Returns the
 * fixed text, or null when the fix is unsafe (span count mismatch).
 */
export function restoreStructuralParts(enText, ptText) {
  const enSpans = extractEnricherSpans(enText);
  const ptSpans = extractEnricherSpans(ptText);
  if (enSpans.length !== ptSpans.length) return null;
  if (enSpans.length === 0) return ptText;

  let out = "";
  let cursor = 0;
  for (let i = 0; i < ptSpans.length; i++) {
    const pt = ptSpans[i];
    out += ptText.slice(cursor, pt.start);
    out += enSpans[i].structural + (pt.label ?? "");
    cursor = pt.end;
  }
  out += ptText.slice(cursor);
  return out;
}

function parseArgs(argv) {
  const args = { packs: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

function structuralSet(text) {
  return new Set(extractEnricherSpans(text).map((s) => s.structural));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = resolveSystemPacksDir("pf2e");
  const slugs = args.packs ?? listPackSlugs(packsRoot);

  for (const slug of slugs) {
    const overlay = readOverlay(packsRoot, slug, I18N_FILENAME);
    if (!overlay?.entries) continue;
    const docs = readPackDocuments(packsRoot, slug);
    const byId = new Map(docs.map((d) => [d._id, d]));

    let fixed = 0;
    const unsafe = [];
    for (const [id, entry] of Object.entries(overlay.entries)) {
      if (!entry.description) continue;
      const doc = byId.get(id);
      const enText = doc?.system?.description ?? "";
      if (!enText) continue;

      const enSet = structuralSet(enText);
      const ptSpans = extractEnricherSpans(entry.description);
      const drifted = ptSpans.some((s) => !enSet.has(s.structural));
      if (!drifted) continue;

      const repaired = restoreStructuralParts(enText, entry.description);
      if (repaired === null) {
        unsafe.push({ id, name: doc.name });
        continue;
      }
      entry.description = repaired;
      fixed++;
    }

    if (fixed > 0 && !args.dryRun) writeOverlay(packsRoot, slug, I18N_FILENAME, overlay);
    if (fixed > 0 || unsafe.length > 0) {
      console.log(`[fix-enrichers] ${slug}: ${fixed} doc(s) repaired${args.dryRun ? " (dry-run)" : ""}`);
      for (const u of unsafe) {
        console.log(`  ! ${u.id} "${u.name}": EN/PT enricher count mismatch — manual review needed`);
      }
    }
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
