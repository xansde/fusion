#!/usr/bin/env node
/**
 * Pós-processa os JSONs dos agentes antes do gen.cjs:
 *
 * 1. Injeta EFFECT-SOURCE-ITEMS em todo documento que dependa de um rule element
 *    escrito no próprio documento. O degrau que falta é anterior ao tipo de regra:
 *    talento/habilidade não vira fonte de efeito, então a regra nunca chega ao motor.
 * 2. Normaliza `acoes` para uma forma legível na ficha.
 * 3. Reporta IDs de mecanismo desconhecidos (falha ruidosa, não silenciosa).
 */
const fs = require("fs");
const path = require("path");
const S = __dirname;

const RULE_ELEMENT_MECS = new Set([
  "AEL",
  "MOD-ADJUST",
  "NOTE",
  "ROLL-OPTION",
  "ITEM-ALTER",
  "DAMAGE-ALT",
  "STRIKE-MOD",
  "DOS-ADJUST",
]);
const PORQUE =
  "a regra está escrita no próprio talento, e documento de talento/habilidade ainda não vira fonte de efeito para o motor";

const mapa = JSON.parse(fs.readFileSync(path.join(S, "mapa-mecanismos.json"), "utf8"));
const novos = JSON.parse(fs.readFileSync(path.join(S, "mecanismos-guerreiro.json"), "utf8"));
const conhecidos = new Set([...Object.keys(mapa), ...Object.keys(novos)]);

const ACOES = {
  action: (n) => String(n ?? "1"),
  reaction: () => "reação",
  free: () => "livre",
  passive: () => "passivo",
};

let injetados = 0;
const desconhecidos = {};
for (const arquivo of ["docs-feats-n1-6.json", "docs-feats-n8-20.json", "docs-features.json"]) {
  const p = path.join(S, arquivo);
  if (!fs.existsSync(p)) {
    console.log("AUSENTE: " + arquivo);
    continue;
  }
  const docs = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const d of docs) {
    const ids = d.mecanismos.map((m) => m.id);
    for (const id of ids) if (!conhecidos.has(id)) desconhecidos[id] = (desconhecidos[id] || 0) + 1;

    if (ids.some((id) => RULE_ELEMENT_MECS.has(id)) && !ids.includes("EFFECT-SOURCE-ITEMS")) {
      d.mecanismos.push({ id: "EFFECT-SOURCE-ITEMS", porque: PORQUE });
      injetados++;
    }
    if (d.action_type && ACOES[d.action_type]) d.acoes = ACOES[d.action_type](d.acoes);
    if (!d.acoes) d.acoes = "passivo";
  }
  fs.writeFileSync(p, JSON.stringify(docs, null, 1), "utf8");
  console.log(arquivo + ": " + docs.length + " entradas");
}

console.log("EFFECT-SOURCE-ITEMS injetado em " + injetados + " documentos");
if (Object.keys(desconhecidos).length) {
  console.log("IDs DESCONHECIDOS (criar nota antes de gerar): " + JSON.stringify(desconhecidos));
  process.exitCode = 1;
} else {
  console.log("todos os IDs de mecanismo existem no catálogo");
}
