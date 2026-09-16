#!/usr/bin/env node
/**
 * Reatribui, no campo Spec/REQ de cada ficha do tasks.md, as faixas de requisito
 * que este plano cria:
 *   - `REQ-GUE-*`, por fase, na ordem das fichas;
 *   - os ids EMPRESTADOS de specs existentes (PF2, CBT, CNV, CHT, SYS, ACH), a
 *     partir do primeiro número livre de cada prefixo.
 * Só mexe em número >= o primeiro livre: citação a requisito que já existe
 * (REQ-ACH-070, REQ-CBT-055…) passa intacta.
 *
 * Existe porque as fases foram escritas em paralelo e cada uma partiu de um bloco
 * próprio, colidindo entre si.
 *
 * Uso: node reqs.cjs <tasks.md> [--dry]
 */
const fs = require("fs");

const NL = String.fromCharCode(10);
const SEP = NL + "### ";
const [, , mdPath] = process.argv;
const DRY = process.argv.includes("--dry");

/** Primeiro id de `REQ-GUE` por fase. Blocos largos: sobra espaço para emenda. */
const BLOCO = { 0: 1, 1: 40, 2: 80, 3: 100, 4: 130, 5: 170, 6: 220, 7: 260 };

/**
 * Primeiro id livre de cada spec emprestada, conferido contra `specs/` e contra
 * o que os planos do Alquimista e do Animista já reservaram (eles vão até
 * REQ-PF2-244, REQ-CBT-062, REQ-CNV-099, REQ-CHT-053, REQ-SYS-158).
 */
const EMPRESTADO = { PF2: 245, CBT: 63, CNV: 100, CHT: 54, SYS: 159, ACH: 93 };

let md = fs.readFileSync(mdPath, "utf8");
const RE_FICHA = /^### (GUE-F(\d)-\d\d) —.*$/gm;
const n3 = (n) => String(n).padStart(3, "0");

const fichas = [];
let m;
while ((m = RE_FICHA.exec(md)) !== null) {
  fichas.push({ id: m[1], fase: Number(m[2]), inicio: m.index });
}

for (const f of [...fichas].sort((a, b) => b.inicio - a.inicio)) {
  const fim = md.indexOf(SEP, f.inicio + 4);
  f.corte = fim < 0 ? md.length : fim;
  f.bloco = md.slice(f.inicio, f.corte);
}

const proximoGue = { ...BLOCO };
const proximoEmp = { ...EMPRESTADO };
const relatorio = [];

// A ficha da spec (GUE-F0-01) declara as faixas inteiras; as demais consomem em ordem.
for (const f of fichas) {
  if (f.id === "GUE-F0-01") continue;
  const linha = f.bloco.match(/^- \*\*Spec\/REQ\*\*:\s*(.+)$/m);
  if (!linha) continue;

  let nova = linha[1].replace(/`REQ-GUE-(\d+)(?:\.\.(\d+))?`/g, (_, a, b) => {
    const qtd = b ? Number(b) - Number(a) + 1 : 1;
    const ini = proximoGue[f.fase];
    proximoGue[f.fase] += qtd;
    relatorio.push(`${f.id}: GUE ${qtd} → ${n3(ini)}${qtd > 1 ? ".." + n3(ini + qtd - 1) : ""}`);
    return qtd > 1 ? `\`REQ-GUE-${n3(ini)}..${n3(ini + qtd - 1)}\`` : `\`REQ-GUE-${n3(ini)}\``;
  });

  nova = nova.replace(/`REQ-(PF2|CBT|CNV|CHT|SYS|ACH)-(\d+)(?:\.\.(\d+))?`/g, (all, pfx, a, b) => {
    if (Number(a) < EMPRESTADO[pfx]) return all; // citação a requisito já existente
    const qtd = b ? Number(b) - Number(a) + 1 : 1;
    const ini = proximoEmp[pfx];
    proximoEmp[pfx] += qtd;
    relatorio.push(`${f.id}: ${pfx} ${qtd} → ${n3(ini)}${qtd > 1 ? ".." + n3(ini + qtd - 1) : ""}`);
    return qtd > 1
      ? `\`REQ-${pfx}-${n3(ini)}..${n3(ini + qtd - 1)}\``
      : `\`REQ-${pfx}-${n3(ini)}\``;
  });

  f.blocoNovo = f.bloco.replace(linha[0], `- **Spec/REQ**: ${nova}`);
}

// A ficha da spec declara o que as outras consumiram, com folga.
const tetoGue = Math.max(Math.max(...Object.values(proximoGue)) - 1, 300);
for (const f of fichas) {
  if (f.id !== "GUE-F0-01") continue;
  let b = f.bloco.replace(/`REQ-GUE-\d+\.\.\d+`/, `\`REQ-GUE-001..${n3(tetoGue)}\``);
  for (const [pfx, ini] of Object.entries(EMPRESTADO)) {
    const fim = Math.max(proximoEmp[pfx] - 1, ini);
    b = b.replace(
      new RegExp("`REQ-" + pfx + "-\\d+\\.\\.\\d+`"),
      `\`REQ-${pfx}-${n3(ini)}..${n3(fim)}\``,
    );
  }
  f.blocoNovo = b;
}

for (const f of [...fichas].sort((a, b) => b.inicio - a.inicio)) {
  if (!f.blocoNovo) continue;
  md = md.slice(0, f.inicio) + f.blocoNovo + md.slice(f.corte);
}

if (!DRY) fs.writeFileSync(mdPath, md, "utf8");

console.log(`faixas reatribuídas${DRY ? " [dry]" : ""}: ${relatorio.length} ocorrências`);
console.log(
  "último REQ-GUE por fase: " +
    Object.entries(proximoGue)
      .map(([f, n]) => `F${f}→${n3(n - 1)}`)
      .join(" · "),
);
console.log(
  "emprestados: " +
    Object.entries(proximoEmp)
      .map(([p, n]) => `${p} ${n3(EMPRESTADO[p])}..${n3(n - 1)}`)
      .join(" · "),
);
