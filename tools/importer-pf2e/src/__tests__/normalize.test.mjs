/**
 * normalize.test.mjs — Testes da salvaguarda cross-system do normalize.mjs (REQ-SF2-048).
 *
 * A separação sf2e/pf2e no importer é feita apenas pela pasta física de
 * origem (vendor/pf2e/packs/<system>/<pack>/...). Esta suíte cobre a
 * checagem defensiva por-documento adicionada em normalize.mjs
 * (detectCrossSystemLeak): quando um documento processado sob um sistema
 * carrega `system.publication.title` de um livro-fonte do sistema oposto,
 * ele deve ser detectado, logado com um aviso e pulado — não silenciosamente
 * importado como se pertencesse ao sistema sendo processado.
 *
 * Caso real de referência (spec 18 REQ-SF2-048): o pack `sf2e/bestiary-effects`
 * tem 37 documentos, 36 dos quais citam livros "Starfinder ..." e 1
 * (`effect-resonance.json`) cita "Pathfinder Monster Core 2" — um vazamento
 * genuíno confirmado por inspeção direta do vendor real (não commitado —
 * vendor/ é gitignored — por isso este teste usa uma fixture inline que
 * espelha o shape real do documento, em vez de ler do vendor).
 *
 * Mirrors sf2e-import.test.mjs / transform.test.mjs's convention: the pure
 * logic under test is duplicated inline (not imported from normalize.mjs)
 * because normalize.mjs runs its CLI main() unconditionally on import —
 * importing it as a module would trigger a real extract/normalize run.
 *
 * Execução:
 *   node --test src/__tests__/normalize.test.mjs
 *
 * REQ-SF2-048. Refs: specs/18-sistema-sf2e.md, analysis/04-sf2e-disponibilidade.md.
 *
 * Zero dependências externas — Node 22 ESM nativo + node:test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline copy of normalize.mjs's detectCrossSystemLeak (kept in sync by hand
// — same convention as sf2e-import.test.mjs's inline deriveFusionId/bufToBase62).
// ---------------------------------------------------------------------------

const PF2E_BOOK_TITLE_PREFIXES = ["Pathfinder "];
const SF2E_BOOK_TITLE_PREFIXES = ["Starfinder "];

function detectCrossSystemLeak(doc, expectedSystem) {
  const title = doc?.system?.publication?.title;
  if (!title || typeof title !== "string") {
    return { leaked: false, detectedSystem: null, title: null };
  }

  const looksLikePf2e = PF2E_BOOK_TITLE_PREFIXES.some((p) => title.startsWith(p));
  const looksLikeSf2e = SF2E_BOOK_TITLE_PREFIXES.some((p) => title.startsWith(p));

  if (looksLikePf2e === looksLikeSf2e) {
    return { leaked: false, detectedSystem: null, title };
  }

  const detectedSystem = looksLikePf2e ? "pf2e" : "sf2e";
  const leaked = detectedSystem !== expectedSystem;
  return { leaked, detectedSystem, title };
}

// ---------------------------------------------------------------------------
// Fixtures — mirror real vendor document shapes (vendor/ is gitignored)
// ---------------------------------------------------------------------------

/** Mirrors vendor/pf2e/packs/sf2e/bestiary-effects/effect-resonance.json. */
const EFFECT_RESONANCE_LEAKED_INTO_SF2E = {
  _id: "0ywWKkLPKiNGyxLl",
  name: "Effect: Resonance",
  type: "effect",
  system: {
    publication: {
      license: "ORC",
      remaster: true,
      title: "Pathfinder Monster Core 2",
    },
  },
};

/** Mirrors a legitimate sf2e doc in the same pack (e.g. effect-archons-protection.json). */
const EFFECT_ARCHONS_PROTECTION_LEGIT_SF2E = {
  _id: "archonsProtect01",
  name: "Effect: Archon's Protection",
  type: "effect",
  system: {
    publication: {
      license: "ORC",
      remaster: true,
      title: "Starfinder Alien Core",
    },
  },
};

/** A legitimate pf2e doc processed under pf2e. */
const EFFECT_LEGIT_PF2E = {
  _id: "legitPf2eDoc0001",
  name: "Some PF2e Effect",
  type: "effect",
  system: {
    publication: {
      license: "ORC",
      remaster: true,
      title: "Pathfinder Player Core",
    },
  },
};

/** No publication.title at all — should never be flagged. */
const DOC_WITHOUT_PUBLICATION = {
  _id: "noPubTitleDoc001",
  name: "Doc with no publication block",
  type: "effect",
  system: {},
};

/** Ambiguous/unknown title — should never be flagged (no signal either way). */
const DOC_WITH_UNKNOWN_TITLE = {
  _id: "unknownTitleDoc1",
  name: "Doc with unrelated title",
  type: "effect",
  system: {
    publication: { title: "Paizo Blog: Tech Class Playtest Encounter 2" },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectCrossSystemLeak (REQ-SF2-048)", () => {
  it("flags a pf2e-sourced doc processed under sf2e (real bestiary-effects case)", () => {
    const result = detectCrossSystemLeak(EFFECT_RESONANCE_LEAKED_INTO_SF2E, "sf2e");
    assert.equal(result.leaked, true);
    assert.equal(result.detectedSystem, "pf2e");
    assert.equal(result.title, "Pathfinder Monster Core 2");
  });

  it("does NOT flag a legitimate sf2e doc processed under sf2e", () => {
    const result = detectCrossSystemLeak(EFFECT_ARCHONS_PROTECTION_LEGIT_SF2E, "sf2e");
    assert.equal(result.leaked, false);
  });

  it("does NOT flag a legitimate pf2e doc processed under pf2e", () => {
    const result = detectCrossSystemLeak(EFFECT_LEGIT_PF2E, "pf2e");
    assert.equal(result.leaked, false);
  });

  it("flags an sf2e-sourced doc processed under pf2e (reverse direction)", () => {
    const result = detectCrossSystemLeak(EFFECT_ARCHONS_PROTECTION_LEGIT_SF2E, "pf2e");
    assert.equal(result.leaked, true);
    assert.equal(result.detectedSystem, "sf2e");
  });

  it("does NOT flag a doc with no publication.title at all", () => {
    const result = detectCrossSystemLeak(DOC_WITHOUT_PUBLICATION, "sf2e");
    assert.equal(result.leaked, false);
    assert.equal(result.title, null);
  });

  it("does NOT flag a doc with an ambiguous/unrelated title", () => {
    const result = detectCrossSystemLeak(DOC_WITH_UNKNOWN_TITLE, "sf2e");
    assert.equal(result.leaked, false);
  });

  it("does NOT flag PF2e-referencing rule elements nested inside a legit sf2e doc", () => {
    // Rules[] legitimately cross-reference PF2e predicates/traits (SF2e
    // inherits mechanical vocabulary from PF2e — REQ-SF2-004..006). Only
    // the root document's own publication.title is checked, never rules[].
    const docWithCrossRefRules = {
      ...EFFECT_ARCHONS_PROTECTION_LEGIT_SF2E,
      system: {
        ...EFFECT_ARCHONS_PROTECTION_LEGIT_SF2E.system,
        rules: [{ key: "FlatModifier", predicate: ["self:trait:elemental"], selector: ["attack"] }],
      },
    };
    const result = detectCrossSystemLeak(docWithCrossRefRules, "sf2e");
    assert.equal(result.leaked, false);
  });
});

describe("bestiary-effects pack real-world distribution (regression guard)", () => {
  it("confirms the exact known-leak case matches spec 18 REQ-SF2-048 example", () => {
    // Spec 18 explicitly cites "the bestiary-effects pack that references
    // pf2e in the research" as the canonical example this safeguard exists
    // for. This locks in that the fixture used above is the real shape.
    assert.equal(EFFECT_RESONANCE_LEAKED_INTO_SF2E.name, "Effect: Resonance");
    const result = detectCrossSystemLeak(EFFECT_RESONANCE_LEAKED_INTO_SF2E, "sf2e");
    assert.equal(
      result.leaked,
      true,
      "effect-resonance.json must be detected as a leak when processed under sf2e",
    );
  });
});
