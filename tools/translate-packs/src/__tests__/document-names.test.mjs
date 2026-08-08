/**
 * document-names.test.mjs — tests for the EN→pt-BR document-name index
 * merge logic (issue #32's prerequisite-translation renderer). Runs under
 * `node --test`. Pure in-memory fixtures.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentNameIndex } from "../document-names.mjs";

function pack(docsWithNames) {
  const docs = docsWithNames.map(([id, name]) => ({ _id: id, name }));
  const entries = {};
  for (const [id, , pt] of docsWithNames) {
    if (pt !== undefined) entries[id] = { name: pt };
  }
  return { docs, overlay: { entries } };
}

test("buildDocumentNameIndex maps a translated EN name (lowercased) to its pt-BR name", () => {
  const feats = pack([["f1", "Dragon Instinct", "Instinto Dracônico"]]);
  const index = buildDocumentNameIndex([feats]);
  assert.equal(index.get("dragon instinct"), "Instinto Dracônico");
});

test("buildDocumentNameIndex skips a document with no overlay entry at all", () => {
  const feats = pack([["f1", "Untranslated Feat"]]); // no third element -> no overlay entry
  const index = buildDocumentNameIndex([feats]);
  assert.equal(index.has("untranslated feat"), false);
});

test("buildDocumentNameIndex: EARLIER pack in priority order wins a cross-pack collision", () => {
  const feats = pack([["f1", "Counterspell", "Contramagia (talento)"]]);
  const actions = pack([["a1", "Counterspell", "Contramagia (ação)"]]);
  const index = buildDocumentNameIndex([feats, actions]); // feats-core priority
  assert.equal(index.get("counterspell"), "Contramagia (talento)");
});

test("buildDocumentNameIndex: a LATER pack still fills in names the earlier pack doesn't have", () => {
  const feats = pack([["f1", "Dragon Instinct", "Instinto Dracônico"]]);
  const classFeatures = pack([["cf1", "Enigma", "Enigma"]]);
  const index = buildDocumentNameIndex([feats, classFeatures]);
  assert.equal(index.get("dragon instinct"), "Instinto Dracônico");
  assert.equal(index.get("enigma"), "Enigma");
});

test("buildDocumentNameIndex: a same-pack homonym with DIFFERING translations is dropped, never guessed", () => {
  const feats = pack([
    ["f1", "Ricochet Stance", "Postura Ricochete (Investigador)"],
    ["f2", "Ricochet Stance", "Postura Ricochete (Ladino)"],
  ]);
  const index = buildDocumentNameIndex([feats]);
  assert.equal(index.has("ricochet stance"), false);
});

test("buildDocumentNameIndex: a same-pack homonym with IDENTICAL translations is kept", () => {
  const feats = pack([
    ["f1", "Assurance", "Garantia"],
    ["f2", "Assurance", "Garantia"],
  ]);
  const index = buildDocumentNameIndex([feats]);
  assert.equal(index.get("assurance"), "Garantia");
});

test("buildDocumentNameIndex: a same-pack homonym does not shadow a different pack's unambiguous entry", () => {
  // feats-core has an ambiguous "Ricochet Stance"; class-features-core has an
  // unambiguous one. The dropped feats-core pair must not block the fallback
  // pack's entry from being used.
  const feats = pack([
    ["f1", "Ricochet Stance", "Postura Ricochete (Investigador)"],
    ["f2", "Ricochet Stance", "Postura Ricochete (Ladino)"],
  ]);
  const classFeatures = pack([["cf1", "Ricochet Stance", "Postura Ricochete"]]);
  const index = buildDocumentNameIndex([feats, classFeatures]);
  assert.equal(index.get("ricochet stance"), "Postura Ricochete");
});

test("buildDocumentNameIndex returns an empty map for empty input", () => {
  const index = buildDocumentNameIndex([]);
  assert.equal(index.size, 0);
});
