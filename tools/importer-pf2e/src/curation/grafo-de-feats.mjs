/**
 * Mapa de nós dos talentos de classe (r21).
 *
 * Pedido do dono do projeto: *"um mapa de nós de cada classe, tendo um nó por
 * feat e as arestas como pré-requisitos, num mapa dividido em 20 colunas,
 * sendo as colunas os níveis de personagem."*
 *
 * Este script produz o DADO do grafo, deterministicamente, a partir dos packs
 * já construídos. A visualização é outra camada — o dado aqui é o contrato.
 *
 * ## Como uma aresta nasce
 *
 * O vendor guarda pré-requisito como TEXTO LIVRE
 * (`system.prerequisites: [{value: "Slam Down"}]`), não como referência. A
 * resolução é por nome normalizado contra o universo de nós da própria classe
 * (feats + class features + os feats compartilhados que ela alcança).
 *
 * Regra que evita aresta inventada: pré-requisito que NÃO resolve para um nó
 * vira **atributo do nó** (`requisitosNaoResolvidos`), nunca uma aresta para
 * lugar nenhum. "Trained in Athletics" é requisito de perícia, não de talento —
 * e tem de continuar visível ao jogador, não sumir por não caber no grafo.
 *
 * Casos reais que a normalização precisa cobrir (medidos nos relatórios de
 * curadoria da r21):
 *  - sufixo desambiguador: o texto diz "Ricochet Stance", o feat se chama
 *    "Ricochet Stance (Rogue)";
 *  - alternativa: "Aggressive Block or Brutish Shove" — duas arestas, não uma;
 *  - referência a outra classe: "Reflexive Stance (Monk)" — fora do universo
 *    da classe, vira não-resolvido com o motivo.
 *
 * Uso:
 *   node src/curation/grafo-de-feats.mjs [--out <arquivo.json>]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadClassCuration } from "./index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS = join(__dirname, "..", "..", "..", "..", "systems", "pf2e", "packs");

/** Nome comparável: minúsculo, sem acento, sem pontuação, espaço colapsado. */
export function normalizar(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Ricochet Stance (Rogue)" → "ricochet stance" (para casar com o texto cru). */
function semSufixo(nome) {
  return normalizar(String(nome).replace(/\s*\([^)]*\)\s*$/, ""));
}

/**
 * Rótulos comparáveis de um eixo de escolha. O vendor nomeia a OPÇÃO sem o eixo
 * ("Enigma", "Thief", "Warpriest") mas o pré-requisito cita o eixo junto
 * ("enigma muse", "thief racket", "warpriest doctrine"). Sem casar as duas
 * formas, 68 requisitos legítimos viravam não-resolvidos — a maior fatia dos
 * não-resolvidos de Bard, Rogue, Champion e Magus.
 *
 * As formas vêm da própria curadoria (`category`, `slotType`,
 * `featureNameInItemsMap`), nunca de uma lista chumbada aqui.
 */
function rotulosDoEixo(axis) {
  const brutos = [axis.category, axis.slotType, axis.featureNameInItemsMap];
  const formas = new Set();
  for (const bruto of brutos) {
    if (!bruto) continue;
    // camelCase/kebab-case → palavras: "hybridStudy" e "hunters-edge".
    const label = normalizar(
      String(bruto)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/-/g, " "),
    );
    if (!label) continue;
    formas.add(label);
    // "muses" → "muse"; "rogue s racket" → "racket" (o eixo é a última palavra).
    if (label.endsWith("s")) formas.add(label.slice(0, -1));
    const ultima = label.split(" ").pop();
    if (ultima && ultima !== label) {
      formas.add(ultima);
      if (ultima.endsWith("s")) formas.add(ultima.slice(0, -1));
    }
  }
  return [...formas].filter((f) => f.length > 2);
}

/**
 * Quebra um texto de pré-requisito em candidatos. "A or B" e "A, B" viram dois
 * candidatos; o resto vira um só.
 */
export function candidatosDoRequisito(texto) {
  return (
    String(texto ?? "")
      // A vírgula de Oxford precisa ser consumida junto com o "or" (issue #31):
      // com o `,\s*` casando antes, o último candidato de "A, B, or C" saía como
      // "or C" e nenhuma aresta do grafo resolvia. Mantido em sincronia com
      // `prerequisiteCandidates` em packages/client/src/lib/sheets/pf2e/planVM.ts.
      .split(/\s*,\s*or\s+|\s+or\s+|\s*,\s*/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  );
}

function carregar(pack) {
  return JSON.parse(readFileSync(join(PACKS, pack, "documents.json"), "utf8"));
}

function traits(doc) {
  return doc.system?.traits?.value ?? [];
}

export function construirGrafo() {
  const feats = carregar("feats-core");
  const features = carregar("class-features-core");
  const classes = carregar("classes-core");
  // Ações entram no universo de resolução porque pré-requisito aponta para
  // elas: "Extended Kinesis" exige "Base Kinesis", que é uma AÇÃO concedida
  // pela classe, não um talento. Sem isto a aresta se perdia em silêncio —
  // achado ao investigar por que o Cinetista tinha só 3 arestas.
  const acoes = carregar("actions-core");
  // Mesma razão das ações: pré-requisito aponta para MAGIA de foco concedida
  // pela classe — "lay on hands" (Champion), "courageous anthem" (Bard),
  // "touch of the void", "shields of the spirit". São documentos reais no pack,
  // logo são aresta (externa), não requisito solto. O casamento é por nome
  // INTEIRO, então texto descritivo ("dispel magic in your spell repertoire")
  // continua não-resolvido em vez de virar aresta inventada.
  const magias = carregar("spells-core");
  const curadoria = loadClassCuration();

  const grafo = { geradoDe: "systems/pf2e/packs", classes: {} };

  for (const classeDoc of classes) {
    const cfg = [...curadoria.values()].find((c) => c.displayName === classeDoc.name);
    if (!cfg) continue;
    const trait = cfg.classFeats.trait;

    // Universo de nós: os class feats da classe + as features que ela concede
    // (features entram porque são alvo legítimo de pré-requisito — "Rage",
    // "Shield Block" — e porque é onde a árvore começa).
    const featsDaClasse = feats.filter(
      (f) => f.system?.category === "class" && traits(f).includes(trait),
    );
    const idsDasFeatures = new Set((classeDoc.system?.featuresByLevel ?? []).map((f) => f.uuid));
    // As OPÇÕES de eixo (Dragon Instinct, Ruffian Racket, Starlit Span...) não
    // estão no featuresByLevel — lá está só o placeholder da escolha. Sem elas
    // no universo, todo pré-requisito do tipo "dragon instinct" fica órfão:
    // medido, eram 96 requisitos não resolvidos, a maior fatia deles disto.
    const categoriasDeEixo = new Set(cfg.choiceAxes.map((a) => a.category));
    const opcoesDeEixo = features.filter((f) => categoriasDeEixo.has(f.system?.category));
    const featuresDaClasse = [
      ...features.filter((f) => idsDasFeatures.has(f._id)),
      ...opcoesDeEixo,
    ];

    const nos = [
      ...featuresDaClasse.map((d) => ({
        id: d._id,
        nome: d.name,
        nivel: (classeDoc.system?.featuresByLevel ?? []).find((f) => f.uuid === d._id)?.level ?? 1,
        tipo: "feature",
        traits: traits(d),
        categoria: d.system?.category ?? "classfeature",
      })),
      ...featsDaClasse.map((d) => ({
        id: d._id,
        nome: d.name,
        nivel: d.system?.level ?? 1,
        tipo: "feat",
        traits: traits(d),
        categoria: d.system?.category ?? "class",
      })),
    ].sort((a, b) => a.nivel - b.nivel || a.nome.localeCompare(b.nome));

    // Índice de resolução: nome exato e nome sem sufixo desambiguador.
    const porNome = new Map();
    for (const no of nos) {
      porNome.set(normalizar(no.nome), no.id);
      const curto = semSufixo(no.nome);
      if (!porNome.has(curto)) porNome.set(curto, no.id);
    }

    // Índice MULTI-valorado espelhando porNome (issue #44): porNome só guarda
    // o PRIMEIRO id que registra cada chave — o resto fica invisível. Sem
    // este segundo índice, "shield block" casando com a class feature Shield
    // Block E o talento partilhado Shield Block (Champion/Fighter, medido:
    // 58 arestas assim nas 12 classes) escolhe uma das duas em silêncio, e
    // qualquer mudança na ordem de indexação inverte a escolha sem aviso.
    // NÃO muda qual alvo a aresta usa (isso segue vindo de porNome/
    // porNomeGlobal, inalterados) — só torna a ambiguidade um DADO
    // (`aresta.ambiguo` + `aresta.candidatos`) em vez de um acidente de
    // ordem de varredura.
    const porNomeTodos = new Map();
    const addTodos = (map, chave, id) => {
      if (!chave) return;
      if (!map.has(chave)) map.set(chave, new Set());
      map.get(chave).add(id);
    };
    for (const no of nos) {
      addTodos(porNomeTodos, normalizar(no.nome), no.id);
      addTodos(porNomeTodos, semSufixo(no.nome), no.id);
    }

    // Aliases "<opção> <eixo>": o pré-requisito cita o eixo junto do nome da
    // opção, mas o documento se chama só pela opção. Também cobre o prefixo do
    // vendor no Sorcerer ("Bloodline: Draconic" ↔ "draconic bloodline").
    for (const axis of cfg.choiceAxes) {
      const rotulos = rotulosDoEixo(axis);
      if (rotulos.length === 0) continue;
      for (const no of nos.filter((n) => n.categoria === axis.category)) {
        const base = new Set([normalizar(no.nome), semSufixo(no.nome)]);
        for (const rotulo of rotulos) {
          // "Bloodline: Draconic" → base "draconic".
          for (const b of [...base]) {
            if (b.startsWith(`${rotulo} `)) base.add(b.slice(rotulo.length + 1));
          }
        }
        for (const b of base) {
          if (!b) continue;
          for (const rotulo of rotulos) {
            const alias = `${b} ${rotulo}`;
            if (!porNome.has(alias)) porNome.set(alias, no.id);
            addTodos(porNomeTodos, alias, no.id);
          }
        }
      }
    }

    // Universo secundário: o pack inteiro. Um pré-requisito pode apontar para
    // um skill feat ("Pickpocket", "Snare Crafting") ou para um feat de outra
    // classe ("Reflexive Stance (Monk)"). Isso É uma aresta — só não é uma
    // aresta INTERNA. Marcar como externa preserva a informação sem poluir a
    // árvore da classe.
    const porNomeGlobal = new Map();
    const porNomeGlobalTodos = new Map();
    for (const d of [...feats, ...features, ...acoes, ...magias]) {
      const n = normalizar(d.name);
      if (!porNomeGlobal.has(n)) porNomeGlobal.set(n, { id: d._id, nome: d.name });
      addTodos(porNomeGlobalTodos, n, d._id);
      const c = semSufixo(d.name);
      if (!porNomeGlobal.has(c)) porNomeGlobal.set(c, { id: d._id, nome: d.name });
      addTodos(porNomeGlobalTodos, c, d._id);
    }

    /**
     * Todos os documentos (internos + externos) cujo nome normalizado casa
     * com `cand`, MENOS o próprio `doc` — issue #44: o mesmo merge que
     * decide `ambiguo`/`candidatos` de uma aresta, independente de qual dos
     * dois índices (interno/externo) forneceu o alvo escolhido pela aresta.
     */
    function candidatosPara(cand, doc) {
      const chave = normalizar(cand);
      const curta = semSufixo(cand);
      const ids = new Set([
        ...(porNomeTodos.get(chave) ?? []),
        ...(porNomeTodos.get(curta) ?? []),
        ...(porNomeGlobalTodos.get(chave) ?? []),
        ...(porNomeGlobalTodos.get(curta) ?? []),
      ]);
      ids.delete(doc._id);
      return [...ids];
    }

    const arestas = [];
    const naoResolvidos = [];

    for (const doc of featsDaClasse) {
      const pres = doc.system?.prerequisites ?? [];
      for (const pre of pres) {
        const texto = typeof pre === "string" ? pre : (pre?.value ?? "");
        let resolveuAlgum = false;
        for (const cand of candidatosDoRequisito(texto)) {
          const alvo = porNome.get(normalizar(cand)) ?? porNome.get(semSufixo(cand));
          if (alvo && alvo !== doc._id) {
            const candidatos = candidatosPara(cand, doc);
            arestas.push({
              de: alvo,
              para: doc._id,
              rotulo: cand,
              externa: false,
              // issue #44: NÃO muda o alvo (ainda o primeiro que porNome
              // registrou) — só expõe quando esse alvo foi uma escolha entre
              // 2+ documentos reais, para a ambiguidade parar de ser
              // silenciosa.
              ambiguo: candidatos.length > 1,
              candidatos,
            });
            resolveuAlgum = true;
            continue;
          }
          const fora = porNomeGlobal.get(normalizar(cand)) ?? porNomeGlobal.get(semSufixo(cand));
          if (fora && fora.id !== doc._id) {
            const candidatos = candidatosPara(cand, doc);
            arestas.push({
              de: fora.id,
              para: doc._id,
              rotulo: cand,
              externa: true,
              nomeExterno: fora.nome,
              ambiguo: candidatos.length > 1,
              candidatos,
            });
            resolveuAlgum = true;
          }
        }
        if (!resolveuAlgum) {
          naoResolvidos.push({ no: doc._id, nome: doc.name, requisito: texto });
        }
      }
    }

    // Colunas: 1..20, nível de personagem. Sob a variante de multiclasse
    // (specs/30) a coluna passa a ser o nível DA CLASSE — o dado não muda,
    // muda a leitura, e é por isso que o campo se chama `nivel` e não
    // `nivelDePersonagem`.
    const colunas = Array.from({ length: 20 }, (_, i) => ({
      nivel: i + 1,
      nos: nos.filter((n) => n.nivel === i + 1).map((n) => n.id),
    }));

    grafo.classes[classeDoc.name] = {
      trait,
      totalNos: nos.length,
      totalArestas: arestas.length,
      requisitosNaoResolvidos: naoResolvidos.length,
      nos,
      arestas,
      colunas,
      naoResolvidos,
      // Nó sem nenhuma aresta chegando E sem aresta saindo: ilha. Não é
      // defeito (a maioria dos feats é independente), mas é o número que diz
      // se a "árvore" da classe é árvore mesmo ou uma lista.
      arestasExternas: arestas.filter((a) => a.externa).length,
      // Quantas arestas resolveram um rótulo que casa com 2+ documentos
      // distintos (issue #44) — o alvo escolhido não mudou, mas agora dá para
      // medir o tamanho do risco a cada build em vez de descobri-lo por
      // auditoria manual.
      arestasAmbiguas: arestas.filter((a) => a.ambiguo).length,
      // Quantos talentos da classe DECLARAM pré-requisito. É o número que
      // explica a forma do mapa: o Cinetista tem 7% e o Bárbaro 48% — um é
      // desenhado por portão elemental, o outro por cadeia de talentos.
      featsComPreRequisito: featsDaClasse.filter((d) => (d.system?.prerequisites ?? []).length > 0)
        .length,
      totalFeats: featsDaClasse.length,
      ilhas: nos.filter((n) => !arestas.some((a) => a.de === n.id || a.para === n.id)).length,
    };
  }

  return grafo;
}

// Só roda o CLI (lê packs de novo via construirGrafo() + escreve o arquivo)
// quando o script é executado diretamente — nunca ao ser IMPORTADO. Sem esta
// guarda, testar `construirGrafo` (issue #44 — marcação de ambiguidade)
// disparava uma escrita real em disco a cada `import`, o mesmo problema que
// já levou normalize.test.mjs/transform.test.mjs a nunca importar seus
// módulos-CLI irmãos (ver o comentário de topo desses arquivos).
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const idxOut = args.indexOf("--out");
  const saida =
    idxOut !== -1 && args[idxOut + 1] !== undefined
      ? args[idxOut + 1]
      : join(__dirname, "..", "..", "out", "grafo-de-feats.json");

  const grafo = construirGrafo();
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, JSON.stringify(grafo, null, 2), "utf8");

  console.log(`[grafo] ${Object.keys(grafo.classes).length} classes → ${saida}`);
  for (const [nome, g] of Object.entries(grafo.classes)) {
    console.log(
      `  ${nome.padEnd(12)} nós ${String(g.totalNos).padStart(4)} | arestas ${String(g.totalArestas).padStart(3)} | ilhas ${String(g.ilhas).padStart(3)} | requisitos não resolvidos ${g.requisitosNaoResolvidos}`,
    );
  }
}
