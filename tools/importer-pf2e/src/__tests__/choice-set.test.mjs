/**
 * choice-set.test.mjs — conversão de ChoiceSet(feat) → descritor `feat-choice`.
 *
 * As fixtures são cópias LITERAIS dos rule elements que o vendor entrega hoje
 * (`out/<pack>/normalized.json`), escolhidas para cobrir cada forma de filtro
 * medida em 2026-08-08 sobre os 633 ChoiceSets do vendor:
 *
 *   - só category+trait, SEM predicado de nível  → Ancient Elf (o único caso
 *     publicado; é a concessão que fura o pré-requisito de nível)
 *   - `{lte:["item:level",N]}` literal            → Basic Concoction
 *   - `item:level:<N>` exato                      → Multitalented
 *   - `{lte:["item:level","self:level"]}`         → Rogue Dedication
 *   - placeholder `{actor|…}` no trait            → Ancestral Paragon
 *   - árvore or/not + item:rarity                 → Gate's Threshold
 *
 * Execução: node --test src/__tests__/choice-set.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  convertChoiceSet,
  isPairedWithGrantItem,
  parseFeatChoicePredicates,
} from "../choice-set.mjs";

/** Ancient Elf (heritages) — o caso da ficha-alvo. */
const ANCIENT_ELF = [
  {
    choices: {
      filter: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
      itemType: "feat",
    },
    flag: "ancientElf",
    key: "ChoiceSet",
    prompt: "PF2E.SpecificRule.AncientElf.Prompt",
  },
  { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.ancientElf}" },
];

/** Basic Concoction (feats) — filtro literal COM teto de nível. */
const BASIC_CONCOCTION = [
  {
    choices: {
      filter: ["item:category:class", "item:trait:alchemist", { lte: ["item:level", 2] }],
      itemType: "feat",
    },
    flag: "basicConcoction",
    key: "ChoiceSet",
  },
  { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.basicConcoction}" },
];

/** Multitalented (feats) — `item:level:2` exato, forma que não cabe em levelAtMost. */
const MULTITALENTED = [
  {
    choices: {
      filter: [
        "item:level:2",
        "item:category:class",
        "item:trait:dedication",
        "item:trait:multiclass",
      ],
      itemType: "feat",
    },
    flag: "multitalented",
    key: "ChoiceSet",
  },
  { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.multitalented}" },
];

/** Rogue Dedication (feats) — teto de nível RELATIVO ao personagem. */
const ROGUE_DEDICATION = [
  {
    choices: {
      filter: ["item:trait:skill", { lte: ["item:level", "self:level"] }],
      itemType: "feat",
    },
    flag: "skillFeat",
    key: "ChoiceSet",
  },
  { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.skillFeat}" },
];

/** Ancestral Paragon (feats) — trait dinâmico `{actor|…}`. */
const ANCESTRAL_PARAGON = [
  {
    choices: {
      filter: [
        "item:level:1",
        "item:category:ancestry",
        { or: ["item:trait:{actor|system.details.ancestry.trait}"] },
        { not: "item:trait:lineage" },
      ],
      itemType: "feat",
    },
    flag: "ancestralParagon",
    key: "ChoiceSet",
  },
  { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.ancestralParagon}" },
];

describe("parseFeatChoicePredicates", () => {
  it("traduz category/trait literais para os predicados que o cliente consome", () => {
    const { predicates, allLiteral, levelPredicateDeclared } = parseFeatChoicePredicates(
      ANCIENT_ELF[0].choices.filter,
    );
    assert.deepEqual(predicates, [
      { kind: "category", value: "class" },
      { kind: "trait", value: "dedication" },
      { kind: "trait", value: "multiclass" },
    ]);
    assert.equal(allLiteral, true);
    assert.equal(levelPredicateDeclared, false, "Ancient Elf não declara predicado de nível");
  });

  it("traduz `{lte:[item:level, N]}` para levelAtMost e marca o nível como declarado", () => {
    const { predicates, allLiteral, levelPredicateDeclared } = parseFeatChoicePredicates(
      BASIC_CONCOCTION[0].choices.filter,
    );
    assert.deepEqual(predicates, [
      { kind: "category", value: "class" },
      { kind: "trait", value: "alchemist" },
      { kind: "levelAtMost", value: 2 },
    ]);
    assert.equal(allLiteral, true);
    assert.equal(levelPredicateDeclared, true);
  });

  it("recusa `item:level:<N>` exato (não é teto) mas registra que o nível foi declarado", () => {
    const r = parseFeatChoicePredicates(MULTITALENTED[0].choices.filter);
    assert.equal(r.allLiteral, false);
    assert.equal(r.levelPredicateDeclared, true);
  });

  it("recusa teto relativo ao personagem (`self:level`)", () => {
    const r = parseFeatChoicePredicates(ROGUE_DEDICATION[0].choices.filter);
    assert.equal(r.allLiteral, false);
    assert.equal(r.levelPredicateDeclared, true);
  });

  it("recusa filtro com placeholder dinâmico ou árvore de predicado", () => {
    const r = parseFeatChoicePredicates(ANCESTRAL_PARAGON[0].choices.filter);
    assert.equal(r.allLiteral, false);
  });
});

describe("isPairedWithGrantItem", () => {
  it("reconhece o GrantItem irmão que consome a flag do ChoiceSet", () => {
    assert.equal(isPairedWithGrantItem(ANCIENT_ELF, "ancientElf"), true);
  });

  it("é falso quando nenhum GrantItem consome a flag", () => {
    assert.equal(isPairedWithGrantItem([ANCIENT_ELF[0]], "ancientElf"), false);
    assert.equal(isPairedWithGrantItem(ANCIENT_ELF, "outraFlag"), false);
  });
});

describe("convertChoiceSet — escopo estreito (level-free-feat-choice)", () => {
  it("converte o Ancient Elf no formato do GrantedFeatFilter do planVM", () => {
    const conv = convertChoiceSet(ANCIENT_ELF[0], ANCIENT_ELF);
    assert.ok(conv, "Ancient Elf deve converter");
    assert.equal(conv.kind, "feat-choice");
    assert.equal(conv.flag, "ancientElf");
    assert.equal(conv.count, 1);
    assert.equal(conv.levelPredicateDeclared, false);
    assert.deepEqual(conv.predicates, [
      { kind: "category", value: "class" },
      { kind: "trait", value: "dedication" },
      { kind: "trait", value: "multiclass" },
    ]);
    assert.equal(conv.raw, ANCIENT_ELF[0], "o RE original fica preservado em `raw`");
  });

  it("NÃO converte um ChoiceSet que declara nível (fica em unconvertedRules como hoje)", () => {
    assert.equal(convertChoiceSet(BASIC_CONCOCTION[0], BASIC_CONCOCTION), null);
    assert.equal(convertChoiceSet(MULTITALENTED[0], MULTITALENTED), null);
    assert.equal(convertChoiceSet(ROGUE_DEDICATION[0], ROGUE_DEDICATION), null);
  });

  it("NÃO converte sem o GrantItem par — ChoiceSet solto é parâmetro, não concessão", () => {
    assert.equal(convertChoiceSet(ANCIENT_ELF[0], [ANCIENT_ELF[0]]), null);
  });

  it("NÃO converte escolha que não é de talento (perícia/ancestralidade/magia)", () => {
    const skillPick = {
      key: "ChoiceSet",
      flag: "skill",
      choices: [{ value: "nature" }, { value: "occultism" }],
    };
    assert.equal(convertChoiceSet(skillPick, [skillPick]), null);
    const ancestryPick = {
      key: "ChoiceSet",
      flag: "ancestry",
      choices: { itemType: "ancestry", filter: [] },
    };
    assert.equal(convertChoiceSet(ancestryPick, [ancestryPick]), null);
  });
});

describe("convertChoiceSet — escopo largo (all-literal-feat-choice)", () => {
  it("aí sim converte o Basic Concoction, com o teto de nível como predicado", () => {
    const conv = convertChoiceSet(BASIC_CONCOCTION[0], BASIC_CONCOCTION, "all-literal-feat-choice");
    assert.ok(conv);
    assert.equal(conv.levelPredicateDeclared, true);
    assert.deepEqual(conv.predicates, [
      { kind: "category", value: "class" },
      { kind: "trait", value: "alchemist" },
      { kind: "levelAtMost", value: 2 },
    ]);
  });

  it("e continua recusando filtro não-literal, em qualquer escopo", () => {
    assert.equal(
      convertChoiceSet(ANCESTRAL_PARAGON[0], ANCESTRAL_PARAGON, "all-literal-feat-choice"),
      null,
    );
  });
});
