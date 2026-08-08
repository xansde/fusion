/**
 * pathbuilder-fofurinha.test.ts — a FICHA-ALVO as an external source of truth.
 *
 * `varredura-classes.test.ts` compares our output against the class's own pack
 * table (internally consistent, cannot fail on an incomplete table — issue
 * #48). `pregen-parity.test.ts` closed that hole for the 12 curated classes
 * using Paizo's pregens. This suite adds a THIRD external truth of a different
 * kind: a real, owner-authored Pathbuilder export of the character the table
 * actually wants to play — `fixtures/pathbuilder-fofurinha.json`, a level-1
 * Elf (Ancient Elf) Gunslinger of the Way of the Spellshot, carrying a Psychic
 * Dedication granted by the heritage.
 *
 * Why a sheet nobody can build yet is a useful test: it turns "what's missing"
 * from prose into a RATCHET. `LACUNAS` is the measured baseline of everything
 * this sheet needs and Fusion does not have. The suite asserts SET EQUALITY, so
 * it fails in both directions:
 *   - a NEW gap appears           → red (regression)
 *   - a listed gap stops existing → red (delete the entry; the baseline may
 *                                  only shrink)
 *
 * OUT OF SCOPE by owner decision (2026-08-08): coins and XP (no field on the
 * character actor), the "Kit de Faca" inventory line (a Pathbuilder custom
 * item, not published content), the SF2e-only skills the export always emits
 * (`piloting`/`computers`), and `dualClass` (an unimplemented variant).
 *
 * NOT covered here, deliberately: the two ENGINE gaps that only become
 * reachable once the content above exists — a spellcastingEntry sourced from an
 * archetype instead of a class (`planVM.ts` builds only `class:spellcasting` /
 * `class:focus`), and a per-weapon proficiency rank ("expert in Slide Pistol";
 * `actor-character.ts` ranks weapons by CATEGORY only). Both need the
 * Gunslinger/Psychic documents to exist before an assertion on them can mean
 * anything.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDocuments, docName, sysOf } from "./helpers/classBuildHarness.js";
import { computeAbilityScores, isFeatEligible, type BuildAbilities } from "../planVM.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface PathbuilderExport {
  build: {
    abilities: {
      str: number;
      dex: number;
      con: number;
      int: number;
      wis: number;
      cha: number;
    };
  };
}

const FICHA = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/pathbuilder-fofurinha.json"), "utf-8"),
) as PathbuilderExport;

// ---------------------------------------------------------------------------
// What the sheet cites, and which pack owns it
// ---------------------------------------------------------------------------

/**
 * Every published document this sheet names, mapped to the pack that must
 * carry it. Derived by hand from the export's `class`, `ancestry`, `heritage`,
 * `background`, `feats`, `specials`, `weapons` and `focus.focusCantrips`.
 */
const CONTEUDO_EXIGIDO: ReadonlyArray<readonly [pack: string, name: string]> = [
  ["classes-core", "Gunslinger"],
  ["class-features-core", "Gunslinger's Way"],
  ["class-features-core", "Slinger's Precision"],
  ["class-features-core", "Way of the Spellshot"],
  ["class-features-core", "The Oscillating Wave"],
  ["actions-core", "Thoughtful Reload"],
  ["actions-core", "Energy Shot"],
  ["feats-core", "Psychic Dedication"],
  ["feats-core", "Munitions Crafter"],
  ["feats-core", "Nimble Elf"],
  ["feats-core", "Experienced Smuggler"],
  ["feats-core", "Alchemical Crafting"],
  ["ancestries-core", "Elf"],
  ["ancestry-features-core", "Low-Light Vision"],
  ["heritages-core", "Ancient Elf"],
  ["backgrounds-core", "Smuggler"],
  ["weapons-core", "Slide Pistol"],
  ["spells-core", "Ignition"],
];

/**
 * The measured baseline. Key → the work item that closes it.
 *
 * `conteudo:<pack>/<name>` — the document is not in any pack.
 * `regra:<slug>`           — the document exists, the rule around it does not.
 */
const LACUNAS: Readonly<Record<string, string>> = {
  // Bloco 1 — Gunslinger/Psychic never curated (both exist in the vendor).
  "conteudo:classes-core/Gunslinger": "bloco 1 — curar a classe",
  "conteudo:class-features-core/Gunslinger's Way": "bloco 1 — vem com a classe",
  "conteudo:class-features-core/Slinger's Precision": "bloco 1 — vem com a classe",
  "conteudo:class-features-core/Way of the Spellshot": "bloco 1 — eixo `way`",
  "conteudo:feats-core/Munitions Crafter": "bloco 1 — talento de classe do Gunslinger",
  "conteudo:feats-core/Psychic Dedication": "bloco 1 — exige curar a Psychic",
  "conteudo:class-features-core/The Oscillating Wave": "bloco 1 — eixo `conscious-mind`",

  // Bloco 2 — the level-1 archetype route is closed by TWO independent gates.
  "regra:dedicacao-nao-cabe-em-slot-de-classe": "bloco 2 — planVM.ts:1919 (é a regra RAW)",
  "regra:ancient-elf-choiceset-inerte": "bloco 2 — ChoiceSet marcado unsupported no pack",

  // Bloco 4 — no firearm was ever published to weapons-core.
  "conteudo:weapons-core/Slide Pistol": "bloco 4 — 0 de 106 armas de fogo publicadas",

  // Bloco 5 — Smuggler (LO:WG) is absent from all three canonical sources.
  "conteudo:backgrounds-core/Smuggler": "bloco 5 — escrever à mão (Dex|Cha + livre)",

  // Found while measuring this sheet: the Elf's own sense is not a document in
  // ANY pack, which hits every low-light ancestry, not just this one.
  "conteudo:ancestry-features-core/Low-Light Vision": "achado novo — sentido sem documento",
};

function nomesDoPack(slug: string): Set<string> {
  return new Set(loadDocuments(slug).map(docName));
}

/** Every gap this suite can currently observe, computed from real packs/code. */
function lacunasObservadas(): string[] {
  const encontradas: string[] = [];

  const porPack = new Map<string, Set<string>>();
  for (const [pack] of CONTEUDO_EXIGIDO) {
    if (!porPack.has(pack)) porPack.set(pack, nomesDoPack(pack));
  }
  for (const [pack, name] of CONTEUDO_EXIGIDO) {
    if (!porPack.get(pack)?.has(name)) encontradas.push(`conteudo:${pack}/${name}`);
  }

  // A dedication consumes a CLASS feat slot by the rules; the picker rejects it.
  // Shaped like a real feats-core dedication so the rule is what is under test,
  // not the (absent) Psychic Dedication document.
  const dedicacao = {
    system: {
      category: "class",
      level: 2,
      traits: { value: ["archetype", "dedication", "multiclass", "psychic"] },
    },
  };
  if (!isFeatEligible(dedicacao, "classFeat", 2)) {
    encontradas.push("regra:dedicacao-nao-cabe-em-slot-de-classe");
  }

  // Ancient Elf must grant a multiclass dedication at level 1. Its ChoiceSet
  // arrived unconverted, so the grant-item it feeds resolves to nothing.
  const ancientElf = loadDocuments("heritages-core").find((h) => docName(h) === "Ancient Elf");
  const flags = (ancientElf?.["flags"] ?? {}) as Record<string, unknown>;
  const fusionFlags = (flags["fusion"] ?? {}) as Record<string, unknown>;
  const pendentes = (fusionFlags["unconvertedRules"] ?? []) as Array<Record<string, unknown>>;
  if (pendentes.some((r) => r["key"] === "ChoiceSet")) {
    encontradas.push("regra:ancient-elf-choiceset-inerte");
  }

  return encontradas.sort();
}

describe("ficha-alvo: export real do Pathbuilder (Fofurinha, Gunslinger/Spellshot 1)", () => {
  it("reproduz os atributos finais, teto de 18 incluído", () => {
    // Pathbuilder lumps the background's pair-choice and its free boost into a
    // single `backgroundBoosts` array; our ledger splits the two.
    const abilities: BuildAbilities = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["con"],
      ancestryFree: ["cha"],
      backgroundBoosts: ["dex"],
      backgroundFree: ["dex"],
      classBoost: ["dex"],
      levelledBoosts: { "1": ["dex", "cha", "int", "con"] },
    };

    const scores = computeAbilityScores(abilities, 1);

    // Dex 19, not 20: the fifth Dex boost lands on an 18 and yields +1. This is
    // the assertion that proves the ladder AND the cap against data we did not
    // produce.
    expect(scores).toEqual({ str: 10, dex: 19, con: 10, int: 14, wis: 10, cha: 14 });
    expect(scores.dex).toBe(FICHA.build.abilities.dex);
    expect(scores.cha).toBe(FICHA.build.abilities.cha);
    expect(scores.int).toBe(FICHA.build.abilities.int);
    expect(scores.con).toBe(FICHA.build.abilities.con);
  });

  it("mantém a catraca: nem lacuna nova, nem lacuna já fechada ainda listada", () => {
    expect(lacunasObservadas()).toEqual(Object.keys(LACUNAS).sort());
  });

  it("todo item da catraca aponta para um bloco de trabalho", () => {
    for (const [chave, destino] of Object.entries(LACUNAS)) {
      expect(destino, `lacuna sem destino: ${chave}`).toMatch(/bloco \d|achado novo/);
    }
  });

  it("o que a ficha exige e o pack JÁ TEM não regride", () => {
    // The green half of the manifest, asserted explicitly so a re-import that
    // drops one of these fails here instead of silently widening the ratchet.
    const presentes: ReadonlyArray<readonly [string, string]> = [
      ["ancestries-core", "Elf"],
      ["heritages-core", "Ancient Elf"],
      ["feats-core", "Nimble Elf"],
      ["feats-core", "Experienced Smuggler"],
      ["feats-core", "Alchemical Crafting"],
      ["actions-core", "Thoughtful Reload"],
      ["actions-core", "Energy Shot"],
      ["spells-core", "Ignition"],
    ];
    for (const [pack, name] of presentes) {
      expect(nomesDoPack(pack).has(name), `${pack} perdeu ${name}`).toBe(true);
    }
  });

  it("Ignition é truque (rank 0), como a ficha o usa via arquétipo", () => {
    const ignition = loadDocuments("spells-core").find((s) => docName(s) === "Ignition");
    expect(ignition).toBeDefined();
    const traits = (sysOf(ignition!)["traits"] as { value?: string[] } | undefined)?.value ?? [];
    expect(traits).toContain("cantrip");
  });
});
