/**
 * NpcsCreate.test.ts — what the creation window and the panel that opens it DRAW
 * (spec 42 §5.6, G074).
 *
 * Covers REQ-NPC-040 (creation reachable from the head of the panel AND from the
 * head of each folder), REQ-NPC-041 (both doors in the same window), REQ-NPC-043
 * (subtype and name), REQ-NPC-044 (only `npc` and `hazard` are offered — and no
 * `character`, `familiar`, `loot` or vehicle anywhere), REQ-NPC-046 (a created
 * actor's row shows no preset, because none was stored) and REQ-NPC-047 (folder
 * and attitude at creation). REQ-NPC-038 rides along: the row now carries the
 * control that cycles the attitude, and a hazard's row does not.
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

const FOLDERS = [
  { _id: "fld-aldeia0000001", name: "Aldeia", type: "Actor", parentId: null, sort: 0 },
];

const ACTORS = [
  {
    _id: "act-bram00000001",
    name: "Bram",
    type: "npc",
    folder: "fld-aldeia0000001",
    flags: { fusion: { attitude: "neutral" } },
  },
  { _id: "act-fosso0000001", name: "Fosso", type: "hazard", folder: null },
];

function renderPanel(): string {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: ACTORS, Folder: FOLDERS, Scene: [] },
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

const FOLDER_OPTIONS: MoveTargetOption[] = [
  { value: "fld-aldeia0000001", name: "Aldeia", depth: 0, current: true, unfiled: false },
  { value: UNFILED_FOLDER_ID, name: "", depth: 0, current: false, unfiled: true },
];

function renderDialog(
  initialFolderId: string | null = "fld-aldeia0000001",
  initialTab: "bestiary" | "scratch" = "bestiary",
): string {
  return render(NpcCreateDialog, {
    props: {
      socket: {} as never,
      initialFolderId,
      folderOptions: FOLDER_OPTIONS,
      initialTab,
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

describe("REQ-NPC-040: creating a non-playable has two entry points in the panel", () => {
  it("REQ-NPC-040: the head of the panel offers it", () => {
    expect(renderPanel()).toContain('data-action="new-npc"');
  });

  it("REQ-NPC-040: the head of each folder offers it, naming that folder", () => {
    const body = renderPanel();

    expect(body).toContain('data-action="new-npc-in-folder"');
    // REQ-NPC-047: which folder the gesture came from is on the control itself.
    expect(body).toContain('data-npc-create-folder="fld-aldeia0000001"');
  });

  it("REQ-NPC-046: no row of the list carries a preset, because none was stored", () => {
    const body = renderPanel();

    expect(body).not.toContain("data-npc-preset");
    expect(body.toLowerCase()).not.toContain("mercador");
  });
});

describe("REQ-NPC-041 / REQ-NPC-043 / REQ-NPC-044: the window and its two doors", () => {
  it("REQ-NPC-041 / A035: both doors are reachable from the same window's tab strip", () => {
    const body = renderDialog();

    // Both tabs are always drawn (npcs-tab.prototype.html:2308-2338, .wtabs).
    expect(body).toContain('data-tab="bestiary"');
    expect(body).toContain('data-tab="scratch"');
  });

  it("A035: only the active tab's door is in the DOM — bestiary is the default", () => {
    const body = renderDialog();

    expect(body).toContain('data-door="bestiary"');
    expect(body).not.toContain('data-door="scratch"');
    // And the bestiary door is a search, not a browse of the whole compendium.
    expect(body).toContain('data-input="bestiary-search"');
  });

  it("A035: switching to the scratch tab shows only that door, not the bestiary one", () => {
    const body = renderDialog("fld-aldeia0000001", "scratch");

    expect(body).toContain('data-door="scratch"');
    expect(body).not.toContain('data-door="bestiary"');
  });

  it("REQ-NPC-043: the door from scratch asks for a subtype and a name", () => {
    const body = renderDialog("fld-aldeia0000001", "scratch");

    expect(body).toContain('data-input="npc-create-subtype"');
    expect(body).toContain('data-input="npc-create-name"');
    expect(body).toContain('data-action="create-npc"');
  });

  it("A035: the name field comes right after the subtype field, not at the bottom", () => {
    const body = renderDialog("fld-aldeia0000001", "scratch");
    const scratchDoor = /<section[^>]*data-door="scratch"[\s\S]*?<\/section>/.exec(body)?.[0];
    expect(scratchDoor).toBeDefined();

    const subtypeIndex = scratchDoor?.indexOf('data-input="npc-create-subtype"') ?? -1;
    const nameIndex = scratchDoor?.indexOf('data-input="npc-create-name"') ?? -1;
    expect(subtypeIndex).toBeGreaterThan(-1);
    expect(nameIndex).toBeGreaterThan(subtypeIndex);
  });

  it("REQ-NPC-044: exactly two subtypes are offered, and none of the four excluded ones", () => {
    const body = renderDialog("fld-aldeia0000001", "scratch");
    const select = /<select[^>]*data-input="npc-create-subtype"[\s\S]*?<\/select>/.exec(body)?.[0];
    expect(select).toBeDefined();

    const values = [...(select ?? "").matchAll(/<option[^>]*value="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(values).toEqual(["npc", "hazard"]);

    for (const refused of ["character", "familiar", "loot", "vehicle"]) {
      expect(body).not.toContain(`value="${refused}"`);
    }
  });

  it("REQ-NPC-047: folder and attitude are shared by both doors, below whichever is open", () => {
    for (const tab of ["bestiary", "scratch"] as const) {
      const body = renderDialog("fld-aldeia0000001", tab);

      expect(body).toContain('data-input="npc-create-folder"');
      expect(body).toContain('data-input="npc-create-attitude"');
      // Every folder of the tree, plus "Sem pasta".
      expect(body).toContain('value="fld-aldeia0000001"');
      expect(body).toContain(`value="${UNFILED_FOLDER_ID}"`);
    }
  });

  it("REQ-NPC-045: the preset is offered inside the scratch door, and only there", () => {
    const body = renderDialog("fld-aldeia0000001", "scratch");

    expect(body).toContain('data-input="npc-create-preset"');
    expect(body).toContain("Mercador");
    // REQ-NPC-046: it is a choice of the form, never a field of a document — the
    // panel that lists the created actors has none of these words.
    expect(renderPanel()).not.toContain('data-input="npc-create-preset"');
  });

  it("REQ-NPC-041: Cancelar stays on screen on both doors, not just the scratch one", () => {
    for (const tab of ["bestiary", "scratch"] as const) {
      const body = renderDialog("fld-aldeia0000001", tab);

      expect(body).toContain('data-action="cancel-create"');
    }
    // The primary "Criar" action is still door-specific: the bestiary door
    // confirms per hit row, not with a second button in the footer.
    expect(renderDialog("fld-aldeia0000001", "bestiary")).not.toContain('data-action="create-npc"');
  });

  it("A035: attitude renders before folder in the shared block, matching the prototype", () => {
    const body = renderDialog("fld-aldeia0000001", "bestiary");
    const shared = /<section[^>]*data-block="destination"[\s\S]*?<\/section>/.exec(body)?.[0];
    expect(shared).toBeDefined();

    const attitudeIndex = shared?.indexOf('data-input="npc-create-attitude"') ?? -1;
    const folderIndex = shared?.indexOf('data-input="npc-create-folder"') ?? -1;
    expect(attitudeIndex).toBeGreaterThan(-1);
    expect(folderIndex).toBeGreaterThan(attitudeIndex);
  });
});

describe("REQ-NPC-092: the tab strip is keyboard-operable without promising a keyboard it does not have", () => {
  it("REQ-NPC-092: the strip is a labelled group of toggle buttons, not an ARIA tablist", () => {
    const body = renderDialog();
    const strip = /<div[^>]*data-npc-create-tabs[\s\S]*?<\/div>/.exec(body)?.[0];
    expect(strip).toBeDefined();

    // Same call as SidebarRail.svelte (DEC-GAV-05): role="group" + aria-pressed,
    // never role="tablist"/role="tab", which promises arrow-key navigation this
    // strip does not implement.
    expect(strip).toContain('role="group"');
    expect(strip).not.toContain('role="tablist"');
    expect(strip).not.toContain('role="tab"');
    expect(strip).toContain("aria-label=");
  });

  it("REQ-NPC-092: each tab button reports its own state via aria-pressed", () => {
    /** The `<button ...>` that carries `data-tab="{tabId}"`, attributes only. */
    function tabButton(body: string, tabId: string): string {
      const match = new RegExp(`<button[^>]*data-tab="${tabId}"[^>]*>`).exec(body);
      if (match === null) throw new Error(`no tab button for ${tabId}`);
      return match[0];
    }

    const bestiaryBody = renderDialog("fld-aldeia0000001", "bestiary");
    const scratchBody = renderDialog("fld-aldeia0000001", "scratch");

    expect(tabButton(bestiaryBody, "bestiary")).toContain('aria-pressed="true"');
    expect(tabButton(bestiaryBody, "scratch")).toContain('aria-pressed="false"');
    expect(tabButton(scratchBody, "scratch")).toContain('aria-pressed="true"');
    expect(tabButton(scratchBody, "bestiary")).toContain('aria-pressed="false"');
  });
});

describe("REQ-NPC-038: the attitude is cycled on the row itself", () => {
  it("REQ-NPC-038: an npc's row carries the control, and it names the next value", () => {
    const row = npcRow(renderPanel(), "act-bram00000001");

    expect(row).toContain('data-action="cycle-attitude"');
    // neutral → enemy, the order the shared module owns.
    expect(row).toContain('data-attitude-next="enemy"');
  });

  it("REQ-NPC-038: a hazard's row carries no attitude control at all", () => {
    const row = npcRow(renderPanel(), "act-fosso0000001");

    expect(row).not.toContain('data-action="cycle-attitude"');
    expect(row).not.toContain("data-npc-attitude");
  });
});
