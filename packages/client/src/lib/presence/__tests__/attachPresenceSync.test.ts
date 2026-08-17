/**
 * attachPresenceSync.test.ts — REQ-NET-043 wiring.
 *
 * `updateOnlineUsers` (presenceStore.svelte.ts) always existed and was
 * correct, but had zero callers in production: no socket listener ever fed
 * it a `presence:online` envelope, so `presenceState.onlineUsers` stayed `[]`
 * forever. That broke resolveSpeakerColor (A022) and resolveInvalidatorLabel
 * (A024) in ChatMessage.svelte, which both read that array. This test proves
 * the missing link: a `presence:online` ephemeral event received on the
 * socket actually reaches `presenceState.onlineUsers`.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { Envelope } from "@fusion/shared";
import type { Socket } from "socket.io-client";
import { attachPresenceSync } from "../attachPresenceSync.js";
import { presenceState, updateOnlineUsers } from "../presenceStore.svelte.js";

/** Minimal event-emitter surface attachPresenceSync needs from a socket.io Socket. */
class FakeSocket {
  private handlers: Array<(envelope: Envelope) => void> = [];
  on(_event: "ephemeral", handler: (envelope: Envelope) => void): void {
    this.handlers.push(handler);
  }
  off(_event: "ephemeral", handler: (envelope: Envelope) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
  emit(envelope: Envelope): void {
    for (const h of this.handlers) h(envelope);
  }
}

function presenceOnlineEnvelope(
  users: Array<{ userId: string; userName: string; color: string; online: boolean }>,
): Envelope {
  return {
    type: "presence:online",
    ts: Date.now(),
    payload: { users },
  } as unknown as Envelope;
}

describe("attachPresenceSync — presence:online (REQ-NET-043)", () => {
  afterEach(() => {
    // Singleton store — reset between tests so order never matters.
    updateOnlineUsers([]);
  });

  it("populates presenceState.onlineUsers from a presence:online ephemeral event", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.emit(
      presenceOnlineEnvelope([
        { userId: "gm-1", userName: "Mestra Iris", color: "#e03030", online: true },
        { userId: "p-1", userName: "Tobias", color: "#1f8dd6", online: false },
      ]),
    );

    expect(presenceState.onlineUsers).toEqual([
      { userId: "gm-1", userName: "Mestra Iris", color: "#e03030", online: true },
      { userId: "p-1", userName: "Tobias", color: "#1f8dd6", online: false },
    ]);

    detach();
  });

  it("replaces the roster wholesale on each new presence:online event", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.emit(
      presenceOnlineEnvelope([
        { userId: "gm-1", userName: "Mestra Iris", color: "#e03030", online: true },
      ]),
    );
    expect(presenceState.onlineUsers).toHaveLength(1);

    socket.emit(presenceOnlineEnvelope([]));
    expect(presenceState.onlineUsers).toEqual([]);

    detach();
  });

  it("drops malformed rows (missing userId) instead of throwing", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.emit({
      type: "presence:online",
      ts: Date.now(),
      payload: {
        users: [{ userName: "no-id" }, { userId: "ok-1", userName: "Ok", color: "#fff" }],
      },
    } as unknown as Envelope);

    expect(presenceState.onlineUsers).toEqual([
      { userId: "ok-1", userName: "Ok", color: "#fff", online: false },
    ]);

    detach();
  });

  it("stops updating the store once detached", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);
    detach();

    socket.emit(
      presenceOnlineEnvelope([
        { userId: "gm-1", userName: "Mestra Iris", color: "#e03030", online: true },
      ]),
    );

    expect(presenceState.onlineUsers).toEqual([]);
  });
});
