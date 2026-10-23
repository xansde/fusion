#!/usr/bin/env node
/**
 * Lê o tasks.md da Barra de Ações, extrai as fichas e gera o tasks-resumo.json que o
 * `.claude/skills/_frentes/scripts/plan.mjs` consome. Valida de quebra: id único, dependência
 * existente, onda coerente com a dependência, buraco na numeração das ondas e teto por onda.
 *
 * Adaptado de docs/design/guerreiro/tools/build-resumo.cjs (branch docs/guerreiro-tasks): a lógica
 * de extração e as validações são as mesmas. Diferenças, todas pela natureza desta frente:
 *   - prefixo BAR e decisões D-BA;
 *   - o campo opcional "Situação" marca a tarefa como "feita" (feita antes da frente) ou "fora"
 *     (FORA da frente, D-BA13). As duas são "pré-frente": onda 0, fora das rodadas, e a ordem das
 *     ondas não é cobrada delas;
 *   - dependência de tarefa "fora" (BAR-F4-01) vai para `dependeExterno`, não para `depende`: o
 *     plan.mjs só lê `depende`, e essa espera é conferida pela porteira da skill (tasks.md §3);
 *   - dependência externa são tarefas de OUTRAS frentes (ALQ, ANI, GUE);
 *   - lote "—" (as tarefas da F0) vira `lote: null`.
 *
 * Uso: node build-resumo.cjs <tasks.md> <saida.json>
 */
const fs = require("fs");

const [, , mdPath, outPath] = process.argv;
if (!mdPath || !outPath) {
  console.error("uso: node build-resumo.cjs <tasks.md> <saida.json>");
  process.exit(1);
}
const md = fs.readFileSync(mdPath, "utf8");

const MAX_POR_ONDA = 6;
const blocos = md.split(/^### (?=BAR-F\d-\d\d )/m).slice(1);
const tarefas = [];
const erros = [];

const campo = (texto, nome) => {
  const re = new RegExp(`^- \\*\\*${nome}\\*\\*:\\s*(.+)$`, "m");
  const m = texto.match(re);
  return m ? m[1].trim() : null;
};

const brutas = [];
for (const bloco of blocos) {
  const head = bloco.split("\n", 1)[0];
  const id = head.match(/^(BAR-F\d-\d\d)/)[1];
  const titulo = head
    .replace(/^BAR-F\d-\d\d\s+—\s+/, "")
    .replace(/\s*\(D-BA\d+(?:\s*,\s*D-BA\d+)*\)\s*$/, "")
    .trim();
  const repoRaw = (campo(bloco, "Repo") || "").toLowerCase();
  const repo =
    repoRaw.includes("core") && repoRaw.includes("sat")
      ? "ambos"
      : repoRaw.includes("sat")
        ? "satélite"
        : "core";

  const me = campo(bloco, "Modelo / esforço") || "";
  const mm = me.match(/^(opus|sonnet|haiku)\s*\/\s*(high|medium|low)/i);
  if (!mm) erros.push(`${id}: campo "Modelo / esforço" ilegível: ${me}`);

  const sitRaw = (campo(bloco, "Situação") || "").toLowerCase();
  const situacao = sitRaw.startsWith("feita")
    ? "feita"
    : sitRaw.startsWith("fora da frente")
      ? "fora"
      : null;

  const ondaLote = bloco.match(/^- \*\*Onda\*\*:\s*(\d+)\s*·\s*\*\*Lote\*\*:\s*(L\d|—)/m);
  if (!ondaLote) erros.push(`${id}: linha "Onda · Lote" ausente ou fora do formato`);

  for (const obrig of ["Onde", "Entrega", "Teste (TDD)", "Prova visual (print)", "Tamanho"]) {
    if (!campo(bloco, obrig.replace(/[()]/g, "\\$&")))
      erros.push(`${id}: falta o campo "${obrig}"`);
  }

  const dependeRaw = campo(bloco, "Depende de") || "";
  const paraleloRaw = campo(bloco, "Paralelo com") || "";

  brutas.push({
    id,
    fase: Number(id.match(/F(\d)/)[1]),
    titulo,
    repo,
    modelo: mm ? mm[1].toLowerCase() : "sonnet",
    esforco: mm ? mm[2].toLowerCase() : "medium",
    onda: ondaLote ? Number(ondaLote[1]) : 0,
    lote: ondaLote && ondaLote[2] !== "—" ? ondaLote[2] : null,
    situacao,
    dependeRaw,
    decisoes: [...head.matchAll(/D-BA\d+/g)].map((m) => m[0]),
    _paralelo: [...paraleloRaw.matchAll(/BAR-F\d-\d\d/g)].map((m) => m[0]),
  });
}

const porId = new Map(brutas.map((t) => [t.id, t]));
if (porId.size !== brutas.length) erros.push("id repetido entre as fichas");

for (const t of brutas) {
  const citadas = [...t.dependeRaw.matchAll(/BAR-F\d-\d\d/g)].map((m) => m[0]);
  for (const d of citadas)
    if (!porId.has(d)) erros.push(`${t.id}: depende de ${d}, que não existe`);
  const forasDaFrente = citadas.filter((d) => porId.get(d)?.situacao === "fora");
  const externasOutraFrente = [...t.dependeRaw.matchAll(/(?:ALQ|ANI|GUE)-F\d-\d\d/g)].map(
    (m) => m[0],
  );
  tarefas.push({
    id: t.id,
    fase: t.fase,
    titulo: t.titulo,
    repo: t.repo,
    modelo: t.modelo,
    esforco: t.esforco,
    onda: t.onda,
    lote: t.lote,
    situacao: t.situacao,
    depende: citadas.filter((d) => porId.has(d) && !forasDaFrente.includes(d)),
    dependeExterno: [...new Set([...forasDaFrente, ...externasOutraFrente])],
    decisoes: t.decisoes,
    _paralelo: t._paralelo,
  });
}

const preFrente = (t) => t.situacao !== null;
const porIdFinal = new Map(tarefas.map((t) => [t.id, t]));

for (const t of tarefas) {
  if (preFrente(t) && t.onda !== 0)
    erros.push(
      `${t.id}: tarefa pré-frente (${t.situacao}) tem de estar na onda 0, está na ${t.onda}`,
    );
  if (!preFrente(t) && t.onda < 1) erros.push(`${t.id}: tarefa da frente na onda ${t.onda}`);
  for (const d of t.depende) {
    const dep = porIdFinal.get(d);
    if (!dep) continue;
    // Tarefa pré-frente está satisfeita desde o começo: a ordem das ondas não é cobrada dela.
    if (preFrente(t) || preFrente(dep)) continue;
    if (dep.onda >= t.onda) {
      erros.push(`${t.id} (onda ${t.onda}) depende de ${d} (onda ${dep.onda}) — onda não cresce`);
    }
  }
}

for (const t of tarefas) {
  for (const p of t._paralelo) {
    const par = porIdFinal.get(p);
    if (!par) {
      erros.push(`${t.id}: "Paralelo com" cita ${p}, que não existe`);
    } else if (par.onda !== t.onda) {
      erros.push(`${t.id} (onda ${t.onda}) diz ser paralela a ${p} (onda ${par.onda})`);
    }
  }
  delete t._paralelo;
}

const porOnda = {};
for (const t of tarefas) if (!preFrente(t)) (porOnda[t.onda] ??= []).push(t.id);
for (const [onda, ids] of Object.entries(porOnda)) {
  if (ids.length > MAX_POR_ONDA)
    erros.push(`onda ${onda}: ${ids.length} tarefas (teto ${MAX_POR_ONDA}) — ${ids.join(", ")}`);
}

const ondas = Object.keys(porOnda)
  .map(Number)
  .sort((a, b) => a - b);
if (ondas[0] !== 1) erros.push(`a primeira onda é a ${ondas[0]}, devia ser a 1`);
for (let i = 1; i < ondas.length; i++) {
  if (ondas[i] !== ondas[i - 1] + 1)
    erros.push(`buraco na numeração de ondas: ${ondas[i - 1]} → ${ondas[i]}`);
}

// Mesma ordem de chaves do resumo do Guerreiro; `situacao` só aparece quando existe (o plan.mjs
// ignora o que não conhece).
const saida = tarefas.map((t) => ({
  id: t.id,
  fase: t.fase,
  titulo: t.titulo,
  repo: t.repo,
  modelo: t.modelo,
  esforco: t.esforco,
  onda: t.onda,
  lote: t.lote,
  depende: t.depende,
  dependeExterno: t.dependeExterno,
  decisoes: t.decisoes,
  ...(t.situacao ? { situacao: t.situacao } : {}),
}));
fs.writeFileSync(outPath, JSON.stringify(saida, null, 2) + "\n", "utf8");

console.log(`tarefas: ${tarefas.length} (${tarefas.filter(preFrente).length} pré-frente)`);
for (const f of [...new Set(tarefas.map((t) => t.fase))].sort()) {
  console.log(`  F${f}: ${tarefas.filter((t) => t.fase === f).length}`);
}
console.log("ondas: " + ondas.map((o) => `${o}(${porOnda[o].length})`).join(" "));
console.log(
  "lotes: " +
    [...new Set(tarefas.map((t) => t.lote).filter(Boolean))]
      .sort()
      .map((l) => `${l}(${tarefas.filter((t) => t.lote === l).length})`)
      .join(" "),
);
console.log(
  "externas: " + [...new Set(tarefas.flatMap((t) => t.dependeExterno))].sort().join(", "),
);
if (erros.length) {
  console.error("\nPROBLEMAS (" + erros.length + "):");
  for (const e of erros) console.error("  - " + e);
  process.exit(1);
}
console.log("\nsem problemas.");
