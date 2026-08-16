/**
 * npcKnowledge.test.ts — knowledge as the NPCs tab is allowed to touch it (G077).
 *
 * Covers REQ-NPC-070 (the row says how many know and how many glimpsed, in reading),
 * REQ-NPC-071 (no line offers a control that alters knowledge), REQ-NPC-072 (the
 * footer opens the SAME window of the Contatos tab — one window, one model) and
 * REQ-NPC-073 (an edit made through it travels the one op, whichever tab opened it).
 *
 * The counts are never compared against a table this tab wrote: the fixtures carry a
 * knowledge MAP (a general rule plus exceptions) and the assertions are on the
 * counts the shared state machine derives from it, which is the same derivation the
 * server applies.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  NPC_KNOWLEDGE_COUNTS_KEY,
  NPC_KNOWLEDGE_LABEL_KEY,
  describeNpcKnowledge,
  npcKnowledgeCounts,
  playerCharacterIds,
} from "../npcKnowledge.js";
import { buildNpcRows } from "../npcRowVM.js";
import { KNOWLEDGE_OP_TYPE } from "../../contacts/knowledgeGrid.js";
import { KNOWLEDGE_WINDOW_KEY, knowledgeWindowOptions } from "../../contacts/knowledgeWindow.js";
import { KnowledgeState } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures — three characters, and a ferreiro two of them know
// ---------------------------------------------------------------------------

const FOFURINHA = { _id: "act-fofurinha01x", name: "Fofurinha", type: "character" };
const TOBIAS = { _id: "act-tobias00001x", name: "Tobias", type: "character" };
const ELARA = { _id: "act-elara000001x", name: "Elara", type: "character" };

/**
 * General rule `entrevisto`, with two characters raised to `conhecido`: 2 know, 1
 * glimpsed. The exceptions are what makes the count a derivation instead of a copy.
 */
const FERREIRO = {
  _id: "act-ferreiro001",
  name: "Ferreiro",
  type: "npc",
  flags: {
    fusion: {
      knowledge: {
        general: KnowledgeState.Glimpsed,
        exceptions: {
          [FOFURINHA._id]: KnowledgeState.Known,
          [TOBIAS._id]: KnowledgeState.Known,
        },
      },
    },
  },
};

/** The same actor as a player receives it: the map is stripped (REQ-NPC-083). */
const FERREIRO_REDACTED = { _id: "act-ferreiro001", name: "Ferreiro", type: "npc" };

const ACTORS = [FOFURINHA, TOBIAS, ELARA, FERREIRO];

const SOURCE = readFileSync(fileURLToPath(new URL("../npcKnowledge.ts", import.meta.url)), "utf8");

// ---------------------------------------------------------------------------

describe("REQ-NPC-070: the row says how many know and how many glimpsed", () => {
  it("REQ-NPC-070: counts every character of the table through the shared state machine", () => {
    const counts = npcKnowledgeCounts(FERREIRO, playerCharacterIds(ACTORS));

    expect(counts).toEqual({ known: 2, glimpsed: 1, characters: 3 });
  });

  it("REQ-NPC-070: only characters are counted — a non-playable is never a column", () => {
    // The ferreiro himself, and a hazard, are in the payload and in no denominator.
    const ids = playerCharacterIds([...ACTORS, { _id: "act-armadilha001", type: "hazard" }]);

    expect(ids).toEqual([FOFURINHA._id, TOBIAS._id, ELARA._id]);
  });

  it("REQ-NPC-070: with no knowledge map there are no counts at all, not a zero", () => {
    expect(npcKnowledgeCounts(FERREIRO_REDACTED, playerCharacterIds(ACTORS))).toBeNull();
    expect(describeNpcKnowledge(null)).toBeNull();
  });

  it("REQ-NPC-070: the counts reach the row of the tab, in reading", () => {
    const rows = buildNpcRows({ actors: ACTORS, isPrivileged: true });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.knowledge).toEqual({ known: 2, glimpsed: 1, characters: 3 });
  });

  it("REQ-NPC-070: the label is built from the counts, with both numbers", () => {
    const label = describeNpcKnowledge({ known: 2, glimpsed: 1, characters: 3 });

    expect(label).toEqual({
      textKey: NPC_KNOWLEDGE_COUNTS_KEY,
      labelKey: NPC_KNOWLEDGE_LABEL_KEY,
      vars: { known: 2, glimpsed: 1 },
    });
  });

  it("REQ-NPC-070: a seat that never received the map draws nothing (REQ-NPC-083)", () => {
    const rows = buildNpcRows({
      actors: [FOFURINHA, TOBIAS, ELARA, FERREIRO_REDACTED],
      isPrivileged: true,
    });

    expect(rows[0]?.knowledge).toBeNull();
  });

  it("REQ-NPC-070: a non-privileged seat gets no counts even if a map leaked in", () => {
    const rows = buildNpcRows({ actors: ACTORS, isPrivileged: false });

    expect(rows[0]?.knowledge).toBeNull();
  });
});

describe("REQ-NPC-071: nothing on the row can alter knowledge", () => {
  it("REQ-NPC-071: the module writes nothing — no op, no socket, no edit", () => {
    expect(SOURCE).not.toContain(KNOWLEDGE_OP_TYPE);
    expect(SOURCE).not.toContain("doc:update");
    expect(SOURCE).not.toContain("emit");
    expect(SOURCE).not.toContain("socket");
  });

  it("REQ-NPC-071: the row carries the counts and no way to move them", () => {
    const row = buildNpcRows({ actors: ACTORS, isPrivileged: true })[0];

    // Nothing callable anywhere in the row: a shape with no function in it cannot
    // offer a control, whatever the panel decides to draw.
    const callables = JSON.stringify(row, (_key, value: unknown) =>
      typeof value === "function" ? "FUNCTION" : value,
    );
    expect(callables).not.toContain("FUNCTION");
    expect(row?.knowledge?.known).toBe(2);
  });
});

describe("REQ-NPC-072 / REQ-NPC-073: one window, one model, one op", () => {
  it("REQ-NPC-072: the NPCs footer opens the Contatos tab's window, under its key", () => {
    const options = knowledgeWindowOptions({} as never);

    expect(options.singletonKey).toBe(KNOWLEDGE_WINDOW_KEY);
    expect(KNOWLEDGE_WINDOW_KEY).toBe("contacts:knowledge");
    // The component is the 39's window itself, not a copy declared by this tab.
    expect(options.component).toBeDefined();
  });

  it("REQ-NPC-072: this tab declares no second knowledge model of its own", () => {
    // The counting function is the 39's, imported; the state machine is the shared
    // one. Neither is re-implemented here, so the two tabs cannot drift.
    expect(SOURCE).toContain("contactKnowledgeCounts");
    expect(SOURCE).not.toContain("exceptions");
    expect(SOURCE).not.toContain("general:");
  });

  it("REQ-NPC-073: the only op that alters knowledge is the 39's, whoever opened it", () => {
    // The NPCs tab reaches knowledge through the window and nowhere else: no module
    // of this tab names the op, so there is no second path an edit could take.
    expect(KNOWLEDGE_OP_TYPE).toBe("actor:setKnowledge");
    expect(SOURCE).not.toContain(KNOWLEDGE_OP_TYPE);
  });
});
