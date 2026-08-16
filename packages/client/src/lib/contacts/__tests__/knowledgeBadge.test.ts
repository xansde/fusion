/**
 * knowledgeBadge.test.ts — the state dot of the Contatos tab (spec 39 §5.1, G066).
 *
 * Covers REQ-CTT-002 (one badge, a state dot with no number), REQ-CTT-003 (it lights
 * when a contact rises in state for the viewer while the tab is closed, and goes out
 * when the tab is opened) and REQ-CTT-004 (it never lights for a privileged role, nor
 * for a condition, nor for someone connecting or disconnecting).
 *
 * The dot is fed by the payload the client already has — the server resolved the
 * viewer's maximum across his characters before emitting (G060/G061) — so these
 * tests drive the real `worldMirror` with the shapes the server produces: a glimpsed
 * contact arrives stripped and flagged, and a hidden one simply is not there.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  CONTACTS_SEEN_KEY_PREFIX,
  attachContactsKnowledgeBadge,
  clearSeenKnowledge,
  contactsSeenKey,
  contactsStateDot,
  detachContactsKnowledgeBadge,
  hasKnowledgeRise,
  loadSeenKnowledge,
  observedKnowledgeMap,
  observedKnowledgeOf,
  risenContacts,
  saveSeenKnowledge,
  setContactsTabVisible,
} from "../knowledgeBadge.js";
import { formatSidebarBadge } from "../../sidebar/badges.svelte.js";
import { worldMirror } from "../../docs/worldSync.js";

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
// Fixtures — the shapes the server actually emits (G061)
// ---------------------------------------------------------------------------

const WORLD = "world-abc";
const ALEX = "user-alex-000001";

/** The viewer's own character: "Na mesa", never governed by knowledge. */
const FOFURINHA = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
  system: { details: { class: "Druida", level: 5 } },
};

/** A contact at `conhecido`: it arrives whole. */
const FERREIRO = {
  _id: "act-ferreiro001",
  name: "Dona Bruna",
  type: "npc",
  ownership: { default: 2 },
};

/** The same contact at `entrevisto`: stripped, with only the marker (REQ-CTT-081). */
const FERREIRO_GLIMPSED = {
  _id: "act-ferreiro001",
  type: "npc",
  flags: { fusion: { glimpsed: true } },
};

const CAPITAO = {
  _id: "act-capitao0001",
  name: "Capitão Vela",
  type: "npc",
  ownership: { default: 2 },
};

function seed(actors: readonly Record<string, unknown>[]): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [...actors] },
  } as never);
}

function attachAsPlayer(): void {
  attachContactsKnowledgeBadge({ worldId: WORLD, userId: ALEX, isPrivileged: false });
}

beforeEach(() => {
  detachContactsKnowledgeBadge();
  // Whether the tab is open is the panel's fact and survives a detach on purpose,
  // so each test states it rather than inheriting the previous one's.
  setContactsTabVisible(false);
  localStorageMock.clear();
  seed([]);
});

// ---------------------------------------------------------------------------
// What the viewer can observe — REQ-CTT-003
// ---------------------------------------------------------------------------

describe("the state a payload announces about itself (REQ-CTT-003)", () => {
  it("REQ-CTT-003: conhecido reads 2, entrevisto reads 1, and a character reads nothing", () => {
    expect(observedKnowledgeOf(FERREIRO)).toBe(2);
    expect(observedKnowledgeOf(FERREIRO_GLIMPSED)).toBe(1);
    // The viewer's own character belongs to "Na mesa" — knowledge does not govern it.
    expect(observedKnowledgeOf(FOFURINHA)).toBe(0);
  });

  it("REQ-CTT-003: a hidden contact has no entry at all — it never arrived", () => {
    const map = observedKnowledgeMap([FOFURINHA, FERREIRO_GLIMPSED]);

    expect(map).toEqual({ "act-ferreiro001": 1 });
    expect(Object.keys(map)).not.toContain("act-capitao0001");
  });

  it("REQ-CTT-003: a contact missing from the mark counts as hidden, so arriving is a rise", () => {
    expect(risenContacts({}, { "act-ferreiro001": 1 })).toEqual(["act-ferreiro001"]);
    expect(hasKnowledgeRise({ "act-ferreiro001": 1 }, { "act-ferreiro001": 2 })).toBe(true);
    // Falling back is not news, and neither is standing still.
    expect(hasKnowledgeRise({ "act-ferreiro001": 2 }, { "act-ferreiro001": 1 })).toBe(false);
    expect(hasKnowledgeRise({ "act-ferreiro001": 2 }, { "act-ferreiro001": 2 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The mark on this device — REQ-CTT-003
// ---------------------------------------------------------------------------

describe("the mark of the last look lives on this device (REQ-CTT-003)", () => {
  it("REQ-CTT-003: the key names the world and the user, and nothing is sent anywhere", () => {
    expect(contactsSeenKey(WORLD, ALEX)).toBe(`${CONTACTS_SEEN_KEY_PREFIX}:${WORLD}:${ALEX}`);

    saveSeenKnowledge(WORLD, ALEX, { "act-ferreiro001": 2 });
    saveSeenKnowledge(WORLD, "user-tobias", { "act-capitao0001": 1 });

    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({ "act-ferreiro001": 2 });
    expect(loadSeenKnowledge(WORLD, "user-tobias")).toEqual({ "act-capitao0001": 1 });
    expect(loadSeenKnowledge("other-world", ALEX)).toEqual({});
  });

  it("REQ-CTT-003: a corrupt or absent mark reads as 'never looked', never as a throw", () => {
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({});

    localStorage.setItem(contactsSeenKey(WORLD, ALEX), "{not json");
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({});

    localStorage.setItem(contactsSeenKey(WORLD, ALEX), JSON.stringify({ a: 9, b: 2 }));
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({ b: 2 });

    clearSeenKnowledge(WORLD, ALEX);
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The badge itself — REQ-CTT-002 / REQ-CTT-003 / REQ-CTT-004
// ---------------------------------------------------------------------------

describe("the tab's badge is a state dot (REQ-CTT-002)", () => {
  it("REQ-CTT-002: the store yields a boolean, and the rail draws a dot with no number", () => {
    seed([FOFURINHA, FERREIRO]);
    attachAsPlayer();

    expect(typeof contactsStateDot.value).toBe("boolean");
    expect(formatSidebarBadge(contactsStateDot.value)).toEqual({ kind: "dot", text: null });

    setContactsTabVisible(true);
    expect(formatSidebarBadge(contactsStateDot.value).kind).toBe("none");
  });
});

describe("the dot lights on a rise and goes out on opening (REQ-CTT-003)", () => {
  it("REQ-CTT-003: a contact that rises while the tab is closed lights the dot", () => {
    seed([FOFURINHA, FERREIRO_GLIMPSED]);
    attachAsPlayer();
    // The player looks: the mark now says "entrevisto".
    setContactsTabVisible(true);
    setContactsTabVisible(false);
    expect(contactsStateDot.value).toBe(false);

    // The Mestre introduces the same contact properly — it arrives whole.
    seed([FOFURINHA, FERREIRO]);

    expect(contactsStateDot.value).toBe(true);
  });

  it("REQ-CTT-003: opening the tab puts it out and writes the mark", () => {
    seed([FOFURINHA, FERREIRO]);
    attachAsPlayer();
    expect(contactsStateDot.value).toBe(true);

    setContactsTabVisible(true);

    expect(contactsStateDot.value).toBe(false);
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({ "act-ferreiro001": 2 });

    // And it stays out after closing: what was seen is seen.
    setContactsTabVisible(false);
    seed([FOFURINHA, FERREIRO]);
    expect(contactsStateDot.value).toBe(false);
  });

  it("REQ-CTT-003: a rise that arrives while the tab is open never lights the dot", () => {
    seed([FOFURINHA]);
    attachAsPlayer();
    setContactsTabVisible(true);

    seed([FOFURINHA, FERREIRO, CAPITAO]);

    expect(contactsStateDot.value).toBe(false);
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({
      "act-ferreiro001": 2,
      "act-capitao0001": 2,
    });
  });

  it("REQ-CTT-003: reconnecting with the tab open does not turn the open list into news", () => {
    seed([FOFURINHA]);
    attachAsPlayer();
    setContactsTabVisible(true);

    // The socket drops and comes back while the panel stays on screen.
    detachContactsKnowledgeBadge();
    seed([FOFURINHA, FERREIRO]);
    attachAsPlayer();

    expect(contactsStateDot.value).toBe(false);
    expect(loadSeenKnowledge(WORLD, ALEX)).toEqual({ "act-ferreiro001": 2 });
  });

  it("REQ-CTT-003: the mark survives the session — a rise while away is lit on arrival", () => {
    saveSeenKnowledge(WORLD, ALEX, { "act-ferreiro001": 1 });

    seed([FOFURINHA, FERREIRO, CAPITAO]);
    attachAsPlayer();

    expect(risenContacts(loadSeenKnowledge(WORLD, ALEX), observedKnowledgeMap([FERREIRO]))).toEqual(
      ["act-ferreiro001"],
    );
    expect(contactsStateDot.value).toBe(true);
  });
});

describe("what must never light the dot (REQ-CTT-004)", () => {
  it("REQ-CTT-004: a privileged seat never gets the dot — the news is his own doing", () => {
    seed([FOFURINHA, FERREIRO, CAPITAO]);
    attachContactsKnowledgeBadge({ worldId: WORLD, userId: "user-gm-000001", isPrivileged: true });

    expect(contactsStateDot.value).toBe(false);

    // Not even when a brand new contact shows up.
    seed([FOFURINHA, FERREIRO, CAPITAO, { _id: "act-novo000001", name: "Novo", type: "npc" }]);
    expect(contactsStateDot.value).toBe(false);
  });

  it("REQ-CTT-004: a condition applied to a contact is not a rise", () => {
    seed([FOFURINHA, FERREIRO]);
    attachAsPlayer();
    setContactsTabVisible(true);
    setContactsTabVisible(false);

    seed([
      FOFURINHA,
      {
        ...FERREIRO,
        items: [
          { _id: "it-1", type: "condition", name: "Amedrontado", system: { slug: "frightened" } },
        ],
      },
    ]);

    expect(contactsStateDot.value).toBe(false);
  });

  it("REQ-CTT-004: a user connecting or disconnecting cannot reach the badge at all", () => {
    seed([FOFURINHA, FERREIRO]);
    attachAsPlayer();
    setContactsTabVisible(true);
    setContactsTabVisible(false);

    // Presence is not a document: the very same actors arrive again, and nothing moves.
    seed([FOFURINHA, FERREIRO]);

    expect(contactsStateDot.value).toBe(false);
    expect(observedKnowledgeMap([FOFURINHA, FERREIRO])).toEqual({ "act-ferreiro001": 2 });
  });

  it("REQ-CTT-004: a contact taken back before the player looks puts the dot out again", () => {
    seed([FOFURINHA]);
    attachAsPlayer();
    setContactsTabVisible(true);
    setContactsTabVisible(false);

    seed([FOFURINHA, FERREIRO]);
    expect(contactsStateDot.value).toBe(true);

    // The Mestre changes his mind: the contact stops being delivered (REQ-CTT-082).
    seed([FOFURINHA]);
    expect(contactsStateDot.value).toBe(false);
  });

  it("REQ-CTT-002: detaching the seat puts the dot out and stops following", () => {
    seed([FOFURINHA, FERREIRO]);
    attachAsPlayer();
    expect(contactsStateDot.value).toBe(true);

    detachContactsKnowledgeBadge();
    expect(contactsStateDot.value).toBe(false);

    seed([FOFURINHA, FERREIRO, CAPITAO]);
    expect(contactsStateDot.value).toBe(false);
  });
});
