/**
 * npcsFooter.test.ts — the footer of the NPCs tab (spec 42 §5.8, G076).
 *
 * Covers REQ-NPC-060 (a control that puts a chest on the scene on air, and what it
 * does when there is no scene on air), REQ-NPC-061 (the chest is not an actor: it
 * reaches neither the directory, nor the search, nor a folder count, nor the
 * knowledge window) and REQ-NPC-072/REQ-NPC-073 (the footer opens the SAME "Quem
 * conhece quem" window the Contatos tab opens — one component, one singleton key,
 * one knowledge model).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the window assertions exercise the window manager itself and the "no op leaves
 * this footer" assertions read the sources.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import KnowledgeGridWindow from "../../../components/contacts/KnowledgeGridWindow.svelte";
import { windowManager } from "../../windows/window-manager.js";
import {
  KNOWLEDGE_WINDOW_KEY,
  knowledgeWindowOptions,
  openKnowledgeWindow,
} from "../../contacts/knowledgeWindow.js";
import { buildKnowledgeGrid } from "../../contacts/knowledgeGrid.js";
import { buildFolderTree } from "../folderTree.js";
import { buildNpcRows, toFolderedDocs } from "../npcRowVM.js";
import {
  CHEST_ACTOR_SUBTYPE,
  CHEST_WINDOW_KEY,
  chestControlState,
  openChestWindow,
} from "../npcsFooter.js";
import "../../i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage stub (node environment) — the window manager persists geometry.
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
  },
});

const SOCKET = {} as never;

/** Source with every comment removed, so prose about an op is never read as one. */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

beforeEach(() => {
  storage.clear();
  windowManager.closeAll();
});

// ---------------------------------------------------------------------------
// REQ-NPC-060 — the chest goes to the scene on air
// ---------------------------------------------------------------------------

describe("REQ-NPC-060: the footer's chest control", () => {
  it("REQ-NPC-060: it targets the scene on air", () => {
    const state = chestControlState("scn-clareira001");

    expect(state.enabled).toBe(true);
    expect(state.sceneId).toBe("scn-clareira001");
  });

  it("REQ-NPC-060: with no scene on air there is no destination, and it says so", () => {
    for (const empty of [null, undefined, ""]) {
      const state = chestControlState(empty);

      expect(state.enabled).toBe(false);
      expect(state.sceneId).toBeNull();
      // The reason is a message, not a shade of grey (REQ-NPC-093).
      expect(state.labelKey).toBe("FUSION.Npcs.Chest.NoScene");
    }
  });

  it("REQ-NPC-060: the control opens one chest window per table, however often it is used", () => {
    openChestWindow("scn-clareira001");
    openChestWindow("scn-clareira001");

    const chests = [...windowManager.windows.values()].filter(
      (entry) => entry.singletonKey === CHEST_WINDOW_KEY,
    );
    expect(chests).toHaveLength(1);
    expect(windowManager.windows.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-061 — the chest is not an actor
// ---------------------------------------------------------------------------

describe("REQ-NPC-061: the chest is not an actor, and is nowhere the tab counts", () => {
  const ACTORS = [
    { _id: "act-lobo00000001", name: "Lobo", type: "npc", folder: "fld-bosque0000001" },
    { _id: "act-armadilha001", name: "Armadilha", type: "hazard", folder: null },
    { _id: "act-fofurinha01x", name: "Fofurinha", type: "character", folder: null },
    // A container, if one had ever been created: the subtype pf2e declares for it.
    {
      _id: "act-bau000000001",
      name: "Baú da taverna",
      type: CHEST_ACTOR_SUBTYPE,
      folder: "fld-bosque0000001",
    },
  ];

  const FOLDERS = [
    { _id: "fld-bosque0000001", name: "Bosque", type: "Actor", parentId: null, sort: 0 },
  ];

  it("REQ-NPC-061: it is not a row of the directory and no search finds it", () => {
    const rows = buildNpcRows({ actors: ACTORS, isPrivileged: true });
    expect(rows.map((row) => row.id)).not.toContain("act-bau000000001");

    const found = buildNpcRows({ actors: ACTORS, isPrivileged: true, query: "baú" });
    expect(found).toHaveLength(0);
  });

  it("REQ-NPC-061: it is in no folder count, and in no unfiled group", () => {
    // The tab's real pipeline: what the rows kept is what the tree counts.
    const rows = buildNpcRows({ actors: ACTORS, isPrivileged: true });
    const tree = buildFolderTree(FOLDERS, toFolderedDocs(rows));

    expect(tree.byId.get("fld-bosque0000001")?.subtreeCount).toBe(1);
    expect(tree.unfiled.map((doc) => doc._id)).toEqual(["act-armadilha001"]);
  });

  it("REQ-NPC-061: it is not a row of the knowledge window", () => {
    const grid = buildKnowledgeGrid(ACTORS);

    expect(grid.rows.map((row) => row.id)).toEqual(["act-armadilha001", "act-lobo00000001"]);
    expect(grid.rows.map((row) => row.id)).not.toContain("act-bau000000001");
  });

  it("REQ-NPC-061: the footer creates no document at all — no actor to hide anywhere", () => {
    const logic = source("../npcsFooter.ts");
    const footer = source("../../../components/npcs/NpcsFooter.svelte");
    const window_ = source("../../../components/npcs/ChestWindow.svelte");

    for (const code of [logic, footer, window_]) {
      expect(code).not.toContain("doc:create");
      expect(code).not.toContain("sendOp");
      expect(code).not.toContain("documentType");
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-072 / REQ-NPC-073 — the same window, not a second one
// ---------------------------------------------------------------------------

describe("REQ-NPC-072: the footer opens the Contatos tab's window, not a second one", () => {
  it("REQ-NPC-072: it is the very same component, under the very same key", () => {
    const options = knowledgeWindowOptions(SOCKET);

    expect(options.component).toBe(KnowledgeGridWindow);
    expect(options.singletonKey).toBe(KNOWLEDGE_WINDOW_KEY);
  });

  it("REQ-NPC-072: opening it from both footers leaves one window on the table", () => {
    const first = openKnowledgeWindow(SOCKET);
    const second = openKnowledgeWindow(SOCKET);

    expect(windowManager.windows.size).toBe(1);
    expect(second).toBeDefined();
    expect(first).toBeDefined();
  });

  it("REQ-NPC-073: both tabs go through the one opener, so knowledge has one model", () => {
    const contacts = source("../../../components/contacts/ContactsPanel.svelte");
    const npcs = source("../../../components/npcs/NpcsFooter.svelte");
    const opener = source("../../contacts/knowledgeWindow.ts");

    expect(contacts).toContain("openKnowledgeWindow");
    expect(npcs).toContain("openKnowledgeWindow");
    // Neither panel opens a window of its own: there is exactly one open call.
    expect(contacts).not.toContain("windowManager.open");
    expect(npcs).not.toContain("windowManager.open");
    expect([...opener.matchAll(/windowManager\.open/g)]).toHaveLength(1);
    // And the footer alters no knowledge by itself (REQ-NPC-071): editing lives in
    // the window, which sends the single `actor:setKnowledge` op.
    expect(npcs).not.toContain("actor:setKnowledge");
  });
});
