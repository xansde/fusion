/**
 * NpcsBury.test.ts — burying the legacy Actors directory (G078).
 *
 * The plan's "pronto quando" for G078 is that the buried panel leaves no trace in
 * `packages/`. A grep is not a test, though, so what is asserted here is the
 * consequence the grep stands for: the gestures the buried panel was the last owner
 * of either moved to a tab that draws them, or are declared as having no screen.
 *
 *   - authoring a non-playable → the NPCs tab (spec 42, REQ-NPC-040/041);
 *   - deleting a non-playable → the NPCs tab (REQ-NPC-050);
 *   - creating a player's character → NO screen in this tab, in any form, ever
 *     (REQ-NPC-044, DEC-NPC-02, §2.2): its real address is spec 37's Usuários
 *     section (REQ-CFG-051, task G105), and until that lands there is deliberately
 *     no trigger for it anywhere in this tab — the second block of this file pins
 *     that absence, mirroring the precedent Q-NPC-06 already set for deletion;
 *   - deleting a player's character → NO screen at all, accepted in Q-NPC-06, which
 *     the third block pins so the absence stays deliberate instead of accidental.
 *
 * The client runs Vitest in a node environment, so the assertions read the
 * server-rendered markup (`svelte/server`).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import NpcsPanel from "../NpcsPanel.svelte";
import NpcCreateDialog from "../NpcCreateDialog.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { UNFILED_FOLDER_ID } from "../../../lib/npcs/folderTree.js";
import type { MoveTargetOption } from "../../../lib/npcs/moveActor.js";
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

/** One of each: a non-playable the tab owns, and a character it must not own. */
const ACTORS = [
  { _id: "act-bram00000001", name: "Bram", type: "npc", folder: null },
  { _id: "act-valeros00001", name: "Valeros", type: "character", folder: null },
];

const FOLDER_OPTIONS: MoveTargetOption[] = [
  { value: UNFILED_FOLDER_ID, name: "", depth: 0, current: true, unfiled: true },
];

function renderPanel(): string {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: ACTORS, Folder: [], Scene: [] },
  });
  return render(NpcsPanel, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-gm",
      isGm: true,
      activeSceneId: null,
    },
  }).body;
}

function renderDialog(initialTab: "bestiary" | "scratch" = "bestiary"): string {
  return render(NpcCreateDialog, {
    props: {
      socket: {} as never,
      initialFolderId: null,
      folderOptions: FOLDER_OPTIONS,
      initialTab,
      onClose: (): void => undefined,
    },
  }).body;
}

beforeEach(() => {
  storage.clear();
});

describe("G078: what the buried directory did, the NPCs tab does", () => {
  it("REQ-NPC-040: creating a non-playable is offered by a tab that exists", () => {
    const body = renderPanel();

    expect(body).toContain('data-action="new-npc"');
    // And the window it opens is the one with both doors (REQ-NPC-041), reachable
    // through its tab strip (A035) — only the active one renders at a time.
    expect(renderDialog("bestiary")).toContain('data-door="bestiary"');
    expect(renderDialog("scratch")).toContain('data-door="scratch"');
  });

  it("REQ-NPC-050: deleting a non-playable is offered on the row of a non-playable", () => {
    const body = renderPanel();

    expect(body).toContain('data-npc-delete="act-bram00000001"');
    expect(body).toContain('data-action="delete-npc"');
  });

  it("REQ-NPC-055: the character in the world is not listed, so it is not deletable here", () => {
    const body = renderPanel();

    // The row of the buried directory listed every actor, characters included, and
    // carried a delete button on each one. This panel lists non-playables only.
    expect(body).toContain('data-npc-id="act-bram00000001"');
    expect(body).not.toContain('data-npc-id="act-valeros00001"');
    expect(body).not.toContain('data-npc-delete="act-valeros00001"');
    expect(body).not.toContain("Valeros");
  });
});

describe("REQ-NPC-044 / DEC-NPC-02: creating a character has no trigger in this tab", () => {
  /**
   * §2.2 sends "criar personagem de jogador" to spec 37's Usuários section
   * (REQ-CFG-051, task G105), and DEC-NPC-02 is unconditional: "esta aba não
   * oferece criar personagem em lugar nenhum". No fenced-off, temporary or
   * secondary control earns an exception — a document created here would be
   * exactly the ownerless orphan DEC-NPC-02 exists to prevent, with no screen
   * anywhere to delete it (Q-NPC-06). These assertions fail loudly if such a
   * control is reintroduced before G105 gives it its real address.
   */
  it("REQ-NPC-044: the window renders no character-creation block, scaffolded or otherwise", () => {
    const body = renderDialog("scratch");

    expect(body).not.toContain('data-block="character-scaffolding"');
    expect(body).not.toContain("data-scaffolding");
    expect(body).not.toContain('data-action="create-character-scaffolding"');
  });

  it("REQ-NPC-044: it is not a third subtype of the tab's own door", () => {
    const body = renderDialog("scratch");
    const select = /<select[^>]*data-input="npc-create-subtype"[\s\S]*?<\/select>/.exec(body)?.[0];

    expect(select).toBeDefined();
    const values = [...(select ?? "").matchAll(/<option[^>]*value="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(values).toEqual(["npc", "hazard"]);
    // The window as a whole offers no `character` value anywhere.
    expect(body).not.toContain('value="character"');
  });

  it("REQ-NPC-044: the window says a player's character is not born of this tab", () => {
    expect(renderDialog()).toContain("Configurações");
  });
});

describe("Q-NPC-06: deleting a player's character has no screen, and that is declared", () => {
  it("REQ-NPC-055: no panel of this tab offers deleting a character, in any role", () => {
    const gm = renderPanel();

    expect(gm).not.toContain('data-npc-delete="act-valeros00001"');

    const player = render(NpcsPanel, {
      props: {
        socket: {} as never,
        worldId: "world-1",
        userId: "user-player",
        isGm: false,
        activeSceneId: null,
      },
    }).body;
    expect(player).not.toContain('data-action="delete-npc"');
  });
});
