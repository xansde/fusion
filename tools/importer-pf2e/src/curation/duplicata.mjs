/**
 * Portão de duplicata semântica (r21).
 *
 * Regra, literal, do dono do projeto: *"documentos de mesmo nome, se forem a
 * mesma coisa, devem ser unificados. Sempre."* Este módulo é essa regra
 * aplicada por máquina — para não depender de alguém reparar.
 *
 * ## O critério é CONTEÚDO, não nome
 *
 * Dois documentos são a mesma coisa quando batem em três eixos:
 * nome normalizado + `type` + descrição normalizada (sem HTML, sem variação
 * de espaço, minúscula). Batendo os três, é duplicata e o build FALHA.
 *
 * ## O que NÃO é duplicata (e por que o portão não pode acusar)
 *
 * O PF2e usa homônimo de propósito: um documento CONCEDE o outro. Medido nos
 * packs — 39 nomes repetidos, ZERO duplicatas — o padrão é sempre este:
 *
 * | pack                  | "Shield Block"                                        |
 * |-----------------------|-------------------------------------------------------|
 * | `class-features-core` | "You gain the Shield Block general feat" (passivo, com `grant-item`) |
 * | `feats-core`          | a reação em si: *Trigger… reduz dano até a Hardness do escudo* |
 *
 * São peças diferentes da mesma engrenagem: a feature de classe é a PORTA
 * (quem ganha, em que nível — 7 classes concedem), o feat é a HABILIDADE.
 * Unificar destruiria uma das metades: ou a classe deixa de conceder, ou a
 * habilidade deixa de existir. O mesmo vale para:
 *
 *   - feature → ação: Rage, Reactive Strike, Hunt Prey, Spellstrike,
 *     Arcane Cascade, Debilitating Strike, Master Strike, Extract Element
 *   - feat → magia de foco: Force Fang, Heal Companion, Magic Hide,
 *     Snare Hopping, Runic Impression, Cascade Countermeasure
 *   - ação → magia de mesmo nome: Fly, Detect Magic, Dragon Breath
 *
 * Por isso o eixo `type` entra na chave: `classFeature` ≠ `feat` ≠ `action` ≠
 * `spell`. E por isso a descrição entra: é ela que separa "você ganha X" de X.
 */

/** Texto comparável: sem HTML, sem espaço variável, minúsculo. */
export function textoNormalizado(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {Array<{pack:string,name:string,type:string,description?:string,sourceId?:string}>} docs
 * @returns {Array<Array<object>>} grupos com 2+ documentos que são a mesma coisa
 */
export function acharDuplicatas(docs) {
  const porChave = new Map();
  for (const doc of docs) {
    const chave = JSON.stringify([
      String(doc.name ?? "")
        .trim()
        .toLowerCase(),
      doc.type,
      textoNormalizado(doc.description),
    ]);
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push(doc);
  }
  return [...porChave.values()].filter((grupo) => grupo.length > 1);
}

/** Mensagem de erro que NOMEIA os pares — contagem sem lista não fecha portão. */
export function formatarErroDeDuplicata(grupos) {
  const detalhe = grupos
    .map((grupo) => {
      const onde = grupo.map((d) => `${d.pack}(${d.sourceId ?? "?"})`).join(" + ");
      return `  - "${grupo[0].name}" [${grupo[0].type}] em ${onde}`;
    })
    .join("\n");
  return (
    `PORTÃO DE DUPLICATA: ${grupos.length} documento(s) repetido(s) — mesmo nome, ` +
    `mesmo tipo e mesma descrição. Unifique (mantenha um sourceId e aponte as ` +
    `referências para ele) antes de gerar os packs.\n${detalhe}`
  );
}
