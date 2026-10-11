/**
 * TokenInteractionManager.teardown.test.ts
 *
 * R9 (integração pós-#194): `destroy()` must give the tokens layer back
 * exactly as it found it.
 *
 * `FusionCanvas._buildHierarchy` creates every layer with `eventMode = "none"`
 * — the canvas is inert until something asks for interaction. The manager
 * opts the tokens layer in (`eventMode = "static"`) and installs an
 * always-true `hitArea` so PIXI's hit test reaches the layer even where no
 * sprite is drawn (that is how a click on empty canvas deselects). Before this
 * fix `destroy()` removed the listeners but left BOTH of those on the shared
 * container: after a scene teardown the layer kept swallowing every pointer
 * hit test over the whole map with nobody listening — invisible from the
 * outside, and a real hazard for anything else that wants pointer events on
 * the canvas (camera pan, measurement templates) after the interaction
 * manager is gone.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036.
 */

import { describe, it, expect, vi } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";
// Preload the manager's module graph while the file is collected: a cold import inside a test
// can pass the 15 s per-test ceiling on a loaded machine, and every `await import()` below then
// gets the module already loaded (BAR-F1-01 verification).
import "../TokenInteractionManager.js";

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

/** A stand-in for the "tokens" layer, born inert exactly like FusionCanvas builds it. */
function makeFakeContainer() {
  return {
    eventMode: "none" as string,
    hitArea: null as unknown,
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

const SCENE_ID = "scene001";

describe("TokenInteractionManager teardown (R9)", () => {
  it("destroy() restores the tokens layer to eventMode 'none' with no hitArea", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const container = makeFakeContainer();
    const opts: TokenInteractionOptions = {
      tokenContainer: container as never,
      tokenLayer: makeFakeTokenLayer() as never,
      mirror: makeFakeMirror(SCENE_ID, []) as never,
      sceneId: SCENE_ID,
      canvas: makeFakeCanvas() as never,
      socket: makeFakeSocket(),
      userId: "user-gm",
      userRole: 4,
      getOwnedActorIds: () => new Set<string>(),
      gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
      attachKeyboard: false,
    };

    const mgr = new TokenInteractionManager(opts);

    // While alive: the layer is interactive and hit-tests everywhere.
    expect(container.eventMode).toBe("static");
    expect(container.hitArea).not.toBeNull();

    mgr.destroy();

    expect(container.removeAllListeners).toHaveBeenCalled();
    expect(container.eventMode).toBe("none");
    expect(container.hitArea).toBeNull();
  });

  it("a second destroy() is a no-op and leaves the layer inert", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const container = makeFakeContainer();
    const mgr = new TokenInteractionManager({
      tokenContainer: container as never,
      tokenLayer: makeFakeTokenLayer() as never,
      mirror: makeFakeMirror(SCENE_ID, []) as never,
      sceneId: SCENE_ID,
      canvas: makeFakeCanvas() as never,
      socket: makeFakeSocket(),
      userId: "user-gm",
      userRole: 4,
      getOwnedActorIds: () => new Set<string>(),
      gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
      attachKeyboard: false,
    });

    mgr.destroy();
    mgr.destroy();

    expect(container.eventMode).toBe("none");
    expect(container.hitArea).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BAR-F1-01 — destroy() publishes, and nothing publishes after it
// ---------------------------------------------------------------------------

/**
 * The manager publishes its selection to the active-actor store (`onSelectionChange`, tasks.md
 * §2.4). Its last word is the empty selection, in `destroy()`; after that no pointer handler,
 * key or late ack may publish again — a dead manager speaking for a scene that left the canvas
 * would move the bar. Whether that last word clears the store is the store's call (only the
 * scene the canvas draws counts), not the manager's.
 */
describe("TokenInteractionManager teardown publishes the selection (BAR-F1-01)", () => {
  const TOKEN_ID = "tok001";

  function makeToken(): TokenDocument {
    return {
      _id: TOKEN_ID,
      name: null,
      actorId: "actor001",
      actorLink: true,
      actorDelta: null,
      x: 0,
      y: 0,
      hidden: false,
      flags: {},
    } as unknown as TokenDocument;
  }

  /** A tokens layer that remembers its handlers, so they can be fired after destroy(). */
  function makeRecordingContainer() {
    const handlers = new Map<string, (e: unknown) => void>();
    return {
      eventMode: "none" as string,
      hitArea: null as unknown,
      on: vi.fn((event: string, cb: (e: unknown) => void) => {
        handlers.set(event, cb);
      }),
      removeAllListeners: vi.fn(),
      handlers,
    };
  }

  /** A socket whose acks wait until the test releases them. */
  function makeDeferredSocket() {
    const pending: Array<(result: unknown) => void> = [];
    const socket = {
      emit(event: string, _envelope: unknown, ack?: (result: unknown) => void) {
        if (event === "op" && ack) pending.push(ack);
      },
    } as unknown as Socket;
    return { socket, releaseAll: () => pending.splice(0).forEach((ack) => ack({ ok: true })) };
  }

  async function build(socket: Socket = makeFakeSocket()) {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const published: string[][] = [];
    const container = makeRecordingContainer();
    const mgr = new TokenInteractionManager({
      tokenContainer: container as never,
      tokenLayer: makeFakeTokenLayer() as never,
      mirror: makeFakeMirror(SCENE_ID, [makeToken()]) as never,
      sceneId: SCENE_ID,
      canvas: makeFakeCanvas() as never,
      socket,
      userId: "user-gm",
      userRole: 4,
      getOwnedActorIds: () => new Set<string>(),
      gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
      attachKeyboard: false,
      onSelectionChange: (tokenIds) => published.push([...tokenIds]),
    });
    return { mgr, container, published };
  }

  function clickToken(container: ReturnType<typeof makeRecordingContainer>): void {
    container.handlers.get("pointerdown")?.({
      button: 0,
      target: { label: `token:${TOKEN_ID}`, parent: null },
      clientX: 10,
      clientY: 10,
      stopPropagation: () => {},
    });
    container.handlers.get("pointerup")?.({});
  }

  function press(mgr: unknown, code: string): void {
    (mgr as { _handleKeyDown(e: unknown): void })._handleKeyDown({
      code,
      target: null,
      preventDefault() {},
    });
  }

  it("destroy() publishes the empty selection, exactly once", async () => {
    const { mgr, container, published } = await build();
    clickToken(container);
    expect(published).toEqual([[TOKEN_ID]]);

    mgr.destroy();
    expect(published).toEqual([[TOKEN_ID], []]);
    expect([...mgr.selectedIds]).toEqual([]);

    mgr.destroy();
    expect(published).toEqual([[TOKEN_ID], []]);
  });

  it("after destroy() no handler, key or public call publishes again (no listener survives)", async () => {
    const { mgr, container, published } = await build();
    clickToken(container);
    mgr.destroy();
    const afterDestroy = published.length;

    clickToken(container);
    container.handlers.get("pointerdown")?.({
      button: 0,
      target: null,
      clientX: 0,
      clientY: 0,
      stopPropagation: () => {},
    });
    press(mgr, "Escape");
    mgr.deselectAll();

    expect(published.length).toBe(afterDestroy);
  });

  it("a delete whose ack lands after destroy() publishes nothing", async () => {
    const { socket, releaseAll } = makeDeferredSocket();
    const { mgr, container, published } = await build(socket);
    clickToken(container);

    const deleting = mgr.deleteSelectedToken();
    mgr.destroy();
    const afterDestroy = published.length;

    releaseAll();
    await deleting;

    expect(published.length).toBe(afterDestroy);
    expect(published.at(-1)).toEqual([]);
  });
});
