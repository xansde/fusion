/**
 * compendiumPrefs.test.ts — what the Compendium tab keeps on the device (G096).
 *
 * Spec 43 §5.9 and §5.1. Two lifetimes and one badge rule:
 *  - REQ-CPD-080/081: open pack, text and facets restored on the way back, per
 *    world and user, for the BROWSER SESSION only;
 *  - REQ-CPD-082/083: pins and a short recently-used block, on the device;
 *  - REQ-CPD-084: a pin whose pack is no longer visible disappears with no error
 *    and without taking the others with it;
 *  - REQ-CPD-002..005: a state dot, lit only while a batch import of this user
 *    is running, and unmoved by opening the tab.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  COMPENDIUM_PINS_KEY_PREFIX,
  COMPENDIUM_RECENT_KEY_PREFIX,
  COMPENDIUM_RECENT_LIMIT,
  COMPENDIUM_VIEW_KEY_PREFIX,
  NO_BATCH_IMPORTS,
  batchImportBadgeValue,
  beginBatchImport,
  clearBrowserView,
  compendiumPinsKey,
  compendiumRecentKey,
  compendiumViewKey,
  endBatchImport,
  filterByVisiblePacks,
  isEntryPinned,
  loadBrowserView,
  loadPinnedEntries,
  loadRecentEntries,
  reconcileBrowserView,
  recordRecentEntry,
  savePinnedEntries,
  saveBrowserView,
  saveRecentEntries,
  togglePinnedEntry,
  type CompendiumEntryRef,
  type CompendiumRecentEntry,
} from "../compendiumPrefs.js";
import { initialBrowserScope, openPack, setFacet, setSearch } from "../browserScope.js";
import { formatSidebarBadge } from "../../sidebar/badges.svelte.js";
import {
  compendiumImportBadge,
  finishCompendiumBatchImport,
  resetCompendiumImportActivity,
  runningCompendiumBatchImports,
  startCompendiumBatchImport,
} from "../importActivity.js";

// ---------------------------------------------------------------------------
// Storage mocks — the two lifetimes are two different objects, on purpose:
// a test that passes with sessionStorage aliased to localStorage would prove
// nothing about REQ-CPD-080's "closing the browser tab zeroes it".
// ---------------------------------------------------------------------------

function makeStorageMock(): Storage & { snapshot: () => Record<string, string> } {
  let store: Record<string, string> = {};
  return {
    get length(): number {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
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
}

const localStorageMock = makeStorageMock();
const sessionStorageMock = makeStorageMock();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorageMock, writable: true });

const WORLD = "world-abc";
const GM = "user-gm";
const PLAYER = "user-player";

const FIREBALL: CompendiumEntryRef = {
  uuid: "Compendium.pf2e.spells.Item.fireball",
  packId: "pf2e.spells",
  name: "Bola de Fogo",
  documentType: "Item",
};

const GOBLIN: CompendiumEntryRef = {
  uuid: "Compendium.pf2e.bestiary.Actor.goblin",
  packId: "pf2e.bestiary",
  name: "Goblin Guerreiro",
  documentType: "Actor",
};

beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
  resetCompendiumImportActivity();
});

// ---------------------------------------------------------------------------
// The view that survives a tab switch
// ---------------------------------------------------------------------------

describe("REQ-CPD-080/081: scope, text and facets across a tab switch", () => {
  it("REQ-CPD-080: restores the open pack, the typed text and the active facets", () => {
    const view = setFacet(
      setSearch(openPack(initialBrowserScope(), { id: "pf2e.spells", label: "Magias" }), "bola"),
      "rarity",
      "uncommon",
    );

    saveBrowserView(WORLD, GM, view);

    // The panel was unmounted (REQ-GAV-017) and mounted again: same question.
    expect(loadBrowserView(WORLD, GM)).toEqual(view);
  });

  it("REQ-CPD-080: nothing saved is a clean start, not an error", () => {
    expect(loadBrowserView(WORLD, GM)).toEqual(initialBrowserScope());
  });

  it("REQ-CPD-080: the view lives in the browser session, not on the device", () => {
    saveBrowserView(WORLD, GM, setSearch(initialBrowserScope(), "goblin"));

    // Written to sessionStorage only — closing the browser tab is what zeroes it,
    // and there is nothing in localStorage to survive it (DEC-CPD-09).
    expect(Object.keys(sessionStorageMock.snapshot())).toEqual([compendiumViewKey(WORLD, GM)]);
    expect(Object.keys(localStorageMock.snapshot())).toEqual([]);

    sessionStorageMock.clear(); // the browser tab was closed
    expect(loadBrowserView(WORLD, GM)).toEqual(initialBrowserScope());
  });

  it("REQ-CPD-081: the key is per world and per user, so a shared browser does not mix seats", () => {
    saveBrowserView(WORLD, GM, setSearch(initialBrowserScope(), "dragão"));
    saveBrowserView(WORLD, PLAYER, setSearch(initialBrowserScope(), "poção"));
    saveBrowserView("other-world", GM, setSearch(initialBrowserScope(), "outro"));

    expect(loadBrowserView(WORLD, GM).search).toBe("dragão");
    expect(loadBrowserView(WORLD, PLAYER).search).toBe("poção");
    expect(loadBrowserView("other-world", GM).search).toBe("outro");
    expect(compendiumViewKey(WORLD, GM)).toBe(`${COMPENDIUM_VIEW_KEY_PREFIX}:${WORLD}:${GM}`);
  });

  it("REQ-CPD-081: with no world or no user there is no owner, so nothing is written or read", () => {
    saveBrowserView("", GM, setSearch(initialBrowserScope(), "anônimo"));
    saveBrowserView(WORLD, "", setSearch(initialBrowserScope(), "anônimo"));

    expect(sessionStorageMock.snapshot()).toEqual({});
    expect(loadBrowserView("", GM)).toEqual(initialBrowserScope());
  });

  it("REQ-CPD-080: a corrupt or foreign value degrades to a clean start", () => {
    for (const raw of ["not json", "[]", '{"scope":{"kind":"pack"}}', '{"search":"x"}']) {
      sessionStorageMock.setItem(compendiumViewKey(WORLD, GM), raw);
      expect(loadBrowserView(WORLD, GM)).toEqual(initialBrowserScope());
    }
  });

  it("REQ-CPD-080: garbage inside the facets is dropped, the rest of the view survives", () => {
    sessionStorageMock.setItem(
      compendiumViewKey(WORLD, GM),
      JSON.stringify({
        scope: { kind: "root" },
        search: "bola",
        facets: { rarity: "rare", minLevel: "muito alto", documentType: 7 },
      }),
    );

    expect(loadBrowserView(WORLD, GM)).toEqual({
      scope: { kind: "root" },
      search: "bola",
      facets: { rarity: "rare" },
    });
  });

  it("REQ-CPD-084: a restored pack scope whose pack is gone falls back to the root, keeping the text", () => {
    const view = setSearch(
      openPack(initialBrowserScope(), { id: "pf2e.bestiary", label: "B" }),
      "gob",
    );

    const reconciled = reconcileBrowserView(view, ["pf2e.spells", "pf2e.equipment"]);

    expect(reconciled.scope).toEqual({ kind: "root" });
    expect(reconciled.search).toBe("gob");
    // Still visible: the view is handed back untouched.
    expect(reconcileBrowserView(view, ["pf2e.bestiary"])).toBe(view);
  });

  it("REQ-CPD-081: clearing drops this seat's view and nobody else's", () => {
    saveBrowserView(WORLD, GM, setSearch(initialBrowserScope(), "gm"));
    saveBrowserView(WORLD, PLAYER, setSearch(initialBrowserScope(), "player"));

    clearBrowserView(WORLD, GM);

    expect(loadBrowserView(WORLD, GM)).toEqual(initialBrowserScope());
    expect(loadBrowserView(WORLD, PLAYER).search).toBe("player");
  });
});

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe("REQ-CPD-082/084: pinned entries", () => {
  it("REQ-CPD-082: pinning and unpinning round-trips through the device", () => {
    const pinned = togglePinnedEntry(togglePinnedEntry([], FIREBALL), GOBLIN);
    savePinnedEntries(WORLD, GM, pinned);

    expect(loadPinnedEntries(WORLD, GM)).toEqual([GOBLIN, FIREBALL]);
    expect(isEntryPinned(loadPinnedEntries(WORLD, GM), FIREBALL.uuid)).toBe(true);

    savePinnedEntries(WORLD, GM, togglePinnedEntry(pinned, FIREBALL));

    const after = loadPinnedEntries(WORLD, GM);
    expect(isEntryPinned(after, FIREBALL.uuid)).toBe(false);
    expect(isEntryPinned(after, GOBLIN.uuid)).toBe(true);
  });

  it("REQ-CPD-082: toggling never mutates the list it was given", () => {
    const original: readonly CompendiumEntryRef[] = [FIREBALL];

    togglePinnedEntry(original, GOBLIN);
    togglePinnedEntry(original, FIREBALL);

    expect(original).toEqual([FIREBALL]);
  });

  it("REQ-CPD-081: pins live on the device, per world and user — not in the session", () => {
    savePinnedEntries(WORLD, GM, [FIREBALL]);

    expect(Object.keys(localStorageMock.snapshot())).toEqual([compendiumPinsKey(WORLD, GM)]);
    expect(sessionStorageMock.snapshot()).toEqual({});
    expect(compendiumPinsKey(WORLD, GM)).toBe(`${COMPENDIUM_PINS_KEY_PREFIX}:${WORLD}:${GM}`);

    // The player of the same browser has his own, empty, list.
    expect(loadPinnedEntries(WORLD, PLAYER)).toEqual([]);
  });

  it("REQ-CPD-084: a pin whose pack is no longer visible disappears, and the others stay", () => {
    savePinnedEntries(WORLD, PLAYER, [GOBLIN, FIREBALL]);

    // `pf2e.bestiary` is audience "gm": the player's list of visible packs has
    // only the spells pack, so the bestiary pin simply is not drawn.
    const drawn = filterByVisiblePacks(loadPinnedEntries(WORLD, PLAYER), ["pf2e.spells"]);

    expect(drawn).toEqual([FIREBALL]);
    // No error, and nothing destroyed: the pin comes back if the pack does.
    expect(loadPinnedEntries(WORLD, PLAYER)).toEqual([GOBLIN, FIREBALL]);
  });

  it("REQ-CPD-084: one unreadable row does not cost the user the rest of the list", () => {
    localStorageMock.setItem(
      compendiumPinsKey(WORLD, GM),
      JSON.stringify([FIREBALL, { uuid: "" }, null, "nope", { packId: "pf2e.spells" }, GOBLIN]),
    );

    expect(loadPinnedEntries(WORLD, GM)).toEqual([FIREBALL, GOBLIN]);
  });

  it("REQ-CPD-084: a corrupt file is an empty list, never a thrown error", () => {
    localStorageMock.setItem(compendiumPinsKey(WORLD, GM), "{{{");

    expect(loadPinnedEntries(WORLD, GM)).toEqual([]);
  });

  it("REQ-CPD-082: the same entry pinned twice is stored once", () => {
    localStorageMock.setItem(compendiumPinsKey(WORLD, GM), JSON.stringify([FIREBALL, FIREBALL]));

    expect(loadPinnedEntries(WORLD, GM)).toEqual([FIREBALL]);
  });
});

// ---------------------------------------------------------------------------
// Recently used
// ---------------------------------------------------------------------------

describe("REQ-CPD-083: recently used", () => {
  it("REQ-CPD-083: previewing and bringing an entry over both feed the block, newest first", () => {
    let recent: readonly CompendiumRecentEntry[] = [];
    recent = recordRecentEntry(recent, FIREBALL, "preview", 1_000);
    recent = recordRecentEntry(recent, GOBLIN, "import", 2_000);

    expect(recent.map((row) => row.uuid)).toEqual([GOBLIN.uuid, FIREBALL.uuid]);
    expect(recent[0]?.reason).toBe("import");
    expect(recent[1]?.reason).toBe("preview");
  });

  it("REQ-CPD-083: using the same entry again moves it up instead of listing it twice", () => {
    let recent = recordRecentEntry([], FIREBALL, "preview", 1_000);
    recent = recordRecentEntry(recent, GOBLIN, "preview", 2_000);
    recent = recordRecentEntry(recent, FIREBALL, "import", 3_000);

    expect(recent.map((row) => row.uuid)).toEqual([FIREBALL.uuid, GOBLIN.uuid]);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.reason).toBe("import");
  });

  it("REQ-CPD-083: the block has a fixed ceiling and no setting to change it", () => {
    let recent: readonly CompendiumRecentEntry[] = [];
    for (let index = 0; index < COMPENDIUM_RECENT_LIMIT + 5; index += 1) {
      recent = recordRecentEntry(
        recent,
        { ...FIREBALL, uuid: `uuid-${index}`, name: `Entrada ${index}` },
        "preview",
        1_000 + index,
      );
    }

    expect(recent).toHaveLength(COMPENDIUM_RECENT_LIMIT);
    expect(recent[0]?.uuid).toBe(`uuid-${COMPENDIUM_RECENT_LIMIT + 4}`);
    // The oldest ones are gone, not merely hidden.
    expect(recent.some((row) => row.uuid === "uuid-0")).toBe(false);
  });

  it("REQ-CPD-081/083: the block round-trips on the device, per world and user, still capped", () => {
    const rows: CompendiumRecentEntry[] = Array.from({ length: 20 }, (_, index) => ({
      ...FIREBALL,
      uuid: `uuid-${index}`,
      at: 1_000 + index,
      reason: "preview" as const,
    }));

    saveRecentEntries(WORLD, GM, [...rows].reverse());

    const loaded = loadRecentEntries(WORLD, GM);
    expect(loaded).toHaveLength(COMPENDIUM_RECENT_LIMIT);
    expect(loaded[0]?.uuid).toBe("uuid-19");
    expect(compendiumRecentKey(WORLD, GM)).toBe(`${COMPENDIUM_RECENT_KEY_PREFIX}:${WORLD}:${GM}`);
    expect(loadRecentEntries(WORLD, PLAYER)).toEqual([]);
  });

  it("REQ-CPD-083: a file grown by hand is still capped and ordered on read", () => {
    localStorageMock.setItem(
      compendiumRecentKey(WORLD, GM),
      JSON.stringify(
        Array.from({ length: 30 }, (_, index) => ({ ...FIREBALL, uuid: `u-${index}`, at: index })),
      ),
    );

    const loaded = loadRecentEntries(WORLD, GM);
    expect(loaded).toHaveLength(COMPENDIUM_RECENT_LIMIT);
    expect(loaded[0]?.at).toBe(29);
  });

  it("REQ-CPD-084: a recent entry from a pack that vanished is not drawn either", () => {
    const recent = recordRecentEntry(
      recordRecentEntry([], FIREBALL, "preview", 1_000),
      GOBLIN,
      "preview",
      2_000,
    );

    expect(filterByVisiblePacks(recent, ["pf2e.spells"]).map((row) => row.uuid)).toEqual([
      FIREBALL.uuid,
    ]);
  });
});

// ---------------------------------------------------------------------------
// The tab badge
// ---------------------------------------------------------------------------

describe("REQ-CPD-002..005: the badge of the Compendium tab", () => {
  it("REQ-CPD-002: the badge value is a boolean state dot, never a counter", () => {
    const running = beginBatchImport(NO_BATCH_IMPORTS, "run-1");

    expect(typeof batchImportBadgeValue(running)).toBe("boolean");
    expect(formatSidebarBadge(batchImportBadgeValue(running))).toEqual({ kind: "dot", text: null });
    expect(typeof compendiumImportBadge.value).toBe("boolean");
  });

  it("REQ-CPD-003: the dot lights while a batch import runs and goes out when it ends", () => {
    expect(formatSidebarBadge(compendiumImportBadge.value).kind).toBe("none");

    startCompendiumBatchImport("run-1");
    expect(compendiumImportBadge.value).toBe(true);

    finishCompendiumBatchImport("run-1");
    expect(compendiumImportBadge.value).toBe(false);
  });

  it("REQ-CPD-003: a failed or cancelled run puts the dot out the same way a finished one does", () => {
    startCompendiumBatchImport("run-cancelled");
    finishCompendiumBatchImport("run-cancelled");

    expect(compendiumImportBadge.value).toBe(false);
    expect(runningCompendiumBatchImports()).toEqual([]);
  });

  it("REQ-CPD-003: two overlapping batches keep the dot lit until both are done", () => {
    startCompendiumBatchImport("run-a");
    startCompendiumBatchImport("run-b");

    finishCompendiumBatchImport("run-a");
    expect(compendiumImportBadge.value).toBe(true);

    finishCompendiumBatchImport("run-b");
    expect(compendiumImportBadge.value).toBe(false);
  });

  it("REQ-CPD-003: ending a run twice cannot leave the dot lit, and an unknown id changes nothing", () => {
    const running = beginBatchImport(beginBatchImport(NO_BATCH_IMPORTS, "run-1"), "run-1");
    expect(running.running).toEqual(["run-1"]);

    const ended = endBatchImport(running, "run-1");
    expect(batchImportBadgeValue(endBatchImport(ended, "run-1"))).toBe(false);
    expect(endBatchImport(ended, "never-started")).toBe(ended);
  });

  it("REQ-CPD-004: opening the tab does not change the dot — only the work does", () => {
    startCompendiumBatchImport("run-1");

    // Whatever the drawer does — open, switch away, collapse — it only ever
    // READS the store; there is no argument here through which it could write.
    const openedTwice = [compendiumImportBadge.value, compendiumImportBadge.value];

    expect(openedTwice).toEqual([true, true]);
    expect(runningCompendiumBatchImports()).toEqual(["run-1"]);
  });

  it("REQ-CPD-005: with nothing running the tab shows no badge at all", () => {
    expect(batchImportBadgeValue(NO_BATCH_IMPORTS)).toBe(false);
    expect(formatSidebarBadge(compendiumImportBadge.value)).toEqual({ kind: "none", text: null });
  });
});
