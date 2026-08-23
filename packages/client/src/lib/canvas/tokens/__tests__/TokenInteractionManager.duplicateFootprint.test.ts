/**
 * TokenInteractionManager.duplicateFootprint.test.ts
 *
 * P1 (post-#194 integration audit): `duplicateSelectedToken` computed the
 * duplicate's spawn offset from the ORIGINAL token's footprint using
 * `_getActor` (base Actor only) instead of `_getEffectiveActor` (base +
 * `actorDelta`, resolved through `resolveEffectiveActor`, RNF-TOK-01).
 * `original` here is an EXISTING `TokenDocument` that may carry a delta —
 * unlike `addToken`'s brand-new placement, where `_getActor` is the correct
 * helper because no token/delta exists yet (see `_getActor`'s own docstring).
 *
 * Concretely: duplicating an unlinked token whose delta grows its size
 * ("med" -> "lg") derived the spawn offset from a 1x1 box while the token
 * itself — and its copy — render at the sprite's actual 2x2 footprint, so
 * the duplicate spawned visibly off from where its sprite sits.
 *
 * Spec: 41-token.md REQ-TOK-090, REQ-TOK-091 (duplicate modes), REQ-TOK-012
 * (footprint derives from the effective actor, never a token-level field).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";

// ---------------------------------------------------------------------------
// Minimal fakes — no PIXI required (mirrors dragFootprint.test.ts)
// ---------------------------------------------------------------------------

interface CapturedEmit {
  type: string;
  requestId?: string;
  payload: unknown;
}

/** Fake socket that captures "op" emissions and ACKs doc:create with a server id. */
function makeFakeSocket(captured: CapturedEmit[]): Socket {
  return {
    emit(event: string, envelope: unknown, ack?: (result: unknown) => void) {
      if (event !== "op") return;
      const env = envelope as CapturedEmit;
      captured.push(env);
      if (env.type === "doc:create") {
        ack?.({ ok: true, result: { documents: [{ _id: "srv-created-0" }] } });
        return;
      }
      ack?.({ ok: true, result: null });
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
    camera: { tx: 0, ty: 0, scale: 1 },
    _container: {
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    },
  };
}

function makeFakeContainer() {
  return {
    eventMode: "none",
    hitArea: null,
    on: vi.fn(),
    removeAllListeners: vi.fn(),
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
): TokenInteractionOptions {
  return {
    tokenContainer: makeFakeContainer() as never,
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

describe("TokenInteractionManager.duplicateSelectedToken — footprint (P1, RNF-TOK-01)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry(PF2E_TABLE);
  });

  it("spawns the duplicate offset by the EFFECTIVE footprint, not the base actor's, for an unlinked token with a size-growing delta", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const baseActor: FakeActor = {
      _id: ACTOR_ID,
      name: "Goblin",
      system: { traits: { size: "med" } }, // base: 1x1
    };
    const token = makeToken({
      actorLink: false,
      actorDelta: { system: { traits: { size: "lg" } } }, // effective: 2x2
      x: 0,
      y: 0,
    });

    const captured: CapturedEmit[] = [];
    const socket = makeFakeSocket(captured);
    const mirror = makeFakeMirror(SCENE_ID, [token], [baseActor]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
    (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

    await mgr.duplicateSelectedToken("raw");

    const createEmission = captured.find((e) => e.type === "doc:create");
    expect(createEmission).toBeDefined();
    const data = (createEmission!.payload as { data: Record<string, unknown>[] }).data[0];

    // Original sits at (0,0); the spawn offset is one grid cell (100) in
    // each axis, then `snapTokenToGrid` centers the footprint's bounding
    // box on the nearest cell center. With the correct 2x2 EFFECTIVE
    // footprint that lands at (150, 150). The bug — reading the BASE
    // actor's "med" via `_getActor`, footprint 1x1 — instead lands at
    // (100, 100), a visibly different (and wrong) cell.
    expect(data?.["x"]).toBe(150);
    expect(data?.["y"]).toBe(150);

    mgr.destroy();
  });

  it("still offsets by the base actor's footprint for a linked token (no delta)", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");

    const baseActor: FakeActor = {
      _id: ACTOR_ID,
      name: "Goblin",
      system: { traits: { size: "lg" } }, // 2x2
    };
    const token = makeToken({ actorLink: true, actorDelta: null, x: 0, y: 0 });

    const captured: CapturedEmit[] = [];
    const socket = makeFakeSocket(captured);
    const mirror = makeFakeMirror(SCENE_ID, [token], [baseActor]);
    const layer = makeFakeTokenLayer();
    const mgr = new TokenInteractionManager(buildOpts(socket, mirror, layer));
    (mgr as unknown as { _selectToken: (id: string) => void })._selectToken(TOKEN_ID);

    await mgr.duplicateSelectedToken("raw");

    const createEmission = captured.find((e) => e.type === "doc:create");
    const data = (createEmission!.payload as { data: Record<string, unknown>[] }).data[0];

    expect(data?.["x"]).toBe(150);
    expect(data?.["y"]).toBe(150);

    mgr.destroy();
  });
});
