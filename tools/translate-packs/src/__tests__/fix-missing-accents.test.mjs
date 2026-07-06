/**
 * fix-missing-accents.test.mjs — living coverage test for
 * fix-missing-accents.mjs (r15 batch A3: pt-BR accent restoration).
 *
 * Covers the invariants the script must hold:
 *   1. Whole-word substitution with case preservation (lower/Title/UPPER).
 *   2. Enricher STRUCTURAL spans (`@Tag[...]`) are never touched; the
 *      optional trailing `{label}` IS eligible.
 *   3. Known-ambiguous words (e.g. "critica"/"critico" as verb forms,
 *      "silencia" as a verb, "tem"/"esta"/"para") are left untouched by the
 *      blanket dictionary/suffix rules.
 *   4. Idempotency: re-applying fixText to already-fixed text is a no-op.
 *   5. The word-boundary phrase fixes (WRONG_ACCENT_FIXES) don't corrupt a
 *      longer word that merely starts with the same phrase (regression test
 *      for the "falha critica" / "falha criticamente" bug found during r15
 *      dictionary curation).
 *
 * Runs under `node --test` (repo pattern: `pnpm test` -> node --test src/__tests__/*.test.mjs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fixText, lookupReplacement, DICTIONARY } from "../fix-missing-accents.mjs";

// ===========================================================================
// 1. Whole-word substitution + case preservation.
// ===========================================================================
test("fixes a known unaccented word, preserving lowercase", () => {
  const { text, count } = fixText("voce nao gosta de magica");
  assert.equal(text, "você não gosta de mágica");
  assert.equal(count, 3);
});

test("preserves Title case on the first letter", () => {
  const { text, count } = fixText("Voce reune energia magica");
  assert.equal(text, "Você reune energia mágica");
  assert.equal(count, 2);
});

test("preserves ALL-CAPS", () => {
  const { text, count } = fixText("VOCE NAO PODE");
  assert.equal(text, "VOCÊ NÃO PODE");
  assert.equal(count, 2);
});

test("applies the generic -cao/-coes suffix rule to nouns not in the literal dictionary", () => {
  const { text, count } = fixText("Esta e uma evocacao poderosa com duas reacoes.");
  assert.match(text, /evocação/);
  assert.match(text, /reações/);
  assert.equal(count, 2);
});

// ===========================================================================
// 2. Enricher structural spans are never touched; the {label} tail is.
// ===========================================================================
test("never touches the structural part of an enricher (dice formulas, UUIDs, slugs)", () => {
  const input =
    "Voce causa @Damage[(@item.rank*2)d6[electricity]] dano em uma @Template[emanation|distance:10] ao redor.";
  const { text } = fixText(input);
  assert.match(text, /@Damage\[\(@item\.rank\*2\)d6\[electricity\]\]/);
  assert.match(text, /@Template\[emanation\|distance:10\]/);
  assert.match(text, /^Você causa/);
});

test("still fixes the optional trailing {label} of an enricher", () => {
  const input = "Voce fica @UUID[Compendium.pf2e.conditionitems.Item.Dazzled]{Ofuscado} por 1 rodada.";
  const { text, count } = fixText(input);
  assert.match(text, /@UUID\[Compendium\.pf2e\.conditionitems\.Item\.Dazzled\]\{Ofuscado\}/);
  assert.match(text, /^Você fica/);
  assert.ok(count >= 1);
});

test("real-world regression: Esfera de Trovão do Horizonte keeps enrichers byte-identical", () => {
  const input =
    "<p>Voce reúne energia magica em sua palma, formando uma bola concentrada de eletricidade que crepita e zumbe " +
    "como um trovao impossívelmente distante. Faca uma rolagem de ataque de magia a distancia contra a CA de seu alvo. " +
    "causando @Damage[(@item.rank*2)d6[electricity]] dano a todas as outras criaturas em uma @Template[emanation|distance:10] " +
    "ao redor do alvo (resistencia basica de Reflexos).</p>";
  const { text } = fixText(input);
  assert.match(text, /@Damage\[\(@item\.rank\*2\)d6\[electricity\]\]/);
  assert.match(text, /@Template\[emanation\|distance:10\]/);
  assert.match(text, /Você reúne energia mágica/);
  assert.match(text, /impossivelmente distante/); // wrong accent fixed
  assert.match(text, /a distância contra/);
  assert.match(text, /resistência básica/); // "basica" is in the dictionary too
});

// ===========================================================================
// 3. Ambiguous words are deliberately NOT touched.
// ===========================================================================
test("does not touch ambiguous grammatical forms (tem/esta/para/so/as)", () => {
  for (const word of ["tem", "esta", "para", "so", "as", "e", "da", "pode", "sabia"]) {
    assert.equal(lookupReplacement(word), null, `"${word}" must not have a blanket rule`);
  }
});

test("does not corrupt the verb 'silencia' (3rd person of silenciar) via a blanket -encia rule", () => {
  const { text, count } = fixText("Voce silencia a voz do alvo.");
  assert.match(text, /\bsilencia\b/);
  assert.doesNotMatch(text, /silência/);
  assert.equal(count, 1); // only "Voce" -> "Você"
});

test("does not corrupt the verb 'critica'/'critico' (criticar) via a blanket dictionary rule", () => {
  const { text, count } = fixText(
    "Quando você critica com sucesso esta ação, você continua a permanecer escondido.",
  );
  assert.match(text, /\bcritica\b/);
  assert.doesNotMatch(text, /crítica/);
  assert.equal(count, 0);
});

test("DOES fix the fixed rules-terminology phrase 'sucesso critico' / 'falha critica'", () => {
  const { text: t1 } = fixText("Em um sucesso critico, o alvo sofre o dobro do dano.");
  assert.match(t1, /sucesso crítico/);

  const { text: t2 } = fixText("Falha Critica Como falha, mas o alvo sofre mais.");
  assert.match(t2, /Falha Crítica/);
});

// ===========================================================================
// 4. Idempotency.
// ===========================================================================
test("re-applying fixText to already-fixed text is a no-op", () => {
  const input = "Voce nao pode gastar acoes magicas a distancia critica ate o proximo nivel.";
  const first = fixText(input);
  const second = fixText(first.text);
  assert.equal(second.count, 0, "second pass must find nothing left to fix");
  assert.equal(second.text, first.text);
});

test(
  "regression: 'falha critica' phrase fix must not corrupt 'falha criticamente' on repeated runs",
  () => {
    const input = "Você falha ou falha criticamente em um teste de resistência.";
    const first = fixText(input);
    assert.match(first.text, /falha criticamente/);
    assert.doesNotMatch(first.text, /críticamente/);

    const second = fixText(first.text);
    assert.equal(second.count, 0, "must be stable — no ping-pong between critica/críticamente");
    assert.equal(second.text, first.text);
  },
);

test("fixes the wrong-accent adverb 'críticamente' (pt-BR -mente adverbs never carry an accent)", () => {
  const { text, count } = fixText("O alvo falha críticamente no teste.");
  assert.match(text, /falha criticamente/);
  assert.doesNotMatch(text, /críticamente/);
  assert.equal(count, 1);
});

// ===========================================================================
// 5. Dictionary sanity — no key maps to itself or to an empty/whitespace value.
// ===========================================================================
test("DICTIONARY has no self-mapping or empty entries", () => {
  for (const [unaccented, accented] of Object.entries(DICTIONARY)) {
    assert.notEqual(unaccented, accented, `"${unaccented}" maps to itself`);
    assert.ok(accented.trim().length > 0, `"${unaccented}" maps to an empty string`);
  }
});

test("DICTIONARY keys are all lowercase (case is reapplied at substitution time, not stored)", () => {
  for (const key of Object.keys(DICTIONARY)) {
    assert.equal(key, key.toLowerCase(), `dictionary key "${key}" must be lowercase`);
  }
});
