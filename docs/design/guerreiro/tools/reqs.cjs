#!/usr/bin/env node
/**
 * Reatribui as faixas `REQ-GUE-*` do tasks.md por fase, na ordem das fichas,
 * preservando o tamanho de cada faixa. Existe porque as fases foram escritas em
 * paralelo e cada uma partiu de um bloco próprio — colidindo entre si.
 *
 * Uso: node reqs.cjs <tasks.md> [--dry]
 */
const fs = require("fs");

const NL = String.fromCharCode(10);
const SEP = NL + "### ";
const [, , mdPath] = process.argv;
const DRY = process.argv.includes("--dry");

/** Primeiro id de cada fase. Blocos largos: sobra espaço para emenda depois. */
const BLOCO = { 0: 1, 1: 40, 2: 80, 3: 100, 4: 130, 5: 170, 6: 220, 7: 260 };

let md = fs.readFileSync(mdPath, "utf8");
const RE_FICHA = /^### (GUE-F(\d)-\d\d) —.*$/gm;
const n3 = (n) => String(n).padStart(3, "0");

const fichas = [];
let m;
while ((m = RE_FICHA.exec(md)) !== null) {
  fichas.push({ id: m[1], fase: Number(m[2]), inicio: m.index });
}

const proximo = { ...BLOCO };
const relatorio = [];

for (const f of [...fichas].sort((a, b) => b.inicio - a.inicio)) {
  const fim = md.indexOf(SEP, f.inicio + 4);
  const corte = fim < 0 ? md.length : fim;
  f.bloco = md.slice(f.inicio, corte);
  f.corte = corte;
}

// A ficha da spec (GUE-F0-01) declara a faixa inteira; as demais consomem em ordem.
for (const f of fichas) {
  if (f.id === "GUE-F0-01") continue;
  const linha = f.bloco.match(/^- \*\*Spec\/REQ\*\*:\s*(.+)$/m);
  if (!linha) continue;
  const nova = linha[1].replace(/`REQ-GUE-(\d+)(?:\.\.(\d+))?`/g, (_, a, b) => {
    const qtd = b ? Number(b) - Number(a) + 1 : 1;
    const ini = proximo[f.fase];
    proximo[f.fase] += qtd;
    relatorio.push(`${f.id}: ${qtd} id(s) → ${n3(ini)}${qtd > 1 ? ".." + n3(ini + qtd - 1) : ""}`);
    return qtd > 1 ? `\`REQ-GUE-${n3(ini)}..${n3(ini + qtd - 1)}\`` : `\`REQ-GUE-${n3(ini)}\``;
  });
  f.blocoNovo = f.bloco.replace(linha[0], `- **Spec/REQ**: ${nova}`);
}

const teto = Math.max(...Object.values(proximo)) - 1;
for (const f of fichas) {
  if (f.id !== "GUE-F0-01") continue;
  f.blocoNovo = f.bloco.replace(
    /`REQ-GUE-\d+\.\.\d+`/,
    `\`REQ-GUE-001..${n3(Math.max(teto, 300))}\``,
  );
}

for (const f of [...fichas].sort((a, b) => b.inicio - a.inicio)) {
  if (!f.blocoNovo) continue;
  md = md.slice(0, f.inicio) + f.blocoNovo + md.slice(f.corte);
}

if (!DRY) fs.writeFileSync(mdPath, md, "utf8");

console.log(`faixas reatribuídas${DRY ? " [dry]" : ""}:`);
for (const l of relatorio) console.log("  " + l);
console.log(
  "último id por fase: " +
    Object.entries(proximo)
      .map(([f, n]) => `F${f}→${n3(n - 1)}`)
      .join(" · "),
);
