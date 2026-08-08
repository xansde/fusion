/**
 * token-manager-contract.test.ts
 *
 * Integration tests verifying that TokenInteractionManager emits socket
 * payloads that satisfy the server-side protocol schemas.
 *
 * Issue: the previous TokenInteractionManager used a custom embedded-operation
 * format that was not understood by the server's DocUpdatePayloadSchema — every
 * token op failed with VALIDATION_FAILED in production while unit tests passed
 * because they mocked the payload directly.
 *
 * These tests use a fake socket that captures "op" emissions and validates the
 * payload against DocUpdatePayloadSchema / DocCreatePayloadSchema /
 * DocDeletePayloadSchema — the same schemas the server runs safeParse against.
 *
 * No PIXI, no DOM. Safe under Vitest node environment.
 *
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050..052
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-034..036
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DocUpdatePayloadSchema,
  DocCreatePayloadSchema,
  DocDeletePayloadSchema,
  SquareGrid,
} from "@fusion/shared";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";

// ---------------------------------------------------------------------------
// Minimal fakes — no PIXI required
// ---------------------------------------------------------------------------

/** Captured emission: the full envelope passed to socket.emit("op", ...) */
interface CapturedEmit {
  type: string;
  requestId?: string;
  payload: unknown;
}

/**
 * Build a fake Socket that:
 *   - captures emitted "op" envelopes into `captured`
 *   - immediately calls the ack callback with ok:true so sendOp resolves
 */
function makeFakeSocket(captured: CapturedEmit[]): Socket {
  const socket = {
    emit(event: string, envelope: unknown, ack?: (result: unknown) => void) {
      if (event === "op") {
        captured.push(envelope as CapturedEmit);
        // Resolve ack immediately so sendOp Promise settles
        ack?.({ ok: true, result: null });
      }
    },
  } as unknown as Socket;
  return socket;
}

/**
 * Minimal stub for DocumentMirror — returns a scene with the given tokens.
 */
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

/**
 * Minimal stub for TokenLayer — enough to satisfy TokenInteractionOptions.
 */
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

/**
 * Minimal stub for FusionCanvas.
 */
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

/**
 * Minimal stub for PIXI Container used as tokenContainer.
 */
function makeFakeContainer() {
  return {
    eventMode: "none",
    hitArea: null,
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SCENE_ID = "scene001";
const TOKEN_ID = "tok001";

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return {
    _id: TOKEN_ID,
    name: "Goblin",
    actorId: null,
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

// ---------------------------------------------------------------------------
// Helper: build TokenInteractionManager options
// ---------------------------------------------------------------------------

function buildOpts(
  socket: Socket,
  mirror: ReturnType<typeof makeFakeMirror>,
  tokenLayer: ReturnType<typeof makeFakeTokenLayer>,
): TokenInteractionOptions {
  return {
    tokenContainer: makeFakeContainer() as never,
    tokenLayer: tokenLayer as never,
    mirror: mirror as never,
    sceneId: SCENE_ID,
    canvas: makeFakeCanvas() as never,
    socket,
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TokenInteractionManager — socket payload contract", () => {
  let captured: CapturedEmit[];
  let socket: Socket;

  beforeEach(() => {
    captured = [];
    socket = makeFakeSocket(captured);
  });

  // -------------------------------------------------------------------------
  // addToken → doc:create
  // -------------------------------------------------------------------------

  it("addToken emits doc:create with payload satisfying DocCreatePayloadSchema", async () => {
    // Lazy import to avoid PIXI at module-load time (vitest node env)
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const mirror = makeFakeMirror(SCENE_ID, []);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));

    await mgr.addToken("Goblin", null);

    const emission = captured.find((e) => e.type === "doc:create");
    expect(emission).toBeDefined();
    const result = DocCreatePayloadSchema.safeParse(emission!.payload);
    expect(result.success, `DocCreatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Token");
    expect(result.data?.parent?.type).toBe("Scene");
    expect(result.data?.parent?.id).toBe(SCENE_ID);

    mgr.destroy();
  });

  // -------------------------------------------------------------------------
  // deleteSelectedToken → doc:delete
  // -------------------------------------------------------------------------

  it("deleteSelectedToken emits doc:delete with payload satisfying DocDeletePayloadSchema", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const token = makeToken();
    const mirror = makeFakeMirror(SCENE_ID, [token]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));

    // Simulate selection by calling the private helper indirectly via the
    // public selectedIds — we use a slightly roundabout path since _selectedIds
    // is private.  The easiest route without exposing internals is to call
    // deselectAll + reflect via a sub-class trick.  Instead we use the
    // public deleteSelectedToken which checks selectedIds.size > 0,
    // so we need at least one selected ID.
    //
    // We expose a test-only path: call the internal select through keyboard ESC
    // first by casting.  For the contract test the cleanest approach is to cast
    // the manager and call the private _selectToken directly.
    (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

    await mgr.deleteSelectedToken();

    const emission = captured.find((e) => e.type === "doc:delete");
    expect(emission).toBeDefined();
    const result = DocDeletePayloadSchema.safeParse(emission!.payload);
    expect(result.success, `DocDeletePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Token");
    expect(result.data?.ids).toContain(TOKEN_ID);
    expect(result.data?.parent?.type).toBe("Scene");
    expect(result.data?.parent?.id).toBe(SCENE_ID);

    mgr.destroy();
  });

  // -------------------------------------------------------------------------
  // toggleHiddenSelectedToken → doc:update (hidden diff)
  // -------------------------------------------------------------------------

  it("toggleHiddenSelectedToken emits doc:update with payload satisfying DocUpdatePayloadSchema", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const token = makeToken({ hidden: false });
    const mirror = makeFakeMirror(SCENE_ID, [token]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));

    (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

    await mgr.toggleHiddenSelectedToken();

    const emission = captured.find((e) => e.type === "doc:update");
    expect(emission).toBeDefined();
    const result = DocUpdatePayloadSchema.safeParse(emission!.payload);
    expect(result.success, `DocUpdatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Token");
    expect(result.data?.updates[0]?._id).toBe(TOKEN_ID);
    expect(result.data?.updates[0]?.diff).toMatchObject({ hidden: true });
    expect(result.data?.updates[0]?.embedded?.type).toBe("Token");
    expect(result.data?.updates[0]?.embedded?.id).toBe(SCENE_ID);

    mgr.destroy();
  });

  // -------------------------------------------------------------------------
  // _sendMoveOp → doc:update (x/y diff) — the optimistic move path
  // -------------------------------------------------------------------------

  it("_sendMoveOp emits doc:update with payload satisfying DocUpdatePayloadSchema", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const token = makeToken({ x: 100, y: 100 });
    const mirror = makeFakeMirror(SCENE_ID, [token]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));

    // Call _sendMoveOp directly (it's private — cast to access for testing).
    await (
      mgr as unknown as {
        _sendMoveOp(
          tokenId: string,
          newX: number,
          newY: number,
          originalX: number,
          originalY: number,
          requestId: string,
        ): Promise<void>;
      }
    )._sendMoveOp(TOKEN_ID, 200, 300, 100, 100, "req-test-001");

    const emission = captured.find((e) => e.type === "doc:update");
    expect(emission).toBeDefined();
    const result = DocUpdatePayloadSchema.safeParse(emission!.payload);
    expect(result.success, `DocUpdatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Token");
    expect(result.data?.updates[0]?._id).toBe(TOKEN_ID);
    expect(result.data?.updates[0]?.diff).toMatchObject({ x: 200, y: 300 });
    expect(result.data?.updates[0]?.embedded?.type).toBe("Token");
    expect(result.data?.updates[0]?.embedded?.id).toBe(SCENE_ID);

    mgr.destroy();
  });
});
