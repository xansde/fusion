#!/usr/bin/env node
/**
 * Lê o tasks.md do Guerreiro, extrai as fichas e gera o tasks-resumo.json
 * que o `.claude/skills/_frentes/scripts/plan.mjs` consome. Valida de quebra:
 * id único, dependência existente, onda coerente com a dependência, lote sem
 * buraco, e teto de tarefas por onda.
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
const blocos = md.split(/^### (?=GUE-F\d-\d\d )/m).slice(1);
const tarefas = [];
const erros = [];

const campo = (texto, nome) => {
  const re = new RegExp(`^- \\*\\*${nome}\\*\\*:\\s*(.+)$`, "m");
  const m = texto.match(re);
  return m ? m[1].trim() : null;
};

for (const bloco of blocos) {
  const head = bloco.split("\n", 1)[0];
  const id = head.match(/^(GUE-F\d-\d\d)/)[1];
  const titulo = head
    .replace(/^GUE-F\d-\d\d\s+—\s+/, "")
    .replace(/\s*\(D-G\d+\)\s*$/, "")
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

  const dependeRaw = campo(bloco, "Depende de") || "";
  const depende = [...dependeRaw.matchAll(/GUE-F\d-\d\d/g)].map((m) => m[0]);
  const dependeExterno = [...dependeRaw.matchAll(/(?:ALQ|ANI)-F\d-\d\d/g)].map((m) => m[0]);

  const ondaLote = bloco.match(/^- \*\*Onda\*\*:\s*(\d+)\s*·\s*\*\*Lote\*\*:\s*(L\d)/m);
  if (!ondaLote) erros.push(`${id}: linha "Onda · Lote" ausente ou fora do formato`);

  for (const obrig of ["Onde", "Entrega", "Teste (TDD)", "Prova visual (print)", "Tamanho"]) {
    if (!campo(bloco, obrig.replace(/[()]/g, "\\$&")))
      erros.push(`${id}: falta o campo "${obrig}"`);
  }

  const paraleloRaw = campo(bloco, "Paralelo com") || "";
  const paralelo = [...paraleloRaw.matchAll(/GUE-F\d-\d\d/g)].map((m) => m[0]);

  tarefas.push({
    id,
    fase: Number(id.match(/F(\d)/)[1]),
    titulo,
    repo,
    modelo: mm ? mm[1].toLowerCase() : "sonnet",
    esforco: mm ? mm[2].toLowerCase() : "medium",
    onda: ondaLote ? Number(ondaLote[1]) : 0,
    lote: ondaLote ? ondaLote[2] : "L1",
    depende,
    dependeExterno,
    decisoes: [...head.matchAll(/D-G\d+/g)].map((m) => m[0]),
    _paralelo: paralelo,
  });
}

const porId = new Map(tarefas.map((t) => [t.id, t]));
if (porId.size !== tarefas.length) erros.push("id repetido entre as fichas");

for (const t of tarefas) {
  for (const d of t.depende) {
    const dep = porId.get(d);
    if (!dep) {
      erros.push(`${t.id}: depende de ${d}, que não existe`);
      continue;
    }
    if (dep.onda >= t.onda) {
      erros.push(`${t.id} (onda ${t.onda}) depende de ${d} (onda ${dep.onda}) — onda não cresce`);
    }
  }
}

for (const t of tarefas) {
  for (const p of t._paralelo) {
    const par = porId.get(p);
    if (!par) {
      erros.push(`${t.id}: "Paralelo com" cita ${p}, que não existe`);
    } else if (par.onda !== t.onda) {
      erros.push(`${t.id} (onda ${t.onda}) diz ser paralela a ${p} (onda ${par.onda})`);
    }
  }
  delete t._paralelo;
}

const porOnda = {};
for (const t of tarefas) (porOnda[t.onda] ??= []).push(t.id);
for (const [onda, ids] of Object.entries(porOnda)) {
  if (ids.length > MAX_POR_ONDA)
    erros.push(`onda ${onda}: ${ids.length} tarefas (teto ${MAX_POR_ONDA}) — ${ids.join(", ")}`);
}

const ondas = Object.keys(porOnda)
  .map(Number)
  .sort((a, b) => a - b);
for (let i = 1; i < ondas.length; i++) {
  if (ondas[i] !== ondas[i - 1] + 1)
    erros.push(`buraco na numeração de ondas: ${ondas[i - 1]} → ${ondas[i]}`);
}

fs.writeFileSync(outPath, JSON.stringify(tarefas, null, 2) + "\n", "utf8");

console.log(`tarefas: ${tarefas.length}`);
for (const f of [...new Set(tarefas.map((t) => t.fase))].sort()) {
  console.log(`  F${f}: ${tarefas.filter((t) => t.fase === f).length}`);
}
console.log("ondas: " + ondas.map((o) => `${o}(${porOnda[o].length})`).join(" "));
console.log("lotes: " + [...new Set(tarefas.map((t) => t.lote))].sort().join(" "));
console.log(
  "externas: " + [...new Set(tarefas.flatMap((t) => t.dependeExterno))].sort().join(", "),
);
if (erros.length) {
  console.error("\nPROBLEMAS (" + erros.length + "):");
  for (const e of erros) console.error("  - " + e);
  process.exit(1);
}
console.log("\nsem problemas.");
