/**
 * token-config-gesture.test.ts
 *
 * Covers two workstream-B behaviors of TokenInteractionManager:
 *
 *   1. Double-click gesture: two completed clicks (pointerdown→pointerup with
 *      no drag) on the SAME token within DOUBLE_CLICK_MS (400ms) invoke
 *      `onConfigureToken` with that token. A single click, two clicks too far
 *      apart, or two clicks on different tokens must NOT fire it. The gate is
 *      exactly canMoveToken's (GM/Assistant always; player only if they own
 *      the token's actor) because `_pointerDown` tracking — the double-click
 *      detector's input — is itself gated on canMoveToken.
 *
 *   2. Live ownership (`getOwnedActorIds`): when provided, the manager must
 *      re-query it on every permission check instead of using a stale
 *      snapshot captured at construction time — so a GM granting ownership
 *      mid-session unlocks drag/double-click without recreating the manager.
 *
 * No PIXI, no DOM — a fake Container captures the handlers TokenInteractionManager
 * registers via `.on(event, handler)` so the test can trigger them directly,
 * mirroring the "lazy import to avoid PIXI at module-load time" pattern used
 * by token-manager-contract.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SquareGrid } from "@fusion/shared";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeSocket(): Socket {
  return {
    emit(_event: string, _envelope: unknown, ack?: (result: unknown) => void) {
      ack?.({ ok: true, result: null });
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

/** Fake PIXI Container that records handlers and lets the test trigger them. */
function makeFakeContainer() {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    eventMode: "none",
    hitArea: null,
    on(event: string, handler: (e: unknown) => void) {
      handlers.set(event, handler);
    },
    removeAllListeners: vi.fn(),
    trigger(event: string, e: unknown = {}) {
      handlers.get(event)?.(e);
    },
  };
}

/** Fake FederatedPointerEvent targeting a token container labeled "token:<id>". */
function tokenEvent(tokenId: string, extra: Record<string, unknown> = {}) {
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    target: { label: `token:${tokenId}`, parent: null },
    stopPropagation: vi.fn(),
    ...extra,
  };
}

const SCENE_ID = "scene001";

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return {
    _id: "tok001",
    name: "Goblin",
    actorId: null,
    // REQ-DOC-031: a token declares whether it shares the world Actor.
    actorLink: true,
    actorDelta: {},
    texture: null,
    x: 100,
    y: 100,
    width: 1,
    height: 1,
    rotation: 0,
    elevation: 0,
    hidden: false,
    disposition: 0,
    bar1: { attribute: null },
    bar2: { attribute: null },
    // REQ-CNV-089: every token declares who may see its bars.
    displayBars: "observer",
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
  };
}

function buildOpts(
  overrides: Partial<TokenInteractionOptions>,
  container: ReturnType<typeof makeFakeContainer>,
  mirror: ReturnType<typeof makeFakeMirror>,
  tokenLayer: ReturnType<typeof makeFakeTokenLayer>,
): TokenInteractionOptions {
  return {
    tokenContainer: container as never,
    tokenLayer: tokenLayer as never,
    mirror: mirror as never,
    sceneId: SCENE_ID,
    canvas: makeFakeCanvas() as never,
    socket: makeFakeSocket(),
    userId: "user-gm",
    userRole: 4, // GAMEMASTER
    ownedActorIds: new Set(),
    grid: new SquareGrid({
      type: "square",
      size: 100,
      distance: 5,
      units: "ft",
      color: "#000000",
      alpha: 0.4,
      diagonalRule: "alternating_1",
    }),
    attachKeyboard: false,
    targeting: { isTargetedByMe: () => false, toggle: async () => {} },
    ...overrides,
  };
}

/** Simulate a completed click (no drag) on the given token. */
function click(container: ReturnType<typeof makeFakeContainer>, tokenId: string): void {
  container.trigger("pointerdown", tokenEvent(tokenId));
  container.trigger("pointerup");
}

describe("TokenInteractionManager — double-click opens config", () => {
  let container: ReturnType<typeof makeFakeContainer>;
  let mirror: ReturnType<typeof makeFakeMirror>;
  let tokenLayer: ReturnType<typeof makeFakeTokenLayer>;
  let onConfigureToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = makeFakeContainer();
    tokenLayer = makeFakeTokenLayer();
    onConfigureToken = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("two clicks on the same token within 400ms fire onConfigureToken", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken();
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const mgr = new TokenInteractionManager(
      buildOpts({ onConfigureToken }, container, mirror, tokenLayer),
    );

    click(container, token._id);
    vi.setSystemTime(200);
    click(container, token._id);

    expect(onConfigureToken).toHaveBeenCalledTimes(1);
    expect(onConfigureToken).toHaveBeenCalledWith(token);

    mgr.destroy();
    vi.useRealTimers();
  });

  it("a single click does not fire onConfigureToken", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken();
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const mgr = new TokenInteractionManager(
      buildOpts({ onConfigureToken }, container, mirror, tokenLayer),
    );

    click(container, token._id);

    expect(onConfigureToken).not.toHaveBeenCalled();

    mgr.destroy();
    vi.useRealTimers();
  });

  it("two clicks more than 400ms apart do not count as a double-click", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken();
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const mgr = new TokenInteractionManager(
      buildOpts({ onConfigureToken }, container, mirror, tokenLayer),
    );

    click(container, token._id);
    vi.setSystemTime(500);
    click(container, token._id);

    expect(onConfigureToken).not.toHaveBeenCalled();

    mgr.destroy();
    vi.useRealTimers();
  });

  it("two quick clicks on DIFFERENT tokens do not count as a double-click", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const tokenA = makeToken({ _id: "tokA" });
    const tokenB = makeToken({ _id: "tokB" });
    mirror = makeFakeMirror(SCENE_ID, [tokenA, tokenB]);
    const mgr = new TokenInteractionManager(
      buildOpts({ onConfigureToken }, container, mirror, tokenLayer),
    );

    click(container, tokenA._id);
    vi.setSystemTime(100);
    click(container, tokenB._id);

    expect(onConfigureToken).not.toHaveBeenCalled();

    mgr.destroy();
    vi.useRealTimers();
  });

  it("a drag between the two pointerdowns does not count as a click for double-click purposes", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken();
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const mgr = new TokenInteractionManager(
      buildOpts({ onConfigureToken }, container, mirror, tokenLayer),
    );

    vi.useFakeTimers();
    vi.setSystemTime(0);

    // First interaction is a real drag (moves past DRAG_THRESHOLD_PX) —
    // must not be recorded as a completed "click" for double-click purposes.
    container.trigger("pointerdown", tokenEvent(token._id));
    container.trigger("pointermove", tokenEvent(token._id, { clientX: 50, clientY: 50 }));
    container.trigger("pointerup");

    vi.setSystemTime(100);
    click(container, token._id);

    expect(onConfigureToken).not.toHaveBeenCalled();

    mgr.destroy();
    vi.useRealTimers();
  });

  it("a player without ownership of the token's actor cannot double-click it open", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken({ actorId: "actorX" });
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const mgr = new TokenInteractionManager(
      buildOpts(
        {
          onConfigureToken,
          userId: "user-player",
          userRole: 1, // PLAYER
          ownedActorIds: new Set(), // does not own actorX
        },
        container,
        mirror,
        tokenLayer,
      ),
    );

    click(container, token._id);
    vi.setSystemTime(100);
    click(container, token._id);

    expect(onConfigureToken).not.toHaveBeenCalled();

    mgr.destroy();
    vi.useRealTimers();
  });

  it("a player who owns the token's actor CAN double-click it open", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken({ actorId: "actorX" });
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const mgr = new TokenInteractionManager(
      buildOpts(
        {
          onConfigureToken,
          userId: "user-player",
          userRole: 1, // PLAYER
          ownedActorIds: new Set(["actorX"]),
        },
        container,
        mirror,
        tokenLayer,
      ),
    );

    click(container, token._id);
    vi.setSystemTime(100);
    click(container, token._id);

    expect(onConfigureToken).toHaveBeenCalledTimes(1);
    expect(onConfigureToken).toHaveBeenCalledWith(token);

    mgr.destroy();
    vi.useRealTimers();
  });
});

describe("TokenInteractionManager — live ownership (getOwnedActorIds)", () => {
  let container: ReturnType<typeof makeFakeContainer>;
  let mirror: ReturnType<typeof makeFakeMirror>;
  let tokenLayer: ReturnType<typeof makeFakeTokenLayer>;

  beforeEach(() => {
    container = makeFakeContainer();
    tokenLayer = makeFakeTokenLayer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-queries getOwnedActorIds on every check instead of using a stale snapshot", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const token = makeToken({ actorId: "actorX" });
    mirror = makeFakeMirror(SCENE_ID, [token]);
    const onConfigureToken = vi.fn();

    // Starts empty — mid-session, the GM grants ownership (mutating what this
    // closure returns), WITHOUT recreating the manager.
    let liveOwned = new Set<string>();
    const mgr = new TokenInteractionManager(
      buildOpts(
        {
          onConfigureToken,
          userId: "user-player",
          userRole: 1, // PLAYER
          ownedActorIds: new Set(), // stale snapshot — must be ignored when getOwnedActorIds is set
          getOwnedActorIds: () => liveOwned,
        },
        container,
        mirror,
        tokenLayer,
      ),
    );

    // Before ownership is granted: no permission, no pointerDown tracking,
    // so a double-click sequence never opens the config dialog.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    click(container, token._id);
    vi.setSystemTime(50);
    click(container, token._id);
    expect(onConfigureToken).not.toHaveBeenCalled();

    // GM grants ownership mid-session — same manager, no reconstruction.
    liveOwned = new Set(["actorX"]);

    vi.setSystemTime(200);
    click(container, token._id);
    vi.setSystemTime(250);
    click(container, token._id);
    expect(onConfigureToken).toHaveBeenCalledTimes(1);
    expect(onConfigureToken).toHaveBeenCalledWith(token);

    mgr.destroy();
    vi.useRealTimers();
  });
});
