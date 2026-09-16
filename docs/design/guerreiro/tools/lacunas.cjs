#!/usr/bin/env node
/**
 * Deriva guerreiro-lacunas.md (fases, bloqueadores, dependências) a partir do que
 * o gen.cjs produziu, e carimba `usado_por_guerreiro` nas notas de mecanismo
 * compartilhadas (alquimista/animista).
 *
 * Uso: node lacunas.cjs
 */
const fs = require("fs");
const path = require("path");

const S = __dirname;
const VAULT =
  "C:/Users/xansd/OneDrive/Área de Trabalho/Nova pasta/Documentos/Obsidian vaults/Claude Seazone/Projects/fusion";
const CLASSE = "guerreiro";
const OUT = path.join(VAULT, CLASSE);
const HOJE = "2026-09-16";

const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), "utf8"));
const uso = read("uso-por-mecanismo.json");
const docs = read("docs-derivados.json");
const fases = read("fases.json").fases;
const novos = read("mecanismos-guerreiro.json");
const mapa = read("mapa-mecanismos.json");

const ICON = { funciona: "✅", parcial: "🟡", ausente: "❌" };
const MEC = { ...mapa };
for (const [id, m] of Object.entries(novos))
  MEC[id] = { file: "mec-" + id.toLowerCase(), pasta: CLASSE, status: m.status, name: m.name };
const link = (id) => (MEC[id] ? "[[" + MEC[id].file + "]]" : "`" + id + "`");
const icon = (id) => ICON[(MEC[id] || {}).status] || "❓";

// ---------- fases cumulativas
const faseIdx = {};
fases.forEach((f, i) => f.mecanismos.forEach((m) => (faseIdx[m] = i)));
const porFase = fases.map(() => []);
const hoje = [];
const semFase = [];
for (const d of docs) {
  if (d.fase === "hoje") hoje.push(d);
  else if (d.fase === "sem-fase") semFase.push(d);
  else porFase[fases.findIndex((f) => f.id === d.fase)].push(d);
}

// ---------- bloqueadores por mecanismo
const linhas = Object.entries(uso)
  .map(([id, u]) => {
    const bloqueia = u.docs.filter((d) => {
      const doc = docs.find((x) => x.slug === d.slug);
      return doc && (doc.bloq.includes(id) || doc.parciais.includes(id));
    }).length;
    const unico = u.docs.filter((d) => {
      const doc = docs.find((x) => x.slug === d.slug);
      if (!doc) return false;
      const pend = [...new Set([...doc.bloq, ...doc.parciais])];
      return pend.length === 1 && pend[0] === id;
    }).length;
    return {
      id,
      status: u.status,
      bloqueia,
      unico,
      fase: fases[faseIdx[id]] ? fases[faseIdx[id]].id : "—",
      total: u.docs.length,
    };
  })
  .sort((a, b) => b.bloqueia - a.bloqueia || b.total - a.total);

const L = [];
L.push("---");
L.push("type: note");
L.push('name: "Guerreiro — lacunas priorizadas"');
L.push("created: " + HOJE);
L.push("updated: " + HOJE);
L.push("tags: [fusion, guerreiro, plano, lacunas]");
L.push("---");
L.push("");
L.push("# Guerreiro — lacunas priorizadas");
L.push("");
L.push(
  "Derivado do frontmatter das " +
    docs.length +
    " notas de regra (" +
    docs.filter((d) => d.kind === "talento").length +
    " talentos, " +
    docs.filter((d) => d.kind === "habilidade").length +
    " habilidades) cruzado com o status das notas de mecanismo. Referência: Fusion `alfa/app` + `fusion-systems-2e` pin v0.1.1, em " +
    HOJE +
    ". Recalcular quando um mecanismo mudar de status (`node lacunas.cjs`).",
);
L.push("");
L.push("## Leitura rápida");
L.push("");
L.push("__LEITURA_RAPIDA__");
L.push("");
L.push("## Ordem sugerida (fases cumulativas)");
L.push("");
L.push(
  'Critério: dependência técnica primeiro, depois volume destravado. "Funciona" = todos os mecanismos exigidos existem; os 🟡 da fase precisam ser completados nela.',
);
L.push("");
L.push("| Fase | Tema | Mecanismos | Passam a funcionar | Acumulado |");
L.push("|---|---|---|---|---|");
let acc = hoje.length;
if (hoje.length) {
  L.push("| — | Já funciona hoje | — | " + hoje.length + " | " + acc + " / " + docs.length + " |");
}
fases.forEach((f, i) => {
  acc += porFase[i].length;
  const mecs = f.mecanismos.map((m) => icon(m) + " " + link(m)).join("<br>");
  L.push(
    "| " +
      f.id +
      " | " +
      f.tema +
      " | " +
      mecs +
      " | +" +
      porFase[i].length +
      " | " +
      acc +
      " / " +
      docs.length +
      " |",
  );
});
L.push("");
if (hoje.length) {
  L.push("### Já funciona hoje (" + hoje.length + ")");
  L.push("");
  L.push(hoje.map((d) => "[[" + d.slug + "]]").join(" · "));
  L.push("");
}
fases.forEach((f, i) => {
  L.push("### " + f.id + " — " + f.tema + " (+" + porFase[i].length + ")");
  L.push("");
  L.push(
    porFase[i].length
      ? porFase[i]
          .sort((a, b) => a.nivel - b.nivel)
          .map((d) => "[[" + d.slug + "]]")
          .join(" · ")
      : "_Nenhum documento fecha nesta fase._",
  );
  L.push("");
});
if (semFase.length) {
  L.push("### Sem fase atribuída (" + semFase.length + ") — CORRIGIR");
  L.push("");
  L.push(semFase.map((d) => "[[" + d.slug + "]]").join(" · "));
  L.push("");
}

L.push("## Bloqueadores por mecanismo");
L.push("");
L.push(
  '"Bloqueia" = documentos em que o mecanismo está ausente ou parcial. "Único" = documentos em que ele é o único pendente.',
);
L.push("");
L.push("| Mecanismo | Status | Bloqueia | Único | Fase |");
L.push("|---|---|---|---|---|");
for (const l of linhas) {
  if (!l.bloqueia) continue;
  L.push(
    "| " +
      link(l.id) +
      " | " +
      ICON[l.status] +
      " | " +
      l.bloqueia +
      " | " +
      l.unico +
      " | " +
      l.fase +
      " |",
  );
}
L.push("");
L.push("## Mecanismos que já funcionam");
L.push("");
L.push(
  linhas
    .filter((l) => l.status === "funciona")
    .map((l) => link(l.id) + " (" + l.total + ")")
    .join(" · ") || "_nenhum_",
);
L.push("");
L.push("## Dependências entre mecanismos");
L.push("");
L.push("```mermaid");
L.push("graph LR");
for (const [id, m] of Object.entries(novos)) {
  for (const d of m.depende_de || []) {
    L.push(
      "  " + d.replace(/-/g, "_") + "[" + d + "] --> " + id.replace(/-/g, "_") + "[" + id + "]",
    );
  }
}
L.push("```");
L.push("");
L.push("## Relacionados");
L.push("");
L.push("- [[guerreiro-indice]]");
L.push("- [[guerreiro-fontes]]");
L.push("- [[alquimista-lacunas]] — a mesma leitura para o Alquimista");
L.push("- [[animista-lacunas]] — a mesma leitura para o Animista");
L.push("");

const leitura = fs.existsSync(path.join(S, "leitura-rapida.md"))
  ? fs.readFileSync(path.join(S, "leitura-rapida.md"), "utf8").trim()
  : "_(preencher)_";
fs.writeFileSync(
  path.join(OUT, "guerreiro-lacunas.md"),
  L.join("\n").replace("__LEITURA_RAPIDA__", leitura),
  "utf8",
);

// ---------- carimbo nas notas compartilhadas
let carimbadas = 0;
for (const [id, u] of Object.entries(uso)) {
  if (!mapa[id]) continue; // mecanismo novo: a nota já nasce com o campo
  const file = path.join(VAULT, mapa[id].pasta, "mecanismos", mapa[id].file + ".md");
  if (!fs.existsSync(file)) {
    console.log("AVISO: nota não encontrada para " + id + " (" + file + ")");
    continue;
  }
  let t = fs.readFileSync(file, "utf8");
  const nTal = u.docs.filter((d) => d.kind === "talento").length;
  const nHab = u.docs.filter((d) => d.kind === "habilidade").length;
  const bloco =
    "## Usado por — Guerreiro\n\nTotal: **" +
    u.docs.length +
    "** documentos (" +
    nTal +
    " talentos, " +
    nHab +
    " habilidades) do inventário do Guerreiro ([[guerreiro-indice]]).\n\n" +
    u.docs.map((d) => "[[" + d.slug + "]]").join(" · ") +
    "\n";

  // frontmatter: usado_por_guerreiro
  if (/^usado_por_guerreiro:/m.test(t)) {
    t = t.replace(/^usado_por_guerreiro:.*$/m, "usado_por_guerreiro: " + u.docs.length);
  } else {
    t = t.replace(
      /^usado_por_total:(.*)$/m,
      "usado_por_total:$1\nusado_por_guerreiro: " + u.docs.length,
    );
  }
  // tag guerreiro
  t = t.replace(/^tags: \[([^\]]*)\]$/m, (mm, inner) =>
    inner.includes("guerreiro") ? mm : "tags: [" + inner + ", guerreiro]",
  );
  t = t.replace(/^updated:.*$/m, "updated: " + HOJE);

  // corpo: substitui ou acrescenta a seção
  if (/^## Usado por — Guerreiro$/m.test(t)) {
    t = t.replace(/## Usado por — Guerreiro[\s\S]*?(?=\n## |$)/, bloco);
  } else {
    const anchor = t.indexOf("\n## Relacionados");
    if (anchor > -1) t = t.slice(0, anchor) + "\n" + bloco + t.slice(anchor);
    else t = t.trimEnd() + "\n\n" + bloco;
  }
  fs.writeFileSync(file, t, "utf8");
  carimbadas++;
}

console.log(
  "lacunas.md escrito · fases: " +
    fases.length +
    " · docs: " +
    docs.length +
    " · jogáveis hoje: " +
    hoje.length +
    " · notas compartilhadas carimbadas: " +
    carimbadas,
);
if (semFase.length) console.log("ATENÇÃO — docs sem fase: " + semFase.length);
