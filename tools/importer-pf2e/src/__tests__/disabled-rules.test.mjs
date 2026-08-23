/**
 * disabled-rules.test.mjs — DEC-MC-01 (Elfo Ancião sem dedicação de multiclasse).
 *
 * Duas coisas diferentes são testadas aqui:
 *
 * 1. O MECANISMO, contra documentos sintéticos — desativar move a regra de
 *    `system.rules[]` para `flags.fusion.disabledRules[]` (não apaga), e uma
 *    declaração cuja regra sumiu do vendor LANÇA em vez de virar no-op.
 * 2. O EFEITO no pack commitado — `systems/pf2e/packs/heritages-core/
 *    documents.json` não pode voltar a carregar a concessão. Este é o teste
 *    que pega uma regeneração de pack feita sem a curadoria.
 *
 * Execução:
 *   node --test src/__tests__/disabled-rules.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DISABLED_RULES,
  applyDisabledRules,
  assertAllDisabledRulesApplied,
  disabledRulesForPack,
} from "../curation/disabled-rules.mjs";

const PACKS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "systems", "pf2e", "packs");

const ANCIENT_ELF_UUID = "{item|flags.system.rulesSelections.ancientElf}";

/** Um Ancient Elf sintético com a mesma forma que o transform produz. */
function ancientElfDoc() {
  return {
    name: "Ancient Elf",
    type: "heritage",
    system: {
      rules: [
        { kind: "grant-item", uuid: ANCIENT_ELF_UUID, raw: { key: "GrantItem", uuid: ANCIENT_ELF_UUID } },
      ],
    },
    flags: { fusion: { conversion: "partial", unconvertedRules: [{ key: "ChoiceSet", flag: "ancientElf" }] } },
  };
}

describe("applyDisabledRules — mecanismo", () => {
  it("tira a regra de system.rules e a guarda em flags.fusion.disabledRules com a justificativa", () => {
    const doc = ancientElfDoc();
    const touched = applyDisabledRules("heritages-core", [doc]);

    assert.deepEqual([...touched], ["Ancient Elf"]);
    assert.deepEqual(doc.system.rules, [], "a concessão não pode continuar ativa");

    const disabled = doc.flags.fusion.disabledRules;
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].decision, "DEC-MC-01");
    assert.equal(disabled[0].decidedOn, "2026-08-23");
    assert.match(disabled[0].reason, /multiclasse/i);
    assert.equal(disabled[0].rule.uuid, ANCIENT_ELF_UUID, "a regra é preservada inteira, não apagada");
  });

  it("não toca o ChoiceSet não convertido (registro do que o vendor manda continua no lugar)", () => {
    const doc = ancientElfDoc();
    applyDisabledRules("heritages-core", [doc]);
    assert.deepEqual(doc.flags.fusion.unconvertedRules, [{ key: "ChoiceSet", flag: "ancientElf" }]);
  });

  it("ignora documento de outro pack (a mesma lista é aplicada pack a pack)", () => {
    const doc = ancientElfDoc();
    const touched = applyDisabledRules("feats-core", [doc]);
    assert.deepEqual([...touched], []);
    assert.equal(doc.system.rules.length, 1, "pack errado não desativa nada");
  });

  it("lança quando o documento está lá mas a regra declarada sumiu (dado do vendor mudou)", () => {
    const doc = ancientElfDoc();
    doc.system.rules = [];
    assert.throws(() => applyDisabledRules("heritages-core", [doc]), /não encontrada/);
  });

  it("lança quando o pack foi escrito mas a desativação declarada nele não achou o documento", () => {
    const vazio = new Map([["heritages-core", new Set()]]);
    assert.throws(() => assertAllDisabledRulesApplied(vazio), /nunca aplicadas/);

    const cheio = new Map([["heritages-core", new Set(DISABLED_RULES.map((d) => d.docName))]]);
    assert.doesNotThrow(() => assertAllDisabledRulesApplied(cheio));
  });

  it("não cobra declaração de pack que esta execução não escreveu (pf2e OU sf2e por vez)", () => {
    assert.doesNotThrow(() => assertAllDisabledRulesApplied(new Map([["weapons-core", new Set()]])));
  });
});

describe("DEC-MC-01 no pack commitado (heritages-core)", () => {
  const docs = JSON.parse(readFileSync(join(PACKS, "heritages-core", "documents.json"), "utf8"));
  const ancientElf = docs.find((d) => d.name === "Ancient Elf");

  it("a herança existe e continua no pack (desativar não é apagar)", () => {
    assert.ok(ancientElf, "Ancient Elf sumiu do heritages-core");
  });

  it("não concede mais nenhum talento: system.rules sem grant-item", () => {
    const grants = (ancientElf.system.rules ?? []).filter(
      (r) => r.kind === "grant-item" || r.raw?.key === "GrantItem",
    );
    assert.deepEqual(grants, [], "a dedicação de multiclasse voltou — pack regenerado sem a curadoria?");
  });

  it("a concessão está registrada como desativada, com decisão e motivo", () => {
    const disabled = ancientElf.flags?.fusion?.disabledRules ?? [];
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].decision, "DEC-MC-01");
    assert.equal(disabled[0].rule.uuid, ANCIENT_ELF_UUID);
  });

  it("a declaração de curadoria aponta para este pack", () => {
    assert.equal(disabledRulesForPack("heritages-core").length, 1);
  });
});
