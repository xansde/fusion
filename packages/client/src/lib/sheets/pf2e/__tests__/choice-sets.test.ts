/**
 * Inventário de escolhas do vendor — teste de cobertura (r21).
 *
 * REGRA DESTE TESTE, decidida pelo dono do projeto: **não travar a verificação
 * de hoje.** As escolhas que o builder ainda não oferece são dívida conhecida e
 * declarada — elas NÃO reprovam a suíte. O teste falha por um motivo só:
 * quando aparece uma escolha que ninguém classificou.
 *
 * É a diferença entre "sei o que falta" e "não sei o que falta". A primeira é
 * um backlog; a segunda é o defeito silencioso que fez a Ancestralidade Adotada
 * passar meses sem sub-slot sem ninguém notar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CHOICE_SET_INVENTORY, pendingChoiceSets } from "../choiceSetInventory.js";

const PACKS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "systems",
  "pf2e",
  "packs",
);

interface PackDoc {
  name: string;
  system?: { rules?: unknown[] };
  flags?: { fusion?: { unconvertedRules?: unknown[] } };
}

/**
 * Toda escolha presente nos packs hoje, na chave `<pack>/<doc>/<flag>`.
 *
 * Duas fontes, de propósito (r25):
 *
 *  1. `flags.fusion.unconvertedRules` — o ChoiceSet cru, que é como a esmagadora
 *     maioria das escolhas chega (o importer marca `ChoiceSet: "unsupported"`).
 *  2. `system.rules[].kind === "feat-choice"` — a escolha JÁ CONVERTIDA pelo
 *     importer. Sem este segundo laço, converter um ChoiceSet fazia a escolha
 *     DESAPARECER do inventário: a entrada virava "morta" e a correção óbvia
 *     seria apagá-la, perdendo a dívida declarada exatamente no momento em que o
 *     pack passou a carregar a escolha melhor. Pior: um ChoiceSet(feat) novo,
 *     publicado já convertido, entraria sem NINGUÉM ter de classificá-lo — o
 *     defeito silencioso que este inventário existe para impedir.
 *
 * Converter o ChoiceSet é progresso no PACK; não é o builder oferecendo a
 * escolha. O estado no inventário continua sendo sobre o builder.
 */
function collectChoiceSets(): string[] {
  const keys: string[] = [];
  for (const entry of readdirSync(PACKS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(PACKS, entry.name, "documents.json");
    if (!existsSync(path)) continue;
    const docs = JSON.parse(readFileSync(path, "utf8")) as PackDoc[];
    for (const doc of docs) {
      for (const rule of doc.flags?.fusion?.unconvertedRules ?? []) {
        const r = rule as { key?: string; flag?: string };
        if (r.key !== "ChoiceSet") continue;
        keys.push(`${entry.name}/${doc.name}/${r.flag ?? "-"}`);
      }
      for (const rule of doc.system?.rules ?? []) {
        const r = rule as { kind?: string; flag?: string };
        if (r.kind !== "feat-choice") continue;
        keys.push(`${entry.name}/${doc.name}/${r.flag ?? "-"}`);
      }
    }
  }
  return keys.sort();
}

describe("inventário de escolhas do vendor (ChoiceSet)", () => {
  it("toda escolha presente nos packs está classificada no inventário", () => {
    const naoClassificadas = collectChoiceSets().filter(
      (k) => CHOICE_SET_INVENTORY[k] === undefined,
    );
    expect(
      naoClassificadas,
      "escolha nova nos packs sem entrada em choiceSetInventory.ts — classifique como " +
        "'eixo' | 'sub-slot' | 'fora-do-builder' | 'pendente' antes de seguir. " +
        "Escolha não classificada é escolha que some da ficha sem ninguém perceber.",
    ).toEqual([]);
  });

  it("o inventário não guarda entrada morta (escolha que saiu dos packs)", () => {
    const presentes = new Set(collectChoiceSets());
    const mortas = Object.keys(CHOICE_SET_INVENTORY).filter((k) => !presentes.has(k));
    expect(mortas, "entrada no inventário sem escolha correspondente no pack").toEqual([]);
  });

  it("registra as escolhas pendentes SEM reprovar (dívida declarada, não bloqueio)", () => {
    const pendentes = pendingChoiceSets();
    // Deliberadamente não há assert sobre a quantidade: este número deve cair
    // com o tempo, e travá-lo aqui transformaria progresso parcial em suíte
    // vermelha. O relatório vive em .fusion-build/r21/escolhas-pendentes.md.
    console.info(
      `[escolhas] ${String(pendentes.length)} escolha(s) que o builder ainda não oferece:\n  ` +
        pendentes.join("\n  "),
    );
    expect(Array.isArray(pendentes)).toBe(true);
  });
});
