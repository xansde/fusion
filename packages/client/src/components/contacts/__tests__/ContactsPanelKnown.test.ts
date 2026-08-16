/**
 * ContactsPanelKnown.test.ts — the Conhecidos section as it is drawn (spec 39, G064).
 *
 * Covers what only the panel can show: REQ-CTT-040 (the section exists and lists the
 * contacts that arrived), REQ-CTT-041 (a glimpsed contact reaches the markup with no
 * name, title or portrait, and with the words "Não identificado"), REQ-CTT-042 (no
 * category control and no sheet button on that card), REQ-CTT-043 (a hidden contact
 * leaves no trace — not in the list, not in the count), REQ-CTT-044 (the Mestre sees
 * how many know and how many glimpsed, and the player never does), REQ-CTT-050 (the
 * controls that create, rename and delete a category), REQ-CTT-052 (deleting a
 * category is not a path that deletes an actor), REQ-CTT-053 ("Sem categoria" has no
 * rename or delete control) and REQ-CTT-055 (the categories are written to
 * localStorage under a world + user key, and to nothing else).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the assertions read the server-rendered markup (`svelte/server`) and the
 * component's own source for what a rendered string cannot show.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ContactsPanel from "../ContactsPanel.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import {
  assignContactToCategory,
  contactCategoriesKey,
  createCategory,
  emptyContactCategories,
  saveContactCategories,
} from "../../../lib/contacts/categories.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as lib/windows/__tests__/window-manager.test.ts)
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    snapshot: () => ({ ...store }),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD = "world-1";
const ALEX = "user-alex-000001";
const TOBIAS = "user-tobias-0001";

const FOFURINHA = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
};

const TOBIAS_PC = {
  _id: "act-tobias00001",
  name: "Tobias",
  type: "character",
  ownership: { default: 0, [TOBIAS]: 3 },
};

/** The contact as the Mestre receives it — whole, knowledge map included. */
const FERREIRO_GM = {
  _id: "act-ferreiro01",
  name: "Ferreiro de Otari",
  type: "npc",
  img: "worlds/x/ferreiro.webp",
  flags: {
    fusion: {
      title: "Martelo Torto",
      knowledge: {
        general: 0,
        exceptions: { "act-tobias00001": 2, "act-fofurinha01": 1 },
      },
    },
  },
};

/** The same contact as the player who only glimpsed it receives it (REQ-CTT-081). */
const FERREIRO_GLIMPSED = {
  _id: "act-ferreiro01",
  type: "npc",
  flags: { fusion: { glimpsed: true } },
};

const TAVERNEIRA = {
  _id: "act-taverneira",
  name: "Taverneira Ana",
  type: "npc",
  img: "worlds/x/ana.webp",
  flags: { fusion: { title: "Dona do Cão Sonolento" } },
};

function seedMirror(actors: unknown[]): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: actors as never },
  });
}

function renderPanel(options: { isGm?: boolean; userId?: string } = {}): string {
  return render(ContactsPanel, {
    props: {
      socket: {} as never,
      worldId: WORLD,
      userId: options.userId ?? ALEX,
      isGm: options.isGm ?? false,
      activeSceneId: null,
    },
  }).body;
}

function source(): string {
  return readFileSync(fileURLToPath(new URL("../ContactsPanel.svelte", import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for code. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The markup of one Conhecidos row, by actor id. */
function knownCardOf(body: string, id: string): string {
  const start = body.indexOf(`data-known-id="${id}"`);
  if (start === -1) throw new Error(`no known row for "${id}"`);
  const from = body.lastIndexOf("<div", start);
  const next = body.indexOf('data-known-id="', start + 1);
  return body.slice(from, next === -1 ? body.length : body.lastIndexOf("<div", next));
}

beforeEach(() => {
  localStorageMock.clear();
  seedMirror([FOFURINHA, TOBIAS_PC, TAVERNEIRA]);
});

// ---------------------------------------------------------------------------
// The section — REQ-CTT-040
// ---------------------------------------------------------------------------

describe("the Conhecidos section (REQ-CTT-040)", () => {
  it("REQ-CTT-040: has its own heading and lists the non-players that arrived", () => {
    const body = renderPanel();

    expect(body).toContain("Conhecidos");
    expect(body).toContain('data-known-id="act-taverneira"');
    // A character belongs to "Na mesa" and is never repeated as a contact.
    expect(body).not.toContain('data-known-id="act-fofurinha01"');
  });

  it("REQ-CTT-040: a contact's row carries its name and its title", () => {
    const card = knownCardOf(renderPanel(), "act-taverneira");

    expect(card).toContain("Taverneira Ana");
    expect(card).toContain("Dona do Cão Sonolento");
  });
});

// ---------------------------------------------------------------------------
// The glimpsed contact — REQ-CTT-041 / REQ-CTT-042
// ---------------------------------------------------------------------------

describe("a glimpsed contact is drawn without an identity (REQ-CTT-041)", () => {
  beforeEach(() => {
    seedMirror([FOFURINHA, FERREIRO_GLIMPSED]);
  });

  it("REQ-CTT-041: no name, no title, no portrait, and the words 'Não identificado'", () => {
    const body = renderPanel();
    const card = knownCardOf(body, "act-ferreiro01");

    expect(card).toContain("Não identificado");
    expect(card).toContain('data-identified="false"');
    // The name the Mestre knows is nowhere in the drawn tab — it never arrived.
    expect(body).not.toContain("Ferreiro de Otari");
    expect(body).not.toContain("Martelo Torto");
    expect(card).not.toContain("<img");
  });

  it("REQ-CTT-042: no category control and no sheet button on that row", () => {
    const card = knownCardOf(renderPanel(), "act-ferreiro01");

    expect(card).not.toContain("<select");
    expect(card).not.toContain("Abrir a ficha");
    expect(card).toContain('draggable="false"');
  });
});

// ---------------------------------------------------------------------------
// The hidden contact — REQ-CTT-043
// ---------------------------------------------------------------------------

describe("a hidden contact leaves no trace in the tab (REQ-CTT-043)", () => {
  it("REQ-CTT-043: not in the list and not in the count the section shows", () => {
    // The player's payload simply lacks it (REQ-CTT-082): the panel has no second
    // source it could count from, which is exactly why nothing here filters it.
    const body = renderPanel();

    expect(body).not.toContain("act-ferreiro01");
    expect(body).not.toContain("Ferreiro");
    // One contact arrived, so the section counts one.
    expect(body).toContain('data-known-id="act-taverneira"');
  });
});

// ---------------------------------------------------------------------------
// The Mestre's counts — REQ-CTT-044
// ---------------------------------------------------------------------------

describe("the Mestre sees who knows and who glimpsed (REQ-CTT-044)", () => {
  beforeEach(() => {
    seedMirror([FOFURINHA, TOBIAS_PC, FERREIRO_GM]);
  });

  it("REQ-CTT-044: the counts are drawn for a privileged role", () => {
    const card = knownCardOf(renderPanel({ isGm: true }), "act-ferreiro01");

    expect(card).toContain("1 conhecem");
    expect(card).toContain("1 entreviram");
  });

  it("REQ-CTT-044: the player sees no count at all", () => {
    const body = renderPanel({ isGm: false });

    expect(body).not.toContain("conhecem");
    expect(body).not.toContain("entreviram");
  });
});

// ---------------------------------------------------------------------------
// Categories — REQ-CTT-050 / REQ-CTT-052 / REQ-CTT-053 / REQ-CTT-055
// ---------------------------------------------------------------------------

describe("the user's own categories (REQ-CTT-050)", () => {
  it("REQ-CTT-050: the section header offers creating a category", () => {
    const body = renderPanel();

    expect(body).toContain("Nova categoria");
  });

  it("REQ-CTT-050: a category block carries rename, delete and both reorder controls", () => {
    saveContactCategories(WORLD, ALEX, createCategory(emptyContactCategories(), "Aliados"));
    const body = renderPanel();

    expect(body).toContain("Renomear a categoria Aliados");
    expect(body).toContain("Excluir a categoria Aliados");
    expect(body).toContain("Mover Aliados para cima");
    expect(body).toContain("Mover Aliados para baixo");
  });

  it("REQ-CTT-051: an identified contact carries the select that moves it", () => {
    saveContactCategories(WORLD, ALEX, createCategory(emptyContactCategories(), "Aliados"));
    const card = knownCardOf(renderPanel(), "act-taverneira");

    expect(card).toContain("Categoria de Taverneira Ana");
    expect(card).toContain(">Aliados<");
    expect(card).toContain(">Sem categoria<");
  });

  it("REQ-CTT-052: no path in this panel deletes an actor — deleting a category is local", () => {
    // The whole tab is gente, not a directory (DEC-CTT-01): there is no doc:delete
    // anywhere in it, so "excluir categoria não exclui ator algum" cannot regress.
    expect(code()).not.toContain("doc:delete");
    expect(code()).toContain("deleteCategory");
  });

  it("REQ-CTT-053: the Sem categoria block has no rename or delete control", () => {
    let categories = createCategory(emptyContactCategories(), "Aliados");
    categories = assignContactToCategory(categories, "act-taverneira", "Aliados");
    saveContactCategories(WORLD, ALEX, categories);
    seedMirror([FOFURINHA, TAVERNEIRA, { _id: "act-mendigo001", name: "Mendigo", type: "npc" }]);

    const body = renderPanel();

    expect(body).toContain("Sem categoria");
    expect(body).not.toContain("Renomear a categoria Sem categoria");
    expect(body).not.toContain("Excluir a categoria Sem categoria");
  });

  it("REQ-CTT-054: the block order drawn is the one the user saved", () => {
    let categories = emptyContactCategories();
    for (const name of ["Aliados", "Vilões"]) categories = createCategory(categories, name);
    saveContactCategories(WORLD, ALEX, {
      order: ["Vilões", "Aliados"],
      assignments: categories.assignments,
    });

    const body = renderPanel();

    expect(body.indexOf('data-category="Vilões"')).toBeLessThan(
      body.indexOf('data-category="Aliados"'),
    );
  });

  it("REQ-CTT-055: the categories are read from a world + user key, and from nowhere else", () => {
    saveContactCategories(WORLD, ALEX, createCategory(emptyContactCategories(), "Aliados"));

    expect(Object.keys(localStorageMock.snapshot())).toEqual([contactCategoriesKey(WORLD, ALEX)]);
    expect(renderPanel({ userId: ALEX })).toContain("Excluir a categoria Aliados");
    // REQ-CTT-056: another user on the same device sees none of it.
    expect(renderPanel({ userId: TOBIAS })).not.toContain("Aliados");
  });

  it("REQ-CTT-055: categories are written to storage, and the only op sent is the title", () => {
    const body = code();

    expect(body).toContain("saveContactCategories");
    // One `sendOp` in the whole panel, and it is the title write (REQ-CTT-085).
    expect([...body.matchAll(/\bsendOp\(/g)]).toHaveLength(1);
    expect(body).toContain("contactTitleDiff");
  });
});
