/**
 * choice-set.mjs — conversão determinística de `ChoiceSet(itemType: "feat")`
 * para o descritor `feat-choice` que o cliente JÁ consome.
 *
 * r25 / bloco 2 — INSUMO. Este módulo NÃO está ligado ao pipeline: quem liga é
 * o integrador (ver `.fusion-build/r25/insumos/ancient-elf-choiceset.md`, §"o
 * patch"). Ele existe separado para poder ser medido contra o `out/` real antes
 * de qualquer rebuild de pack.
 *
 * ## O que o vendor declara
 *
 * Um `ChoiceSet` com `choices.itemType === "feat"` é sempre a mesma mecânica:
 * *escolha um talento que satisfaça estes predicados*. O resultado da escolha é
 * gravado numa flag (`flag`), e um `GrantItem` irmão aponta para
 * `{item|flags.system.rulesSelections.<flag>}` — o par ChoiceSet+GrantItem é a
 * concessão inteira. Sem o par, o `ChoiceSet` é só um parâmetro de outra regra.
 *
 * ## O que o Fusion consome
 *
 * `packages/client/src/lib/sheets/pf2e/planVM.ts` → `GrantedFeatFilter`:
 *   { labelKey, predicates: Array<{kind:"category"|"trait"|"levelAtMost", value}> }
 * avaliado por `matchesGrantedFeatFilter` sobre o índice do pack. É ESSE o
 * formato emitido aqui (campo `predicates`), para que a conversão não seja
 * inerte de um segundo jeito — emitir num formato que ninguém lê é o mesmo
 * defeito silencioso com outro nome.
 *
 * Clean-room: ler a forma do rule element do Foundry é fato estrutural, não
 * código copiado. O repo foundryvtt/pf2e (Apache-2.0) é referência.
 */

/** Predicado de nível declarado no filtro do ChoiceSet, em qualquer das formas do vendor. */
function levelPredicateOf(predicate) {
  if (typeof predicate === "string") {
    return /^item:level:/.test(predicate) ? { form: "literal", raw: predicate } : null;
  }
  if (predicate && typeof predicate === "object") {
    for (const op of ["lte", "lt", "gte", "gt", "eq"]) {
      if (Array.isArray(predicate[op]) && predicate[op][0] === "item:level") {
        return { form: op, raw: predicate };
      }
    }
  }
  return null;
}

/** True se a string carrega um placeholder dinâmico do Foundry (`{actor|…}` / `{item|…}`). */
function isDynamic(value) {
  return typeof value === "string" && /\{(actor|item)\|/.test(value);
}

/**
 * Traduz o `choices.filter` do vendor para os predicados de `GrantedFeatFilter`.
 *
 * Formas reconhecidas (todas verificadas contra os 133 ChoiceSets dos packs):
 *   - "item:category:<slug>"      → { kind: "category", value }
 *   - "item:trait:<slug>"         → { kind: "trait", value }   (literal só)
 *   - { lte: ["item:level", N] }  → { kind: "levelAtMost", value: N }
 *
 * `allLiteral` cai para false em qualquer predicado que não caiba nessas três
 * formas (placeholder dinâmico, `or`/`not`/`nor`, `item:level:<N>` exato,
 * `{lte:["item:level","self:level"]}`, `item:rarity:*`, …). Um filtro
 * não-literal NÃO é convertido: converter meia-verdade é pior que declarar
 * dívida, porque o slot passa a oferecer talento que a regra proíbe.
 */
export function parseFeatChoicePredicates(filter) {
  const raw = Array.isArray(filter) ? filter : [];
  const predicates = [];
  let allLiteral = true;
  let levelPredicateDeclared = false;

  for (const p of raw) {
    const level = levelPredicateOf(p);
    if (level) {
      levelPredicateDeclared = true;
      if (level.form === "lte" && typeof p.lte[1] === "number") {
        predicates.push({ kind: "levelAtMost", value: p.lte[1] });
      } else {
        allLiteral = false;
      }
      continue;
    }
    if (typeof p === "string") {
      const category = /^item:category:(.+)$/.exec(p);
      if (category) {
        if (isDynamic(category[1])) allLiteral = false;
        else predicates.push({ kind: "category", value: category[1] });
        continue;
      }
      const trait = /^item:trait:(.+)$/.exec(p);
      if (trait) {
        if (isDynamic(trait[1])) allLiteral = false;
        else predicates.push({ kind: "trait", value: trait[1] });
        continue;
      }
      // Qualquer outro predicado string (item:rarity:*, item:tag:*, item:<slug>)
      // não tem campo correspondente em GrantedFeatFilter.
      allLiteral = false;
      continue;
    }
    // or/not/nor/xor/and — árvore de predicado, fora do modelo de hoje.
    allLiteral = false;
  }

  return { predicates, allLiteral, levelPredicateDeclared };
}

/** True se algum `GrantItem` irmão consome a flag deste ChoiceSet. */
export function isPairedWithGrantItem(siblingRules, flag) {
  if (!flag) return false;
  const needle = `rulesSelections.${flag}`;
  return (siblingRules ?? []).some(
    (r) =>
      (r?.key === "GrantItem" || r?.kind === "grant-item") &&
      typeof r.uuid === "string" &&
      r.uuid.includes(needle),
  );
}

/**
 * Converte um `ChoiceSet` em descritor `feat-choice`, ou devolve `null` quando
 * a conversão não é segura (e o rule element segue para `unconvertedRules`
 * exatamente como hoje).
 *
 * Condições, todas necessárias:
 *   1. `choices.itemType === "feat"` — só a escolha de TALENTO tem consumidor
 *      no cliente (`grantedFeat` sub-slot). Escolha de perícia/ancestralidade/
 *      magia/divindade continua dívida declarada.
 *   2. par com um `GrantItem` que consome a flag — sem o par, o ChoiceSet é
 *      parâmetro de outra regra, não concessão.
 *   3. filtro 100% literal nas três formas suportadas.
 *   4. `scope`: ver `CONVERSION_SCOPE`.
 */
export function convertChoiceSet(re, siblingRules, scope = "level-free-feat-choice") {
  const choices = re?.choices;
  if (Array.isArray(choices) || !choices || typeof choices !== "object") return null;
  if (choices.itemType !== "feat") return null;
  if (!isPairedWithGrantItem(siblingRules, re.flag)) return null;

  const { predicates, allLiteral, levelPredicateDeclared } = parseFeatChoicePredicates(
    choices.filter,
  );
  if (!allLiteral) return null;
  if (predicates.length === 0) return null;
  if (scope === "level-free-feat-choice" && levelPredicateDeclared) return null;

  return {
    kind: "feat-choice",
    flag: re.flag ?? null,
    // O rótulo é do Fusion (i18n própria), nunca a chave de i18n do vendor.
    labelKey: null,
    count: typeof choices.count === "number" ? choices.count : 1,
    predicates,
    /**
     * FATO, não política: o filtro do vendor declarou ou não um predicado de
     * nível. Quando NÃO declarou, o nível do talento não é restringido pela
     * concessão — é exatamente o caso do `Ancient Elf` ("even though you don't
     * meet its level prerequisite"). Quem decide o que fazer com isso é o
     * builder (planVM), não o importer.
     */
    levelPredicateDeclared,
    raw: re,
  };
}

/**
 * Escopos possíveis, do mais estreito ao mais largo. Medido em 2026-08-08 sobre
 * os 14 packs (133 ChoiceSets em 104 documentos):
 *
 *   - "level-free-feat-choice" (default): 1 documento — heritages-core/Ancient Elf.
 *   - "all-literal-feat-choice": 5 documentos (Ancient Elf, Basic Concoction,
 *     Basic Trickery, Multitalented, Versatile Human). Ver o insumo: exige
 *     consertar `tools/translate-packs/src/normalize-rules.mjs` e o
 *     `mechanics-parity.test.mjs` ANTES, porque os dois leem o ChoiceSet de
 *     `unconvertedRules`.
 */
export const CONVERSION_SCOPES = ["level-free-feat-choice", "all-literal-feat-choice"];
