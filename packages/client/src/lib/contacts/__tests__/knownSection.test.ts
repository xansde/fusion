/**
 * knownSection.test.ts — the Conhecidos section of the Contatos tab (spec 39 §5.5/§5.6, G064).
 *
 * Covers REQ-CTT-040 (who is listed), REQ-CTT-041 (a glimpsed contact has no name,
 * title or portrait and is marked as unidentified), REQ-CTT-042 (it offers neither
 * categorization nor sheet), REQ-CTT-043 (a hidden contact is in no list, no count,
 * no search and no indicator), REQ-CTT-044 (the Mestre sees how many know and how
 * many glimpsed), plus the section's order and blocks: REQ-CTT-016, REQ-CTT-012,
 * REQ-CTT-013, REQ-CTT-051 and REQ-CTT-053.
 *
 * The payloads below are written the way the server's redaction (G061) really hands
 * them over: the player's copy of a glimpsed contact carries `_id`, `type` and
 * `flags.fusion.glimpsed` and nothing else, and no player payload ever carries
 * `flags.fusion.knowledge` (REQ-CTT-084).
 */

import { describe, it, expect } from "vitest";
import { assignContactToCategory, createCategory, emptyContactCategories } from "../categories.js";
import {
  buildKnownSection,
  contactKnowledgeCounts,
  isKnownContact,
  type ContactActorDoc,
} from "../contactsVM.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALEX = "user-alex-000001";
const FOFURINHA = "act-fofurinha01";
const TOBIAS_PC = "act-tobias00001";

/** A player's character — the "Na mesa" population, never a row of Conhecidos. */
const FOFURINHA_DOC: ContactActorDoc = {
  _id: FOFURINHA,
  name: "Fofurinha",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
};

const TOBIAS_DOC: ContactActorDoc = {
  _id: TOBIAS_PC,
  name: "Tobias",
  type: "character",
  ownership: { default: 0, "user-tobias-0001": 3 },
};

/** A companion: it hangs inside its owner's card, so it is not a contact either. */
const GRAO: ContactActorDoc = {
  _id: "act-grao000001",
  name: "Grão",
  type: "familiar",
  system: { masterActorId: FOFURINHA },
};

/** A contact as the Mestre receives it: whole, knowledge map included. */
const FERREIRO_GM: ContactActorDoc = {
  _id: "act-ferreiro01",
  name: "Ferreiro de Otari",
  type: "npc",
  img: "worlds/x/ferreiro.webp",
  flags: {
    fusion: {
      title: "Martelo Torto",
      knowledge: { general: 0, exceptions: { [TOBIAS_PC]: 2, [FOFURINHA]: 1 } },
    },
  },
};

/** The same contact as the player who only glimpsed it receives it (REQ-CTT-081). */
const FERREIRO_GLIMPSED: ContactActorDoc = {
  _id: "act-ferreiro01",
  type: "npc",
  flags: { fusion: { glimpsed: true } },
};

/** A contact the player knows: full document, but with no knowledge map. */
const TAVERNEIRA: ContactActorDoc = {
  _id: "act-taverneira",
  name: "Taverneira Ana",
  type: "npc",
  img: "worlds/x/ana.webp",
  flags: { fusion: { title: "Dona do Cão Sonolento" } },
};

const BANDIDO: ContactActorDoc = {
  _id: "act-bandido001",
  name: "Bandido do Cais",
  type: "npc",
};

/** A hazard is a non-playable actor too, and pf2e/sf2e both declare it. */
const ARMADILHA: ContactActorDoc = {
  _id: "act-armadilha1",
  name: "Fosso de Estacas",
  type: "hazard",
};

/** Etmos names its non-playable actor `antagonista` (`systems/etmos/src/index.ts`). */
const ANTAGONISTA: ContactActorDoc = {
  _id: "act-antagonis1",
  name: "O Silêncio",
  type: "antagonista",
};

/**
 * The chest: pf2e declares the `loot` subtype, and spec 42 keeps it out of every
 * list, count and knowledge window (DEC-NPC-05, DEC-NPC-08). It reaches a player
 * through `ownership` alone — a party stash shared at OBSERVER.
 */
const BAU_DA_COMITIVA: ContactActorDoc = {
  _id: "act-bau0000001",
  name: "Estoque da Comitiva",
  type: "loot",
  ownership: { default: 2 },
};

// ---------------------------------------------------------------------------
// Who is listed — REQ-CTT-040
// ---------------------------------------------------------------------------

describe("who the Conhecidos section lists (REQ-CTT-040)", () => {
  it("REQ-CTT-040: the non-players that arrived, and neither characters nor companions", () => {
    const section = buildKnownSection({
      actors: [FOFURINHA_DOC, TOBIAS_DOC, GRAO, TAVERNEIRA, BANDIDO],
      isPrivileged: false,
    });

    const ids = section.groups.flatMap((group) => group.contacts.map((card) => card.id));
    expect(ids.sort()).toEqual(["act-bandido001", "act-taverneira"]);
    expect(section.total).toBe(2);
  });

  it("REQ-CTT-040: what arrived already is entrevisto or conhecido — no state is re-derived here", () => {
    // The client is never handed the hidden ones (REQ-CTT-082), so membership is a
    // property of the payload, not a filter the client could get wrong.
    expect(isKnownContact(TAVERNEIRA)).toBe(true);
    expect(isKnownContact(FERREIRO_GLIMPSED)).toBe(true);
    expect(isKnownContact(FOFURINHA_DOC)).toBe(false);
    expect(isKnownContact(GRAO)).toBe(false);
  });

  it("REQ-CTT-040: membership is an allow-list of non-playable subtypes, so the chest is not a contact", () => {
    // The section lists "os não-jogadores" — `npc`/`hazard` (spec 42 §3) and, in
    // Etmos, `antagonista`. `loot` is the chest, which DEC-NPC-08 keeps out of every
    // list and count; the complement of "is a character" would have filed it here.
    expect(isKnownContact(BANDIDO)).toBe(true);
    expect(isKnownContact(ARMADILHA)).toBe(true);
    expect(isKnownContact(ANTAGONISTA)).toBe(true);
    expect(isKnownContact(BAU_DA_COMITIVA)).toBe(false);

    const section = buildKnownSection({
      actors: [FOFURINHA_DOC, BAU_DA_COMITIVA, ARMADILHA, ANTAGONISTA],
      isPrivileged: false,
    });
    const ids = section.groups.flatMap((group) => group.contacts.map((card) => card.id));
    expect(ids.sort()).toEqual(["act-antagonis1", "act-armadilha1"]);
    expect(section.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The glimpsed contact — REQ-CTT-041 / REQ-CTT-042 / REQ-CTT-013
// ---------------------------------------------------------------------------

describe("a glimpsed contact is a row without an identity (REQ-CTT-041)", () => {
  it("REQ-CTT-041: no name, no title and no portrait, marked as unidentified", () => {
    const section = buildKnownSection({
      actors: [FOFURINHA_DOC, FERREIRO_GLIMPSED],
      isPrivileged: false,
    });
    const card = section.groups[0]?.contacts[0];

    expect(card?.identified).toBe(false);
    expect(card?.name).toBe("");
    expect(card?.img).toBeNull();
    expect(card?.title).toBeNull();
    expect(card?.conditions).toEqual([]);
  });

  it("REQ-CTT-042: it offers neither categorization nor sheet, and is not draggable", () => {
    const section = buildKnownSection({
      actors: [FERREIRO_GLIMPSED],
      isPrivileged: true,
    });
    const card = section.groups[0]?.contacts[0];

    expect(card?.canCategorize).toBe(false);
    expect(card?.canOpenSheet).toBe(false);
    expect(card?.category).toBeNull();
    // Even a privileged viewer gets no drag out of a row with no identity.
    expect(card?.draggable).toBe(false);
  });

  it("REQ-CTT-042: a stale association from before it was hidden files it nowhere", () => {
    let categories = createCategory(emptyContactCategories(), "Aliados");
    categories = assignContactToCategory(categories, "act-ferreiro01", "Aliados");

    const section = buildKnownSection({
      actors: [FERREIRO_GLIMPSED],
      isPrivileged: false,
      categories,
    });

    expect(section.groups.find((group) => group.name === "Aliados")?.contacts).toEqual([]);
    expect(section.groups.find((group) => group.name === null)?.contacts).toHaveLength(1);
  });

  it("REQ-CTT-013: it cannot be found by the name the Mestre knows", () => {
    const section = buildKnownSection({
      actors: [FERREIRO_GLIMPSED, TAVERNEIRA],
      isPrivileged: false,
      query: "ferreiro",
    });

    expect(section.total).toBe(0);
    expect(section.groups.flatMap((group) => group.contacts)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The hidden contact — REQ-CTT-043
// ---------------------------------------------------------------------------

describe("a hidden contact is nowhere in the tab (REQ-CTT-043)", () => {
  it("REQ-CTT-043: absent from the list, from the count and from the search", () => {
    // The player's payload simply does not contain it (REQ-CTT-082); the tab has no
    // second source it could count from.
    const section = buildKnownSection({
      actors: [FOFURINHA_DOC, TAVERNEIRA],
      isPrivileged: false,
    });

    expect(section.total).toBe(1);
    expect(JSON.stringify(section)).not.toContain("Ferreiro");

    const searched = buildKnownSection({
      actors: [FOFURINHA_DOC, TAVERNEIRA],
      isPrivileged: false,
      query: "ferreiro",
    });
    expect(searched.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The Mestre's counts — REQ-CTT-044
// ---------------------------------------------------------------------------

describe("the Mestre sees how many know and how many glimpsed (REQ-CTT-044)", () => {
  it("REQ-CTT-044: counts come from the knowledge map, over the characters on the table", () => {
    const section = buildKnownSection({
      actors: [FOFURINHA_DOC, TOBIAS_DOC, FERREIRO_GM],
      isPrivileged: true,
    });
    const card = section.groups[0]?.contacts[0];

    expect(card?.knowledge).toEqual({ known: 1, glimpsed: 1, characters: 2 });
  });

  it("REQ-CTT-044: the general rule answers for a character with no exception", () => {
    const doc: ContactActorDoc = {
      _id: "act-conhecido1",
      name: "Conhecido de todos",
      type: "npc",
      flags: { fusion: { knowledge: { general: 2, exceptions: {} } } },
    };

    expect(contactKnowledgeCounts(doc, [FOFURINHA, TOBIAS_PC])).toEqual({
      known: 2,
      glimpsed: 0,
      characters: 2,
    });
  });

  it("REQ-CTT-044: a payload without the map yields no counts at all (REQ-CTT-084)", () => {
    // A player never receives `flags.fusion.knowledge`, so the counts cannot be
    // rebuilt on his side even if the panel asked for them.
    expect(contactKnowledgeCounts(TAVERNEIRA, [FOFURINHA])).toBeNull();

    const section = buildKnownSection({
      actors: [FOFURINHA_DOC, FERREIRO_GM],
      isPrivileged: false,
    });
    expect(section.groups[0]?.contacts[0]?.knowledge).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Categories in the section — REQ-CTT-016 / REQ-CTT-012 / REQ-CTT-051 / REQ-CTT-053
// ---------------------------------------------------------------------------

describe("the blocks of the section follow the user (REQ-CTT-016)", () => {
  function seeded(): ReturnType<typeof emptyContactCategories> {
    let categories = emptyContactCategories();
    for (const name of ["Vilões", "Aliados"]) categories = createCategory(categories, name);
    categories = assignContactToCategory(categories, "act-taverneira", "Aliados");
    categories = assignContactToCategory(categories, "act-bandido001", "Vilões");
    return categories;
  }

  it("REQ-CTT-016: the user's order first, Sem categoria always last", () => {
    const section = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO, { _id: "act-mendigo001", name: "Mendigo", type: "npc" }],
      isPrivileged: false,
      categories: seeded(),
    });

    expect(section.groups.map((group) => group.name)).toEqual(["Vilões", "Aliados", null]);
  });

  it("REQ-CTT-016: inside a block the order is alphabetical in pt-BR", () => {
    let categories = createCategory(emptyContactCategories(), "Aliados");
    for (const id of ["act-taverneira", "act-bandido001", "act-alvaro0001"]) {
      categories = assignContactToCategory(categories, id, "Aliados");
    }

    const section = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO, { _id: "act-alvaro0001", name: "Álvaro", type: "npc" }],
      isPrivileged: false,
      categories,
    });

    expect(section.groups[0]?.contacts.map((card) => card.name)).toEqual([
      "Álvaro",
      "Bandido do Cais",
      "Taverneira Ana",
    ]);
  });

  it("REQ-CTT-051: the card reports the one category it was filed under", () => {
    const section = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO],
      isPrivileged: false,
      categories: seeded(),
    });

    const cards = section.groups.flatMap((group) =>
      group.contacts.map((card) => [card.id, card.category] as const),
    );
    expect(Object.fromEntries(cards)).toEqual({
      "act-taverneira": "Aliados",
      "act-bandido001": "Vilões",
    });
  });

  it("REQ-CTT-053: Sem categoria appears only when it holds somebody", () => {
    const filed = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO],
      isPrivileged: false,
      categories: seeded(),
    });
    expect(filed.groups.map((group) => group.name)).toEqual(["Vilões", "Aliados"]);

    const loose = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO, { _id: "act-mendigo001", name: "Mendigo", type: "npc" }],
      isPrivileged: false,
      categories: seeded(),
    });
    expect(loose.groups.at(-1)?.name).toBeNull();
  });

  it("REQ-CTT-012: a block a search emptied disappears and comes back when the field is cleared", () => {
    const categories = seeded();
    const searching = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO],
      isPrivileged: false,
      categories,
      query: "taverneira",
    });
    expect(searching.groups.map((group) => group.name)).toEqual(["Aliados"]);

    const cleared = buildKnownSection({
      actors: [TAVERNEIRA, BANDIDO],
      isPrivileged: false,
      categories,
      query: "",
    });
    expect(cleared.groups.map((group) => group.name)).toEqual(["Vilões", "Aliados"]);
  });

  it("REQ-CTT-028: only a privileged role gets a draggable contact", () => {
    const asPlayer = buildKnownSection({ actors: [TAVERNEIRA], isPrivileged: false });
    const asGm = buildKnownSection({ actors: [TAVERNEIRA], isPrivileged: true });

    expect(asPlayer.groups[0]?.contacts[0]?.draggable).toBe(false);
    expect(asGm.groups[0]?.contacts[0]?.draggable).toBe(true);
  });
});
