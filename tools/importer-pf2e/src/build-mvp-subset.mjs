/**
 * build-mvp-subset.mjs — Gera o SUBCONJUNTO MVP commitável de packs Fusion.
 *
 * Consome os documentos transformados (out/<pack>/transformed.json, ou
 * out/sf2e/<pack>/transformed.json para --system sf2e) e seleciona um
 * subconjunto curado para o MVP da primeira sessão jogável de cada sistema.
 *
 * Subconjunto pf2e (default):
 *   - pf2e.weapons-core:    ~30 armas básicas (ORC, dados mecânicos)
 *   - pf2e.conditions:      todas as 43 condições
 *   - pf2e.bestiary-core:   10 monstros de nível -1 a 3 (ORC)
 *   - pf2e.spells-core:     15 magias comuns level 1-3 (ORC)
 *
 * Subconjunto sf2e (--system sf2e, REQ-SF2-044..048):
 *   - sf2e.weapons-core:       ~30 armas nível 0 (analog + tech: arc/laser/
 *     plasma/automatic/area — cobre traits SF-exclusivos)
 *   - sf2e.armor-core:         ~10 armaduras nível 0
 *   - sf2e.augmentations-core: ~10 augmentações (equipment/usage:implanted)
 *   - sf2e.conditions:         as 3 condições SF-exclusivas (glitching,
 *     suppressed, untethered — type "effect", ver conditions.ts)
 *   - sf2e.bestiary-core:      ~10 criaturas de nível -1 a 3 (ORC), incl.
 *     robots/aliens para exercitar a allowlist de traits SF
 *   - sf2e.spells-core:        ~15 magias comuns nível 1-3 (ORC)
 *
 * Saída: systems/<systemId>/packs/<packSlug>/
 *   - documents.json  — array de documentos Fusion (commitável)
 *   - pack.json       — manifesto com licença ORC e metadados
 *
 * REQ-CMP-001..004, REQ-CMP-030..033, REQ-CMP-040..044, REQ-SF2-044..048.
 * Spec 16 §Formato de pack e armazenamento, §Pipeline §Versionamento.
 * Spec 18 §Compendium packs.
 *
 * Uso:
 *   node src/build-mvp-subset.mjs               # pf2e (default)
 *   node src/build-mvp-subset.mjs --system sf2e  # sf2e
 *
 * Zero dependências externas — Node 22 ESM puro.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// r21: a curadoria de classe é DADO (curation/classes/*.json), não predicado
// escrito à mão aqui. Ver curation/index.mjs e .fusion-build/r21-plan.md.
import { acharDuplicatas, formatarErroDeDuplicata } from './curation/duplicata.mjs';
import {
  axisCategoryByOtherTag,
  curatedClassDisplayNames,
  curatedClassFeatureNames,
  loadClassCuration,
} from "./curation/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, "..");
const OUT_DIR = join(IMPORTER_ROOT, "out");
const SYSTEMS_ROOT = join(IMPORTER_ROOT, "..", "..", "systems");
const PACKS_OUT_DIR = join(SYSTEMS_ROOT, "pf2e", "packs");
const SF2E_PACKS_OUT_DIR = join(SYSTEMS_ROOT, "sf2e", "packs");
/** Vendor pf2e packs root — used by R10-B to read magus.json's items{} map directly. */
const VENDOR_ROOT_FOR_MVP = join(IMPORTER_ROOT, "vendor", "pf2e", "packs", "pf2e");

const IMPORTER_VERSION = "0.1.0";
const SOURCE_VERSION = "v14-dev";

/**
 * textAttribution (W2-C1, follow-up #10 of the clean-room audit, REQ-LEG-010):
 * explains WHY committed packs now carry `system.description` prose (policy
 * update 2026-07-05 — the previous default zeroed every description
 * regardless of license) and under what two licenses that is permitted.
 * `system.publication.license` on each individual document (set by the
 * vendor, read by transform.mjs's stripFlavorProse) is the actual per-doc
 * gate; this string is a human-readable pointer to that mechanism plus the
 * Apache-2.0 attribution for the source repo the importer itself reads.
 */
const TEXT_ATTRIBUTION =
  "Item/spell/feat/class descriptions in this pack are reproduced from Paizo " +
  "rules text under the license declared in each document's system.publication.license " +
  '("ORC" or "OGL" only — see the Paizo Community Use Policy for the relevant license); ' +
  "documents without an ORC/OGL publication keep an empty description. The importer " +
  "pipeline itself is derived from github.com/foundryvtt/pf2e (Apache License 2.0).";

// ---------------------------------------------------------------------------
// Pack manifests (REQ-CMP-003/004/040)
// ---------------------------------------------------------------------------

/** @type {Record<string, import('../types.js').PackManifest>} */
const PACK_MANIFESTS = {
  "weapons-core": {
    id: "pf2e.weapons-core",
    label: "PF2e Core Weapons",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["system.level", "system.category", "system.traits.value", "system.damage"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  conditions: {
    id: "pf2e.conditions",
    label: "PF2e Conditions",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["system.group", "system.value.isValued"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "bestiary-core": {
    id: "pf2e.bestiary-core",
    label: "PF2e Core Bestiary",
    documentType: "Actor",
    systemId: "pf2e",
    indexFields: ["system.details.level.value", "system.traits.value", "system.attributes.hp.max"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Monster Core © 2024 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "spells-core": {
    id: "pf2e.spells-core",
    label: "PF2e Core Spells",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: [
      "system.level",
      "system.traits.value",
      "system.traits.traditions",
      "system.traits.rarity",
    ],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  // -------------------------------------------------------------------------
  // R10-B (DEC-R10-06) — Magus builder MVP subset. All six packs below share
  // the same ORC + foundryvtt/pf2e attribution as the packs above; mechanical
  // data only (prosa strippada via stripFlavorProse in transform.mjs), art
  // replaced by placeholders (normalize.mjs, policy-wide).
  // -------------------------------------------------------------------------
  "classes-core": {
    id: "pf2e.classes-core",
    label: "PF2e Core Classes",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.keyAbility", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "class-features-core": {
    id: "pf2e.class-features-core",
    label: "PF2e Core Class Features",
    documentType: "Item",
    systemId: "pf2e",
    // 'system.traits.otherTags' is indexed so the Plan column's Hybrid
    // Study picker (R10-D item D2) can filter the compendium SEARCH INDEX
    // (PackIndexEntry.index) for the "magus-hybrid-study" marker without a
    // full getDocument() round-trip per candidate — see
    // characterSheetVM-sibling planVM.ts's isHybridStudyOption().
    indexFields: [
      "name",
      "system.level",
      "system.category",
      "system.traits.value",
      "system.traits.otherTags",
    ],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "feats-core": {
    id: "pf2e.feats-core",
    label: "PF2e Core Feats",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.level", "system.category", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "ancestries-core": {
    id: "pf2e.ancestries-core",
    label: "PF2e Core Ancestries",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.traits.value", "system.size"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "heritages-core": {
    id: "pf2e.heritages-core",
    label: "PF2e Core Heritages",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.ancestry.slug", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "backgrounds-core": {
    id: "pf2e.backgrounds-core",
    label: "PF2e Core Backgrounds",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  // -------------------------------------------------------------------------
  // W2 (Actions tab, r11-follow-up) — pf2e.actions-core. Curated by physical
  // vendor subfolder (system.fusionCategory, injected in normalize.mjs) over
  // the FULL "actions" vendor pack — every tabletop-relevant category kept,
  // subsystem/vehicle/aftermath/campaign/adventure-specific noise excluded
  // (see ACTIONS_CORE_INCLUDED_CATEGORIES below). Same ORC/OGL clean-room
  // policy as every other -core pack (stripFlavorProse/stripRuleProse in
  // transform.mjs; placeholders only, never Paizo art).
  // -------------------------------------------------------------------------
  "actions-core": {
    id: "pf2e.actions-core",
    label: "PF2e Core Actions",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: [
      "name",
      "system.actionType",
      "system.actions",
      "system.category",
      "system.fusionCategory",
      "system.traits.value",
    ],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  // -------------------------------------------------------------------------
  // G4 (Pets tab, r16) — pf2e.familiar-abilities-core. The FULL vendor
  // `familiar-abilities/` pack (type "action" / category "familiar") — every
  // ability is a candidate for the sheet's daily-ability picker, so no
  // curation predicate is applied. Same ORC clean-room policy as every other
  // -core pack (stripFlavorProse gates description prose on
  // publication.license; placeholders only, never Paizo art). Spec 29
  // REQ-PET-020.
  // -------------------------------------------------------------------------
  "familiar-abilities-core": {
    id: "pf2e.familiar-abilities-core",
    label: "PF2e Core Familiar Abilities",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.actionType", "system.category", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  // -------------------------------------------------------------------------
  // r18-N2d — pf2e.equipment-core. Physical gear for Finn (Kineticist 3):
  // his named magic items/consumables plus a lean adventurer's-gear subset.
  // Fixed source-id list (same pattern as MVP_WEAPON_PF2E_IDS above), curated
  // from out/equipment/transformed.json. Mixed document types (armor,
  // equipment, consumable, container) — every type has a Zod schema in
  // systems/pf2e/src/schemas/item-armor.ts / item-equipment.ts.
  // -------------------------------------------------------------------------
  "equipment-core": {
    id: "pf2e.equipment-core",
    label: "PF2e Core Equipment",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.level", "system.traits.value", "system.category", "system.usage"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  // -------------------------------------------------------------------------
  // r20-X5 — pf2e.ancestry-features-core. The FULL vendor `ancestry-features/`
  // pack (55 docs, every one `type: "feat"` with `system.category:
  // "ancestryfeature"` and an ORC or OGL publication). These are the
  // auto-conceded ancestry/heritage FEATURES referenced by an ABC doc's
  // `system.items` map — e.g. Fleshwarp → Unusual Anatomy, Ratfolk → Sharp
  // Teeth. Before this pack existed those chips could not materialize (the
  // client's mapVendorToFusionPack pointed `ancestryfeatures` at
  // class-features-core, which never holds them), so they rendered as
  // informative-only chips with no description/mechanics.
  //
  // No curation predicate (whole pack, same philosophy as
  // familiar-abilities-core): every ancestry feature is a candidate grant for
  // some ancestry/heritage, all 55 are cheap and cleanly ORC/OGL-licensed, and
  // shipping the whole pack means any future ancestry added to ancestries-core
  // resolves its features for free. Same clean-room policy as every other
  // -core pack (stripFlavorProse gates description prose on publication.license;
  // placeholders only, never Paizo art). Type "feat" → parseFeatSystem
  // validates it in packs-validation (no new parser needed).
  // -------------------------------------------------------------------------
  "ancestry-features-core": {
    id: "pf2e.ancestry-features-core",
    label: "PF2e Core Ancestry Features",
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["name", "system.category", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
};

/**
 * r20-X5 — Aeronaut background free-feat curation (Lacuna 2).
 *
 * The vendor Aeronaut background (backgrounds/aeronaut.json, Pathfinder
 * Battlecry!, ORC) ships `system.items: {}` and `system.rules: []` — genuinely
 * EMPTY, so the importer is not dropping anything (verified against the raw
 * vendor doc). But the same doc's own `system.description` explicitly grants a
 * feat via a Foundry enricher:
 *
 *   "You gain the @UUID[Compendium.pf2e.feats-srd.Item.Assurance] skill feat
 *    with Piloting Lore."
 *
 * That @UUID is the authoritative source for the ONE feat this background
 * concedes — Assurance (feats-srd, skill, level 1, ORC), the SAME shape as
 * Fireworks Performer → Fascinating Performance (the correct comparison). We
 * inject exactly that entry into the transformed doc's `system.items` map so
 * the client's r20-X4 grant materializer (parseSystemItemsGrants →
 * mapVendorToFusionPack("feats-srd") → feats-core) concedes it automatically.
 *
 * NOT added: "Powerful Leap". Despite appearing in the user's Pathbuilder
 * export for Finn, it is NOT a benefit of the Aeronaut background — the
 * official Battlecry! text (and this vendor description) grant only Assurance.
 * Powerful Leap is a level-based skill-feat SELECTION in Finn's build (a normal
 * skill-feat slot), not an ABC auto-grant; adding it here would incorrectly
 * concede it to every Aeronaut character. See r20-X5 report.
 */
const AERONAUT_CURATED_ITEMS = {
  // Short vendor-style map key (arbitrary, matches the {5-char} shape Foundry
  // uses for the Fireworks Performer entry). The uuid is the authoritative
  // grant target read from the vendor Aeronaut description's @UUID enricher.
  assur: {
    img: "icons/placeholder/feat.svg",
    level: 1,
    name: "Assurance",
    uuid: "Compendium.pf2e.feats-srd.Item.Assurance",
  },
};

/**
 * pf2e.actions-core curation (W2, r11-follow-up): vendor `actions/` physical
 * subfolders to INCLUDE, keyed by the `system.fusionCategory` value injected
 * in normalize.mjs. Every tabletop-relevant category is kept; excluded:
 * "subsystems", "vehicles", "aftermath", "campaign" (subsystem/vehicle rules
 * and adventure-specific actions — noise for a general-purpose Actions tab).
 */
const ACTIONS_CORE_INCLUDED_CATEGORIES = new Set([
  "basic",
  "skill",
  "exploration",
  "downtime",
  "class",
  "equipment",
  "ancestry",
  "archetype",
  "background",
  "familiar",
  "heritage",
  "spells",
  "stamina",
  "mythic",
]);

/** True when a transformed action doc's fusionCategory is in the curated set. */
function isActionsCoreDoc(doc) {
  return ACTIONS_CORE_INCLUDED_CATEGORIES.has(doc.system?.fusionCategory);
}

// ---------------------------------------------------------------------------
// MVP weapon selection — ~30 armas básicas curadas
// fusionIds pré-calculados (derivados de base62_16(sha1(packName + ":" + pf2eId)))
// pf2eIds da análise 05-id-compat.md / dados da normalização.
// ---------------------------------------------------------------------------

/** pf2eSourceIds das armas selecionadas para o MVP (curadas da análise). */
const MVP_WEAPON_PF2E_IDS = new Set([
  // Simple weapons — melee
  "rQWaJhI5Bko5x14Z", // Dagger
  "c58wczIzH2gzeXQL", // Club
  "tOhoGvmCMw4JpWcS", // Spear
  "5fu6dCtqhdBnHNqh", // Morningstar
  "LGgvev6AV0So8tP9", // Hatchet
  "JNt7GmLCCVz5BiEI", // Javelin
  "Tt4Qw64fwrxhr5gT", // Dart
  "UCH4myuFnokGv0vF", // Sling
  "FVjTuBCIefAgloUU", // Staff
  // Martial weapons — melee
  "LJdbVTOZog39EEbi", // Longsword
  "7tKkkF8eZ4iCLJtp", // Shortsword
  "tH5GirEy7YB3ZgCk", // Rapier
  "t5FbyZtRL4qV0V7k", // Flail
  "rXt4629QSg7KDTgJ", // Warhammer
  "mlrmkpOlwpnGkw4I", // Maul
  "8COlYvHe6hKCXY8x", // Greataxe
  "UX71GkWBL9g41VwM", // Greatsword
  "War0uyLBx1jA0Ge7", // Battle Axe
  "FJrsDoaIXksVjld9", // Trident
  "hMYdSFmMWzidzHih", // Bo Staff
  "TDrO7Xdyn7juFy3c", // Kukri
  "f1gwoTkf3Nn0v3PN", // Whip
  "6KWYmeRMxsQfWhhJ", // Bastard Sword
  // Ranged
  "hIgqLgH3YcLZBeoT", // Shortbow
  "MVAWttmT0QDa7LsV", // Longbow
  "62nnVQvGhoVLLl2K", // Crossbow
  "e4NwsnPnpQKbDZ9F", // Composite Shortbow
  "dUC8Fsa6FZtVikS3", // Composite Longbow
  "XyA6PKV46aNlLXOd", // Hand Crossbow
  // Unarmed / natural
  // (include one advanced to round out)
  "oSQET5hKn9q4xlrl", // Gnome Flickmace (advanced)
]);

/** pf2eSourceIds das magias selecionadas para o MVP. */
const MVP_SPELL_PF2E_IDS = new Set([
  // Level 1 cantrips / rank 1
  "kBhaPuzLUSwS6vVf", // Electric Arc (L1)
  "gpzpAAAJ1Lza2JVl", // Detect Magic (L1)
  "izcxFQFwf3woCnFs", // Guidance (L1)
  "WBmvzNDfpwka3qT4", // Light (L1)
  "TVKNbcgTee19PXZR", // Shield (L1)
  "4gBIw4IDrSfFHik4", // Daze (L1)
  "SnjhtQYexDtNDdEg", // Stabilize (L1)
  "rfZpqmj0AIIdkVIs", // Heal (L1)
  "wdA52JJnsuQWeyqz", // Harm (L1)
  "4koZzrnMXhhosn0D", // Fear (L1)
  "jfVCuOpzC6mUrf6f", // Hydraulic Push (L1)
  "IxhGEKl63R4QBvkj", // Frostbite (L1)
  "6DfLZBl8wKIV03Iq", // Ignition (L1)
  // Level 2
  "XXqE1eY3w3z6xJCB", // Invisibility (L2)
  "4GE2ZdODgIQtg51c", // Darkness (L2)
  "9HpwDN4MYQJnW0LG", // Dispel Magic (L2)
  // Level 3
  "sxQZ6yqTn0czJxVd", // Fireball (L3)
  "9AAkVUCwF6WVNNY2", // Lightning Bolt (L3)
  "o6YCGx4lycsYpww4", // Haste (L3)
  "WsUwpfmhKrKwoIe3", // Slow (L3)
  "KqvqNAfGIE5a9wSv", // Heroism (L3)
  // Level 4
  "A2JfEKe6BZcTG1S8", // Fly (L4)
]);

/**
 * pf2eSourceIds do equipamento curado do Finn (r18-N2d) — pf2e.equipment-core.
 * Fonte: vendor/pf2e/packs/pf2e/equipment/*.json (out/equipment/transformed.json
 * após o fix do normalizer de armor/backpack — ver normalizeArmorSystem /
 * normalizeEquipmentSystem em transform.mjs).
 *
 * Itens do dossiê:
 *   - Elven Chain (Standard-Grade): type "armor" — REs: nenhuma (item passivo,
 *     AC bonus via acBonus/runes).
 *   - Gate Attenuator: type "equipment" — RE FlatModifier(+1, impulse-attack-roll,
 *     predicate class:kineticist|feat:kineticist-dedication) PRESERVADA.
 *     Finn tem 2 (quantity ajustada na curadoria, não duas tiers diferentes).
 *   - Boots of Bounding: type "equipment" — REs FlatModifier(+5, land-speed) +
 *     FlatModifier(+2, athletics, predicate high-jump|long-jump) PRESERVADAS
 *     (provável origem do deslocamento 30 do Finn).
 *   - Cantrip Deck (Full Pack): type "consumable".
 *   - Everlight Crystal: type "equipment".
 *   - Spacious Pouch (Type I): type "backpack" -> Fusion "container" (bugfix).
 *   - Healing Potion (Lesser): type "consumable".
 *   - Antivenom Potion: type "consumable" (nome exato do vendor; dossiê dizia
 *     "Antivenom").
 *   - Purifying Spoon (Teaspoon): type "equipment" — variante base (nível 1);
 *     o dossiê não especifica ladle/tablespoon/teaspoon, teaspoon é a mais barata.
 *   - Rhythm Bone: type "equipment" — variante base (não "greater").
 *   - Sanitizing Pin: type "consumable".
 *   - Serum of Sex Shift: type "consumable".
 * Subset de aventureiro (ORC, vendor/pf2e/packs/pf2e/equipment/):
 *   Rope, Torch, Rations, Waterskin, Bedroll, Flint and Steel — todos type
 *   "equipment"/"consumable" já suportados. "Adventurer's Pack" NÃO incluído:
 *   vendor type "kit" (bundle de itens aninhados) não tem schema/normalizer
 *   Fusion ainda — fora do escopo deste batch (armor/backpack apenas).
 */
const MVP_EQUIPMENT_PF2E_IDS = new Set([
  "peAvz7u35GEfTXxp", // Elven Chain (Standard-Grade) — armor
  "ioiMUDqv85BI4shY", // Gate Attenuator — equipment (impulse-attack-roll +1)
  "ecqz1iUGtyQEkZwy", // Boots of Bounding — equipment (land-speed +5, athletics +2)
  "xTdrhiLqFYUllrpK", // Cantrip Deck (Full Pack) — consumable
  "mRz8Jmk4Q06SsZpC", // Everlight Crystal — equipment
  "jaEEvuQ32GjAa8jy", // Spacious Pouch (Type I) — backpack -> container
  "e0vSAQfxhHauiAoD", // Healing Potion (Lesser) — consumable
  "N3jcmW5XzEJZQVtJ", // Antivenom Potion — consumable
  "nbRNjXYEx6T0G8AW", // Purifying Spoon (Teaspoon, base variant) — equipment [see note below]
  "geAAUwfmOc5U0qOE", // Rhythm Bone (base) — equipment
  "gi1zuwWrwcW7OKlK", // Sanitizing Pin — consumable
  "9ignmYCACjfzkxDQ", // Serum of Sex Shift — consumable
  // Adventurer's-gear subset (obvious, ORC-licensed loose items)
  "fyYnQf1NAx9fWFaS", // Rope — equipment
  "8Jdw4yAzWYylGePS", // Torch — equipment
  "L9ZV076913otGtiB", // Rations — consumable
  "VnPh324pKwd2ZB66", // Waterskin — equipment
  "fagzYdmfYyMQ6J77", // Bedroll — equipment
  "UlIxxLm71UdRgCFE", // Flint and Steel — equipment
]);

/** pf2eSourceIds dos monstros selecionados para o MVP. */
const MVP_MONSTER_PF2E_IDS = new Set([
  // Level -1 (starter encounters)
  "trchDxbDR2TiPMxT", // Skeleton Guard
  "fLLKuOXwPq1Iq0U4", // Goblin Warrior
  "KHTYbQgR5hnFZdGL", // Guard Dog
  "BIZfjoz8DZt75EDn", // Kobold Warrior
  "iIJPJcDT8wlJ8z5M", // Giant Rat
  "Xo4IGzw28hivgMmM", // Zombie Shambler
  "WBPEvEqIGvxeQKlp", // Eagle
  // Level 0
  "YReM6QbqwUz3UTP7", // Orc Scrapper
  "v1UK3IwCB8wCbL3L", // Leaf Leshy
  "Ytp0kRaG8iexmPfN", // Hryngar Sharpshooter
  // Level 1+
  // (add a few more interesting ones from L1-3)
]);

// ---------------------------------------------------------------------------
// R10-B (DEC-R10-06) — Magus builder MVP subset selection.
//
// Unlike the weapons/spells/monsters curation above (fixed source-id sets,
// hand-picked one at a time), classes/class-features/feats/ancestries/
// heritages/backgrounds are curated by DECLARATIVE PREDICATE over
// transformed Fusion docs (traits/category/level) — the selection rules are
// stable facts about the Magus + Ratfolk + Fireworks Performer build (DEC-R10-06)
// and are far more legible/maintainable as predicates than as a fixed list of
// hundreds of 16-char source ids (feats-core alone selects 400+ docs).
// Every predicate below was validated against the real transformed data
// during R10-B curation (see BUILD-LOG r10 entry) — counts are asserted in
// the build's console summary and in the importer test suite.
// ---------------------------------------------------------------------------

/** True when a Fusion doc's system.traits.value array contains `trait`. */
function hasTrait(doc, trait) {
  return Array.isArray(doc.system?.traits?.value) && doc.system.traits.value.includes(trait);
}

/** True when a Fusion doc's system.traits.traditions array contains `tradition`. */
function hasTradition(doc, tradition) {
  return (
    Array.isArray(doc.system?.traits?.traditions) &&
    doc.system.traits.traditions.includes(tradition)
  );
}

/**
 * feats-core selection (DEC-R10-06 item 3):
 *   - ALL Magus class feats (trait "magus" + category "class") — includes
 *     the class's own 51 exclusive feats plus shared-class-feats it's
 *     eligible for (Familiar, Cantrip Expansion, Enhanced Familiar,
 *     Reactive Strike carry "magus" in their multi-class traits list) — 55 total.
 *   - ALL Ratfolk ancestry feats (trait "ratfolk" + category "ancestry") — 26.
 *   - Skill feats level <= 8 (category "skill") — includes every acceptance-
 *     criterion feat from the Tobias build (Impressive Performance, Read
 *     Lips, Tinkering Fingers is actually ancestry-categorized — see below —
 *     Alchemical Crafting, Fascinating Performance).
 *   - General feats level <= 8 (category "general").
 *   - Alchemist Dedication (category "class", traits archetype+dedication;
 *     the vendor files dedication feats under category "class", NOT
 *     "archetype") + its two level-4 archetype feats (Advanced Alchemy,
 *     Basic Concoction — identified by an "Alchemist Dedication" prerequisite,
 *     since dedication feats don't carry the class name as a trait).
 * Tinkering Fingers is a Ratfolk ANCESTRY feat (category "ancestry"), already
 * covered by the ratfolk-ancestry-feats predicate above — it does not need
 * its own special-case.
 */
/**
 * Traits de ancestralidade/heranca cujos ancestry feats entram no pack.
 * Derivado do que JA esta em ancestries-core/heritages-core: trazer a
 * ancestralidade sem os feats dela deixa o slot de talento de ancestralidade
 * vazio na ficha.
 */
const CURATED_ANCESTRY_TRAITS = ["ratfolk", "fleshwarp", "sylph"];

function isFeatsCoreDoc(doc) {
  if (doc.type !== "feat") return false;
  const category = doc.system?.category;
  const level = doc.system?.level ?? 0;

  // --- r21: class feats das classes CURADAS (dado, não código) ---
  // Um doc que satisfaça duas classes entra UMA vez (isto é um filtro sobre
  // um único array; satisfazer dois ramos não duplica o documento). Feat de
  // shared-class-feats carrega o trait de várias classes — é o mesmo doc.
  if (category === "class") {
    for (const cfg of loadClassCuration().values()) {
      const rule = cfg.classFeats;
      if (!hasTrait(doc, rule.trait)) continue;
      if (level > rule.levelMax) continue;
      if (rule.requireTraitsAll.length > 0 && !rule.requireTraitsAll.every((t) => hasTrait(doc, t)))
        continue;
      if (rule.requireTraitsAny.length > 0 && !rule.requireTraitsAny.some((t) => hasTrait(doc, t)))
        continue;
      if (rule.excludeNames.includes(doc.name)) continue;
      return true;
    }
  }

  // r21: ancestry feats de TODA ancestralidade/heranca curada. Antes era uma
  // lista literal por nome (ratfolk, sylph) e o Fleshwarp — que ESTA no pack de
  // ancestralidades desde a r18 — ficou sem nenhum feat proprio. A varredura
  // headless pegou: "Fleshwarp nao tem ancestry feat em todo nivel de marco".
  if (category === "ancestry" && CURATED_ANCESTRY_TRAITS.some((t) => hasTrait(doc, t))) return true;
  if (category === "skill" && level <= 8) return true;
  if (category === "general" && level <= 8) return true;
  if (doc.name === "Alchemist Dedication") return true;
  if (hasTrait(doc, "archetype") && level <= 4) {
    const prereqText = JSON.stringify(doc.system?.prerequisites ?? []).toLowerCase();
    if (prereqText.includes("alchemist")) return true;
  }

  // (r18-N2a: a janela de impulsos Ar+Metal ≤4 do Kineticist migrou para
  // `curation/classes/kineticist.json` — requireTraitsAll/Any — e é aplicada
  // pelo laço de classes curadas acima.)
  // Sylph versatile-heritage ancestry feats (trait "sylph"), e.g. Wind Pillow.

  // Rogue Free-Archetype dedication chain: the dedication itself plus its
  // level<=4 follow-up archetype feats (Surprise Attack etc.), identified by a
  // "Rogue Dedication" prerequisite (dedication feats file under category
  // "class" and don't carry the class name as a trait — same shape as the
  // Alchemist branch above).
  if (doc.name === "Rogue Dedication") return true;
  if (hasTrait(doc, "archetype") && level <= 4) {
    const prereqText = JSON.stringify(doc.system?.prerequisites ?? []).toLowerCase();
    if (prereqText.includes("rogue dedication")) return true;
  }
  return false;
}

/**
 * spells-core selection (DEC-R10-06 item 5, EXPANDED — same pack id as the
 * original 22-spell MVP curation above, to avoid duplicating the same doc
 * under two different fusionId namespaces): the original 22 hand-picked
 * spells (kept verbatim — 5 of them are divine/primal only, e.g. Heal, not
 * arcane, but were part of the pre-R10 MVP and the plan says "mantenha os 22
 * atuais") UNION every spell with "arcane" in traits.traditions (all ranks +
 * cantrips) UNION EVERY focus spell (trait "focus").
 *
 * BUGFIX (r12 blocker): the previous predicate only pulled in Magus focus
 * spells via `hasTrait(doc, 'magus')`, which is 12 of the vendor's 458 focus
 * spells (all in vendor/pf2e/packs/pf2e/spells/focus/). Focus spells cast
 * from a class's focus POOL, not from a spellcasting tradition, so they carry
 * an EMPTY `system.traits.traditions` — the `hasTradition(doc, 'arcane')`
 * branch never matched them and the other 446 (cleric/druid/bard/sorcerer/
 * etc. focus spells) were silently dropped. The sheet's focus-spell picker
 * filters the pack by the `focus` TRAIT, so it returned an empty list. The
 * `hasTrait(doc, 'focus')` branch below is the canonical, class-agnostic
 * selector — every focus spell in the compendium is now present (the 12
 * Magus ones already carry both `focus` AND `magus`, so this is a strict
 * superset; no doc is duplicated).
 *
 * Rituals (vendor/pf2e/packs/pf2e/spells/rituals/, 150 docs, also `type:
 * "spell"`) carry neither `arcane` tradition nor the `focus` trait, so they
 * stay excluded — the "sem rituals (V2)" requirement holds without an extra
 * filter.
 */
function isSpellsCoreDoc(doc, existingSourceIds) {
  const sourceId = doc.flags?.fusion?.sourceId;
  if (sourceId && existingSourceIds.has(sourceId)) return true;
  if (hasTradition(doc, "arcane")) return true;
  if (hasTrait(doc, "focus")) return true;
  return false;
}

/**
 * class-features-core selection (DEC-R10-06 item 2): every class-feature
 * referenced by the Magus's own vendor items{} map (19 features — resolved
 * by display name via the same uuid-trailing-segment convention transform.mjs
 * uses for ClassSystem.featuresByLevel, see classFeatureNameFromUuid/
 * resolveClassFeatureSourceId there) UNION every Magus Hybrid Study choice
 * (category "hybridStudy" — 8 studies, tagged by transform.mjs from the
 * vendor's traits.otherTags:["magus-hybrid-study"] marker).
 */
function buildClassFeatureNameSet() {
  // r21: união dos `items{}` de TODAS as classes curadas. Feature
  // compartilhada (Shield Block em 7 classes, Weapon Specialization em 25)
  // entra uma vez só — é um Set. Ver curation/index.mjs.
  return curatedClassFeatureNames(join(VENDOR_ROOT_FOR_MVP, "classes"));
}

function isClassFeaturesCoreDoc(doc, classFeatureNames, axisCategories) {
  if (doc.type !== "classFeature") return false;
  if (classFeatureNames.has(doc.name)) return true;
  // r21: as opções de eixo de sub-escolha (Instinct, Racket, Hunter's Edge,
  // Arcane Thesis/School, Hybrid Study) NÃO estão no items{} da classe — o
  // vendor as marca por traits.otherTags e o ChoiceSet as resolve em runtime.
  // Sem este ramo, a classe entra com o chip da escolha e NENHUMA opção para
  // escolher. As categorias vêm da curadoria, não de lista escrita à mão.
  if (axisCategories.has(doc.system?.category)) return true;
  return false;
}

/** ancestries-core (DEC-R10-06 item 4; r18-N2a): Ratfolk (Magus) + Fleshwarp (Finn). */
function isAncestriesCoreDoc(doc) {
  return doc.type === "ancestry" && (doc.name === "Ratfolk" || doc.name === "Fleshwarp");
}

/**
 * heritages-core (DEC-R10-06 item 4; r18-N2a): the 7 Ratfolk heritages
 * (identified by `system.ancestry.slug === 'ratfolk'` — the real vendor
 * linkage field; heritage names alone don't carry a "ratfolk" trait) PLUS the
 * Sylph versatile heritage (Finn). Versatile heritages carry NO ancestry
 * linkage (`system.ancestry === null`) and are keyed by the ancestry-agnostic
 * trait matching their own name, so they're selected here by explicit name.
 */
function isHeritagesCoreDoc(doc) {
  if (doc.type !== "heritage") return false;
  if (doc.system?.ancestry?.slug === "ratfolk") return true;
  if (doc.name === "Sylph") return true;
  return false;
}

/** backgrounds-core (DEC-R10-06 item 4; r18-N2a): Fireworks Performer (Magus) + Aeronaut (Finn). */
function isBackgroundsCoreDoc(doc) {
  return (
    doc.type === "background" && (doc.name === "Fireworks Performer" || doc.name === "Aeronaut")
  );
}

/** classes-core (DEC-R10-06 item 1; r18-N2a): Magus (r10-B) + Kineticist (Finn). */
function isClassesCoreDoc(doc) {
  return doc.type === "class" && curatedClassDisplayNames().has(doc.name);
}

// ---------------------------------------------------------------------------
// Build pack documents
// ---------------------------------------------------------------------------

/**
 * @param {string} packName
 * @param {'pf2e'|'sf2e'} [system]
 */
function loadTransformed(packName, system = "pf2e") {
  const base = system === "pf2e" ? OUT_DIR : join(OUT_DIR, system);
  const path = join(base, packName, "transformed.json");
  if (!existsSync(path)) {
    throw new Error(
      `transformed.json not found for pack "${packName}" (system: ${system}). Run transform.mjs first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Filters transformed docs to the MVP subset.
 * Uses flags.fusion.sourceId to match original pf2e/sf2e IDs.
 */
function filterToMvpSubset(docs, selectedPf2eIds) {
  return docs.filter((doc) => {
    const sourceId = doc.flags?.fusion?.sourceId;
    return sourceId && selectedPf2eIds.has(sourceId);
  });
}

/**
 * Writes pack documents and manifest to systems/<systemId>/packs/<slug>/.
 * REQ-CMP-003/004/030.
 * @param {string} slug
 * @param {object[]} docs
 * @param {object} manifest
 * @param {string} [packsOutDir] — defaults to PACKS_OUT_DIR (pf2e)
 */
// ---------------------------------------------------------------------------
// Portão de duplicata semântica (r21)
//
// Regra do usuário, literal: "documentos de mesmo nome, se forem a mesma
// coisa, devem ser unificados. Sempre." Este portão é essa regra aplicada por
// máquina, para não depender de alguém reparar.
//
// O critério de "mesma coisa" é conteúdo, não nome: mesmo NOME normalizado +
// mesmo TYPE + mesma DESCRIÇÃO normalizada (sem HTML, sem espaço variável).
// Se os três baterem, são o mesmo documento em dois lugares — duplicata — e a
// geração FALHA.
//
// O que este portão deliberadamente NÃO acusa, porque não é duplicata:
// homônimos em que um documento CONCEDE o outro. É o padrão dominante do
// PF2e e vale para os 39 pares de nome repetido medidos hoje:
//
//   class-features-core "Shield Block"  = "You gain the Shield Block general
//                                         feat" (passivo, com grant-item)
//   feats-core          "Shield Block"  = a reação em si (Trigger, reduz dano
//                                         até a Hardness do escudo)
//
// Unificar esse par destruiria uma das duas metades: ou a classe deixa de
// conceder, ou a habilidade deixa de existir. Mesmo padrão em Rage, Reactive
// Strike, Hunt Prey, Spellstrike (feature → ação) e em Force Fang, Heal
// Companion (feat → magia de foco).
// ---------------------------------------------------------------------------

const _docsEmitidos = [];

/** Registra os docs de um pack para o portão rodar sobre o conjunto todo. */
function registrarParaPortaoDeDuplicata(slug, docs) {
  for (const doc of docs) {
    _docsEmitidos.push({
      pack: slug,
      name: doc.name,
      type: doc.type,
      description: doc.system?.description,
      sourceId: doc.flags?.fusion?.sourceId,
    });
  }
}

/** Falha a geração se dois documentos forem a mesma coisa. */
function portaoDeDuplicataSemantica() {
  const grupos = acharDuplicatas(_docsEmitidos);
  if (grupos.length === 0) {
    console.log(
      `[build-mvp] portão de duplicata: OK — ${_docsEmitidos.length} documentos, nenhum par com mesmo nome+tipo+descrição.`,
    );
    return;
  }
  throw new Error(`[build-mvp] ${formatarErroDeDuplicata(grupos)}`);
}

function writePack(slug, docs, manifest, packsOutDir = PACKS_OUT_DIR) {
  registrarParaPortaoDeDuplicata(slug, docs);
  const packDir = join(packsOutDir, slug);
  mkdirSync(packDir, { recursive: true });

  // Finalize manifest with counts
  const finalManifest = {
    ...manifest,
    documentCount: docs.length,
    generatedAt: new Date().toISOString(),
  };

  // Write pack.json (REQ-CMP-003)
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(finalManifest, null, 2), "utf8");

  // Write documents.json (commitável — formato JSON array)
  // In the full pipeline this would be a pack.db (SQLite), but for the MVP
  // commitável subset we use JSON. The server loads this via PackLoader.
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(docs, null, 2), "utf8");

  const relBase = packsOutDir === SF2E_PACKS_OUT_DIR ? "systems/sf2e/packs" : "systems/pf2e/packs";
  console.log(`[build-mvp] ${slug}: ${docs.length} docs → ${relBase}/${slug}/`);
  return finalManifest;
}

/**
 * Builds an index entry per document for lazy loading.
 * REQ-CMP-007.
 */
function buildIndex(packId, docs, indexFields) {
  return docs.map((doc) => {
    const indexData = {};
    for (const field of indexFields) {
      // Resolve nested path like "system.level"
      const parts = field.split(".");
      let value = doc;
      for (const part of parts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      if (value !== undefined) indexData[field] = value;
    }
    return {
      _id: doc._id,
      uuid: `Compendium.${packId}.${doc.type === "npc" ? "Actor" : "Item"}.${doc._id}`,
      name: doc.name,
      img: doc.img ?? null,
      type: doc.type ?? null,
      index: indexData,
    };
  });
}

// ---------------------------------------------------------------------------
// Main — pf2e
// ---------------------------------------------------------------------------

async function buildPf2eSubset() {
  console.log("[build-mvp] Gerando subconjunto MVP de packs Fusion (pf2e)...\n");
  mkdirSync(PACKS_OUT_DIR, { recursive: true });

  const report = {
    packs: [],
    generatedAt: new Date().toISOString(),
    importerVersion: IMPORTER_VERSION,
    sourceVersion: SOURCE_VERSION,
  };

  // --- 1. Conditions (all 43) ---
  {
    console.log("[build-mvp] === Pack: conditions ===");
    const all = loadTransformed("conditions");
    const docs = all; // All conditions included
    const manifest = PACK_MANIFESTS["conditions"];
    const finalManifest = writePack("conditions", docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "conditions", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );

    report.packs.push({ packId: manifest.id, slug: "conditions", documentCount: docs.length });
  }

  // --- 2. Weapons core (~30 curadas) ---
  {
    console.log("[build-mvp] === Pack: weapons-core ===");
    const all = loadTransformed("equipment");
    const weapons = all.filter((d) => d.type === "weapon");
    const docs = filterToMvpSubset(weapons, MVP_WEAPON_PF2E_IDS);
    console.log(`[build-mvp] weapons-core: ${docs.length} selecionadas de ${weapons.length} armas`);

    const manifest = PACK_MANIFESTS["weapons-core"];
    const finalManifest = writePack("weapons-core", docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "weapons-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );

    report.packs.push({ packId: manifest.id, slug: "weapons-core", documentCount: docs.length });
  }

  // --- 3. Core Bestiary (~10 monstros) ---
  {
    console.log("[build-mvp] === Pack: bestiary-core ===");
    const all = loadTransformed("pathfinder-monster-core");
    const monsters = all.filter((d) => d.type === "npc");
    const curated = filterToMvpSubset(monsters, MVP_MONSTER_PF2E_IDS);

    // Supplement with additional L1-3 ORC monsters to reach ~10 total
    const alreadySelected = new Set(curated.map((d) => d._id));
    const supplemental = monsters
      .filter((m) => !alreadySelected.has(m._id))
      .filter((m) => {
        const level = m.system?.details?.level?.value ?? 0;
        const pub = m.system?.details?.publication?.license;
        return pub === "ORC" && level >= 1 && level <= 3;
      })
      .sort(
        (a, b) => (a.system?.details?.level?.value ?? 0) - (b.system?.details?.level?.value ?? 0),
      )
      .slice(0, Math.max(0, 10 - curated.length));

    const docs = [...curated, ...supplemental];
    console.log(`[build-mvp] bestiary-core: ${docs.length} monstros selecionados`);

    const manifest = PACK_MANIFESTS["bestiary-core"];
    const finalManifest = writePack("bestiary-core", docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "bestiary-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );

    report.packs.push({ packId: manifest.id, slug: "bestiary-core", documentCount: docs.length });
  }

  // --- 4. Core Spells — EXPANDED (R10-B, DEC-R10-06 item 5) ---
  // Original 22 hand-picked spells UNION every arcane-tradition spell (all
  // ranks + cantrips) UNION every Magus focus spell. Same pack id as the
  // pre-R10 MVP curation (no doc duplication across packs).
  {
    console.log("[build-mvp] === Pack: spells-core (expandido — R10-B) ===");
    const all = loadTransformed("spells");
    const original22 = filterToMvpSubset(all, MVP_SPELL_PF2E_IDS);
    const existingSourceIds = new Set(original22.map((d) => d.flags.fusion.sourceId));
    const docs = all.filter((d) => isSpellsCoreDoc(d, existingSourceIds));
    const focusCount = docs.filter(
      (d) => Array.isArray(d.system?.traits?.value) && d.system.traits.value.includes("focus"),
    ).length;
    console.log(
      `[build-mvp] spells-core: ${docs.length} magias selecionadas (22 originais + arcane + ${focusCount} focus) de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["spells-core"];
    writePack("spells-core", docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "spells-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );

    report.packs.push({ packId: manifest.id, slug: "spells-core", documentCount: docs.length });
  }

  // --- 5. Classes core (R10-B, DEC-R10-06 item 1: Magus only) ---
  {
    console.log("[build-mvp] === Pack: classes-core ===");
    const all = loadTransformed("classes");
    const docs = all.filter(isClassesCoreDoc);
    console.log(
      `[build-mvp] classes-core: ${docs.length} classe(s) selecionada(s) de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["classes-core"];
    writePack("classes-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "classes-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug: "classes-core", documentCount: docs.length });
  }

  // --- 6. Class features core (R10-B, DEC-R10-06 item 2) ---
  {
    console.log("[build-mvp] === Pack: class-features-core ===");
    const all = loadTransformed("class-features");
    // Union of Magus (r10-B) and Kineticist (r18-N2a) items{} map features.
    const classFeatureNames = buildClassFeatureNameSet();
    const axisCategories = new Set(axisCategoryByOtherTag().values());
    const docs = all.filter((d) => isClassFeaturesCoreDoc(d, classFeatureNames, axisCategories));
    console.log(
      `[build-mvp] class-features-core: ${docs.length} features selecionadas (items{} map + hybrid studies) de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["class-features-core"];
    writePack("class-features-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "class-features-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({
      packId: manifest.id,
      slug: "class-features-core",
      documentCount: docs.length,
    });
  }

  // --- 7. Feats core (R10-B, DEC-R10-06 item 3) ---
  {
    console.log("[build-mvp] === Pack: feats-core ===");
    const all = loadTransformed("feats");
    const docs = all.filter(isFeatsCoreDoc);
    console.log(
      `[build-mvp] feats-core: ${docs.length} feats selecionados de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["feats-core"];
    writePack("feats-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "feats-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug: "feats-core", documentCount: docs.length });
  }

  // --- 8. Ancestries core (R10-B, DEC-R10-06 item 4: Ratfolk) ---
  {
    console.log("[build-mvp] === Pack: ancestries-core ===");
    const all = loadTransformed("ancestries");
    const docs = all.filter(isAncestriesCoreDoc);
    console.log(
      `[build-mvp] ancestries-core: ${docs.length} ancestralidade(s) selecionada(s) de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["ancestries-core"];
    writePack("ancestries-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "ancestries-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug: "ancestries-core", documentCount: docs.length });
  }

  // --- 9. Heritages core (R10-B, DEC-R10-06 item 4: 7 heranças do ratfolk) ---
  {
    console.log("[build-mvp] === Pack: heritages-core ===");
    const all = loadTransformed("heritages");
    const docs = all.filter(isHeritagesCoreDoc);
    console.log(
      `[build-mvp] heritages-core: ${docs.length} heranças selecionadas de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["heritages-core"];
    writePack("heritages-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "heritages-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug: "heritages-core", documentCount: docs.length });
  }

  // --- 10. Backgrounds core (R10-B, DEC-R10-06 item 4: Fireworks Performer) ---
  {
    console.log("[build-mvp] === Pack: backgrounds-core ===");
    const all = loadTransformed("backgrounds");
    const docs = all.filter(isBackgroundsCoreDoc);

    // r20-X5 (Lacuna 2): the Aeronaut background comes from the vendor with an
    // EMPTY system.items map, but its own description @UUID grants Assurance
    // (with Piloting Lore). Inject that curated grant so the client's r20-X4
    // materializer concedes it — only when the map is still empty (idempotent;
    // if a future vendor snapshot populates it, this is a no-op). See
    // AERONAUT_CURATED_ITEMS for the full rationale.
    const aeronaut = docs.find((d) => d.name === "Aeronaut");
    if (aeronaut) {
      const existing = aeronaut.system.items ?? {};
      if (Object.keys(existing).length === 0) {
        aeronaut.system.items = { ...AERONAUT_CURATED_ITEMS };
        console.log(
          "[build-mvp] backgrounds-core: injected Assurance free-feat grant into Aeronaut (vendor items{} was empty)",
        );
      }
    }

    console.log(
      `[build-mvp] backgrounds-core: ${docs.length} background(s) selecionado(s) de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["backgrounds-core"];
    writePack("backgrounds-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "backgrounds-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({
      packId: manifest.id,
      slug: "backgrounds-core",
      documentCount: docs.length,
    });
  }

  // --- 11. Actions core (W2, r11-follow-up) ---
  {
    console.log("[build-mvp] === Pack: actions-core ===");
    const all = loadTransformed("actions");
    const docs = all.filter(isActionsCoreDoc);
    console.log(
      `[build-mvp] actions-core: ${docs.length} ações selecionadas de ${all.length} totais`,
    );

    const manifest = PACK_MANIFESTS["actions-core"];
    writePack("actions-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "actions-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug: "actions-core", documentCount: docs.length });
  }

  // --- 12. Familiar abilities core (G4, r16 — Pets tab picker) ---
  // The whole vendor familiar-abilities pack; no curation predicate (every
  // ability is a valid daily pick). Spec 29 REQ-PET-020.
  {
    console.log("[build-mvp] === Pack: familiar-abilities-core ===");
    const all = loadTransformed("familiar-abilities");
    const docs = all;
    console.log(`[build-mvp] familiar-abilities-core: ${docs.length} habilidades de familiar`);

    const manifest = PACK_MANIFESTS["familiar-abilities-core"];
    writePack("familiar-abilities-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "familiar-abilities-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({
      packId: manifest.id,
      slug: "familiar-abilities-core",
      documentCount: docs.length,
    });
  }

  // --- 13. Equipment core (r18-N2d — Finn's physical gear) ---
  // Fixed source-id list (same pattern as weapons-core); see
  // MVP_EQUIPMENT_PF2E_IDS docstring for the full item-by-item breakdown.
  {
    console.log("[build-mvp] === Pack: equipment-core ===");
    const all = loadTransformed("equipment");
    const docs = filterToMvpSubset(all, MVP_EQUIPMENT_PF2E_IDS);
    // Finn owns 2 Gate Attenuators (same item, not a higher tier) — the
    // curated doc's system.quantity is bumped to reflect that.
    for (const doc of docs) {
      if (doc.flags?.fusion?.sourceId === "ioiMUDqv85BI4shY") {
        doc.system.quantity = 2;
      }
    }
    console.log(
      `[build-mvp] equipment-core: ${docs.length} itens selecionados de ${MVP_EQUIPMENT_PF2E_IDS.size} ids curados (${all.length} totais no pack equipment)`,
    );

    const manifest = PACK_MANIFESTS["equipment-core"];
    writePack("equipment-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "equipment-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug: "equipment-core", documentCount: docs.length });
  }

  // --- 14. Ancestry features core (r20-X5 — auto-conceded ABC features) ---
  // The whole vendor ancestry-features pack; no curation predicate (every
  // feature is a valid grant target for some ancestry/heritage's system.items
  // map). See the ancestry-features-core manifest docstring for the rationale.
  {
    console.log("[build-mvp] === Pack: ancestry-features-core ===");
    const all = loadTransformed("ancestry-features");
    const docs = all;
    console.log(`[build-mvp] ancestry-features-core: ${docs.length} ancestry features`);

    const manifest = PACK_MANIFESTS["ancestry-features-core"];
    writePack("ancestry-features-core", docs, manifest);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, "ancestry-features-core", "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({
      packId: manifest.id,
      slug: "ancestry-features-core",
      documentCount: docs.length,
    });
  }

  // Write build report
  const reportPath = join(PACKS_OUT_DIR, "build-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n[build-mvp] === SUMÁRIO ===");
  for (const p of report.packs) {
    console.log(`  ${p.packId}: ${p.documentCount} documentos`);
  }
  console.log(`\nPacks em: systems/pf2e/packs/`);
  return report;
}

// ---------------------------------------------------------------------------
// Main — sf2e (REQ-SF2-044..048)
// ---------------------------------------------------------------------------

/** sf2e MVP pack manifests, mirroring PACK_MANIFESTS' shape (spec 18). */
const SF2E_PACK_MANIFESTS = {
  "weapons-core": {
    id: "sf2e.weapons-core",
    label: "SF2e Core Weapons",
    documentType: "Item",
    systemId: "sf2e",
    indexFields: [
      "system.level",
      "system.category",
      "system.traits.value",
      "system.damage",
      "system.grade",
    ],
    license: {
      license: "ORC",
      attribution: "Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "armor-core": {
    id: "sf2e.armor-core",
    label: "SF2e Core Armor",
    documentType: "Item",
    systemId: "sf2e",
    indexFields: ["system.level", "system.category", "system.traits.value"],
    license: {
      license: "ORC",
      attribution: "Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "augmentations-core": {
    id: "sf2e.augmentations-core",
    label: "SF2e Core Augmentations",
    documentType: "Item",
    systemId: "sf2e",
    indexFields: ["system.level", "system.traits.value", "system.usage"],
    license: {
      license: "ORC",
      attribution: "Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  conditions: {
    id: "sf2e.conditions",
    label: "SF2e Conditions",
    documentType: "Item",
    systemId: "sf2e",
    indexFields: ["system.duration", "system.badge"],
    license: {
      license: "ORC",
      attribution: "Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "bestiary-core": {
    id: "sf2e.bestiary-core",
    label: "SF2e Core Bestiary",
    documentType: "Actor",
    systemId: "sf2e",
    indexFields: ["system.details.level.value", "system.traits.value", "system.attributes.hp.max"],
    license: {
      license: "ORC",
      attribution: "Starfinder Alien Core © 2025 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  "spells-core": {
    id: "sf2e.spells-core",
    label: "SF2e Core Spells",
    documentType: "Item",
    systemId: "sf2e",
    indexFields: [
      "system.level",
      "system.traits.value",
      "system.traits.traditions",
      "system.traits.rarity",
    ],
    license: {
      license: "ORC",
      attribution: "Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.",
      reservedNotice:
        "Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
      sourceRepo: "github.com/foundryvtt/pf2e",
      sourceVersion: SOURCE_VERSION,
      textAttribution: TEXT_ATTRIBUTION,
    },
    source: {
      repo: "github.com/foundryvtt/pf2e",
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
};

/**
 * sourceIds curados para o subset MVP sf2e — spread analog/tech, tiers
 * commercial/level-0, cobrindo traits SF-exclusivos (tech, analog, arc,
 * automatic, area-cone). Curados a partir de out/sf2e/equipment/transformed.json
 * (analysis/08-sf2e-import.md tem o detalhamento por arma).
 */
const SF2E_WEAPON_SOURCE_IDS = new Set([
  "M0PsUbGLkBk878YZ", // Arc Pistol (tech, arc)
  "TAgaAiDMPGnF87Vv", // Arc Rifle (tech, arc)
  "qIgcUV22LaDCzmb2", // Laser Pistol (tech)
  "0TSUahGsoVnDZ6kv", // Laser Rifle (tech)
  "O3QRrXVfhNpF0XyY", // Zero Pistol (tech)
  "jLiackiAHgru9OY0", // Plasma Sword (tech, powered)
  "ST6R4rRFf50vzSdJ", // Shock Truncheon (tech, powered, modular)
  "3yWQhmBrAXnBhYaF", // Flamethrower (tech, area-cone, unwieldy)
  "EnufuFPBa1U2pPDn", // Machine Gun (analog, automatic)
  "dxkmvJZOblZ8oImW", // Autotarget Rifle (analog, automatic)
  "V0LgOSOvkNvs2i0x", // Knife (analog, agile, finesse)
  "D4KuxPi9gqFkvZ3h", // Baton (analog, finesse, nonlethal)
  "K0xFwEC6Zv7ghVFa", // Semi-Auto Pistol (analog)
  "8nvXQmFxd5eCkD9v", // Hammer (analog)
  "a2e5svVQ20WrzRTK", // Dueling Sword (analog, versatile-p)
  "gwVhd31nGDXo5HAa", // Crossbolter (analog)
  "sTe6qQmJ1lC1xDfC", // Shock Pad (tech, powered, agile)
  "vpjJYIgYZab0UZFa", // Pulsecaster Pistol (tech, nonlethal)
  "V7epvZwIrMLMYI97", // Coil Rifle (tech, kickback, unwieldy)
  "wbKiBgYY120RyoGg", // Shooting Starknife (analog, thrown-20)
]);

/** sourceIds curados de armaduras nível 0 (analysis/08-sf2e-import.md). */
const SF2E_ARMOR_SOURCE_IDS = new Set([
  "ehsCl5WJTANTlzBy", // Abadarcorp Travel Suit (light)
  "mkMWda6ivlhnXq4d", // Armored Coat (light)
  "aNoSZiPBfxVJYvap", // Carbon Skin (light)
  "FySX3VPYY1YkdBZg", // Estex Suit (light)
  "pcPU3BjbNclch4lS", // Hardlight Series (light)
  "9UiGMq93t13HEz90", // Quilted Armor (light)
  "plBUD8dy3M3gGiHK", // Freebooter Armor (medium)
  "eU5n2fP7DvnFyqov", // Shotalashu Armor (medium)
  "E9MKSSJCOk9ceLKc", // Aegis Series (heavy)
  "wnJTyjfupLw4Cy7G", // Hidden Soldier Armor (heavy)
]);

/**
 * sourceIds curados de augmentações (D-SF2-03; type "equipment" com
 * usage:"implanted" no dado real — ver systems/sf2e/src/schemas/item-augmentation.ts).
 * Spread pelas 5 categorias reais (apex/biotech/magitech/necrograft/tech —
 * pastas em vendor/pf2e/packs/sf2e/equipment/augmentations/, types.ts
 * AUGMENTATION_TYPES).
 */
const SF2E_AUGMENTATION_SOURCE_IDS = new Set([
  "GBtIO5fqFGD9Dzk1", // Autorecognition Lens (tech)
  "uxJScsvafT7Nqwhj", // Hearing Aid (tech)
  "3TQ2WCBNaFwEUDHo", // Datajack (Commercial) (tech)
  "j66fZJrm1nECG3UM", // Dermal Plating (Commercial) (tech)
  "PJaarOSEHTLje8sT", // Retinal Reflectors (tech)
  "ejsPnjUVXf2TJgeD", // Dragon Gland (Commercial) (biotech)
  "zyrPSFBAwL58wCUB", // Gill Sheath (biotech)
  "VYtnxv13EtkyggD4", // Moodskin (magitech)
  "Dmwb9DcWLf9y8JmC", // Telepathy Node (magitech)
  "CBFbt7Xg5YP856ld", // Necrolung (Commercial) (necrograft)
]);

/**
 * sourceIds curados de magias nível 1-3 (analog aos pf2e cantrips/rank-1).
 */
const SF2E_SPELL_SOURCE_IDS = new Set([
  "FEaM1B4WuiqFO7Uk", // Eldritch Lance (L1)
  "JIAIyvj4PV84tnFk", // Chill Gaze (L1)
  "yXD9uU8w8uFD2OBQ", // Delete (L1)
  "d5dmu4HZ3YyrwcaF", // Elemental Weapon (L1)
  "ahXTkKpQtOTAQOFm", // Enhance Weapon (L1)
  "ZBeKxBcUOsXrfMRo", // Implant Data (L1)
  "uBo6g5aW087cLSJR", // Mind Skewer (L1)
  "wOjoJjl2ndZKTuFJ", // Overheat (L1)
  "mAu69GVbFKYzQM5a", // Akashic Fount (L1)
  "smCC1LNhMb7Z1lrU", // Anthem (L1)
]);

/**
 * sourceIds curados de bestiário — inclui robots/aliens para exercitar a
 * allowlist de traits SF-exclusivos (REQ-SF2-047; analysis/04 §6 item 2).
 */
const SF2E_MONSTER_SOURCE_IDS = new Set([
  "rl5p1LLCpKh16viU", // Repair-Class Security Robot (robot, construct, tech) L-1
  "H53Dsx2DYmd9hBIn", // Botnib (fey, gremlin, tech) L-1
  "dxbr3LNg0R66Aj1n", // Cybernetic Zombie (tech, undead) L-1
  "MnOrSqYS5w8tAPXM", // Ordinance-Class Civil Robot (robot, construct, tech) L0
  "pjh2PB4JwYlgMTwj", // Cyanoscum (elemental, plant) L0
  "yhCFz4PyGPpFRr1O", // Akata (aberration) L1
]);

async function buildSf2eSubset() {
  console.log("[build-mvp] Gerando subconjunto MVP de packs Fusion (sf2e)...\n");
  mkdirSync(SF2E_PACKS_OUT_DIR, { recursive: true });

  const report = {
    packs: [],
    generatedAt: new Date().toISOString(),
    importerVersion: IMPORTER_VERSION,
    sourceVersion: SOURCE_VERSION,
    system: "sf2e",
  };

  const writeSf2ePack = (slug, docs, manifest) => {
    const finalManifest = writePack(slug, docs, manifest, SF2E_PACKS_OUT_DIR);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(SF2E_PACKS_OUT_DIR, slug, "index.json"),
      JSON.stringify(index, null, 2),
      "utf8",
    );
    report.packs.push({ packId: manifest.id, slug, documentCount: docs.length });
    return finalManifest;
  };

  // --- 1. Conditions (all 3 SF-exclusive: glitching, suppressed, untethered) ---
  {
    console.log("[build-mvp] === Pack: conditions (sf2e) ===");
    const docs = loadTransformed("conditions", "sf2e");
    console.log(`[build-mvp] conditions: ${docs.length} condições sf2e-exclusivas`);
    writeSf2ePack("conditions", docs, SF2E_PACK_MANIFESTS["conditions"]);
  }

  // --- 2. Weapons core (~20 curadas, spread analog/tech) ---
  {
    console.log("[build-mvp] === Pack: weapons-core (sf2e) ===");
    const all = loadTransformed("equipment", "sf2e");
    const weapons = all.filter((d) => d.type === "weapon");
    const docs = filterToMvpSubset(weapons, SF2E_WEAPON_SOURCE_IDS);
    console.log(`[build-mvp] weapons-core: ${docs.length} selecionadas de ${weapons.length} armas`);
    writeSf2ePack("weapons-core", docs, SF2E_PACK_MANIFESTS["weapons-core"]);
  }

  // --- 3. Armor core (~10 curadas) ---
  {
    console.log("[build-mvp] === Pack: armor-core (sf2e) ===");
    const all = loadTransformed("equipment", "sf2e");
    const armor = all.filter((d) => d.type === "armor");
    const docs = filterToMvpSubset(armor, SF2E_ARMOR_SOURCE_IDS);
    console.log(`[build-mvp] armor-core: ${docs.length} selecionadas de ${armor.length} armaduras`);
    writeSf2ePack("armor-core", docs, SF2E_PACK_MANIFESTS["armor-core"]);
  }

  // --- 4. Augmentations core (D-SF2-03) ---
  {
    console.log("[build-mvp] === Pack: augmentations-core (sf2e) ===");
    const all = loadTransformed("equipment", "sf2e");
    const augmentations = all.filter(
      (d) => d.type === "equipment" && d.system?.usage === "implanted",
    );
    const docs = filterToMvpSubset(augmentations, SF2E_AUGMENTATION_SOURCE_IDS);
    console.log(
      `[build-mvp] augmentations-core: ${docs.length} selecionadas de ${augmentations.length} augmentações`,
    );
    writeSf2ePack("augmentations-core", docs, SF2E_PACK_MANIFESTS["augmentations-core"]);
  }

  // --- 5. Bestiary core (~10, incl. robots/aliens p/ allowlist de traits) ---
  {
    console.log("[build-mvp] === Pack: bestiary-core (sf2e) ===");
    const all = loadTransformed("alien-core-bestiary", "sf2e");
    const monsters = all.filter((d) => d.type === "npc");
    const curated = filterToMvpSubset(monsters, SF2E_MONSTER_SOURCE_IDS);

    // Supplement with additional L-1..L3 ORC monsters to reach ~10 total
    const alreadySelected = new Set(curated.map((d) => d._id));
    const supplemental = monsters
      .filter((m) => !alreadySelected.has(m._id))
      .filter((m) => {
        const level = m.system?.details?.level?.value ?? 0;
        const pub = m.system?.details?.publication?.license;
        return pub === "ORC" && level >= -1 && level <= 3;
      })
      .sort(
        (a, b) => (a.system?.details?.level?.value ?? 0) - (b.system?.details?.level?.value ?? 0),
      )
      .slice(0, Math.max(0, 10 - curated.length));

    const docs = [...curated, ...supplemental];
    console.log(`[build-mvp] bestiary-core: ${docs.length} criaturas selecionadas`);
    writeSf2ePack("bestiary-core", docs, SF2E_PACK_MANIFESTS["bestiary-core"]);
  }

  // --- 6. Spells core (~10 curadas) ---
  {
    console.log("[build-mvp] === Pack: spells-core (sf2e) ===");
    const all = loadTransformed("spells", "sf2e");
    const docs = filterToMvpSubset(all, SF2E_SPELL_SOURCE_IDS);
    console.log(`[build-mvp] spells-core: ${docs.length} magias selecionadas`);
    writeSf2ePack("spells-core", docs, SF2E_PACK_MANIFESTS["spells-core"]);
  }

  // Write build report
  const reportPath = join(SF2E_PACKS_OUT_DIR, "build-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n[build-mvp] === SUMÁRIO (sf2e) ===");
  for (const p of report.packs) {
    console.log(`  ${p.packId}: ${p.documentCount} documentos`);
  }
  console.log(`\nPacks em: systems/sf2e/packs/`);
  return report;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const systemEq = args.find((a) => a.startsWith("--system="));
  const systemIdx = args.indexOf("--system");
  const systemFlag = systemEq
    ? systemEq.split("=")[1]
    : systemIdx !== -1
      ? args[systemIdx + 1]
      : null;
  const system = systemFlag === "sf2e" ? "sf2e" : "pf2e";

  if (system === "sf2e") {
    await buildSf2eSubset();
  } else {
    await buildPf2eSubset();
  }

  // Portão final: nenhum documento pode ser a mesma coisa que outro
  // (mesmo nome + mesmo tipo + mesma descrição). Roda sobre TODOS os packs
  // emitidos nesta execução, depois de escritos — se falhar, o erro nomeia os
  // pares e a saída não é considerada boa.
  portaoDeDuplicataSemantica();
}

main().catch((err) => {
  console.error("[build-mvp] FATAL:", err);
  process.exit(1);
});
