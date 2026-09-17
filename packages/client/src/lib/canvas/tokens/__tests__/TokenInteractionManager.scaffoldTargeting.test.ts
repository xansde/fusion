/**
 * TokenInteractionManager.scaffoldTargeting.test.ts — ALQ-F1-10 SCAFFOLDING,
 * I5 fix (onda-5 adversarial review).
 *
 * F1-05 built `combat:target` and `combatStore`'s live-target state
 * ("exposto às fichas"), but no production UI ever called it — there was no
 * real click gatilho to set a combat target anywhere in the client. This
 * covers the minimal scaffolding TokenInteractionManager.ts added: a single
 * click on a token the clicker does NOT own toggles it in/out of their live
 * target selection (REQ-CBT-056), just enough for AbilityCard's "Alvos: …"
 * line to have a real `targetSnapshot` to read at roll time.
 *
 * I5 (onda-5): the click used to always send `targeted: true` and never
 * clear it (every inspection click on a different NPC ADDED a target,
 * never removed one — D-02 then applies damage to all of them), and it
 * excluded any privileged role, leaving the GM with no gatilho at all.
 * `getMyTargets` (from `combatStore.svelte.js`) is partially mocked here —
 * `combatActions.target` stays REAL (so the existing ops-capture assertions
 * below keep working unchanged) — to control what the click handler sees as
 * "already targeted" without needing a full server round-trip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";

const mockGetMyTargets =
  vi.fn<() => ReadonlyArray<{ tokenId: string; actorId: string | null; name: string }>>();

vi.mock("../../../combat/combatStore.svelte.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../combat/combatStore.svelte.js")>();
  return { ...actual, getMyTargets: () => mockGetMyTargets() };
});

// ---------------------------------------------------------------------------
// Minimal fakes — mirrors TokenInteractionManager.openSheet.test.ts's harness
// (no PIXI required), with a socket that records every "op" emit instead of
// just acking it, so a test can assert whether combat:target fired.
// ---------------------------------------------------------------------------

interface RecordedOp {
  type: string;
  payload: unknown;
}

function makeSpySocket(): { socket: Socket; ops: RecordedOp[] } {
  const ops: RecordedOp[] = [];
  const socket = {
    emit(
      event: string,
      envelope: { type: string; payload: unknown },
      ack?: (result: unknown) => void,
    ) {
      if (event === "op") {
        ops.push({ type: envelope.type, payload: envelope.payload });
        ack?.({ ok: true, result: null });
      }
    },
  } as unknown as Socket;
  return { socket, ops };
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
const ROLE_GM = 4;

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

function makeFakeTarget(tokenId: string) {
  return { label: `token:${tokenId}`, parent: null };
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

function makeManagerOpts(
  container: ReturnType<typeof makeFakeContainer>,
  mirror: unknown,
  socket: Socket,
  role: number,
  owned: () => ReadonlySet<string>,
): TokenInteractionOptions {
  return {
    tokenContainer: container as never,
    tokenLayer: makeFakeTokenLayer() as never,
    mirror: mirror as never,
    sceneId: SCENE_ID,
    canvas: makeFakeCanvas() as never,
    socket,
    userId: PLAYER_ID,
    userRole: role,
    getOwnedActorIds: owned,
    gridConfig: { size: 100, offsetX: 0, offsetY: 0 },
    attachKeyboard: false,
  } as unknown as TokenInteractionOptions;
}

describe("TokenInteractionManager — scaffolding target-on-click (ALQ-F1-10, REQ-CBT-056, I5)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry({ med: { width: 1, height: 1 } });
    // Default: nothing currently targeted (a fresh scene) -- every test below
    // that DOES want "already targeted" overrides this explicitly.
    mockGetMyTargets.mockReset().mockReturnValue([]);
  });

  it("a player clicking a token they do NOT own sets it as their target", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(SCENE_ID, [makeToken()]);
    const { socket, ops } = makeSpySocket();
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, socket, ROLE_PLAYER, () => new Set()),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    await Promise.resolve(); // let the fire-and-forget combatActions.target settle

    const targetOps = ops.filter((op) => op.type === "combat:target");
    expect(targetOps).toEqual([
      { type: "combat:target", payload: { tokenId: TOKEN_ID, targeted: true } },
    ]);

    mgr.destroy();
  });

  it("a player clicking a token they DO own does not target it", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(SCENE_ID, [makeToken()]);
    const { socket, ops } = makeSpySocket();
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, socket, ROLE_PLAYER, () => new Set([ACTOR_ID])),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    await Promise.resolve();

    expect(ops.filter((op) => op.type === "combat:target")).toHaveLength(0);

    mgr.destroy();
  });

  it("I5: a GM clicking a token now ALSO targets it (no role gate — the GM had no targeting gatilho at all before this fix)", async () => {
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(SCENE_ID, [makeToken()]);
    const { socket, ops } = makeSpySocket();
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, socket, ROLE_GM, () => new Set()),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    await Promise.resolve();

    expect(ops.filter((op) => op.type === "combat:target")).toEqual([
      { type: "combat:target", payload: { tokenId: TOKEN_ID, targeted: true } },
    ]);

    mgr.destroy();
  });

  it("I5: clicking an ALREADY-targeted token toggles it OFF (used to only ever send targeted:true, arming every inspected NPC as an extra target)", async () => {
    mockGetMyTargets.mockReturnValue([{ tokenId: TOKEN_ID, actorId: ACTOR_ID, name: "Eagle" }]);
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(SCENE_ID, [makeToken()]);
    const { socket, ops } = makeSpySocket();
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, socket, ROLE_PLAYER, () => new Set()),
    );

    click(container, makeFakeTarget(TOKEN_ID));
    await Promise.resolve();

    expect(ops.filter((op) => op.type === "combat:target")).toEqual([
      { type: "combat:target", payload: { tokenId: TOKEN_ID, targeted: false } },
    ]);

    mgr.destroy();
  });

  it("I5: clicking a DIFFERENT token while one is already targeted only toggles the CLICKED one -- inspecting several NPCs no longer accumulates targets", async () => {
    const OTHER_TOKEN_ID = "tok002";
    mockGetMyTargets.mockReturnValue([{ tokenId: TOKEN_ID, actorId: ACTOR_ID, name: "Eagle" }]);
    const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
    const container = makeFakeContainer();
    const mirror = makeFakeMirror(SCENE_ID, [
      makeToken(),
      makeToken({ _id: OTHER_TOKEN_ID, actorId: "actor002" }),
    ]);
    const { socket, ops } = makeSpySocket();
    const mgr = new TokenInteractionManager(
      makeManagerOpts(container, mirror, socket, ROLE_PLAYER, () => new Set()),
    );

    click(container, makeFakeTarget(OTHER_TOKEN_ID));
    await Promise.resolve();

    expect(ops.filter((op) => op.type === "combat:target")).toEqual([
      { type: "combat:target", payload: { tokenId: OTHER_TOKEN_ID, targeted: true } },
    ]);

    mgr.destroy();
  });
});
