#!/usr/bin/env node
/**
 * fix-kineticist-terminology.mjs — unifies the Kineticist noun spelling in
 * translated pack overlays (r20-X3).
 *
 * The glossary, traitNames.ts and class-features-core all use the canonical
 * "cineticista(s)" for the Kineticist class/trait noun, but a handful of
 * actions-core docs (translated in an earlier batch) used the non-standard
 * "cinetista(s)" instead — visible to players as a mixed-terminology chip
 * ("Cinetista" next to "Cineticista"). This script unifies every occurrence
 * to "cineticista(s)".
 *
 * Applies a single whole-word, case-preserving substitution
 * ("cinetista" -> "cineticista", "cinetistas" -> "cineticistas") to `name`
 * and `description` in systems/pf2e/packs/<pack>/i18n.pt-BR.json overlays.
 *
 * Never touches enricher STRUCTURAL spans (`@Tag[...]`) — reuses
 * extractEnricherSpans from fix-enricher-structural.mjs, same as
 * fix-missing-accents.mjs, so dice formulas, UUIDs and slugs inside
 * `@Damage[...]`, `@Check[...]`, `@Template[...]`, etc. are left
 * byte-identical. The optional trailing `{label}` of an enricher IS eligible
 * for substitution, same as any other prose text.
 *
 * Idempotent: re-running after a fix is a no-op (every occurrence already
 * reads "cineticista(s)", so the "cinetista(s)" pattern no longer matches).
 *
 * Usage:
 *   node src/fix-kineticist-terminology.mjs [--packs pack1,pack2] [--dry-run] [--report out/kineticist-report.json]
 */

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  resolveSystemPacksDir,
  listPackSlugs,
  readOverlay,
  writeOverlay,
  ensureDir,
} from "./pack-io.mjs";
import { extractEnricherSpans } from "./fix-enricher-structural.mjs";

const I18N_FILENAME = "i18n.pt-BR.json";

// Matches "cinetista"/"cinetistas" whole-word, case-insensitively. Never
// matches "cineticista(s)" itself (no shared word boundary landing mid-word),
// which is what keeps the script idempotent.
const WORD_PATTERN = /\bcinetistas?\b/gi;

/** Reapplies the case pattern of `sample` onto `word` (all-upper, Title, or lower). */
function matchCase(word, sample) {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
  if (sample[0] === sample[0].toUpperCase() && sample.slice(1) === sample.slice(1).toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

function replacementFor(match) {
  const canonical = match.toLowerCase() === "cinetistas" ? "cineticistas" : "cineticista";
  return matchCase(canonical, match);
}

/** Applies the substitution to a plain text fragment (no enricher spans inside). Returns { text, count }. */
function fixFragment(text) {
  let count = 0;
  const out = text.replace(WORD_PATTERN, (match) => {
    count++;
    return replacementFor(match);
  });
  return { text: out, count };
}

/**
 * Applies the fix to a full string that MAY contain `@Tag[...]` enricher
 * structural spans. Only text outside the structural part (including the
 * `{label}` tail) is touched.
 */
export function fixText(text) {
  if (typeof text !== "string" || text.length === 0) return { text, count: 0 };
  const spans = extractEnricherSpans(text);
  if (spans.length === 0) return fixFragment(text);

  let out = "";
  let cursor = 0;
  let count = 0;
  for (const span of spans) {
    const before = fixFragment(text.slice(cursor, span.start));
    out += before.text;
    count += before.count;

    out += span.structural;
    if (span.label) {
      const label = fixFragment(span.label);
      out += label.text;
      count += label.count;
    }
    cursor = span.end;
  }
  const tail = fixFragment(text.slice(cursor));
  out += tail.text;
  count += tail.count;
  return { text: out, count };
}

function parseArgs(argv) {
  const args = { packs: null, dryRun: false, report: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--report") args.report = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = resolveSystemPacksDir("pf2e");
  const slugs = args.packs ?? listPackSlugs(packsRoot);

  const report = { generatedAt: new Date().toISOString(), packs: {} };
  let grandDocs = 0;
  let grandSubs = 0;

  for (const slug of slugs) {
    const overlay = readOverlay(packsRoot, slug, I18N_FILENAME);
    if (!overlay?.entries) continue;

    let docsTouched = 0;
    let substitutions = 0;
    for (const entry of Object.values(overlay.entries)) {
      let entryTouched = false;
      if (typeof entry.name === "string") {
        const { text, count } = fixText(entry.name);
        if (count > 0) {
          entry.name = text;
          substitutions += count;
          entryTouched = true;
        }
      }
      if (typeof entry.description === "string") {
        const { text, count } = fixText(entry.description);
        if (count > 0) {
          entry.description = text;
          substitutions += count;
          entryTouched = true;
        }
      }
      if (entryTouched) docsTouched++;
    }

    if (docsTouched > 0) {
      report.packs[slug] = { docsTouched, substitutions };
      grandDocs += docsTouched;
      grandSubs += substitutions;
      if (!args.dryRun) writeOverlay(packsRoot, slug, I18N_FILENAME, overlay);
      console.log(
        `[fix-kineticist] ${slug}: ${docsTouched} doc(s), ${substitutions} substitution(s)${args.dryRun ? " (dry-run)" : ""}`,
      );
    }
  }

  console.log(`[fix-kineticist] TOTAL: ${grandDocs} doc(s), ${grandSubs} substitution(s)`);

  if (args.report) {
    ensureDir(dirname(args.report));
    writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[fix-kineticist] report written to ${args.report}`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
