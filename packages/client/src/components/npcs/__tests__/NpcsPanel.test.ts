/**
 * NpcsPanel.test.ts — the drawn folder tree of the NPCs tab (spec 42 §5.3, G070).
 *
 * Covers what only the rendered panel can show: REQ-NPC-020 (the tree is drawn,
 * nested), REQ-NPC-021 (create / rename / nest / delete are reachable from the
 * panel), REQ-NPC-022 (removal goes through `folder:delete` and never through
 * `doc:delete` of a Folder), REQ-NPC-023 (the pinned block at the top, with the
 * mother's path), REQ-NPC-026 (the subtree count on each folder) and REQ-NPC-014
 * ("Sem pasta" last, with no rename and no delete). G071 adds the two ways to move
 * an actor: REQ-NPC-028 (drag onto the folder AND an explicit control on the row,
 * reachable by keyboard) and REQ-NPC-029 ("Sem pasta" as a destination of both).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the assertions read the server-rendered markup (`svelte/server`) and, for what a
 * rendered string cannot show (which op a handler emits), the component's source.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import NpcsPanel from "../NpcsPanel.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { npcFolderPrefsKey } from "../../../lib/npcs/folderPrefs.js";
import { UNFILED_FOLDER_ID } from "../../../lib/npcs/folderTree.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage stub (node environment) — the pins live there and nowhere else.
// ---------------------------------------------------------------------------

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storage.set(key, value);
    },
    removeItem: (key: string): void => {
      storage.delete(key);
    },
    clear: (): void => {
      storage.clear();
    },
    key: (index: number): string | null => [...storage.keys()][index] ?? null,
    get length(): number {
      return storage.size;
    },
  },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD = "world-1";
const GM_ONE = "user-gm-one";
const GM_TWO = "user-gm-two";

const FOLDERS = [
  { _id: "fld-bosque0000001", name: "Bosque", type: "Actor", parentId: null, sort: 0 },
  { _id: "fld-aldeia0000001", name: "Aldeia", type: "Actor", parentId: null, sort: 0 },
  {
    _id: "fld-taverna000001",
    name: "Taverna",
    type: "Actor",
    parentId: "fld-aldeia0000001",
    sort: 0,
  },
];

const ACTORS = [
  {
    _id: "act-lobo00000001",
    name: "Lobo",
    type: "npc",
    img: "worlds/img/lobo.webp",
    folder: "fld-bosque0000001",
    system: {
      details: { level: { value: 3 } },
      // Never drawn, by any role (REQ-NPC-031): the values are unmistakable.
      attributes: { hp: { value: 137, max: 999 } },
    },
    items: [
      {
        _id: "itm-frightened01",
        name: "Amedrontado",
        type: "condition",
        system: { slug: "frightened", value: 2 },
      },
    ],
    flags: { fusion: { title: "Alfa da matilha", attitude: "enemy" } },
  },
  { _id: "act-urso00000001", name: "Urso", type: "npc", folder: "fld-bosque0000001" },
  { _id: "act-taverneiro01", name: "Taverneiro", type: "npc", folder: "fld-taverna000001" },
  { _id: "act-armadilha001", name: "Armadilha", type: "hazard", folder: null },
  // A sub-character of the Lobo: drawn inside his line, never as a line (REQ-NPC-034).
  {
    _id: "act-filhote00001",
    name: "Filhote",
    type: "familiar",
    folder: "fld-bosque0000001",
    system: { masterActorId: "act-lobo00000001", companionKind: "familiar" },
  },
  // A player's character: the Contatos tab's, never listed nor counted here.
  { _id: "act-fofurinha01x", name: "Fofurinha", type: "character", folder: "fld-bosque0000001" },
];

const SCENES = [
  {
    _id: "scn-clareira001",
    name: "Clareira",
    tokens: [
      { _id: "tok-a0000000000001", actorId: "act-lobo00000001", name: "Lobo A", x: 640, y: 480 },
      { _id: "tok-b0000000000001", actorId: "act-lobo00000001", name: "Lobo B", x: 720, y: 480 },
    ],
  },
  {
    _id: "scn-caverna0001",
    name: "Caverna",
    tokens: [
      { _id: "tok-c0000000000001", actorId: "act-lobo00000001", name: "Lobo C", x: 10, y: 10 },
    ],
  },
];

function seedMirror(): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: ACTORS, Folder: FOLDERS, Scene: SCENES },
  });
}

function renderPanel(userId = GM_ONE): string {
  return render(NpcsPanel, {
    props: {
      socket: {} as never,
      worldId: WORLD,
      userId,
      isGm: true,
      activeSceneId: null,
    },
  }).body;
}

const SOURCE = readFileSync(fileURLToPath(new URL("../NpcsPanel.svelte", import.meta.url)), "utf8");

/** The `<li>` of one folder row, up to the start of the next one. */
function folderRow(body: string, folderId: string): string | null {
  const match = new RegExp(
    `<li[^>]*data-folder-id="${folderId}"[\\s\\S]*?(?=<li[^>]*data-folder-id=|</ul>)`,
  ).exec(body);
  return match ? match[0] : null;
}

beforeEach(() => {
  storage.clear();
  seedMirror();
});

describe("REQ-NPC-020 / REQ-NPC-026: the tree, and the count of each folder", () => {
  it("REQ-NPC-020: every folder of the world is drawn, nested by parentId", () => {
    const body = renderPanel();

    for (const folder of FOLDERS) {
      expect(body).toContain(`data-folder-id="${folder._id}"`);
    }
    // Taverna is one level in; Aldeia and Bosque are roots.
    expect(folderRow(body, "fld-taverna000001")).toContain('data-depth="1"');
    expect(folderRow(body, "fld-aldeia0000001")).toContain('data-depth="0"');
  });

  it("REQ-NPC-026: the folder shows the count of its whole subtree", () => {
    const body = renderPanel();

    // Written by hand from the fixture: Aldeia holds nothing, Taverna holds one.
    expect(folderRow(body, "fld-aldeia0000001")).toContain('data-folder-count="1"');
    expect(folderRow(body, "fld-taverna000001")).toContain('data-folder-count="1"');
    // Bosque holds Lobo and Urso — and NOT Fofurinha, who is a player's character.
    expect(folderRow(body, "fld-bosque0000001")).toContain('data-folder-count="2"');
    expect(body).not.toContain("Fofurinha");
  });

  it("REQ-NPC-021: create, rename, nest and delete are all reachable from the panel", () => {
    const body = renderPanel();

    expect(body).toContain('data-action="new-root-folder"');
    expect(body).toContain('data-action="new-child-folder"');
    expect(body).toContain('data-action="rename-folder"');
    expect(body).toContain('data-action="delete-folder"');
  });
});

describe('REQ-NPC-014: "Sem pasta" is the last group, and is not a folder', () => {
  it("REQ-NPC-014: it comes last and holds the actors that belong to no folder", () => {
    const body = renderPanel();

    const unfiledAt = body.indexOf("data-unfiled");
    expect(unfiledAt).toBeGreaterThan(-1);
    for (const folder of FOLDERS) {
      expect(body.indexOf(`data-folder-id="${folder._id}"`)).toBeLessThan(unfiledAt);
    }
    expect(body).toContain('data-npc-id="act-armadilha001"');
  });

  it("REQ-NPC-014: it carries no rename, no delete and no pin", () => {
    const body = renderPanel();
    const unfiled = body.slice(body.indexOf("data-unfiled"));

    expect(unfiled).not.toContain('data-action="rename-folder"');
    expect(unfiled).not.toContain('data-action="delete-folder"');
    expect(unfiled).not.toContain('data-action="pin"');
  });
});

describe("REQ-NPC-023 / REQ-NPC-025: the pinned block, and whose device it belongs to", () => {
  it("REQ-NPC-023: a pinned folder gets a block at the top, with the mother's path", () => {
    storage.set(
      npcFolderPrefsKey(WORLD, GM_ONE),
      JSON.stringify({ pinned: ["fld-taverna000001"], collapsed: [] }),
    );
    const body = renderPanel();

    expect(body).toContain("data-npc-pinned-block");
    expect(body).toContain('data-pinned-folder-id="fld-taverna000001"');
    expect(body).toContain("Aldeia");
    // The block sits ABOVE the tree, outside the folder's own position.
    expect(body.indexOf("data-npc-pinned-block")).toBeLessThan(body.indexOf("data-npc-tree"));
    // And the folder is still drawn in its own place (REQ-NPC-023).
    expect(folderRow(body, "fld-taverna000001")).toContain('data-pinned="true"');
  });

  it("REQ-NPC-025: a second Mestre, in the same world, sees no pinned block at all", () => {
    storage.set(
      npcFolderPrefsKey(WORLD, GM_ONE),
      JSON.stringify({ pinned: ["fld-taverna000001"], collapsed: [] }),
    );

    expect(renderPanel(GM_ONE)).toContain("data-npc-pinned-block");
    // Same world, same documents, another seat: the pin is not in the world.
    expect(renderPanel(GM_TWO)).not.toContain("data-npc-pinned-block");
  });

  it("REQ-NPC-024: with nothing pinned there is no block, and the tree order is the natural one", () => {
    const body = renderPanel();

    expect(body).not.toContain("data-npc-pinned-block");
    expect(body.indexOf('data-folder-id="fld-aldeia0000001"')).toBeLessThan(
      body.indexOf('data-folder-id="fld-bosque0000001"'),
    );
  });

  it("REQ-NPC-025: no socket op in this panel carries a pin or a collapse", () => {
    // A rendered string cannot show what a handler emits, so this reads the source:
    // the pin gesture must reach `saveNpcFolderPrefs` and never `sendOp`.
    const pinHandler = /function onTogglePin\([\s\S]*?\n  }/.exec(SOURCE)?.[0] ?? "";
    const collapseHandler = /function onToggleCollapse\([\s\S]*?\n  }/.exec(SOURCE)?.[0] ?? "";

    expect(pinHandler).toContain("persist(");
    expect(pinHandler).not.toContain("sendOp");
    expect(collapseHandler).toContain("persist(");
    expect(collapseHandler).not.toContain("sendOp");
    expect(SOURCE).toContain("saveNpcFolderPrefs");
  });
});

describe("REQ-NPC-028 / REQ-NPC-029: moving has two paths, and both are drawn", () => {
  it("REQ-NPC-028: every non-playable row is draggable and every folder is a drop zone", () => {
    const body = renderPanel();

    // Path one: the row travels, the folder receives.
    for (const actor of [
      "act-lobo00000001",
      "act-urso00000001",
      "act-taverneiro01",
      "act-armadilha001",
    ]) {
      const row = new RegExp(`<li[^>]*data-npc-id="${actor}"[^>]*>`).exec(body)?.[0] ?? "";
      expect(row).toContain('draggable="true"');
    }
    for (const folder of FOLDERS) {
      expect(body).toContain(`data-drop-target="${folder._id}"`);
    }
  });

  it("REQ-NPC-028: a folder pinned to the top block takes the drop too", () => {
    storage.set(
      npcFolderPrefsKey(WORLD, GM_ONE),
      JSON.stringify({ pinned: ["fld-taverna000001"], collapsed: [] }),
    );
    const body = renderPanel();
    const block = body.slice(body.indexOf("data-npc-pinned-block"), body.indexOf("data-npc-tree"));

    // The shortcut is the same folder: a Mestre who pinned it to reach it faster
    // must be able to drop on it there.
    expect(block).toContain('data-drop-target="fld-taverna000001"');
  });

  it("REQ-NPC-028: every row carries the explicit control, which a keyboard can reach", () => {
    const body = renderPanel();

    // Path two: a native <select> — focusable on its own, no custom key handling.
    for (const actor of [
      "act-lobo00000001",
      "act-urso00000001",
      "act-taverneiro01",
      "act-armadilha001",
    ]) {
      expect(body).toContain(`data-npc-move="${actor}"`);
    }
    expect(body).toContain('data-action="move-npc"');
    // One per non-playable, and not one for Fofurinha, who is not listed here.
    expect(body.match(/<select[^>]*data-action="move-npc"/g) ?? []).toHaveLength(4);
  });

  it("REQ-NPC-028: the control offers every folder of the world as a destination", () => {
    const body = renderPanel();
    const control =
      /<select[^>]*data-npc-move="act-lobo00000001"[\s\S]*?<\/select>/.exec(body)?.[0] ?? "";

    for (const folder of FOLDERS) {
      expect(control).toContain(`value="${folder._id}"`);
    }
    // Lobo lives in Bosque, so that is the option already selected.
    expect(/value="fld-bosque0000001"[^>]*selected/.test(control)).toBe(true);
  });

  it('REQ-NPC-029: "Sem pasta" is a destination of the drag AND of the control', () => {
    const body = renderPanel();
    const unfiled = body.slice(body.indexOf("data-unfiled"));
    const control =
      /<select[^>]*data-npc-move="act-lobo00000001"[\s\S]*?<\/select>/.exec(body)?.[0] ?? "";

    // The drag: the group without a folder accepts a drop like any folder does.
    expect(unfiled).toContain(`data-drop-target="${UNFILED_FOLDER_ID}"`);
    // The control: the same destination, by keyboard.
    expect(control).toContain(`value="${UNFILED_FOLDER_ID}"`);
  });

  it("REQ-NPC-029: an actor already outside every folder has Sem pasta selected", () => {
    const body = renderPanel();
    const control =
      /<select[^>]*data-npc-move="act-armadilha001"[\s\S]*?<\/select>/.exec(body)?.[0] ?? "";

    expect(new RegExp(`value="${UNFILED_FOLDER_ID}"[^>]*selected`).test(control)).toBe(true);
  });

  it("REQ-NPC-028: both gestures end in the same operation builder", () => {
    // A rendered string cannot show which op a handler emits. What matters is that
    // the drop and the control do not each invent their own move: both reach
    // `moveNpc`, which is the only place that builds the op.
    const dropHandler = /function onFolderDrop\([\s\S]*?\n  }/.exec(SOURCE)?.[0] ?? "";
    const move = /async function moveNpc\([\s\S]*?\n  }/.exec(SOURCE)?.[0] ?? "";

    expect(dropHandler).toContain("moveNpc(");
    expect(SOURCE).toContain("void moveNpc(doc._id");
    expect(move).toContain("buildMoveActorOp(");
    expect(move).toContain("sendOp(socket, op)");
  });
});

describe("REQ-NPC-022: removing a folder never goes through doc:delete", () => {
  it("REQ-NPC-022: the panel emits folder:delete, the composed operation", () => {
    expect(SOURCE).toContain('type: "folder:delete"');
    // A `doc:delete` of a Folder would leave the actors pointing at an id that is
    // gone and the subfolders orphaned — the whole reason the composed op exists.
    expect(SOURCE).not.toContain('type: "doc:delete"');
  });

  it("REQ-NPC-022: the confirmation says the actors are not deleted", () => {
    // The message is the i18n key's, and the key says where the contents go.
    expect(SOURCE).toContain("FUSION.Npcs.Folder.DeleteConfirm");
  });
});

// ---------------------------------------------------------------------------
// The line of the non-playable (spec 42 §5.4, G072)
// ---------------------------------------------------------------------------

/** The `<li>` of one non-playable row, up to the start of the next one. */
function npcRow(body: string, actorId: string): string {
  const match = new RegExp(
    `<li[^>]*data-npc-id="${actorId}"[\\s\\S]*?(?=<li[^>]*data-npc-id=|</ul>)`,
  ).exec(body);
  return match ? match[0] : "";
}

describe("REQ-NPC-030 / REQ-NPC-031: what the drawn line shows, and what it never shows", () => {
  it("REQ-NPC-030: portrait, name, title, level and attitude are all in the line", () => {
    const row = npcRow(renderPanel(), "act-lobo00000001");

    expect(row).toContain("Lobo");
    expect(row).toContain("Alfa da matilha");
    expect(row).toContain('data-npc-level="3"');
    expect(row).toContain('data-npc-attitude="enemy"');
    // The portrait is drawn by the shared component — either the image or its
    // initials fallback, but always a portrait and never a broken slot.
    expect(/<img|portrait/i.test(row)).toBe(true);
  });

  it("REQ-NPC-031: no hit point of any kind reaches the panel, for any role", () => {
    // 137/999 exist nowhere else in the fixture, so any leak — number, fraction,
    // bar or percentage — surfaces here (DEC-NPC-10).
    for (const body of [renderPanel(), renderPanel(GM_TWO)]) {
      expect(body).not.toContain("137");
      expect(body).not.toContain("999");
    }
    // And the panel has no code path that could draw one either.
    expect(SOURCE).not.toContain("attributes");
    expect(SOURCE).not.toMatch(/\bhp\b/);
  });

  it("REQ-NPC-030: a non-playable with no attitude draws no attitude at all", () => {
    const row = npcRow(renderPanel(), "act-urso00000001");

    expect(row).toContain("Urso");
    expect(row).not.toContain("data-npc-attitude");
  });
});

describe("REQ-NPC-032: the title lives in the line, and so does its editing", () => {
  it("REQ-NPC-032: a filled title is drawn as a title, and the edit is offered", () => {
    const row = npcRow(renderPanel(), "act-lobo00000001");

    expect(row).toContain('data-title-kind="title"');
    expect(row).toContain('data-action="edit-title"');
  });

  it("REQ-NPC-032: an empty title falls back to subtype and level, marked as such", () => {
    const row = npcRow(renderPanel(), "act-armadilha001");

    expect(row).toContain('data-title-kind="fallback"');
    // "Perigo" is the pt-BR label of the `hazard` subtype; the trap has level 0/none.
    expect(row).toContain("Perigo");
  });

  it("REQ-NPC-032: the write goes through the ordinary doc:update of the title flag", () => {
    // A rendered string cannot show what the handler emits: the title is the SAME
    // field spec 39 writes, through the same dot-path (`flags.fusion.title`).
    const commit = /async function commitTitle\([\s\S]*?\n  }/.exec(SOURCE)?.[0] ?? "";

    expect(commit).toContain("npcTitleDiff(next)");
    expect(commit).toContain('type: "doc:update"');
    expect(commit).toContain('documentType: "Actor"');
  });
});

describe("REQ-NPC-033 / REQ-NPC-034 / REQ-NPC-035: chips, sub-characters and the sheet", () => {
  it("REQ-NPC-033: the condition is drawn by the shared chip, with the value in the label", () => {
    const row = npcRow(renderPanel(), "act-lobo00000001");

    expect(row).toContain("Amedrontado 2");
    // The chip component of spec 39 (G063), not a second one written here.
    expect(SOURCE).toContain("ConditionChips");
  });

  it("REQ-NPC-034: the sub-character is inside its owner's line, and is not a line", () => {
    const body = renderPanel();
    const row = npcRow(body, "act-lobo00000001");

    expect(row).toContain('data-sub-of="act-lobo00000001"');
    expect(row).toContain('data-sub-id="act-filhote00001"');
    expect(row).toContain("Filhote");
    // Not a row of its own — and therefore not a move control of its own either.
    expect(body).not.toContain('data-npc-id="act-filhote00001"');
    expect(body).not.toContain('data-npc-move="act-filhote00001"');
  });

  it("REQ-NPC-035: the sheet is reachable by double-click AND by a keyboard control", () => {
    const body = renderPanel();

    expect(npcRow(body, "act-lobo00000001")).toContain('data-action="open-sheet"');
    // Both gestures call the same opener, so they cannot open two different things.
    expect(SOURCE).toContain("ondblclick={() => openSheet(row)}");
    expect(SOURCE).toContain("onclick={() => openSheet(row)}");
  });
});

describe("REQ-NPC-036: presences in the scenes, counted and located", () => {
  it("REQ-NPC-036: the line says how many presences and in which scenes", () => {
    const row = npcRow(renderPanel(), "act-lobo00000001");

    expect(row).toContain('data-npc-presence="3"');
    expect(row).toContain('data-npc-presence-scenes="2"');
    expect(row).toContain("Clareira");
    expect(row).toContain("Caverna");
  });

  it("REQ-NPC-036: nothing of any individual presence is drawn", () => {
    const body = renderPanel();

    // The scenes carry token ids, names and coordinates; none of them describes
    // the actor, so none of them belongs to this line.
    expect(body).not.toContain("tok-");
    expect(body).not.toContain("Lobo A");
    expect(body).not.toContain("640");
  });

  it("REQ-NPC-036: an actor with no presence draws no presence line", () => {
    expect(npcRow(renderPanel(), "act-urso00000001")).not.toContain("data-npc-presence");
  });
});

describe("REQ-NPC-010 / REQ-NPC-012: the search bar, and what a search hides", () => {
  it("REQ-NPC-010: a fixed bar with the search field, no tab title and no ✕", () => {
    const body = renderPanel();
    const header = body.slice(0, body.indexOf("data-npc-tree"));

    expect(header).toContain("data-npc-search");
    expect(header).not.toContain("✕");
    // No textual title of the tab: the drawer's rail already names it (DEC-GAV-03).
    expect(header).not.toContain("<h1");
    expect(header).not.toContain("<h2");
  });

  it("REQ-NPC-012: a folder with no result disappears, and the tree is not collapsed", () => {
    // A rendered string cannot type in a field. What the panel owes REQ-NPC-012 is
    // that the search feeds the tree and suspends the collapse without erasing it.
    expect(SOURCE).toContain("foldersWithResults(");
    expect(SOURCE).toContain("searching ? new Set<string>() : collapsedSet");
    expect(SOURCE).toContain("toFolderedDocs(npcRows)");
  });
});

describe("REQ-NPC-013: the rows of a folder are alphabetical in pt-BR", () => {
  it("REQ-NPC-013: Lobo before Urso inside Bosque", () => {
    const body = renderPanel();

    expect(body.indexOf('data-npc-id="act-lobo00000001"')).toBeLessThan(
      body.indexOf('data-npc-id="act-urso00000001"'),
    );
  });
});
