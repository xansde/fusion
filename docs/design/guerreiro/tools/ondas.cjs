#!/usr/bin/env node
/**
 * Recalcula as ondas do plano do Guerreiro a partir das dependências e reescreve,
 * no próprio tasks.md, as linhas "Onda · Lote" e "Paralelo com". Escreve também a
 * seção 5 (tabela de ondas) num `s5.md` ao lado. As ondas são derivadas, nunca
 * escritas à mão — mesma disciplina das fases do inventário.
 *
 * Uso: node ondas.cjs <tasks.md> [--dry]
 */
const fs = require("fs");

const NL = String.fromCharCode(10);
const SEP = NL + "### ";

const [, , mdPath] = process.argv;
const DRY = process.argv.includes("--dry");
const MAX_POR_ONDA = 6;
/** Lote por fase: o que fecha junto, fotografa junto. */
const LOTE_DA_FASE = { 0: "L1", 1: "L2", 3: "L2", 2: "L3", 6: "L3", 7: "L3", 4: "L4", 5: "L4" };

let md = fs.readFileSync(mdPath, "utf8");
const RE_FICHA = /^### (GUE-F(\d)-\d\d) —.*$/gm;

const tarefas = [];
let m;
while ((m = RE_FICHA.exec(md)) !== null) {
  const fim = md.indexOf(SEP, m.index + 4);
  const bloco = md.slice(m.index, fim < 0 ? undefined : fim);
  const dep = bloco.match(/^- \*\*Depende de\*\*:\s*(.+)$/m);
  const repoRaw = (bloco.match(/^- \*\*Repo\*\*:\s*(.+)$/m) || [, "core"])[1].toLowerCase();
  tarefas.push({
    id: m[1],
    fase: Number(m[2]),
    depende: dep ? [...dep[1].matchAll(/GUE-F\d-\d\d/g)].map((x) => x[0]) : [],
    externas: dep
      ? [...new Set([...dep[1].matchAll(/(?:ALQ|ANI)-F\d-\d\d/g)].map((x) => x[0]))]
      : [],
    repo:
      repoRaw.includes("core") && repoRaw.includes("sat")
        ? "ambos"
        : repoRaw.includes("sat")
          ? "satélite"
          : "core",
    inicio: m.index,
  });
}

const porId = new Map(tarefas.map((t) => [t.id, t]));
for (const t of tarefas) {
  for (const d of t.depende) {
    if (!porId.has(d)) throw new Error(`${t.id} depende de ${d}, inexistente`);
  }
}

// Profundidade topológica: a onda mínima que a cadeia de dependências permite.
const prof = new Map();
const calc = (id, vendo = new Set()) => {
  if (prof.has(id)) return prof.get(id);
  if (vendo.has(id)) throw new Error(`ciclo de dependência em ${id}`);
  vendo.add(id);
  const t = porId.get(id);
  const p = t.depende.length ? 1 + Math.max(...t.depende.map((d) => calc(d, vendo))) : 1;
  vendo.delete(id);
  prof.set(id, p);
  return p;
};
for (const t of tarefas) t.onda = calc(t.id);

// Teto por onda: o excedente escorrega para a onda seguinte, preservando a ordem
// (fase, depois id) e sem nunca passar à frente de uma dependência.
let mexeu = true;
let voltas = 0;
while (mexeu && voltas++ < 300) {
  mexeu = false;
  const agrupado = new Map();
  for (const t of tarefas) {
    if (!agrupado.has(t.onda)) agrupado.set(t.onda, []);
    agrupado.get(t.onda).push(t);
  }
  for (const [onda, lista] of [...agrupado.entries()].sort((a, b) => a[0] - b[0])) {
    if (lista.length <= MAX_POR_ONDA) continue;
    lista.sort((a, b) => a.fase - b.fase || a.id.localeCompare(b.id));
    for (const t of lista.slice(MAX_POR_ONDA)) {
      t.onda = onda + 1;
      mexeu = true;
    }
  }
  for (const t of tarefas) {
    const min = t.depende.length ? 1 + Math.max(...t.depende.map((d) => porId.get(d).onda)) : 1;
    if (t.onda < min) {
      t.onda = min;
      mexeu = true;
    }
  }
}
if (voltas >= 300) throw new Error("não estabilizou: revise as dependências");

// Compacta buracos de numeração.
const usadas = [...new Set(tarefas.map((t) => t.onda))].sort((a, b) => a - b);
const renumera = new Map(usadas.map((o, i) => [o, i + 1]));
for (const t of tarefas) {
  t.onda = renumera.get(t.onda);
  t.lote = LOTE_DA_FASE[t.fase];
}

// Reescreve de trás para frente, para os índices não andarem.
for (const t of [...tarefas].sort((a, b) => b.inicio - a.inicio)) {
  const fim = md.indexOf(SEP, t.inicio + 4);
  const corte = fim < 0 ? md.length : fim;
  const irmaos = tarefas
    .filter((o) => o.onda === t.onda && o.id !== t.id)
    .map((o) => o.id)
    .slice(0, 3);
  const novo = md
    .slice(t.inicio, corte)
    .replace(/^- \*\*Onda\*\*:.*$/m, `- **Onda**: ${t.onda} · **Lote**: ${t.lote}`)
    .replace(
      /^- \*\*Paralelo com\*\*:.*$/m,
      `- **Paralelo com**: ${irmaos.length ? irmaos.join(", ") : "—"}`,
    );
  md = md.slice(0, t.inicio) + novo + md.slice(corte);
}

if (!DRY) fs.writeFileSync(mdPath, md, "utf8");

const porOnda = {};
for (const t of tarefas) (porOnda[t.onda] ??= []).push(t.id);
const ordem = Object.keys(porOnda)
  .map(Number)
  .sort((a, b) => a - b);
const fecha = {};
for (const t of tarefas) fecha[t.lote] = Math.max(fecha[t.lote] ?? 0, t.onda);

console.log(`${tarefas.length} tarefas em ${ordem.length} ondas${DRY ? " [dry]" : ""}`);
for (const o of ordem) console.log(`  onda ${String(o).padStart(2)}: ${porOnda[o].join(", ")}`);
console.log(
  "lotes: " +
    Object.entries(fecha)
      .sort()
      .map(([l, o]) => `${l} fecha na onda ${o}`)
      .join(" · "),
);

// Seção 5 do plano, derivada — nunca escrita à mão.
const linhas = [
  "## 5. Ondas",
  "",
  "Gate de saída de cada onda: suíte dos pacotes tocados + typecheck, lint e `format:check` + `pnpm spec:report` quando entra teste novo (e `spec-lint` quando há spec); tarefa do satélite só fecha a onda depois do pin no core com a suíte verde.",
  "",
  "| Onda | Tarefas | Repo | Espera algo de fora |",
  "| --- | --- | --- | --- |",
];
for (const o of ordem) {
  const ids = porOnda[o];
  const repos = [...new Set(ids.map((i) => porId.get(i).repo))];
  const ext = [...new Set(ids.flatMap((i) => porId.get(i).externas))].sort();
  linhas.push(
    `| ${o} | ${ids.join(", ")} | ${repos.length > 1 ? "ambos" : repos[0]} | ${
      ext.length ? "`" + ext.join("`, `") + "`" : "—"
    } |`,
  );
}
linhas.push("");
linhas.push(
  "Fechamento por lote: " +
    Object.entries(fecha)
      .sort()
      .map(([l, o]) => `${l} na onda ${o}`)
      .join(" · ") +
    ".",
);
if (!DRY) {
  fs.writeFileSync(mdPath.replace(/[^/\\]+$/, "s5.md"), linhas.join(NL) + NL, "utf8");
  console.log("seção 5 escrita ao lado do tasks.md");
}
