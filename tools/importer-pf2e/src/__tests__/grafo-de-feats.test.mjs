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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { construirGrafo } from "../curation/grafo-de-feats.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS = join(__dirname, "..", "..", "..", "..", "systems", "pf2e", "packs");

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
    // r28 elevou para 86 ao publicar o Druid (classe piloto): +19 do próprio
    // Druid e +6 em classes que já estavam no grafo, TODOS medidos e
    // explicados — nenhum é ambiguidade nova de verdade, é a mesma
    // ambiguidade de sempre passando a ter um segundo candidato no pack.
    //   - Druid 0→19: "Untamed Form" (11 arestas — o talento L1 concedido
    //     pela Ordem Indômita tem HOMÔNIMO na magia de foco de mesmo nome, já
    //     em spells-core desde a r12) e a família de companheiro animal
    //     (8 arestas — o vendor escreve o pré-requisito SEM o sufixo
    //     "(Druid)", então "Animal Companion"/"Mature Animal Companion"/
    //     "Incredible Companion" casam com o doc do Druid E com o do Ranger).
    //   - Ranger 3→8 e Bard 2→3 (+6): a MESMA família de companheiro, vista
    //     do outro lado — os pré-requisitos de Stealthy Companion, Masterful
    //     Companion, Incredible Companion (Ranger), Mature Animal Companion
    //     (Ranger) e Chorus Companion ganharam o doc do Druid como segundo
    //     candidato. Marcar isso é o comportamento CERTO da issue #44: a
    //     resolução por nome é ambígua e o grafo agora diz que é.
    // Trava o total para que uma regressão silenciosa (uma mudança que pare
    // de marcar ambiguidade) quebre um teste, não um relatório manual.
    const totalAmbiguas = Object.values(grafo.classes).reduce(
      (acc, g) => acc + g.arestasAmbiguas,
      0,
    );
    assert.equal(totalAmbiguas, 86);
  });
});

/**
 * issue #26: 4 Monk prerequisites named something no pack document carries —
 * "Inner Upheaval" (a focus SPELL name, not the feat that grants qi spells),
 * "Stunning fist" (case-mismatched typo of no real doc), "Wholeness of Body"
 * (no equivalent in any pack, genuinely un-fixable). The first two are
 * reconciled by monk.json's `prerequisiteFixes` (applied by
 * applyPrerequisiteFixes before feats-core is written) — this suite proves
 * the reconciled text now resolves as a real edge in the committed pack, and
 * that the un-fixable one is STILL unresolved (not silently dropped).
 */
describe("construirGrafo — Monk prerequisite name reconciliation (issue #26)", () => {
  const monk = grafo.classes["Monk"];

  function incomingRotulos(featName) {
    const no = monk.nos.find((n) => n.nome === featName);
    assert.ok(no, `nó "${featName}" deve existir no universo do Monk`);
    return monk.arestas.filter((a) => a.para === no.id).map((a) => a.rotulo);
  }

  it("Elemental Fist resolve para 'Qi Spells' (não mais 'Inner Upheaval')", () => {
    assert.deepEqual(incomingRotulos("Elemental Fist"), ["Qi Spells"]);
  });

  it("Ki Cutting Sight resolve para 'Qi Spells' (não mais 'Inner Upheaval')", () => {
    assert.deepEqual(incomingRotulos("Ki Cutting Sight"), ["Qi Spells"]);
  });

  it("Vitality-Manipulating Stance resolve para 'Stunning Blows' (não mais 'Stunning fist')", () => {
    assert.deepEqual(incomingRotulos("Vitality-Manipulating Stance"), ["Stunning Blows"]);
  });

  it("Endurance of the Rooted Tree PERMANECE não-resolvido ('Wholeness of Body' não tem alvo no vendor)", () => {
    assert.deepEqual(incomingRotulos("Endurance of the Rooted Tree"), []);
    const entrada = monk.naoResolvidos.find((n) => n.nome === "Endurance of the Rooted Tree");
    assert.ok(entrada, "deve aparecer em naoResolvidos, não desaparecer silenciosamente");
    assert.equal(entrada.requisito, "Wholeness of Body");
  });
});

/**
 * issue #28: 3 nomes de causa pré-remaster ("paladin"/"redeemer"/"liberator
 * cause") e um "Exalt" que na verdade se chama "Exalted Reaction" — nenhum
 * resolvia. Renomeados (champion.json's `prerequisiteFixes`) para os nomes
 * reais confirmados por referência cruzada DENTRO do próprio pack (cada
 * talento cita, no seu próprio texto, a reação que a causa/feature real
 * concede). "Fiendsbane Oath" (Anchoring Aura/Banishing Blow) fica
 * deliberadamente sem correção — não existe em nenhum pack do vendor.
 */
describe("construirGrafo — Champion prerequisite name reconciliation (issue #28)", () => {
  const champion = grafo.classes["Champion"];

  function incomingRotulos(featName) {
    const no = champion.nos.find((n) => n.nome === featName);
    assert.ok(no, `nó "${featName}" deve existir no universo do Champion`);
    return champion.arestas.filter((a) => a.para === no.id).map((a) => a.rotulo);
  }

  it("Vengeful Oath resolve para 'Justice' (não mais 'paladin cause')", () => {
    assert.deepEqual(incomingRotulos("Vengeful Oath"), ["Justice"]);
  });

  it("Lasting Doubt resolve para 'Redemption' (não mais 'redeemer cause')", () => {
    assert.deepEqual(incomingRotulos("Lasting Doubt"), ["Redemption"]);
  });

  it("Liberating Stride resolve para 'Liberation' (não mais 'liberator cause')", () => {
    assert.deepEqual(incomingRotulos("Liberating Stride"), ["Liberation"]);
  });

  it("Aura of Vengeance resolve AMBOS os pré-requisitos ('Exalted Reaction' + 'Vengeful Oath')", () => {
    assert.deepEqual(new Set(incomingRotulos("Aura of Vengeance")), new Set(["Exalted Reaction", "Vengeful Oath"]));
  });

  it("Anchoring Aura e Banishing Blow PERMANECEM não-resolvidos ('Fiendsbane Oath' não existe em pack nenhum)", () => {
    for (const nome of ["Anchoring Aura", "Banishing Blow"]) {
      assert.deepEqual(incomingRotulos(nome), []);
      const entrada = champion.naoResolvidos.find((n) => n.nome === nome);
      assert.ok(entrada, `${nome} deve aparecer em naoResolvidos`);
      assert.equal(entrada.requisito, "Fiendsbane Oath");
    }
  });
});

/**
 * issue #30: "Master of Many Styles" vinha do vendor como DUAS entradas
 * separadas de prerequisites ("Opening Stance (Fighter)" e "Reflexive
 * Stance (Monk)"), lidas como CONJUNÇÃO (AND) por todo consumidor — mas um
 * Monge puro nunca consegue "Opening Stance" (trait fighter+guardian, fora
 * do alcance do slot de talento de classe de Monge) e um Lutador puro nunca
 * consegue "Reflexive Stance" (trait monk) sem dedicação de arquétipo, então
 * AND torna o capstone permanentemente inalcançável para os dois lados.
 * monk.json's prerequisiteFixes funde as 2 entradas numa só "A or B" — o
 * MESMO padrão que o vendor já usa em outros talentos do próprio pack.
 */
describe("construirGrafo — Master of Many Styles como alternativa OR (issue #30)", () => {
  it("o pack tem UMA única entrada de prerequisito combinada com ' or '", () => {
    const feats = JSON.parse(readFileSync(join(PACKS, "feats-core", "documents.json"), "utf8"));
    const doc = feats.find((d) => d.name === "Master of Many Styles");
    assert.ok(doc, "Master of Many Styles deve existir em feats-core");
    assert.deepEqual(doc.system.prerequisites, [
      { value: "Opening Stance (Fighter) or Reflexive Stance (Monk)" },
    ]);
  });

  it("o grafo continua resolvendo AMBAS as alternativas como aresta (interna e externa)", () => {
    const monk = grafo.classes["Monk"];
    const no = monk.nos.find((n) => n.nome === "Master of Many Styles");
    assert.ok(no, "nó Master of Many Styles deve existir no universo do Monk");
    const incoming = monk.arestas.filter((a) => a.para === no.id);
    const rotulos = incoming.map((a) => a.rotulo);
    assert.deepEqual(new Set(rotulos), new Set(["Opening Stance (Fighter)", "Reflexive Stance (Monk)"]));
    const reflexiva = incoming.find((a) => a.rotulo === "Reflexive Stance (Monk)");
    assert.equal(reflexiva.externa, false, "Reflexive Stance é um nó interno do Monk");
    const opening = incoming.find((a) => a.rotulo === "Opening Stance (Fighter)");
    assert.equal(opening.externa, true, "Opening Stance é externa (trait fighter)");
  });

  it("Qi Center e Immortal Techniques continuam com aresta a partir de Master of Many Styles", () => {
    const monk = grafo.classes["Monk"];
    const mms = monk.nos.find((n) => n.nome === "Master of Many Styles");
    for (const nome of ["Qi Center", "Immortal Techniques"]) {
      const no = monk.nos.find((n) => n.nome === nome);
      assert.ok(no, `nó ${nome} deve existir`);
      const aresta = monk.arestas.find((a) => a.de === mms.id && a.para === no.id);
      assert.ok(aresta, `${nome} deve ter aresta vinda de Master of Many Styles`);
    }
  });
});

/**
 * issue #46: dois textos atípicos do vendor.
 *  - Occult Evolution tinha um typo literal do vendor ("the" por "that"),
 *    confirmado presente NO PRÓPRIO arquivo do vendor (não introduzido pelo
 *    pipeline) — corrigido para bater com os 3 irmãos (Arcane/Divine/Primal
 *    Evolution). Cosmético: nenhum código interpreta esse texto hoje (não
 *    era nem vira aresta), então o teste confere o TEXTO, não uma aresta.
 *  - Echoing Channel ("Embodiment of Balance or Cleric") fica DELIBERADAMENTE
 *    sem correção: confirmado por leitura direta do vendor que o texto já
 *    chega assim da fonte — não é corrupção do pipeline, é prosa legítima
 *    (o feat é compartilhado Animist/Cleric; "or Cleric" é filiação de
 *    classe, não nome de outro feat). O teste prova que o texto NÃO mudou.
 */
describe("prerequisiteFixes — Occult Evolution (fixed) vs. Echoing Channel (deliberately untouched) (issue #46)", () => {
  const feats = JSON.parse(readFileSync(join(PACKS, "feats-core", "documents.json"), "utf8"));

  it("Occult Evolution não tem mais o typo 'the' no lugar de 'that'", () => {
    const doc = feats.find((d) => d.name === "Occult Evolution");
    assert.ok(doc, "Occult Evolution deve existir em feats-core");
    assert.deepEqual(doc.system.prerequisites, [{ value: "bloodline that grants occult spells" }]);
  });

  it("os 4 irmãos de Evolution usam agora o MESMO padrão de texto ('bloodline that grants <tradição> spells')", () => {
    for (const [nome, tradicao] of [
      ["Arcane Evolution", "arcane"],
      ["Divine Evolution", "divine"],
      ["Occult Evolution", "occult"],
      ["Primal Evolution", "primal"],
    ]) {
      const doc = feats.find((d) => d.name === nome);
      assert.ok(doc, `${nome} deve existir`);
      assert.deepEqual(doc.system.prerequisites, [
        { value: `bloodline that grants ${tradicao} spells` },
      ]);
    }
  });

  it("Echoing Channel PERMANECE exatamente como veio do vendor — não é corrupção do pipeline, é prosa legítima", () => {
    const doc = feats.find((d) => d.name === "Echoing Channel");
    assert.ok(doc, "Echoing Channel deve existir em feats-core");
    assert.deepEqual(doc.system.prerequisites, [{ value: "Embodiment of Balance or Cleric" }]);
  });
});
