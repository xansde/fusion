/**
 * knowledgeGrid.test.ts — the rules behind the "Quem conhece quem" window (G065).
 *
 * Covers REQ-CTT-061 (the grid is contacts × characters), REQ-CTT-062 (a cell
 * cycles the three states and an exception is distinguishable), REQ-CTT-063 (the
 * contact's name cycles the general rule and aligns the row), REQ-CTT-064 (the
 * character's name cycles the column and levels a mixed one at `conhecido`),
 * REQ-CTT-065 (the general rule in force is readable per contact, and the three
 * states have labels) and REQ-CTT-066 (no edit this module can produce touches
 * anything but the knowledge map).
 *
 * Not circular: the edits are applied with the SAME state machine the server
 * runs (`applyKnowledgeEdit` from `@fusion/shared`) and the assertions are the
 * spec's own sentences about the result — never a comparison of the module's
 * output against a table the module itself produced.
 */

import { describe, expect, it } from "vitest";
import { KnowledgeState, applyKnowledgeEdit, readKnowledgeMap } from "@fusion/shared";
import type { ActorKnowledgeEdit, KnowledgeMap } from "@fusion/shared";

import {
  KNOWLEDGE_OP_TYPE,
  KNOWLEDGE_STATE_KEYS,
  buildKnowledgeGrid,
  cellCycleEdit,
  cellStateOf,
  columnCycleEdits,
  columnStates,
  knowledgeOpPayload,
  nextColumnState,
  rowCycleEdit,
} from "../knowledgeGrid.js";
import type { ContactActorDoc } from "../contactsVM.js";

// ---------------------------------------------------------------------------
// Fixtures — the Mestre's payload, knowledge map included (REQ-CTT-084)
// ---------------------------------------------------------------------------

const FOFURINHA = { _id: "act-fofurinha01", name: "Fofurinha", type: "character" };
const TOBIAS = { _id: "act-tobias00001", name: "Tobias", type: "character" };
const BRUXA = { _id: "act-bruxa00001", name: "Bruxa da Ponte", type: "orador" };

function contact(
  id: string,
  name: string,
  knowledge?: Partial<KnowledgeMap>,
  title?: string,
): ContactActorDoc {
  return {
    _id: id,
    name,
    type: "npc",
    flags: {
      fusion: {
        ...(title !== undefined ? { title } : {}),
        ...(knowledge !== undefined
          ? { knowledge: { general: 0, exceptions: {}, ...knowledge } }
          : {}),
      },
    },
  };
}

/** The ferreiro: hidden in general, known by Tobias, glimpsed by Fofurinha. */
const FERREIRO = contact(
  "act-ferreiro01",
  "Ferreiro de Otari",
  {
    general: KnowledgeState.Hidden,
    exceptions: { [TOBIAS._id]: KnowledgeState.Known, [FOFURINHA._id]: KnowledgeState.Glimpsed },
  },
  "Martelo Torto",
);

/** The taverneira: known by everyone, no exception at all. */
const TAVERNEIRA = contact("act-taverneira", "Taverneira Ana", {
  general: KnowledgeState.Known,
});

const TABLE: readonly ContactActorDoc[] = [FOFURINHA, TOBIAS, FERREIRO, TAVERNEIRA];

/** Run one edit the way the server would, and read the pair back out. */
function afterEdit(doc: ContactActorDoc, edit: ActorKnowledgeEdit): KnowledgeMap {
  return applyKnowledgeEdit(readKnowledgeMap(doc), edit);
}

function rowOf(grid: ReturnType<typeof buildKnowledgeGrid>, id: string) {
  const row = grid.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`no row for "${id}"`);
  return row;
}

// ---------------------------------------------------------------------------
// The grid itself — REQ-CTT-061
// ---------------------------------------------------------------------------

describe("the grid is contacts by characters (REQ-CTT-061)", () => {
  it("REQ-CTT-061: rows are the contacts and columns are the table's characters", () => {
    const grid = buildKnowledgeGrid(TABLE);

    expect(grid.rows.map((row) => row.id)).toEqual([FERREIRO._id, TAVERNEIRA._id]);
    expect(grid.columns.map((column) => column.id)).toEqual([FOFURINHA._id, TOBIAS._id]);
  });

  it("REQ-CTT-061: a character of any system is a column, in pt-BR alphabetical order", () => {
    const grid = buildKnowledgeGrid([TOBIAS, BRUXA, FOFURINHA, FERREIRO]);

    // "Bruxa" before "Fofurinha" before "Tobias" — and the etmos `orador` is a
    // character just like the pf2e `character`.
    expect(grid.columns.map((column) => column.name)).toEqual([
      "Bruxa da Ponte",
      "Fofurinha",
      "Tobias",
    ]);
  });

  it("REQ-CTT-061: every row carries one cell per column, in the columns' order", () => {
    const grid = buildKnowledgeGrid(TABLE);
    const row = rowOf(grid, FERREIRO._id);

    expect(row.cells.map((cell) => cell.characterId)).toEqual(grid.columns.map((c) => c.id));
    expect(cellStateOf(row, TOBIAS._id)).toBe(KnowledgeState.Known);
    expect(cellStateOf(row, FOFURINHA._id)).toBe(KnowledgeState.Glimpsed);
  });

  it("REQ-CTT-061: a contact with no map at all reads hidden for everybody", () => {
    const grid = buildKnowledgeGrid([FOFURINHA, TOBIAS, contact("act-mendigo001", "Mendigo")]);
    const row = rowOf(grid, "act-mendigo001");

    expect(row.general).toBe(KnowledgeState.Hidden);
    expect(row.cells.every((cell) => cell.state === KnowledgeState.Hidden)).toBe(true);
    expect(row.cells.every((cell) => !cell.isException)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The cell — REQ-CTT-062
// ---------------------------------------------------------------------------

describe("a cell cycles the three states (REQ-CTT-062)", () => {
  it("REQ-CTT-062: the cycle is oculto → entrevisto → conhecido → oculto", () => {
    const grid = buildKnowledgeGrid(TABLE);
    let doc = contact("act-x", "X", { general: KnowledgeState.Hidden });
    const seen: number[] = [];

    for (let i = 0; i < 4; i += 1) {
      const row = rowOf(buildKnowledgeGrid([FOFURINHA, TOBIAS, doc]), "act-x");
      const next = afterEdit(doc, cellCycleEdit(row, TOBIAS._id));
      doc = { ...doc, flags: { fusion: { knowledge: next } } };
      seen.push(next.exceptions[TOBIAS._id] ?? next.general);
    }

    expect(seen).toEqual([
      KnowledgeState.Glimpsed,
      KnowledgeState.Known,
      KnowledgeState.Hidden,
      KnowledgeState.Glimpsed,
    ]);
    // The other column never moved.
    expect(grid.columns).toHaveLength(2);
  });

  it("REQ-CTT-062: a cell that overrides the general rule is marked as an exception", () => {
    const row = rowOf(buildKnowledgeGrid(TABLE), FERREIRO._id);

    expect(row.cells.every((cell) => cell.isException)).toBe(true);

    const plain = rowOf(buildKnowledgeGrid(TABLE), TAVERNEIRA._id);
    expect(plain.cells.every((cell) => cell.isException)).toBe(false);
    expect(plain.cells.every((cell) => cell.state === KnowledgeState.Known)).toBe(true);
  });

  it("REQ-CTT-062: cycling a cell back onto the general rule stops being an exception", () => {
    // Taverneira is `conhecido` for everybody. Cycling Tobias' cell three times
    // returns to `conhecido` — and the exception must be gone, not duplicated.
    let doc: ContactActorDoc = TAVERNEIRA;
    for (let i = 0; i < 3; i += 1) {
      const row = rowOf(buildKnowledgeGrid([FOFURINHA, TOBIAS, doc]), TAVERNEIRA._id);
      doc = {
        ...doc,
        flags: { fusion: { knowledge: afterEdit(doc, cellCycleEdit(row, TOBIAS._id)) } },
      };
    }

    const row = rowOf(buildKnowledgeGrid([FOFURINHA, TOBIAS, doc]), TAVERNEIRA._id);
    expect(cellStateOf(row, TOBIAS._id)).toBe(KnowledgeState.Known);
    expect(row.cells.every((cell) => !cell.isException)).toBe(true);
  });

  it("REQ-CTT-062: the cell edit never moves the general rule of the contact", () => {
    const row = rowOf(buildKnowledgeGrid(TABLE), FERREIRO._id);
    const next = afterEdit(FERREIRO, cellCycleEdit(row, FOFURINHA._id));

    expect(next.general).toBe(KnowledgeState.Hidden);
    expect(next.exceptions[TOBIAS._id]).toBe(KnowledgeState.Known);
  });
});

// ---------------------------------------------------------------------------
// The contact's name — REQ-CTT-063
// ---------------------------------------------------------------------------

describe("the contact's name cycles the general rule (REQ-CTT-063)", () => {
  it("REQ-CTT-063: the general rule advances and the whole row lines up on it", () => {
    const row = rowOf(buildKnowledgeGrid(TABLE), FERREIRO._id);
    const next = afterEdit(FERREIRO, rowCycleEdit(row));

    expect(next.general).toBe(KnowledgeState.Glimpsed);
    // The two exceptions that disagreed with it were discarded.
    expect(next.exceptions).toEqual({});

    const after = buildKnowledgeGrid([
      FOFURINHA,
      TOBIAS,
      { ...FERREIRO, flags: { fusion: { knowledge: next } } },
    ]);
    const alignedRow = rowOf(after, FERREIRO._id);
    expect(alignedRow.cells.map((cell) => cell.state)).toEqual([
      KnowledgeState.Glimpsed,
      KnowledgeState.Glimpsed,
    ]);
    expect(alignedRow.cells.every((cell) => !cell.isException)).toBe(true);
  });

  it("REQ-CTT-063: it touches one contact only — the edit names a single actor", () => {
    const row = rowOf(buildKnowledgeGrid(TABLE), FERREIRO._id);

    expect(rowCycleEdit(row).actorId).toBe(FERREIRO._id);
  });
});

// ---------------------------------------------------------------------------
// The character's name — REQ-CTT-064
// ---------------------------------------------------------------------------

describe("the character's name cycles the column (REQ-CTT-064)", () => {
  it("REQ-CTT-064: a mixed column is levelled at conhecido on the first activation", () => {
    const grid = buildKnowledgeGrid(TABLE);
    // Tobias knows the ferreiro and the taverneira... make it mixed on purpose.
    const mixed = columnStates(grid, FOFURINHA._id);
    expect(new Set(mixed).size).toBeGreaterThan(1);

    const edits = columnCycleEdits(grid, FOFURINHA._id);
    const states = edits.map(
      (edit) =>
        afterEdit(TABLE.find((doc) => doc._id === edit.actorId) as ContactActorDoc, edit)
          .exceptions[FOFURINHA._id] ??
        afterEdit(TABLE.find((doc) => doc._id === edit.actorId) as ContactActorDoc, edit).general,
    );

    expect(states).toEqual([KnowledgeState.Known, KnowledgeState.Known]);
  });

  it("REQ-CTT-064: a uniform column cycles from where it is", () => {
    expect(nextColumnState([KnowledgeState.Known, KnowledgeState.Known])).toBe(
      KnowledgeState.Hidden,
    );
    expect(nextColumnState([KnowledgeState.Hidden, KnowledgeState.Hidden])).toBe(
      KnowledgeState.Glimpsed,
    );
    expect(nextColumnState([KnowledgeState.Glimpsed])).toBe(KnowledgeState.Known);
  });

  it("REQ-CTT-064: the column moves every contact and no other character", () => {
    const grid = buildKnowledgeGrid(TABLE);
    const edits = columnCycleEdits(grid, FOFURINHA._id);

    expect(edits.map((edit) => edit.actorId).sort()).toEqual([FERREIRO._id, TAVERNEIRA._id].sort());
    for (const edit of edits) {
      expect(Object.keys(edit.exceptions ?? {})).toEqual([FOFURINHA._id]);
      expect(edit.general).toBeUndefined();
      expect(edit.clearExceptions).toBeUndefined();
    }

    // Tobias' column is untouched by Fofurinha's activation.
    const ferreiroAfter = afterEdit(FERREIRO, edits[0] as ActorKnowledgeEdit);
    expect(ferreiroAfter.exceptions[TOBIAS._id]).toBe(KnowledgeState.Known);
  });

  it("REQ-CTT-064: a table with no contact has nothing to cycle", () => {
    const grid = buildKnowledgeGrid([FOFURINHA, TOBIAS]);

    expect(columnCycleEdits(grid, TOBIAS._id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The general rule in text and the legend — REQ-CTT-065
// ---------------------------------------------------------------------------

describe("the general rule and the legend are readable (REQ-CTT-065)", () => {
  it("REQ-CTT-065: each row exposes the general rule in force, apart from the cells", () => {
    const grid = buildKnowledgeGrid(TABLE);

    expect(rowOf(grid, FERREIRO._id).general).toBe(KnowledgeState.Hidden);
    expect(rowOf(grid, TAVERNEIRA._id).general).toBe(KnowledgeState.Known);
    // The name and the title travel with the row, so the header cell can be read.
    expect(rowOf(grid, FERREIRO._id).title).toBe("Martelo Torto");
  });

  it("REQ-CTT-065: the three states have a label key each, so none is colour-only", () => {
    expect(Object.keys(KNOWLEDGE_STATE_KEYS)).toHaveLength(3);
    expect(KNOWLEDGE_STATE_KEYS[KnowledgeState.Hidden]).toContain("Hidden");
    expect(KNOWLEDGE_STATE_KEYS[KnowledgeState.Glimpsed]).toContain("Glimpsed");
    expect(KNOWLEDGE_STATE_KEYS[KnowledgeState.Known]).toContain("Known");
  });
});

// ---------------------------------------------------------------------------
// What the window cannot do — REQ-CTT-066
// ---------------------------------------------------------------------------

describe("the grid edits nothing but knowledge (REQ-CTT-066)", () => {
  it("REQ-CTT-066: every edit carries only knowledge fields, and one op type", () => {
    const grid = buildKnowledgeGrid(TABLE);
    const row = rowOf(grid, FERREIRO._id);
    const edits = [
      cellCycleEdit(row, TOBIAS._id),
      rowCycleEdit(row),
      ...columnCycleEdits(grid, TOBIAS._id),
    ];

    for (const edit of edits) {
      for (const key of Object.keys(edit)) {
        expect(["actorId", "general", "exceptions", "clearExceptions"]).toContain(key);
      }
    }
    expect(KNOWLEDGE_OP_TYPE).toBe("actor:setKnowledge");
    expect(knowledgeOpPayload(edits)).toEqual({ updates: edits });
  });
});
