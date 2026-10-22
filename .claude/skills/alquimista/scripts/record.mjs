// Records the outcome of a /alquimista round into docs/design/alquimista/estado.json on feat/alquimista.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (k) => argv[argv.indexOf(`--${k}`) + 1];
const root = opt("root");
const rodada = JSON.parse(readFileSync(opt("rodada"), "utf8"));
const res = JSON.parse(readFileSync(opt("resultado"), "utf8"));

const INT = join(root, ".claude", "worktrees", "alq-integracao");
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim();

git(INT, "pull", "-q", "--ff-only");
const estPath = join(INT, "docs", "design", "alquimista", "estado.json");
const est = JSON.parse(readFileSync(estPath, "utf8"));
const plan = JSON.parse(
  readFileSync(join(INT, "docs", "design", "alquimista", "tasks-resumo.json"), "utf8"),
);

const integrated = new Set(res.integradas ?? []);
for (const t of rodada.tarefas) {
  const prev = est.tarefas[t.id] ?? {};
  const impl = (res.tarefas ?? []).find((x) => x.id === t.id) ?? {};
  const excl = (res.excluidas ?? []).find((x) => x.id === t.id);
  est.tarefas[t.id] = {
    status: integrated.has(t.id) ? "integrada" : "bloqueada",
    tentativas: (prev.tentativas ?? 0) + 1,
    onda: t.onda ?? rodada.onda,
    modelo: `${t.modelo}/${t.esforco}`,
    resumo: impl.resumo ?? prev.resumo,
    motivo: integrated.has(t.id) ? undefined : (excl?.motivo ?? impl.bloqueio ?? "não integrada"),
    core_sha: integrated.has(t.id) ? res.core_sha : prev.core_sha,
    sat_sha: integrated.has(t.id) ? res.sat_sha : prev.sat_sha,
  };
}
est.rodadas.push({
  onda: rodada.onda,
  tarefas: rodada.tarefas.map((t) => t.id),
  integradas: [...integrated],
  gate: res.gate?.ok ?? false,
  revisao: { achados: res.revisao?.achados?.length ?? 0, abertos: res.revisao?.abertos ?? [] },
  core_sha: res.core_sha,
  sat_sha: res.sat_sha,
});

const closed = [];
for (const l of ["L1", "L2", "L3"]) {
  const lt = plan.filter((t) => t.lote === l);
  const all = lt.every((t) => est.tarefas[t.id]?.status === "integrada");
  if (all && !est.lotes[l]?.fechado) {
    est.lotes[l] = { fechado: true, core_sha: res.core_sha, sat_sha: res.sat_sha };
    closed.push(l);
  }
}

writeFileSync(estPath, JSON.stringify(est, null, 2) + "\n");
git(INT, "add", "docs/design/alquimista/estado.json");
git(
  INT,
  "commit",
  "-q",
  "-m",
  `chore(alquimista): registra a onda ${rodada.onda}\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>`,
);
git(INT, "push", "-q", "origin", "feat/alquimista");

for (const t of rodada.tarefas) {
  if (!integrated.has(t.id)) continue;
  try {
    git(root, "worktree", "remove", "--force", t.worktree);
  } catch {
    console.log(`aviso: não consegui remover ${t.worktree}`);
  }
}

console.log(`integradas: ${[...integrated].join(", ") || "nenhuma"}`);
const blocked = rodada.tarefas
  .filter((t) => !integrated.has(t.id))
  .map((t) => `${t.id} (${est.tarefas[t.id].motivo})`);
if (blocked.length) console.log(`bloqueadas: ${blocked.join("; ")}`);
console.log(closed.length ? `LOTE FECHADO: ${closed.join(", ")}` : "nenhum lote fechou");
