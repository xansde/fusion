/**
 * prepareState.test.ts — preparing a scene is local to the Master (plan G084).
 *
 * The whole point of "preparar" is that it is NOT "pôr no ar": the Master's own canvas
 * changes, and nothing else does (DEC-CEN-03). This file pins that as behaviour —
 * which scene the canvas renders, what the persistent notice says, when the prepare
 * ends by itself, and, with a spy on the socket, that entering and leaving it emit
 * nothing at all.
 *
 * The RNF is asserted the strong way: the same socket that DOES carry the one write of
 * this module (putting the prepared scene on air) is watched through the entire
 * enter/leave lifecycle and never sees a single emit.
 *
 * Covers REQ-CEN-050, REQ-CEN-051, REQ-CEN-052, REQ-CEN-053, REQ-CEN-054, REQ-CEN-055,
 * REQ-CEN-056, RNF-CEN-03, REQ-CEN-003, REQ-CEN-004, REQ-CEN-005.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import type { Envelope, SceneDocument } from "@fusion/shared";

import {
  SCENE_PREPARE_KEYS,
  buildScenePrepareNoticeVM,
  enterScenePrepare,
  exitScenePrepare,
  isScenePreparing,
  putPreparedSceneOnAir,
  reconcileScenePrepare,
  resolveCanvasScene,
  scenePrepareBadge,
  scenePrepareState,
} from "../prepareState.svelte.js";
import { activeSceneState } from "../../docs/activeScene.svelte.js";
import { formatSidebarBadge } from "../../sidebar/badges.svelte.js";
import { buildSceneShelfVM } from "../sceneShelf.js";

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

const ON_AIR = makeScene({ _id: "s-air", name: "Taverna" });
const OTHER = makeScene({ _id: "s-crypt", name: "Cripta" });
const WORLD = [ON_AIR, OTHER];

interface FakeSocket {
  readonly socket: Socket;
  readonly sent: Envelope[];
}

/** A socket that records every envelope and acks it successfully. */
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

beforeEach(() => {
  scenePrepareState.sceneId = null;
  activeSceneState.id = ON_AIR._id;
  activeSceneState.scene = ON_AIR;
});

// ---------------------------------------------------------------------------
// Entering, and what the canvas draws
// ---------------------------------------------------------------------------

describe("preparing a scene (REQ-CEN-050..053)", () => {
  it("REQ-CEN-050: the prepared scene is what THIS canvas draws, and the scene on air does not move", () => {
    enterScenePrepare(OTHER._id, activeSceneState.id);

    expect(
      resolveCanvasScene({
        activeScene: activeSceneState.scene,
        scenes: WORLD,
        prepareSceneId: scenePrepareState.sceneId,
      }),
    ).toBe(OTHER);

    // The world's single source of truth is untouched: the table is still on the tavern.
    expect(activeSceneState.id).toBe(ON_AIR._id);
    expect(activeSceneState.scene).toBe(ON_AIR);
  });

  it("REQ-CEN-053: leaving the prepare puts this canvas back on the scene on air", () => {
    enterScenePrepare(OTHER._id, activeSceneState.id);
    exitScenePrepare();

    expect(scenePrepareState.sceneId).toBeNull();
    expect(
      resolveCanvasScene({
        activeScene: activeSceneState.scene,
        scenes: WORLD,
        prepareSceneId: scenePrepareState.sceneId,
      }),
    ).toBe(ON_AIR);
  });

  it("REQ-CEN-050: with no prepare the canvas is exactly the scene on air", () => {
    expect(resolveCanvasScene({ activeScene: ON_AIR, scenes: WORLD, prepareSceneId: null })).toBe(
      ON_AIR,
    );
    expect(
      resolveCanvasScene({ activeScene: null, scenes: WORLD, prepareSceneId: null }),
    ).toBeNull();
  });

  it("REQ-CEN-053: asking to prepare the scene already on air is not a prepare", () => {
    enterScenePrepare(ON_AIR._id, activeSceneState.id);

    expect(scenePrepareState.sceneId).toBeNull();
    expect(
      buildScenePrepareNoticeVM({
        scenes: WORLD,
        activeSceneId: ON_AIR._id,
        prepareSceneId: scenePrepareState.sceneId,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The write boundary — RNF-CEN-03 / REQ-CEN-051
// ---------------------------------------------------------------------------

describe("the prepare never reaches the server (REQ-CEN-051, RNF-CEN-03)", () => {
  it("RNF-CEN-03: entering and leaving the prepare emits nothing on the socket", async () => {
    const { socket, sent } = fakeSocket();

    enterScenePrepare(OTHER._id, activeSceneState.id);
    reconcileScenePrepare({ activeSceneId: ON_AIR._id, sceneIds: [ON_AIR._id, OTHER._id] });
    exitScenePrepare();
    enterScenePrepare(OTHER._id, activeSceneState.id);
    exitScenePrepare();

    expect(sent).toEqual([]);

    // And the socket is a working one: the only gesture of this module that WRITES
    // does reach it, so the emptiness above is the absence of a write, not a dead spy.
    enterScenePrepare(OTHER._id, activeSceneState.id);
    await putPreparedSceneOnAir(socket, OTHER._id);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("world:activeScene");
  });

  it("REQ-CEN-051: entering and leaving take no socket at all", () => {
    // The requirement is structural: a function with no socket in its signature cannot
    // write to the server, whatever a future refactor does to its body.
    expect(enterScenePrepare).toHaveLength(2);
    expect(exitScenePrepare).toHaveLength(0);
  });

  it("REQ-CEN-044: putting the prepared scene on air ends the prepare", async () => {
    const { socket } = fakeSocket();
    enterScenePrepare(OTHER._id, activeSceneState.id);

    await putPreparedSceneOnAir(socket, OTHER._id);

    expect(scenePrepareState.sceneId).toBeNull();
  });

  it("REQ-CEN-045: a refused activation leaves the prepare exactly where it was", async () => {
    const socket = {
      emit(_event: string, payload: Envelope, ack: (value: unknown) => void): void {
        ack({
          ok: false,
          code: "NOT_FOUND",
          message: "Scene not found",
          requestId: payload.requestId,
        });
      },
    } as unknown as Socket;

    enterScenePrepare(OTHER._id, activeSceneState.id);
    await expect(putPreparedSceneOnAir(socket, OTHER._id)).rejects.toThrow();

    expect(scenePrepareState.sceneId).toBe(OTHER._id);
  });
});

// ---------------------------------------------------------------------------
// The persistent notice — REQ-CEN-052
// ---------------------------------------------------------------------------

describe("the persistent canvas notice (REQ-CEN-052)", () => {
  it("REQ-CEN-052: the notice names the scene ON AIR and offers both actions", () => {
    enterScenePrepare(OTHER._id, activeSceneState.id);

    const vm = buildScenePrepareNoticeVM({
      scenes: WORLD,
      activeSceneId: ON_AIR._id,
      prepareSceneId: scenePrepareState.sceneId,
    });

    expect(vm).not.toBeNull();
    expect(vm?.preparedName).toBe("Cripta");
    expect(vm?.onAirName).toBe("Taverna");
    expect(vm?.onAir).toEqual({ key: SCENE_PREPARE_KEYS.onAir, vars: { name: "Taverna" } });
    expect(vm?.putOnAirKey).toBe(SCENE_PREPARE_KEYS.putOnAir);
    expect(vm?.exitKey).toBe(SCENE_PREPARE_KEYS.exit);
  });

  it("REQ-CEN-052: with nothing on air the notice says so instead of naming a scene", () => {
    activeSceneState.id = null;
    activeSceneState.scene = null;
    enterScenePrepare(OTHER._id, null);

    const vm = buildScenePrepareNoticeVM({
      scenes: WORLD,
      activeSceneId: null,
      prepareSceneId: scenePrepareState.sceneId,
    });

    expect(vm?.onAirName).toBeNull();
    expect(vm?.onAir).toEqual({ key: SCENE_PREPARE_KEYS.onAirEmpty });
  });

  it("REQ-CEN-052: no prepare, no notice", () => {
    expect(
      buildScenePrepareNoticeVM({
        scenes: WORLD,
        activeSceneId: ON_AIR._id,
        prepareSceneId: null,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ending by itself — REQ-CEN-054 / REQ-CEN-055
// ---------------------------------------------------------------------------

describe("a prepare that ends by itself (REQ-CEN-054, REQ-CEN-055)", () => {
  it("REQ-CEN-054: the prepared scene going on air from another origin ends the prepare, silently", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    // Another GM put the prepared scene on air: the world pointer moves under us.
    const ended = reconcileScenePrepare({
      activeSceneId: OTHER._id,
      sceneIds: [ON_AIR._id, OTHER._id],
    });

    expect(ended).toBe(true);
    expect(scenePrepareState.sceneId).toBeNull();
    // No error surface: the reconcile returns a boolean and throws nothing.
    expect(
      buildScenePrepareNoticeVM({
        scenes: WORLD,
        activeSceneId: OTHER._id,
        prepareSceneId: scenePrepareState.sceneId,
      }),
    ).toBeNull();
  });

  it("REQ-CEN-055: the prepared scene being deleted ends the prepare and the canvas goes back on air", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    const ended = reconcileScenePrepare({ activeSceneId: ON_AIR._id, sceneIds: [ON_AIR._id] });

    expect(ended).toBe(true);
    expect(scenePrepareState.sceneId).toBeNull();
    expect(
      resolveCanvasScene({
        activeScene: ON_AIR,
        scenes: [ON_AIR],
        prepareSceneId: scenePrepareState.sceneId,
      }),
    ).toBe(ON_AIR);
  });

  it("REQ-CEN-054: a prepare that still means something survives the reconcile", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    expect(
      reconcileScenePrepare({ activeSceneId: ON_AIR._id, sceneIds: [ON_AIR._id, OTHER._id] }),
    ).toBe(false);
    expect(scenePrepareState.sceneId).toBe(OTHER._id);
  });

  it("REQ-CEN-055: reconciling with no prepare is a no-op", () => {
    expect(reconcileScenePrepare({ activeSceneId: null, sceneIds: [] })).toBe(false);
    expect(scenePrepareState.sceneId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The tab's badge — REQ-CEN-003..005
// ---------------------------------------------------------------------------

describe("the tab's state dot (REQ-CEN-003, REQ-CEN-004, REQ-CEN-005)", () => {
  it("REQ-CEN-003: the badge is a state dot and never a counter", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    expect(typeof scenePrepareBadge.value).toBe("boolean");
    expect(formatSidebarBadge(scenePrepareBadge.value)).toEqual({ kind: "dot", text: null });
  });

  it("REQ-CEN-004: lit while a prepare differs from the scene on air, out when it stops differing", () => {
    expect(formatSidebarBadge(scenePrepareBadge.value).kind).toBe("none");

    enterScenePrepare(OTHER._id, ON_AIR._id);
    expect(scenePrepareBadge.value).toBe(true);

    // The prepared scene goes on air: same scene now, so the dot goes out even before
    // anyone reconciles.
    activeSceneState.id = OTHER._id;
    expect(scenePrepareBadge.value).toBe(false);

    activeSceneState.id = ON_AIR._id;
    expect(scenePrepareBadge.value).toBe(true);

    exitScenePrepare();
    expect(scenePrepareBadge.value).toBe(false);
  });

  it("REQ-CEN-005: the badge is a function of the prepare alone — the drawer is not an input", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    // Reading it many times, as an open/close/switch cycle of the drawer would, never
    // changes it: there is no "seen" side effect anywhere in this store.
    const reads = [scenePrepareBadge.value, scenePrepareBadge.value, scenePrepareBadge.value];

    expect(reads).toEqual([true, true, true]);
    expect(scenePrepareState.sceneId).toBe(OTHER._id);
  });
});

// ---------------------------------------------------------------------------
// The archive mark — REQ-CEN-056
// ---------------------------------------------------------------------------

describe("the archive distinguishes the prepared scene (REQ-CEN-056)", () => {
  it("REQ-CEN-056: the prepared line carries a written mark, not only a colour", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    const shelf = buildSceneShelfVM({
      scenes: WORLD,
      activeSceneId: ON_AIR._id,
      preparingSceneId: scenePrepareState.sceneId,
    });
    const entry = shelf.groups[0]?.entries[0];

    expect(entry?.sceneId).toBe(OTHER._id);
    expect(entry?.preparing).toBe(true);
    expect(entry?.marks.map((mark) => mark.id)).toContain("preparing");
    expect(entry?.marks.find((mark) => mark.id === "preparing")?.labelKey).toBe(
      SCENE_PREPARE_KEYS.mark,
    );
  });

  it("REQ-CEN-056: every other line is unmarked", () => {
    const shelf = buildSceneShelfVM({
      scenes: WORLD,
      activeSceneId: ON_AIR._id,
      preparingSceneId: null,
    });

    expect(shelf.groups[0]?.entries[0]?.preparing).toBe(false);
    expect(shelf.groups[0]?.entries[0]?.marks).toEqual([]);
  });

  it("REQ-CEN-056: isScenePreparing answers for one scene at a time", () => {
    enterScenePrepare(OTHER._id, ON_AIR._id);

    expect(isScenePreparing(OTHER._id)).toBe(true);
    expect(isScenePreparing(ON_AIR._id)).toBe(false);
  });
});
