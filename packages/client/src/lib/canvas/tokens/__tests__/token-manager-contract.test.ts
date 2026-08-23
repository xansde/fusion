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
 *   - for `doc:create`, mints a server-side `_id` PER DOCUMENT distinct from
 *     anything the client sent (F192-1: real doc-handlers.ts's
 *     `handleEmbeddedCreate` always does this for an embedded document —
 *     "any _id supplied by the client is ignored" — so a fake socket that
 *     just echoed the client's own id back would hide the exact bug F192-1
 *     fixed). The id is derived from the envelope's own `requestId` so it's
 *     deterministic and reproducible from a captured emission.
 */
function makeFakeSocket(captured: CapturedEmit[]): Socket {
  const socket = {
    emit(event: string, envelope: unknown, ack?: (result: unknown) => void) {
      if (event !== "op") return;
      const env = envelope as CapturedEmit;
      captured.push(env);
      if (env.type === "doc:create") {
        const payload = env.payload as { documentType?: string; data?: Record<string, unknown>[] };
        const documents = (payload.data ?? []).map((doc, i) => ({
          ...doc,
          _id: `srv-${env.requestId ?? "noreq"}-${String(i)}`,
        }));
        ack?.({ ok: true, result: { documentType: payload.documentType, documents } });
        return;
      }
      // Resolve ack immediately so sendOp Promise settles
      ack?.({ ok: true, result: null });
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
const ACTOR_ID = "actor001";

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return {
    _id: TOKEN_ID,
    name: "Goblin",
    actorId: ACTOR_ID,
    actorLink: true,
    actorDelta: null,
    x: 100,
    y: 100,
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
    getOwnedActorIds: () => new Set<string>(),
    gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
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

    await mgr.addToken(ACTOR_ID);

    const emission = captured.find((e) => e.type === "doc:create");
    expect(emission).toBeDefined();
    const result = DocCreatePayloadSchema.safeParse(emission!.payload);
    expect(result.success, `DocCreatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.data?.documentType).toBe("Token");
    expect(result.data?.parent?.type).toBe("Scene");
    expect(result.data?.parent?.id).toBe(SCENE_ID);
    // REQ-TOK-002: actorId is the content field addToken sends — no more
    // texture/width/height (REQ-TOK-010/012).
    const created = (result.data?.data as Record<string, unknown>[] | undefined)?.[0];
    expect(created?.["actorId"]).toBe(ACTOR_ID);
    expect(created).not.toHaveProperty("texture");
    expect(created).not.toHaveProperty("width");
    expect(created).not.toHaveProperty("height");

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

  // -------------------------------------------------------------------------
  // duplicateSelectedToken — TK090, spec 41-token.md REQ-TOK-090/091, DEC-TOK-14
  // -------------------------------------------------------------------------

  describe("duplicateSelectedToken", () => {
    it("'raw' mode on an unlinked token emits ONLY doc:create — no actorDelta write", async () => {
      const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

      const token = makeToken({
        actorLink: false,
        actorDelta: { system: { attributes: { hp: { value: 3, max: 20 } } } },
      });
      const mirror = makeFakeMirror(SCENE_ID, [token]);
      const layer = makeFakeTokenLayer();
      const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
      (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

      await mgr.duplicateSelectedToken("raw");

      expect(captured.filter((e) => e.type === "doc:create")).toHaveLength(1);
      expect(captured.filter((e) => e.type === "doc:update")).toHaveLength(0);

      const created = DocCreatePayloadSchema.parse(
        captured.find((e) => e.type === "doc:create")!.payload,
      );
      const data = (created.data as Record<string, unknown>[])[0];
      expect(data?.["actorId"]).toBe(ACTOR_ID);
      expect(data).not.toHaveProperty("actorDelta");

      mgr.destroy();
    });

    it("'identical' mode on an unlinked token with a delta emits doc:create THEN a follow-up doc:update copying actorDelta", async () => {
      const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

      const delta = { system: { attributes: { hp: { value: 3, max: 20 } } } };
      const token = makeToken({ actorLink: false, actorDelta: delta });
      const mirror = makeFakeMirror(SCENE_ID, [token]);
      const layer = makeFakeTokenLayer();
      const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
      (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

      await mgr.duplicateSelectedToken("identical");

      expect(captured.filter((e) => e.type === "doc:create")).toHaveLength(1);
      const updateEmission = captured.find((e) => e.type === "doc:update");
      expect(updateEmission).toBeDefined();
      const updateResult = DocUpdatePayloadSchema.parse(updateEmission!.payload);
      expect(updateResult.updates[0]?.diff).toMatchObject({ actorDelta: delta });
      expect(updateResult.updates[0]?.embedded?.type).toBe("Token");
      expect(updateResult.updates[0]?.embedded?.id).toBe(SCENE_ID);
      // F192-1: the updated id is the SERVER-ASSIGNED id from the doc:create
      // ack (`srv-<requestId>-0`, per the fake socket above) — never
      // anything the client sent in the create payload (it sends none at
      // all, see duplicateSelectedToken), and never the original's.
      const createEmission = captured.find((e) => e.type === "doc:create")!;
      const serverAssignedId = `srv-${createEmission.requestId ?? "noreq"}-0`;
      expect(updateResult.updates[0]?._id).toBe(serverAssignedId);
      expect(updateResult.updates[0]?._id).not.toBe(TOKEN_ID);

      mgr.destroy();
    });

    it("DEC-TOK-14/REQ-TOK-091: on a LINKED token, 'raw' and 'identical' collapse into the exact same single write", async () => {
      const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

      for (const mode of ["raw", "identical"] as const) {
        captured = [];
        socket = makeFakeSocket(captured);
        const token = makeToken({ actorLink: true, actorDelta: null });
        const mirror = makeFakeMirror(SCENE_ID, [token]);
        const layer = makeFakeTokenLayer();
        const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
        (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

        await mgr.duplicateSelectedToken(mode);

        // Exactly one write, whichever mode was asked for — no second
        // actorDelta write ever fires for a linked token (nothing to copy).
        expect(captured).toHaveLength(1);
        expect(captured[0]?.type).toBe("doc:create");

        mgr.destroy();
      }
    });

    // -----------------------------------------------------------------------
    // F192-1: the follow-up doc:update MUST target the server-assigned _id,
    // never a client-guessed one — a server that actually rejects an
    // unknown _id (as the real one does, NOT_FOUND) is the regression guard.
    // -----------------------------------------------------------------------

    /**
     * A fake socket that behaves like the real server for this bug: doc:create
     * always mints its own `_id` (`SERVER_TOKEN_ID`, unrelated to anything the
     * client sent), and doc:update is only accepted when it targets that exact
     * id — anything else (e.g. an id the client made up) comes back NOT_FOUND,
     * exactly like doc-handlers.ts's handleEmbeddedUpdate does for an id that
     * doesn't exist in the parent's embedded collection.
     */
    function makeStrictServerIdSocket(
      captured: CapturedEmit[],
      serverTokenId: string,
      updateBehavior: "acceptOnlyServerTokenId" | "alwaysRejectUpdate",
    ): Socket {
      const socket = {
        emit(event: string, envelope: unknown, ack?: (result: unknown) => void) {
          if (event !== "op") return;
          const env = envelope as CapturedEmit;
          captured.push(env);
          if (env.type === "doc:create") {
            const payload = env.payload as {
              documentType?: string;
              data?: Record<string, unknown>[];
            };
            const documents = (payload.data ?? []).map((doc) => ({ ...doc, _id: serverTokenId }));
            ack?.({ ok: true, result: { documentType: payload.documentType, documents } });
            return;
          }
          if (env.type === "doc:update") {
            const payload = env.payload as { updates?: { _id?: string }[] };
            const targetId = payload.updates?.[0]?._id;
            const rejected =
              updateBehavior === "alwaysRejectUpdate" ||
              (updateBehavior === "acceptOnlyServerTokenId" && targetId !== serverTokenId);
            if (rejected) {
              ack?.({
                ok: false,
                code: "NOT_FOUND",
                message: `Document not found: Token/${targetId}`,
              });
              return;
            }
            ack?.({ ok: true, result: null });
            return;
          }
          ack?.({ ok: true, result: null });
        },
      } as unknown as Socket;
      return socket;
    }

    it("F192-1: uses the doc:create ack's server-assigned _id for the actorDelta update — a client-guessed id would be rejected NOT_FOUND", async () => {
      const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

      const delta = { system: { attributes: { hp: { value: 3, max: 20 } } } };
      const token = makeToken({ actorLink: false, actorDelta: delta });
      const mirror = makeFakeMirror(SCENE_ID, [token]);
      const layer = makeFakeTokenLayer();
      const strictCaptured: CapturedEmit[] = [];
      const strictSocket = makeStrictServerIdSocket(
        strictCaptured,
        "server-minted-token-id",
        "acceptOnlyServerTokenId",
      );
      const onError = vi.fn();
      const opts = { ...buildOpts(strictSocket, mirror, layer), onError };
      const mgr = new TokenInteractionManager(opts);
      (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

      await mgr.duplicateSelectedToken("identical");

      // If the implementation regressed to using a client-guessed id, the
      // socket above would NOT_FOUND the update and onError would fire.
      expect(onError).not.toHaveBeenCalled();
      const updateEmission = strictCaptured.find((e) => e.type === "doc:update");
      expect(updateEmission).toBeDefined();
      const updateResult = DocUpdatePayloadSchema.parse(updateEmission!.payload);
      expect(updateResult.updates[0]?._id).toBe("server-minted-token-id");

      mgr.destroy();
    });

    it("F192-1: when the actorDelta update fails after the token was already created, reports a SPECIFIC error — not the generic duplicate-failure message", async () => {
      const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

      const delta = { system: { attributes: { hp: { value: 3, max: 20 } } } };
      const token = makeToken({ actorLink: false, actorDelta: delta });
      const mirror = makeFakeMirror(SCENE_ID, [token]);
      const layer = makeFakeTokenLayer();
      const strictCaptured: CapturedEmit[] = [];
      const strictSocket = makeStrictServerIdSocket(
        strictCaptured,
        "server-minted-token-id",
        "alwaysRejectUpdate",
      );
      const onError = vi.fn();
      const opts = { ...buildOpts(strictSocket, mirror, layer), onError };
      const mgr = new TokenInteractionManager(opts);
      (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

      await mgr.duplicateSelectedToken("identical");

      // The create itself succeeded — a generic "Failed to duplicate token"
      // would send the user hunting for a token that IS actually there.
      expect(strictCaptured.filter((e) => e.type === "doc:create")).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
      const message = onError.mock.calls[0]?.[0] as string;
      expect(message).not.toBe("Failed to duplicate token");
      expect(message.toLowerCase()).toContain("duplicated");
      expect(message.toLowerCase()).toMatch(/life total|hp/);

      mgr.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// R3 — _handleKeyDown must ignore keystrokes aimed at a text field
// (spec 23 REQ-A11-036, spec 41-token.md REQ-TOK-090/091)
// ---------------------------------------------------------------------------

/**
 * Minimal stand-in for a KeyboardEvent — the client test suite runs under
 * Vitest's `node` environment (no jsdom, no real `KeyboardEvent`/`Element`
 * globals; see isEditableTarget's docstring in token-interaction.ts for why
 * the guard itself avoids `instanceof HTMLElement`). Only the fields
 * `_handleKeyDown` actually reads are present.
 */
function makeFakeKeyEvent(
  code: string,
  target: { tagName?: string; isContentEditable?: boolean } | null,
  opts: { shiftKey?: boolean } = {},
): KeyboardEvent {
  return {
    code,
    shiftKey: opts.shiftKey ?? false,
    target,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe("TokenInteractionManager — _handleKeyDown editable-target guard (R3)", () => {
  let captured: CapturedEmit[];
  let socket: Socket;

  beforeEach(() => {
    captured = [];
    socket = makeFakeSocket(captured);
  });

  it("KeyD (duplicate), Backspace (delete) and ArrowUp (move) all no-op when the event target is an input/textarea/contenteditable", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const token = makeToken({ x: 100, y: 100 });
    const mirror = makeFakeMirror(SCENE_ID, [token]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
    (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);
    const handleKeyDown = (mgr as unknown as { _handleKeyDown: (e: KeyboardEvent) => void })
      ._handleKeyDown;

    const editableTargets: { tagName?: string; isContentEditable?: boolean }[] = [
      { tagName: "INPUT" },
      { tagName: "TEXTAREA" },
      { tagName: "DIV", isContentEditable: true }, // TipTap's chat composer
    ];

    for (const target of editableTargets) {
      captured = [];
      const dupEvent = makeFakeKeyEvent("KeyD", target, { shiftKey: true });
      handleKeyDown.call(mgr, dupEvent);
      const delEvent = makeFakeKeyEvent("Backspace", target);
      handleKeyDown.call(mgr, delEvent);
      const arrowEvent = makeFakeKeyEvent("ArrowUp", target);
      handleKeyDown.call(mgr, arrowEvent);

      expect(captured, `target=${JSON.stringify(target)}`).toHaveLength(0);
      expect(layer.applyLocalMove, `target=${JSON.stringify(target)}`).not.toHaveBeenCalled();
      expect(arrowEvent.preventDefault, `target=${JSON.stringify(target)}`).not.toHaveBeenCalled();
    }

    mgr.destroy();
  });

  it("the same keys still work when the event target is NOT editable (e.g. document.body)", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const token = makeToken({ x: 100, y: 100 });
    const mirror = makeFakeMirror(SCENE_ID, [token]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
    (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);
    const handleKeyDown = (mgr as unknown as { _handleKeyDown: (e: KeyboardEvent) => void })
      ._handleKeyDown;

    const bodyTarget = { tagName: "BODY" };

    const arrowEvent = makeFakeKeyEvent("ArrowUp", bodyTarget);
    handleKeyDown.call(mgr, arrowEvent);
    expect(layer.applyLocalMove).toHaveBeenCalledTimes(1);
    expect(arrowEvent.preventDefault).toHaveBeenCalledTimes(1);

    const dupEvent = makeFakeKeyEvent("KeyD", bodyTarget, { shiftKey: true });
    handleKeyDown.call(mgr, dupEvent);
    await vi.waitFor(() => {
      expect(captured.some((e) => e.type === "doc:create")).toBe(true);
    });

    mgr.destroy();
  });
});
