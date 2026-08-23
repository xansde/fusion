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
