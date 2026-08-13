/**
 * Traceability between `specs/` and the code that is supposed to fulfil it.
 *
 * The convention already existed organically — 600+ requirement ids are quoted
 * in source and test files. This reads that back and answers the question the
 * specs cannot answer about themselves: which requirements are actually cobrados
 * by a test, which are only mentioned in passing, and which nobody ever touched.
 *
 * It measures citation, not correctness: a test naming `REQ-ROL-012` claims to
 * cover it. That claim is worth having — an uncited requirement claims nothing.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseSpecs, specFiles } from "./index.ts";

/** Directories scanned for requirement citations. */
export const CODE_ROOTS = ["packages", "systems", "tools"];

/** This package's own fixtures quote synthetic ids on purpose. */
const IGNORED_PATHS = /tools[/\\]spec-lint[/\\]/;

const CODE_FILE = /\.(ts|mts|svelte|mjs)$/;
const SKIP_DIR = /^(node_modules|dist|build|\.git|\.svelte-kit)$/;
const REQ_ID = /\bREQ-[A-Z0-9]{2,5}-\d{1,3}[a-zA-Z]?\b/g;

export interface Citation {
  readonly id: string;
  readonly path: string;
  readonly inTest: boolean;
}

export interface Coverage {
  readonly id: string;
  readonly spec: string;
  readonly tag: string | null;
  readonly tests: readonly string[];
  readonly sources: readonly string[];
}

export interface TraceReport {
  readonly coverage: readonly Coverage[];
  /** Ids quoted by code that no spec defines — a stale or mistyped reference. */
  readonly dangling: readonly Citation[];
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) yield* walk(path);
    } else if (CODE_FILE.test(entry.name) && !IGNORED_PATHS.test(path)) {
      yield path;
    }
  }
}

export function collectCitations(roots: readonly string[] = CODE_ROOTS): Citation[] {
  const citations: Citation[] = [];
  for (const root of roots) {
    for (const path of walk(root)) {
      const inTest = /\.test\.ts$|__tests__/.test(path);
      const seen = new Set<string>();
      for (const match of readFileSync(path, "utf8").matchAll(REQ_ID)) {
        if (seen.has(match[0])) continue;
        seen.add(match[0]);
        citations.push({ id: match[0], path: path.split("\\").join("/"), inTest });
      }
    }
  }
  return citations;
}

/** Code roots as siblings of `specs/`, so callers never depend on the cwd. */
export function defaultRoots(specsDir: string): string[] {
  return CODE_ROOTS.map((name) => join(specsDir, "..", name));
}

export function traceSpecs(specsDir: string, roots = defaultRoots(specsDir)): TraceReport {
  const requirements = parseSpecs(specsDir).definitions.filter((d) => d.id.startsWith("REQ-"));
  const byId = new Map(requirements.map((d) => [d.id, d]));
  const citations = collectCitations(roots);

  const tests = new Map<string, string[]>();
  const sources = new Map<string, string[]>();
  const dangling: Citation[] = [];
  for (const citation of citations) {
    if (!byId.has(citation.id)) {
      dangling.push(citation);
      continue;
    }
    const target = citation.inTest ? tests : sources;
    target.set(citation.id, [...(target.get(citation.id) ?? []), citation.path]);
  }

  const coverage = requirements.map((requirement) => ({
    id: requirement.id,
    spec: requirement.file,
    tag: requirement.tag,
    tests: tests.get(requirement.id) ?? [],
    sources: sources.get(requirement.id) ?? [],
  }));

  return { coverage, dangling };
}

export interface SpecTotals {
  readonly spec: string;
  readonly mvp: number;
  readonly comTeste: number;
  readonly soCodigo: number;
  readonly semCitacao: number;
}

/** Per-spec totals over `[MVP]` requirements — the ones the roadmap actually promises. */
export function summarize(report: TraceReport): SpecTotals[] {
  const totals = new Map<string, { mvp: number; comTeste: number; soCodigo: number }>();
  for (const item of report.coverage) {
    if (item.tag !== "MVP") continue;
    const row = totals.get(item.spec) ?? { mvp: 0, comTeste: 0, soCodigo: 0 };
    row.mvp += 1;
    if (item.tests.length) row.comTeste += 1;
    else if (item.sources.length) row.soCodigo += 1;
    totals.set(item.spec, row);
  }
  return [...totals]
    .map(([spec, row]) => ({
      spec,
      ...row,
      semCitacao: row.mvp - row.comTeste - row.soCodigo,
    }))
    .sort((a, b) => a.spec.localeCompare(b.spec));
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

export function renderReport(specsDir: string, report: TraceReport): string {
  const rows = summarize(report);
  const mvp = rows.reduce((sum, r) => sum + r.mvp, 0);
  const comTeste = rows.reduce((sum, r) => sum + r.comTeste, 0);
  const soCodigo = rows.reduce((sum, r) => sum + r.soCodigo, 0);
  const semCitacao = mvp - comTeste - soCodigo;
  const specCount = specFiles(specsDir).length;

  const lines = [
    "# Rastreabilidade — requisito ↔ código",
    "",
    "> Arquivo **gerado**. Não edite à mão: rode `pnpm spec:report`.",
    "",
    "Um requisito conta como **coberto** quando um arquivo de teste cita o id dele",
    "(`REQ-ROL-012`) — a convenção que o repo já usava antes de ser formalizada.",
    "Isso mede *reivindicação de cobertura*, não correção: um teste que nomeia o",
    "requisito afirma cobri-lo, e essa afirmação é auditável. Requisito sem citação",
    "nenhuma não afirma nada — é a spec pedindo algo que ninguém foi conferir.",
    "",
    `Escopo: os **${mvp} requisitos [MVP]** definidos nas ${specCount} specs. Os [V2] ficam de fora`,
    "porque ainda não foram prometidos para nenhum marco.",
    "",
    "## Total",
    "",
    "| Situação | Requisitos | Fatia |",
    "| --- | ---: | ---: |",
    `| Citados por algum teste | ${comTeste} | ${pct(comTeste, mvp)} |`,
    `| Citados só por código de produção | ${soCodigo} | ${pct(soCodigo, mvp)} |`,
    `| Sem nenhuma citação | ${semCitacao} | ${pct(semCitacao, mvp)} |`,
    `| **Total [MVP]** | **${mvp}** | |`,
    "",
    "## Por spec",
    "",
    "| Spec | [MVP] | Com teste | Só código | Sem citação | Cobertura |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (r) =>
        `| [${r.spec.slice(0, 2)}](${r.spec}) | ${r.mvp} | ${r.comTeste} | ${r.soCodigo} | ${r.semCitacao} | ${pct(r.comTeste, r.mvp)} |`,
    ),
    "",
  ];

  return lines.join("\n");
}
