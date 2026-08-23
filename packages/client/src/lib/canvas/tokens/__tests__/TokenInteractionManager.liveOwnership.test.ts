/**
 * TokenInteractionManager.liveOwnership.test.ts
 *
 * R2 (integração pós-#194): the manager must read the CURRENT set of actors
 * this user owns on every gesture, never a snapshot frozen at construction.
 *
 * `TableScreen.svelte` builds the manager once per scene load, and #194's
 * `_loadedSceneId` guard deliberately stopped rebuilding the canvas on every
 * Scene mutation — so the manager now outlives, by design, the arrival of the
 * Actor documents it depends on. TK093 (fase 5) removed `canMoveToken`'s old
 * `flags.fusion.owner` fallback, which makes `ownedActorIds.has(token.actorId)`
 * the ONE client-side predicate for "may I move this?" (REQ-TOK-032,
 * REQ-TOK-034, DEC-TOK-06). Frozen, that predicate answers "no" forever for a
 * player whose Actor snapshot lands after the canvas mounted, or who is given
 * OWNER mid-session — while the server (`handleEmbeddedUpdate`, which resolves
 * ownership live) would have accepted the very same move. REQ-TOK-033 allows
 * the interface to ANTICIPATE the server's answer; it does not allow it to
 * contradict it.
 *
 * Spec: 41-token.md REQ-TOK-032, REQ-TOK-033, REQ-TOK-034.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";

// ---------------------------------------------------------------------------
// Minimal fakes — no PIXI required (mirrors TokenInteractionManager.dragFootprint)
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
const PLAYER_ID = "user-player";
const ROLE_PLAYER = 1;

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
  const up = container._handlers.get("pointerup");
  down?.({ button: 0, target, clientX: downX, clientY: downY, stopPropagation: () => {} });
  move?.({ clientX: moveX, clientY: moveY });
  // A complete gesture: without the pointerup the manager keeps `_pointerDown`
  // set, and the NEXT pointermove would resume the old drag without ever
  // re-checking permission — which would make the second assertion vacuous.
  up?.({});
}

function makeFakeTarget(tokenId: string) {
  return { label: `token:${tokenId}`, parent: null };
}

describe("TokenInteractionManager live ownership (R2, REQ-TOK-032/034)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry({ med: { width: 1, height: 1 } });
  });

  it("a player who becomes OWNER after the manager was built can move the token, with no manager rebuild", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    // The live set: empty when the manager is built (the Actor snapshot has
    // not landed yet), populated later — exactly the sequence #194's
    // `_loadedSceneId` guard makes possible.
    let owned: ReadonlySet<string> = new Set<string>();

    const actor: FakeActor = { _id: ACTOR_ID, name: "Ranger", system: {} };
    const token = makeToken();
    const mirror = makeFakeMirror(SCENE_ID, [token], [actor]);
    const layer = makeFakeTokenLayer();
    const container = makeFakeContainer();

    const opts: TokenInteractionOptions = {
      tokenContainer: container as never,
      tokenLayer: layer as never,
      mirror: mirror as never,
      sceneId: SCENE_ID,
      canvas: makeFakeCanvas() as never,
      socket: makeFakeSocket(),
      userId: PLAYER_ID,
      userRole: ROLE_PLAYER,
      getOwnedActorIds: () => owned,
      gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
      attachKeyboard: false,
    };

    const mgr = new TokenInteractionManager(opts);

    // Before ownership arrives: the drag is refused (no optimistic move).
    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);
    expect(layer.applyLocalMove).not.toHaveBeenCalled();

    // The Actor snapshot lands (or the GM grants OWNER mid-session).
    owned = new Set([ACTOR_ID]);

    // Same manager instance, no rebuild: the drag is now accepted.
    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);
    // Identity camera: the cursor at (220,220) falls in the cell [200,300),
    // whose center is 250; a 1x1 footprint (grid 100) offsets by half a cell,
    // so the token's top-left lands at 250 - 50 = 200.
    expect(layer.applyLocalMove).toHaveBeenCalledWith(TOKEN_ID, 200, 200);

    mgr.destroy();
  });

  it("a player who LOSES ownership mid-session stops being able to move the token", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    let owned: ReadonlySet<string> = new Set([ACTOR_ID]);

    const actor: FakeActor = { _id: ACTOR_ID, name: "Ranger", system: {} };
    const mirror = makeFakeMirror(SCENE_ID, [makeToken()], [actor]);
    const layer = makeFakeTokenLayer();
    const container = makeFakeContainer();

    const mgr = new TokenInteractionManager({
      tokenContainer: container as never,
      tokenLayer: layer as never,
      mirror: mirror as never,
      sceneId: SCENE_ID,
      canvas: makeFakeCanvas() as never,
      socket: makeFakeSocket(),
      userId: PLAYER_ID,
      userRole: ROLE_PLAYER,
      getOwnedActorIds: () => owned,
      gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
      attachKeyboard: false,
    });

    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);
    expect(layer.applyLocalMove).toHaveBeenCalledTimes(1);

    owned = new Set<string>();

    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 320, 320);
    expect(layer.applyLocalMove).toHaveBeenCalledTimes(1);

    mgr.destroy();
  });
});
