/**
 * KnowledgeGridWindow.test.ts — the "Quem conhece quem" window as it is drawn,
 * and the Mestre's footer that opens it (spec 39 §5.7, G065).
 *
 * Covers REQ-CTT-060 (a fixed footer only a privileged role has, and it is a
 * footer, not a header), REQ-CTT-061 (the window opens outside the drawer via
 * the window manager, as contacts × characters), REQ-CTT-062 (every cell is an
 * activation that carries the state in words, and an exception is marked),
 * REQ-CTT-063 / REQ-CTT-064 (the contact's name and the character's name are
 * controls of their own), REQ-CTT-065 (the general rule in text plus the legend
 * of the three states), REQ-CTT-066 (no path here creates, deletes or edits an
 * actor), REQ-CTT-067 (no knowledge control anywhere in the list's cards) and
 * RNF-CTT-04 (own scrolling box with both headers pinned).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library —
 * so the assertions read the server-rendered markup (`svelte/server`) and the
 * components' own source for what a rendered string cannot show.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import KnowledgeGridWindow from "../KnowledgeGridWindow.svelte";
import ContactsPanel from "../ContactsPanel.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage mock — ContactsPanel reads the viewer's categories on mount
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
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// ---------------------------------------------------------------------------
// Fixtures — the Mestre's payload, knowledge map included
// ---------------------------------------------------------------------------

const WORLD = "world-1";
const ALEX = "user-alex-000001";

const FOFURINHA = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
};

const TOBIAS = { _id: "act-tobias00001", name: "Tobias", type: "character" };

const FERREIRO = {
  _id: "act-ferreiro01",
  name: "Ferreiro de Otari",
  type: "npc",
  flags: {
    fusion: {
      title: "Martelo Torto",
      knowledge: {
        general: 0,
        exceptions: { "act-tobias00001": 2 },
      },
    },
  },
};

const TAVERNEIRA = {
  _id: "act-taverneira",
  name: "Taverneira Ana",
  type: "npc",
  flags: { fusion: { knowledge: { general: 2, exceptions: {} } } },
};

function seedMirror(actors: unknown[]): void {
  worldMirror.applySnapshot({ seq: 1, activeSceneId: null, documents: { Actor: actors as never } });
}

function renderWindow(): string {
  return render(KnowledgeGridWindow, { props: { socket: {} as never } }).body;
}

function renderPanel(isGm: boolean): string {
  return render(ContactsPanel, {
    props: {
      socket: {} as never,
      worldId: WORLD,
      userId: ALEX,
      isGm,
      activeSceneId: null,
    },
  }).body;
}

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for code. */
function codeOf(file: string): string {
  return sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The markup of one grid row, by contact id. */
function rowOf(body: string, id: string): string {
  const start = body.indexOf(`data-contact-id="${id}"`);
  if (start === -1) throw new Error(`no grid row for "${id}"`);
  const end = body.indexOf("</tr>", start);
  return body.slice(start, end === -1 ? body.length : end);
}

beforeEach(() => {
  localStorageMock.clear();
  seedMirror([FOFURINHA, TOBIAS, FERREIRO, TAVERNEIRA]);
});

// ---------------------------------------------------------------------------
// The footer — REQ-CTT-060
// ---------------------------------------------------------------------------

describe("the footer that opens the window (REQ-CTT-060)", () => {
  it("REQ-CTT-060: the Mestre gets it and the player does not", () => {
    expect(renderPanel(true)).toContain("Quem conhece quem");
    expect(renderPanel(false)).not.toContain("Quem conhece quem");
  });

  it("REQ-CTT-060: it is a footer outside the scrolling body, so it never scrolls", () => {
    const body = renderPanel(true);
    const code = codeOf("ContactsPanel.svelte");

    expect(body).toContain("contacts-panel__footer");
    // The footer element closes AFTER the body div: it is a sibling of the
    // scrolling area, never a row inside it.
    expect(body.indexOf("contacts-panel__footer")).toBeGreaterThan(
      body.indexOf("contacts-panel__body"),
    );
    expect(code).toMatch(/contacts-panel__footer\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    // The header is the search field, and it stays that way (REQ-CTT-010).
    expect(code).toContain("contacts-panel__search");
  });

  it("REQ-CTT-061: the footer opens the grid through the window manager, once", () => {
    const code = codeOf("ContactsPanel.svelte");
    // The open call moved to `lib/contacts/knowledgeWindow.ts` when the NPCs tab
    // gained a footer that opens the SAME window (REQ-NPC-072): one door, so the
    // two tabs cannot drift into two grids. The panel keeps exactly one call.
    const opener = readFileSync(
      fileURLToPath(new URL("../../../lib/contacts/knowledgeWindow.ts", import.meta.url)),
      "utf8",
    );

    expect(code).toContain("openKnowledgeWindow");
    expect(code).not.toContain("windowManager.open");
    expect(opener).toContain("windowManager.open");
    expect(opener).toContain("KnowledgeGridWindow");
    // A singleton key: clicking twice focuses the open window instead of stacking
    // a second grid over the first (REQ-UIF-014).
    expect(opener).toContain('KNOWLEDGE_WINDOW_KEY = "contacts:knowledge"');
  });
});

// ---------------------------------------------------------------------------
// The grid — REQ-CTT-061 / REQ-CTT-062
// ---------------------------------------------------------------------------

describe("the grid of contacts by characters (REQ-CTT-061)", () => {
  it("REQ-CTT-061: one column per character and one row per contact", () => {
    const body = renderWindow();

    expect(body).toContain('data-character-id="act-fofurinha01"');
    expect(body).toContain('data-character-id="act-tobias00001"');
    expect(body).toContain('data-contact-id="act-ferreiro01"');
    expect(body).toContain('data-contact-id="act-taverneira"');
    // A character is never also a row.
    expect(body).not.toContain('data-contact-id="act-fofurinha01"');
  });

  it("REQ-CTT-062: every cell is an activation carrying the state in words", () => {
    const row = rowOf(renderWindow(), "act-ferreiro01");

    // Tobias knows him; Fofurinha reads the general rule, which is hidden.
    expect(row).toContain("Conhecido");
    expect(row).toContain("Oculto");
    // Two cells, both of them buttons — nothing here is a read-only swatch.
    expect([...row.matchAll(/knowledge-grid__state /g)]).toHaveLength(2);
  });

  it("REQ-CTT-062: an exception is told apart by a mark and a word, not by colour", () => {
    const row = rowOf(renderWindow(), "act-ferreiro01");

    expect(row).toContain('data-exception="true"');
    expect(row).toContain('data-exception="false"');
    expect(row).toContain("exceção");

    // A contact whose row is uniform has no exception at all.
    const plain = rowOf(renderWindow(), "act-taverneira");
    expect(plain).not.toContain('data-exception="true"');
  });

  it("REQ-CTT-063 / REQ-CTT-064: the two names are controls of their own", () => {
    const body = renderWindow();

    expect(body).toContain("Mudar a regra geral de Ferreiro de Otari e alinhar a linha inteira");
    expect(body).toContain("Mudar o que Tobias sabe sobre todos os contatos");
  });
});

// ---------------------------------------------------------------------------
// Compact matrix, one symbol per state — REQ-CTT-062 / REQ-CTT-094 (A037: the
// window used to draw the full word ("oculto"/"entrevisto"/"conhecido") and
// the word "Exceção" inside every cell, which produced a much wider, heavier
// grid than the prototype's dense matrix (SYM = ["·","◐","✓"]). It matches now:
// a one-character symbol carries the state visually, and the full state — plus
// the word "exceção" when it applies — reaches assistive tech only through the
// button's accessible name.
// ---------------------------------------------------------------------------

describe("the cell is a compact symbol, not a written label (REQ-CTT-062, REQ-CTT-094)", () => {
  /** The symbol drawn inside the button for a given `data-state`, from a row's markup. */
  function symbolFor(row: string, state: 0 | 1 | 2): string {
    const marker = `data-state="${state}"`;
    const start = row.indexOf(marker);
    if (start === -1) throw new Error(`no cell with data-state="${state}"`);
    const spanStart = row.indexOf('aria-hidden="true">', start) + 'aria-hidden="true">'.length;
    const spanEnd = row.indexOf("</span>", spanStart);
    return row.slice(spanStart, spanEnd);
  }

  it("REQ-CTT-062: each state draws its one-character symbol (·/◐/✓), matching the prototype", () => {
    const row = rowOf(renderWindow(), "act-ferreiro01");

    // Ferreiro's general rule is hidden (·); Tobias overrides it to known (✓).
    expect(symbolFor(row, 0)).toBe("·");
    expect(symbolFor(row, 2)).toBe("✓");
    expect(row).toContain('class="knowledge-grid__state-symbol');

    seedMirror([
      FOFURINHA,
      TOBIAS,
      { ...FERREIRO, flags: { fusion: { knowledge: { general: 1, exceptions: {} } } } },
    ]);
    const glimpsed = rowOf(renderWindow(), "act-ferreiro01");
    expect(symbolFor(glimpsed, 1)).toBe("◐");
  });

  it("REQ-CTT-094: the symbol is hidden from assistive tech, and the full state name is the accessible name instead", () => {
    const row = rowOf(renderWindow(), "act-ferreiro01");

    // The symbol span never reaches a screen reader on its own.
    expect(row).toMatch(/knowledge-grid__state-symbol[^"]*"\s+aria-hidden="true"/);
    // The cell button carries the full word as its aria-label (never only colour).
    expect(row).toMatch(/aria-label="[^"]*Ferreiro de Otari: Oculto\. Mudar o estado\."/);
    expect(row).toMatch(
      /aria-label="[^"]*Ferreiro de Otari: Conhecido, exceção\. Mudar o estado\."/,
    );
  });

  it("REQ-CTT-062: no visible word or icon is written inside the cell anymore — only the symbol", () => {
    const code = codeOf("KnowledgeGridWindow.svelte");

    expect(code).not.toContain("knowledge-grid__state-text");
    expect(code).not.toContain("knowledge-grid__exception-mark");
    expect(code).not.toContain("knowledge-grid__exception-word");
  });
});

// ---------------------------------------------------------------------------
// The general rule and the legend — REQ-CTT-065
// ---------------------------------------------------------------------------

describe("the general rule and the legend are drawn (REQ-CTT-065)", () => {
  it("REQ-CTT-065: each contact shows its general rule in force, in text", () => {
    expect(rowOf(renderWindow(), "act-ferreiro01")).toContain("regra geral: Oculto");
    expect(rowOf(renderWindow(), "act-taverneira")).toContain("regra geral: Conhecido");
  });

  it("REQ-CTT-065: the legend names the three states", () => {
    const body = renderWindow();
    const legend = body.slice(
      body.indexOf("knowledge-grid__legend"),
      body.indexOf("knowledge-grid__scroll"),
    );

    expect(legend).toContain("Oculto");
    expect(legend).toContain("Entrevisto");
    expect(legend).toContain("Conhecido");
  });
});

// ---------------------------------------------------------------------------
// What the window cannot do — REQ-CTT-066 / REQ-CTT-067
// ---------------------------------------------------------------------------

describe("the window edits knowledge and nothing else (REQ-CTT-066)", () => {
  it("REQ-CTT-066: no creation, no deletion and no actor edit anywhere in it", () => {
    const code = codeOf("KnowledgeGridWindow.svelte");

    expect(code).not.toContain("doc:create");
    expect(code).not.toContain("doc:delete");
    expect(code).not.toContain("doc:update");
    // One op reaches the wire, and it is the knowledge one (G060 makes the
    // server refuse it for anyone unprivileged).
    expect([...code.matchAll(/\bsendOp\(/g)]).toHaveLength(1);
    expect(code).toContain("KNOWLEDGE_OP_TYPE");
  });

  it("REQ-CTT-067: no knowledge control exists in the list's cards", () => {
    const code = codeOf("ContactsPanel.svelte");
    const body = renderPanel(true);

    // The panel never sends the knowledge op, and never cycles a state: its one
    // knowledge affordance is the footer that opens the window.
    expect(code).not.toContain("actor:setKnowledge");
    expect(code).not.toContain("cycleKnowledge");
    expect(code).not.toContain("cellCycleEdit");
    expect(body).not.toContain("knowledge-grid__state");
    expect([...body.matchAll(/Quem conhece quem/g)]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Legibility — RNF-CTT-04
// ---------------------------------------------------------------------------

describe("the grid stays legible with the whole world in it (RNF-CTT-04)", () => {
  it("RNF-CTT-04: its own scrolling box, with the head row and the first column pinned", () => {
    const code = codeOf("KnowledgeGridWindow.svelte");

    expect(code).toMatch(/knowledge-grid__scroll\s*\{[^}]*overflow:\s*auto/);
    // The character row sticks to the top and the contact column to the left —
    // both, so a grid larger than the window keeps its labels.
    expect(code).toMatch(
      /knowledge-grid__corner,\s*\n\s*\.knowledge-grid__col-head\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/,
    );
    expect(code).toMatch(
      /knowledge-grid__corner,\s*\n\s*\.knowledge-grid__row-head\s*\{[^}]*position:\s*sticky[^}]*left:\s*0/,
    );
  });

  it("RNF-CTT-04: an empty table says so instead of drawing an empty grid", () => {
    seedMirror([FOFURINHA]);
    expect(renderWindow()).toContain("Nenhum contato para relacionar ainda.");

    seedMirror([FERREIRO]);
    expect(renderWindow()).toContain("Nenhum personagem na mesa ainda.");
  });
});
