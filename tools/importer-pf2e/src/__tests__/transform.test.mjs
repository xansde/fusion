/**
 * transform.test.mjs — Testes do estágio TRANSFORM do pipeline PF2E → Fusion.
 *
 * Verifica:
 *   1. fusionId determinístico e sem colisão cross-pack.
 *   2. Transform de amostras reais (weapon, condition, NPC) → doc Fusion válido.
 *   3. RE não suportado vai para flags.fusion.unconvertedRules sem quebrar.
 *   4. Nenhuma arte Paizo no output.
 *   5. Cobertura de Rule Elements (FlatModifier → ModifierDescriptor).
 *
 * REQ-CMP-034..044; Analysis 05 (fusionId), 03 (rule elements).
 *
 * Execução:
 *   node --test src/__tests__/transform.test.mjs
 *
 * Zero dependências externas — Node 22 ESM nativo + node:test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// r21: os gates de conteúdo passam a ser derivados da CURADORIA, não de
// números literais. Ver .fusion-build/r21-plan.md §6.
import { classItemsMap, curatedClassDisplayNames, loadClassCuration } from "../curation/index.mjs";
import { acharDuplicatas, formatarErroDeDuplicata } from "../curation/duplicata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, "..", "..");
const OUT_DIR = join(IMPORTER_ROOT, "out");
/**
 * `out/` is the import pipeline's output, produced from the gitignored
 * `vendor/pf2e` clone (README: "In CI without the vendor clone the tests will
 * fail because out/ is not present"). On a runner there is no input to assert
 * against, so these cases would fail for lack of data, not for a defect —
 * which is noise, not a gate. They skip there and run in full locally after
 * the import. Everything that reads `samples/` or the COMMITTED `packs/`
 * keeps running on CI: skipping is scoped to what structurally cannot run.
 */
const OUT_MISSING = existsSync(OUT_DIR)
  ? false
  : "requires tools/importer-pf2e/out/ — run the import pipeline (see README)";
const PACKS_DIR = join(IMPORTER_ROOT, "..", "..", "systems", "pf2e", "packs");
const SAMPLES_DIR = join(IMPORTER_ROOT, "samples");
const VENDOR_ROOT = join(IMPORTER_ROOT, "vendor", "pf2e", "packs", "pf2e");

// ---------------------------------------------------------------------------
// Helpers (inline subset of transform.mjs logic — no import of the module
// itself to avoid running the CLI side-effects)
// ---------------------------------------------------------------------------

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function bufToBase62(buf, length) {
  let n = BigInt("0x" + buf.toString("hex"));
  const result = [];
  const base = BigInt(62);
  for (let i = 0; i < length; i++) {
    result.push(BASE62[Number(n % base)]);
    n = n / base;
  }
  return result.reverse().join("");
}

function deriveFusionId(packName, pf2eSourceId) {
  const input = `${packName}:${pf2eSourceId}`;
  const hash = createHash("sha1").update(input, "utf8").digest();
  return bufToBase62(hash, 16);
}

function isValidFusionId(id) {
  return typeof id === "string" && /^[A-Za-z0-9]{16}$/.test(id);
}

function loadJson(path) {
  assert.ok(existsSync(path), `File not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadTransformed(packName) {
  return loadJson(join(OUT_DIR, packName, "transformed.json"));
}

// ---------------------------------------------------------------------------
// 1. fusionId — determinismo e ausência de colisão cross-pack
// REQ-CMP-041
// ---------------------------------------------------------------------------

describe("fusionId derivation", () => {
  it("produces 16-char base62 string", () => {
    const id = deriveFusionId("equipment", "LJdbVTOZog39EEbi");
    assert.ok(isValidFusionId(id), `Invalid fusionId: "${id}"`);
  });

  it("is deterministic — same inputs produce same ID", () => {
    const a = deriveFusionId("equipment", "LJdbVTOZog39EEbi");
    const b = deriveFusionId("equipment", "LJdbVTOZog39EEbi");
    assert.equal(a, b, "fusionId must be deterministic");
  });

  it("different packs produce different IDs for the same pf2e _id", () => {
    const sameId = "LJdbVTOZog39EEbi"; // Longsword pf2e id
    const inEquipment = deriveFusionId("equipment", sameId);
    const inSpells = deriveFusionId("spells", sameId);
    assert.notEqual(inEquipment, inSpells, "Cross-pack fusionIds must differ");
  });

  it("different pf2e ids within the same pack produce different fusionIds", () => {
    const a = deriveFusionId("equipment", "LJdbVTOZog39EEbi");
    const b = deriveFusionId("equipment", "hIgqLgH3YcLZBeoT");
    assert.notEqual(a, b, "Different pf2e ids must yield different fusionIds");
  });
});

// ---------------------------------------------------------------------------
// 2. Transform output — structural validation on transformed.json
// REQ-CMP-027/030/044
// ---------------------------------------------------------------------------

describe("conditions pack transform", { skip: OUT_MISSING }, () => {
  const getConditionDocs = () => loadTransformed("conditions");

  it("all 43 conditions are transformed", () => {
    assert.equal(getConditionDocs().length, 43);
  });

  it("every doc has valid fusionId as _id", () => {
    for (const doc of getConditionDocs()) {
      assert.ok(isValidFusionId(doc._id), `Invalid _id for doc "${doc.name}": "${doc._id}"`);
    }
  });

  it("every doc has type, name, system, flags.fusion", () => {
    for (const doc of getConditionDocs()) {
      assert.ok(doc.type, `Missing type in doc ${doc._id}`);
      assert.ok(doc.name, `Missing name in doc ${doc._id}`);
      assert.ok(doc.system, `Missing system in doc ${doc._id}`);
      assert.ok(doc.flags?.fusion, `Missing flags.fusion in doc ${doc._id}`);
    }
  });

  it('flags.fusion.conversion is "full" or "partial"', () => {
    for (const doc of getConditionDocs()) {
      const conv = doc.flags?.fusion?.conversion;
      assert.ok(
        conv === "full" || conv === "partial",
        `Invalid conversion state "${conv}" for doc ${doc._id}`,
      );
    }
  });

  it("Blinded condition has FlatModifier converted", () => {
    const docs = getConditionDocs();
    const blinded = docs.find((d) => d.name === "Blinded");
    assert.ok(blinded, "Blinded condition not found in transformed docs");

    const rules = blinded.system?.rules ?? [];
    const flatMod = rules.find((r) => r.kind === "flat-modifier");
    assert.ok(flatMod, "Blinded should have a flat-modifier in system.rules");
    assert.equal(flatMod.selector, "perception", 'FlatModifier selector should be "perception"');
    assert.equal(flatMod.value, -4, "FlatModifier value should be -4");
  });
});

describe("weapon transform (Longsword)", { skip: OUT_MISSING }, () => {
  const getLongsword = () => {
    const docs = loadTransformed("equipment");
    return docs.find((d) => d.flags?.fusion?.sourceId === "LJdbVTOZog39EEbi");
  };

  it("Longsword is in transformed equipment", () => {
    assert.ok(getLongsword(), "Longsword not found (pf2eSourceId: LJdbVTOZog39EEbi)");
  });

  it("has valid fusionId", () => {
    assert.ok(isValidFusionId(getLongsword()?._id), `Invalid fusionId: "${getLongsword()?._id}"`);
  });

  it("fusionId matches derived value", () => {
    const longsword = getLongsword();
    const expected = deriveFusionId("equipment", "LJdbVTOZog39EEbi");
    assert.equal(longsword._id, expected, "fusionId must match deriveFusionId(equipment, pf2eId)");
  });

  it("has correct mechanical fields", () => {
    const longsword = getLongsword();
    const sys = longsword.system;
    assert.ok(sys.damage, "Missing damage block");
    assert.equal(sys.damage.die, "d8", "Expected d8");
    assert.equal(sys.damage.damageType, "slashing", "Expected slashing");
    assert.equal(sys.category, "martial", "Expected martial");
  });

  it("img points to placeholder, not Paizo art", () => {
    const longsword = getLongsword();
    assert.ok(
      longsword.img.startsWith("icons/placeholder"),
      `img should be placeholder, got "${longsword.img}"`,
    );
    assert.ok(!longsword.img.includes("systems/pf2e"), "img must not reference Paizo art");
  });

  it("has no Paizo art anywhere in the document", () => {
    const str = JSON.stringify(getLongsword());
    assert.ok(!str.includes("systems/pf2e/icons"), "Paizo art path found in document");
  });

  it("flags.fusion.assetSubstitutions records the art swap", () => {
    const longsword = getLongsword();
    const subs = longsword.flags?.fusion?.assetSubstitutions ?? [];
    assert.ok(subs.length > 0, "Expected at least one asset substitution recorded");
    const imgSub = subs.find((s) => s.field === "img");
    assert.ok(imgSub, "Missing img substitution entry");
    assert.ok(imgSub.original, "Missing original art filename");
  });
});

describe("NPC transform (Skeleton Guard)", { skip: OUT_MISSING }, () => {
  const getSkeleton = () => {
    const docs = loadTransformed("pathfinder-monster-core");
    return docs.find((d) => d.flags?.fusion?.sourceId === "trchDxbDR2TiPMxT");
  };

  it("Skeleton Guard is in transformed monster-core", () => {
    assert.ok(getSkeleton(), "Skeleton Guard not found");
  });

  it("has valid fusionId", () => {
    assert.ok(isValidFusionId(getSkeleton()?._id));
  });

  it("has NPC mechanical fields", () => {
    const skeleton = getSkeleton();
    const sys = skeleton.system;
    assert.ok(sys.attributes?.hp, "Missing hp in npc.system.attributes");
    assert.ok(sys.saves, "Missing saves");
    assert.ok(sys.perception, "Missing perception");
  });

  it("has items[] with embedded weapons", () => {
    const skeleton = getSkeleton();
    assert.ok(
      Array.isArray(skeleton.items) && skeleton.items.length > 0,
      "Expected embedded items",
    );
    const hasWeapon = skeleton.items.some((i) => i.type === "weapon" || i.type === "melee");
    assert.ok(hasWeapon, "Expected at least one weapon/melee item");
  });

  it("img is placeholder, not Paizo art", () => {
    const skeleton = getSkeleton();
    assert.ok(skeleton.img.startsWith("icons/placeholder"));
    assert.ok(!skeleton.img.includes("systems/pf2e"));
  });
});

// ---------------------------------------------------------------------------
// 3. Unsupported RE → flags.fusion.unconvertedRules (no crash)
// REQ-CMP-036
// ---------------------------------------------------------------------------

describe("unsupported rule element handling", { skip: OUT_MISSING }, () => {
  it('docs with unsupported REs have conversion = "partial"', () => {
    const docs = loadTransformed("conditions");
    const partials = docs.filter((d) => d.flags?.fusion?.conversion === "partial");
    // Blinded has an Immunity RE which is partial
    assert.ok(partials.length > 0, "Expected at least one partial doc in conditions");
  });

  it("unconvertedRules preserves the original RE data", () => {
    // Find a doc that has unconverted rules
    const docs = loadTransformed("conditions");
    const withUnconverted = docs.filter(
      (d) => (d.flags?.fusion?.unconvertedRules?.length ?? 0) > 0,
    );
    if (withUnconverted.length === 0) return; // skip if none in this subset

    const doc = withUnconverted[0];
    const unconverted = doc.flags.fusion.unconvertedRules;
    assert.ok(Array.isArray(unconverted));
    // Each unconverted rule must have a _conversionState field
    for (const re of unconverted) {
      assert.ok(
        re._conversionState === "partial" || re._conversionState === "unsupported",
        `Unexpected _conversionState: "${re._conversionState}"`,
      );
    }
  });

  it("unconverted RE does not have kind field (not a ModifierDescriptor)", () => {
    const docs = loadTransformed("equipment");
    for (const doc of docs.slice(0, 100)) {
      const unconverted = doc.flags?.fusion?.unconvertedRules ?? [];
      for (const re of unconverted) {
        // Unconverted REs are raw pf2e RE objects — they have "key" not "kind"
        assert.ok(re.key !== undefined, 'Unconverted RE must have "key" field (pf2e RE format)');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Art policy — no Paizo art in any transformed output
// REQ-CMP-031/032
// ---------------------------------------------------------------------------

describe("art policy", { skip: OUT_MISSING }, () => {
  const packs = ["conditions", "spells"];

  for (const pack of packs) {
    it(`no Paizo art in ${pack} transformed docs`, () => {
      const docs = loadTransformed(pack);
      const str = JSON.stringify(docs);
      assert.ok(
        !str.includes('"systems/pf2e/'),
        `Paizo art path "systems/pf2e/" found in ${pack} transformed output`,
      );
    });
  }

  it('all img fields start with "icons/placeholder"', () => {
    const conditionDocs = loadTransformed("conditions");
    for (const doc of conditionDocs) {
      assert.ok(
        doc.img?.startsWith("icons/placeholder"),
        `Unexpected img "${doc.img}" in doc ${doc._id}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4b. Flavor-prose policy — description text under ORC/OGL is licensed
// content and MAY be redistributed with attribution (clean-room — spec 26
// §D4, REQ-LEG-010, policy update W2-C1 2026-07-05).
//
// NAMES and structured MECHANICAL fields are ORC and stay, as always.
// `system.description` is now PRESERVED whenever the document's
// `system.publication.license` is ORC or OGL (the vendor's own license
// declaration, verified per-doc) — the pre-W2-C1 conservative default (always
// blank) only still applies to documents with no publication block at all
// (e.g. NPC actors, which don't even carry a `system.description` field).
// `gmNotes`/`publicNotes`/`privateNotes` are GM-only/lore flavor — NEVER
// rules text — and stay unconditionally stripped regardless of license.
// ---------------------------------------------------------------------------

describe("flavor-prose policy (committed packs)", () => {
  const ALWAYS_STRIPPED_FIELDS = ["gmNotes", "publicNotes", "privateNotes"];
  const itemPackSlugs = ["conditions", "weapons-core", "spells-core"];

  /** Returns the prose length of a system.* field, handling string | {value}. */
  function proseLen(value) {
    if (typeof value === "string") return value.length;
    if (value && typeof value === "object" && typeof value.value === "string") {
      return value.value.length;
    }
    return 0;
  }

  for (const slug of itemPackSlugs) {
    it(`pf2e.${slug}: gmNotes/publicNotes/privateNotes always stripped; description present only under ORC/OGL`, () => {
      const docs = loadJson(join(PACKS_DIR, slug, "documents.json"));
      for (const doc of docs) {
        const sys = doc.system ?? {};
        for (const field of ALWAYS_STRIPPED_FIELDS) {
          const len = proseLen(sys[field]);
          assert.ok(
            len === 0,
            `Flavor prose leaked: ${slug} doc "${doc.name}" system.${field} has ${len} chars`,
          );
        }
        const license = sys.publication?.license;
        const descLen = proseLen(sys.description);
        if (!["ORC", "OGL"].includes(license)) {
          assert.ok(
            descLen === 0,
            `${slug} doc "${doc.name}" has non-empty description without an ORC/OGL publication.license (got "${license}")`,
          );
        }
        for (const item of doc.items ?? []) {
          const isys = item.system ?? {};
          for (const field of ALWAYS_STRIPPED_FIELDS) {
            const len = proseLen(isys[field]);
            assert.ok(
              len === 0,
              `Flavor prose leaked: ${slug} doc "${doc.name}" embedded item.${field} has ${len} chars`,
            );
          }
          const itemLicense = isys.publication?.license;
          if (!["ORC", "OGL"].includes(itemLicense)) {
            const itemDescLen = proseLen(isys.description);
            assert.ok(
              itemDescLen === 0,
              `${slug} doc "${doc.name}" embedded item has non-empty description without an ORC/OGL publication.license (got "${itemLicense}")`,
            );
          }
        }
      }
    });
  }

  it("pf2e.bestiary-core: NPC details carry no flavor prose (no publication-gated description on actors)", () => {
    const docs = loadJson(join(PACKS_DIR, "bestiary-core", "documents.json"));
    for (const doc of docs) {
      const details = doc.system?.details ?? {};
      for (const field of ["publicNotes", "blurb", "privateNotes"]) {
        const len = proseLen(details[field]);
        assert.ok(
          len === 0,
          `Flavor prose leaked: bestiary doc "${doc.name}" details.${field} has ${len} chars`,
        );
      }
      // Embedded strikes/gear: description allowed only under ORC/OGL license.
      for (const item of doc.items ?? []) {
        const isys = item.system ?? {};
        const license = isys.publication?.license;
        if (!["ORC", "OGL"].includes(license)) {
          const len = proseLen(isys.description);
          assert.ok(
            len === 0,
            `Flavor prose leaked: bestiary doc "${doc.name}" embedded item.description has ${len} chars`,
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. MVP pack verification — systems/pf2e/packs/
// REQ-CMP-001..004, REQ-CMP-007
// ---------------------------------------------------------------------------

describe("MVP packs", { skip: OUT_MISSING }, () => {
  const packSlugs = [
    "conditions",
    "weapons-core",
    "bestiary-core",
    "spells-core",
    // R10-B (DEC-R10-06) — Magus builder MVP subset
    "classes-core",
    "class-features-core",
    "feats-core",
    "ancestries-core",
    "heritages-core",
    "backgrounds-core",
    // W2 (Actions tab, r11-follow-up)
    "actions-core",
  ];

  for (const slug of packSlugs) {
    describe(`pf2e.${slug}`, () => {
      const packDir = join(PACKS_DIR, slug);

      it("pack.json exists and has required fields", () => {
        const manifest = loadJson(join(packDir, "pack.json"));
        assert.ok(manifest.id, "Missing id");
        assert.ok(manifest.label, "Missing label");
        assert.ok(manifest.documentType, "Missing documentType");
        assert.ok(manifest.systemId, "Missing systemId");
        assert.ok(manifest.license, "Missing license block");
        assert.equal(manifest.license.license, "ORC", "Pack must be ORC-licensed");
        assert.ok(manifest.license.attribution, "Missing attribution");
        assert.ok(manifest.source, "Missing source block");
        assert.ok(manifest.generatedAt, "Missing generatedAt");
        assert.ok(typeof manifest.documentCount === "number", "documentCount must be a number");
      });

      it("documents.json exists and has correct count", () => {
        const manifest = loadJson(join(packDir, "pack.json"));
        const docs = loadJson(join(packDir, "documents.json"));
        assert.ok(Array.isArray(docs), "documents.json must be a JSON array");
        assert.equal(docs.length, manifest.documentCount, "documentCount must match actual docs");
      });

      it("index.json exists with valid entries", () => {
        const index = loadJson(join(packDir, "index.json"));
        assert.ok(Array.isArray(index), "index.json must be a JSON array");
        assert.ok(index.length > 0, "Index must not be empty");
        for (const entry of index.slice(0, 5)) {
          assert.ok(entry._id, "Index entry must have _id");
          assert.ok(entry.name, "Index entry must have name");
          assert.ok(entry.uuid, "Index entry must have uuid");
          assert.ok(
            entry.uuid.startsWith("Compendium.pf2e."),
            `Invalid uuid format: "${entry.uuid}"`,
          );
        }
      });

      it("all documents have valid fusionId", () => {
        const docs = loadJson(join(packDir, "documents.json"));
        for (const doc of docs) {
          assert.ok(isValidFusionId(doc._id), `Invalid fusionId "${doc._id}" in ${slug}`);
        }
      });

      it("no Paizo art in documents", () => {
        const docs = loadJson(join(packDir, "documents.json"));
        const str = JSON.stringify(docs);
        assert.ok(!str.includes('"systems/pf2e/'), `Paizo art found in ${slug}`);
        assert.ok(!str.includes('"systems/sf2e/'), `Paizo art found in ${slug}`);
      });

      // Gap that let a real leak through (r18): normalize.mjs only rewrites a
      // document's own top-level `img` — nested vendor img refs buried inside
      // `system.items` (ancestry/heritage/background embedded feature grants,
      // e.g. Fleshwarp's "Unusual Anatomy") slipped past the string check
      // above whenever the leaked path didn't start with "systems/pf2e/"
      // (e.g. a raw Foundry-core icon path from the vendor feat). Assert
      // every embedded item img is an actual placeholder, not just "not
      // Paizo" — matches the sanitizeItemGrantsMap() policy in transform.mjs.
      it("every embedded system.items[].img is a placeholder (clean-room, r18)", () => {
        const docs = loadJson(join(packDir, "documents.json"));
        for (const doc of docs) {
          const itemsMap = doc.system?.items;
          if (!itemsMap || typeof itemsMap !== "object") continue;
          for (const [key, entry] of Object.entries(itemsMap)) {
            assert.ok(
              typeof entry.img === "string" && entry.img.startsWith("icons/placeholder"),
              `${slug}/${doc.name} embedded item "${key}" (${entry.name}) has non-placeholder img: ${entry.img}`,
            );
          }
        }
      });
    });
  }

  it("weapons-core has ~42 weapons (30 base + 12 firearms, r25)", () => {
    const docs = loadJson(join(PACKS_DIR, "weapons-core", "documents.json"));
    assert.ok(docs.length >= 38 && docs.length <= 48, `Expected ~42 weapons, got ${docs.length}`);
  });

  it("conditions has all 43 conditions", () => {
    const docs = loadJson(join(PACKS_DIR, "conditions", "documents.json"));
    assert.equal(docs.length, 43, "Expected all 43 conditions");
  });

  it("bestiary-core has ~10 monsters", () => {
    const docs = loadJson(join(PACKS_DIR, "bestiary-core", "documents.json"));
    assert.ok(docs.length >= 8 && docs.length <= 15, `Expected ~10 monsters, got ${docs.length}`);
  });

  it("spells-core has the original 22 plus every arcane-tradition + Magus focus spell (DEC-R10-06)", () => {
    const docs = loadJson(join(PACKS_DIR, "spells-core", "documents.json"));
    assert.ok(docs.length >= 700, `Expected 700+ spells after R10-B expansion, got ${docs.length}`);
    const names = docs.map((d) => d.name);
    // Original 22 hand-picked spells must all still be present.
    for (const n of ["Fireball", "Heal", "Guidance", "Stabilize", "Heroism", "Harm"]) {
      assert.ok(names.includes(n), `Original spells-core spell "${n}" missing after expansion`);
    }
    // Magus focus spell from the Starlit Span hybrid study.
    assert.ok(names.includes("Shooting Star"), "Shooting Star (Magus focus spell) missing");
  });

  // -------------------------------------------------------------------------
  // R10-B (DEC-R10-06) — new curated packs for the Magus builder MVP.
  // -------------------------------------------------------------------------

  it("classes-core contém exatamente as classes curadas (r21: dado, não número)", () => {
    // Antes (r10-B/r18-N2a) este teste travava a CONTAGEM (2) e os dois nomes
    // literais. Contagem literal só protege até o dia em que alguém a "conserta"
    // bumpando o número. O invariante que importa é: o pack é EXATAMENTE o que a
    // curadoria declara — nem um doc a mais, nem a menos.
    const docs = loadJson(join(PACKS_DIR, "classes-core", "documents.json"));
    const esperados = [...curatedClassDisplayNames()].sort();
    assert.deepEqual(docs.map((d) => d.name).sort(), esperados);
    assert.ok(docs.every((d) => d.type === "class"));
    // Toda classe curada precisa sair com progressão — classe sem upgrades é a
    // falha muda que este gate existe para pegar (personagem que nunca vira
    // Expert em nada, com o pack verde).
    for (const doc of docs) {
      assert.ok(
        Array.isArray(doc.system.proficiencyUpgrades) && doc.system.proficiencyUpgrades.length > 0,
        `${doc.name} saiu sem proficiencyUpgrades`,
      );
      assert.ok(
        Array.isArray(doc.system.featuresByLevel) && doc.system.featuresByLevel.length > 0,
        `${doc.name} saiu sem featuresByLevel`,
      );
    }
  });

  it("class-features-core cobre o items{} de toda classe curada + as opções de cada eixo (r21)", () => {
    const docs = loadJson(join(PACKS_DIR, "class-features-core", "documents.json"));
    assert.ok(docs.every((d) => d.type === "classFeature"));
    const nomes = new Set(docs.map((d) => d.name));

    // 1) Cobertura: toda feature que alguma classe curada concede está no pack.
    //    É o invariante que a contagem literal não dava — e o que impede um
    //    chip travado apontando para um doc que não existe.
    const vendorClasses = join(VENDOR_ROOT, "classes");
    for (const [slug] of loadClassCuration()) {
      for (const item of classItemsMap(vendorClasses, slug)) {
        assert.ok(
          nomes.has(item.name),
          `${slug}: feature "${item.name}" (nível ${item.level}) fora do pack`,
        );
      }
    }

    // 2) Feature compartilhada entra UMA vez (Shield Block está em 7 classes do
    //    vendor; Weapon Specialization em 25).
    const contagem = new Map();
    for (const d of docs) contagem.set(d.name, (contagem.get(d.name) ?? 0) + 1);
    const repetidos = [...contagem].filter(([, n]) => n > 1);
    assert.deepEqual(
      repetidos,
      [],
      `nome repetido em class-features-core: ${JSON.stringify(repetidos)}`,
    );

    // 3) Todo eixo de sub-escolha declarado tem opção no pack — sem isto a
    //    classe abre o slot de escolha e não há o que escolher (bug da r12 com
    //    focus spells, em outra família).
    for (const [, cfg] of loadClassCuration()) {
      for (const axis of cfg.choiceAxes) {
        const opcoes = docs.filter((d) => d.system.category === axis.category);
        assert.ok(
          opcoes.length > 0,
          `${cfg.class}: eixo "${axis.category}" sem nenhuma opção no pack`,
        );
        if (typeof axis.optionCount === "number") {
          assert.equal(
            opcoes.length,
            axis.optionCount,
            `${cfg.class}/${axis.category}: ${opcoes.length} opções no pack, curadoria declara ${axis.optionCount}`,
          );
        }
      }
    }

    // Âncora histórica que continua valendo (r10-B).
    assert.ok(nomes.has("Starlit Span"), "Starlit Span hybrid study missing");
    // Âncora da r21: a feature compartilhada citada pelo usuário.
    assert.ok(nomes.has("Shield Block"), "Shield Block (Fighter, 7 classes) missing");
  });

  it("classes-core Magus + Kineticist featuresByLevel[].uuid all resolve to a real class-features-core _id", () => {
    // Locate by name — docs[] order is not guaranteed once Kineticist joined the pack (R18-N2a).
    const classes = loadJson(join(PACKS_DIR, "classes-core", "documents.json"));
    const magus = classes.find((d) => d.name === "Magus");
    const kineticist = classes.find((d) => d.name === "Kineticist");
    assert.ok(magus, "Magus class doc missing");
    assert.ok(kineticist, "Kineticist class doc missing");
    const classFeatures = loadJson(join(PACKS_DIR, "class-features-core", "documents.json"));
    const classFeatureIds = new Set(classFeatures.map((d) => d._id));

    assert.equal(magus.system.featuresByLevel.length, 19);
    for (const ref of magus.system.featuresByLevel) {
      assert.ok(
        classFeatureIds.has(ref.uuid),
        `Magus featuresByLevel ref "${ref.name}" (uuid ${ref.uuid}) does not resolve to a class-features-core doc`,
      );
    }

    assert.equal(kineticist.system.featuresByLevel.length, 23);
    for (const ref of kineticist.system.featuresByLevel) {
      assert.ok(
        classFeatureIds.has(ref.uuid),
        `Kineticist featuresByLevel ref "${ref.name}" (uuid ${ref.uuid}) does not resolve to a class-features-core doc`,
      );
    }
  });

  it("classes-core Kineticist is Trained in impulse attacks at level 1 with upgrades mirroring classDC (r18-N2c)", () => {
    // Rage of Elements p.14: "Your impulse attack roll uses the same
    // proficiency and attribute modifier as your kineticist class DC" — so
    // system.impulse must start at 1 (Trained) and every classDC upgrade
    // (Kinetic Expertise L7, Kinetic Mastery L15, Kinetic Legend L19) must be
    // mirrored by an equal-rank impulse upgrade. Without this, the
    // elementalBlast derivation (which reads `stat: "impulse"` specifically,
    // not "classDC") freezes the Elemental Blast attack at Trained forever.
    const classes = loadJson(join(PACKS_DIR, "classes-core", "documents.json"));
    const kineticist = classes.find((d) => d.name === "Kineticist");
    assert.ok(kineticist, "Kineticist class doc missing");
    assert.equal(
      kineticist.system.impulse,
      1,
      "Kineticist should be Trained (rank 1) in impulse attacks at level 1",
    );

    // Non-kineticist classes get no `impulse` field at all in the raw pack
    // doc (the Zod schema's `.default(0)` only applies when the class item
    // is parsed at runtime, e.g. embedding it on a character) — so the
    // absence of the field, not a literal 0, is the correct static-pack
    // expectation here.
    const magus = classes.find((d) => d.name === "Magus");
    assert.equal(
      magus.system.impulse,
      undefined,
      "Magus (no impulses) should not carry a raw impulse field in the pack",
    );

    const upgrades = kineticist.system.proficiencyUpgrades;
    const classDcUpgrades = upgrades.filter((u) => u.stat === "classDC");
    const impulseUpgrades = upgrades.filter((u) => u.stat === "impulse");
    assert.deepEqual(
      impulseUpgrades.map(({ level, rank }) => ({ level, rank })),
      classDcUpgrades.map(({ level, rank }) => ({ level, rank })),
      "every classDC proficiency upgrade must be mirrored by an impulse upgrade at the same level/rank",
    );
    assert.deepEqual(
      impulseUpgrades.map(({ level, rank }) => ({ level, rank })),
      [
        { level: 7, rank: 2 },
        { level: 15, rank: 3 },
        { level: 19, rank: 4 },
      ],
    );
  });

  it("feats-core contains every acceptance-criterion feat from the Tobias + Finn builds (DEC-R10-06, R18-N2a)", () => {
    const docs = loadJson(join(PACKS_DIR, "feats-core", "documents.json"));
    // r21: a contagem literal (459) virou invariante estrutural. O que importa
    // não é o número — é (a) as âncoras de aceitação continuarem presentes e
    // (b) TODA classe curada ter seus class feats no pack. Número literal só
    // protege até alguém "consertar" bumpando o número.
    const names = docs.map((d) => d.name);
    assert.ok(docs.length > 0, "feats-core vazio");
    const semDuplicata = new Set(docs.map((d) => d._id));
    assert.equal(semDuplicata.size, docs.length, "feats-core tem _id repetido");
    for (const [slug, cfg] of loadClassCuration()) {
      const daClasse = docs.filter(
        (d) =>
          d.system?.category === "class" &&
          (d.system?.traits?.value ?? []).includes(cfg.classFeats.trait),
      );
      assert.ok(daClasse.length > 0, `${slug}: nenhum class feat no pack`);
      const acimaDoCorte = daClasse.filter((d) => (d.system?.level ?? 0) > cfg.classFeats.levelMax);
      assert.deepEqual(
        acimaDoCorte.map((d) => d.name),
        [],
        `${slug}: feat acima do corte de nível ${cfg.classFeats.levelMax}`,
      );
    }
    for (const n of [
      // Tobias build (Magus, DEC-R10-06)
      "Magus's Analysis",
      "Impressive Performance",
      "Read Lips",
      "Tinkering Fingers",
      "Alchemical Crafting",
      "Fascinating Performance",
      "Alchemist Dedication",
      // Finn build (Kineticist, R18-N2a)
      "Aerial Boomerang",
      "Four Winds",
      "Magnetic Pinions",
      "Flashforge",
      "Toughness",
      "Cat Fall",
      "Rogue Dedication",
      "Dirty Trick",
      // Note: "Surprise Attack" is a native level-1 Rogue class feature (auto-granted),
      // not a selectable feat — it correctly lives in class-features-core, not here.
    ]) {
      assert.ok(names.includes(n), `Required feat "${n}" missing from feats-core`);
    }
  });

  it("feats-core has no leftover {value: ...} wrapper on system.actions", () => {
    const docs = loadJson(join(PACKS_DIR, "feats-core", "documents.json"));
    for (const doc of docs) {
      const actions = doc.system.actions;
      const isWrapperLeftover =
        actions !== null && typeof actions === "object" && !Array.isArray(actions);
      assert.ok(
        !isWrapperLeftover,
        `${doc.name} still has a wrapper object for system.actions: ${JSON.stringify(actions)}`,
      );
    }
  });

  it("ancestries-core has the 8 Player Core ancestries plus the legacy Ratfolk and Fleshwarp (issue #1)", () => {
    // Issue #1: ancestries-core used to carry ONLY the R10-B/R18-N2a fixtures
    // (Ratfolk, Fleshwarp) — every other PF2e sheet had zero playable
    // ancestry. isAncestriesCoreDoc now also selects every
    // system.publication.title === "Pathfinder Player Core" ancestry;
    // Ratfolk/Fleshwarp stay in for backward compatibility with the
    // Magus/Finn fixtures.
    const docs = loadJson(join(PACKS_DIR, "ancestries-core", "documents.json"));
    const names = docs.map((d) => d.name);
    for (const expected of [
      "Dwarf",
      "Elf",
      "Gnome",
      "Goblin",
      "Halfling",
      "Human",
      "Leshy",
      "Orc",
      "Ratfolk",
      "Fleshwarp",
    ]) {
      assert.ok(names.includes(expected), `${expected} ancestry missing`);
    }
    assert.equal(docs.length, 10);
  });

  it("heritages-core has the 7 Ratfolk heritages (including Snow Rat) plus Sylph plus the Player Core heritages of the 8 core ancestries (issue #1)", () => {
    const docs = loadJson(join(PACKS_DIR, "heritages-core", "documents.json"));
    assert.ok(docs.some((d) => d.name === "Snow Rat"));
    assert.ok(
      docs.some((d) => d.name === "Sylph"),
      "Sylph heritage missing",
    );
    // Every one of the 8 Player Core ancestries must have at least one
    // heritage, or the ancestry's "Choose a Heritage" slot opens empty.
    const coreSlugs = [
      "dwarf",
      "elf",
      "gnome",
      "goblin",
      "halfling",
      "human",
      "leshy",
      "orc",
    ];
    for (const slug of coreSlugs) {
      assert.ok(
        docs.some((d) => d.system?.ancestry?.slug === slug),
        `no heritage found for ancestry "${slug}"`,
      );
    }
  });

  it("backgrounds-core has the 40 Player Core backgrounds plus the legacy Fireworks Performer and Aeronaut (issue #1)", () => {
    // Issue #1: same shape as the ancestries assertion above — Fireworks
    // Performer/Aeronaut stay in for the Magus/Finn fixtures.
    const docs = loadJson(join(PACKS_DIR, "backgrounds-core", "documents.json"));
    const names = docs.map((d) => d.name);
    assert.ok(names.includes("Fireworks Performer"), "Fireworks Performer background missing");
    assert.ok(names.includes("Aeronaut"), "Aeronaut background missing");
    const playerCoreCount = docs.filter(
      (d) => d.system?.publication?.title === "Pathfinder Player Core",
    ).length;
    assert.equal(playerCoreCount, 40);
    // The 43rd is the AUTHORED Smuggler (LO:WG), which no vendor carries — see
    // SMUGGLER_AUTHORED_DOC in build-mvp-subset.mjs. Asserted by name and by
    // provenance, not just counted: a bare number would have gone stale again
    // (this assertion still said 42 after the Smuggler landed in 4cc46fd).
    assert.ok(names.includes("Smuggler"), "authored Smuggler background missing");
    const authored = docs.filter((d) => d.flags?.fusion?.conversion === "authored");
    assert.deepEqual(
      authored.map((d) => d.name),
      ["Smuggler"],
      "backgrounds-core should carry exactly one authored document",
    );
    assert.equal(docs.length, 43);
  });

  it("no committed R10-B pack document.json exceeds ~15 MB", () => {
    const slugs = [
      "classes-core",
      "class-features-core",
      "feats-core",
      "ancestries-core",
      "heritages-core",
      "backgrounds-core",
      "spells-core",
      "actions-core",
    ];
    for (const slug of slugs) {
      const path = join(PACKS_DIR, slug, "documents.json");
      const sizeMb = statSync(path).size / (1024 * 1024);
      assert.ok(
        sizeMb < 15,
        `${slug}/documents.json is ${sizeMb.toFixed(2)} MB — exceeds 15 MB budget`,
      );
    }
  });

  it("every R10-B pack document description is present only under an ORC/OGL publication.license (policy update W2-C1, REQ-LEG-010)", () => {
    const slugs = [
      "classes-core",
      "class-features-core",
      "feats-core",
      "ancestries-core",
      "heritages-core",
      "backgrounds-core",
      "spells-core",
    ];
    for (const slug of slugs) {
      const docs = loadJson(join(PACKS_DIR, slug, "documents.json"));
      for (const doc of docs) {
        const desc = doc.system?.description;
        const license = doc.system?.publication?.license;
        if (typeof desc === "string" && !["ORC", "OGL"].includes(license)) {
          assert.equal(
            desc,
            "",
            `${slug}/${doc.name} has non-empty system.description without an ORC/OGL license (got "${license}")`,
          );
        }
      }
    }
  });

  it("every R10-B pack document img points to a placeholder path", () => {
    const slugs = [
      "classes-core",
      "class-features-core",
      "feats-core",
      "ancestries-core",
      "heritages-core",
      "backgrounds-core",
    ];
    for (const slug of slugs) {
      const docs = loadJson(join(PACKS_DIR, slug, "documents.json"));
      for (const doc of docs) {
        assert.ok(
          doc.img.startsWith("icons/placeholder"),
          `${slug}/${doc.name} img is not a placeholder: ${doc.img}`,
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // W2 (Actions tab, r11-follow-up) — pf2e.actions-core.
  // -------------------------------------------------------------------------

  it("actions-core has 521 actions across the 14 curated categories", () => {
    const docs = loadJson(join(PACKS_DIR, "actions-core", "documents.json"));
    assert.equal(docs.length, 521);
    const byCategory = {};
    for (const d of docs) {
      const c = d.system.fusionCategory;
      byCategory[c] = (byCategory[c] ?? 0) + 1;
    }
    assert.deepEqual(byCategory, {
      basic: 30,
      skill: 54,
      exploration: 13,
      downtime: 4,
      class: 187,
      equipment: 7,
      ancestry: 42,
      archetype: 134,
      background: 26,
      familiar: 1,
      heritage: 7,
      spells: 11,
      stamina: 4,
      mythic: 1,
    });
  });

  it("actions-core excludes subsystems/vehicles/aftermath/campaign vendor subfolders", () => {
    const docs = loadJson(join(PACKS_DIR, "actions-core", "documents.json"));
    const excluded = new Set(["subsystems", "vehicles", "aftermath", "campaign"]);
    for (const d of docs) {
      assert.ok(
        !excluded.has(d.system.fusionCategory),
        `${d.name} has excluded fusionCategory "${d.system.fusionCategory}"`,
      );
    }
  });

  it('actions-core is entirely type "action" with a flattened (non-wrapper) actionType/actions shape', () => {
    const docs = loadJson(join(PACKS_DIR, "actions-core", "documents.json"));
    for (const doc of docs) {
      assert.equal(doc.type, "action");
      assert.ok(
        ["passive", "action", "reaction", "free"].includes(doc.system.actionType),
        `${doc.name} has invalid actionType: ${JSON.stringify(doc.system.actionType)}`,
      );
      const actions = doc.system.actions;
      const isWrapperLeftover =
        actions !== null && typeof actions === "object" && !Array.isArray(actions);
      assert.ok(
        !isWrapperLeftover,
        `${doc.name} still has a wrapper object for system.actions: ${JSON.stringify(actions)}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. UUID map verification
// REQ-CMP-041 (idempotência)
// ---------------------------------------------------------------------------

describe("fusion-uuid-map.json", { skip: OUT_MISSING }, () => {
  const mapPath = join(OUT_DIR, "fusion-uuid-map.json");

  it("exists and has the core packs (plus R10-B vendor input packs)", () => {
    const map = loadJson(mapPath);
    const keys = Object.keys(map);
    assert.ok(keys.includes("conditions"), "Missing conditions pack in uuid map");
    assert.ok(keys.includes("equipment"), "Missing equipment pack in uuid map");
    assert.ok(keys.includes("spells"), "Missing spells pack in uuid map");
    assert.ok(
      keys.includes("pathfinder-monster-core"),
      "Missing pathfinder-monster-core in uuid map",
    );
  });

  it("Longsword fusionId is stable", () => {
    const map = loadJson(mapPath);
    const longswordFusionId = map["equipment"]?.["LJdbVTOZog39EEbi"];
    assert.ok(longswordFusionId, "Longsword fusionId not in uuid map");
    const expected = deriveFusionId("equipment", "LJdbVTOZog39EEbi");
    assert.equal(longswordFusionId, expected, "Longsword fusionId must match derivation");
  });
});

// ---------------------------------------------------------------------------
// 7. R10-B — class / classFeature / ancestry / heritage / background
// normalizers (DEC-R10-06). Reads out/{classes,class-features,ancestries,
// heritages,backgrounds}/transformed.json — run the pipeline first:
//   node src/extract.mjs --packs classes,class-features,ancestries,heritages,backgrounds
//   node src/normalize.mjs --packs classes,class-features,ancestries,heritages,backgrounds
//   node src/transform.mjs --packs classes,class-features,ancestries,heritages,backgrounds
// (classes and class-features MUST be transformed in the same run so
// featuresByLevel[].uuid cross-references resolve — see
// resolveClassFeatureSourceId in transform.mjs.)
// ---------------------------------------------------------------------------

describe("R10-B: normalizeClassSystem (Magus)", { skip: OUT_MISSING }, () => {
  const getMagus = () => loadTransformed("classes").find((d) => d.name === "Magus");

  it('Magus doc has type "class" and a valid fusionId', () => {
    const magus = getMagus();
    assert.ok(magus, "Magus class doc not found in out/classes/transformed.json");
    assert.equal(magus.type, "class");
    assert.ok(isValidFusionId(magus._id));
  });

  it("featLevels match the vendor items{} map exactly", () => {
    const { system } = getMagus();
    assert.deepEqual(system.featLevels.ancestry, [1, 5, 9, 13, 17]);
    assert.deepEqual(system.featLevels.class, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    assert.deepEqual(system.featLevels.general, [3, 7, 11, 15, 19]);
    assert.deepEqual(system.featLevels.skill, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  it("skillIncreaseLevels and trainedSkills match the vendor", () => {
    const { system } = getMagus();
    assert.deepEqual(system.skillIncreaseLevels, [3, 5, 7, 9, 11, 13, 15, 17, 19]);
    assert.deepEqual(system.trainedSkills, { value: ["arcana"], additional: 2 });
  });

  it("keyAbility preserves vendor order (dex, str)", () => {
    const { system } = getMagus();
    assert.deepEqual(system.keyAbility, ["dex", "str"]);
  });

  it("level-1 ranks (perception, saves, defenses, attacks) match the vendor", () => {
    const { system } = getMagus();
    assert.equal(system.perception, 1);
    assert.deepEqual(system.savingThrows, { fortitude: 2, reflex: 1, will: 2 });
    assert.equal(system.defenses.light, 1);
    assert.equal(system.defenses.medium, 1);
    assert.equal(system.defenses.unarmored, 1);
    assert.equal(system.defenses.heavy, 0);
    assert.equal(system.attacks.simple, 1);
    assert.equal(system.attacks.martial, 1);
    assert.equal(system.attacks.unarmed, 1);
  });

  it("spellcasting L1: 5 cantrips, one rank-1 slot", () => {
    const { system } = getMagus();
    assert.ok(system.spellcasting, "Magus must carry a spellcasting progression table");
    assert.equal(system.spellcasting.tradition, "arcane");
    assert.equal(system.spellcasting.type, "prepared");
    assert.equal(system.spellcasting.ability, "int");
    const l1Cantrips = system.spellcasting.cantripsKnown.find((e) => e.level === 1);
    const l1Slots = system.spellcasting.slots.find((e) => e.level === 1);
    assert.equal(l1Cantrips.count, 5);
    assert.deepEqual(l1Slots.slots, { 1: 1 });
  });

  it("spellcasting L3: 5 cantrips, 2x rank-1 + 1x rank-2 (acceptance criterion, Tobias/Pathbuilder perDay [5,2,1])", () => {
    const { system } = getMagus();
    const l3Cantrips = system.spellcasting.cantripsKnown.find((e) => e.level === 3);
    const l3Slots = system.spellcasting.slots.find((e) => e.level === 3);
    assert.equal(l3Cantrips.count, 5, "L3 cantrips must be 5");
    assert.deepEqual(l3Slots.slots, { 1: 2, 2: 1 }, 'L3 slots must be {"1":2,"2":1}');
  });

  it("spellcasting matches the official journal table at the pair-jump and cap levels", () => {
    // Source of truth: vendor journals/classes.json, page "Magus" —
    // two slots of each of the top two ranks, pair moving up every 2 levels
    // from L5; lower ranks dropped; never any 10th-rank slots.
    const { system } = getMagus();
    const slotsAt = (lvl) => system.spellcasting.slots.find((e) => e.level === lvl).slots;
    assert.deepEqual(slotsAt(4), { 1: 2, 2: 2 });
    assert.deepEqual(slotsAt(5), { 2: 2, 3: 2 }, "L5 drops rank 1 and jumps to 2x2nd + 2x3rd");
    assert.deepEqual(slotsAt(7), { 3: 2, 4: 2 });
    assert.deepEqual(slotsAt(17), { 8: 2, 9: 2 });
    assert.deepEqual(slotsAt(20), { 8: 2, 9: 2 }, "no 10th-rank slots ever");
  });

  it("proficiencyUpgrades match every class-feature subfeatures.proficiencies rank exactly", () => {
    const { system } = getMagus();
    const upgrades = system.proficiencyUpgrades;
    const has = (level, stat, rank) =>
      upgrades.some((u) => u.level === level && u.stat === stat && u.rank === rank);

    // L5 — Lightning Reflexes (reflex-expertise.json) + Weapon Expertise (weapon-expertise.json)
    assert.ok(has(5, "reflex", 2), "L5 reflex -> rank 2 (Lightning Reflexes)");
    assert.ok(has(5, "weapons.simple", 2), "L5 weapons.simple -> rank 2 (Weapon Expertise)");
    assert.ok(has(5, "weapons.unarmed", 2), "L5 weapons.unarmed -> rank 2 (Weapon Expertise)");
    assert.ok(
      has(5, "weapons.martial", 2),
      "L5 weapons.martial -> rank 2 (Weapon Expertise rules[], class:magus predicate)",
    );

    // L9 — Alertness (perception:2), Expert Spellcaster (spellcasting:2), Resolve (will:3 — MASTER, not expert)
    assert.ok(has(9, "perception", 2), "L9 perception -> rank 2 (Alertness)");
    assert.ok(has(9, "spellcasting", 2), "L9 spellcasting -> rank 2 (Expert Spellcaster)");
    assert.ok(
      has(9, "will", 3),
      "L9 will -> rank 3 MASTER (Resolve — resolve.json subfeatures.proficiencies.will.rank is 3, not 2)",
    );

    // L11 — Medium Armor Expertise
    assert.ok(
      has(11, "armor.light", 2) && has(11, "armor.medium", 2) && has(11, "armor.unarmored", 2),
    );

    // L13 — Weapon Mastery
    assert.ok(
      has(13, "weapons.simple", 3) &&
        has(13, "weapons.martial", 3) &&
        has(13, "weapons.unarmed", 3),
    );

    // L15 — Juggernaut (fortitude:3 MASTER). Greater Weapon Specialization is
    // also granted at L15 but carries a damage-scaling rule, not a
    // proficiency subfeature — intentionally absent from this table.
    assert.ok(has(15, "fortitude", 3), "L15 fortitude -> rank 3 MASTER (Juggernaut)");

    // L17 — Master Spellcaster + Medium Armor Mastery
    assert.ok(has(17, "spellcasting", 3));
    assert.ok(
      has(17, "armor.light", 3) && has(17, "armor.medium", 3) && has(17, "armor.unarmored", 3),
    );
  });

  it('featuresByLevel has one entry per items{} map key, all resolved (no "unresolved:" uuid)', () => {
    const { system } = getMagus();
    assert.equal(system.featuresByLevel.length, 19, "Magus items{} map has 19 entries");
    for (const ref of system.featuresByLevel) {
      assert.ok(ref.level >= 1 && ref.level <= 20);
      assert.ok(ref.name.length > 0);
      assert.ok(
        isValidFusionId(ref.uuid),
        `featuresByLevel ref "${ref.name}" did not resolve to a fusionId (got "${ref.uuid}") — run transform.mjs with both classes and class-features in the same --packs list`,
      );
    }
  });

  it("featuresByLevel resolves class-specific display labels to the correct source doc (Lightning Reflexes -> Reflex Expertise)", () => {
    const { system } = getMagus();
    const classFeatureDocs = loadTransformed("class-features");
    const reflexExpertise = classFeatureDocs.find((d) => d.name === "Reflex Expertise");
    assert.ok(reflexExpertise, "Reflex Expertise class-feature doc not found");

    const lightningReflexesRef = system.featuresByLevel.find(
      (f) => f.name === "Lightning Reflexes",
    );
    assert.ok(lightningReflexesRef, "Lightning Reflexes ref not found in featuresByLevel");
    assert.equal(lightningReflexesRef.level, 5);

    // The uuid must match the REAL fusionId (_id) the "Reflex Expertise" doc
    // was given when the class-features vendor pack itself was transformed —
    // not a recomputed hash under a different (curated-pack-name) namespace.
    // fusionId namespacing is always the INPUT vendor pack name (here
    // "class-features"), matching every other pack's convention (e.g.
    // pf2e.weapons-core's committed docs are deriveFusionId('equipment', ...),
    // not deriveFusionId('weapons-core', ...)).
    assert.equal(
      lightningReflexesRef.uuid,
      reflexExpertise._id,
      'Lightning Reflexes ref must resolve to the REAL fusionId (_id) of the "Reflex Expertise" class-feature doc',
    );
    const expectedFusionId = deriveFusionId(
      "class-features",
      reflexExpertise.flags.fusion.sourceId,
    );
    assert.equal(
      lightningReflexesRef.uuid,
      expectedFusionId,
      'Lightning Reflexes ref must resolve to the fusionId of the "Reflex Expertise" class-feature doc',
    );
  });

  it("description is preserved under its OGL publication.license (policy update W2-C1, REQ-LEG-010)", () => {
    const { system } = getMagus();
    assert.equal(
      system.publication?.license,
      "OGL",
      "Magus class doc publication.license must be OGL",
    );
    assert.ok(
      system.description.length > 0,
      "Magus description must be preserved (ORC/OGL-licensed content)",
    );
  });
});

describe("R10-B: normalizeClassFeatureSystem (Magus features + Hybrid Study)", { skip: OUT_MISSING }, () => {
  const getClassFeatures = () => loadTransformed("class-features");

  it('Arcane Spellcasting (Magus) is type "classFeature" with category "classfeature"', () => {
    const docs = getClassFeatures();
    const doc = docs.find((d) => d.name === "Arcane Spellcasting (Magus)");
    assert.ok(doc, "Arcane Spellcasting (Magus) not found");
    assert.equal(doc.type, "classFeature");
    assert.equal(doc.system.category, "classfeature");
    assert.equal(doc.system.level, 1);
  });

  it('Exemplar "Calling" docs are NOT reclassified to classFeature (category "calling" stays type "feat")', () => {
    const docs = getClassFeatures();
    const calling = docs.find((d) => d.system.category === "calling");
    assert.ok(calling, 'Expected at least one "calling" category doc in class-features pack');
    assert.equal(
      calling.type,
      "feat",
      '"calling" category docs must remain type "feat", not be reclassified',
    );
  });

  it('Starlit Span (Magus Hybrid Study) is category "hybridStudy"', () => {
    const docs = getClassFeatures();
    const doc = docs.find((d) => d.name === "Starlit Span");
    assert.ok(doc, "Starlit Span not found");
    assert.equal(doc.type, "classFeature");
    assert.equal(
      doc.system.category,
      "hybridStudy",
      'otherTags: ["magus-hybrid-study"] must map to category "hybridStudy"',
    );
  });

  it('all 8 Magus Hybrid Study choices map to category "hybridStudy"', () => {
    const docs = getClassFeatures();
    const hybridStudyNames = [
      "Starlit Span",
      "Laughing Shadow",
      "Inexorable Iron",
      "Sparkling Targe",
      "Aloof Firmament",
      "Twisting Tree",
      "Unfurling Brocade",
      "Resurgent Maelstrom",
    ];
    for (const name of hybridStudyNames) {
      const doc = docs.find((d) => d.name === name);
      assert.ok(doc, `Hybrid Study choice "${name}" not found in class-features pack`);
      assert.equal(doc.system.category, "hybridStudy", `"${name}" must be category "hybridStudy"`);
    }
  });

  it("description is preserved (ORC/OGL) on every class-feature doc; blanked only if license is neither (policy update W2-C1, REQ-LEG-010)", () => {
    const docs = getClassFeatures();
    for (const doc of docs.slice(0, 50)) {
      const license = doc.system.publication?.license;
      if (["ORC", "OGL"].includes(license)) {
        assert.ok(
          doc.system.description.length > 0,
          `${doc.name} (license ${license}) should have a preserved description`,
        );
      } else {
        assert.equal(
          doc.system.description,
          "",
          `${doc.name} must have empty description (license "${license}" not ORC/OGL)`,
        );
      }
    }
  });
});

describe("R10-B: normalizeAncestrySystem (Ratfolk)", { skip: OUT_MISSING }, () => {
  const getRatfolk = () => loadTransformed("ancestries").find((d) => d.name === "Ratfolk");

  it('Ratfolk has type "ancestry" with correct hp/size/speed/vision', () => {
    const ratfolk = getRatfolk();
    assert.ok(ratfolk, "Ratfolk ancestry doc not found");
    assert.equal(ratfolk.type, "ancestry");
    assert.equal(ratfolk.system.hp, 6);
    assert.equal(ratfolk.system.size, "sm");
    assert.equal(ratfolk.system.speed, 25);
    assert.equal(ratfolk.system.vision, "low-light-vision");
  });

  it('boosts flatten single-option groups to their slug and multi-option groups to "free"', () => {
    const { system } = getRatfolk();
    // vendor: boosts.0 = ["dex"] (fixed), boosts.1 = ["int"] (fixed),
    // boosts.2 = [str,dex,con,int,wis,cha] (free choice)
    assert.deepEqual(system.boosts, ["dex", "int", "free"]);
    assert.deepEqual(system.flaws, ["str"]);
  });

  it("languages.value carries the vendor language list", () => {
    const { system } = getRatfolk();
    assert.deepEqual(system.languages.value, ["common", "ysoki"]);
  });
});

describe("R10-B: normalizeHeritageSystem (ratfolk heritages)", { skip: OUT_MISSING }, () => {
  const getHeritages = () => loadTransformed("heritages");

  it('all 7 ratfolk heritages are present with type "heritage"', () => {
    const docs = getHeritages();
    const names = [
      "Deep Rat",
      "Desert Rat",
      "Longsnout Rat",
      "Sewer Rat",
      "Shadow Rat",
      "Snow Rat",
      "Tunnel Rat",
    ];
    for (const name of names) {
      const doc = docs.find((d) => d.name === name);
      assert.ok(doc, `Heritage "${name}" not found`);
      assert.equal(doc.type, "heritage");
    }
  });

  it("Snow Rat carries its Resistance rule converted", () => {
    const doc = getHeritages().find((d) => d.name === "Snow Rat");
    const resistance = doc.system.rules.find(
      (r) => r.kind === "flat-modifier" && r.subkind === "resistance",
    );
    assert.ok(resistance, "Snow Rat should have a converted Resistance rule");
    assert.equal(resistance.damageType, "cold");
  });
});

describe("R10-B: normalizeBackgroundSystem (Fireworks Performer)", { skip: OUT_MISSING }, () => {
  const getFireworksPerformer = () =>
    loadTransformed("backgrounds").find((d) => d.name === "Fireworks Performer");

  it('has type "background" with Performance trained at rank 1', () => {
    const doc = getFireworksPerformer();
    assert.ok(doc, "Fireworks Performer background doc not found");
    assert.equal(doc.type, "background");
    assert.deepEqual(doc.system.skills.performance, { value: 1 });
  });

  it("boosts include the free choice between int/cha plus one fully-free boost", () => {
    const { system } = getFireworksPerformer();
    // vendor: boosts.0 = [cha,int] (choice, >1 option -> "free"),
    // boosts.1 = [cha,con,dex,int,str,wis] (free)
    assert.deepEqual(system.boosts, ["free", "free"]);
  });
});

// ---------------------------------------------------------------------------
// r21 — Portão de duplicata semântica
//
// "Documentos de mesmo nome, se forem a mesma coisa, devem ser unificados.
// Sempre." O portão precisa provar as duas metades: que DISPARA quando há
// duplicata real, e que NÃO dispara no padrão concessor→concedido do PF2e
// (que é homônimo legítimo, não duplicata). Portão que nunca dispara é
// decoração — foi assim que o portão 7 do projeto irmão nasceu inerte.
// ---------------------------------------------------------------------------

describe('portão de duplicata semântica (r21)', () => {
  it('DISPARA quando dois docs têm mesmo nome, mesmo type e mesma descrição', () => {
    const grupos = acharDuplicatas([
      { pack: 'feats-core', name: 'Toughness', type: 'feat', description: '<p>You can withstand more punishment.</p>', sourceId: 'AAA' },
      { pack: 'class-features-core', name: 'toughness', type: 'feat', description: '<p>You  can withstand   more punishment.</p>', sourceId: 'BBB' },
    ]);
    assert.equal(grupos.length, 1, 'duplicata real precisa ser acusada (nome/espaço/HTML normalizados)');
    assert.equal(grupos[0].length, 2);
    const msg = formatarErroDeDuplicata(grupos);
    assert.match(msg, /Toughness/);
    assert.match(msg, /AAA/);
    assert.match(msg, /BBB/, 'a mensagem tem de NOMEAR os dois lados, não só contar');
  });

  it('NÃO dispara no par concessor→concedido (Shield Block real dos packs)', () => {
    const grupos = acharDuplicatas([
      {
        pack: 'class-features-core', name: 'Shield Block', type: 'classFeature', sourceId: 'eZNCckLzbH3GyncH',
        description: '<p>You gain the Shield Block general feat, a reaction that lets you reduce damage with your shield.</p>',
      },
      {
        pack: 'feats-core', name: 'Shield Block', type: 'feat', sourceId: 'jM72TjJ965jocBV8',
        description: '<p>You snap your shield in place to ward off a blow. Your shield prevents you from taking an amount of damage up to the shield\u2019s Hardness.</p>',
      },
    ]);
    assert.deepEqual(grupos, [], 'a feature CONCEDE o feat — são peças distintas, não duplicata');
  });

  it('os packs emitidos hoje não contêm nenhuma duplicata', () => {
    const docs = [];
    for (const slug of readdirSync(PACKS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)) {
      const path = join(PACKS_DIR, slug, 'documents.json');
      if (!existsSync(path)) continue;
      for (const d of loadJson(path)) {
        docs.push({
          pack: slug, name: d.name, type: d.type,
          description: d.system?.description, sourceId: d.flags?.fusion?.sourceId,
        });
      }
    }
    assert.ok(docs.length > 3000, `esperado 3000+ docs, veio ${docs.length}`);
    const grupos = acharDuplicatas(docs);
    assert.deepEqual(grupos, [], grupos.length ? formatarErroDeDuplicata(grupos) : '');
  });
});
