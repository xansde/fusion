#!/usr/bin/env node
/**
 * Gerador do inventário de classe no vault Obsidian "Claude Seazone".
 * Lê os JSONs dos agentes (docs-*.json) + o status dos mecanismos e escreve
 * as notas da classe em Projects/fusion/<classe>/.
 *
 * Uso: node gen.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const S = __dirname;
const VAULT =
  "C:/Users/xansd/OneDrive/Área de Trabalho/Nova pasta/Documentos/Obsidian vaults/Claude Seazone/Projects/fusion";
const CLASSE = "guerreiro";
const OUT = path.join(VAULT, CLASSE);
const HOJE = "2026-09-16";
const DRY = process.argv.includes("--dry");

const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), "utf8"));
const mapaExistente = read("mapa-mecanismos.json");
const novos = fs.existsSync(path.join(S, "mecanismos-guerreiro.json"))
  ? read("mecanismos-guerreiro.json")
  : {};

// catálogo unificado: id -> {file, pasta, status, name}
const MEC = { ...mapaExistente };
for (const [id, m] of Object.entries(novos)) {
  MEC[id] = { file: "mec-" + id.toLowerCase(), pasta: CLASSE, status: m.status, name: m.name };
}

const ICON = { funciona: "✅", parcial: "🟡", ausente: "❌" };
const icon = (id) => ICON[(MEC[id] || {}).status] || "❓";
const link = (id) => (MEC[id] ? "[[" + MEC[id].file + "]]" : "`" + id + "`");

const fases = fs.existsSync(path.join(S, "fases.json")) ? read("fases.json") : { fases: [] };
function faseDoDoc(doc) {
  const pendentes = doc.mecanismos
    .map((m) => m.id)
    .filter((id) => (MEC[id] || {}).status !== "funciona");
  if (!pendentes.length) return "hoje";
  let ultima = null;
  for (const id of pendentes) {
    const f = fases.fases.findIndex((fa) => fa.mecanismos.includes(id));
    if (f === -1) return "sem-fase";
    if (ultima === null || f > ultima) ultima = f;
  }
  return fases.fases[ultima].id;
}

const docs = [];
for (const f of ["docs-feats-n1-6.json", "docs-feats-n8-20.json", "docs-features.json"]) {
  if (fs.existsSync(path.join(S, f))) docs.push(...read(f));
}
docs.sort((a, b) => (a.nivel || 0) - (b.nivel || 0) || a.name.localeCompare(b.name));

function write(file, content) {
  if (DRY) {
    console.log("[dry]", file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}
const yamlList = (a) =>
  "[" + (a || []).map((x) => (/[:#,[\]]/.test(String(x)) ? '"' + x + '"' : x)).join(", ") + "]";
const yamlStr = (s) => (s == null ? '""' : '"' + String(s).replace(/"/g, "'") + '"');

function notaRegra(d) {
  const ids = d.mecanismos.map((m) => m.id);
  const faltando = ids.filter((id) => (MEC[id] || {}).status !== "funciona");
  const bloq = ids.filter((id) => (MEC[id] || {}).status === "ausente");
  const parciais = ids.filter((id) => (MEC[id] || {}).status === "parcial");
  const fase = faseDoDoc(d);
  const pasta =
    d.kind === "talento" ? "talentos" : d.kind === "arquetipo" ? "arquetipo" : "habilidades";
  const tagKind =
    d.kind === "talento" ? "talento" : d.kind === "arquetipo" ? "arquetipo" : "habilidade";

  const L = [];
  L.push("---");
  L.push("type: regra-pf2e");
  L.push("kind: " + d.kind);
  L.push("classe: " + CLASSE);
  L.push("name: " + yamlStr(d.name));
  L.push("name_pt: " + yamlStr(d.name_pt));
  L.push("nivel: " + d.nivel);
  L.push("acoes: " + yamlStr(d.acoes));
  L.push("traits: " + yamlList(d.traits));
  L.push("prerequisitos: " + yamlList(d.prerequisitos));
  L.push("mecanismos: " + yamlList(ids));
  L.push("mecanismos_faltando: " + yamlList(faltando));
  L.push("bloqueadores: " + yamlList(bloq));
  L.push("n_bloqueadores: " + bloq.length);
  L.push("parciais: " + yamlList(parciais));
  L.push("fase_jogavel: " + fase);
  L.push("jogavel_hoje: " + (faltando.length ? "não" : "sim"));
  L.push("manual: " + (d.manual || "?"));
  L.push("fonte: " + yamlStr(d.fonte || "Pathfinder Player Core"));
  L.push('publicado_fusion: "sim — pin v0.1.1, pt-BR"');
  L.push("tags: [fusion, " + CLASSE + ", " + tagKind + ", nivel-" + d.nivel + "]");
  L.push("created: " + HOJE);
  L.push("updated: " + HOJE);
  L.push("---");
  L.push("");
  L.push("# " + d.name + (d.name_pt ? " — " + d.name_pt : ""));
  L.push("");
  L.push("## Resumo mecânico");
  L.push("");
  L.push(d.resumo);
  L.push("");
  L.push("## Mecanismos exigidos");
  L.push("");
  for (const m of d.mecanismos) L.push("- " + icon(m.id) + " " + link(m.id) + " — " + m.porque);
  L.push("");

  if (d.progressao) {
    L.push("## Atributo-chave");
    L.push("");
    L.push(d.atributo_chave || "—");
    L.push("");
    L.push("## Pontos de vida");
    L.push("");
    L.push(d.pv_por_nivel || "—");
    L.push("");
    L.push("## Proficiências iniciais");
    L.push("");
    L.push(d.proficiencias_iniciais || "—");
    L.push("");
    L.push("## Progressão por nível (1–20)");
    L.push("");
    L.push("| Nível | Habilidades | Talento de classe | Outros |");
    L.push("|---|---|---|---|");
    for (const p of d.progressao) {
      const feats = (p.features || []).map((s) => "[[" + s + "]]").join(", ") || "—";
      L.push(
        "| " +
          p.nivel +
          " | " +
          feats +
          " | " +
          (p.talento_classe ? "sim" : "—") +
          " | " +
          (p.outros || "—") +
          " |"
      );
    }
    L.push("");
  }

  L.push("## Rule elements do vendor");
  L.push("");
  L.push(d.rule_elements || "Nenhum (`rules: []`); é puramente textual.");
  L.push("");

  if (d.referencias && d.referencias.length) {
    L.push("## Referências");
    L.push("");
    L.push(d.referencias.map((r) => "`" + r + "`").join(" · "));
    L.push("");
  }
  if (d.dependencias && d.dependencias.length) {
    L.push("## Dependências");
    L.push("");
    for (const s of d.dependencias) L.push("- [[" + s + "]]");
    L.push("");
  }
  L.push("## Jogar no braço");
  L.push("");
  L.push("Manual: **" + (d.manual || "?") + "**. " + (d.manual_nota || ""));
  L.push("");
  if (d.observacao) {
    L.push("## Observação");
    L.push("");
    L.push(d.observacao);
    L.push("");
  }
  L.push("## Relacionados");
  L.push("");
  L.push("- [[" + CLASSE + "-indice]]");
  L.push("- [[" + CLASSE + "-lacunas]]");
  L.push("");

  return {
    file: path.join(OUT, pasta, d.slug + ".md"),
    content: L.join("\n"),
    fase,
    bloq,
    parciais,
    ids,
  };
}

function notaMecanismo(id, m, usos) {
  const file = "mec-" + id.toLowerCase();
  const nTal = usos.filter((u) => u.kind === "talento").length;
  const nHab = usos.filter((u) => u.kind === "habilidade").length;
  const L = [];
  L.push("---");
  L.push("type: mecanismo-fusion");
  L.push("id: " + id);
  L.push("name: " + yamlStr(m.name));
  L.push("status: " + m.status);
  L.push("sistema: pf2e");
  L.push("evidencia: [" + (m.evidencia || []).map((e) => yamlStr(e)).join(", ") + "]");
  L.push("usado_por_total: " + usos.length);
  L.push("usado_por_guerreiro: " + usos.length);
  L.push("tags: [fusion, " + CLASSE + ", mecanismo]");
  L.push("created: " + HOJE);
  L.push("updated: " + HOJE);
  L.push("---");
  L.push("# " + m.name);
  L.push("");
  L.push("## O que é (regra)");
  L.push("");
  L.push(m.regra);
  L.push("");
  L.push("## Estado hoje no Fusion");
  L.push("");
  L.push("Status: **" + ICON[m.status] + " " + m.status + "**.");
  L.push("");
  if ((m.evidencia || []).length) for (const e of m.evidencia) L.push("- " + e);
  else L.push("- Nenhuma evidência encontrada no código.");
  L.push("");
  L.push("## O que falta");
  L.push("");
  L.push(m.o_que_falta);
  L.push("");
  L.push("## Depende de");
  L.push("");
  if ((m.depende_de || []).length)
    for (const dd of m.depende_de)
      L.push("- " + link(dd) + " — " + ((MEC[dd] || {}).name || dd));
  else L.push("_Nenhuma dependência direta identificada — mecanismo de base._");
  L.push("");
  L.push("## Usado por");
  L.push("");
  L.push(
    "Total: **" + usos.length + "** documentos (" + nTal + " talentos, " + nHab + " habilidades)."
  );
  L.push("");
  if (usos.length) {
    L.push(usos.map((u) => "[[" + u.slug + "]]").join(" · "));
  } else {
    const dependentes = Object.entries(novos)
      .filter(([, outro]) => (outro.depende_de || []).includes(id))
      .map(([outroId]) => link(outroId));
    L.push(
      dependentes.length
        ? "Nenhum documento o cita diretamente — ele é base de: " + dependentes.join(" · ")
        : "_Nenhum documento o cita diretamente._"
    );
  }
  L.push("");
  L.push("## Relacionados");
  L.push("");
  L.push("- [[" + CLASSE + "-indice]]");
  L.push("- [[" + CLASSE + "-lacunas]]");
  L.push("");
  return { file: path.join(OUT, "mecanismos", file + ".md"), content: L.join("\n") };
}

const escritas = [];
const usoPorMec = {};
for (const d of docs) {
  const n = notaRegra(d);
  write(n.file, n.content);
  escritas.push({ ...d, fase: n.fase, bloq: n.bloq, parciais: n.parciais });
  for (const id of n.ids) (usoPorMec[id] = usoPorMec[id] || []).push(d);
}
for (const [id, m] of Object.entries(novos)) {
  const n = notaMecanismo(id, m, usoPorMec[id] || []);
  write(n.file, n.content);
}

if (!DRY) {
  fs.writeFileSync(
    path.join(S, "uso-por-mecanismo.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(usoPorMec).map(([id, us]) => [
          id,
          {
            status: (MEC[id] || {}).status || "?",
            file: (MEC[id] || {}).file,
            pasta: (MEC[id] || {}).pasta,
            name: (MEC[id] || {}).name,
            docs: us.map((u) => ({ slug: u.slug, kind: u.kind, nivel: u.nivel, name: u.name })),
          },
        ])
      ),
      null,
      1
    )
  );
  fs.writeFileSync(
    path.join(S, "docs-derivados.json"),
    JSON.stringify(
      escritas.map((d) => ({
        slug: d.slug,
        kind: d.kind,
        name: d.name,
        nivel: d.nivel,
        fase: d.fase,
        bloq: d.bloq,
        parciais: d.parciais,
        mecanismos: d.mecanismos.map((m) => m.id),
        manual: d.manual,
      })),
      null,
      1
    )
  );
}

console.log("notas de regra: " + docs.length + " | mecanismos novos: " + Object.keys(novos).length);
const semFase = escritas.filter((d) => d.fase === "sem-fase");
if (semFase.length) console.log("SEM FASE: " + semFase.map((d) => d.slug).join(", "));
console.log("jogáveis hoje: " + escritas.filter((d) => d.fase === "hoje").length);
