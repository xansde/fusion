/**
 * folderPrefs.test.ts — what the DEVICE remembers about the folder tree (G070).
 *
 * Covers REQ-NPC-025 (pins live in the client, keyed by world + user, invisible to
 * anyone else and never a change to the `Folder` document), REQ-NPC-027 (the
 * collapsed/expanded state has the same boundary and survives leaving the tab) and
 * REQ-NPC-024 (unpinning restores nothing, because nothing about position is kept).
 *
 * The "second Mestre on another device" of the plan's Pronto-quando is exercised
 * twice here: once as another `userId` on the SAME storage (a shared machine), and
 * once as an empty storage (another machine). The `Folder` half of that promise —
 * the document byte-identical before and after a pin — is asserted at the end: no
 * function in this module is even given a document to write.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearNpcFolderPrefs,
  emptyNpcFolderPrefs,
  loadNpcFolderPrefs,
  npcFolderPrefsKey,
  pruneNpcFolderPrefs,
  saveNpcFolderPrefs,
  toggleCollapsed,
  togglePinned,
  type NpcFolderPrefs,
} from "../folderPrefs.js";

// ---------------------------------------------------------------------------
// localStorage stub — the client's vitest runs in a node environment.
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
    key: (index: number): string | null => [...store.keys()][index] ?? null,
    get length(): number {
      return store.size;
    },
  },
});

const WORLD = "world-teste";
const GM_ONE = "user-gm-one";
const GM_TWO = "user-gm-two";

beforeEach(() => {
  store.clear();
});

describe("REQ-NPC-025: the pin lives on the device, keyed by world AND user", () => {
  it("REQ-NPC-025: a second Mestre on the same machine sees none of the first one's pins", () => {
    saveNpcFolderPrefs(WORLD, GM_ONE, { pinned: ["fld-bosque"], collapsed: [] });

    expect(loadNpcFolderPrefs(WORLD, GM_ONE).pinned).toEqual(["fld-bosque"]);
    // Same world, same browser, another seat: a different key, so a different set.
    expect(loadNpcFolderPrefs(WORLD, GM_TWO)).toEqual(emptyNpcFolderPrefs());
    expect(npcFolderPrefsKey(WORLD, GM_ONE)).not.toBe(npcFolderPrefsKey(WORLD, GM_TWO));
  });

  it("REQ-NPC-025: a second Mestre on ANOTHER device sees nothing at all", () => {
    saveNpcFolderPrefs(WORLD, GM_ONE, { pinned: ["fld-bosque"], collapsed: ["fld-aldeia"] });

    // Another machine is an empty storage — there is no server copy to sync from.
    const otherDevice = new Map(store);
    store.clear();
    expect(loadNpcFolderPrefs(WORLD, GM_ONE)).toEqual(emptyNpcFolderPrefs());

    // And nothing about the pin ever left this key.
    expect([...otherDevice.keys()]).toEqual([npcFolderPrefsKey(WORLD, GM_ONE)]);
  });

  it("REQ-NPC-025: the same user in another world keeps another set", () => {
    saveNpcFolderPrefs(WORLD, GM_ONE, { pinned: ["fld-bosque"], collapsed: [] });

    expect(loadNpcFolderPrefs("outro-mundo", GM_ONE)).toEqual(emptyNpcFolderPrefs());
  });

  it("REQ-NPC-025: an unreadable entry reads as nothing pinned, not as a crash", () => {
    store.set(npcFolderPrefsKey(WORLD, GM_ONE), "{not json");

    expect(loadNpcFolderPrefs(WORLD, GM_ONE)).toEqual(emptyNpcFolderPrefs());
  });

  it("REQ-NPC-025: pinning writes NOTHING to the Folder documents", () => {
    // The documents as the server sent them, serialized before the gesture.
    const folders = [
      { _id: "fld-bosque", name: "Bosque", type: "Actor", parentId: null, sort: 0 },
      { _id: "fld-aldeia", name: "Aldeia", type: "Actor", parentId: null, sort: 0 },
    ];
    const before = JSON.stringify(folders);

    let prefs: NpcFolderPrefs = loadNpcFolderPrefs(WORLD, GM_ONE);
    prefs = togglePinned(prefs, "fld-bosque");
    prefs = toggleCollapsed(prefs, "fld-aldeia");
    saveNpcFolderPrefs(WORLD, GM_ONE, prefs);

    // Byte-identical: the whole module only ever touched localStorage.
    expect(JSON.stringify(folders)).toBe(before);
    expect(loadNpcFolderPrefs(WORLD, GM_ONE)).toEqual({
      pinned: ["fld-bosque"],
      collapsed: ["fld-aldeia"],
    });
  });
});

describe("REQ-NPC-024: unpinning restores nothing, because nothing was kept", () => {
  it("REQ-NPC-024: pin then unpin leaves the stored value identical to before the pin", () => {
    const start: NpcFolderPrefs = { pinned: ["fld-aldeia"], collapsed: ["fld-taverna"] };

    const pinned = togglePinned(start, "fld-bosque");
    const unpinned = togglePinned(pinned, "fld-bosque");

    expect(pinned.pinned).toEqual(["fld-aldeia", "fld-bosque"]);
    // No index, no previous position, no ordering key — there is nothing to restore.
    expect(unpinned).toEqual(start);
    expect(Object.keys(unpinned).sort()).toEqual(["collapsed", "pinned"]);
  });
});

describe("REQ-NPC-027: collapsed/expanded is remembered with the same boundary", () => {
  it("REQ-NPC-027: the state written when the tab closed is what the tab reads when it opens", () => {
    let prefs = loadNpcFolderPrefs(WORLD, GM_ONE);
    prefs = toggleCollapsed(prefs, "fld-aldeia");
    saveNpcFolderPrefs(WORLD, GM_ONE, prefs);

    // Unmounting and mounting the panel again is exactly a fresh load.
    expect(loadNpcFolderPrefs(WORLD, GM_ONE).collapsed).toEqual(["fld-aldeia"]);

    prefs = toggleCollapsed(loadNpcFolderPrefs(WORLD, GM_ONE), "fld-aldeia");
    saveNpcFolderPrefs(WORLD, GM_ONE, prefs);
    expect(loadNpcFolderPrefs(WORLD, GM_ONE).collapsed).toEqual([]);
  });

  it("REQ-NPC-027: collapsing does not touch the pins, and pinning does not touch the collapse", () => {
    const start: NpcFolderPrefs = { pinned: ["fld-bosque"], collapsed: ["fld-aldeia"] };

    expect(togglePinned(start, "fld-nova").collapsed).toEqual(["fld-aldeia"]);
    expect(toggleCollapsed(start, "fld-nova").pinned).toEqual(["fld-bosque"]);
  });

  it("REQ-NPC-025: ids of folders that no longer exist are pruned instead of kept forever", () => {
    const prefs: NpcFolderPrefs = {
      pinned: ["fld-bosque", "fld-sumiu"],
      collapsed: ["fld-sumiu"],
    };

    expect(pruneNpcFolderPrefs(prefs, new Set(["fld-bosque"]))).toEqual({
      pinned: ["fld-bosque"],
      collapsed: [],
    });
  });

  it("REQ-NPC-025: clearing removes this user's entry and only his", () => {
    saveNpcFolderPrefs(WORLD, GM_ONE, { pinned: ["a"], collapsed: [] });
    saveNpcFolderPrefs(WORLD, GM_TWO, { pinned: ["b"], collapsed: [] });

    clearNpcFolderPrefs(WORLD, GM_ONE);

    expect(loadNpcFolderPrefs(WORLD, GM_ONE)).toEqual(emptyNpcFolderPrefs());
    expect(loadNpcFolderPrefs(WORLD, GM_TWO).pinned).toEqual(["b"]);
  });
});
