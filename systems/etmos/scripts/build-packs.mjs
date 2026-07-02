/**
 * build-packs.mjs — builds systems/etmos/packs/<slug>/{pack.json,documents.json,index.json}
 * from the hand-authored source data in systems/etmos/packs-src/*.json.
 *
 * Mirrors the OUTPUT FORMAT of tools/importer-pf2e/src/build-mvp-subset.mjs
 * (same pack.json/documents.json/index.json shape consumed by
 * packages/server/src/compendium/service.ts), but does NOT go through the
 * importer pipeline — Etmos data is hand-authored (editorial), not converted
 * from an external repo (spec 19 D1: "compendiums criados à mão").
 *
 * Packs built:
 *   - etmos.particulas   (Item, subtype "particula")  — 81 canonical entries,
 *     "Mat" EXCLUDED from the default catalog (D3/R2 — verify:true, not
 *     canonical; the packs-src entry is preserved as source data, only the
 *     BUILD step omits it from the playable default pack).
 *   - etmos.origens      (Item, subtype "origem")      — 5 SRD + 5 Quickstart
 *   - etmos.habilidades  (Item, subtype "habilidade")  — SRD práticas/teóricas
 *     + Quickstart entries
 *   - etmos.antagonistas (Actor, subtype "antagonista") — the 2 exemplo_fichas
 *     entries in antagonistas.json (aptidoes_canonicas are catalog metadata,
 *     not embedded here — Actor documents get their aptidoes as plain-text
 *     descriptors per AntagonistaSystem.aptidoes, per schema shape)
 *
 * `verify: true` entries are PRESERVED in documents.json (never stripped from
 * the data) — only "Mat" is additionally excluded from the compiled catalog,
 * matching D3's explicit instruction ("o compendium padrão traz 18 Funções
 * sem 'Mat' como Função default disponível").
 *
 * License: PackSource.repo/version are `null` (editorial pack, not converted
 * from an external repo — PackSourceSchema in @fusion/shared explicitly
 * documents this case: "null for editorial packs (Etmos)"). PackLicense.license
 * is "proprietary" (Editora Balde Galáctico, no open license — spec 19 intro).
 *
 * Zero external dependencies — Node 22 ESM puro, mirrors
 * tools/importer-pf2e/src/build-mvp-subset.mjs's style.
 *
 * Usage: node scripts/build-packs.mjs   (or `pnpm build:packs`)
 *
 * REQ-ETM-046, REQ-CMP-001..004, REQ-CMP-040. Spec 16 §Formato de pack.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const SRC_DIR = join(PKG_ROOT, "packs-src");
const OUT_DIR = join(PKG_ROOT, "packs");

const SYSTEM_ID = "etmos";
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Deterministic-ish id generator (nanoid-like, 16 chars) — build-time only,
// stable across re-runs is NOT required (packs are regenerated wholesale).
// ---------------------------------------------------------------------------

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateId(len = 16) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared pack.json fields
// ---------------------------------------------------------------------------

const EDITORIAL_LICENSE = {
  license: "proprietary",
  attribution: "Etmos RPG © Editora Balde Galáctico (autor: Rafa Reis). Uso privado do grupo de jogo.",
  reservedNotice:
    "Etmos RPG, Editora Balde Galáctico e seus respectivos logos são marcas de seus titulares. Não distribuir sem autorização — ver specs/26-licencas-e-legal.md.",
};

const EDITORIAL_SOURCE = {
  repo: null,
  version: null,
  importerVersion: "0.1.0",
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * Writes pack.json + documents.json + index.json to packs/<slug>/.
 */
function writePack(slug, documentType, docs, indexFields) {
  const packDir = join(OUT_DIR, slug);
  mkdirSync(packDir, { recursive: true });

  const manifest = {
    id: `${SYSTEM_ID}.${slug}`,
    label: PACK_LABELS[slug],
    documentType,
    systemId: SYSTEM_ID,
    indexFields,
    license: EDITORIAL_LICENSE,
    source: EDITORIAL_SOURCE,
    documentCount: docs.length,
    generatedAt: nowIso(),
    schemaVersion: SCHEMA_VERSION,
  };

  writeFileSync(join(packDir, "pack.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(docs, null, 2) + "\n", "utf8");

  const index = docs.map((doc) => {
    const indexData = {};
    for (const field of indexFields) {
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
      uuid: `Compendium.${manifest.id}.${documentType}.${doc._id}`,
      name: doc.name,
      img: doc.img ?? null,
      type: doc.type ?? null,
      index: indexData,
    };
  });

  writeFileSync(join(packDir, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");

  console.log(`[build-packs] ${manifest.id}: ${docs.length} docs -> systems/etmos/packs/${slug}/`);
  return manifest;
}

const PACK_LABELS = {
  particulas: "Etmos — Partículas do Grimório",
  origens: "Etmos — Origens",
  habilidades: "Etmos — Habilidades",
  antagonistas: "Etmos — Antagonistas (exemplos)",
};

// ---------------------------------------------------------------------------
// particulas.json -> etmos.particulas (Item, subtype "particula")
// "Mat" excluded from the default catalog (D3 / R2).
// ---------------------------------------------------------------------------

function buildParticulas() {
  const raw = JSON.parse(readFileSync(join(SRC_DIR, "particulas.json"), "utf8"));

  /** @param {any[]} list @param {string} categoria */
  function toDocs(list, categoria) {
    return list
      .filter((p) => !(categoria === "funcao" && p.id === "mat")) // D3: exclude "Mat" from default catalog
      .map((p) => ({
        _id: generateId(),
        name: p.nome,
        type: "particula",
        img: null,
        system: {
          slug: p.id,
          palavra_etmos: p.palavra_etmos,
          categoria,
          significado: p.nome,
          descricao: p.descricao ?? "",
          nivel_grimorio: p.nivel_grimorio ?? null,
          subtipo_complemento: p.subtipo ?? null,
          icone_runico: null,
          verify: p.verify === true,
        },
      }));
  }

  const docs = [
    ...toDocs(raw.funcoes, "funcao"),
    ...toDocs(raw.objetos, "objeto"),
    ...toDocs(raw.caracteristicas, "caracteristica"),
    ...toDocs(raw.complementos, "complemento"),
  ];

  return writePack("particulas", "Item", docs, [
    "system.slug",
    "system.categoria",
    "system.nivel_grimorio",
    "system.subtipo_complemento",
    "system.verify",
  ]);
}

// ---------------------------------------------------------------------------
// origens.json -> etmos.origens (Item, subtype "origem")
//
// NOTE: packs-src uses adjective forms "mundana"/"fantastica" (agreeing with
// "Origem"), while OrigemSystemSchema (spec 19, shared Mundo vocabulary with
// Orador.mundo_origem) uses "mundano"/"fantastico". Normalized here so the
// compiled pack always satisfies the schema.
// ---------------------------------------------------------------------------

/** @param {string} tipo */
function normalizeMundoAssociado(tipo) {
  if (tipo === "mundana") return "mundano";
  if (tipo === "fantastica") return "fantastico";
  return tipo;
}

function buildOrigens() {
  const raw = JSON.parse(readFileSync(join(SRC_DIR, "origens.json"), "utf8"));

  const canonicas = raw.origens.map((o) => ({
    _id: generateId(),
    name: o.nome,
    type: "origem",
    img: null,
    system: {
      mundo_associado: normalizeMundoAssociado(o.tipo),
      exclusiva: o.exclusiva === true,
      descricao: o.descricao ?? "",
      efeito_mecanico: o.efeito_mecanico ?? "",
    },
  }));

  const quickstart = (raw.origens_quickstart?.lista ?? []).map((o) => ({
    _id: generateId(),
    name: o.nome,
    type: "origem",
    img: null,
    system: {
      mundo_associado: "ambos",
      exclusiva: false,
      descricao: "",
      efeito_mecanico: o.efeito_mecanico ?? "",
    },
  }));

  const docs = [...canonicas, ...quickstart];

  return writePack("origens", "Item", docs, ["system.mundo_associado", "system.exclusiva"]);
}

// ---------------------------------------------------------------------------
// habilidades.json -> etmos.habilidades (Item, subtype "habilidade")
// ---------------------------------------------------------------------------

function buildHabilidades() {
  const raw = JSON.parse(readFileSync(join(SRC_DIR, "habilidades.json"), "utf8"));

  /** @param {any[]} list @param {"pratica"|"teorica"} categoria */
  function toDocs(list, categoria) {
    return list.map((h) => ({
      _id: generateId(),
      name: h.nome,
      type: "habilidade",
      img: null,
      system: {
        categoria,
        descricao: h.descricao ?? "",
        bonus: h.bonus ?? h.bonus_por_escolha ?? 0,
        usos_por_dia: null,
        requer_acao: false,
        escolhivel_multiplas_vezes: h.escolhivel_multiplas_vezes === true,
      },
    }));
  }

  const quickstart = (raw.habilidades_quickstart?.lista ?? []).map((h) => ({
    _id: generateId(),
    name: h.nome,
    type: "habilidade",
    img: null,
    system: {
      categoria: h.tipo,
      descricao: "",
      bonus: 0,
      usos_por_dia: null,
      requer_acao: false,
      escolhivel_multiplas_vezes: false,
    },
  }));

  const docs = [
    ...toDocs(raw.habilidades_praticas, "pratica"),
    ...toDocs(raw.habilidades_teoricas, "teorica"),
    ...quickstart,
  ];

  return writePack("habilidades", "Item", docs, ["system.categoria"]);
}

// ---------------------------------------------------------------------------
// antagonistas.json -> etmos.antagonistas (Actor, subtype "antagonista")
// Only exemplos_fichas become Actor documents (aptidoes_canonicas are a
// catalog of Aptidão descriptors, referenced by name in the exemplo fichas'
// `aptidoes` list — folded in as plain descriptive text per the schema).
// ---------------------------------------------------------------------------

function buildAntagonistas() {
  const raw = JSON.parse(readFileSync(join(SRC_DIR, "antagonistas.json"), "utf8"));

  const aptidaoByName = new Map(
    (raw.aptidoes_canonicas ?? []).map((a) => [a.nome, a.descricao ?? ""]),
  );

  const docs = (raw.exemplos_fichas ?? []).map((f) => ({
    _id: generateId(),
    name: f.nome,
    type: "antagonista",
    img: null,
    system: {
      ficha_base: f.ficha_base,
      ferimentos: { atual: 0, limite: f.limite_ferimentos ?? 4 },
      estresse: { atual: 0, limite: f.limite_estresse ?? 4 },
      complexidade_maxima: f.complexidade_maxima ?? "regular",
      movimentacao: f.movimentacao_m ?? 6,
      comunicacao: f.comunicacao === true,
      atributos: {
        corpo: f.atributos?.corpo ?? 0,
        alma: f.atributos?.alma ?? 0,
        mente: f.atributos?.mente ?? 0,
      },
      aptidoes: (f.aptidoes ?? []).map((nome) => ({
        nome,
        descricao: aptidaoByName.get(nome) ?? "",
      })),
      ataques: (f.ataques ?? []).map((nome) => ({
        nome,
        ferimentos: null,
        defesa: null,
        alcance: "",
        descricao: "",
      })),
    },
  }));

  return writePack("antagonistas", "Actor", docs, [
    "system.ficha_base",
    "system.complexidade_maxima",
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("[build-packs] Building systems/etmos/packs/ from packs-src/...\n");
  mkdirSync(OUT_DIR, { recursive: true });

  const report = { packs: [], generatedAt: nowIso() };

  report.packs.push({ slug: "particulas", ...summarize(buildParticulas()) });
  report.packs.push({ slug: "origens", ...summarize(buildOrigens()) });
  report.packs.push({ slug: "habilidades", ...summarize(buildHabilidades()) });
  report.packs.push({ slug: "antagonistas", ...summarize(buildAntagonistas()) });

  writeFileSync(join(OUT_DIR, "build-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("\n[build-packs] === SUMÁRIO ===");
  for (const p of report.packs) {
    console.log(`  ${p.packId}: ${p.documentCount} documentos`);
  }
}

function summarize(manifest) {
  return { packId: manifest.id, documentCount: manifest.documentCount };
}

/**
 * Finds the monorepo root by walking up from PKG_ROOT until a directory
 * containing `node_modules/.bin/prettier{,.CMD}` is found. Mirrors pnpm
 * workspace hoisting — prettier is a root devDependency, not a dependency
 * of systems/etmos.
 */
function findMonorepoRootWithPrettier() {
  let dir = PKG_ROOT;
  for (let i = 0; i < 6; i++) {
    const bin = join(dir, "node_modules", ".bin", process.platform === "win32" ? "prettier.CMD" : "prettier");
    if (existsSync(bin)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Runs `prettier --write` over the freshly generated packs/ output as the
 * final build step. Required because prettier collapses short JSON arrays
 * (e.g. `indexFields` with 1-2 entries) onto a single line, while
 * `JSON.stringify(x, null, 2)` always expands them across multiple lines —
 * without this step `pnpm format:check` fails deterministically on the
 * generated pack.json files. The pf2e/sf2e packs are versioned
 * prettier-clean, so formatting the output (not ignoring it) matches repo
 * convention.
 */
function formatGeneratedPacks() {
  const root = findMonorepoRootWithPrettier();
  if (!root) {
    console.warn(
      "[build-packs] WARNING: prettier binary not found in any ancestor node_modules/.bin — " +
        "skipping auto-format. Run `pnpm format` manually before committing.",
    );
    return;
  }

  const prettierBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "prettier.CMD" : "prettier");
  const target = join(OUT_DIR, "**", "*.json").split("\\").join("/");

  const result = spawnSync(prettierBin, ["--write", target], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`[build-packs] prettier --write failed with exit code ${result.status}`);
  }

  console.log("[build-packs] Formatted systems/etmos/packs/**/*.json with prettier.");
}

main();
formatGeneratedPacks();
