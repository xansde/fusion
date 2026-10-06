/**
 * worldSyncResyncAck.test.ts — L3 defects D4/D5 (BHR-F5-07): a player's mirror heals after a seq hole.
 *
 * The server sends a player only the ops the player may see (a GM-only chat line, a hidden roll...), so the seq a
 * player holds can jump. The mirror then discards the op and asks for a resync; the server answers the ack with
 * `{ type: "delta" | "full", payload }`. If the client ignores that shape, nothing heals: the sheet and the combat
 * tracker stay frozen until the player reloads. The answer must be applied, and a delta (which never carries the ops
 * the player may not see) must be able to cross the hole it was asked about.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import type { Envelope } from "@fusion/shared";

vi.mock("../activeScene.svelte.js", () => ({
  activeSceneState: { id: null, scene: null },
  setActiveSceneId: vi.fn(),
  syncActiveSceneFromMirror: vi.fn(),
}));

type Handler = (...args: unknown[]) => void;

function mockSocket() {
  const handlers = new Map<string, Handler[]>();
  const emits: Array<[string, unknown, ((ack: unknown) => void) | undefined]> = [];
  return {
    connected: false,
    on: (event: string, h: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), h]),
    off: () => undefined,
    emit: (event: string, payload: unknown, cb?: (ack: unknown) => void) =>
      emits.push([event, payload, cb]),
    receive: (event: string, ...args: unknown[]) =>
      (handlers.get(event) ?? []).forEach((h) => h(...args)),
    emits,
  };
}

const combat = (started: boolean) => ({
  _id: "cbt1",
  sceneId: "s1",
  started,
  ended: false,
  round: started ? 1 : 0,
  turnIndex: 0,
  combatants: [],
});
const op = (type: string, payload: unknown, seq: number): Envelope =>
  ({ type, payload, seq, ts: 1 }) as unknown as Envelope;
const started = (seq: number) =>
  op("combat:updated", { combatId: "cbt1", diff: { started: true, round: 1 }, seq }, seq);

async function setup() {
  vi.resetModules();
  const { attachWorldSync, worldMirror } = await import("../worldSync.js");
  worldMirror.applySnapshot({
    seq: 10,
    activeSceneId: null,
    documents: { Combat: [combat(false)], Actor: [], Scene: [] },
  } as never);
  const socket = mockSocket();
  attachWorldSync(socket as unknown as Socket);
  return { worldMirror, socket };
}

/** The ack of the resync request the gap fired, answered the way the server answers. */
function answer(socket: ReturnType<typeof mockSocket>, result: unknown): void {
  const last = [...socket.emits]
    .reverse()
    .find(([, env]) => (env as { type?: string }).type === "resync:request");
  expect(last).toBeDefined();
  last?.[2]?.({ ok: true, seq: 99, result });
}

describe("resync answer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a delta answer catches the mirror up, hole included (the combat starts on the player's tracker)", async () => {
    const { worldMirror, socket } = await setup();
    socket.receive("op", started(12)); // seq 11 never reached this player
    answer(socket, { type: "delta", payload: { fromSeq: 11, toSeq: 12, ops: [started(12)] } });
    expect(worldMirror.getByType<{ started: boolean }>("Combat")[0]?.started).toBe(true);
    expect(worldMirror.seq).toBe(12);
  });

  it("after healing, the next live op applies without another gap", async () => {
    const { worldMirror, socket } = await setup();
    socket.receive("op", started(12));
    answer(socket, { type: "delta", payload: { fromSeq: 11, toSeq: 12, ops: [started(12)] } });
    socket.receive(
      "op",
      op("combat:updated", { combatId: "cbt1", diff: { round: 2 }, seq: 13 }, 13),
    );
    expect(worldMirror.getByType<{ round: number }>("Combat")[0]?.round).toBe(2);
  });

  it("a full answer replaces the world and its seq", async () => {
    const { worldMirror, socket } = await setup();
    socket.receive("op", started(12));
    answer(socket, {
      type: "full",
      payload: {
        snapshot: {
          seq: 20,
          activeSceneId: null,
          documents: { Combat: [combat(true)], Actor: [], Scene: [] },
        },
      },
    });
    expect(worldMirror.getByType<{ started: boolean }>("Combat")[0]?.started).toBe(true);
    expect(worldMirror.seq).toBe(20);
  });

  it("an empty delta (the hole was an op this player may not see) still moves the seq past it", async () => {
    const { worldMirror, socket } = await setup();
    socket.receive("op", op("doc:update", { documentType: "Combat", documents: [] }, 12));
    answer(socket, { type: "delta", payload: { fromSeq: 11, toSeq: 12, ops: [] } });
    expect(worldMirror.seq).toBe(12);
  });
});
