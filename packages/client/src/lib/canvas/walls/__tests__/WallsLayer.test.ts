/**
 * WallsLayer.test.ts
 *
 * WallsLayer shipped in issue #83 with ZERO unit tests (canvasWiring.test.ts's
 * docstring claimed otherwise — that claim was itself wrong, see the fix
 * there). Found in review, 2026-08-12: that gap let two regressions of the
 * SAME shape ship green —
 *
 *   1. Wire protocol: `_sendDoorStateUpdate` kept sending `doc:update` with
 *      `documentType: "Scene"` and a dot-path diff on `walls.<id>.doorState`
 *      — the exact `$push`/`$pull`-era shape `_createWall`/`_sendWallsDelete`
 *      were fixed away from in the SAME commit. The server's
 *      `applyDotPathDiff` + `deepMerge` "mixed types" branch REPLACES
 *      `Scene.walls` (an array) with an object when it meets a nested diff
 *      like that, and `SceneSchema` rejects it — doors never opened for
 *      anyone. Nothing here would have gone red if `_createWall` or
 *      `_sendWallsDelete` were reverted to `$push`/`$pull` either.
 *
 *   2. Interactivity: `container` (the shared "controls" PIXI layer) is built
 *      with `eventMode: "none"` by FusionCanvas, which — per PIXI's own docs
 *      — "[i]gnores all interaction events, even on its children". Without an
 *      override, WallsLayer's own line/door graphics could never receive a
 *      pointerdown no matter what eventMode THEY carried; on top of that, two
 *      of them were themselves set to `"auto"`, which never emits its OWN
 *      events either. A GM could draw a wall but never select or delete one;
 *      no user, GM or player, could ever click a door open.
 *
 * Mirrors the non-circular contract-test pattern from
 * token-manager-contract.test.ts: the expected shape is the WIRE SCHEMA
 * (DocCreatePayloadSchema / DocDeletePayloadSchema / DoorStatePayloadSchema
 * from @fusion/shared — the same schemas the server runs safeParse against),
 * never a value re-derived from WallsLayer's own code.
 *
 * Runs in the node environment against real PIXI containers (proven safe by
 * token-layer-bars.test.ts) — no renderer/Application is ever booted, so
 * eventMode is asserted by literal property value rather than by driving
 * PIXI's real EventBoundary hit-test (which needs a booted EventSystem this
 * suite intentionally does not stand up).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Container } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import {
  DocCreatePayloadSchema,
  DocDeletePayloadSchema,
  DoorStatePayloadSchema,
} from "@fusion/shared";
import type { Wall } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import { WallsLayer } from "../WallsLayer.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface CapturedEmit {
  type: string;
  payload: unknown;
}

/** Mirrors token-manager-contract.test.ts's makeFakeSocket. */
function makeFakeSocket(captured: CapturedEmit[]): Socket {
  return {
    emit(event: string, envelope: unknown, ack?: (result: unknown) => void) {
      if (event === "op") {
        captured.push(envelope as CapturedEmit);
        ack?.({ ok: true, result: null });
      }
    },
  } as unknown as Socket;
}

const SCENE_ID = "scn0000000000001";

function makeWall(overrides: Partial<Wall> = {}): Wall {
  return {
    _id: "wal0000000000001",
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    move: "normal",
    sight: "normal",
    light: "normal",
    sound: "normal",
    dir: "both",
    doorType: "none",
    doorState: "closed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

describe("WallsLayer — wire protocol", () => {
  let captured: CapturedEmit[];
  let socket: Socket;

  beforeEach(() => {
    captured = [];
    socket = makeFakeSocket(captured);
  });

  it("creating a wall emits doc:create satisfying DocCreatePayloadSchema (documentType Wall, parent Scene) — not a $push diff", async () => {
    const root = new Container();
    const layer = new WallsLayer(root, SCENE_ID, socket, true);

    await (
      layer as unknown as {
        _createWall(a: { x: number; y: number }, b: { x: number; y: number }): Promise<void>;
      }
    )._createWall({ x: 0, y: 0 }, { x: 100, y: 0 });

    const emission = captured.find((e) => e.type === "doc:create");
    expect(emission).toBeDefined();
    const result = DocCreatePayloadSchema.safeParse(emission?.payload);
    expect(result.success, `DocCreatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Wall");
    expect(result.data?.parent).toEqual({ type: "Scene", id: SCENE_ID });
  });

  it("deleting selected walls emits doc:delete satisfying DocDeletePayloadSchema (documentType Wall, parent Scene) — not a $pull diff", async () => {
    const root = new Container();
    const layer = new WallsLayer(root, SCENE_ID, socket, true);
    const wall = makeWall();
    layer.setWalls([wall]);
    layer.toggleSelectWall(wall._id);

    await layer.deleteSelected();

    const emission = captured.find((e) => e.type === "doc:delete");
    expect(emission).toBeDefined();
    const result = DocDeletePayloadSchema.safeParse(emission?.payload);
    expect(result.success, `DocDeletePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Wall");
    expect(result.data?.ids).toContain(wall._id);
    expect(result.data?.parent).toEqual({ type: "Scene", id: SCENE_ID });
  });

  it("clicking an unlocked door emits scene:doorState satisfying DoorStatePayloadSchema — never doc:update on Scene", async () => {
    const root = new Container();
    // Player (isGm=false): open/close a non-locked door is allowed for anyone.
    const layer = new WallsLayer(root, SCENE_ID, socket, false);
    const wall = makeWall({ _id: "wal0000000000002", doorType: "door", doorState: "closed" });
    layer.setWalls([wall]);

    // Drive the real registered PIXI handler directly — `_doorsContainer` is
    // private, so reach it through the public container hierarchy WallsLayer
    // builds: root → [linesContainer, doorsContainer, drawingContainer].
    const doorsContainer = root.children[1] as Container;
    const doorIcon = doorsContainer.children[0] as Container;
    const fakeEvent = { stopPropagation: () => undefined } as unknown as FederatedPointerEvent;
    doorIcon.emit("pointerdown", fakeEvent);

    // The handler's op send is fire-and-forget (`void this._sendDoorStateUpdate(...)`).
    await Promise.resolve();
    await Promise.resolve();

    const emission = captured.find((e) => e.type === "scene:doorState");
    expect(emission).toBeDefined();
    expect(captured.some((e) => e.type === "doc:update")).toBe(false);
    const result = DoorStatePayloadSchema.safeParse(emission?.payload);
    expect(result.success, `DoorStatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.sceneId).toBe(SCENE_ID);
    expect(result.data?.wallId).toBe("wal0000000000002");
    expect(result.data?.state).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Interactivity (eventMode wiring)
// ---------------------------------------------------------------------------

describe("WallsLayer — interactivity (eventMode wiring)", () => {
  it("overrides the shared container's eventMode away from 'none' — a 'none' ancestor prunes the whole subtree before PIXI even looks at children", () => {
    const root = new Container();
    root.eventMode = "none"; // mirrors FusionCanvas's "controls" layer default
    new WallsLayer(root, SCENE_ID, null, true);
    expect(root.eventMode).toBe("static");
  });

  it("the lines container is not 'none' — an intermediate 'none' ancestor would independently prune every wall line", () => {
    const root = new Container();
    new WallsLayer(root, SCENE_ID, null, true);
    const linesContainer = root.children[0] as Container;
    expect(linesContainer.eventMode).not.toBe("none");
  });

  it("GM: a wall line's own eventMode is 'static' — 'auto' never emits its own pointerdown", () => {
    const root = new Container();
    const layer = new WallsLayer(root, SCENE_ID, null, true);
    layer.setWalls([makeWall()]);

    const linesContainer = root.children[0] as Container;
    const wallLine = linesContainer.children[0] as Container;
    expect(wallLine.eventMode).toBe("static");
  });

  it("player: a wall line stays non-interactive — only the GM may select/delete walls", () => {
    const root = new Container();
    const layer = new WallsLayer(root, SCENE_ID, null, false);
    layer.setWalls([makeWall()]);

    const linesContainer = root.children[0] as Container;
    const wallLine = linesContainer.children[0] as Container;
    expect(wallLine.eventMode).toBe("none");
  });

  it("a door icon's own eventMode is 'static' for GM and player alike — door open/close is not GM-gated", () => {
    for (const isGm of [true, false]) {
      const root = new Container();
      const layer = new WallsLayer(root, SCENE_ID, null, isGm);
      layer.setWalls([makeWall({ doorType: "door" })]);

      const doorsContainer = root.children[1] as Container;
      const doorIcon = doorsContainer.children[0] as Container;
      expect(doorIcon.eventMode).toBe("static");
    }
  });
});

// ---------------------------------------------------------------------------
// Layer visibility (REQ-CNV-004: walls are GM-only geometry)
// ---------------------------------------------------------------------------
//
// Found in review: the server never redacts wall coordinates for players
// (only `doorType` on secret doors gets stripped), and this layer was
// attaching the "controls" hierarchy for every user (issue #83) without
// hiding the LINE geometry — so a player could see the full skeleton of
// the dungeon, secret-door segments included, through the still-visible
// `_linesContainer`. Door icons must stay visible for non-secret doors so
// players can still open/close them (`scene:doorState` is a player gesture).

describe("WallsLayer — layer visibility (REQ-CNV-004: walls are GM-only geometry)", () => {
  it("player: the lines container is not visible — wall geometry leaking to players is the regression this guards", () => {
    const root = new Container();
    new WallsLayer(root, SCENE_ID, null, false);

    const linesContainer = root.children[0] as Container;
    expect(linesContainer.visible).toBe(false);
  });

  it("player: the doors container stays visible — opening a door is a player gesture", () => {
    const root = new Container();
    new WallsLayer(root, SCENE_ID, null, false);

    const doorsContainer = root.children[1] as Container;
    expect(doorsContainer.visible).toBe(true);
  });

  it("GM: both the lines and doors containers are visible", () => {
    const root = new Container();
    new WallsLayer(root, SCENE_ID, null, true);

    const linesContainer = root.children[0] as Container;
    const doorsContainer = root.children[1] as Container;
    expect(linesContainer.visible).toBe(true);
    expect(doorsContainer.visible).toBe(true);
  });
});
