import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectCitations, renderReport, summarize, traceSpecs } from "../trace.ts";

const SPECS_DIR = resolve(__dirname, "../../../../specs");

const created: string[] = [];

/** A miniature repo: one spec, one source file, one test file. */
function repo(files: Record<string, string>): { specs: string; roots: string[] } {
  const root = mkdtempSync(join(tmpdir(), "spec-trace-"));
  created.push(root);
  const specs = join(root, "specs");
  mkdirSync(specs);
  writeFileSync(
    join(specs, "README.md"),
    "<!-- prefixos:start -->\n| `REQ-ROL-` | [08](08.md) | Rolagens |\n<!-- prefixos:end -->\n",
  );
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  return { specs, roots: [join(root, "packages")] };
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("collectCitations", () => {
  it("separates a citation in a test from one in production code", () => {
    const { roots } = repo({
      "packages/a/src/roll.ts": "// REQ-ROL-001\nexport const roll = () => 0;",
      "packages/a/src/__tests__/roll.test.ts": "// REQ-ROL-002\n",
    });

    const citations = collectCitations(roots);

    expect(citations.find((c) => c.id === "REQ-ROL-001")?.inTest).toBe(false);
    expect(citations.find((c) => c.id === "REQ-ROL-002")?.inTest).toBe(true);
  });

  it("counts a file once per id, however many times it repeats", () => {
    const { roots } = repo({ "packages/a/src/roll.ts": "// REQ-ROL-001 REQ-ROL-001 REQ-ROL-001" });

    expect(collectCitations(roots)).toHaveLength(1);
  });
});

describe("traceSpecs", () => {
  it("classifies each requirement by what cites it", () => {
    const { specs, roots } = repo({
      "specs/08-rolagens.md": [
        "- **REQ-ROL-001** [MVP] Coberta por teste.",
        "- **REQ-ROL-002** [MVP] Só mencionada no código.",
        "- **REQ-ROL-003** [MVP] Ninguém tocou.",
      ].join("\n"),
      "packages/a/src/roll.ts": "// REQ-ROL-002",
      "packages/a/src/__tests__/roll.test.ts": "// REQ-ROL-001",
    });

    const { coverage } = traceSpecs(specs, roots);
    const byId = new Map(coverage.map((c) => [c.id, c]));

    expect(byId.get("REQ-ROL-001")?.tests).toHaveLength(1);
    expect(byId.get("REQ-ROL-002")?.tests).toHaveLength(0);
    expect(byId.get("REQ-ROL-002")?.sources).toHaveLength(1);
    expect(byId.get("REQ-ROL-003")).toMatchObject({ tests: [], sources: [] });
  });

  it("reports an id the code cites and no spec defines", () => {
    const { specs, roots } = repo({
      "specs/08-rolagens.md": "- **REQ-ROL-001** [MVP] Existe.",
      "packages/a/src/roll.ts": "// implementa REQ-ROL-404",
    });

    expect(traceSpecs(specs, roots).dangling.map((d) => d.id)).toEqual(["REQ-ROL-404"]);
  });

  it("counts only [MVP] requirements in the summary", () => {
    const { specs, roots } = repo({
      "specs/08-rolagens.md": [
        "- **REQ-ROL-001** [MVP] Contada.",
        "- **REQ-ROL-002** [V2] Fora do escopo do relatório.",
      ].join("\n"),
      "packages/a/src/__tests__/roll.test.ts": "// REQ-ROL-001 REQ-ROL-002",
    });

    expect(summarize(traceSpecs(specs, roots))).toEqual([
      { spec: "08-rolagens.md", mvp: 1, comTeste: 1, soCodigo: 0, semCitacao: 0 },
    ]);
  });
});

describe("o repositório real", () => {
  const report = traceSpecs(SPECS_DIR);

  it("não cita, no código, requisito que nenhuma spec define", () => {
    const dangling = report.dangling.map((d) => `${d.path}: ${d.id}`);

    expect(dangling).toEqual([]);
  });

  it("não perde cobertura de requisito [MVP] já conquistada", () => {
    const floor = JSON.parse(readFileSync(join(SPECS_DIR, "COBERTURA-MINIMA.json"), "utf8")) as {
      mvpComTeste: number;
    };
    const comTeste = summarize(report).reduce((sum, row) => sum + row.comTeste, 0);

    expect(comTeste).toBeGreaterThanOrEqual(floor.mvpComTeste);
  });

  it("tem o RASTREABILIDADE.md em dia com o estado atual", () => {
    const onDisk = readFileSync(join(SPECS_DIR, "RASTREABILIDADE.md"), "utf8");

    expect(onDisk).toBe(renderReport(SPECS_DIR, report));
  });
});
