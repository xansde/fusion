/**
 * NpcsDelete.test.ts — what the delete gesture and its confirmation DRAW
 * (spec 42 §5.7, G075).
 *
 * Covers REQ-NPC-050 (the gesture exists, and only for a privileged seat),
 * REQ-NPC-051 (the confirmation shows the presences, the knowledge and the sheet's
 * items BEFORE anything falls), REQ-NPC-052 (an unfinished encounter refuses the
 * delete, naming it and saying how to unblock), REQ-NPC-053 and REQ-NPC-054 (the
 * two consequences are announced by name) and REQ-NPC-055 (the tab offers no
 * delete for a player's character, in any role).
 *
 * The client runs Vitest in a node environment, so the assertions read the
 * server-rendered markup (`svelte/server`).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { KnowledgeState, type ActorDeletePreviewResult } from "@fusion/shared";

import NpcsPanel from "../NpcsPanel.svelte";
import NpcDeleteDialog from "../NpcDeleteDialog.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage stub — the panel reads its pins from it at construction.
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

const ACTORS = [
  { _id: "act-bram00000001", name: "Bram", type: "npc", folder: null },
  { _id: "act-fosso0000001", name: "Fosso", type: "hazard", folder: null },
  // REQ-NPC-055: a player's character in the world. It is not a row of this tab,
  // so there is nothing here that could offer to delete it.
  { _id: "act-fofurinha001", name: "Fofurinha", type: "character", folder: null },
];

function renderPanel(isGm: boolean): string {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: ACTORS, Folder: [], Scene: [] },
  });
  return render(NpcsPanel, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: isGm ? "user-gm" : "user-player",
      isGm,
      activeSceneId: null,
    },
  }).body;
}

function previewOf(overrides: Partial<ActorDeletePreviewResult> = {}): ActorDeletePreviewResult {
  return {
    actorId: "act-bram00000001",
    name: "Bram",
    type: "npc",
    presences: [
      { sceneId: "scn-clareira0001", sceneName: "Clareira", presenceCount: 2 },
      { sceneId: "scn-caverna00001", sceneName: "Caverna", presenceCount: 1 },
    ],
    presenceCount: 3,
    knowledge: { general: KnowledgeState.Hidden, exceptionCount: 2, knownBy: 1, glimpsedBy: 1 },
    itemCount: 4,
    blockingCombats: [],
    deletable: true,
    ...overrides,
  };
}

function renderDialog(
  initialPreview: ActorDeletePreviewResult | null,
  subtype = "npc",
  name = "Bram",
): string {
  return render(NpcDeleteDialog, {
    props: {
      socket: {} as never,
      actorId: "act-bram00000001",
      name,
      subtype,
      initialPreview,
      onClose: (): void => undefined,
    },
  }).body;
}

/** The `<li>` of one non-playable row, up to the start of the next one. */
function npcRow(body: string, actorId: string): string {
  const match = new RegExp(
    `<li[^>]*data-npc-id="${actorId}"[\\s\\S]*?(?=<li[^>]*data-npc-id=|</ul>)`,
  ).exec(body);
  if (match === null) throw new Error(`no row for ${actorId}`);
  return match[0];
}

beforeEach(() => {
  storage.clear();
});

describe("REQ-NPC-050 / REQ-NPC-055: who is offered a delete, and for what", () => {
  it("REQ-NPC-050: the row of a non-playable carries the delete, for a privileged seat", () => {
    const row = npcRow(renderPanel(true), "act-bram00000001");

    expect(row).toContain('data-action="delete-npc"');
    expect(row).toContain('data-npc-delete="act-bram00000001"');
  });

  it("REQ-NPC-050: a hazard's row carries it too — it is a row of this tab", () => {
    expect(npcRow(renderPanel(true), "act-fosso0000001")).toContain('data-action="delete-npc"');
  });

  it("REQ-NPC-050: a seat without privilege is offered no delete at all", () => {
    const body = renderPanel(false);

    expect(body).not.toContain('data-action="delete-npc"');
  });

  it("REQ-NPC-055: the character is not a row of this tab, so no delete names it", () => {
    const body = renderPanel(true);

    expect(body).not.toContain("act-fofurinha001");
    expect(body).not.toContain("Fofurinha");
  });

  it("REQ-NPC-055: asked about a character anyway, the confirmation refuses and offers no delete", () => {
    const body = renderDialog(null, "character", "Fofurinha");

    expect(body).toContain("data-delete-not-here");
    expect(body).toContain('data-action="confirm-delete"');
    expect(body).toMatch(/data-action="confirm-delete"[^>]*disabled/);
  });
});

describe("REQ-NPC-051: the confirmation shows what falls, before it falls", () => {
  it("REQ-NPC-053: how many presences, and in which scenes", () => {
    const body = renderDialog(previewOf());

    expect(body).toContain('data-delete-presence="3"');
    expect(body).toContain('data-delete-scene="scn-clareira0001"');
    expect(body).toContain('data-delete-scene="scn-caverna00001"');
    expect(body).toContain("Clareira");
    expect(body).toContain("Caverna");
  });

  it("REQ-NPC-054: the knowledge recorded about the actor is announced as lost", () => {
    const body = renderDialog(previewOf());

    expect(body).toContain('data-delete-knowledge="2"');
    // The tally the reader needs: who knows, who glimpsed, how many exceptions.
    expect(body).toContain("2 exceções");
    expect(body).toContain("deixa de existir");
  });

  it("REQ-NPC-054: with nothing recorded, the confirmation says so instead of inventing a loss", () => {
    const body = renderDialog(
      previewOf({
        knowledge: {
          general: KnowledgeState.Hidden,
          exceptionCount: 0,
          knownBy: 0,
          glimpsedBy: 0,
        },
      }),
    );

    expect(body).toContain('data-delete-knowledge="0"');
    expect(body).toContain("Nenhum conhecimento gravado");
  });

  it("REQ-NPC-051: the sheet and its embedded items are named", () => {
    const body = renderDialog(previewOf());

    expect(body).toContain('data-delete-items="4"');
    expect(body).toContain("4 itens");
  });

  it("REQ-NPC-051: with the reading in hand and nothing blocking, the delete is offered", () => {
    const body = renderDialog(previewOf());

    expect(body).toContain('data-action="confirm-delete"');
    expect(body).not.toMatch(/data-action="confirm-delete"[^>]*disabled/);
    expect(body).not.toContain('data-delete-blocked="true"');
  });

  it("REQ-NPC-051: before the reading arrives, nothing is deletable and the wait is said", () => {
    const body = renderDialog(null);

    expect(body).toContain("data-delete-loading");
    expect(body).toMatch(/data-action="confirm-delete"[^>]*disabled/);
  });
});

describe("REQ-NPC-052: the refusal while an encounter is live", () => {
  const blocked = previewOf({
    blockingCombats: [
      {
        combatId: "cbt-emboscada01",
        sceneId: "scn-clareira0001",
        sceneName: "Clareira",
        combatantCount: 1,
      },
    ],
    deletable: false,
  });

  it("REQ-NPC-052: the delete is not offered, and the encounter is named", () => {
    const body = renderDialog(blocked);

    expect(body).toContain('data-delete-blocked="true"');
    expect(body).toContain('data-delete-combat="cbt-emboscada01"');
    expect(body).toMatch(/data-action="confirm-delete"[^>]*disabled/);
  });

  it("REQ-NPC-052: the refusal says how to unblock, not only that it refuses", () => {
    const body = renderDialog(blocked);

    expect(body).toContain("data-delete-unblock");
    expect(body).toContain("encerre o encontro");
    expect(body).toContain("tire o ator dele");
  });

  it("REQ-NPC-052: what falls is still shown, so the reader knows what is at stake", () => {
    const body = renderDialog(blocked);

    expect(body).toContain("data-delete-falls");
    expect(body).toContain('data-delete-presence="3"');
  });
});
