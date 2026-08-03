/**
 * prerequisiteTranslation.test.ts — issue #32. Every string below is a REAL
 * `system.prerequisites[].value` measured against the live
 * systems/pf2e/packs/feats-core/documents.json pack (see the issue's own
 * measurement: 998 documents, 1219 occurrences, 626 distinct strings).
 *
 * Tests use a small FIXTURE name index (dependency injection via the
 * `nameIndex` parameter) rather than the generated `DOCUMENT_NAMES_PT`, so
 * they stay deterministic regardless of the live translation state (other
 * sessions are actively translating packs in parallel — see the module
 * header of documentNamesPt.ts). The one exception (the "uses the real
 * generated index by default" block) asserts against curated-vocabulary
 * output only, which this module owns and controls directly.
 */

import { describe, it, expect } from "vitest";
import { translatePrerequisite } from "../prerequisiteTranslation.js";

const FIXTURE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "dragon instinct": "Instinto Dracônico",
  "eldritch trickster": "Trapaceiro Sobrenatural",
  "animal instinct": "Instinto Animal",
  enigma: "Enigma",
  "booming impale": "Empalar Retumbante",
  "prone impale": "Empalar Prostrante",
  "ancestral longevity": "Longevidade Ancestral",
  "cavalier dedication": "Dedicação Cavaleiro (documento real)",
});

describe("translatePrerequisite — rank + subject", () => {
  it("translates a simple rank + skill (trained in Perception)", () => {
    expect(translatePrerequisite("trained in Perception", FIXTURE_NAMES)).toBe(
      "treinado em Percepção",
    );
  });

  it("translates rank + skill with 'at' instead of 'in' (master at Deception)", () => {
    expect(translatePrerequisite("master at Deception", FIXTURE_NAMES)).toBe("mestre em Enganação");
  });

  it("translates a bare rank + skill with no preposition (legendary Stealth)", () => {
    expect(translatePrerequisite("legendary Stealth", FIXTURE_NAMES)).toBe(
      "lendário em Furtividade",
    );
  });

  it("translates rank + 'or' list of two skills (expert in Acrobatics or Athletics)", () => {
    expect(translatePrerequisite("expert in Acrobatics or Athletics", FIXTURE_NAMES)).toBe(
      "especialista em Acrobacia ou Atletismo",
    );
  });

  it("translates rank + 'or' list of four skills, preserving the disjunction (trained in Arcana, Nature, Occultism, or Religion)", () => {
    expect(
      translatePrerequisite("trained in Arcana, Nature, Occultism, or Religion", FIXTURE_NAMES),
    ).toBe("treinado em Arcanismo, Natureza, Ocultismo ou Religião");
  });

  it("translates rank + 'and' list, preserving the conjunction (trained in Acrobatics and medium armor — real feat: Farabellus Flip)", () => {
    expect(translatePrerequisite("trained in Acrobatics and medium armor", FIXTURE_NAMES)).toBe(
      "treinado em Acrobacia e armadura média",
    );
  });

  it("translates rank + save (expert in Fortitude saves)", () => {
    expect(translatePrerequisite("expert in Fortitude saves", FIXTURE_NAMES)).toBe(
      "especialista em salvaguardas de Fortitude",
    );
  });

  it("translates rank + bare Lore (trained in Lore)", () => {
    expect(translatePrerequisite("trained in Lore", FIXTURE_NAMES)).toBe("treinado em Saber");
  });

  it("translates rank + a specific Lore (master in a Recall Knowledge skill falls to curated compound vocab)", () => {
    expect(
      translatePrerequisite("master in a skill with the Recall Knowledge action", FIXTURE_NAMES),
    ).toBe("mestre em uma perícia com a ação Recordar Conhecimento");
  });

  it("translates a curated compound subject (trained in medium armor)", () => {
    expect(translatePrerequisite("trained in medium armor", FIXTURE_NAMES)).toBe(
      "treinado em armadura média",
    );
  });

  it("translates a curated compound subject (expert in unarmed attacks)", () => {
    expect(translatePrerequisite("expert in unarmed attacks", FIXTURE_NAMES)).toBe(
      "especialista em ataques desarmados",
    );
  });

  it("does not half-translate a rank subject list when one item is unresolvable", () => {
    const raw = "trained in Acrobatics or some unmodeled thing";
    expect(translatePrerequisite(raw, FIXTURE_NAMES)).toBe(raw);
  });
});

describe("translatePrerequisite — subclass-axis expressions", () => {
  it("resolves a full axis phrase directly against the document-name index (dragon instinct)", () => {
    expect(translatePrerequisite("dragon instinct", FIXTURE_NAMES)).toBe("Instinto Dracônico");
  });

  it("resolves an axis phrase by stripping the trailing suffix before the doc-name lookup (eldritch trickster racket)", () => {
    expect(translatePrerequisite("eldritch trickster racket", FIXTURE_NAMES)).toBe(
      "Trapaceiro Sobrenatural",
    );
  });

  it("resolves a bare muse axis option (enigma muse — real feats: Bardic Lore, True Hypercognition)", () => {
    expect(translatePrerequisite("enigma muse", FIXTURE_NAMES)).toBe("Enigma");
  });

  it("resolves a heritage-suffixed phrase the same way (dokkaebi goblin heritage)", () => {
    const withHeritage = { ...FIXTURE_NAMES, "dokkaebi goblin": "Dokkaebi Goblin" };
    expect(translatePrerequisite("dokkaebi goblin heritage", withHeritage)).toBe("Dokkaebi Goblin");
  });
});

describe("translatePrerequisite — document name", () => {
  it("resolves a plain document-name prerequisite (Ancestral Longevity)", () => {
    expect(translatePrerequisite("Ancestral Longevity", FIXTURE_NAMES)).toBe(
      "Longevidade Ancestral",
    );
  });

  it("is case-insensitive against the index", () => {
    expect(translatePrerequisite("ANCESTRAL LONGEVITY", FIXTURE_NAMES)).toBe(
      "Longevidade Ancestral",
    );
  });

  it("resolves an 'or' list of two document names (Booming Impale or Prone Impale)", () => {
    expect(translatePrerequisite("Booming Impale or Prone Impale", FIXTURE_NAMES)).toBe(
      "Empalar Retumbante ou Empalar Prostrante",
    );
  });
});

describe("translatePrerequisite — homonyms (resolved upstream by the generator)", () => {
  it("uses whatever the injected index resolved a name to — never re-disambiguates at render time", () => {
    // The generator (tools/translate-packs/src/document-names.mjs,
    // buildDocumentNameIndex) is what arbitrates a same-pack homonym or a
    // cross-pack collision; this module just does a flat lookup, so an
    // ambiguous name that the generator chose to OMIT correctly falls
    // through to the EN fallback here rather than guessing.
    const ambiguousOmitted = { ...FIXTURE_NAMES };
    delete (ambiguousOmitted as Record<string, string>)["booming impale"];
    expect(translatePrerequisite("Booming Impale", ambiguousOmitted)).toBe("Booming Impale");
  });
});

describe("translatePrerequisite — generic structural templates", () => {
  it("translates the Dedication template for an archetype not itself curated (Dandy Dedication)", () => {
    expect(translatePrerequisite("Dandy Dedication", FIXTURE_NAMES)).toBe("Dedicação Dandy");
  });

  it("prefers a real document-name match over the Dedication template when both are available", () => {
    expect(translatePrerequisite("Cavalier Dedication", FIXTURE_NAMES)).toBe(
      "Dedicação Cavaleiro (documento real)",
    );
  });

  it("translates the heritage template for a heritage not yet in the document index (unbreakable goblin heritage)", () => {
    expect(translatePrerequisite("unbreakable goblin heritage", FIXTURE_NAMES)).toBe(
      "Linhagem unbreakable goblin",
    );
  });

  it("translates the ethnicity template (Nidalese ethnicity)", () => {
    expect(translatePrerequisite("Nidalese ethnicity", FIXTURE_NAMES)).toBe("Etnia Nidalese");
  });

  it("translates the ability-score template (Dexterity +2)", () => {
    expect(translatePrerequisite("Dexterity +2", FIXTURE_NAMES)).toBe("Destreza +2");
  });

  it("translates the bloodline-spells template (bloodline that grants divine or occult spells)", () => {
    expect(
      translatePrerequisite("bloodline that grants divine or occult spells", FIXTURE_NAMES),
    ).toBe("linhagem que concede magias divinas ou ocultas");
  });
});

describe("translatePrerequisite — curated prose vocabulary", () => {
  it("translates a standalone curated phrase (focus pool)", () => {
    expect(translatePrerequisite("focus pool", FIXTURE_NAMES)).toBe("reserva de foco");
  });

  it("translates a curated phrase with the leading article stripped (an animal companion)", () => {
    // The curated dictionary stores "animal companion" article-free;
    // stripArticle() drops the leading "an " before the lookup.
    expect(translatePrerequisite("an animal companion", FIXTURE_NAMES)).toBe("companheiro animal");
  });

  it("keeps the curated dictionary article-free and lets stripArticle do the matching (a familiar)", () => {
    expect(translatePrerequisite("a familiar", FIXTURE_NAMES)).toBe("familiar");
  });

  it("translates the holy/unholy trait terms", () => {
    expect(translatePrerequisite("holy", FIXTURE_NAMES)).toBe("sagrado");
    expect(translatePrerequisite("unholy", FIXTURE_NAMES)).toBe("profano");
  });
});

describe("translatePrerequisite — fallback", () => {
  it("returns unresolvable prose unchanged, verbatim", () => {
    const raw =
      "arctic elf, cavern elf, desert elf, woodland elf, or any other elf heritage based on adapting to an environment";
    expect(translatePrerequisite(raw, FIXTURE_NAMES)).toBe(raw);
  });

  it("returns an empty/whitespace string unchanged", () => {
    expect(translatePrerequisite("", FIXTURE_NAMES)).toBe("");
    expect(translatePrerequisite("   ", FIXTURE_NAMES)).toBe("   ");
  });

  it("never throws on a completely unmodeled proper noun", () => {
    expect(translatePrerequisite("Glorious Gamtu", FIXTURE_NAMES)).toBe("Glorious Gamtu");
  });
});

describe("translatePrerequisite — uses the real generated DOCUMENT_NAMES_PT by default", () => {
  it("falls back to curated vocabulary (owned by this module, stable regardless of pack translation progress) when no nameIndex is passed", () => {
    expect(translatePrerequisite("focus pool")).toBe("reserva de foco");
  });
});
