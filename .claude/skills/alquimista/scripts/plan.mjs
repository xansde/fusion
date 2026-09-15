// Computes the next round of tasks for /alquimista from the plan and the execution state.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const root = opt("root");
const mode = opt("mode", "proxima");
const out = opt("out");
const forcedWave = opt("onda") ? Number(opt("onda")) : null;
const MAX_PER_ROUND = 6;

const INT = join(root, ".claude", "worktrees", "alq-integracao");
const DOC = join(INT, "docs", "design", "alquimista");
const read = (p) => readFileSync(p, "utf8");

const tasks = JSON.parse(read(join(DOC, "tasks-resumo.json")));
const planMd = read(join(DOC, "tasks.md"));
const state = existsSync(join(DOC, "estado.json"))
  ? JSON.parse(read(join(DOC, "estado.json")))
  : { tarefas: {}, rodadas: [], lotes: {} };

const status = (id) => state.tarefas[id]?.status ?? "pendente";
const done = (id) => status(id) === "integrada";

function sectionOf(id) {
  const start = planMd.indexOf(`### ${id} `);
  if (start < 0) throw new Error(`seção não encontrada no tasks.md: ${id}`);
  const next = planMd.indexOf("\n### ", start + 4);
  const nextH2 = planMd.indexOf("\n## ", start + 4);
  const ends = [next, nextH2].filter((n) => n > 0);
  return planMd.slice(start, ends.length ? Math.min(...ends) : undefined).trim();
}

if (mode === "status") {
  const rows = {};
  for (const t of tasks) {
    const f = `F${t.fase}`;
    rows[f] ??= { integrada: 0, bloqueada: 0, pendente: 0, total: 0 };
    rows[f][status(t.id) in rows[f] ? status(t.id) : "pendente"]++;
    rows[f].total++;
  }
  console.log("| Fase | Integradas | Bloqueadas | Pendentes | Total |\n|---|---|---|---|---|");
  for (const [f, r] of Object.entries(rows))
    console.log(`| ${f} | ${r.integrada} | ${r.bloqueada} | ${r.pendente} | ${r.total} |`);
  for (const l of ["L1", "L2", "L3"]) {
    const lt = tasks.filter((t) => t.lote === l);
    console.log(
      `${l}: ${lt.filter((t) => done(t.id)).length}/${lt.length} integradas${state.lotes[l]?.fechado ? " — FECHADO" : ""}`,
    );
  }
  const blocked = tasks.filter((t) => status(t.id) === "bloqueada");
  for (const t of blocked) console.log(`bloqueada: ${t.id} — ${state.tarefas[t.id].motivo ?? "?"}`);
  console.log(`rodadas executadas: ${state.rodadas.length}`);
  process.exit(0);
}

const ready = tasks.filter((t) => !done(t.id) && t.depende.every(done));
let pick = ready;
if (forcedWave !== null) pick = ready.filter((t) => t.onda === forcedWave);
else if (ready.length) {
  const minWave = Math.min(...ready.map((t) => t.onda));
  pick = ready.filter((t) => t.onda === minWave);
}
pick = pick.slice(0, MAX_PER_ROUND);

if (!pick.length) {
  const pending = tasks.filter((t) => !done(t.id));
  console.log(
    pending.length
      ? "Nenhuma tarefa pronta. Pendências:"
      : "Plano concluído: todas as tarefas integradas.",
  );
  for (const t of pending.slice(0, 15))
    console.log(
      `- ${t.id} (${status(t.id)}) espera: ${t.depende.filter((d) => !done(d)).join(", ") || "—"}`,
    );
  if (out) writeFileSync(out, JSON.stringify({ tarefas: [] }, null, 2));
  process.exit(0);
}

const wtDir = join(root, ".claude", "worktrees");
const rodada = {
  onda: pick[0].onda,
  integracao: INT,
  tarefas: pick.map((t) => {
    const slug = t.id.toLowerCase();
    return {
      id: t.id,
      titulo: t.titulo,
      repo: t.repo,
      modelo: t.modelo,
      esforco: t.esforco,
      lote: t.lote,
      decisoes: t.decisoes,
      tentativa: (state.tarefas[t.id]?.tentativas ?? 0) + 1,
      texto: sectionOf(t.id),
      branch: `alq/${slug}`,
      worktree: join(wtDir, `alq-${slug}`),
    };
  }),
};
writeFileSync(out, JSON.stringify(rodada, null, 2));
console.log(
  `onda ${rodada.onda}: ${rodada.tarefas.map((t) => `${t.id} [${t.modelo}/${t.esforco}]`).join(", ")}`,
);
