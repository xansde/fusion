/**
 * contactsVM.test.ts — the rules of the Contatos panel (spec 39 §5.2/§5.3, G062).
 *
 * Covers the header and order block — REQ-CTT-010 (the panel is a search bar and
 * nothing else), REQ-CTT-011 (name and title, in the client), REQ-CTT-012 (an
 * emptied category disappears while the search lasts), REQ-CTT-013 (a glimpsed
 * contact cannot be found by name), REQ-CTT-014 (own characters first, then
 * `localeCompare` pt-BR), REQ-CTT-015 (presence never moves a card) and
 * REQ-CTT-016 (the user's own category order, "Sem categoria" last) — and the
 * "Na mesa" block: REQ-CTT-020 (what a card carries), REQ-CTT-021 (no hit points
 * for any role), REQ-CTT-022 (own character distinguishable), REQ-CTT-023 (title
 * and its fallback), REQ-CTT-024/REQ-CTT-085 (who may rewrite the title),
 * REQ-CTT-025/026 (sub-characters inside the owner's card) and REQ-CTT-028
 * (only a privileged role drags a card to the map).
 *
 * Every assertion is written against hand-built documents and the rule as spec 39
 * states it — never against the module's own output fed back to itself.
 */

import { describe, expect, it } from "vitest";
import { pf2eSystem } from "@fusion/system-pf2e";
import { sf2eSystem } from "@fusion/system-sf2e";

import {
  buildContactConditions,
  buildTableSection,
  canDragContactToCanvas,
  canEditContactTitle,
  contactTitleDiff,
  CONTACT_TITLE_FLAG_PATH,
  isContactPresent,
  isGlimpsedContact,
  isNonPlayableActor,
  isPlayerCharacter,
  isSubCharacter,
  matchesContactQuery,
  orderContactCategories,
  ownsContact,
  readActiveConditions,
  resolveTitleLine,
  systemIdentityLine,
  visibleContactCategories,
  type ContactActorDoc,
} from "../contactsVM.js";
import type { ConditionDisplayContract } from "../../conditions/conditionView.js";

// ---------------------------------------------------------------------------
// Fixtures — one table: two players, a GM, a familiar and an NPC
// ---------------------------------------------------------------------------

const ALEX = "user-alex-000001";
const TOBIAS = "user-tobias-0001";
const GM = "user-gm-00000001";

function actor(doc: Partial<ContactActorDoc> & { _id: string }): ContactActorDoc {
  return { type: "character", name: "Sem nome", ...doc };
}

/** Fofurinha — Alexandre's druid, with a title, a familiar and two conditions. */
const FOFURINHA: ContactActorDoc = actor({
  _id: "act-fofurinha01",
  name: "Fofurinha",
  img: "worlds/x/fofurinha.webp",
  ownership: { default: 0, [ALEX]: 3 },
  flags: { fusion: { title: "A Voz do Bosque" } },
  system: {
    details: { class: "Druida", level: 5 },
    // Hit points sit right here in the document on purpose — REQ-CTT-021 is only
    // proven if the view model had something to leak and did not.
    attributes: { hp: { value: 31, max: 44 } },
  },
  items: [
    {
      _id: "it-1",
      type: "condition",
      name: "Amedrontado",
      system: { slug: "frightened", value: 2 },
    },
    { _id: "it-2", type: "condition", name: "Escondido", system: { slug: "hidden" } },
    { _id: "it-3", type: "feat", name: "Sentido Aguçado" },
  ],
});

/** Grão — Fofurinha's familiar. Never a row of its own (REQ-CTT-025). */
const GRAO: ContactActorDoc = actor({
  _id: "act-grao000001",
  name: "Grão",
  type: "familiar",
  ownership: { default: 0, [ALEX]: 3 },
  system: { masterActorId: "act-fofurinha01", companionKind: "familiar" },
  items: [
    { _id: "it-4", type: "condition", name: "Morrendo", system: { slug: "dying", value: 1 } },
  ],
});

/** Tobias — another player's fighter, no title of his own. */
const TOBIAS_PC: ContactActorDoc = actor({
  _id: "act-tobias00001",
  name: "Tobias",
  ownership: { default: 0, [TOBIAS]: 3 },
  system: { details: { class: "Guerreiro", level: 5 } },
});

/** Ana — alphabetically first, and offline. */
const ANA: ContactActorDoc = actor({
  _id: "act-ana00000001",
  name: "Ana",
  ownership: { default: 0, [TOBIAS]: 3 },
  system: { details: { class: "Ladina", level: 4 } },
});

/** An NPC — belongs to the Conhecidos section, never to "Na mesa". */
const ALDRIC: ContactActorDoc = actor({
  _id: "act-aldric00001",
  name: "Mestre Aldric",
  type: "npc",
  ownership: { default: 0 },
});

/** The same NPC as a player sees it once the server redacted it (REQ-CTT-041). */
const GLIMPSED: ContactActorDoc = {
  _id: "act-aldric00001",
  type: "npc",
  flags: { fusion: { glimpsed: true } },
};

const TABLE = [FOFURINHA, GRAO, TOBIAS_PC, ANA, ALDRIC];

function sectionFor(userId: string, isPrivileged = false, query = "", online: string[] = []) {
  return buildTableSection({
    actors: TABLE,
    userId,
    isPrivileged,
    query,
    onlineUserIds: new Set(online),
  });
}

function namesOf(cards: readonly { name: string }[]): string[] {
  return cards.map((card) => card.name);
}

// ---------------------------------------------------------------------------
// Order — REQ-CTT-014 / REQ-CTT-015
// ---------------------------------------------------------------------------

describe("who comes first in Na mesa (REQ-CTT-014)", () => {
  it("REQ-CTT-014: the viewer's own characters come first, each block alphabetical in pt-BR", () => {
    const section = sectionFor(ALEX);

    expect(namesOf(section.mine)).toEqual(["Fofurinha"]);
    expect(namesOf(section.others)).toEqual(["Ana", "Tobias"]);
    expect(section.total).toBe(3);
  });

  it("REQ-CTT-014: pt-BR collation puts an accented name where the reader expects it", () => {
    const accented = [
      actor({ _id: "act-zulmira0001", name: "Zulmira" }),
      actor({ _id: "act-alvaro00001", name: "Álvaro" }),
      actor({ _id: "act-bruno000001", name: "Bruno" }),
    ];
    const section = buildTableSection({ actors: accented, userId: ALEX, isPrivileged: true });

    expect(namesOf(section.others)).toEqual(["Álvaro", "Bruno", "Zulmira"]);
  });

  it("REQ-CTT-014: the GM has no block of his own — every character is in the second block", () => {
    const section = sectionFor(GM, true);

    expect(section.mine).toEqual([]);
    expect(namesOf(section.others)).toEqual(["Ana", "Fofurinha", "Tobias"]);
  });

  it("REQ-CTT-015: presence changes the card, never its position", () => {
    // Ana is alphabetically first and disconnected; Tobias is connected.
    const offline = sectionFor(ALEX, false, "", []);
    const online = sectionFor(ALEX, false, "", [TOBIAS]);

    expect(namesOf(offline.others)).toEqual(namesOf(online.others));
    expect(online.others.map((card) => card.present)).toEqual([true, true]);
    expect(offline.others.map((card) => card.present)).toEqual([false, false]);
  });

  it("REQ-CTT-015: a character is present when any of its owners is connected", () => {
    expect(isContactPresent(FOFURINHA, new Set([ALEX]))).toBe(true);
    expect(isContactPresent(FOFURINHA, new Set([TOBIAS]))).toBe(false);
    // `default` is not a person and never lights presence up.
    expect(
      isContactPresent(actor({ _id: "act-x", ownership: { default: 3 } }), new Set(["default"])),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Search — REQ-CTT-011 / REQ-CTT-013
// ---------------------------------------------------------------------------

describe("the search filters name and title, in the client (REQ-CTT-011)", () => {
  it("REQ-CTT-011: a contact is found by its title as well as by its name", () => {
    expect(matchesContactQuery(FOFURINHA, "fofu")).toBe(true);
    expect(matchesContactQuery(FOFURINHA, "voz do bosque")).toBe(true);
    expect(matchesContactQuery(FOFURINHA, "tobias")).toBe(false);
  });

  it("REQ-CTT-011: the search ignores case and accents, and an empty query keeps everyone", () => {
    expect(matchesContactQuery(FOFURINHA, "  A VOZ  ")).toBe(true);
    expect(matchesContactQuery(ALDRIC, "aldric")).toBe(true);
    expect(matchesContactQuery(ALDRIC, "   ")).toBe(true);
  });

  it("REQ-CTT-011: filtering a section keeps the card of a matching sub-character", () => {
    const section = sectionFor(ALEX, false, "Grão");

    expect(namesOf(section.mine)).toEqual(["Fofurinha"]);
    expect(section.others).toEqual([]);
  });

  it("REQ-CTT-013: a glimpsed contact carries no name or title, so no query finds it", () => {
    expect(isGlimpsedContact(GLIMPSED)).toBe(true);
    expect(matchesContactQuery(GLIMPSED, "aldric")).toBe(false);
    expect(matchesContactQuery(GLIMPSED, "mestre")).toBe(false);
    // And there is nothing in the payload the search could have matched.
    expect(GLIMPSED.name).toBeUndefined();
  });

  it("REQ-CTT-011 + REQ-CMP-055: a contact drawn as 'Águia' is found by the label the card shows", () => {
    // The card renders displayName() (REQ-CMP-055) — the search must match the
    // same resolved label, not only the EN-pure doc.name underneath it.
    const EAGLE: ContactActorDoc = {
      _id: "act-eagle0000005",
      name: "Eagle",
      type: "npc",
      img: "worlds/img/eagle.webp",
      flags: {
        fusion: {
          packName: "bestiary",
          sourceId: "eagle-001",
          i18n: { "pt-BR": { name: "Águia" } },
        },
      },
    };

    expect(matchesContactQuery(EAGLE, "Águia")).toBe(true);
    // And it stays findable by the EN-pure doc.name too — whoever knows the
    // source pack still types the name they know.
    expect(matchesContactQuery(EAGLE, "Eagle")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Categories — REQ-CTT-012 / REQ-CTT-016
// ---------------------------------------------------------------------------

describe("the order of the Conhecidos blocks (REQ-CTT-016)", () => {
  const GROUPS = [
    { name: "Gente de confiança", contacts: ["a"] },
    { name: null, contacts: ["c"] },
    { name: "Vila do Cruzamento", contacts: ["b"] },
  ];

  it("REQ-CTT-016: the user's own order wins, and 'Sem categoria' is always last", () => {
    const ordered = orderContactCategories(GROUPS, ["Vila do Cruzamento", "Gente de confiança"]);

    expect(ordered.map((group) => group.name)).toEqual([
      "Vila do Cruzamento",
      "Gente de confiança",
      null,
    ]);
  });

  it("REQ-CTT-016: the order is neither alphabetical nor creation order", () => {
    const alphabetical = [...GROUPS]
      .filter((group) => group.name !== null)
      .map((group) => group.name!)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const ordered = orderContactCategories(GROUPS, ["Vila do Cruzamento", "Gente de confiança"])
      .filter((group) => group.name !== null)
      .map((group) => group.name!);

    expect(ordered).not.toEqual(alphabetical);
    expect(orderContactCategories(GROUPS, []).map((group) => group.name)).toEqual([
      "Gente de confiança",
      "Vila do Cruzamento",
      null,
    ]);
  });

  it("REQ-CTT-012: a category emptied by the search disappears, and comes back when the field is cleared", () => {
    const searched = [
      { name: "Vila do Cruzamento", contacts: ["b"] },
      { name: "Gente de confiança", contacts: [] },
    ];

    expect(visibleContactCategories(searched, "ald").map((group) => group.name)).toEqual([
      "Vila do Cruzamento",
    ]);
    expect(visibleContactCategories(searched, "").map((group) => group.name)).toEqual([
      "Vila do Cruzamento",
      "Gente de confiança",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The card — REQ-CTT-020 / REQ-CTT-021 / REQ-CTT-022
// ---------------------------------------------------------------------------

describe("what a card carries (REQ-CTT-020)", () => {
  it("REQ-CTT-020: portrait, name, title, presence and conditions — all of them", () => {
    const [card] = sectionFor(ALEX, false, "", [ALEX]).mine;

    expect(card).toBeDefined();
    expect(card!.img).toBe("worlds/x/fofurinha.webp");
    expect(card!.name).toBe("Fofurinha");
    expect(card!.title).toEqual({ text: "A Voz do Bosque", kind: "title" });
    expect(card!.present).toBe(true);
    expect(card!.conditions.map((condition) => condition.slug)).toEqual(["frightened", "hidden"]);
  });

  it("REQ-CTT-021: no hit points reach the card, for any role", () => {
    const asPlayer = sectionFor(ALEX);
    const asGm = sectionFor(GM, true);
    const serialized = JSON.stringify([asPlayer, asGm]);

    // The document under test carries 31/44 — neither number may appear anywhere.
    expect(serialized).not.toContain("31");
    expect(serialized).not.toContain("44");
    expect(serialized).not.toMatch(/"hp"/);
    expect(serialized).not.toMatch(/attributes/);
  });

  it("REQ-CTT-022: owning the character is a field of its own, not a colour", () => {
    const alex = sectionFor(ALEX);
    const tobias = sectionFor(TOBIAS);

    expect(alex.mine.map((card) => card.isMine)).toEqual([true]);
    expect(alex.others.every((card) => !card.isMine)).toBe(true);
    expect(namesOf(tobias.mine)).toEqual(["Ana", "Tobias"]);
    expect(ownsContact(FOFURINHA, TOBIAS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The title — REQ-CTT-023 / REQ-CTT-024 / REQ-CTT-085
// ---------------------------------------------------------------------------

describe("the line under the name (REQ-CTT-023)", () => {
  it("REQ-CTT-023: a filled title wins, and an empty one falls back to class and level", () => {
    expect(resolveTitleLine(FOFURINHA)).toEqual({ text: "A Voz do Bosque", kind: "title" });
    expect(resolveTitleLine(TOBIAS_PC)).toEqual({ text: "Guerreiro 5", kind: "fallback" });
  });

  it("REQ-CTT-023: the fallback is marked as such, so the panel can draw it differently", () => {
    const [ana, tobias] = sectionFor(ALEX).others;

    expect(ana!.title.kind).toBe("fallback");
    expect(tobias!.title.kind).toBe("fallback");
    expect(sectionFor(ALEX).mine[0]!.title.kind).toBe("title");
  });

  it("REQ-CTT-023: a system with neither class nor level degrades to an empty line, never to a lie", () => {
    expect(systemIdentityLine(actor({ _id: "act-y", system: {} }))).toBe("");
    expect(systemIdentityLine(actor({ _id: "act-z", system: { details: { level: 3 } } }))).toBe(
      "3",
    );
    // The `{ value }` wrapper some systems use is understood too.
    expect(
      systemIdentityLine(
        actor({ _id: "act-w", system: { details: { class: "Orador", level: { value: 2 } } } }),
      ),
    ).toBe("Orador 2");
  });

  it("REQ-CTT-024: whitespace alone is not a title — the line falls back", () => {
    const blank = actor({
      _id: "act-blank00001",
      name: "Branco",
      flags: { fusion: { title: "   " } },
      system: { details: { class: "Clérigo", level: 4 } },
    });

    expect(resolveTitleLine(blank)).toEqual({ text: "Clérigo 4", kind: "fallback" });
  });
});

describe("who may rewrite the title (REQ-CTT-024, REQ-CTT-085)", () => {
  it("REQ-CTT-024: whoever owns the character may, in the card itself", () => {
    expect(canEditContactTitle(FOFURINHA, ALEX, false)).toBe(true);
    expect(sectionFor(ALEX).mine[0]!.canEditTitle).toBe(true);
  });

  it("REQ-CTT-085: another player may not, and a privileged role always may", () => {
    expect(canEditContactTitle(FOFURINHA, TOBIAS, false)).toBe(false);
    expect(canEditContactTitle(FOFURINHA, GM, true)).toBe(true);
    expect(sectionFor(TOBIAS).others.map((card) => card.canEditTitle)).toEqual([false]);
    expect(sectionFor(GM, true).others.every((card) => card.canEditTitle)).toBe(true);
  });

  it("REQ-CTT-085: the write goes through the actor's own document, as a trimmed flag", () => {
    expect(contactTitleDiff("  A Voz do Bosque  ")).toEqual({
      [CONTACT_TITLE_FLAG_PATH]: "A Voz do Bosque",
    });
    expect(CONTACT_TITLE_FLAG_PATH).toBe("flags.fusion.title");
    // Clearing the title is a write of the empty string, not a deletion of the actor.
    expect(contactTitleDiff("")).toEqual({ [CONTACT_TITLE_FLAG_PATH]: "" });
  });
});

// ---------------------------------------------------------------------------
// Sub-characters — REQ-CTT-025 / REQ-CTT-026
// ---------------------------------------------------------------------------

describe("sub-characters live inside the owner's card (REQ-CTT-025)", () => {
  it("REQ-CTT-025: the familiar is nested in its master and is not a card of its own", () => {
    const section = sectionFor(ALEX);
    const cards = [...section.mine, ...section.others];

    expect(namesOf(cards)).not.toContain("Grão");
    expect(section.mine[0]!.subCharacters.map((sub) => sub.name)).toEqual(["Grão"]);
    expect(section.mine[0]!.subCharacters[0]!.kind).toBe("familiar");
  });

  it("REQ-CTT-025: the pair the server authorizes against is the pair this tab reads", () => {
    expect(isSubCharacter(GRAO)).toBe(true);
    // Type alone is not a companion — the master link is half of the pair.
    expect(isSubCharacter(actor({ _id: "act-orphan0001", type: "familiar", system: {} }))).toBe(
      false,
    );
  });

  it("REQ-CTT-026: a companion whose master is not in the list does not appear loose", () => {
    const orphan = actor({
      _id: "act-bruta00001",
      name: "Bruta",
      type: "familiar",
      system: { masterActorId: "act-missing00001", companionKind: "animalCompanion" },
    });
    const section = buildTableSection({
      actors: [FOFURINHA, GRAO, orphan],
      userId: ALEX,
      isPrivileged: true,
    });
    const cards = [...section.mine, ...section.others];

    expect(namesOf(cards)).toEqual(["Fofurinha"]);
    expect(cards.flatMap((card) => card.subCharacters.map((sub) => sub.name))).toEqual(["Grão"]);
  });

  it("REQ-CTT-021: a sub-character carries conditions and no hit points either", () => {
    const [sub] = sectionFor(ALEX).mine[0]!.subCharacters;

    expect(sub!.conditions.map((condition) => condition.label)).toEqual(["Morrendo 1"]);
    expect(JSON.stringify(sub)).not.toMatch(/hp/);
  });
});

// ---------------------------------------------------------------------------
// Dragging — REQ-CTT-028
// ---------------------------------------------------------------------------

describe("dragging a card to the map (REQ-CTT-028)", () => {
  it("REQ-CTT-028: only a privileged role gets a draggable card", () => {
    expect(canDragContactToCanvas(true)).toBe(true);
    expect(canDragContactToCanvas(false)).toBe(false);

    expect(sectionFor(ALEX).mine.every((card) => card.draggable)).toBe(false);
    expect(sectionFor(GM, true).others.every((card) => card.draggable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conditions on the card — REQ-CTT-020, and the fail-open of REQ-CTT-035
// ---------------------------------------------------------------------------

describe("the conditions a card shows (REQ-CTT-020)", () => {
  const DECLARED: ReadonlyMap<string, ConditionDisplayContract> = new Map([
    ["frightened", { slug: "frightened", label: "Amedrontado", tone: "harm", help: "Penalidade." }],
    ["hidden", { slug: "hidden", label: "Escondido", tone: "special" }],
  ]);

  it("REQ-CTT-020: active conditions are read from the actor's own embedded items", () => {
    expect(readActiveConditions(FOFURINHA)).toEqual([
      { slug: "frightened", value: 2 },
      { slug: "hidden" },
    ]);
  });

  it("REQ-CTT-020: the system's declaration paints the chip when there is one", () => {
    const views = buildContactConditions(FOFURINHA, DECLARED);

    expect(views.map((view) => [view.label, view.tone])).toEqual([
      ["Amedrontado 2", "harm"],
      ["Escondido", "special"],
    ]);
  });

  it("REQ-CTT-020: with nothing declared the item's own name still names the chip", () => {
    const views = buildContactConditions(FOFURINHA);

    expect(views.map((view) => view.label)).toEqual(["Amedrontado 2", "Escondido"]);
    expect(views.every((view) => view.tone === "special")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The panel's mirror vs. the manifest it mirrors
// ---------------------------------------------------------------------------

/**
 * `contactsVM.ts` mirrors by hand which Actor subtype is a player character and
 * which one is a contact, because the client package may not import every
 * system package. The server keeps the same mirror in
 * `packages/server/src/documents/knowledge.ts` — and the two answering
 * differently is the whole defect: the payload would be redacted by one table
 * and drawn by another, so a card the server delivered would never reach "Na
 * mesa" (REQ-CTT-014/REQ-CTT-020).
 *
 * pf2e and sf2e are read here as data — a third source both mirrors answer
 * to, never the mirror compared to itself. Mirrors contacts-knowledge.test.ts's
 * server-side SYSTEMS suite.
 */
describe("Actor subtype mirror vs. the system manifests (REQ-CTT-014, REQ-CTT-020)", () => {
  const SYSTEMS = [
    { id: "pf2e", subtypes: pf2eSystem.manifest.documentTypes["Actor"] ?? [] },
    { id: "sf2e", subtypes: sf2eSystem.manifest.documentTypes["Actor"] ?? [] },
  ];

  /**
   * Subtypes deliberately classified as NEITHER a character nor a contact: the
   * chest (`loot`, DEC-NPC-08) and a companion (`familiar`, DEC-CTT-06), both
   * of which answer to `ownership` alone. Naming them here is the decision;
   * what the test refuses is SILENCE about a subtype nobody decided.
   */
  const DECIDED_AS_NEITHER = new Set(["loot", "familiar"]);

  it("REQ-CTT-014: the playable Actor each system declares first is read as a character, never as a contact", () => {
    const verdicts = SYSTEMS.map((system) => {
      const playable = system.subtypes[0] ?? "";
      return {
        id: system.id,
        playable,
        isCharacter: isPlayerCharacter({ _id: "a", type: playable }),
        isContact: isNonPlayableActor({ _id: "a", type: playable }),
      };
    });
    expect(verdicts).toEqual([
      { id: "pf2e", playable: "character", isCharacter: true, isContact: false },
      { id: "sf2e", playable: "character", isCharacter: true, isContact: false },
    ]);
  });

  it("REQ-CTT-020: every Actor subtype a system declares is classified — none falls through unnoticed", () => {
    const unclassified: string[] = [];
    for (const system of SYSTEMS) {
      for (const subtype of system.subtypes) {
        const doc = { _id: "a", type: subtype };
        if (isPlayerCharacter(doc) || isNonPlayableActor(doc)) continue;
        if (DECIDED_AS_NEITHER.has(subtype)) continue;
        unclassified.push(`${system.id}:${subtype}`);
      }
    }
    expect(unclassified).toEqual([]);
  });
});
