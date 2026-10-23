#!/usr/bin/env node
/**
 * Confere, por onda, se duas tarefas declaram o mesmo arquivo — ou um arquivo dentro de um
 * diretório que a outra declara — no campo "Onde" do tasks.md. É a prova mecânica da regra
 * "tarefas na mesma onda têm arquivos disjuntos" (§3 do tasks.md).
 *
 * Só olha caminhos entre crases e expande os prefixos curtos que o §3 define. Heurístico de
 * propósito: serve de gate para a onda 1 (tem de dar zero) e de lista de trabalho para as demais
 * (as colisões conhecidas ficam documentadas no §3, com a ordem em que as tarefas rodam em série).
 *
 * Novo nesta frente: a ferramenta equivalente não existe no Guerreiro (lá a disjunção era
 * conferida à mão).
 *
 * Uso: node colisoes.cjs <tasks.md> [--onda N]
 *   Código de saída 1 se a onda 1 tiver colisão.
 */
const fs = require("fs");

const PREFIXOS = {
  "client/": "packages/client/src/",
  "server/": "packages/server/src/",
  "shared/": "packages/shared/src/",
  "sat:": "external/fusion-systems-2e/",
  "sheet/": "external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/",
  "cmp/": "external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/",
};

const [, , mdPath] = process.argv;
const iOnda = process.argv.indexOf("--onda");
const SO_ONDA = iOnda >= 0 ? Number(process.argv[iOnda + 1]) : null;
const md = fs.readFileSync(mdPath, "utf8");

const blocos = md.split(/^### (?=BAR-F\d-\d\d )/m).slice(1);

/** Caminho normalizado, ou null se a crase não é um caminho. */
function normaliza(token) {
  let t = token.trim();
  if (/\s/.test(t) || /[()]/.test(t)) return null;
  t = t.replace(/(?::\d+(?:-\d+)?)+$/, ""); // sufixo de linha
  const ehCaminho = t.includes("/") || /\.(ts|svelte|md|json|cjs|mjs|css|html|sh)$/.test(t);
  if (!ehCaminho) return null;
  for (const [curto, longo] of Object.entries(PREFIXOS)) {
    if (t.startsWith(curto)) {
      t = longo + t.slice(curto.length);
      break;
    }
  }
  const estrela = t.indexOf("*");
  if (estrela >= 0) t = t.slice(0, estrela); // glob: vale o diretório até ali
  return t;
}

const sobrepoe = (a, b) =>
  a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b));

const tarefas = [];
for (const bloco of blocos) {
  const id = bloco.match(/^(BAR-F\d-\d\d)/)[1];
  const onda = Number((bloco.match(/^- \*\*Onda\*\*:\s*(\d+)/m) || [])[1] ?? 0);
  const onde = (bloco.match(/^- \*\*Onde\*\*:\s*(.+)$/m) || [])[1] || "";
  const caminhos = [...onde.matchAll(/`([^`]+)`/g)]
    .map((x) => normaliza(x[1]))
    .filter((x) => x !== null);
  tarefas.push({ id, onda, caminhos });
}

const ondas = [...new Set(tarefas.map((t) => t.onda).filter((o) => o > 0))].sort((a, b) => a - b);
let colisaoNaUm = false;
for (const o of ondas) {
  if (SO_ONDA !== null && o !== SO_ONDA) continue;
  const da = tarefas.filter((t) => t.onda === o);
  const achados = [];
  for (let i = 0; i < da.length; i++) {
    for (let j = i + 1; j < da.length; j++) {
      const comuns = new Set();
      for (const a of da[i].caminhos)
        for (const b of da[j].caminhos)
          if (sobrepoe(a, b)) comuns.add(a.length >= b.length ? a : b);
      if (comuns.size) achados.push(`${da[i].id} × ${da[j].id}: ${[...comuns].join(", ")}`);
    }
  }
  const n = da.reduce((s, t) => s + t.caminhos.length, 0);
  if (!achados.length) {
    console.log(`onda ${o}: sem colisões (${da.length} tarefas, ${n} caminhos declarados)`);
  } else {
    console.log(`onda ${o}: ${achados.length} par(es) com caminho em comum`);
    for (const a of achados) console.log(`  - ${a}`);
    if (o === 1) colisaoNaUm = true;
  }
}
process.exit(colisaoNaUm ? 1 : 0);
