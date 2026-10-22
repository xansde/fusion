/**
 * The avatar flag against the REAL persistence path.
 *
 * Two things the client cannot prove on its own, and both have bitten this
 * codebase before:
 *
 *  1. `flags.fusion.avatar` SURVIVES a store round-trip. The document schemas
 *     use `.extend()` without `.passthrough()`, so an undeclared field is
 *     silently dropped on every write — that is how `grid` vanished from every
 *     scene for rounds (docs/lessons.md). `flags` is declared on
 *     BaseDocumentSchema as a nested record, and this test is what pins that the
 *     avatar's shape actually fits through it.
 *
 *  2. The save diff PRUNES. The store deep-merges, so an omitted key is a key
 *     that survives: unequipping a hat, or replacing a piece that had colours,
 *     only works because the client sends explicit nulls (see
 *     packages/client/src/lib/avatar/patch.ts). The diff literals here are the
 *     exact shapes asserted by that module's own tests.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations } from "../db/index.js";
import { DocumentStore } from "../documents/index.js";
import { readAvatarFlag, AVATAR_FLAG_PATH } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Harness — real SQLite in a temp dir, same shape as documents.test.ts
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function novaLoja(): DocumentStore {
  const dir = join(
    tmpdir(),
    `fusion-avatar-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const path = join(dir, "world.db");
  const db = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(db.raw, path);
  return new DocumentStore({
    db: db.raw,
    defaultAuthor: { userId: "serverUserId" },
    coreVersion: "0.1.0",
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/**
 * Expand a dot-path diff the way the doc:update handler does before it reaches
 * the store (`applyDotPathDiff` in net/handlers/doc-handlers.ts).
 */
function expandir(diff: Record<string, unknown>): Record<string, unknown> {
  const fora: Record<string, unknown> = {};
  for (const [caminho, valor] of Object.entries(diff)) {
    const partes = caminho.split(".");
    let atual = fora;
    for (const parte of partes.slice(0, -1)) {
      if (typeof atual[parte] !== "object" || atual[parte] === null) atual[parte] = {};
      atual = atual[parte] as Record<string, unknown>;
    }
    atual[partes[partes.length - 1] ?? ""] = valor;
  }
  return fora;
}

function criarAtor(loja: DocumentStore): string {
  const ator = loja.create("actors", { name: "Fofurinha", type: "character", system: {} });
  return ator["_id"] as string;
}

// ---------------------------------------------------------------------------

describe("flags.fusion.avatar na persistência", () => {
  it("survives a create + read round-trip through the Actor schema", () => {
    const loja = novaLoja();
    const avatar = {
      versao: 1,
      corpo: "female",
      pin: "0f898bb6",
      selecao: {
        body: { id: "body/body-color", cores: { cor: "ulpc:tan" } },
        head: { id: "head/human-female" },
      },
    };
    const ator = loja.create("actors", {
      name: "Fofurinha",
      type: "character",
      system: {},
      flags: { fusion: { avatar } },
    });

    // The schema uses .extend() without .passthrough(): if `flags` did not
    // accept a nested record, this comes back undefined and the whole feature
    // would silently never persist.
    expect(readAvatarFlag(loja.get("actors", ator["_id"] as string))).toEqual(avatar);
  });

  it("stores an avatar through the same dot-path diff the client sends", () => {
    const loja = novaLoja();
    const id = criarAtor(loja);

    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          pin: "pin123",
          selecao: {
            body: { id: "body/body-color" },
            hat: { id: "hat/tricorne", cores: { cor: "black" } },
          },
        },
      }),
    );

    const lido = readAvatarFlag(loja.get("actors", id));
    expect(Object.keys(lido?.selecao ?? {}).sort()).toEqual(["body", "hat"]);
    expect(lido?.selecao["hat"]?.cores).toEqual({ cor: "black" });
  });

  it("really removes an unequipped slot — the merge would otherwise keep it", () => {
    const loja = novaLoja();
    const id = criarAtor(loja);

    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: { body: { id: "body/body-color" }, hat: { id: "hat/tricorne" } },
        },
      }),
    );

    // The client's pruned diff: the hat comes back as an explicit null.
    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: { body: { id: "body/body-color" }, hat: null },
        },
      }),
    );

    expect(Object.keys(readAvatarFlag(loja.get("actors", id))?.selecao ?? {})).toEqual(["body"]);
  });

  it("keeps a removed slot when the diff is NOT pruned — the bug this guards", () => {
    const loja = novaLoja();
    const id = criarAtor(loja);
    const comChapeu = {
      versao: 1,
      corpo: "male",
      selecao: { body: { id: "body/body-color" }, hat: { id: "hat/tricorne" } },
    };
    loja.update("actors", id, expandir({ [AVATAR_FLAG_PATH]: comChapeu }));

    // A naive write that just omits the hat: deep merge preserves it.
    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: { body: { id: "body/body-color" } },
        },
      }),
    );

    expect(Object.keys(readAvatarFlag(loja.get("actors", id))?.selecao ?? {}).sort()).toEqual([
      "body",
      "hat",
    ]);
  });

  it("drops the previous piece's colours when a piece is replaced", () => {
    const loja = novaLoja();
    const id = criarAtor(loja);

    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: {
            hat: {
              id: "hat/barbarian",
              cores: { color_1: "ulpc:steel", hat_secondary: "ulpc:brown" },
            },
          },
        },
      }),
    );

    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: { hat: { id: "hat/tricorne", cores: { color_1: null, hat_secondary: null } } },
        },
      }),
    );

    const escolha = readAvatarFlag(loja.get("actors", id))?.selecao["hat"];
    expect(escolha?.id).toBe("hat/tricorne");
    expect(escolha?.cores).toEqual({});
  });

  it("removes the whole avatar with one null at the flag root", () => {
    const loja = novaLoja();
    const id = criarAtor(loja);
    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: { body: { id: "body/body-color" } },
        },
      }),
    );
    expect(readAvatarFlag(loja.get("actors", id))).not.toBeNull();

    loja.update("actors", id, expandir({ [AVATAR_FLAG_PATH]: null }));
    expect(readAvatarFlag(loja.get("actors", id))).toBeNull();
  });

  it("leaves other flag namespaces alone", () => {
    const loja = novaLoja();
    const ator = loja.create("actors", {
      name: "Fofurinha",
      type: "character",
      system: {},
      flags: { outro: { chave: "valor" } },
    });
    const id = ator["_id"] as string;

    loja.update(
      "actors",
      id,
      expandir({
        [AVATAR_FLAG_PATH]: {
          versao: 1,
          corpo: "male",
          selecao: { body: { id: "body/body-color" } },
        },
      }),
    );

    const flags = loja.get("actors", id)["flags"] as Record<string, Record<string, unknown>>;
    expect(flags["outro"]).toEqual({ chave: "valor" });
    expect(flags["fusion"]).toBeDefined();
  });
});
