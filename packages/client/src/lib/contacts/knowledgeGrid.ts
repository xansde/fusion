/**
 * knowledgeGrid.ts — the "Quem conhece quem" grid (spec 39 §5.7).
 *
 * Contacts are the rows, the table's characters are the columns, and each cell
 * is the state of that pair (REQ-CTT-061). Everything here is pure: it turns the
 * Actor documents the mirror already holds into a grid, and turns an activation
 * (a cell, a contact's name, a character's name) into the `actor:setKnowledge`
 * edits that ask the SERVER to change it. Nothing in this module writes, and
 * nothing here re-implements the model — the state machine lives in
 * `@fusion/shared/knowledge.ts` and is the same one the server applies
 * (REQ-CTT-070/072).
 *
 * Three activations, three shapes of edit:
 *
 *  - **cell** (REQ-CTT-062) — cycles that ONE pair, `oculto → entrevisto →
 *    conhecido`, by writing an exception for that character. When the next state
 *    happens to equal the contact's general rule the server's normalization
 *    removes the exception instead of duplicating it, so "cycling back onto the
 *    general rule" quietly stops being an exception — which is exactly what
 *    `isException` then stops drawing.
 *  - **contact name** (REQ-CTT-063) — cycles the GENERAL RULE and drops every
 *    exception of that contact, which is what "alinhar a linha inteira" means:
 *    after it, the whole row reads the same state.
 *  - **character name** (REQ-CTT-064) — cycles that character's column across
 *    every contact; a column with mixed states is levelled at `conhecido` on the
 *    first activation, and only then starts cycling.
 *
 * The grid never creates, deletes or edits an actor (REQ-CTT-066): the only op
 * it can produce is `actor:setKnowledge`, and the only field it can move is the
 * knowledge map.
 */

import {
  KnowledgeState,
  cycleKnowledgeState,
  readKnowledgeMap,
  resolveKnowledgeFromMap,
  type ActorKnowledgeEdit,
  type KnowledgeMap,
} from "@fusion/shared";

import {
  isGlimpsedContact,
  isKnownContact,
  isPlayerCharacter,
  readContactTitle,
  type ContactActorDoc,
} from "./contactsVM.js";

// ---------------------------------------------------------------------------
// Shape of the grid
// ---------------------------------------------------------------------------

/** The single op this window can send. Nothing else is reachable from it. */
export const KNOWLEDGE_OP_TYPE = "actor:setKnowledge";

/** i18n keys of the three states — the legend and every cell label read these. */
export const KNOWLEDGE_STATE_KEYS: Readonly<Record<KnowledgeState, string>> = {
  [KnowledgeState.Hidden]: "FUSION.Contacts.Knowledge.State.Hidden",
  [KnowledgeState.Glimpsed]: "FUSION.Contacts.Knowledge.State.Glimpsed",
  [KnowledgeState.Known]: "FUSION.Contacts.Knowledge.State.Known",
};

/** One column: a character of the table (REQ-CTT-061). */
export interface KnowledgeGridColumn {
  readonly id: string;
  readonly name: string;
}

/** One cell: what a character knows about a contact. */
export interface KnowledgeGridCell {
  readonly characterId: string;
  readonly state: KnowledgeState;
  /**
   * The pair carries an exception of its own, instead of reading the contact's
   * general rule (REQ-CTT-062, REQ-CTT-072). The window draws the two
   * differently — this is the flag it styles on.
   */
  readonly isException: boolean;
}

/** One row: a contact, its general rule in force, and its cells. */
export interface KnowledgeGridRow {
  readonly id: string;
  /** The contact's name, or "" when the document has none. */
  readonly name: string;
  /** The free title under the name, or "" (REQ-CTT-023). */
  readonly title: string;
  /** The rule that applies to every character without an exception (REQ-CTT-065). */
  readonly general: KnowledgeState;
  readonly cells: readonly KnowledgeGridCell[];
}

export interface KnowledgeGrid {
  readonly columns: readonly KnowledgeGridColumn[];
  readonly rows: readonly KnowledgeGridRow[];
}

// ---------------------------------------------------------------------------
// Building it
// ---------------------------------------------------------------------------

function nameOf(doc: ContactActorDoc): string {
  return typeof doc.name === "string" ? doc.name : "";
}

function byName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const byLabel = a.name.localeCompare(b.name, "pt-BR");
  return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id, "pt-BR");
}

/**
 * Build the grid from every Actor the client holds.
 *
 * Rows are the contacts (REQ-CTT-040's population, minus nobody: this window is
 * the Mestre's, and the Mestre receives them all), columns are the characters of
 * the table. A glimpsed row cannot appear here — the window only exists for a
 * privileged role, whose payload is never redacted (REQ-CTT-084) — but the
 * filter is explicit anyway, so a leaked payload cannot turn into an editable
 * row with no name.
 */
export function buildKnowledgeGrid(actors: readonly ContactActorDoc[]): KnowledgeGrid {
  const columns: KnowledgeGridColumn[] = actors
    .filter(isPlayerCharacter)
    .map((doc) => ({ id: doc._id, name: nameOf(doc) }))
    .sort(byName);

  const rows: KnowledgeGridRow[] = actors
    .filter((doc) => isKnownContact(doc) && !isGlimpsedContact(doc))
    .map((doc) => rowOf(doc, columns))
    .sort(byName);

  return { columns, rows };
}

function rowOf(doc: ContactActorDoc, columns: readonly KnowledgeGridColumn[]): KnowledgeGridRow {
  const map: KnowledgeMap = readKnowledgeMap(doc);
  return {
    id: doc._id,
    name: nameOf(doc),
    title: readContactTitle(doc),
    general: map.general,
    cells: columns.map((column) => ({
      characterId: column.id,
      state: resolveKnowledgeFromMap(map, column.id),
      isException: Object.prototype.hasOwnProperty.call(map.exceptions, column.id),
    })),
  };
}

/** The state of one pair, or the general rule when the column is unknown. */
export function cellStateOf(row: KnowledgeGridRow, characterId: string): KnowledgeState {
  const cell = row.cells.find((candidate) => candidate.characterId === characterId);
  return cell?.state ?? row.general;
}

/** Every state in one column, top to bottom — what the column cycle reads. */
export function columnStates(grid: KnowledgeGrid, characterId: string): readonly KnowledgeState[] {
  return grid.rows.map((row) => cellStateOf(row, characterId));
}

// ---------------------------------------------------------------------------
// The three activations (REQ-CTT-062/063/064)
// ---------------------------------------------------------------------------

/**
 * Cycle one pair (REQ-CTT-062).
 *
 * Written as an exception on purpose: a cell is about ONE character, and moving
 * the general rule here would silently move every other character of the row.
 */
export function cellCycleEdit(row: KnowledgeGridRow, characterId: string): ActorKnowledgeEdit {
  const next = cycleKnowledgeState(cellStateOf(row, characterId));
  return { actorId: row.id, exceptions: { [characterId]: next } };
}

/**
 * Cycle a contact's general rule and align its whole row (REQ-CTT-063).
 *
 * `clearExceptions` is what "alinhar a linha inteira" means literally: the
 * exceptions are discarded, so after the edit every character reads the new
 * general rule.
 */
export function rowCycleEdit(row: KnowledgeGridRow): ActorKnowledgeEdit {
  return { actorId: row.id, general: cycleKnowledgeState(row.general), clearExceptions: true };
}

/**
 * The state a column moves to when its header is activated (REQ-CTT-064):
 * a mixed column levels at `conhecido`; a uniform one cycles from where it is.
 * An empty column (no contact at all) has nothing to move, so it stays hidden.
 */
export function nextColumnState(states: readonly KnowledgeState[]): KnowledgeState {
  const first = states[0];
  if (first === undefined) return KnowledgeState.Hidden;
  const uniform = states.every((state) => state === first);
  return uniform ? cycleKnowledgeState(first) : KnowledgeState.Known;
}

/**
 * Cycle one character across every contact (REQ-CTT-064).
 *
 * One edit per contact, all in a single batch, so the clients receive one delta
 * instead of N. Each edit writes an exception for that character only: the
 * column is about one character, and the other columns must not move.
 */
export function columnCycleEdits(
  grid: KnowledgeGrid,
  characterId: string,
): readonly ActorKnowledgeEdit[] {
  if (grid.rows.length === 0) return [];
  const target = nextColumnState(columnStates(grid, characterId));
  return grid.rows.map((row) => ({ actorId: row.id, exceptions: { [characterId]: target } }));
}

/** The op envelope payload for a batch of edits — the only op this window sends. */
export function knowledgeOpPayload(edits: readonly ActorKnowledgeEdit[]): {
  readonly updates: readonly ActorKnowledgeEdit[];
} {
  return { updates: edits };
}
