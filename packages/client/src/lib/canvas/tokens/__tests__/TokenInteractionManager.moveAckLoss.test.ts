/**
 * TokenInteractionManager.moveAckLoss.test.ts
 *
 * "The token goes and comes back" (remote session of 08/08, and again on a cloud VM): the player drops a token,
 * the socket drops and reconnects, socket.io never redelivers the ack, and after 8 s the client rolled the token
 * back to where it started even though the server had already accepted the move and broadcast it. The rollback
 * must follow the server's truth, not the silence of an ack:
 *
 *   - a refusal from the server (OpError) rolls back at once, as before;
 *   - a timeout first looks at the mirror: broadcast already applied the new position (or a later one) → keep it;
 *   - still the old position → the world is re-read (after the reconnect, if the transport is down) and the
 *     verdict is taken from the fresh mirror; only a move the server really never applied is rolled back.
 *
 * Spec: 04 REQ-NET-050/051/053 (optimistic move, server authority, timeout is not a verdict); 06 REQ-CNV-036.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";

const resyncListeners = new Set<() => void>();
const requestWorldResync = vi.fn();

vi.mock("../../../docs/worldSync.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    onWorldResynced: (cb: () => void) => {
      resyncListeners.add(cb);
      return () => resyncListeners.delete(cb);
    },
    requestWorldResync: (socket: unknown) => requestWorldResync(socket),
  };
});

import "../TokenInteractionManager.js";

const SCENE_ID = "scene001";
const TOKEN_ID = "tok001";
const ACTOR_ID = "actor001";

type AckFn = (ack: unknown) => void;

function makeFakeSocket(connected = true) {
  const acks: AckFn[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const socket = {
    connected,
    emit(event: string, _envelope: unknown, ack?: AckFn) {
      if (event === "op" && ack) acks.push(ack);
    },
    on(event: string, cb: () => void) {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(cb));
    },
    off(event: string, cb: () => void) {
      listeners.get(event)?.delete(cb);
    },
    fire(event: string) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb();
    },
  };
  return { socket, acks };
}

function makeToken(x: number, y: number): TokenDocument {
  return {
    _id: TOKEN_ID,
    name: null,
    actorId: ACTOR_ID,
    actorLink: true,
    actorDelta: null,
    x,
    y,
    rotation: 0,
    elevation: 0,
    hidden: false,
    disposition: 0,
    seenBy: [],
    bar1: { attribute: null },
    bar2: { attribute: null },
    flags: {},
  } as unknown as TokenDocument;
}

function makeFakeMirror() {
  let token = makeToken(0, 0);
  return {
    mirror: {
      getDoc<T>(type: string, id: string): T | undefined {
        if (type === "Scene" && id === SCENE_ID) {
          return { _id: SCENE_ID, tokens: [token] } as unknown as T;
        }
        if (type === "Actor") return { _id: ACTOR_ID, name: "A", system: {} } as unknown as T;
        return undefined;
      },
      subscribe: () => () => {},
    },
    /** What a broadcast (or a resync) does to the mirror. */
    place(x: number, y: number) {
      token = makeToken(x, y);
    },
  };
}

async function setup(connected = true) {
  const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
  const { socket, acks } = makeFakeSocket(connected);
  const world = makeFakeMirror();
  const layer = {
    applyLocalMove: vi.fn(),
    rollbackMove: vi.fn(),
    sprites: () => [][Symbol.iterator]() as IterableIterator<never>,
    getSprite: () => undefined,
  };
  const onError = vi.fn();
  const opts: TokenInteractionOptions = {
    tokenContainer: {
      eventMode: "none",
      hitArea: null,
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    } as never,
    tokenLayer: layer as never,
    mirror: world.mirror as never,
    sceneId: SCENE_ID,
    canvas: {
      camera: { tx: 0, ty: 0, scale: 1 },
      _container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
    } as never,
    socket: socket as unknown as Socket,
    userId: "gm",
    userRole: 4,
    getOwnedActorIds: () => new Set<string>(),
    gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
    attachKeyboard: false,
    onError,
  };
  const mgr = new TokenInteractionManager(opts);
  const internals = mgr as unknown as {
    _selectedIds: Set<string>;
    _onKeyDown: (e: unknown) => void;
  };
  internals._selectedIds.add(TOKEN_ID);
  /** One arrow press: the token moves one cell to the right, (0,0) → (100,0). */
  const pressRight = () =>
    internals._onKeyDown({ code: "ArrowRight", target: null, preventDefault: () => {} });
  return { mgr, socket, acks, world, layer, onError, pressRight };
}

/** Let promise continuations run without moving the fake clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);
const TIMEOUT = 8_000;

describe("token move whose ack never arrives", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resyncListeners.clear();
    requestWorldResync.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the broadcast already carried the new position: the timeout confirms, it does not roll back", async () => {
    const { mgr, layer, world, onError, pressRight } = await setup();
    pressRight();
    expect(layer.applyLocalMove).toHaveBeenCalledWith(TOKEN_ID, 100, 0);

    world.place(100, 0); // the server accepted and broadcast; only the ack was lost
    await vi.advanceTimersByTimeAsync(TIMEOUT);

    expect(layer.rollbackMove).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(requestWorldResync).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it("a later position already in the mirror (someone moved it again) is not rolled back to the old one", async () => {
    const { mgr, layer, world, onError, pressRight } = await setup();
    pressRight();
    world.place(300, 0);
    await vi.advanceTimersByTimeAsync(TIMEOUT);

    expect(layer.rollbackMove).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it("an explicit refusal from the server still rolls back immediately", async () => {
    const { mgr, layer, onError, acks, pressRight } = await setup();
    pressRight();
    acks[0]?.({ ok: false, code: "FORBIDDEN", message: "no" });
    await flush();

    expect(layer.rollbackMove).toHaveBeenCalledWith(TOKEN_ID, 0, 0);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Move rejected"));
    mgr.destroy();
  });

  it("timeout with the mirror still at the old position re-reads the world before deciding", async () => {
    const { mgr, socket, layer, world, onError, pressRight } = await setup(true);
    pressRight();
    await vi.advanceTimersByTimeAsync(TIMEOUT);

    // No verdict yet: the broadcast may simply be late.
    expect(requestWorldResync).toHaveBeenCalledWith(socket);
    expect(layer.rollbackMove).not.toHaveBeenCalled();

    world.place(100, 0); // the resync brings the move the server had accepted
    for (const cb of [...resyncListeners]) cb();
    await flush();

    expect(layer.rollbackMove).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it("transport down at the timeout: waits for the reconnect resync, then keeps the accepted move", async () => {
    const { mgr, socket, layer, world, onError, pressRight } = await setup(false);
    pressRight();
    await vi.advanceTimersByTimeAsync(TIMEOUT);

    // Nothing can be asked while disconnected, and nothing is rolled back either.
    expect(requestWorldResync).not.toHaveBeenCalled();
    expect(layer.rollbackMove).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000); // still offline, still waiting
    expect(layer.rollbackMove).not.toHaveBeenCalled();

    socket.connected = true;
    socket.fire("connect");
    world.place(100, 0); // worldSync's own resync on connect heals the mirror
    for (const cb of [...resyncListeners]) cb();
    await flush();

    expect(layer.rollbackMove).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it("after the resync the server never applied the move: only then it is rolled back, with the error", async () => {
    const { mgr, layer, onError, pressRight } = await setup(true);
    pressRight();
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(layer.rollbackMove).not.toHaveBeenCalled();

    for (const cb of [...resyncListeners]) cb(); // mirror still at (0,0)
    await flush();

    expect(layer.rollbackMove).toHaveBeenCalledWith(TOKEN_ID, 0, 0);
    expect(onError).toHaveBeenCalledWith("Move failed: network timeout");
    mgr.destroy();
  });

  it("a resync that never answers does not leave the token hanging: the fallback decides from the mirror", async () => {
    const { mgr, layer, world, pressRight } = await setup(true);
    pressRight();
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    world.place(100, 0);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(layer.rollbackMove).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it("with no answer at all and the mirror at the old position, the fallback rolls back", async () => {
    const { mgr, layer, onError, pressRight } = await setup(true);
    pressRight();
    await vi.advanceTimersByTimeAsync(TIMEOUT + 20_000);

    expect(layer.rollbackMove).toHaveBeenCalledWith(TOKEN_ID, 0, 0);
    expect(onError).toHaveBeenCalledWith("Move failed: network timeout");
    mgr.destroy();
  });

  it("destroy() while waiting cancels the pending decision (no late rollback on a dead manager)", async () => {
    const { mgr, layer, pressRight } = await setup(true);
    pressRight();
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    mgr.destroy();

    for (const cb of [...resyncListeners]) cb();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(layer.rollbackMove).not.toHaveBeenCalled();
    expect(resyncListeners.size).toBe(0);
  });
});
