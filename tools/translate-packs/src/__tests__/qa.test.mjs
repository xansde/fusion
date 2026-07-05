/**
 * qa.test.mjs — tests for the automated per-doc translation QA checks
 * (qa.mjs's checkDoc: dice-formulas, balanced-tags, glossary-applied,
 * length-ratio, no-new-enrichers).
 *
 * Owner: implementer A (pipeline). Runs under `node --test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDoc, runQaForPack } from "../qa-checks.mjs";
import { loadGlossary } from "../glossary.mjs";

const glossary = loadGlossary();

test("checkDoc passes a well-formed translation with identical dice, tags, and matching length", () => {
  const failures = checkDoc({
    nameEn: "Fireball",
    descriptionEn: "<p>You deal 6d6 fire damage.</p>",
    entry: { name: "Bola de Fogo", description: "<p>Você causa 6d6 de dano de fogo.</p>" },
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("checkDoc has no failures for a name-only translation (no description field)", () => {
  const failures = checkDoc({
    nameEn: "Fireball",
    descriptionEn: "<p>You deal 6d6 fire damage.</p>",
    entry: { name: "Bola de Fogo" }, // description omitted on purpose
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("checkDoc returns [] when there's no overlay entry at all (untranslated, not a QA failure)", () => {
  const failures = checkDoc({ nameEn: "Fireball", descriptionEn: "<p>...</p>", entry: undefined, glossary });
  assert.deepEqual(failures, []);
});

test("dice-formulas: fails when PT drops or changes a dice expression", () => {
  const failures = checkDoc({
    nameEn: "Fireball",
    descriptionEn: "<p>You deal 6d6 fire damage.</p>",
    entry: { name: "Bola de Fogo", description: "<p>Você causa 8d6 de dano de fogo.</p>" },
    glossary,
  });
  assert.ok(failures.some((f) => f.startsWith("dice-formulas")));
});

test("dice-formulas: passes when a modifier-bearing formula matches exactly (e.g. 1d4+2)", () => {
  const failures = checkDoc({
    nameEn: "Poison Dart",
    descriptionEn: "<p>Deal 1d4+2 poison damage.</p>",
    entry: { name: "Dardo Envenenado", description: "<p>Cause 1d4+2 de dano de veneno.</p>" },
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("balanced-tags: fails when PT drops a tag present in EN", () => {
  const failures = checkDoc({
    nameEn: "Some Feat",
    descriptionEn: "<p>Line one.</p><p>Line two.</p>",
    entry: { name: "Algum Talento", description: "<p>Linha um e linha dois.</p>" },
    glossary,
  });
  assert.ok(failures.some((f) => f.startsWith("balanced-tags")));
});

test("balanced-tags: passes when PT has the same tag multiset as EN (order/content may differ)", () => {
  const failures = checkDoc({
    nameEn: "Some Feat",
    descriptionEn: "<p>Line <strong>one</strong>.</p><p>Line two.</p>",
    entry: { name: "Algum Talento", description: "<p>Linha <strong>um</strong>.</p><p>Linha dois.</p>" },
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("glossary-applied: fails when EN has recognizable glossary terms but PT translates none of them", () => {
  const failures = checkDoc({
    nameEn: "Some Feat",
    descriptionEn: "<p>You become trained in this skill and gain a class feat.</p>",
    // Deliberately avoid the pt-BR glossary terms ("treinado"/"pericia"/"talento de classe").
    entry: { name: "Algum Talento", description: "<p>Texto sem nenhum termo mecanico reconhecido aqui.</p>" },
    glossary,
  });
  assert.ok(failures.some((f) => f.startsWith("glossary-applied")));
});

test("glossary-applied: passes when at least one EN glossary term is translated in PT", () => {
  const failures = checkDoc({
    nameEn: "Some Feat",
    descriptionEn: "<p>You become trained in this skill.</p>",
    entry: { name: "Algum Talento", description: "<p>Você se torna treinado nesta pericia.</p>" },
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("glossary-applied: skipped (no failure) when EN text has zero recognized glossary terms", () => {
  const failures = checkDoc({
    nameEn: "Odd Doc",
    descriptionEn: "<p>Xyzzy plugh wibble.</p>",
    entry: { name: "Doc Estranho", description: "<p>Xyzzy plugh wibble em portugues.</p>" },
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("length-ratio: fails when PT is far shorter than EN (ratio < 0.5)", () => {
  const failures = checkDoc({
    nameEn: "Long Feat",
    descriptionEn: "<p>" + "word ".repeat(100) + "</p>",
    entry: { name: "Talento Longo", description: "<p>curto</p>" },
    glossary,
  });
  assert.ok(failures.some((f) => f.startsWith("length-ratio")));
});

test("length-ratio: fails when PT is far longer than EN (ratio > 2.0)", () => {
  const failures = checkDoc({
    nameEn: "Short Feat",
    descriptionEn: "<p>curto</p>",
    entry: { name: "Talento Curto", description: "<p>" + "palavra ".repeat(100) + "</p>" },
    glossary,
  });
  assert.ok(failures.some((f) => f.startsWith("length-ratio")));
});

test("no-new-enrichers: fails when PT introduces an @UUID enricher not present in EN", () => {
  const failures = checkDoc({
    nameEn: "Some Feat",
    descriptionEn: "<p>Plain text with no enrichers.</p>",
    entry: {
      name: "Algum Talento",
      description: '<p>Texto com @UUID[Compendium.pf2e.feats-srd.Item.Foo]{Foo} novo.</p>',
    },
    glossary,
  });
  assert.ok(failures.some((f) => f.startsWith("no-new-enrichers")));
});

test("no-new-enrichers: passes when PT preserves an EN enricher verbatim, translating only the label", () => {
  const failures = checkDoc({
    nameEn: "Some Feat",
    descriptionEn: '<p>You gain @UUID[Compendium.pf2e.actionspf2e.Item.Quick Alchemy]{Quick Alchemy}.</p>',
    entry: {
      name: "Algum Talento",
      description:
        '<p>Você ganha @UUID[Compendium.pf2e.actionspf2e.Item.Quick Alchemy]{Quick Alchemy}.</p>',
    },
    glossary,
  });
  assert.deepEqual(failures, []);
});

test("runQaForPack skips docs with no overlay entry and reports pass/fail per translated doc", () => {
  const docs = [
    { _id: "d1", name: "Fireball", system: { description: "<p>You deal 6d6 fire damage.</p>" } },
    { _id: "d2", name: "Untranslated", system: { description: "<p>No entry for this one.</p>" } },
  ];
  const overlay = {
    entries: {
      d1: { name: "Bola de Fogo", description: "<p>Você causa 6d6 de dano de fogo.</p>", sourceHash: "x" },
    },
  };
  const results = runQaForPack(docs, overlay, glossary);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "d1");
  assert.equal(results[0].pass, true);
});
