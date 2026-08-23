/**
 * TokenInteractionManager.gridSize.test.ts
 *
 * R4 (integração pós-#194), manager half: the drag snap must follow the
 * scene's grid when the Mestre changes it.
 *
 * The manager holds its own COPY of the cell size (`gridConfig`), handed in
 * once at construction by `TableScreen`. Since #194's `_loadedSceneId` guard
 * the manager is no longer rebuilt on a Scene mutation, so without a setter
 * the copy is frozen: after the grid is edited with the scene's pencil the
 * sprites (which `SceneOrchestrator` now re-lays through
 * `TokenLayer.setGridSize`) and the drop target would disagree — the ghost
 * would land on a cell of the OLD grid.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";

function makeFakeSocket(): Socket {
  return {
    emit(event: string, _envelope: unknown, ack?: (result: unknown) => void) {
      if (event === "op") ack?.({ ok: true, result: null });
    },
  } as unknown as Socket;
}

function makeFakeMirror(sceneId: string, tokens: TokenDocument[]) {
  return {
    getDoc<T>(type: string, id: string): T | undefined {
      if (type === "Scene" && id === sceneId) {
        return { _id: sceneId, tokens } as unknown as T;
      }
      if (type === "Actor") {
        return { _id: id, name: "Goblin", system: {} } as unknown as T;
      }
      return undefined;
    },
    subscribe() {
      return () => {};
    },
  };
}

function makeFakeTokenLayer() {
  return {
    applyLocalMove: vi.fn(),
    rollbackMove: vi.fn(),
    sprites() {
      return [][Symbol.iterator]() as IterableIterator<never>;
    },
    getSprite(_id: string) {
      return undefined;
    },
  };
}

function makeFakeCanvas() {
  return {
    camera: { tx: 0, ty: 0, scale: 1 },
    _container: {
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    },
  };
}

function makeFakeContainer() {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    eventMode: "none" as string,
    hitArea: null as unknown,
    on: vi.fn((event: string, cb: (e: unknown) => void) => {
      handlers.set(event, cb);
    }),
    removeAllListeners: vi.fn(),
    _handlers: handlers,
  };
}

const SCENE_ID = "scene001";
const TOKEN_ID = "tok001";
const ACTOR_ID = "actor001";

function makeToken(): TokenDocument {
  return {
    _id: TOKEN_ID,
    name: null,
    actorId: ACTOR_ID,
    actorLink: true,
    actorDelta: null,
    x: 0,
    y: 0,
    rotation: 0,
    elevation: 0,
    hidden: false,
    disposition: 0,
    seenBy: [],
    bar1: { attribute: null },
    bar2: { attribute: null },
    flags: {},
    vision: {
      enabled: false,
      range: null,
      angle: 360,
      visionMode: "basic",
      detectionModes: [{ id: "sight", range: null, enabled: true }],
    },
    light: {
      brightRadius: 0,
      dimRadius: 0,
      angle: 360,
      color: "#ffffff",
      intensity: 0.5,
      gradual: true,
      enabled: false,
    },
  } as unknown as TokenDocument;
}

/** Flush the microtasks/timers a `sendOp` ack round-trip resolves through. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function simulateDrag(
  container: ReturnType<typeof makeFakeContainer>,
  downX: number,
  downY: number,
  moveX: number,
  moveY: number,
): void {
  const target = { label: `token:${TOKEN_ID}`, parent: null };
  container._handlers.get("pointerdown")?.({
    button: 0,
    target,
    clientX: downX,
    clientY: downY,
    stopPropagation: () => {},
  });
  container._handlers.get("pointermove")?.({ clientX: moveX, clientY: moveY });
  container._handlers.get("pointerup")?.({});
}

describe("TokenInteractionManager.setGridSize (R4)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry({ med: { width: 1, height: 1 } });
  });

  it("snaps to the NEW grid after the scene's cell size changes, with no manager rebuild", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const layer = makeFakeTokenLayer();
    const container = makeFakeContainer();
    const mgr = new TokenInteractionManager({
      tokenContainer: container as never,
      tokenLayer: layer as never,
      mirror: makeFakeMirror(SCENE_ID, [makeToken()]) as never,
      sceneId: SCENE_ID,
      canvas: makeFakeCanvas() as never,
      socket: makeFakeSocket(),
      userId: "user-gm",
      userRole: 4,
      getOwnedActorIds: () => new Set<string>(),
      gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
      attachKeyboard: false,
    });

    // Identity camera, 1x1 footprint: the drop lands on the top-left of the
    // cell the cursor is in — floor(cursor / size) * size.
    simulateDrag(container, 10, 10, 220, 220);
    expect(layer.applyLocalMove).toHaveBeenLastCalledWith(TOKEN_ID, 200, 200);

    // Let the move's ack settle: the drag machine sits in "pending" until it
    // does, and `canStartDrag` refuses a second drag while pending.
    await settle();

    mgr.setGridSize(200);

    // Cursor 520: on the OLD 100px grid this would be 500; on the new 200px
    // grid it is 400 — the two answers differ, so the assertion cannot pass
    // by accident.
    simulateDrag(container, 10, 10, 520, 520);
    expect(layer.applyLocalMove).toHaveBeenLastCalledWith(TOKEN_ID, 400, 400);

    mgr.destroy();
  });
});
