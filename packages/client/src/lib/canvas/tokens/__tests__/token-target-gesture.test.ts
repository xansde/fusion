/**
 * token-target-gesture.test.ts
 *
 * The map gesture that marks/unmarks a target: right button (PIXI "rightdown")
 * over a token toggles the LOCAL user's target on that token.
 *
 * Why these tests exist: the whole targeting chain (combat:target → server →
 * token:targeted broadcast → store → reticle layer) already shipped and was
 * tested, but nothing on the map ever called it — the only trigger was a
 * CombatPanel button that always sent `targeted: true`. A chain of code is not
 * a reachable feature; what is tested here is the gesture, not the chain.
 *
 * No PIXI, no DOM: the token container is a fake that records the handlers the
 * manager registers, and the tests invoke those handlers directly.
 *
 * REQ-CBT-053/054 (targeting), item wi-mapa-alvo-01 (M2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SquareGrid } from "@fusion/shared";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions, TargetingPort } from "../TokenInteractionManager.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Handler = (e: unknown) => void;

/** Fake PIXI container that records the handlers registered on it. */
function makeRecordingContainer() {
  const handlers = new Map<string, Handler[]>();
  return {
    eventMode: "none",
    hitArea: null,
    on(event: string, fn: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    removeAllListeners: vi.fn(),
    /** Test helper: fire every handler registered for an event. */
    fire(event: string, payload: unknown) {
      for (const fn of handlers.get(event) ?? []) fn(payload);
    },
    has(event: string): boolean {
      return (handlers.get(event) ?? []).length > 0;
    },
  };
}

/** A PIXI-ish event whose target is a container labeled `token:<id>`. */
function eventOnToken(tokenId: string) {
  return {
    button: 2,
    target: { label: `token:${tokenId}`, parent: null },
    stopPropagation: vi.fn(),
  };
}

/** A PIXI-ish event that hit the layer's catch-all hitArea, not a token. */
function eventOnEmptyCanvas() {
  return {
    button: 2,
    target: { label: "layer:tokens", parent: null },
    stopPropagation: vi.fn(),
  };
}

function makeFakeSocket(): Socket {
  return { emit: vi.fn() } as unknown as Socket;
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
    camera: { x: 0, y: 0, scale: 1 },
    _container: {
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENE_ID = "scene001";
const TOKEN_ID = "tok001";

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return {
    _id: TOKEN_ID,
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

/** A targeting port whose "is mine" answer is driven by a mutable Set. */
function makeTargetingPort(mine: Set<string> = new Set()) {
  return {
    mine,
    isTargetedByMe: vi.fn((tokenId: string) => mine.has(tokenId)),
    toggle: vi.fn(async (_tokenId: string, _targeted: boolean) => {
      await Promise.resolve();
    }),
  } satisfies TargetingPort & { mine: Set<string> };
}

function buildOpts(
  container: ReturnType<typeof makeRecordingContainer>,
  targeting: TargetingPort | undefined,
  onError?: (msg: string) => void,
): TokenInteractionOptions {
  return {
    tokenContainer: container as never,
    tokenLayer: makeFakeTokenLayer() as never,
    mirror: makeFakeMirror(SCENE_ID, [makeToken()]) as never,
    sceneId: SCENE_ID,
    canvas: makeFakeCanvas() as never,
    socket: makeFakeSocket(),
    userId: "user-gm",
    userRole: 4,
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
    // Spread instead of assignment: exactOptionalPropertyTypes forbids
    // handing an explicit `undefined` to an optional property.
    ...(targeting ? { targeting } : {}),
    ...(onError ? { onError } : {}),
  };
}

async function buildManager(
  container: ReturnType<typeof makeRecordingContainer>,
  targeting: TargetingPort | undefined,
  onError?: (msg: string) => void,
) {
  const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
  return new TokenInteractionManager(buildOpts(container, targeting, onError));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TokenInteractionManager — right-click target gesture", () => {
  let container: ReturnType<typeof makeRecordingContainer>;

  beforeEach(() => {
    container = makeRecordingContainer();
  });

  it("registers a rightdown handler on the token container", async () => {
    await buildManager(container, makeTargetingPort());
    expect(container.has("rightdown")).toBe(true);
  });

  it("right-clicking an unmarked token asks the server to mark it", async () => {
    const targeting = makeTargetingPort();
    await buildManager(container, targeting);

    container.fire("rightdown", eventOnToken(TOKEN_ID));

    expect(targeting.toggle).toHaveBeenCalledTimes(1);
    expect(targeting.toggle).toHaveBeenCalledWith(TOKEN_ID, true);
  });

  it("right-clicking a token already targeted by me asks to UNMARK it", async () => {
    // This is the defect the item fixes: the only trigger before this sent
    // `targeted: true` unconditionally, so a wrong mark had no undo.
    const targeting = makeTargetingPort(new Set([TOKEN_ID]));
    await buildManager(container, targeting);

    container.fire("rightdown", eventOnToken(TOKEN_ID));

    expect(targeting.toggle).toHaveBeenCalledWith(TOKEN_ID, false);
  });

  it("marking a second token does not unmark the first (multiple targets)", async () => {
    const mine = new Set<string>();
    const targeting = makeTargetingPort(mine);
    await buildManager(container, targeting);

    container.fire("rightdown", eventOnToken("gob1"));
    mine.add("gob1"); // the broadcast came back
    container.fire("rightdown", eventOnToken("gob2"));

    expect(targeting.toggle).toHaveBeenNthCalledWith(1, "gob1", true);
    expect(targeting.toggle).toHaveBeenNthCalledWith(2, "gob2", true);
  });

  it("right-clicking empty canvas does nothing (no toggle, no deselect)", async () => {
    const targeting = makeTargetingPort();
    const mgr = await buildManager(container, targeting);
    // Give the manager a selection so a stray deselect would be observable.
    container.fire("pointerdown", {
      button: 0,
      target: { label: `token:${TOKEN_ID}`, parent: null },
      clientX: 10,
      clientY: 10,
      stopPropagation: vi.fn(),
    });
    expect(mgr.selectedIds.has(TOKEN_ID)).toBe(true);

    container.fire("rightdown", eventOnEmptyCanvas());

    expect(targeting.toggle).not.toHaveBeenCalled();
    expect(mgr.selectedIds.has(TOKEN_ID)).toBe(true);
  });

  it("stops propagation so the gesture does not reach the canvas below", async () => {
    const targeting = makeTargetingPort();
    await buildManager(container, targeting);

    const e = eventOnToken(TOKEN_ID);
    container.fire("rightdown", e);

    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("is a no-op when no targeting port was injected", async () => {
    await buildManager(container, undefined);

    // Must not throw: the manager stays constructible without the port
    // (existing call sites and tests do not pass one).
    expect(() => {
      container.fire("rightdown", eventOnToken(TOKEN_ID));
    }).not.toThrow();
  });

  it("does not target after destroy()", async () => {
    const targeting = makeTargetingPort();
    const mgr = await buildManager(container, targeting);

    mgr.destroy();
    container.fire("rightdown", eventOnToken(TOKEN_ID));

    expect(targeting.toggle).not.toHaveBeenCalled();
  });

  it("reports a rejected toggle through onError instead of an unhandled rejection", async () => {
    const onError = vi.fn();
    const targeting = makeTargetingPort();
    targeting.toggle.mockRejectedValueOnce(new Error("boom"));
    await buildManager(container, targeting, onError);

    container.fire("rightdown", eventOnToken(TOKEN_ID));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toContain("boom");
  });

  it("does not start a drag: the left-button path is untouched", async () => {
    const targeting = makeTargetingPort();
    const mgr = await buildManager(container, targeting);

    container.fire("rightdown", eventOnToken(TOKEN_ID));
    // A right-click must not select either — targeting is orthogonal to selection.
    expect(mgr.selectedIds.size).toBe(0);
  });
});
