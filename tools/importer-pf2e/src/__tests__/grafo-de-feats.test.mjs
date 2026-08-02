/**
 * grafo-de-feats.test.mjs — Testes da marcação de ambiguidade no grafo de
 * talentos (issue #44).
 *
 * Contexto do defeito: `system.prerequisites` do vendor é TEXTO LIVRE
 * ("Rallying Anthem", "Shield Block", "Reactive Strike", ...). Quando o texto
 * casa por nome normalizado com 2+ documentos DISTINTOS no universo da classe
 * (ex.: "Rallying Anthem" existe como talento de classe do Bardo E como magia
 * de composição — trait bard em ambos), o código escolhia UM deles pela
 * ORDEM DE VARREDURA do `Map` (primeiro que registra vence) sem deixar
 * nenhum rastro de que havia outro candidato — risco silencioso que cresce
 * a cada pack novo (issue #44, evidência #3/#4).
 *
 * Esta suíte não muda qual alvo a aresta escolhe (mudar a REGRA de
 * desambiguação exige uma decisão de produto — ver "Pista" da issue #44) —
 * só EXIGE que a ambiguidade fique visível: toda aresta cujo rótulo casa com
 * 2+ documentos distintos deve carregar `ambiguo: true` + `candidatos` com
 * todos os ids concorrentes, e cada classe deve expor `arestasAmbiguas`.
 *
 * Casos reais usados (medidos em systems/pf2e/packs/*-core, r22/r23):
 *   - Bardo: "Defensive Coordination" <- "Rallying Anthem" casa com o talento
 *     de classe (feats-core, DvjgdS2LkEqpPmZP) E a magia de composição
 *     (spells-core, QreHVEpW0gbwRbz4).
 *   - Campeão/Guerreiro: "Shield Warden"/"Quick Shield Block"/"Channeling
 *     Block" <- "shield block" casa com a class feature Shield Block
 *     (class-features-core, MbMJIRm8Ecdwk7pi) E o talento partilhado Shield
 *     Block (feats-core, qbauCrdDDJIh8BXR).
 *
 * Execução:
 *   node --test src/__tests__/grafo-de-feats.test.mjs
 *
 * Zero dependências externas — Node 22 ESM nativo + node:test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { construirGrafo } from "../curation/grafo-de-feats.mjs";

const grafo = construirGrafo();

describe("construirGrafo — marcação de ambiguidade (issue #44)", () => {
  it("marca a aresta 'Rallying Anthem' (Bardo) como ambígua com os 2 candidatos reais", () => {
    const bardo = grafo.classes["Bard"];
    assert.ok(bardo, "classe Bard deve existir no grafo");
    const aresta = bardo.arestas.find(
      (a) =>
        a.rotulo === "Rallying Anthem" &&
        a.para === bardo.nos.find((n) => n.nome === "Defensive Coordination")?.id,
    );
    assert.ok(aresta, "aresta Defensive Coordination <- Rallying Anthem deve existir");
    assert.equal(aresta.ambiguo, true);
    assert.deepEqual(new Set(aresta.candidatos), new Set(["DvjgdS2LkEqpPmZP", "QreHVEpW0gbwRbz4"]));
  });

  it("marca as arestas 'shield block' (Campeão) como ambíguas com os 2 candidatos reais", () => {
    const campeao = grafo.classes["Champion"];
    assert.ok(campeao, "classe Champion deve existir no grafo");
    const arestasShieldBlock = campeao.arestas.filter(
      (a) => a.rotulo.toLowerCase() === "shield block",
    );
    assert.ok(arestasShieldBlock.length > 0, "deve haver ao menos uma aresta 'shield block'");
    for (const aresta of arestasShieldBlock) {
      assert.equal(aresta.ambiguo, true);
      assert.deepEqual(
        new Set(aresta.candidatos),
        new Set(["MbMJIRm8Ecdwk7pi", "qbauCrdDDJIh8BXR"]),
      );
    }
  });

  it("NÃO marca como ambígua uma aresta cujo rótulo casa com um único documento", () => {
    // "Cleave" é requisito real de um talento do Barbarian e resolve para um
    // único documento no universo da classe — não deve carregar
    // ambiguo/candidatos além do próprio alvo.
    const barbaro = grafo.classes["Barbarian"];
    assert.ok(barbaro, "classe Barbarian deve existir no grafo");
    const aresta = barbaro.arestas.find((a) => a.rotulo === "Cleave");
    assert.ok(aresta, "deve existir ao menos uma aresta com rótulo 'Cleave'");
    assert.equal(aresta.ambiguo, false);
    assert.deepEqual(aresta.candidatos, [aresta.de]);
  });

  it("expõe arestasAmbiguas por classe, coerente com a contagem real das arestas marcadas", () => {
    for (const [nome, g] of Object.entries(grafo.classes)) {
      const contagemReal = g.arestas.filter((a) => a.ambiguo).length;
      assert.equal(g.arestasAmbiguas, contagemReal, `classe ${nome}`);
    }
    // Medido (r23, issue #44): 58 arestas ambíguas nas 12 classes atuais.
    // issue #16 elevou para 61: as 3 novas variantes "Masterful Hunter
    // (Flurry/Outwit/Precision)" em class-features-core tornam visível uma
    // ambiguidade que já existia no texto de pré-requisito "Masterful
    // Hunter" do Ranger — antes só havia 1 candidato (o nó genérico da
    // escolha) para casar; agora há 4 (o nó genérico + as 3 variantes reais).
    // Trava o total para que uma regressão silenciosa (uma mudança que pare
    // de marcar ambiguidade) quebre um teste, não um relatório manual.
    const totalAmbiguas = Object.values(grafo.classes).reduce(
      (acc, g) => acc + g.arestasAmbiguas,
      0,
    );
    assert.equal(totalAmbiguas, 61);
  });
});
