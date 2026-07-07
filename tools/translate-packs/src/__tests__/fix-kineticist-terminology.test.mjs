/**
 * fix-kineticist-terminology.test.mjs — living coverage test for
 * fix-kineticist-terminology.mjs (r20-X3: Kineticist noun unification).
 *
 * Covers the invariants the script must hold:
 *   1. Whole-word substitution with case preservation (lower/Title/UPPER),
 *      singular and plural.
 *   2. Enricher STRUCTURAL spans (`@Tag[...]`) are never touched; the
 *      optional trailing `{label}` IS eligible.
 *   3. Idempotency: re-applying fixText to already-fixed text is a no-op,
 *      and "cineticista(s)" itself is never touched (no ping-pong).
 *
 * Runs under `node --test` (repo pattern: `pnpm test` -> node --test src/__tests__/*.test.mjs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fixText } from "../fix-kineticist-terminology.mjs";

// ===========================================================================
// 1. Whole-word substitution + case preservation.
// ===========================================================================
test("fixes lowercase singular 'cinetista' -> 'cineticista'", () => {
  const { text, count } = fixText("Escolha um dos seus elementos cinetista para afetar.");
  assert.match(text, /elementos cineticista/);
  assert.equal(count, 1);
});

test("fixes lowercase plural 'cinetistas' -> 'cineticistas'", () => {
  const { text, count } = fixText("Escolha um dos seus elementos cinetistas para afetar.");
  assert.match(text, /elementos cineticistas/);
  assert.equal(count, 1);
});

test("preserves Title case on the first letter", () => {
  const { text, count } = fixText("Cinetista é o traço da classe.");
  assert.match(text, /^Cineticista é/);
  assert.equal(count, 1);
});

test("preserves ALL-CAPS", () => {
  const { text, count } = fixText("TRAÇO: CINETISTA");
  assert.match(text, /CINETICISTA/);
  assert.equal(count, 1);
});

test("real-world regression: 'aura cinetista' / 'portal cinetista' (Canalizar Elementos)", () => {
  const input =
    "<p><strong>Requisitos</strong> Seu portal cinetista não está ativo.</p>\n" +
    "<p>Você toca seu portal cinetista para fazer os elementos fluírem ao seu redor. " +
    "Sua aura cinetista é ativada.</p>";
  const { text, count } = fixText(input);
  assert.match(text, /portal cineticista/);
  assert.match(text, /aura cineticista/);
  assert.equal(count, 3);
});

// ===========================================================================
// 2. Enricher structural spans are never touched; the {label} tail is.
// ===========================================================================
test("never touches the structural part of an enricher (dice formulas, save types, slugs)", () => {
  const input =
    "O alvo se torna suscetível conforme seu teste de @Check[fortitude|against:cinetista] resistência contra sua CD.";
  const { text } = fixText(input);
  assert.match(text, /@Check\[fortitude\|against:cinetista\]/);
});

test("still fixes the optional trailing {label} of an enricher", () => {
  const input = "Você ganha o traço @UUID[Compendium.pf2e.trait.Item.Kineticist]{Cinetista}.";
  const { text, count } = fixText(input);
  assert.match(text, /@UUID\[Compendium\.pf2e\.trait\.Item\.Kineticist\]\{Cineticista\}/);
  assert.equal(count, 1);
});

// ===========================================================================
// 3. Idempotency.
// ===========================================================================
test("re-applying fixText to already-fixed text is a no-op", () => {
  const input = "Escolha um dos seus elementos cinetistas. Sua aura cinetista é ativada.";
  const first = fixText(input);
  const second = fixText(first.text);
  assert.equal(second.count, 0, "second pass must find nothing left to fix");
  assert.equal(second.text, first.text);
});

test("never matches the canonical 'cineticista(s)' spelling (no ping-pong)", () => {
  const { text, count } = fixText("O Cineticista canaliza seus elementos cineticistas.");
  assert.equal(count, 0);
  assert.equal(text, "O Cineticista canaliza seus elementos cineticistas.");
});
