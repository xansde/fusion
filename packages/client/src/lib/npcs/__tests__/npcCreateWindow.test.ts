/**
 * npcCreateWindow.test.ts — creation opens a WINDOW, not a private modal
 * (spec 42 §5.6, G074).
 *
 * Covers REQ-NPC-040 (creation is reachable from the panel and from a folder),
 * REQ-NPC-041 (one window, and the dialog that carries the two doors is what is
 * mounted in it) and REQ-NPC-047 (the folder the gesture came from arrives
 * pre-selected — including on the second gesture, from another folder).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { windowManager } from "../../windows/window-manager.js";
import {
  NPC_CREATE_WINDOW_KEY,
  closeNpcCreateWindow,
  isNpcCreateWindowOpen,
  openNpcCreateWindow,
} from "../npcCreateWindow.js";
import type { MoveTargetOption } from "../moveActor.js";
import { UNFILED_FOLDER_ID } from "../folderTree.js";
import NpcCreateDialog from "../../../components/npcs/NpcCreateDialog.svelte";
import "../../i18n/index.js";

const socket = {} as never;

const FOLDER_OPTIONS: MoveTargetOption[] = [
  { value: "fld-aldeia0000001", name: "Aldeia", depth: 0, current: false, unfiled: false },
  { value: "fld-taverna000001", name: "Taverna", depth: 1, current: false, unfiled: false },
  { value: UNFILED_FOLDER_ID, name: "", depth: 0, current: true, unfiled: true },
];

function propsOfCreateWindow(): Record<string, unknown> {
  for (const entry of windowManager.windows.values()) {
    if (entry.singletonKey === NPC_CREATE_WINDOW_KEY) return entry.componentProps ?? {};
  }
  throw new Error("the creation window is not open");
}

beforeEach(() => {
  windowManager.closeAll();
});

describe("REQ-NPC-040 / REQ-NPC-041: creation is one window of the window manager", () => {
  it("REQ-NPC-041: the window mounts the dialog that carries the two doors", () => {
    openNpcCreateWindow({ socket, folderOptions: FOLDER_OPTIONS });

    const entries = [...windowManager.windows.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.component).toBe(NpcCreateDialog);
    expect(entries[0]?.singletonKey).toBe(NPC_CREATE_WINDOW_KEY);
    expect(isNpcCreateWindowOpen()).toBe(true);
  });

  it("REQ-NPC-040: asking twice from the same place focuses the window instead of stacking a twin", () => {
    openNpcCreateWindow({ socket, folderId: "fld-aldeia0000001", folderOptions: FOLDER_OPTIONS });
    openNpcCreateWindow({ socket, folderId: "fld-aldeia0000001", folderOptions: FOLDER_OPTIONS });

    expect([...windowManager.windows.values()]).toHaveLength(1);
  });

  it("REQ-NPC-040: closing it leaves nothing behind", () => {
    openNpcCreateWindow({ socket, folderOptions: FOLDER_OPTIONS });
    closeNpcCreateWindow();

    expect(isNpcCreateWindowOpen()).toBe(false);
    expect([...windowManager.windows.values()]).toHaveLength(0);
  });
});

describe("REQ-NPC-047: the folder of the gesture is the folder of the form", () => {
  it("REQ-NPC-047: creating from a folder head brings that folder pre-selected", () => {
    openNpcCreateWindow({ socket, folderId: "fld-taverna000001", folderOptions: FOLDER_OPTIONS });

    const props = propsOfCreateWindow();
    expect(props["initialFolderId"]).toBe("fld-taverna000001");
    expect(props["folderOptions"]).toEqual(FOLDER_OPTIONS);
  });

  it("REQ-NPC-047: creating from the panel head brings no folder — the actor is born unfiled", () => {
    openNpcCreateWindow({ socket, folderOptions: FOLDER_OPTIONS });

    expect(propsOfCreateWindow()["initialFolderId"]).toBeNull();
  });

  it("REQ-NPC-047: asking from ANOTHER folder re-seeds the form instead of focusing a stale one", () => {
    openNpcCreateWindow({ socket, folderId: "fld-aldeia0000001", folderOptions: FOLDER_OPTIONS });
    openNpcCreateWindow({ socket, folderId: "fld-taverna000001", folderOptions: FOLDER_OPTIONS });

    // Still one window (REQ-UIF-014), and it is the one the second gesture asked for.
    expect([...windowManager.windows.values()]).toHaveLength(1);
    expect(propsOfCreateWindow()["initialFolderId"]).toBe("fld-taverna000001");
  });
});
