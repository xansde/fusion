/**
 * Reading a journal entry as a quest — DEC-HUB-04/05/06, REQ-HUB-021..033.
 *
 * The reading is DERIVED, never stored, and that is the property worth
 * protecting: it is what makes the GM's "ver como <jogador>" preview exact
 * rather than approximate. So every case here is phrased as "what does this
 * player's board look like", and the same functions are asked the question for
 * two different players against the same document.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "../document.js";
import { createJournalPage } from "../journal.js";
import {
  isQuest,
  isQuestDone,
  pageRole,
  isObjectiveDone,
  objectivePois,
  objectivesOf,
  questReadingFor,
  readablePages,
  pageCellFor,
  nextLevelForTable,
  type QuestEntry,
} from "../quest.js";

const HOOK = "hhhhhhhhhhhhhhhh";
const RUMOUR = "rrrrrrrrrrrrrrrr";
const OBJ_1 = "1111111111111111";
const OBJ_2 = "2222222222222222";
const OBJ_3 = "3333333333333333";

function hub(fields: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return { fusion: { hub: fields } };
}

/**
 * "Cães da Estrada" exactly as the design document draws it: Tobias has the
 * quest and two of three objectives, Comedor has only the rumour, and Íris has
 * nothing at all.
 */
function caesDaEstrada(): QuestEntry {
  return {
    _id: "qqqqqqqqqqqqqqqq",
    name: "Cães da Estrada",
    ownership: { default: OwnershipLevel.NONE },
    flags: hub({ kind: "quest", pois: ["pppppppppppppppp"] }),
    pages: [
      createJournalPage(HOOK, {
        name: "Gancho",
        sort: 0,
        flags: hub({ role: "hook" }),
        ownership: { tobias: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(RUMOUR, {
        name: "Boato",
        sort: 1,
        flags: hub({ role: "rumour" }),
        ownership: { comedor: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(OBJ_1, {
        name: "Pista do curral",
        sort: 2,
        flags: hub({ done: true, pois: ["pppppppppppppppp"] }),
        ownership: { tobias: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(OBJ_2, {
        name: "A coisa na neblina",
        sort: 3,
        flags: hub({ pois: ["nnnnnnnnnnnnnnnn"] }),
        ownership: { tobias: OwnershipLevel.OBSERVER },
      }),
      createJournalPage(OBJ_3, {
        name: "Voltar e cobrar do xerife",
        sort: 4,
        ownership: { default: OwnershipLevel.NONE },
      }),
    ],
  };
}

describe("questReadingFor", () => {
  it("puts the quest on the board for the player who has the hook", () => {
    expect(questReadingFor(caesDaEstrada(), "tobias")).toBe("published");
  });

  it("leaves the player who only heard the rumour under boatos", () => {
    expect(questReadingFor(caesDaEstrada(), "comedor")).toBe("rumour");
  });

  it("does not exist at all for the player who has neither", () => {
    expect(questReadingFor(caesDaEstrada(), "iris")).toBe("hidden");
  });

  it("publishes on an objective alone — a quest can start mid-trail", () => {
    const entry = caesDaEstrada();
    entry.pages = entry.pages.filter((p) => p._id !== HOOK);

    expect(questReadingFor(entry, "tobias")).toBe("published");
  });

  it("reads whole for the GM without consulting a single ownership map", () => {
    expect(questReadingFor(caesDaEstrada(), "anyone", true)).toBe("published");
  });

  it("gives the same answer on a redacted copy as on the full document", () => {
    // This is the property behind "ver como <jogador>" (REQ-HUB-033): the
    // server ships Comedor an entry with one page, and asking the question
    // there must produce what the GM's preview promised.
    const full = caesDaEstrada();
    const asShipped: QuestEntry = {
      ...full,
      pages: readablePages(full, "comedor"),
    };

    expect(questReadingFor(asShipped, "comedor")).toBe("rumour");
  });
});

describe("readablePages", () => {
  it("hands the player their pages in the GM's order and no others", () => {
    const pages = readablePages(caesDaEstrada(), "tobias");

    expect(pages.map((p) => p.name)).toEqual(["Gancho", "Pista do curral", "A coisa na neblina"]);
  });

  it("never leaks the unrevealed objective's title", () => {
    const pages = readablePages(caesDaEstrada(), "comedor");

    expect(JSON.stringify(pages)).not.toContain("xerife");
  });
});

describe("objectives", () => {
  it("lists objectives in order, hook and rumour excluded", () => {
    expect(objectivesOf(caesDaEstrada()).map((p) => p.name)).toEqual([
      "Pista do curral",
      "A coisa na neblina",
      "Voltar e cobrar do xerife",
    ]);
  });

  it("treats an unmarked page as an objective", () => {
    const page = createJournalPage(OBJ_3, { name: "Sem papel declarado" });

    expect(pageRole(page)).toBe("objective");
  });

  it("carries done for the table and places per objective", () => {
    const entry = caesDaEstrada();
    const [first, second] = objectivesOf(entry);

    expect(isObjectiveDone(first!)).toBe(true);
    expect(isObjectiveDone(second!)).toBe(false);
    // Two objectives, two different places — that is the point of per-objective
    // POIs: the party is sent to the one this step is about.
    expect(objectivePois(first!)).toEqual(["pppppppppppppppp"]);
    expect(objectivePois(second!)).toEqual(["nnnnnnnnnnnnnnnn"]);
  });

  it("lets an objective name no place at all", () => {
    expect(objectivePois(objectivesOf(caesDaEstrada())[2]!)).toEqual([]);
  });
});

describe("the matrix", () => {
  it("shows two states per cell and folds `limited` into hidden", () => {
    const entry = caesDaEstrada();
    const objective = objectivesOf(entry)[1]!;
    const halfway = createJournalPage(OBJ_2, {
      ownership: { comedor: OwnershipLevel.LIMITED },
    });

    expect(pageCellFor(objective, entry, "tobias")).toBe("revealed");
    expect(pageCellFor(objective, entry, "comedor")).toBe("hidden");
    // There is no half-revealed page: `limited` is not a cell of its own.
    expect(pageCellFor(halfway, entry, "comedor")).toBe("hidden");
  });

  it("offers `todos` while anyone is behind, and nothing once all are level", () => {
    const entry = caesDaEstrada();
    const objective = objectivesOf(entry)[1]!;

    expect(nextLevelForTable(objective, entry, ["tobias", "comedor"])).toBe(
      OwnershipLevel.OBSERVER,
    );
    // Nobody behind → no step to offer, which is how "never demotes" is
    // expressed: there is simply no action to take (REQ-HUB-031).
    expect(nextLevelForTable(objective, entry, ["tobias"])).toBeNull();
  });
});

describe("the entry itself", () => {
  it("is only a quest when it says so", () => {
    expect(isQuest(caesDaEstrada())).toBe(true);
    expect(isQuest({ flags: { fusion: { hub: {} } } })).toBe(false);
    expect(isQuest({})).toBe(false);
  });

  it("survives a malformed flag tree instead of throwing", () => {
    expect(isQuest({ flags: { fusion: null as never } })).toBe(false);
    expect(isQuestDone({ flags: {} })).toBe(false);
  });
});
