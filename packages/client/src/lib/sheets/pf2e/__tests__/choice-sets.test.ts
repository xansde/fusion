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
  system?: { rules?: { kind?: string; raw?: { key?: string } }[] };
  flags?: { fusion?: { unconvertedRules?: unknown[]; disabledRules?: { decision?: string }[] } };
}

/** Toda escolha presente nos packs hoje, na chave `<pack>/<doc>/<flag>`. */
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
        "'eixo' | 'sub-slot' | 'fora-do-builder' | 'pendente' | 'desativado' antes de seguir. " +
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

/**
 * DEC-MC-01 — o Elfo Ancião concede, pelas regras, uma dedicação de
 * multiclasse. Como a multiclasse vai ser refeita, a concessão está desativada
 * no pack: a escolha deixa de ser dívida ("pendente", fila de trabalho) e vira
 * escopo fechado ("desativado"). Ver docs/design/decisao-elfo-anciao-dedicacao.md.
 */
describe("DEC-MC-01 — Elfo Ancião sem dedicação de multiclasse", () => {
  const heritages = JSON.parse(
    readFileSync(join(PACKS, "heritages-core", "documents.json"), "utf8"),
  ) as PackDoc[];
  const ancientElf = heritages.find((d) => d.name === "Ancient Elf");

  it("a escolha está classificada como desativada, não como dívida pendente", () => {
    expect(CHOICE_SET_INVENTORY["heritages-core/Ancient Elf/ancientElf"]).toBe("desativado");
    expect(pendingChoiceSets()).not.toContain("heritages-core/Ancient Elf/ancientElf");
  });

  it("a herança continua no pack, sem nenhuma concessão ativa", () => {
    expect(ancientElf, "Ancient Elf sumiu do heritages-core — desativar não é apagar").toBeDefined();
    const grants = (ancientElf?.system?.rules ?? []).filter(
      (r) => r.kind === "grant-item" || r.raw?.key === "GrantItem",
    );
    expect(
      grants,
      "a dedicação de multiclasse voltou ao pack — regeneração sem curation/disabled-rules.mjs?",
    ).toEqual([]);
  });

  it("a concessão está preservada como desativada, com a decisão que a desligou", () => {
    const disabled = ancientElf?.flags?.fusion?.disabledRules ?? [];
    expect(disabled.map((d) => d.decision)).toEqual(["DEC-MC-01"]);
  });
});
