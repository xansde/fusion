#!/usr/bin/env node
/**
 * Recalcula as ondas do plano da Barra de Ações a partir das dependências e reescreve, no próprio
 * tasks.md, as linhas "Onda · Lote" e "Paralelo com". Escreve também a seção 5 (tabela de ondas)
 * num `s5.md` ao lado. As ondas são derivadas, nunca escritas à mão.
 *
 * Adaptado de docs/design/guerreiro/tools/ondas.cjs (branch docs/guerreiro-tasks): a ordenação
 * topológica, o teto de 6 por onda e a geração da seção 5 são os mesmos. Três acréscimos, todos
 * pela natureza desta frente:
 *   1. Tarefa com "Situação: feita…" ou "FORA da frente…" é PRÉ-FRENTE: onda 0, fora das rodadas, e
 *      conta como satisfeita para quem depende dela (a F0 está feita; a BAR-F4-01 sai avulsa, D-BA13).
 *   2. Dependência de tarefa FORA da frente é externa: não entra na conta das ondas (a espera é a
 *      porteira do tasks.md §3, conferida pela skill antes de lançar a rodada).
 *   3. Tarefa que espera ENTREGA DE OUTRA FRENTE (ALQ, ANI ou GUE em "Depende de") vai para a última
 *      onda: o plan.mjs só lê `depende`, e sem isto ela cairia na onda 1 mesmo sem o motor existir.
 *
 * Lotes: F1+F2 → L1 · F3+F4 → L2 · F5+F6 → L3 · F7 → L4 · F8 → L5. A F0 não tem lote.
 *
 * Uso: node ondas.cjs <tasks.md> [--dry]
 */
const fs = require("fs");

const NL = String.fromCharCode(10);
const SEP = NL + "### ";

const [, , mdPath] = process.argv;
const DRY = process.argv.includes("--dry");
const MAX_POR_ONDA = 6;
/** Lote por fase: o que fecha junto, fotografa junto. A F0 (docs) não tem lote. */
const LOTE_DA_FASE = { 1: "L1", 2: "L1", 3: "L2", 4: "L2", 5: "L3", 6: "L3", 7: "L4", 8: "L5" };
const ID_BAR = /BAR-F\d-\d\d/g;
const ID_OUTRA_FRENTE = /(?:ALQ|ANI|GUE)-F\d-\d\d/g;

let md = fs.readFileSync(mdPath, "utf8");
const RE_FICHA = /^### (BAR-F(\d)-\d\d) —.*$/gm;

const tarefas = [];
let m;
while ((m = RE_FICHA.exec(md)) !== null) {
  const fim = md.indexOf(SEP, m.index + 4);
  const bloco = md.slice(m.index, fim < 0 ? undefined : fim);
  const campo = (nome) =>
    (bloco.match(new RegExp(`^- \\*\\*${nome}\\*\\*:\\s*(.+)$`, "m")) || [])[1];
  const sit = (campo("Situação") || "").toLowerCase();
  const repoRaw = (campo("Repo") || "core").toLowerCase();
  tarefas.push({
    id: m[1],
    fase: Number(m[2]),
    dependeRaw: campo("Depende de") || "",
    preFrente: sit.startsWith("feita") || sit.startsWith("fora da frente"),
    fora: sit.startsWith("fora da frente"),
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
  const citadas = [...t.dependeRaw.matchAll(ID_BAR)].map((x) => x[0]);
  for (const d of citadas) {
    if (!porId.has(d)) throw new Error(`${t.id} depende de ${d}, inexistente`);
  }
  t.depende = citadas.filter((d) => !porId.get(d).fora);
  t.externas = [
    ...new Set([
      ...citadas.filter((d) => porId.get(d).fora),
      ...[...t.dependeRaw.matchAll(ID_OUTRA_FRENTE)].map((x) => x[0]),
    ]),
  ];
  t.espera = !t.preFrente && /(?:ALQ|ANI|GUE)-F\d-\d\d/.test(t.dependeRaw);
}

// Profundidade topológica: a onda mínima que a cadeia de dependências permite. Pré-frente vale 0.
const prof = new Map();
const calc = (id, vendo = new Set()) => {
  if (prof.has(id)) return prof.get(id);
  if (vendo.has(id)) throw new Error(`ciclo de dependência em ${id}`);
  const t = porId.get(id);
  if (t.preFrente) {
    prof.set(id, 0);
    return 0;
  }
  vendo.add(id);
  const p = t.depende.length ? 1 + Math.max(...t.depende.map((d) => calc(d, vendo))) : 1;
  vendo.delete(id);
  prof.set(id, p);
  return p;
};
for (const t of tarefas) t.onda = calc(t.id);

// Quem espera outra frente não disputa as primeiras ondas: fica de fora da conta e entra no fim.
const agendaveis = tarefas.filter((t) => !t.preFrente && !t.espera);
for (const t of tarefas.filter((x) => x.espera)) {
  if (tarefas.some((o) => o.depende.includes(t.id)))
    throw new Error(`${t.id} espera outra frente e alguém depende dela: revise o plano`);
}

// Teto por onda: o excedente escorrega para a onda seguinte, preservando a ordem
// (fase, depois id) e sem nunca passar à frente de uma dependência.
let mexeu = true;
let voltas = 0;
while (mexeu && voltas++ < 300) {
  mexeu = false;
  const agrupado = new Map();
  for (const t of agendaveis) {
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
  for (const t of agendaveis) {
    const min = t.depende.length ? 1 + Math.max(...t.depende.map((d) => porId.get(d).onda)) : 1;
    if (t.onda < min) {
      t.onda = min;
      mexeu = true;
    }
  }
}
if (voltas >= 300) throw new Error("não estabilizou: revise as dependências");

// A onda de espera: depois da última onda de quem pode rodar, respeitando o teto.
const ultima = Math.max(0, ...agendaveis.map((t) => t.onda));
const esperando = tarefas.filter((t) => t.espera).sort((a, b) => a.id.localeCompare(b.id));
esperando.forEach((t, i) => {
  t.onda = ultima + 1 + Math.floor(i / MAX_POR_ONDA);
});

// Compacta buracos de numeração (a onda 0 é a pré-frente e não entra na conta).
const usadas = [...new Set(tarefas.filter((t) => !t.preFrente).map((t) => t.onda))].sort(
  (a, b) => a - b,
);
const renumera = new Map(usadas.map((o, i) => [o, i + 1]));
for (const t of tarefas) {
  t.onda = t.preFrente ? 0 : renumera.get(t.onda);
  t.lote = LOTE_DA_FASE[t.fase] ?? "—";
}

// Reescreve de trás para frente, para os índices não andarem.
for (const t of [...tarefas].sort((a, b) => b.inicio - a.inicio)) {
  const fim = md.indexOf(SEP, t.inicio + 4);
  const corte = fim < 0 ? md.length : fim;
  const irmaos = tarefas
    .filter((o) => !o.preFrente && o.onda === t.onda && o.id !== t.id)
    .map((o) => o.id)
    .slice(0, 3);
  const novo = md
    .slice(t.inicio, corte)
    .replace(/^- \*\*Onda\*\*:.*$/m, `- **Onda**: ${t.onda} · **Lote**: ${t.lote}`)
    .replace(
      /^- \*\*Paralelo com\*\*:.*$/m,
      `- **Paralelo com**: ${!t.preFrente && irmaos.length ? irmaos.join(", ") : "—"}`,
    );
  md = md.slice(0, t.inicio) + novo + md.slice(corte);
}

if (!DRY) fs.writeFileSync(mdPath, md, "utf8");

const frente = tarefas.filter((t) => !t.preFrente);
const porOnda = {};
for (const t of frente) (porOnda[t.onda] ??= []).push(t.id);
const ordem = Object.keys(porOnda)
  .map(Number)
  .sort((a, b) => a - b);
const fecha = {};
for (const t of frente) fecha[t.lote] = Math.max(fecha[t.lote] ?? 0, t.onda);
const preFrente = tarefas.filter((t) => t.preFrente).map((t) => t.id);

console.log(
  `${frente.length} tarefas em ${ordem.length} ondas (+ ${preFrente.length} pré-frente)${DRY ? " [dry]" : ""}`,
);
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
  `Pré-frente, onda 0, nunca entram numa rodada: ${preFrente.map((i) => `\`${i}\``).join(", ")} (feitas antes da frente ou fora dela, ver \`Situação\` nos cartões).`,
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
