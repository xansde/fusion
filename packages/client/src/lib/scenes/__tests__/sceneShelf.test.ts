/**
 * sceneShelf.test.ts — the archive of the Cenas tab (plan G082, spec 44 §5.4).
 *
 * Below the head lives the archive: every OTHER scene of the world, grouped by the
 * folder of the document, in the manual order of the document (DEC-CEN-05). This file
 * pins that rule with no DOM and no socket — what the archive shows, in which order,
 * what the search hides, and what a reorder writes.
 *
 * Covers REQ-CEN-030, REQ-CEN-031, REQ-CEN-032, REQ-CEN-033, REQ-CEN-034, REQ-CEN-035,
 * REQ-CEN-036, REQ-CEN-037, REQ-CEN-039, plus the empty states of REQ-CEN-080/081 and
 * the keyboard half of the reorder (REQ-CEN-090).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import type { Envelope, SceneDocument } from "@fusion/shared";

import {
  SCENE_SHELF_KEYS,
  SCENE_SHELF_SEARCH_THRESHOLD,
  UNFILED_GROUP_KEY,
  buildSceneShelfVM,
  loadCollapsedSceneFolders,
  nextSortInFolder,
  persistSceneOrder,
  reorderTargetIndexForKey,
  reorderWithinGroup,
  saveCollapsedSceneFolders,
  sceneShelfCollapsedKey,
  toggleCollapsedSceneFolder,
} from "../sceneShelf.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScene(overrides: Partial<SceneDocument> & { _id: string }): SceneDocument {
  return {
    type: "Scene",
    name: "Cena",
    width: 4000,
    height: 3000,
    grid: { type: "square", size: 100 },
    background: null,
    backgroundColor: "#101018",
    thumb: null,
    darkness: 0,
    fogEnabled: false,
    folder: null,
    sort: 0,
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

/** Same scene, stamped with a creation time — the tie-break of the manual order. */
function createdAt(scene: SceneDocument, createdTime: number): SceneDocument {
  return { ...scene, _stats: { ...scene._stats, createdTime } } as unknown as SceneDocument;
}

function namesOf(group: { entries: readonly { name: string }[] } | undefined): string[] {
  return (group?.entries ?? []).map((entry) => entry.name);
}

interface FakeSocket {
  readonly socket: Socket;
  readonly sent: Envelope[];
}

/** A socket that records the envelope and acks it successfully, synchronously. */
function fakeSocket(): FakeSocket {
  const sent: Envelope[] = [];
  const socket = {
    emit(_event: string, payload: Envelope, ack: (value: unknown) => void): void {
      sent.push(payload);
      ack({ ok: true, seq: 1, requestId: payload.requestId, result: {} });
    },
  } as unknown as Socket;
  return { socket, sent };
}

/** A localStorage good enough for the preference round trip (the client runs in node). */
function installStorage(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => void values.set(key, value),
      removeItem: (key: string): void => void values.delete(key),
      clear: (): void => values.clear(),
    },
  });
  return values;
}

// ---------------------------------------------------------------------------
// Grouping and order
// ---------------------------------------------------------------------------

describe("the archive groups by folder (REQ-CEN-030)", () => {
  it("REQ-CEN-030: each scene lands in the group of its own folder, named by the folder document", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Taverna", folder: "f-ato1" }),
        makeScene({ _id: "s2", name: "Cripta", folder: "f-ato2" }),
        makeScene({ _id: "s3", name: "Porão", folder: "f-ato1" }),
      ],
      activeSceneId: null,
      folders: [
        { _id: "f-ato1", name: "Ato 1" },
        { _id: "f-ato2", name: "Ato 2" },
      ],
    });

    expect(vm.groups.map((group) => group.label)).toEqual(["Ato 1", "Ato 2"]);
    expect(namesOf(vm.groups[0])).toEqual(["Taverna", "Porão"]);
    expect(namesOf(vm.groups[1])).toEqual(["Cripta"]);
  });

  it("REQ-CEN-030: a folder this client has no document for still groups, under its id", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna", folder: "f-orfa" })],
      activeSceneId: null,
      folders: [],
    });

    expect(vm.groups).toHaveLength(1);
    expect(vm.groups[0]?.folderId).toBe("f-orfa");
    expect(vm.groups[0]?.label).toBe("f-orfa");
  });

  it("REQ-CEN-031: inside a group the scenes follow the manual order of the document", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Terceira", folder: "f", sort: 30 }),
        makeScene({ _id: "s2", name: "Primeira", folder: "f", sort: 10 }),
        makeScene({ _id: "s3", name: "Segunda", folder: "f", sort: 20 }),
      ],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
    });

    // Alphabetical order would say Primeira, Segunda, Terceira by luck — so the fixture
    // uses names whose alphabetical order (Primeira, Segunda, Terceira) matches the
    // manual one, and the assertion below is on `sort`, which is what actually decides.
    expect(namesOf(vm.groups[0])).toEqual(["Primeira", "Segunda", "Terceira"]);
    expect((vm.groups[0]?.entries ?? []).map((entry) => entry.sort)).toEqual([10, 20, 30]);
  });

  it("REQ-CEN-031: name order does not override the manual order", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Abadia", folder: "f", sort: 20 }),
        makeScene({ _id: "s2", name: "Zigurate", folder: "f", sort: 10 }),
      ],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
    });

    expect(namesOf(vm.groups[0])).toEqual(["Zigurate", "Abadia"]);
  });

  it("REQ-CEN-031: a scene created now enters at the end of its group", () => {
    const existing = [
      makeScene({ _id: "s1", name: "Primeira", folder: "f", sort: 0 }),
      makeScene({ _id: "s2", name: "Segunda", folder: "f", sort: 1 }),
    ];

    // What a creator must stamp so the newcomer lands last (REQ-CEN-031)...
    const sort = nextSortInFolder(existing, "f");
    expect(sort).toBeGreaterThan(1);

    const vm = buildSceneShelfVM({
      scenes: [...existing, makeScene({ _id: "s3", name: "Nova", folder: "f", sort })],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
    });
    expect(namesOf(vm.groups[0])).toEqual(["Primeira", "Segunda", "Nova"]);
  });

  it("REQ-CEN-031: scenes that share a sort keep creation order, so a newcomer is still last", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        createdAt(makeScene({ _id: "s2", name: "Nova", folder: "f" }), 200),
        createdAt(makeScene({ _id: "s1", name: "Velha", folder: "f" }), 100),
      ],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
    });

    expect(namesOf(vm.groups[0])).toEqual(["Velha", "Nova"]);
  });

  it("REQ-CEN-032: scenes with no folder form their own group, always last", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Solta", folder: null }),
        makeScene({ _id: "s2", name: "Cripta", folder: "f-z" }),
        makeScene({ _id: "s3", name: "Taverna", folder: "f-a" }),
      ],
      activeSceneId: null,
      // Deliberately named so that "Sem pasta" would NOT be last alphabetically.
      folders: [
        { _id: "f-a", name: "Ato 1" },
        { _id: "f-z", name: "Zona morta" },
      ],
    });

    const last = vm.groups[vm.groups.length - 1];
    expect(vm.groups).toHaveLength(3);
    expect(last?.folderId).toBeNull();
    expect(last?.key).toBe(UNFILED_GROUP_KEY);
    expect(last?.labelKey).toBe(SCENE_SHELF_KEYS.noFolder);
    expect(namesOf(last)).toEqual(["Solta"]);
  });

  it("REQ-CEN-036: the scene on air is not repeated in the archive", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Taverna", folder: "f" }),
        makeScene({ _id: "s2", name: "Cripta", folder: "f" }),
      ],
      activeSceneId: "s2",
      folders: [{ _id: "f", name: "Ato 1" }],
    });

    expect(vm.total).toBe(1);
    expect(namesOf(vm.groups[0])).toEqual(["Taverna"]);
    expect(vm.groups.flatMap((group) => group.entries.map((entry) => entry.sceneId))).not.toContain(
      "s2",
    );
  });

  it("REQ-CEN-036: a group left empty by the scene on air disappears with it", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Taverna", folder: "f-a" }),
        makeScene({ _id: "s2", name: "Cripta", folder: "f-b" }),
      ],
      activeSceneId: "s2",
      folders: [
        { _id: "f-a", name: "Ato 1" },
        { _id: "f-b", name: "Ato 2" },
      ],
    });

    expect(vm.groups.map((group) => group.label)).toEqual(["Ato 1"]);
  });
});

// ---------------------------------------------------------------------------
// What a line says (REQ-CEN-035)
// ---------------------------------------------------------------------------

describe("what each line of the archive says (REQ-CEN-035)", () => {
  it("REQ-CEN-035: name, dimensions and the environment marks that are on", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Cripta", width: 4200, height: 2800, darkness: 0.8 })],
      activeSceneId: null,
    });

    const entry = vm.groups[0]?.entries[0];
    expect(entry?.name).toBe("Cripta");
    expect(entry?.dimensions.vars).toEqual({ width: 4200, height: 2800 });
    expect(entry?.marks.map((mark) => mark.id)).toEqual(["darkness"]);
  });

  it("REQ-CEN-035: a lit scene with no fog carries no marks at all", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", darkness: 0, fogEnabled: false })],
      activeSceneId: null,
    });

    expect(vm.groups[0]?.entries[0]?.marks).toEqual([]);
  });

  it("REQ-CEN-035: fog and darkness are two distinct marks, each with its own label", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", darkness: 0.4, fogEnabled: true })],
      activeSceneId: null,
    });

    const marks = vm.groups[0]?.entries[0]?.marks ?? [];
    expect(marks.map((mark) => mark.id)).toEqual(["darkness", "fog"]);
    expect(marks.map((mark) => mark.labelKey)).toEqual([
      SCENE_SHELF_KEYS.markDarkness,
      SCENE_SHELF_KEYS.markFog,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Search (REQ-CEN-034)
// ---------------------------------------------------------------------------

describe("search over the archive (REQ-CEN-034)", () => {
  function manyScenes(count: number): SceneDocument[] {
    return Array.from({ length: count }, (_value, index) =>
      makeScene({ _id: `s${String(index)}`, name: `Cena ${String(index)}`, sort: index }),
    );
  }

  it("REQ-CEN-034: the search is offered once the world has more scenes than fit without scrolling", () => {
    const few = buildSceneShelfVM({ scenes: manyScenes(2), activeSceneId: null });
    const many = buildSceneShelfVM({
      scenes: manyScenes(SCENE_SHELF_SEARCH_THRESHOLD + 1),
      activeSceneId: null,
    });

    expect(few.searchable).toBe(false);
    expect(many.searchable).toBe(true);
  });

  it("REQ-CEN-034: a query matches the name of a scene", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Taverna do Javali", folder: "f" }),
        makeScene({ _id: "s2", name: "Cripta", folder: "f" }),
      ],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
      query: "javali",
    });

    expect(namesOf(vm.groups[0])).toEqual(["Taverna do Javali"]);
    expect(vm.hasResults).toBe(true);
  });

  it("REQ-CEN-034: a query matches the name of a FOLDER, keeping every scene in it", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Taverna", folder: "f-a" }),
        makeScene({ _id: "s2", name: "Cripta", folder: "f-a" }),
        makeScene({ _id: "s3", name: "Deserto", folder: "f-b" }),
      ],
      activeSceneId: null,
      folders: [
        { _id: "f-a", name: "Ato 1" },
        { _id: "f-b", name: "Ato 2" },
      ],
      query: "ato 1",
    });

    expect(vm.groups.map((group) => group.label)).toEqual(["Ato 1"]);
    expect(namesOf(vm.groups[0])).toEqual(["Taverna", "Cripta"]);
  });

  it("REQ-CEN-034: a group with no result is hidden, not shown empty", () => {
    const vm = buildSceneShelfVM({
      scenes: [
        makeScene({ _id: "s1", name: "Taverna", folder: "f-a" }),
        makeScene({ _id: "s2", name: "Deserto", folder: "f-b" }),
      ],
      activeSceneId: null,
      folders: [
        { _id: "f-a", name: "Ato 1" },
        { _id: "f-b", name: "Ato 2" },
      ],
      query: "taverna",
    });

    expect(vm.groups).toHaveLength(1);
    expect(vm.groups[0]?.label).toBe("Ato 1");
  });

  it("REQ-CEN-034: a query with no match hides every group and says so", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna", folder: "f" })],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
      query: "zzz",
    });

    expect(vm.groups).toEqual([]);
    expect(vm.hasResults).toBe(false);
    expect(vm.emptyKey).toBe(SCENE_SHELF_KEYS.noResults);
  });

  it("REQ-CEN-034 / REQ-CEN-033: a collapsed group opens while a search is running, so no result hides", () => {
    const input = {
      scenes: [makeScene({ _id: "s1", name: "Taverna", folder: "f" })],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
      collapsedFolderIds: ["f"],
    };

    expect(buildSceneShelfVM(input).groups[0]?.collapsed).toBe(true);
    expect(buildSceneShelfVM({ ...input, query: "tav" }).groups[0]?.collapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Which emptiness the archive is in (REQ-CEN-080, REQ-CEN-081, REQ-CEN-036)
// ---------------------------------------------------------------------------

describe("an empty archive says WHICH emptiness it is (REQ-CEN-080)", () => {
  it("REQ-CEN-080: a world with no scene at all invites creating the first", () => {
    const vm = buildSceneShelfVM({ scenes: [], activeSceneId: null });

    expect(vm.total).toBe(0);
    expect(vm.hasResults).toBe(false);
    expect(vm.emptyKey).toBe(SCENE_SHELF_KEYS.empty);
  });

  it("REQ-CEN-080 / REQ-CEN-036: a world whose ONLY scene is on air does not claim there is none", () => {
    // The archive is empty for the reason REQ-CEN-036 gives — the scene lives in the
    // head — and the head is naming it on the same screen. Saying "no scene created"
    // here would contradict the head two lines above it.
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna" })],
      activeSceneId: "s1",
    });

    expect(vm.total).toBe(0);
    expect(vm.hasResults).toBe(false);
    expect(vm.emptyKey).toBe(SCENE_SHELF_KEYS.onlyOnAir);
    expect(vm.emptyKey).not.toBe(SCENE_SHELF_KEYS.empty);
  });

  it("REQ-CEN-081: a search with no result is a third sentence, not either of the other two", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna" })],
      activeSceneId: null,
      query: "zzz",
    });

    expect(vm.emptyKey).toBe(SCENE_SHELF_KEYS.noResults);
  });

  it("REQ-CEN-080: with a line to draw there is no empty sentence at all", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1" }), makeScene({ _id: "s2" })],
      activeSceneId: "s1",
    });

    expect(vm.hasResults).toBe(true);
    expect(vm.emptyKey).toBeNull();
  });

  it("REQ-CEN-080 / REQ-CEN-081: the three sentences are three distinct keys", () => {
    const keys = [SCENE_SHELF_KEYS.empty, SCENE_SHELF_KEYS.onlyOnAir, SCENE_SHELF_KEYS.noResults];
    expect(new Set(keys).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Collapsed groups, on this device (REQ-CEN-033)
// ---------------------------------------------------------------------------

describe("collapsed groups live on the device (REQ-CEN-033)", () => {
  beforeEach(() => {
    installStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("REQ-CEN-033: the collapsed set is saved and read back for the same world and user", () => {
    saveCollapsedSceneFolders("world-1", "user-1", ["f-a", UNFILED_GROUP_KEY]);

    expect(loadCollapsedSceneFolders("world-1", "user-1")).toEqual(["f-a", UNFILED_GROUP_KEY]);
  });

  it("REQ-CEN-033: another user on the same device gets his own set, not this one", () => {
    saveCollapsedSceneFolders("world-1", "user-1", ["f-a"]);

    expect(loadCollapsedSceneFolders("world-1", "user-2")).toEqual([]);
    expect(loadCollapsedSceneFolders("world-2", "user-1")).toEqual([]);
    expect(sceneShelfCollapsedKey("world-1", "user-1")).not.toBe(
      sceneShelfCollapsedKey("world-1", "user-2"),
    );
  });

  it("REQ-CEN-033: nothing is written without a world and a user to own it", () => {
    saveCollapsedSceneFolders("", "", ["f-a"]);

    expect(loadCollapsedSceneFolders("", "")).toEqual([]);
  });

  it("REQ-CEN-033: corrupt storage reads as 'nothing collapsed' instead of throwing", () => {
    localStorage.setItem(sceneShelfCollapsedKey("world-1", "user-1"), "{ not json");

    expect(loadCollapsedSceneFolders("world-1", "user-1")).toEqual([]);
  });

  it("REQ-CEN-033: toggling adds and removes a group, and the VM follows it", () => {
    const collapsed = toggleCollapsedSceneFolder([], "f");
    expect(collapsed).toEqual(["f"]);
    expect(toggleCollapsedSceneFolder(collapsed, "f")).toEqual([]);

    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna", folder: "f" })],
      activeSceneId: null,
      folders: [{ _id: "f", name: "Ato 1" }],
      collapsedFolderIds: collapsed,
    });
    // Collapsed hides the lines, and never the group itself — it has to be reopenable.
    expect(vm.groups[0]?.collapsed).toBe(true);
    expect(namesOf(vm.groups[0])).toEqual(["Taverna"]);
  });

  it("REQ-CEN-033: the collapsed state never travels to the server — it is a storage value", () => {
    saveCollapsedSceneFolders("world-1", "user-1", ["f-a"]);

    const raw = localStorage.getItem(sceneShelfCollapsedKey("world-1", "user-1"));
    expect(raw).toBe(JSON.stringify(["f-a"]));
    expect(sceneShelfCollapsedKey("world-1", "user-1")).toMatch(/^fusion:/);
  });
});

// ---------------------------------------------------------------------------
// Reorder (REQ-CEN-037)
// ---------------------------------------------------------------------------

describe("reordering inside a group writes the document (REQ-CEN-037)", () => {
  const entries = [
    { sceneId: "s1", sort: 0 },
    { sceneId: "s2", sort: 1 },
    { sceneId: "s3", sort: 2 },
  ];

  it("REQ-CEN-037: dragging a scene to another position yields the new sorts", () => {
    const updates = reorderWithinGroup(entries, "s3", 0);

    expect(updates.map((update) => update.sceneId)).toEqual(["s3", "s1", "s2"]);
    expect(updates.map((update) => update.sort)).toEqual([0, 1, 2]);
  });

  it("REQ-CEN-037: dropping a scene where it already is writes nothing", () => {
    expect(reorderWithinGroup(entries, "s2", 1)).toEqual([]);
  });

  it("REQ-CEN-037: a scene that is not in the group is not a reorder", () => {
    expect(reorderWithinGroup(entries, "sX", 0)).toEqual([]);
  });

  it("REQ-CEN-037: the new order is written to the document, and only the order", async () => {
    const { socket, sent } = fakeSocket();

    await persistSceneOrder(socket, reorderWithinGroup(entries, "s1", 2));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("doc:update");
    const payload = sent[0]?.payload as {
      documentType: string;
      updates: { _id: string; diff: Record<string, unknown> }[];
    };
    expect(payload.documentType).toBe("Scene");
    expect(payload.updates.map((update) => update._id)).toEqual(["s2", "s3", "s1"]);
    for (const update of payload.updates) {
      expect(Object.keys(update.diff)).toEqual(["sort"]);
    }
  });

  it("REQ-CEN-037: nothing to reorder emits nothing", async () => {
    const { socket, sent } = fakeSocket();

    await persistSceneOrder(socket, []);

    expect(sent).toEqual([]);
  });

  // REQ-CEN-090: the drag of REQ-CEN-037 is a pointer gesture, and every action of the
  // line has to be reachable from the keyboard too. These pin the key → position rule
  // the panel's grip uses, so the two gestures end in the same reorder.
  it("REQ-CEN-090 / REQ-CEN-037: the arrows walk a scene one position through its group", () => {
    expect(reorderTargetIndexForKey("ArrowUp", 2)).toBe(1);
    expect(reorderTargetIndexForKey("ArrowDown", 0)).toBe(1);
  });

  it("REQ-CEN-090: a key that is not a reorder is left alone", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "Escape"]) {
      expect(reorderTargetIndexForKey(key, 1)).toBeNull();
    }
  });

  it("REQ-CEN-090 / REQ-CEN-037: the keyboard move produces the very same order a drag would", () => {
    const byKey = reorderWithinGroup(entries, "s3", reorderTargetIndexForKey("ArrowUp", 2) ?? 2);
    const byDrag = reorderWithinGroup(entries, "s3", 1);

    expect(byKey).toEqual(byDrag);
    expect(byKey.map((update) => update.sceneId)).toEqual(["s1", "s3", "s2"]);
  });

  it("REQ-CEN-090: pressing up on the first line, or down on the last, writes nothing", () => {
    // `reorderWithinGroup` clamps, and a clamped move that lands where the scene already
    // is returns no update — so the edge of the group is a no-op, not a bogus write.
    expect(reorderWithinGroup(entries, "s1", reorderTargetIndexForKey("ArrowUp", 0) ?? 0)).toEqual(
      [],
    );
    expect(
      reorderWithinGroup(entries, "s3", reorderTargetIndexForKey("ArrowDown", 2) ?? 2),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The footer (REQ-CEN-039)
// ---------------------------------------------------------------------------

describe("the footer of the panel (REQ-CEN-039)", () => {
  it("REQ-CEN-039: the archive always carries the line pointing the region map to the Hub", () => {
    const empty = buildSceneShelfVM({ scenes: [], activeSceneId: null });
    const full = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna" })],
      activeSceneId: null,
    });

    expect(empty.footer.key).toBe(SCENE_SHELF_KEYS.regionMap);
    expect(full.footer.key).toBe(SCENE_SHELF_KEYS.regionMap);
  });

  it("REQ-CEN-039: the region map is a note, not an entry — it is in no group", () => {
    const vm = buildSceneShelfVM({
      scenes: [makeScene({ _id: "s1", name: "Taverna" })],
      activeSceneId: null,
    });

    expect(vm.groups.flatMap((group) => group.entries.map((entry) => entry.sceneId))).toEqual([
      "s1",
    ]);
  });
});
