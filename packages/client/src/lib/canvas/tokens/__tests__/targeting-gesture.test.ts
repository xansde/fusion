/**
 * targeting-gesture.test.ts — BHR-F3-01 / GUE-F1-01 (D-G01, REQ-BHR-081).
 *
 * The aim gesture lives on the canvas: right-click on a token toggles the
 * user's aim (`combat:target`), Esc clears only the user's own aim, and the
 * left button keeps selecting/dragging without ever aiming. Replaces the
 * ALQ-F1-10 scaffolding (left-click on a foreign token set the target).
 * `getMyTargets` is mocked to control "already aimed"; `combatActions.target`
 * and `setMyTargets` stay real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TokenDocument } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import type { TokenInteractionOptions } from "../TokenInteractionManager.js";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";
import type * as CombatStoreModule from "../../../combat/combatStore.svelte.js";
import { getTargetingState, setTargetingViewer } from "../../../combat/combatStore.svelte.js";
import { applyTargeted } from "../../../combat/targeting.js";

const mockGetMyTargets =
  vi.fn<() => ReadonlyArray<{ tokenId: string; actorId: string | null; name: string }>>();

vi.mock("../../../combat/combatStore.svelte.js", async (importOriginal) => {
  const actual = await importOriginal<typeof CombatStoreModule>();
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

function pointer(
  container: ReturnType<typeof makeFakeContainer>,
  target: unknown,
  button: number,
): void {
  const down = container._handlers.get("pointerdown");
  const up = container._handlers.get("pointerup");
  down?.({ button, target, clientX: 10, clientY: 10, stopPropagation: () => {} });
  up?.({ button });
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

const targetOps = (ops: RecordedOp[]) => ops.filter((op) => op.type === "combat:target");

async function build(
  role = ROLE_PLAYER,
  owned: () => ReadonlySet<string> = () => new Set(),
  tokens = [makeToken()],
) {
  const { TokenInteractionManager } = await import("../TokenInteractionManager.js");
  const container = makeFakeContainer();
  const { socket, ops } = makeSpySocket();
  const mgr = new TokenInteractionManager(
    makeManagerOpts(container, makeFakeMirror(SCENE_ID, tokens), socket, role, owned),
  );
  return { mgr, container, ops };
}

// Node env has no `window`: drive the (private) keydown handler directly.
function pressEsc(mgr: unknown): void {
  (mgr as { _handleKeyDown(e: unknown): void })._handleKeyDown({
    code: "Escape",
    target: null,
    preventDefault() {},
  });
}

describe("TokenInteractionManager — right-click aim gesture (BHR-F3-01, D-G01)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry({ med: { width: 1, height: 1 } });
    mockGetMyTargets.mockReset().mockReturnValue([]);
    setTargetingViewer("user-player");
    const st = getTargetingState();
    st.byUser.clear();
  });

  it("right-click on a token emits combat:target targeted:true", async () => {
    const { mgr, container, ops } = await build();
    pointer(container, makeFakeTarget(TOKEN_ID), 2);
    await Promise.resolve();
    expect(targetOps(ops)).toEqual([
      { type: "combat:target", payload: { tokenId: TOKEN_ID, targeted: true } },
    ]);
    mgr.destroy();
  });

  it("the second right-click on the same token undoes the aim", async () => {
    mockGetMyTargets.mockReturnValue([{ tokenId: TOKEN_ID, actorId: ACTOR_ID, name: "Eagle" }]);
    const { mgr, container, ops } = await build();
    pointer(container, makeFakeTarget(TOKEN_ID), 2);
    await Promise.resolve();
    expect(targetOps(ops)).toEqual([
      { type: "combat:target", payload: { tokenId: TOKEN_ID, targeted: false } },
    ]);
    mgr.destroy();
  });

  it("works for the GM and for an owned token (no role/ownership gate)", async () => {
    const { mgr, container, ops } = await build(ROLE_GM, () => new Set([ACTOR_ID]));
    pointer(container, makeFakeTarget(TOKEN_ID), 2);
    await Promise.resolve();
    expect(targetOps(ops)).toHaveLength(1);
    mgr.destroy();
  });

  it("right-click does not select the token nor start a drag", async () => {
    const { mgr, container } = await build();
    pointer(container, makeFakeTarget(TOKEN_ID), 2);
    expect([...mgr.selectedIds]).toEqual([]);
    mgr.destroy();
  });

  it("right-click on empty canvas does nothing", async () => {
    const { mgr, container, ops } = await build();
    pointer(container, { label: "map", parent: null }, 2);
    await Promise.resolve();
    expect(ops).toHaveLength(0);
    mgr.destroy();
  });

  it("left-click keeps selecting and never aims (scaffolding removed)", async () => {
    const { mgr, container, ops } = await build();
    pointer(container, makeFakeTarget(TOKEN_ID), 0);
    await Promise.resolve();
    expect([...mgr.selectedIds]).toEqual([TOKEN_ID]);
    expect(targetOps(ops)).toHaveLength(0);
    mgr.destroy();
  });

  it("Esc clears only the user's own aim, leaving other users' aims", async () => {
    const st = getTargetingState();
    applyTargeted(st, "tokA", true, "user-player");
    applyTargeted(st, "tokB", true, "user-player");
    applyTargeted(st, "tokC", true, "user-other");
    const { mgr, ops } = await build();
    pressEsc(mgr);
    await new Promise((r) => setTimeout(r, 0));
    expect(targetOps(ops).map((o) => o.payload)).toEqual([
      { tokenId: "tokA", targeted: false },
      { tokenId: "tokB", targeted: false },
    ]);
    mgr.destroy();
  });

  it("Esc with no aim emits nothing", async () => {
    const { mgr, ops } = await build();
    pressEsc(mgr);
    await new Promise((r) => setTimeout(r, 0));
    expect(ops).toHaveLength(0);
    mgr.destroy();
  });

  it("I6: Esc consumido por outro handler (defaultPrevented) não limpa a mira", async () => {
    applyTargeted(getTargetingState(), "tokA", true, "user-player");
    const { mgr, ops } = await build();
    (mgr as unknown as { _handleKeyDown(e: unknown): void })._handleKeyDown({
      code: "Escape",
      target: null,
      defaultPrevented: true,
      preventDefault() {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(targetOps(ops)).toHaveLength(0);
    mgr.destroy();
  });

  it("I6: Esc com diálogo aberto não limpa a mira; sem diálogo limpa", async () => {
    applyTargeted(getTargetingState(), "tokA", true, "user-player");
    const { mgr, ops } = await build();
    vi.stubGlobal("document", {
      activeElement: null,
      querySelector: (sel: string) => (sel.includes("dialog") ? { tagName: "DIALOG" } : null),
    });
    try {
      pressEsc(mgr);
      await new Promise((r) => setTimeout(r, 0));
      expect(targetOps(ops)).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
    pressEsc(mgr);
    await new Promise((r) => setTimeout(r, 0));
    expect(targetOps(ops).map((o) => o.payload)).toEqual([{ tokenId: "tokA", targeted: false }]);
    mgr.destroy();
  });

  it("I6: Esc com foco em campo editável não limpa a mira", async () => {
    applyTargeted(getTargetingState(), "tokA", true, "user-player");
    const { mgr, ops } = await build();
    vi.stubGlobal("document", {
      activeElement: { tagName: "INPUT", type: "text" },
      querySelector: () => null,
    });
    try {
      pressEsc(mgr);
      await new Promise((r) => setTimeout(r, 0));
      expect(targetOps(ops)).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
    mgr.destroy();
  });

  it("Esc while dragging only cancels the drag and keeps the aim", async () => {
    applyTargeted(getTargetingState(), "tokA", true, "user-player");
    const { mgr, ops } = await build();
    (mgr as unknown as { _drag: unknown })._drag = {
      state: "dragging",
      context: { tokenId: TOKEN_ID, originalX: 0, originalY: 0 },
    };
    pressEsc(mgr);
    await new Promise((r) => setTimeout(r, 0));
    expect(targetOps(ops)).toHaveLength(0);
    mgr.destroy();
  });
});
