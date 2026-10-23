/**
 * TokenInteractionManager.openSheet.test.ts
 *
 * TK110: two clicks on a token open its sheet (REQ-TOK-110), under the same
 * permission rule as moving it (REQ-TOK-111) — a player never opens the sheet
 * of an actor they do not own, because that sheet would show hit points the
 * server redacted out of their copy (REQ-TOK-070/071).
 *
 * Spec: 41-token.md §5.12 REQ-TOK-110..114
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

function click(
  container: ReturnType<typeof makeFakeContainer>,
  target: unknown,
  x = 10,
  y = 10,
): void {
  const down = container._handlers.get("pointerdown");
  const up = container._handlers.get("pointerup");
  down?.({ button: 0, target, clientX: x, clientY: y, stopPropagation: () => {} });
  up?.({});
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

const OTHER_TOKEN_ID = "tok002";

function makeManagerOpts(
  container: ReturnType<typeof makeFakeContainer>,
  mirror: unknown,
  layer: unknown,
  role: number,
  owned: () => ReadonlySet<string>,
  onOpenSheet: (tokenId: string) => void,
): TokenInteractionOptions {
  return {
    tokenContainer: container as never,
    tokenLayer: layer as never,
    mirror: mirror as never,
    sceneId: SCENE_ID,
    canvas: makeFakeCanvas() as never,
    socket: makeFakeSocket(),
    userId: PLAYER_ID,
    userRole: role,
    getOwnedActorIds: owned,
    gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
    attachKeyboard: false,
    onOpenSheet,
  };
}

describe("TokenInteractionManager — two clicks open the sheet (REQ-TOK-110)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry({ med: { width: 1, height: 1 } });
  });

  it("two clicks on the same token ask for its sheet, exactly once", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(
        container,
        mirror,
        makeFakeTokenLayer(),
        ROLE_PLAYER,
        () => new Set([ACTOR_ID]),
        onOpenSheet,
      ),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    expect(onOpenSheet).not.toHaveBeenCalled();

    click(container, makeFakeTarget(TOKEN_ID));
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(onOpenSheet).toHaveBeenCalledWith(TOKEN_ID);

    mgr.destroy();
  });

  it("REQ-TOK-111: a player never opens the sheet of an actor they do not own", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(
        container,
        mirror,
        makeFakeTokenLayer(),
        ROLE_PLAYER,
        () => new Set(),
        onOpenSheet,
      ),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    click(container, makeFakeTarget(TOKEN_ID));
    expect(onOpenSheet).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("the Mestre opens the sheet of a token of nobody's actor", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, makeFakeTokenLayer(), 4, () => new Set(), onOpenSheet),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    click(container, makeFakeTarget(TOKEN_ID));
    expect(onOpenSheet).toHaveBeenCalledWith(TOKEN_ID);

    mgr.destroy();
  });

  it("one click on each of two tokens opens nothing", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const tokens = [makeToken(), makeToken({ _id: OTHER_TOKEN_ID })];
    const mirror = makeFakeMirror(SCENE_ID, tokens, [
      { _id: ACTOR_ID, name: "Goblin", system: {} },
    ]);
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, makeFakeTokenLayer(), 4, () => new Set(), onOpenSheet),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    click(container, makeFakeTarget(OTHER_TOKEN_ID));
    expect(onOpenSheet).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("a click on empty canvas between the two clicks breaks the pair", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, makeFakeTokenLayer(), 4, () => new Set(), onOpenSheet),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    click(container, { label: "background", parent: null });
    click(container, makeFakeTarget(TOKEN_ID));
    expect(onOpenSheet).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("the second click opens the sheet instead of picking the token up to drag", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const layer = makeFakeTokenLayer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, layer, 4, () => new Set(), onOpenSheet),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    // Second click, and the mouse then wanders far while still down.
    const down = container._handlers.get("pointerdown");
    const move = container._handlers.get("pointermove");
    down?.({
      button: 0,
      target: makeFakeTarget(TOKEN_ID),
      clientX: 10,
      clientY: 10,
      stopPropagation: () => {},
    });
    move?.({ clientX: 300, clientY: 300 });

    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(layer.applyLocalMove).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("with no onOpenSheet wired, two clicks are simply inert", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const opts = makeManagerOpts(
      container,
      mirror,
      makeFakeTokenLayer(),
      4,
      () => new Set(),
      () => {},
    );
    const { onOpenSheet: _drop, ...withoutCallback } = opts;
    const mgr = new TokenInteractionManager(withoutCallback as TokenInteractionOptions);

    expect(() => {
      click(container, makeFakeTarget(TOKEN_ID));
      click(container, makeFakeTarget(TOKEN_ID));
    }).not.toThrow();

    mgr.destroy();
  });

  it("a DRAG followed by a click opens nothing — a drag is not half of a double click", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, makeFakeTokenLayer(), 4, () => new Set(), onOpenSheet),
    );

    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);
    click(container, makeFakeTarget(TOKEN_ID));
    expect(onOpenSheet).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("two drags in a row keep moving the token instead of opening a sheet", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const onOpenSheet = vi.fn();
    const container = makeFakeContainer();
    const layer = makeFakeTokenLayer();
    const mirror = makeFakeMirror(
      SCENE_ID,
      [makeToken()],
      [{ _id: ACTOR_ID, name: "Goblin", system: {} }],
    );
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, layer, 4, () => new Set(), onOpenSheet),
    );

    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 220, 220);
    // Let the first move's ack settle: while it is still pending, canStartDrag
    // refuses a new drag, and the second gesture would prove nothing.
    await new Promise((resolve) => setTimeout(resolve, 0));
    simulateDrag(container, makeFakeTarget(TOKEN_ID), 10, 10, 320, 320);
    expect(onOpenSheet).not.toHaveBeenCalled();
    expect(layer.applyLocalMove).toHaveBeenCalledTimes(2);

    mgr.destroy();
  });
});
