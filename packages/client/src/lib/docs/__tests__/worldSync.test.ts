/**
 * worldSync.test.ts — unit tests for attachWorldSync wiring.
 *
 * Tests (corresponding to audit fixes applied in M1-B):
 *   1. world:activeScene envelope arriving on "op" channel updates activeSceneState
 *      (fix: was dead code — was registered on "world:activeScene" event which server never emits)
 *   2. Gap detection in DocumentMirror triggers a resync:request via socket.emit
 *      (fix: worldMirror.onGap was never connected in attachWorldSync)
 *   3. resync:full / resync:delta envelopes arriving on "op" are processed inline
 *      (fix: they were ignored — now processed by onOp directly)
 *
 * Uses a mock socket (no real socket.io connection) and mocks the Svelte
 * activeScene module (uses $state rune, incompatible with pure-Node Vitest).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Socket } from "socket.io-client";
import type { Envelope, WorldSnapshotPayload } from "@fusion/shared";
import type { DocumentMirror } from "../DocumentMirror.js";

// ---------------------------------------------------------------------------
// Mock Svelte activeScene module
// ---------------------------------------------------------------------------

const mockSetActiveSceneId = vi.fn<[string | null, unknown], void>();
const mockSyncActiveSceneFromMirror = vi.fn<[unknown], void>();

vi.mock("../activeScene.svelte.js", () => ({
  activeSceneState: { id: null, scene: null },
  setActiveSceneId: mockSetActiveSceneId,
  syncActiveSceneFromMirror: mockSyncActiveSceneFromMirror,
}));

// ---------------------------------------------------------------------------
// Mock socket helper
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;
type EmitCallback = (ack: unknown) => void;

function makeMockSocket(connected = false): {
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  /** Simulate an event arriving from the server */
  receive: (event: string, ...args: unknown[]) => void;
  /** Get all handlers registered for an event */
  getHandlers: (event: string) => EventHandler[];
  /** Last emit call args */
  lastEmit: () => [string, unknown, EmitCallback | undefined] | null;
} {
  const handlers: Map<string, EventHandler[]> = new Map();
  const emits: Array<[string, unknown, EmitCallback | undefined]> = [];

  const socket = {
    connected,
    on: vi.fn((event: string, handler: EventHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    off: vi.fn((event: string, handler: EventHandler) => {
      const list = handlers.get(event) ?? [];
      handlers.set(
        event,
        list.filter((h) => h !== handler),
      );
    }),
    emit: vi.fn((event: string, payload: unknown, cb?: EmitCallback) => {
      emits.push([event, payload, cb]);
    }),
  };

  const receive = (event: string, ...args: unknown[]) => {
    for (const h of handlers.get(event) ?? []) {
      h(...args);
    }
  };

  const getHandlers = (event: string): EventHandler[] => handlers.get(event) ?? [];

  const lastEmit = (): [string, unknown, EmitCallback | undefined] | null =>
    emits.length > 0 ? (emits[emits.length - 1] ?? null) : null;

  return { ...socket, receive, getHandlers, lastEmit };
}

// ---------------------------------------------------------------------------
// Import module under test (after mocks are set up)
// ---------------------------------------------------------------------------

async function importWorldSync(): Promise<{
  attachWorldSync: (socket: Socket) => () => void;
  worldMirror: DocumentMirror;
}> {
  const mod = await import("../worldSync.js");
  return mod as unknown as {
    attachWorldSync: (socket: Socket) => () => void;
    worldMirror: DocumentMirror;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope(type: string, payload: unknown, seq?: number): Envelope<unknown> {
  return { type, payload, ts: Date.now(), seq } as Envelope<unknown>;
}

function makeSnapshot(seq: number, activeSceneId: string | null = null): WorldSnapshotPayload {
  return { seq, activeSceneId, documents: { Scene: [], Actor: [] } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("worldSync — world:activeScene on 'op' channel (fix 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls setActiveSceneId when world:activeScene envelope arrives on 'op'", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    // Apply snapshot first so mirror exits boot phase
    worldMirror.applySnapshot(makeSnapshot(0));

    attachWorldSync(socket as unknown as Socket);

    const sceneId = "abcdefghij012345";
    const envelope = makeEnvelope("world:activeScene", { sceneId }, 1);

    // Simulate server emitting the envelope on the "op" channel
    socket.receive("op", envelope);

    expect(mockSetActiveSceneId).toHaveBeenCalledOnce();
    expect(mockSetActiveSceneId).toHaveBeenCalledWith(sceneId, worldMirror);
  });

  it("advances the mirror seq when world:activeScene arrives on 'op'", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(0));
    attachWorldSync(socket as unknown as Socket);

    const prevSeq = worldMirror.seq;
    socket.receive(
      "op",
      makeEnvelope("world:activeScene", { sceneId: "abcdefghij012345" }, prevSeq + 1),
    );

    expect(worldMirror.seq).toBe(prevSeq + 1);
  });

  it("cleanup removes the 'op' handler (no more activeScene calls)", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(5));
    const cleanup = attachWorldSync(socket as unknown as Socket);

    // Detach
    cleanup();

    socket.receive("op", makeEnvelope("world:activeScene", { sceneId: "abcdefghij012345" }, 6));

    expect(mockSetActiveSceneId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("worldSync — gap detection triggers resync:request (fix 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits resync:request on 'op' when DocumentMirror fires a gap event", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    // Apply snapshot so mirror is out of boot
    worldMirror.applySnapshot(makeSnapshot(10));

    attachWorldSync(socket as unknown as Socket);

    // Feed an op that creates a gap (seq jumps from 10 to 12, skipping 11)
    // The mirror will fire a gap event
    const gapOp = makeEnvelope("doc:create", { documentType: "Scene", documents: [] }, 12);
    socket.receive("op", gapOp);

    // The gap handler should have emitted a resync:request
    const last = socket.lastEmit();
    expect(last).not.toBeNull();
    expect(last![0]).toBe("op");
    const envelope = last![1] as Record<string, unknown>;
    expect(envelope["type"]).toBe("resync:request");
  });

  it("resync:request includes current lastSeq when gap is detected", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(7));
    attachWorldSync(socket as unknown as Socket);

    // Gap: seq jumps from 7 to 9
    socket.receive("op", makeEnvelope("doc:create", { documentType: "Actor", documents: [] }, 9));

    const last = socket.lastEmit();
    expect(last).not.toBeNull();
    const payload = (last![1] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    // lastSeq should be 7 (mirror's seq before the gap)
    expect(payload["lastSeq"]).toBe(7);
  });

  it("gap listener is cleaned up when detach is called", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(3));
    const cleanup = attachWorldSync(socket as unknown as Socket);
    cleanup();

    // Reset emit calls after cleanup
    socket.emit.mockClear();

    // Gap op arrives after cleanup — should NOT trigger resync
    socket.receive("op", makeEnvelope("token:move", {}, 9));

    // The emit was not called by the gap listener (it was removed)
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("worldSync — resync:full and resync:delta inline processing (fix 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resync:full envelope arriving on 'op' applies the snapshot to the mirror", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    // Reset mirror to a known low seq (the module-level singleton may have been
    // modified by prior tests). We use a fresh snapshot at seq 0 here so we can
    // verify that seq advances to 42 after the resync:full.
    worldMirror.applySnapshot(makeSnapshot(0));

    attachWorldSync(socket as unknown as Socket);

    const snapshot = makeSnapshot(42);
    const fullEnvelope = makeEnvelope("resync:full", { snapshot, reason: undefined });

    socket.receive("op", fullEnvelope);

    expect(worldMirror.booting).toBe(false);
    expect(worldMirror.seq).toBe(42);
  });

  it("resync:full also calls syncActiveSceneFromMirror and setActiveSceneId", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    attachWorldSync(socket as unknown as Socket);

    const sceneId = "aabbccddee112233";
    const snapshot: WorldSnapshotPayload = {
      seq: 5,
      activeSceneId: sceneId,
      documents: {
        Scene: [{ _id: sceneId, name: "Main" } as unknown as Record<string, unknown>],
      },
    };
    socket.receive("op", makeEnvelope("resync:full", { snapshot }));

    expect(mockSyncActiveSceneFromMirror).toHaveBeenCalledWith(worldMirror);
    expect(mockSetActiveSceneId).toHaveBeenCalledWith(sceneId, worldMirror);
  });

  it("resync:delta envelope arriving on 'op' feeds each op into the mirror", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(2));
    attachWorldSync(socket as unknown as Socket);

    const op3 = makeEnvelope(
      "doc:create",
      { documentType: "Scene", documents: [{ _id: "ssssssssssssssss", name: "S" }] },
      3,
    );
    const op4 = makeEnvelope(
      "doc:create",
      { documentType: "Actor", documents: [{ _id: "aaaaaaaaaaaaaaaa", name: "A" }] },
      4,
    );

    socket.receive("op", makeEnvelope("resync:delta", { fromSeq: 3, toSeq: 4, ops: [op3, op4] }));

    expect(worldMirror.seq).toBe(4);
    expect(worldMirror.getByType("Scene")).toHaveLength(1);
    expect(worldMirror.getByType("Actor")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// FIX-3: world:activeScene inside resync:delta updates the active scene
// ---------------------------------------------------------------------------

describe("FIX-3 — world:activeScene inside resync:delta updates activeSceneId (fix 3 ext)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("world:activeScene op inside resync:delta payload calls setActiveSceneId", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    // Establish a baseline snapshot so the mirror is not in boot mode
    worldMirror.applySnapshot(makeSnapshot(5));
    attachWorldSync(socket as unknown as Socket);

    const sceneId = "scene111111111111";
    const activeSceneOp = makeEnvelope("world:activeScene", { sceneId }, 6);

    // Send a resync:delta that contains a world:activeScene op
    socket.receive(
      "op",
      makeEnvelope("resync:delta", { fromSeq: 6, toSeq: 6, ops: [activeSceneOp] }),
    );

    // setActiveSceneId must have been called with the sceneId from the delta op
    expect(mockSetActiveSceneId).toHaveBeenCalledOnce();
    expect(mockSetActiveSceneId).toHaveBeenCalledWith(sceneId, worldMirror);
  });

  it("mirror seq advances for world:activeScene ops inside a delta", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(10));
    attachWorldSync(socket as unknown as Socket);

    const activeSceneOp = makeEnvelope("world:activeScene", { sceneId: "s2" }, 11);
    socket.receive(
      "op",
      makeEnvelope("resync:delta", { fromSeq: 11, toSeq: 11, ops: [activeSceneOp] }),
    );

    // The mirror must have advanced its seq to 11
    expect(worldMirror.seq).toBe(11);
  });

  it("world:activeScene arriving live on 'op' still calls setActiveSceneId (regression guard)", async () => {
    const { attachWorldSync, worldMirror } = await importWorldSync();
    const socket = makeMockSocket(false);

    worldMirror.applySnapshot(makeSnapshot(0));
    attachWorldSync(socket as unknown as Socket);

    const sceneId = "livescene1111111";
    socket.receive("op", makeEnvelope("world:activeScene", { sceneId }, 1));

    expect(mockSetActiveSceneId).toHaveBeenCalledOnce();
    expect(mockSetActiveSceneId).toHaveBeenCalledWith(sceneId, worldMirror);
  });
});
