/**
 * npcsFooter.test.ts — the footer of the NPCs tab (spec 42 §5.8, G076).
 *
 * Covers REQ-NPC-060 (a control that puts a chest on the scene on air — the
 * enable/disable rule AND the two ops that actually land one there), plus
 * DEC-ATR-09 (`45`), which closed Q-NPC-04 and Q-NPC-05 by making the chest an
 * actor. REQ-NPC-061 (the chest reaches neither the directory, nor the search,
 * nor a folder count, nor the knowledge window — DEC-NPC-08, unchanged by
 * DEC-ATR-09) and REQ-NPC-072/REQ-NPC-073 (the footer opens the SAME "Quem
 * conhece quem" window the Contatos tab opens — one component, one singleton
 * key, one knowledge model).
 *
 * `placeChest` writes twice: a `doc:create` mints the chest's actor, and a
 * SECOND `doc:create` — embedded, `documentType: "Token"` with
 * `parent: { type: "Scene", id }` — lands a `Token` for it on the target
 * scene (REQ-NPC-060), `actorId` set (REQ-DOC-031). This is the shape
 * `TokenAddDialog.svelte`'s fixed dialog also sends (A004, ajustes r1 item
 * 22: both call sites used to send a `doc:update` with a `$push`
 * pseudo-operator the server's Zod schema — `tokens: z.array(...)` —
 * rejected outright; sending the whole array back through `doc:update` is
 * also refused, on purpose, by the server's `rejectUnwritableField`). What is
 * still open (Q-NPC-03, owned by the unwritten Token spec `41`) is whether a
 * token is *linked* or *unlinked* to its actor (the `actorLink`/`actorDelta`
 * pair spec 02's "Herança token→actor" section describes) — neither field
 * exists on `TokenDocumentSchema` yet, so this module writes neither; it uses
 * only the bare `actorId` reference that already does.
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library —
 * so the wire assertions read what the fake socket recorded, and the "no op
 * leaves this footer" assertions read the sources.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Socket } from "socket.io-client";

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
  buildCreateChestActorOp,
  buildPlaceChestTokenOp,
  chestControlState,
  placeChest,
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

// ---------------------------------------------------------------------------
// Fake socket — records what went on the wire and acks it (createNpc.test.ts
// pattern): the wire is what a test proving a `doc:create` must inspect.
// ---------------------------------------------------------------------------

interface Sent {
  readonly event: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** The `_id`/`name` `fakeSocket` hands back for the `doc:create` half of `placeChest`. */
const CREATED_CHEST = { _id: "act-bau0newlycreated1", name: "Baú" };

function fakeSocket(sent: Sent[]): Socket {
  return {
    connected: true,
    emit(
      event: string,
      envelope: { type: string; payload: Record<string, unknown> },
      ack: (result: unknown) => void,
    ): void {
      sent.push({ event, type: envelope.type, payload: envelope.payload });
      if (envelope.type === "doc:create") {
        ack({ ok: true, result: { documentType: "Actor", documents: [CREATED_CHEST] } });
        return;
      }
      ack({ ok: true, result: {} });
    },
  } as unknown as Socket;
}

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

  it("REQ-NPC-060: the first write is exactly one `doc:create` of a loot Actor", () => {
    const op = buildCreateChestActorOp();

    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Actor");
    expect(op.payload.data).toHaveLength(1);
    expect(op.payload.data[0]?.["type"]).toBe(CHEST_ACTOR_SUBTYPE);
  });

  it("REQ-NPC-060 (A004): the second write is an embedded `doc:create` of a Token under the scene — never a `$push`, never a whole-array `doc:update`", () => {
    const op = buildPlaceChestTokenOp("scn-clareira001", "act-bau0newlycreated1", "Baú");

    // A004's exact regression: the old shape was `doc:update` with
    // `diff: { tokens: { $push: {...} } }`, which the server's Zod schema
    // (`tokens: z.array(...)`) rejects outright. Sending the whole array back
    // as a plain `doc:update` diff is also refused by the server on purpose
    // (`rejectUnwritableField`) — the fix is this embedded `doc:create`.
    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Token");
    expect(op.payload.parent).toEqual({ type: "Scene", id: "scn-clareira001" });
    expect(op.payload.data).toHaveLength(1);
    expect(op.payload.data[0]?.["actorId"]).toBe("act-bau0newlycreated1");
    expect(op.payload.data[0]?.["name"]).toBe("Baú");
    // No client-supplied `_id`: `handleEmbeddedCreate` mints it server-side.
    expect(op.payload.data[0]).not.toHaveProperty("_id");
    expect(JSON.stringify(op)).not.toContain("$push");
  });

  it("REQ-NPC-060: activating it sends the create, then the embedded token create, in order", async () => {
    const sent: Sent[] = [];
    await placeChest(fakeSocket(sent), "scn-clareira001");

    expect(sent).toHaveLength(2);

    expect(sent[0]?.type).toBe("doc:create");
    expect(sent[0]?.payload["documentType"]).toBe("Actor");
    const created = sent[0]?.payload["data"] as Record<string, unknown>[];
    expect(created).toHaveLength(1);
    expect(created[0]?.["type"]).toBe(CHEST_ACTOR_SUBTYPE);

    expect(sent[1]?.type).toBe("doc:create");
    expect(sent[1]?.payload["documentType"]).toBe("Token");
    expect(sent[1]?.payload["parent"]).toEqual({ type: "Scene", id: "scn-clareira001" });
    const tokenData = sent[1]?.payload["data"] as Record<string, unknown>[];
    // The actorId on the wire is the id `fakeSocket` handed back for the create
    // above — the two writes are chained, not two independent guesses.
    expect(tokenData[0]?.["actorId"]).toBe(CREATED_CHEST._id);
  });

  it("REQ-NPC-060 / Q-NPC-03: the token carries only actorId — no link/unlink field", () => {
    // `actorLink`/`actorDelta` are Q-NPC-03, owned by `41`, and
    // `TokenDocumentSchema` does not have them yet — so this module cannot
    // write them, and does not pretend to.
    const op = buildPlaceChestTokenOp("scn-clareira001", "act-bau0newlycreated1", "Baú");
    const newToken = op.payload.data[0];

    expect(newToken?.["actorId"]).toBe("act-bau0newlycreated1");
    expect(newToken).not.toHaveProperty("actorLink");
    expect(newToken).not.toHaveProperty("actorDelta");
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-061 — the chest is never listed by this tab
// ---------------------------------------------------------------------------

describe("REQ-NPC-061: the chest is nowhere the tab counts, even though it is an actor", () => {
  const ACTORS = [
    { _id: "act-lobo00000001", name: "Lobo", type: "npc", folder: "fld-bosque0000001" },
    { _id: "act-armadilha001", name: "Armadilha", type: "hazard", folder: null },
    { _id: "act-fofurinha01x", name: "Fofurinha", type: "character", folder: null },
    // A container, exactly as `buildCreateChestActorOp` creates one: no folder.
    {
      _id: "act-bau000000001",
      name: "Baú",
      type: CHEST_ACTOR_SUBTYPE,
      folder: null,
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

  it("REQ-NPC-061: the actor's `doc:create` writes no folder, no attitude and no knowledge", () => {
    const op = buildCreateChestActorOp();
    const doc = op.payload.data[0] as Record<string, unknown>;

    expect(doc["folder"]).toBeNull();
    expect(JSON.stringify(doc)).not.toContain("attitude");
    expect(JSON.stringify(doc)).not.toContain("knowledge");
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
