/**
 * Writes `specs/RASTREABILIDADE.md` and ratchets the coverage floor.
 * Run with `pnpm spec:report` from the repo root.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderReport, summarize, traceSpecs } from "../src/trace.ts";

const SPECS = resolve(import.meta.dirname, "../../../specs");
const FLOOR = resolve(SPECS, "COBERTURA-MINIMA.json");

const report = traceSpecs(SPECS);
writeFileSync(resolve(SPECS, "RASTREABILIDADE.md"), renderReport(SPECS, report), "utf8");

const comTeste = summarize(report).reduce((sum, row) => sum + row.comTeste, 0);
const floor = JSON.parse(readFileSync(FLOOR, "utf8")) as { mvpComTeste: number };

if (comTeste > floor.mvpComTeste) {
  writeFileSync(FLOOR, `${JSON.stringify({ mvpComTeste: comTeste }, null, 2)}\n`, "utf8");
  console.log(`piso de cobertura subiu: ${floor.mvpComTeste} -> ${comTeste}`);
} else {
  console.log(`cobertura [MVP] com teste: ${comTeste} (piso ${floor.mvpComTeste})`);
}

if (report.dangling.length) {
  console.log(`\nids citados pelo código e inexistentes nas specs: ${report.dangling.length}`);
  for (const citation of report.dangling) console.log(`  ${citation.path}: ${citation.id}`);
}
