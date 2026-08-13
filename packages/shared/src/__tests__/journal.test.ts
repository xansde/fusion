/**
 * How a journal page decides who may read it — Q-JRN-003, DEC-HUB-04.
 *
 * This is the rule the whole quest board rests on, and it is the one that is
 * easy to get subtly wrong in the direction that spoils a campaign: a new
 * objective that publishes itself the moment the GM types its title. So the
 * cases below are written as table situations, not as truth-table rows.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "../document.js";
import {
  JournalEntryPageSchema,
  createJournalPage,
  resolvePageLevel,
  canReadPage,
} from "../journal.js";

const PAGE_ID = "pppppppppppppppp";

/** A quest the party is already reading. */
const PUBLISHED_QUEST = { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER };

describe("resolvePageLevel", () => {
  it("inherits the entry when the page declares nothing", () => {
    const page = createJournalPage(PAGE_ID, { ownership: {} });

    expect(resolvePageLevel(page, PUBLISHED_QUEST, "tobias")).toBe(OwnershipLevel.OBSERVER);
    expect(resolvePageLevel(page, PUBLISHED_QUEST, "comedor")).toBe(OwnershipLevel.NONE);
  });

  it("lets the page override the entry for one player", () => {
    const page = createJournalPage(PAGE_ID, {
      ownership: { comedor: OwnershipLevel.OBSERVER },
    });

    // The page names Comedor and says nothing else, so it decides for him...
    expect(resolvePageLevel(page, PUBLISHED_QUEST, "comedor")).toBe(OwnershipLevel.OBSERVER);
    // ...and Tobias, unnamed and with no page default, still inherits.
    expect(resolvePageLevel(page, PUBLISHED_QUEST, "tobias")).toBe(OwnershipLevel.OBSERVER);
  });

  it("lets the page hide itself from a player the entry publishes to", () => {
    const page = createJournalPage(PAGE_ID, {
      ownership: { default: OwnershipLevel.OBSERVER, tobias: OwnershipLevel.NONE },
    });

    expect(resolvePageLevel(page, PUBLISHED_QUEST, "tobias")).toBe(OwnershipLevel.NONE);
  });

  it("treats a page default as an answer, not as silence", () => {
    const page = createJournalPage(PAGE_ID, { ownership: { default: OwnershipLevel.NONE } });

    // The entry would have published to Tobias; the page's own default wins.
    expect(resolvePageLevel(page, PUBLISHED_QUEST, "tobias")).toBe(OwnershipLevel.NONE);
  });

  it("gives an anonymous viewer nothing, whatever any default says", () => {
    // `default` means "the table", and a socket with no identified user is not
    // at it. Both the page's default and the entry's are refused, so the two
    // steps cannot disagree — which is how a fail-open crack gets in.
    const inheriting = createJournalPage(PAGE_ID, { ownership: {} });
    const openPage = createJournalPage(PAGE_ID, {
      ownership: { default: OwnershipLevel.OBSERVER },
    });

    expect(resolvePageLevel(inheriting, { default: OwnershipLevel.OBSERVER }, null)).toBe(
      OwnershipLevel.NONE,
    );
    expect(resolvePageLevel(openPage, PUBLISHED_QUEST, null)).toBe(OwnershipLevel.NONE);
    expect(resolvePageLevel(openPage, PUBLISHED_QUEST, "")).toBe(OwnershipLevel.NONE);
  });
});

describe("createJournalPage", () => {
  it("hides a new page even inside a quest the party is reading", () => {
    // The failure this prevents: the GM adds "Voltar e cobrar do xerife" to a
    // published quest and the party reads the ending before playing it.
    const page = createJournalPage(PAGE_ID, { name: "Voltar e cobrar do xerife" });

    expect(canReadPage(page, PUBLISHED_QUEST, "tobias")).toBe(false);
  });

  it("still lets the caller open a page deliberately", () => {
    const page = createJournalPage(PAGE_ID, {
      name: "Boato",
      ownership: { default: OwnershipLevel.OBSERVER },
    });

    expect(canReadPage(page, PUBLISHED_QUEST, "comedor")).toBe(true);
  });
});

describe("canReadPage", () => {
  it("does not treat `limited` as readable — a page has no rumour state", () => {
    const page = createJournalPage(PAGE_ID, {
      ownership: { tobias: OwnershipLevel.LIMITED },
    });

    expect(canReadPage(page, PUBLISHED_QUEST, "tobias")).toBe(false);
  });

  it("reads an owner's own page", () => {
    const page = createJournalPage(PAGE_ID, { ownership: { tobias: OwnershipLevel.OWNER } });

    expect(canReadPage(page, PUBLISHED_QUEST, "tobias")).toBe(true);
  });
});

describe("JournalEntryPageSchema", () => {
  it("defaults a bare page to inheriting, not to hiding", () => {
    // The schema default and the factory default differ on purpose: a page
    // parsed off the wire keeps whatever it was given, and only the factory
    // takes the safe stance for pages nobody configured yet.
    const page = JournalEntryPageSchema.parse({ _id: PAGE_ID });

    expect(page.ownership).toEqual({});
    expect(resolvePageLevel(page, PUBLISHED_QUEST, "tobias")).toBe(OwnershipLevel.OBSERVER);
  });

  it("keeps the page's title and body together as one piece", () => {
    const page = createJournalPage(PAGE_ID, {
      name: "A coisa na neblina",
      content: '{"type":"doc"}',
    });

    expect(page.name).toBe("A coisa na neblina");
    expect(page.content).toBe('{"type":"doc"}');
    expect(page.type).toBe("text");
    expect(page.tocLevel).toBe(1);
  });
});
