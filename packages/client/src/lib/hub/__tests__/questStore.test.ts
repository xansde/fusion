/**
 * The board each viewer gets — REQ-HUB-021..024, REQ-HUB-033.
 *
 * `buildBoard` is where three specs meet: what a player sees, what the GM
 * sees, and what the GM sees when previewing a player. The third is the one
 * that has to be exact rather than approximate, so it is tested against the
 * same documents as the first — a preview that disagreed with the real board
 * would be worse than no preview at all.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel, createJournalPage, type QuestEntry } from "@fusion/shared";
import { buildBoard, splitBoard } from "../questStore.svelte.js";

const HOOK = "hhhhhhhhhhhhhhhh";
const RUMOUR = "rrrrrrrrrrrrrrrr";
const OBJ_1 = "1111111111111111";
const OBJ_2 = "2222222222222222";

function hub(fields: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return { fusion: { hub: fields } };
}

function caesDaEstrada(): QuestEntry {
  return {
    _id: "qqqqqqqqqqqqqqqq",
    name: "Cães da Estrada",
    ownership: { default: OwnershipLevel.OBSERVER },
    flags: hub({ kind: "quest", pois: ["pppppppppppppppp"] }),
    pages: [
      createJournalPage(HOOK, {
        name: "Gancho",
        sort: 0,
        flags: hub({ role: "hook" }),
        ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(RUMOUR, {
        name: "Boato",
        sort: 1,
        flags: hub({ role: "rumour" }),
        ownership: { default: OwnershipLevel.NONE, comedor: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(OBJ_1, {
        name: "Pista do curral",
        sort: 2,
        flags: hub({ done: true }),
        ownership: { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(OBJ_2, {
        name: "Voltar e cobrar do xerife",
        sort: 3,
        ownership: { default: OwnershipLevel.NONE },
      }),
    ],
  };
}

/** A journal entry that is not a quest — a place description, say. */
function ordinaryEntry(): QuestEntry {
  return {
    _id: "jjjjjjjjjjjjjjjj",
    name: "Godford",
    ownership: { default: OwnershipLevel.OBSERVER },
    pages: [createJournalPage(HOOK, { name: "A vila", ownership: {} })],
  };
}

describe("buildBoard", () => {
  it("shows the player who has the hook a published quest with their objectives", () => {
    const [view] = buildBoard([caesDaEstrada()], "tobias", false);

    expect(view?.reading).toBe("published");
    expect(view?.hook?.name).toBe("Gancho");
    expect(view?.objectives.map((o) => o.name)).toEqual(["Pista do curral"]);
    expect(view?.rumour).toBeNull();
  });

  it("shows the player who only heard the rumour no title and no objectives", () => {
    const [view] = buildBoard([caesDaEstrada()], "comedor", false);

    expect(view?.reading).toBe("rumour");
    expect(view?.rumour?.name).toBe("Boato");
    expect(view?.hook).toBeNull();
    expect(view?.objectives).toEqual([]);
  });

  it("gives the player who has neither nothing to draw at all", () => {
    expect(buildBoard([caesDaEstrada()], "iris", false)).toEqual([]);
  });

  it("never lets an unrevealed objective's title reach the board", () => {
    const board = buildBoard([caesDaEstrada()], "tobias", false);

    expect(JSON.stringify(board)).not.toContain("xerife");
  });

  it("hands the GM every page of every quest", () => {
    const [view] = buildBoard([caesDaEstrada()], "gm", true);

    expect(view?.objectives.map((o) => o.name)).toEqual([
      "Pista do curral",
      "Voltar e cobrar do xerife",
    ]);
  });

  it("previews a player's board exactly, from the GM's own documents", () => {
    // REQ-HUB-033. The GM holds the complete entry; asking for Comedor's board
    // must produce what Comedor actually has, down to the missing objectives.
    const asComedorSees = buildBoard([caesDaEstrada()], "comedor", false);
    const gmPreviewingComedor = buildBoard([caesDaEstrada()], "comedor", false);

    expect(gmPreviewingComedor).toEqual(asComedorSees);
    expect(gmPreviewingComedor[0]?.reading).toBe("rumour");
  });

  it("keeps ordinary journal entries off the board", () => {
    expect(buildBoard([ordinaryEntry()], "tobias", false)).toEqual([]);
  });

  it("carries the quest's own places through for `rastrear no mapa`", () => {
    const [view] = buildBoard([caesDaEstrada()], "tobias", false);

    expect(view?.pois).toEqual(["pppppppppppppppp"]);
  });
});

describe("splitBoard", () => {
  it("separates what is on the board from what is still hearsay", () => {
    const quest = caesDaEstrada();
    const { published, rumours } = splitBoard([
      ...buildBoard([quest], "tobias", false),
      ...buildBoard([quest], "comedor", false),
    ]);

    expect(published).toHaveLength(1);
    expect(rumours).toHaveLength(1);
  });
});
