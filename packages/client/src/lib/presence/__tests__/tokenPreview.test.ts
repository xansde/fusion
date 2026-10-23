/**
 * tokenPreview.test.ts — TK033 (#168), REQ-NET-044: `token:preview` round trip.
 *
 * `emitTokenPreview` is the client → server half (throttled, like
 * `emitCursor`); the `token:preview` case inside `attachPresenceSync`'s
 * `onEphemeral` switch is the server → client half, landing in
 * `presenceState.remoteTokenPreviews`. Together they are what makes
 * REQ-NET-044 more than a string in the protocol literal (#168).
 */

import { describe, it, expect, afterEach } from "vitest";
import type { Envelope } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import { attachPresenceSync, emitTokenPreview } from "../attachPresenceSync.js";
import { presenceState, clearRemoteTokenPreview } from "../presenceStore.svelte.js";

/** Minimal event-emitter surface attachPresenceSync needs from a socket.io Socket. */
class FakeSocket {
  private handlers: Array<(envelope: Envelope) => void> = [];
  connected = true;
  sent: Array<{ event: string; payload: unknown }> = [];

  on(_event: "ephemeral", handler: (envelope: Envelope) => void): void {
    this.handlers.push(handler);
  }
  off(_event: "ephemeral", handler: (envelope: Envelope) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
  /** Simulate the server pushing an ephemeral envelope down to this client. */
  receive(envelope: Envelope): void {
    for (const h of this.handlers) h(envelope);
  }
  /** The real socket.io Socket#emit — records what THIS client sent out. */
  emit(event: string, payload: unknown): void {
    this.sent.push({ event, payload });
  }
}

describe("emitTokenPreview — client → server (REQ-NET-044)", () => {
  it("sends a token:preview envelope with sceneId/tokenId/x/y", () => {
    const socket = new FakeSocket();
    emitTokenPreview(socket as unknown as Socket, "scn-1", "tok-1", 300, 400, 0);

    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]?.event).toBe("ephemeral");
    expect(socket.sent[0]?.payload).toMatchObject({
      type: "token:preview",
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 300, y: 400 },
    });
  });

  it("throttles: a second call inside the interval is dropped", () => {
    const socket = new FakeSocket();
    emitTokenPreview(socket as unknown as Socket, "scn-1", "tok-1", 0, 0, 1000);
    emitTokenPreview(socket as unknown as Socket, "scn-1", "tok-1", 1, 1, 1010); // 10ms later — throttled

    expect(socket.sent).toHaveLength(1);
  });

  it("allows a call after the throttle interval elapses", () => {
    const socket = new FakeSocket();
    emitTokenPreview(socket as unknown as Socket, "scn-1", "tok-1", 0, 0, 2000);
    emitTokenPreview(socket as unknown as Socket, "scn-1", "tok-1", 5, 5, 2100); // 100ms later — allowed

    expect(socket.sent).toHaveLength(2);
  });

  it("does nothing when the socket is not connected", () => {
    const socket = new FakeSocket();
    socket.connected = false;
    emitTokenPreview(socket as unknown as Socket, "scn-1", "tok-1", 0, 0, 3000);

    expect(socket.sent).toHaveLength(0);
  });
});

describe("attachPresenceSync — token:preview reception (REQ-NET-044)", () => {
  afterEach(() => {
    for (const [tokenId] of presenceState.remoteTokenPreviews) {
      clearRemoteTokenPreview(tokenId);
    }
  });

  it("applies a received token:preview into presenceState.remoteTokenPreviews, keyed by tokenId", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.receive({
      type: "token:preview",
      ts: Date.now(),
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 250, y: 500, userId: "user-2" },
    } as unknown as Envelope);

    const preview = presenceState.remoteTokenPreviews.get("tok-1");
    expect(preview).toMatchObject({
      tokenId: "tok-1",
      sceneId: "scn-1",
      userId: "user-2",
      x: 250,
      y: 500,
    });

    detach();
  });

  it("a later preview for the same token overwrites the earlier one", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.receive({
      type: "token:preview",
      ts: Date.now(),
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 0, y: 0, userId: "user-2" },
    } as unknown as Envelope);
    socket.receive({
      type: "token:preview",
      ts: Date.now(),
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 99, y: 99, userId: "user-2" },
    } as unknown as Envelope);

    expect(presenceState.remoteTokenPreviews.size).toBe(1);
    expect(presenceState.remoteTokenPreviews.get("tok-1")).toMatchObject({ x: 99, y: 99 });

    detach();
  });

  it("ignores a malformed payload (missing tokenId) instead of throwing", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    expect(() =>
      socket.receive({
        type: "token:preview",
        ts: Date.now(),
        payload: { sceneId: "scn-1", x: 0, y: 0, userId: "user-2" },
      } as unknown as Envelope),
    ).not.toThrow();
    expect(presenceState.remoteTokenPreviews.size).toBe(0);

    detach();
  });
});
