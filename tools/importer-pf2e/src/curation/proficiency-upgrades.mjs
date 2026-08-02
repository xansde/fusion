/**
 * Derivação genérica de `proficiencyUpgrades` (r21).
 *
 * ANTES: uma tabela escrita à mão por classe em transform.mjs
 * (MAGUS_PROFICIENCY_UPGRADES, KINETICIST_PROFICIENCY_UPGRADES), ~18 linhas
 * cada, transcritas lendo os arquivos de feature um a um. Cinco classes novas
 * seriam mais 90 linhas de transcrição manual — e transcrição manual erra.
 *
 * AGORA: o dado já existe no vendor e é cruzado por código —
 *
 *   nível  ← o `items{}` DA CLASSE (fonte de verdade; o `system.level` do
 *            arquivo genérico da feature MENTE: armor-expertise.json diz 7,
 *            mas o Fighter concede no 11)
 *   stat   ← `system.subfeatures.proficiencies` da feature referenciada
 *   rank   ← idem (TEML numérico 1..4)
 *
 * O que a derivação NÃO consegue, e por isso continua declarado na curadoria
 * da classe:
 *
 *  - `proficiencyUpgradeExtras`: lacuna do vendor. Ex.: o Magus concede
 *    expert em armas MARCIAIS no nível 5, mas o `items{}` dele aponta para o
 *    `weapon-expertise.json` GENÉRICO, que só lista simple+unarmed. A entrada
 *    extra fica na curadoria, com fonte citada — nunca escondida no código.
 *  - `proficiencyMirrors`: quando um stat espelha outro em todo nível. Ex.:
 *    Kineticist — "your impulse attack roll uses the same proficiency as your
 *    kineticist class DC", então todo upgrade de `classDC` gera um de
 *    `impulse` no mesmo nível/rank.
 *
 * Vocabulário do vendor → vocabulário do Fusion: as chaves de arma
 * (simple/martial/advanced/unarmed) e de armadura (light/medium/heavy/
 * unarmored) são conjuntos disjuntos, então o prefixo é derivável sem
 * ambiguidade. Qualquer outra chave que não seja save/perception/spellcasting
 * é o slug da própria classe (o "class DC" dela) e vira `classDC`.
 */

const WEAPON_KEYS = new Set(["simple", "martial", "advanced", "unarmed"]);
const ARMOR_KEYS = new Set(["light", "medium", "heavy", "unarmored"]);
const DIRECT_KEYS = new Set(["fortitude", "reflex", "will", "perception", "spellcasting"]);

/**
 * Segunda fonte, mais estreita: `rules[]` do tipo ActiveEffectLike.
 *
 * Parte das progressões NÃO está em `subfeatures.proficiencies` — está num
 * rule element condicionado à classe. O caso que obriga isto a existir:
 * `weapon-expertise.json` lista só simple+unarmed em subfeatures, e concede
 * MARCIAIS por um ActiveEffectLike com predicado
 * `{or: ["class:champion", ..., "class:magus", ...]}`. Sem ler o rule, o
 * Magus perde expert em armas marciais no nível 5 — que é exatamente a linha
 * que a tabela autoral do transform.mjs precisou acrescentar à mão.
 *
 * O recorte é deliberadamente estreito e o resto é REPORTADO, nunca
 * descartado em silêncio (interpretar rule element por inteiro é [V2], ver
 * `specs/17-sistema-pf2e.md` DEC-PF2-04):
 *
 *  - `mode` tem de ser "upgrade";
 *  - `value` tem de ser número literal (nada de `ternary(...)`, `@actor...`);
 *  - o `path` tem de casar com uma estatística do vocabulário do Fusion;
 *  - o predicado tem de estar ausente ou ser uma disjunção simples de
 *    `class:<slug>` que INCLUA esta classe.
 */
const PROFICIENCY_PATHS = [
  [
    /^system\.proficiencies\.attacks\.(simple|martial|advanced|unarmed)\.rank$/,
    (m) => `weapons.${m[1]}`,
  ],
  [
    /^system\.proficiencies\.defenses\.(light|medium|heavy|unarmored)\.rank$/,
    (m) => `armor.${m[1]}`,
  ],
  [/^system\.saves\.(fortitude|reflex|will)\.rank$/, (m) => m[1]],
  [/^system\.attributes\.perception\.rank$/, () => "perception"],
  [/^system\.perception\.rank$/, () => "perception"],
  [/^system\.proficiencies\.spellcasting\.rank$/, () => "spellcasting"],
  [/^system\.proficiencies\.classDCs\.[a-z-]+\.rank$/, () => "classDC"],
];

/** Traduz o `path` de um ActiveEffectLike para o stat do Fusion, ou null. */
export function statFromRulePath(path) {
  if (typeof path !== "string") return null;
  for (const [re, fn] of PROFICIENCY_PATHS) {
    const m = re.exec(path);
    if (m) return fn(m);
  }
  return null;
}

/**
 * O predicado admite esta classe? Só entende os dois formatos simples;
 * qualquer outra forma devolve `null` = "não sei", e o chamador reporta em
 * vez de adivinhar.
 */
export function predicateAdmitsClass(predicate, classSlug) {
  if (predicate === undefined || predicate === null) return true;
  if (!Array.isArray(predicate) || predicate.length !== 1) return null;
  const [clause] = predicate;
  // "class:magus"
  if (typeof clause === "string") {
    if (!clause.startsWith("class:")) return null;
    return clause === `class:${classSlug}`;
  }
  if (!clause || typeof clause !== "object") return null;
  // {or: ["class:champion", ..., "class:magus"]}
  if (Array.isArray(clause.or)) {
    if (!clause.or.every((c) => typeof c === "string" && c.startsWith("class:"))) return null;
    return clause.or.includes(`class:${classSlug}`);
  }
  // {not: "class:barbarian"} — o caso de armor-mastery.json: heavy:3 para todo
  // mundo MENOS o Bárbaro. Sem entender esta forma, o Fighter perde Master em
  // armadura pesada no nível 17 e ninguém percebe.
  if (typeof clause.not === "string") {
    if (!clause.not.startsWith("class:")) return null;
    return clause.not !== `class:${classSlug}`;
  }
  return null;
}

/**
 * Colhe upgrades de proficiência dos `rules[]` de uma feature, para uma
 * classe. Devolve também o que foi IGNORADO e por quê — o pipeline reporta,
 * nunca descarta em silêncio (é o modo de falha mais caro desta base: pack
 * verde com progressão errada).
 */
export function upgradesFromRules(doc, classSlug) {
  const taken = [];
  const ignored = [];
  for (const rule of doc.system?.rules ?? []) {
    if (!rule || rule.key !== "ActiveEffectLike") continue;
    const stat = statFromRulePath(rule.path);
    if (!stat) continue; // não é proficiência (skill, hp, speed...): fora do escopo
    const reasons = [];
    if (rule.mode !== "upgrade") reasons.push(`mode=${rule.mode}`);
    if (typeof rule.value !== "number") reasons.push(`value não-literal (${rule.value})`);
    const admits = predicateAdmitsClass(rule.predicate, classSlug);
    if (admits === null)
      reasons.push(`predicado não interpretado (${JSON.stringify(rule.predicate)})`);
    if (reasons.length > 0) {
      ignored.push({ doc: doc.name, stat, path: rule.path, reasons });
      continue;
    }
    if (admits === false) continue; // interpretado, e esta classe não entra
    taken.push({ stat, rank: rule.value });
  }
  return { taken, ignored };
}

/** Traduz uma chave de `subfeatures.proficiencies` do vendor para o stat do Fusion. */
export function statFromVendorKey(key) {
  if (WEAPON_KEYS.has(key)) return `weapons.${key}`;
  if (ARMOR_KEYS.has(key)) return `armor.${key}`;
  if (DIRECT_KEYS.has(key)) return key;
  // Chave restante = slug da classe (ex.: "kineticist", "fighter"): é o DC de
  // classe dela no vocabulário do vendor.
  return "classDC";
}

/** Ordenação canônica e estável: nível, depois stat, depois rank. */
function sortUpgrades(list) {
  return [...list].sort(
    (a, b) => a.level - b.level || a.stat.localeCompare(b.stat) || a.rank - b.rank,
  );
}

/**
 * @param {Array<{name: string, level: number}>} itemsMap saída de `classItemsMap`
 * @param {(name: string) => object | undefined} featureByName índice de class-features
 *        (normalized.json do vendor), por nome canônico
 * @param {{proficiencyUpgradeExtras?: Array, proficiencyMirrors?: Record<string,string[]>}} cfg
 * @returns {{upgrades: Array<{level:number,stat:string,rank:number}>, missing: string[], origins: Array}}
 */
export function deriveProficiencyUpgrades(itemsMap, featureByName, cfg = {}, classSlug = "") {
  const upgrades = [];
  const origins = [];
  const missing = [];
  const ignoredRules = [];

  for (const entry of itemsMap) {
    const doc = featureByName(entry.name);
    if (!doc) {
      missing.push(entry.name);
      continue;
    }
    // Fonte 1 — subfeatures.proficiencies (estática, sem predicado).
    const profs = doc.system?.subfeatures?.proficiencies ?? {};
    for (const [key, value] of Object.entries(profs)) {
      const rank = typeof value === "object" && value !== null ? value.rank : value;
      if (typeof rank !== "number") continue;
      const stat = statFromVendorKey(key);
      upgrades.push({ level: entry.level, stat, rank });
      origins.push({ level: entry.level, stat, rank, from: entry.name, vendorKey: key });
    }
    // Fonte 2 — ActiveEffectLike condicionado à classe.
    const { taken, ignored } = upgradesFromRules(doc, classSlug);
    for (const t of taken) {
      upgrades.push({ level: entry.level, stat: t.stat, rank: t.rank });
      origins.push({
        level: entry.level,
        stat: t.stat,
        rank: t.rank,
        from: `${entry.name} (rule)`,
      });
    }
    for (const ig of ignored) ignoredRules.push({ ...ig, level: entry.level });
  }

  // Lacunas do vendor, declaradas na curadoria com justificativa.
  for (const extra of cfg.proficiencyUpgradeExtras ?? []) {
    upgrades.push({ level: extra.level, stat: extra.stat, rank: extra.rank });
    origins.push({ ...extra, from: `curadoria: ${extra.reason ?? "sem justificativa"}` });
  }

  // Espelhos (classDC → impulse, etc.), aplicados sobre o que já foi coletado.
  const mirrors = cfg.proficiencyMirrors ?? {};
  for (const [source, targets] of Object.entries(mirrors)) {
    for (const u of [...upgrades]) {
      if (u.stat !== source) continue;
      for (const target of targets) {
        upgrades.push({ level: u.level, stat: target, rank: u.rank });
        origins.push({ level: u.level, stat: target, rank: u.rank, from: `espelho de ${source}` });
      }
    }
  }

  // Dedupe exato (mesma tripla nível/stat/rank vinda de duas features).
  const seen = new Set();
  const deduped = [];
  for (const u of sortUpgrades(upgrades)) {
    const key = `${u.level}|${u.stat}|${u.rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(u);
  }

  return { upgrades: deduped, missing, ignoredRules, origins: sortUpgrades(origins) };
}

/**
 * Compara duas tabelas de upgrades ignorando ordem. Usado pelo teste de
 * regressão que trava a derivação contra as tabelas autorais de Magus e
 * Kineticist: se a derivação não reproduzir o que já está em produção, é a
 * DERIVAÇÃO que está errada — não as tabelas.
 */
export function diffUpgrades(a, b) {
  const key = (u) => `${u.level}|${u.stat}|${u.rank}`;
  const setA = new Set(a.map(key));
  const setB = new Set(b.map(key));
  return {
    onlyInA: [...setA].filter((k) => !setB.has(k)).sort(),
    onlyInB: [...setB].filter((k) => !setA.has(k)).sort(),
    equal: setA.size === setB.size && [...setA].every((k) => setB.has(k)),
  };
}
