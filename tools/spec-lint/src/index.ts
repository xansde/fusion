/**
 * Mechanical checker for the `specs/` corpus.
 *
 * The specs are the definition of the objective: every requirement carries a
 * stable id, and code, tests and issues cite that id. That only works if the
 * ids form a namespace nobody can silently break — which is what this checks.
 * See `specs/CONVENCOES.md` for the metamodel these rules enforce.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Id families used across the corpus: requirement, non-functional, acceptance
 * criterion, success criterion, decision, open question. */
export const ID_KINDS = ["REQ", "RNF", "CA", "CS", "DEC", "D", "Q"] as const;

/** The trailing letter is the insertion suffix — `REQ-CNV-035a` sits between 035 and 036. */
const ID_BODY = "(?:REQ|RNF|CA|CS|DEC|D|Q)-([A-Z0-9]{2,5})-\\d{1,3}[a-zA-Z]?";
const ID_ANYWHERE = new RegExp(`\\b${ID_BODY}\\b`, "g");

/**
 * An id is *defined* when it opens its own block — a bold term, a heading, or
 * the first cell of a table row. Anywhere else it is a citation. Markdown soft
 * wrapping puts citations at the start of a line too, so leading position alone
 * is not enough to tell them apart; the surrounding markup is.
 */
const DEFINITION = new RegExp(
  "^[\\s>]*(?:" +
    // - **REQ-ROL-012** [MVP] ...
    `(?:[-*+]\\s+|\\|\\s*)?\\*\\*(${ID_BODY})[^*]*\\*\\*` +
    // ### DEC-MMT-01 — ...
    `|#{2,6}\\s+(${ID_BODY})\\b` +
    // | CA-CBT-001 | ... |
    `|\\|\\s*(${ID_BODY})\\s*\\|` +
    ")",
);

const TAG = /\[([A-Z0-9]{1,4})\]/;

export interface SpecId {
  readonly id: string;
  /** Middle segment — the area that owns the id, e.g. `ROL` in `REQ-ROL-012`. */
  readonly area: string;
  readonly file: string;
  readonly line: number;
}

export interface Definition extends SpecId {
  readonly tag: string | null;
}

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface SpecCorpus {
  readonly definitions: readonly Definition[];
  readonly citations: readonly SpecId[];
}

const areaOf = (id: string): string => id.split("-")[1]!;

/** Spec filenames only — `README.md`, `RESUMO.md` and `CONVENCOES.md` are prose. */
export function specFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort();
}

export function parseSpecs(dir: string): SpecCorpus {
  const definitions: Definition[] = [];
  const citations: SpecId[] = [];

  for (const file of specFiles(dir)) {
    const lines = readFileSync(join(dir, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = DEFINITION.exec(line);
      const defined = match ? (match[1] ?? match[3] ?? match[5]) : undefined;
      if (defined) {
        definitions.push({
          id: defined,
          area: areaOf(defined),
          file,
          line: index + 1,
          tag: TAG.exec(line)?.[1] ?? null,
        });
      }
      for (const cited of line.matchAll(ID_ANYWHERE)) {
        if (cited[0] !== defined) {
          citations.push({ id: cited[0], area: areaOf(cited[0]), file, line: index + 1 });
        }
      }
    });
  }

  return { definitions, citations };
}

/**
 * Reads the prefix registry from the marked block in `specs/README.md`.
 * Rows look like: `| \`REQ-ROL-\` | [08](08-motor-de-rolagens.md) | ... |`
 */
export function parsePrefixRegistry(dir: string): Map<string, string> {
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  const block = /<!-- prefixos:start -->([\s\S]*?)<!-- prefixos:end -->/.exec(readme);
  if (!block) {
    throw new Error("specs/README.md has no <!-- prefixos:start --> block");
  }

  const owners = new Map<string, string>();
  for (const row of block[1]!.split(/\r?\n/)) {
    const cells = /^\|\s*`REQ-([A-Z0-9]{2,5})-`\s*\|\s*\[?(\d{2})\]?/.exec(row);
    if (cells) owners.set(cells[1]!, cells[2]!);
  }
  return owners;
}

/** Known offenders, frozen. The rule accepts these and nothing else, so the debt
 * can only shrink. Comment lines (`#`) are ignored. */
function readDebt(dir: string, file: string): Set<string> {
  const raw = readFileSync(join(dir, file), "utf8");
  return new Set(
    raw
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

export function lintSpecs(dir: string): Violation[] {
  const { definitions, citations } = parseSpecs(dir);
  const violations: Violation[] = [];
  const owners = parsePrefixRegistry(dir);
  const tagDebt = readDebt(dir, "DEBITO-TAGS.txt");

  // R1 — an id is defined exactly once, in exactly one file.
  const byId = new Map<string, Definition[]>();
  for (const def of definitions) {
    const list = byId.get(def.id) ?? [];
    list.push(def);
    byId.set(def.id, list);
  }
  for (const [id, defs] of byId) {
    if (defs.length > 1) {
      const where = defs.map((d) => `${d.file}:${d.line}`).join(", ");
      violations.push({
        rule: "id-unico",
        file: defs[1]!.file,
        line: defs[1]!.line,
        message: `${id} está definido ${defs.length}× (${where}); um id nomeia um único requisito.`,
      });
    }
  }

  // R2 — every citation resolves to a definition. An id whose area is not in the
  // registry is a reference to something outside `specs/` (a research doc, another
  // project) and is left alone; defining one locally is caught by R3 instead.
  const danglingDebt = readDebt(dir, "DEBITO-CITACOES.txt");
  for (const cite of citations) {
    if (!owners.has(cite.area)) continue;
    if (danglingDebt.has(cite.id)) continue;
    if (!byId.has(cite.id)) {
      violations.push({
        rule: "citacao-resolvivel",
        file: cite.file,
        line: cite.line,
        message: `${cite.id} é citado mas não está definido em nenhuma spec.`,
      });
    }
  }

  // R3 — an area belongs to one spec; only that spec may define ids in it.
  for (const def of definitions) {
    const owner = owners.get(def.area);
    if (!owner) {
      violations.push({
        rule: "prefixo-com-dono",
        file: def.file,
        line: def.line,
        message: `área \`${def.area}\` (em ${def.id}) não está no registro de prefixos do README.`,
      });
    } else if (!def.file.startsWith(`${owner}-`)) {
      violations.push({
        rule: "prefixo-com-dono",
        file: def.file,
        line: def.line,
        message: `${def.id} é definido aqui, mas a área \`${def.area}\` pertence à spec ${owner}. Cite, não redefina.`,
      });
    }
  }

  // R4 — a requirement without [MVP]/[V2] has no place in the roadmap.
  for (const def of definitions) {
    if (!def.id.startsWith("REQ-")) continue;
    if (def.tag === "MVP" || def.tag === "V2") continue;
    if (tagDebt.has(def.id)) continue;
    violations.push({
      rule: "req-com-tag",
      file: def.file,
      line: def.line,
      message: `${def.id} não tem tag [MVP] ou [V2].`,
    });
  }

  // R5 — decisions are written one way. `D1`, `D-ARQ-01` and `DECISÃO-A11-01` all
  // existed side by side; a bare `D4` cited from another spec named nothing at all.
  for (const file of specFiles(dir)) {
    readFileSync(join(dir, file), "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const legacy =
          /^#{2,6}\s+D\d{1,2}(?=[\s:—–-])/.exec(line)?.[0] ??
          /\bD-[A-Z0-9]{2,5}-\d{1,2}\b/.exec(line)?.[0] ??
          /\bDECISÃO-[A-Z0-9]{2,5}-\d{1,2}\b/.exec(line)?.[0];
        if (legacy) {
          violations.push({
            rule: "decisao-canonica",
            file,
            line: index + 1,
            message: `"${legacy.trim()}" usa uma forma antiga de decisão; a canônica é DEC-<ÁREA>-NN.`,
          });
        }
      });
  }

  // R6 — the registry points at files that exist and each spec owns one area.
  const files = specFiles(dir);
  for (const [area, owner] of owners) {
    if (!files.some((f) => f.startsWith(`${owner}-`))) {
      violations.push({
        rule: "registro-de-prefixos",
        file: "README.md",
        line: 0,
        message: `área \`${area}\` aponta para a spec ${owner}, que não existe em specs/.`,
      });
    }
  }

  return violations;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`).join("\n");
}
