/**
 * Prova de equivalência da derivação de `proficiencyUpgrades` (r21).
 *
 * A derivação genérica só pode substituir as tabelas autorais de Magus e
 * Kineticist se reproduzir o que elas já entregam. Este script compara as
 * duas coisas e imprime o diff. Divergência não é automaticamente erro — mas
 * TEM de ser explicada e registrada na curadoria da classe (foi assim que a
 * ausência de Reflex master no nível 11 do Kineticist apareceu).
 *
 * Uso:  node src/curation/check-derivation.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classItemsMap, loadClassCuration } from "./index.mjs";
import { deriveProficiencyUpgrades, diffUpgrades } from "./proficiency-upgrades.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, "..", "..");
const VENDOR_CLASSES = join(IMPORTER_ROOT, "vendor", "pf2e", "packs", "pf2e", "classes");
const NORMALIZED_FEATURES = join(IMPORTER_ROOT, "out", "class-features", "normalized.json");

/**
 * Baselines: cópia literal de MAGUS_PROFICIENCY_UPGRADES e
 * KINETICIST_PROFICIENCY_UPGRADES (transform.mjs, r10-B/r18-N2a) — o
 * comportamento em produção hoje.
 */
const BASELINE = {
  magus: [
    { level: 5, stat: "weapons.martial", rank: 2 },
    { level: 5, stat: "weapons.simple", rank: 2 },
    { level: 5, stat: "weapons.unarmed", rank: 2 },
    { level: 5, stat: "reflex", rank: 2 },
    { level: 9, stat: "perception", rank: 2 },
    { level: 9, stat: "spellcasting", rank: 2 },
    { level: 9, stat: "will", rank: 3 },
    { level: 11, stat: "armor.light", rank: 2 },
    { level: 11, stat: "armor.medium", rank: 2 },
    { level: 11, stat: "armor.unarmored", rank: 2 },
    { level: 13, stat: "weapons.simple", rank: 3 },
    { level: 13, stat: "weapons.martial", rank: 3 },
    { level: 13, stat: "weapons.unarmed", rank: 3 },
    { level: 15, stat: "fortitude", rank: 3 },
    { level: 17, stat: "spellcasting", rank: 3 },
    { level: 17, stat: "armor.light", rank: 3 },
    { level: 17, stat: "armor.medium", rank: 3 },
    { level: 17, stat: "armor.unarmored", rank: 3 },
  ],
  kineticist: [
    { level: 3, stat: "will", rank: 2 },
    { level: 7, stat: "fortitude", rank: 3 },
    { level: 7, stat: "classDC", rank: 2 },
    { level: 7, stat: "impulse", rank: 2 },
    { level: 9, stat: "perception", rank: 2 },
    { level: 11, stat: "weapons.simple", rank: 2 },
    { level: 11, stat: "weapons.unarmed", rank: 2 },
    { level: 13, stat: "armor.light", rank: 2 },
    { level: 13, stat: "armor.unarmored", rank: 2 },
    { level: 15, stat: "classDC", rank: 3 },
    { level: 15, stat: "impulse", rank: 3 },
    { level: 15, stat: "fortitude", rank: 4 },
    { level: 19, stat: "classDC", rank: 4 },
    { level: 19, stat: "impulse", rank: 4 },
    { level: 19, stat: "armor.light", rank: 3 },
    { level: 19, stat: "armor.unarmored", rank: 3 },
  ],
};

const features = JSON.parse(readFileSync(NORMALIZED_FEATURES, "utf8"));
const byName = new Map(features.map((d) => [d.name, d]));
const featureByName = (name) => byName.get(name);

let problemas = 0;

for (const [slug, cfg] of loadClassCuration()) {
  const items = classItemsMap(VENDOR_CLASSES, slug);
  const { upgrades, missing, ignoredRules } = deriveProficiencyUpgrades(
    items,
    featureByName,
    cfg,
    slug,
  );

  console.log(`\n=== ${cfg.displayName} (${slug}) ===`);
  console.log(
    `  items{} da classe: ${items.length} features | upgrades derivados: ${upgrades.length}`,
  );

  if (missing.length > 0) {
    problemas += 1;
    console.log(`  !! features do items{} sem doc correspondente: ${missing.join(", ")}`);
  }
  if (ignoredRules.length > 0) {
    console.log(`  ~~ rules de proficiência ignorados (reportados, não descartados):`);
    for (const ig of ignoredRules) {
      console.log(`     L${ig.level} ${ig.doc} → ${ig.stat}: ${ig.reasons.join("; ")}`);
    }
  }

  const baseline = BASELINE[slug];
  if (!baseline) {
    console.log("  (sem baseline: classe nova, nada a comparar)");
    for (const u of upgrades) console.log(`     L${u.level} ${u.stat} → ${u.rank}`);
    continue;
  }

  const d = diffUpgrades(upgrades, baseline);
  if (d.equal) {
    console.log("  ✓ derivação IDÊNTICA à tabela autoral em produção");
  } else {
    console.log("  ! divergência (cada linha precisa de explicação registrada na curadoria):");
    for (const k of d.onlyInA) console.log(`     + só na derivação: ${k}`);
    for (const k of d.onlyInB) console.log(`     - só na tabela autoral: ${k}`);
  }
}

process.exit(problemas > 0 ? 1 : 0);
