/**
 * TokenInteractionManager.dragFootprint.test.ts
 *
 * F187-4: the drag-snap footprint TokenInteractionManager reads while dragging
 * must come from the token's EFFECTIVE actor (base actor + actorDelta,
 * resolved through `resolveEffectiveActor`, RNF-TOK-01), not from the raw
 * base Actor document. `TokenSprite` already resolves the effective actor
 * for its own footprint/hitArea (TokenSprite.ts `_resolveActor`); before this
 * fix, `TokenInteractionManager._getActor` skipped the delta entirely, so an
 * unlinked token whose delta grows its size (e.g. a "grande" spell effect)
 * snapped to the wrong grid cell during drag while the sprite itself drew at
 * the correct (larger) footprint — the ghost and the drop target disagreed.
 *
 * Spec: 41-token.md REQ-TOK-012, REQ-TOK-017, REQ-TOK-043 (TK041); RNF-TOK-01.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";

// ---------------------------------------------------------------------------
// Minimal fakes — no PIXI required (mirrors token-manager-contract.test.ts)
// ---------------------------------------------------------------------------

function makeFakeSocket(): Socket {
  return {
    emit(event: string, _envelope: unknown, ack?: (result: unknown) => void) {
      if (event === "op") ack?.({ ok: true, result: null });
    },
  } as unknown as Socket;
}

interface FakeActor {
  _id: string;
  name: string;
  img?: string | null;
  system?: Record<string, unknown>;
}

function makeFakeMirror(sceneId: string, tokens: TokenDocument[], actors: FakeActor[]) {
  return {
    getDoc<T>(type: string, id: string): T | undefined {
      if (type === "Scene" && id === sceneId) {
        return { _id: sceneId, tokens } as unknown as T;
      }
      if (type === "Actor") {
        return actors.find((a) => a._id === id) as unknown as T | undefined;
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
    // Identity camera transform: screenToWorld(sx, sy) === (sx, sy).
    camera: { tx: 0, ty: 0, scale: 1 },
    _container: {
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    },
  };
}

/** Fake PIXI Container that records the handler registered for each event. */
function makeFakeContainer() {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    eventMode: "none",
    hitArea: null,
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

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
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
    ...overrides,
  } as unknown as TokenDocument;
}

function buildOpts(
  socket: Socket,
  mirror: ReturnType<typeof makeFakeMirror>,
  tokenLayer: ReturnType<typeof makeFakeTokenLayer>,
  container: ReturnType<typeof makeFakeContainer>,
): TokenInteractionOptions {
  return {
    tokenContainer: container as never,
    tokenLayer: tokenLayer as never,
    mirror: mirror as never,
    sceneId: SCENE_ID,
    canvas: makeFakeCanvas() as never,
    socket,
    userId: "user-gm",
    userRole: 4, // GAMEMASTER — blanket move permission
    getOwnedActorIds: () => new Set<string>(),
    gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
    attachKeyboard: false,
  };
}

const PF2E_TABLE = {
  med: { width: 1, height: 1 },
  lg: { width: 2, height: 2 },
};

/** Dispatch pointerdown then a pointermove past the drag threshold. */
function simulateDrag(
  container: ReturnType<typeof makeFakeContainer>,
  target: unknown,
  downX: number,
  downY: number,
  moveX: number,
  moveY: number,
): void {
  const down = container._handlers.get("pointerdown");
  const move = container._handlers.get("pointermove");
  down?.({ button: 0, target, clientX: downX, clientY: downY, stopPropagation: () => {} });
  move?.({ clientX: moveX, clientY: moveY });
}

/** A fake PIXI target container labeled "token:<id>", as _getTokenIdFromTarget expects. */
function makeFakeTarget(tokenId: string) {
  return { label: `token:${tokenId}`, parent: null };
}

describe("TokenInteractionManager drag-snap footprint (F187-4, RNF-TOK-01)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry(PF2E_TABLE);
  });

  it("snaps to the EFFECTIVE actor's footprint, not the base actor's, for an unlinked token with a size-growing delta", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const baseActor: FakeActor = {
      _id: ACTOR_ID,
      name: "Goblin",
      system: { traits: { size: "med" } }, // base: 1x1
    };
    const token = makeToken({
      actorLink: false,
      actorDelta: { system: { traits: { size: "lg" } } }, // delta: 2x2
      x: 0,
      y: 0,
    });

    const mirror = makeFakeMirror(SCENE_ID, [token], [baseActor]);
    const layer = makeFakeTokenLayer();
    const container = makeFakeContainer();
    const socket = makeFakeSocket();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer, container));

    // Cursor world position (identity camera): (220, 220). `snapTokenToGrid`
    // snaps the cursor itself to the nearest cell CENTER — 220 falls in cell
    // [200,300), whose center is 250 — then offsets by half the footprint's
    // bounding box to get the top-left. A 2x2 footprint (grid size 100, half
    // = 100) lands at 250 - 100 = 150. A 1x1 footprint (the bug: reading the
    // BASE actor's "med" instead of the effective "lg") would instead offset
    // by half = 50, landing at 250 - 50 = 200 — a visibly different cell.
    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);

    expect(layer.applyLocalMove).toHaveBeenCalledWith(TOKEN_ID, 150, 150);

    mgr.destroy();
  });

  it("still snaps to the base actor's footprint for a linked token (no delta)", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const baseActor: FakeActor = {
      _id: ACTOR_ID,
      name: "Goblin",
      system: { traits: { size: "lg" } }, // 2x2
    };
    const token = makeToken({ actorLink: true, actorDelta: null, x: 0, y: 0 });

    const mirror = makeFakeMirror(SCENE_ID, [token], [baseActor]);
    const layer = makeFakeTokenLayer();
    const container = makeFakeContainer();
    const socket = makeFakeSocket();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer, container));

    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);

    expect(layer.applyLocalMove).toHaveBeenCalledWith(TOKEN_ID, 150, 150);

    mgr.destroy();
  });
});
