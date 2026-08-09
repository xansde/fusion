import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { formatViolations, lintSpecs, parseSpecs } from "../index.js";

const SPECS_DIR = resolve(__dirname, "../../../../specs");

/**
 * The rules are exercised against synthetic corpora, not against `specs/`.
 * A rule that is only ever run over a corpus it already passes proves nothing
 * about what it catches — it just agrees with itself.
 */
const created: string[] = [];

function corpus(
  files: Record<string, string>,
  registry = "| `REQ-ROL-` | [08](08.md) | Rolagens |",
): string {
  const dir = mkdtempSync(join(tmpdir(), "spec-lint-"));
  created.push(dir);
  writeFileSync(
    join(dir, "README.md"),
    `# fixture\n\n<!-- prefixos:start -->\n\n| Prefixo | Spec dona | Área |\n| --- | --- | --- |\n${registry}\n\n<!-- prefixos:end -->\n`,
  );
  writeFileSync(join(dir, "DEBITO-TAGS.txt"), "# fixture\n");
  writeFileSync(join(dir, "DEBITO-CITACOES.txt"), "# fixture\n");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseSpecs", () => {
  it("treats a bold term, a heading and a table cell as definitions", () => {
    const dir = corpus({
      "08-rolagens.md": [
        "- **REQ-ROL-001** [MVP] O servidor DEVE rolar.",
        "### DEC-ROL-01 — Execução no servidor",
        "| CA-ROL-001 | O GM rola e vê o resultado. |",
      ].join("\n"),
    });

    const ids = parseSpecs(dir).definitions.map((d) => d.id);

    expect(ids).toEqual(["REQ-ROL-001", "DEC-ROL-01", "CA-ROL-001"]);
  });

  it("keeps the insertion suffix as part of the id", () => {
    const dir = corpus({
      "08-rolagens.md": [
        "- **REQ-ROL-035** [MVP] Uma regra.",
        "- **REQ-ROL-035a** [V2] Uma regra inserida entre 035 e 036.",
      ].join("\n"),
    });

    const { definitions } = parseSpecs(dir);

    expect(definitions.map((d) => d.id)).toEqual(["REQ-ROL-035", "REQ-ROL-035a"]);
    expect(lintSpecs(dir).filter((v) => v.rule === "id-unico")).toEqual([]);
  });

  it("treats an id in prose as a citation, even when markdown wrapped it to the line start", () => {
    const dir = corpus({
      "08-rolagens.md": [
        "- **REQ-ROL-001** [MVP] O servidor DEVE rolar, respeitando o que já foi",
        "  REQ-ROL-002 decidido — a quebra de linha aqui não cria uma definição.",
        "- **REQ-ROL-002** [MVP] Segunda regra.",
      ].join("\n"),
    });

    const { definitions, citations } = parseSpecs(dir);

    expect(definitions.map((d) => d.id)).toEqual(["REQ-ROL-001", "REQ-ROL-002"]);
    expect(citations.map((c) => c.id)).toEqual(["REQ-ROL-002"]);
  });
});

describe("regra id-unico", () => {
  it("flags the same id defined in two specs", () => {
    const dir = corpus(
      {
        "08-rolagens.md": "- **REQ-ROL-001** [MVP] Uma regra.",
        "09-chat.md": "- **REQ-ROL-001** [MVP] Outra regra, mesmo id.",
      },
      "| `REQ-ROL-` | [08](08.md) | Rolagens |",
    );

    const rules = lintSpecs(dir).map((v) => v.rule);

    expect(rules).toContain("id-unico");
  });
});

describe("regra citacao-resolvivel", () => {
  it("flags a citation with no definition anywhere", () => {
    const dir = corpus({
      "08-rolagens.md": "- **REQ-ROL-001** [MVP] Ver também REQ-ROL-999, que não existe.",
    });

    const violations = lintSpecs(dir).filter((v) => v.rule === "citacao-resolvivel");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("REQ-ROL-999");
  });

  it("leaves alone an id from an area outside the registry — that is an external reference", () => {
    const dir = corpus({
      "08-rolagens.md": "- **REQ-ROL-001** [MVP] Como discutido em Q-WF-05 da pesquisa 16.",
    });

    expect(lintSpecs(dir).filter((v) => v.rule === "citacao-resolvivel")).toEqual([]);
  });

  it("ignores ids frozen in DEBITO-CITACOES.txt", () => {
    const dir = corpus({ "08-rolagens.md": "- **REQ-ROL-001** [MVP] Ver REQ-ROL-030." });
    writeFileSync(join(dir, "DEBITO-CITACOES.txt"), "# congelado\nREQ-ROL-030\n");

    expect(lintSpecs(dir).filter((v) => v.rule === "citacao-resolvivel")).toEqual([]);
  });

  it("accepts a citation resolved in another spec", () => {
    const dir = corpus(
      {
        "08-rolagens.md": "- **REQ-ROL-001** [MVP] Uma regra.",
        "09-chat.md": "- **REQ-CHT-001** [MVP] Reusa a rolagem de REQ-ROL-001.",
      },
      "| `REQ-ROL-` | [08](08.md) | Rolagens |\n| `REQ-CHT-` | [09](09.md) | Chat |",
    );

    expect(lintSpecs(dir).filter((v) => v.rule === "citacao-resolvivel")).toEqual([]);
  });
});

describe("regra prefixo-com-dono", () => {
  it("flags a spec defining an id from another spec's area", () => {
    const dir = corpus(
      {
        "08-rolagens.md": "- **REQ-ROL-001** [MVP] Uma regra.",
        "09-chat.md": "- **REQ-ROL-002** [MVP] Roubou a área da 08.",
      },
      "| `REQ-ROL-` | [08](08.md) | Rolagens |",
    );

    const violations = lintSpecs(dir).filter((v) => v.rule === "prefixo-com-dono");

    expect(violations.map((v) => v.file)).toEqual(["09-chat.md"]);
  });

  it("applies to every id family, not just REQ", () => {
    const dir = corpus(
      {
        "08-rolagens.md": "- **REQ-ROL-001** [MVP] Uma regra.",
        "09-chat.md": "### DEC-ROL-01 — decisão da área alheia",
      },
      "| `REQ-ROL-` | [08](08.md) | Rolagens |",
    );

    const violations = lintSpecs(dir).filter((v) => v.rule === "prefixo-com-dono");

    expect(violations.map((v) => v.file)).toEqual(["09-chat.md"]);
  });

  it("flags an area that is not in the registry at all", () => {
    const dir = corpus({ "08-rolagens.md": "- **REQ-ZZZ-001** [MVP] Área não registrada." });

    expect(lintSpecs(dir).map((v) => v.rule)).toContain("prefixo-com-dono");
  });
});

describe("regra req-com-tag", () => {
  it("flags a requirement without [MVP] or [V2]", () => {
    const dir = corpus({ "08-rolagens.md": "- **REQ-ROL-001** O servidor DEVE rolar." });

    expect(lintSpecs(dir).map((v) => v.rule)).toContain("req-com-tag");
  });

  it("does not flag a scope tag that is not a roadmap tag", () => {
    const dir = corpus({ "08-rolagens.md": "- **REQ-ROL-001** [MC] Só tag de recorte." });

    expect(lintSpecs(dir).map((v) => v.rule)).toContain("req-com-tag");
  });

  it("ignores ids frozen in DEBITO-TAGS.txt", () => {
    const dir = corpus({ "08-rolagens.md": "- **REQ-ROL-001** [MC] Débito congelado." });
    writeFileSync(join(dir, "DEBITO-TAGS.txt"), "# congelado\nREQ-ROL-001\n");

    expect(lintSpecs(dir).filter((v) => v.rule === "req-com-tag")).toEqual([]);
  });
});

describe("regra registro-de-prefixos", () => {
  it("flags a registry row pointing at a spec that does not exist", () => {
    const dir = corpus(
      { "08-rolagens.md": "- **REQ-ROL-001** [MVP] Uma regra." },
      "| `REQ-ROL-` | [08](08.md) | Rolagens |\n| `REQ-XXX-` | [99](99.md) | Fantasma |",
    );

    expect(lintSpecs(dir).map((v) => v.rule)).toContain("registro-de-prefixos");
  });

  it("fails loudly when the README has no registry block", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-lint-"));
    created.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "# sem bloco\n");
    writeFileSync(join(dir, "DEBITO-TAGS.txt"), "");
    writeFileSync(join(dir, "DEBITO-CITACOES.txt"), "");

    expect(() => lintSpecs(dir)).toThrow(/prefixos:start/);
  });
});

describe("o corpo real de specs/", () => {
  it("está em conformidade com o metamodelo", () => {
    const violations = lintSpecs(SPECS_DIR);

    expect(formatViolations(violations)).toBe("");
  });
});
