/**
 * Regras do vendor DESATIVADAS por decisão de produto (não por falta de
 * suporte do importer).
 *
 * ## Por que este arquivo existe
 *
 * `flags.fusion.unconvertedRules` já responde "o importer não soube converter
 * esta regra". Falta a outra resposta: **"nós decidimos que esta regra não
 * vale aqui"**. Sem um lugar para isso, a única saída seria editar o
 * `documents.json` gerado à mão — e a próxima execução do
 * `build-mvp-subset.mjs` reverteria a decisão em silêncio (a mesma armadilha
 * que `prerequisiteFixes` resolve para o texto de pré-requisito).
 *
 * Aqui a decisão vira DADO: cada entrada declara o documento, a regra
 * atingida, a decisão que a motivou e o motivo em uma frase. O efeito é
 * **desativar, não apagar**: a regra sai de `system.rules[]` (deixa de ser
 * aplicada por qualquer consumidor) e entra em `flags.fusion.disabledRules[]`
 * com a justificativa junto. O dado do vendor continua no banco, inteiro,
 * pronto para voltar quando a decisão mudar.
 *
 * ## Como reativar
 *
 * Remover a entrada daqui e regerar o pack. Nada mais — não há patch à mão
 * para desfazer em lugar nenhum.
 */

/**
 * @typedef {object} RuleMatcher
 * @property {string} [kind]  valor de `rules[].kind` (forma Fusion, ex. "grant-item")
 * @property {string} [key]   valor de `rules[].raw.key` (forma do vendor, ex. "GrantItem")
 * @property {string} [uuid]  valor exato de `rules[].uuid`
 *
 * @typedef {object} DisabledRuleDecl
 * @property {string} pack       slug do pack onde o documento vive (ex. "heritages-core")
 * @property {string} docName    `name` do documento no pack (ex. "Ancient Elf")
 * @property {string} decision   identificador da decisão (ex. "DEC-MC-01")
 * @property {string} decidedOn  data ISO da decisão (YYYY-MM-DD)
 * @property {string} reason     uma frase: por que a regra não vale aqui
 * @property {RuleMatcher[]} rules  as regras de `system.rules[]` a desativar
 */

/**
 * DEC-MC-01 (2026-08-23) — a herança Ancient Elf (Elfo Ancião) concede, pelas
 * regras do PF2e, um talento de dedicação de multiclasse à escolha do
 * jogador. No Fusion essa concessão nunca chegou a funcionar: o vendor a
 * modela como `ChoiceSet` + `GrantItem` apontando para o placeholder
 * `{item|flags.system.rulesSelections.ancientElf}`, o `ChoiceSet` não é
 * convertido (a escolha nunca é oferecida) e o `GrantItem` que sobra aponta
 * para um placeholder que ninguém resolve — o `grantMaterializer` do client o
 * reporta como `unresolved-placeholder` toda vez que a herança entra numa
 * ficha. Como a multiclasse vai ser refeita do zero, manter a concessão só
 * mantém ruído: ela é desativada agora e volta junto com o desenho novo.
 *
 * @type {DisabledRuleDecl[]}
 */
export const DISABLED_RULES = [
  {
    pack: "heritages-core",
    docName: "Ancient Elf",
    decision: "DEC-MC-01",
    decidedOn: "2026-08-23",
    reason:
      "A dedicação de multiclasse concedida pela herança fica fora do app até a multiclasse ser refeita (docs/design/decisao-elfo-anciao-dedicacao.md).",
    rules: [{ kind: "grant-item", uuid: "{item|flags.system.rulesSelections.ancientElf}" }],
  },
];

/** Toda declaração que atinge o pack `packSlug`, na ordem de arquivo. */
export function disabledRulesForPack(packSlug) {
  return DISABLED_RULES.filter((d) => d.pack === packSlug);
}

/** A regra `rule` casa com o matcher declarado? Todo campo presente precisa bater. */
function matchesRule(rule, matcher) {
  if (matcher.kind !== undefined && rule?.kind !== matcher.kind) return false;
  if (matcher.key !== undefined && rule?.raw?.key !== matcher.key) return false;
  if (matcher.uuid !== undefined && rule?.uuid !== matcher.uuid) return false;
  return true;
}

/**
 * Aplica, aos `docs` transformados do pack `packSlug`, toda desativação
 * declarada para ele — MUTANDO cada documento atingido: a regra sai de
 * `system.rules[]` e entra em `flags.fusion.disabledRules[]` como
 * `{ decision, decidedOn, reason, rule }`.
 *
 * Uma declaração cujo documento está neste pack mas cuja regra NÃO está mais
 * lá LANÇA na hora — o dado do vendor mudou e a decisão precisa ser relida,
 * não silenciosamente virar no-op (mesma filosofia de `applyPrerequisiteFixes`).
 * Uma declaração cujo documento não está nestes `docs` fica para outra
 * chamada encontrar; o retorno diz o que foi tocado aqui para
 * {@link assertAllDisabledRulesApplied} cobrar o resto.
 *
 * @param {string} packSlug
 * @param {Array<Record<string, any>>} docs
 * @returns {Set<string>} `docName`s efetivamente tocados nesta chamada
 */
export function applyDisabledRules(packSlug, docs) {
  const byName = new Map(docs.map((d) => [d.name, d]));
  const touched = new Set();

  for (const decl of disabledRulesForPack(packSlug)) {
    const doc = byName.get(decl.docName);
    if (!doc) continue;
    touched.add(decl.docName);

    const rules = doc.system?.rules;
    if (!Array.isArray(rules)) {
      throw new Error(
        `[disabledRules] ${decl.decision} "${decl.docName}": system.rules não é array — dado do vendor mudou?`,
      );
    }

    const fusion = doc.flags?.fusion;
    if (!fusion) {
      throw new Error(
        `[disabledRules] ${decl.decision} "${decl.docName}": flags.fusion ausente — documento não passou pelo transform?`,
      );
    }

    for (const matcher of decl.rules) {
      const index = rules.findIndex((r) => matchesRule(r, matcher));
      if (index === -1) {
        throw new Error(
          `[disabledRules] ${decl.decision} "${decl.docName}": regra ${JSON.stringify(matcher)} não encontrada em ${JSON.stringify(rules)} — dado do vendor mudou?`,
        );
      }
      const [rule] = rules.splice(index, 1);
      fusion.disabledRules ??= [];
      fusion.disabledRules.push({
        decision: decl.decision,
        decidedOn: decl.decidedOn,
        reason: decl.reason,
        rule,
      });
    }
  }

  return touched;
}

/**
 * Falha alto quando uma desativação declarada para um pack que ESTA execução
 * escreveu não encontrou seu documento — declaração obsoleta (typo no
 * `docName`, documento renomeado/removido no vendor) tem de aparecer aqui, não
 * virar no-op que ressuscita em silêncio a regra que alguém decidiu desativar.
 *
 * A cobrança é por pack escrito, de propósito: `build-mvp-subset.mjs` gera
 * pf2e OU sf2e por execução, e cobrar declarações de um sistema que nem rodou
 * reprovaria a geração do outro.
 *
 * @param {Map<string, Set<string>>} touchedByPack slug do pack → `docName`s tocados nele
 */
export function assertAllDisabledRulesApplied(touchedByPack) {
  const missing = DISABLED_RULES.filter((d) => touchedByPack.has(d.pack))
    .filter((d) => !touchedByPack.get(d.pack).has(d.docName))
    .map((d) => `${d.pack}/${d.docName}`);
  if (missing.length > 0) {
    throw new Error(
      `[disabledRules] nunca aplicadas (documento não encontrado no pack declarado): ${missing.join(", ")}`,
    );
  }
}
