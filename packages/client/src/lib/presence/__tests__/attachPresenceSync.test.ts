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

describe("attachPresenceSync — area templates", () => {
  const tpl = { kind: "cone", sizeFt: 15, origin: { x: 500, y: 500 }, direction: 45 };
  const env = (type: string, payload: Record<string, unknown>): Envelope =>
    ({ type, ts: Date.now(), payload }) as unknown as Envelope;

  afterEach(() => {
    presenceState.remoteTemplates.clear();
    presenceState.pinnedTemplates.clear();
  });

  it("keeps one live template per remote user and drops it on clear", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.emit(env("presence:template", { userId: "u1", userName: "Ana", template: tpl }));
    expect(presenceState.remoteTemplates.get("u1")?.template.kind).toBe("cone");
    expect(presenceState.remoteTemplates.get("u1")?.userName).toBe("Ana");

    socket.emit(env("presence:template:clear", { userId: "u1" }));
    expect(presenceState.remoteTemplates.has("u1")).toBe(false);
    detach();
  });

  it("ignores a template payload that is not a valid template", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);
    socket.emit(env("presence:template", { userId: "u1", template: { kind: "spiral" } }));
    expect(presenceState.remoteTemplates.size).toBe(0);
    detach();
  });

  it("tracks pinned templates by id, with their scene, and unpins them", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.emit(env("presence:template:pin", { id: "p1", sceneId: "s1", userId: "u1", template: tpl }));
    expect(presenceState.pinnedTemplates.get("p1")).toMatchObject({ sceneId: "s1", userId: "u1" });

    socket.emit(env("presence:template:unpin", { id: "p1", sceneId: "s1" }));
    expect(presenceState.pinnedTemplates.size).toBe(0);
    detach();
  });

  it("replaces the pinned set of a scene from a sync reply", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);

    socket.emit(env("presence:template:pin", { id: "old", sceneId: "s1", userId: "u1", template: tpl }));
    socket.emit(env("presence:template:pin", { id: "other", sceneId: "s2", userId: "u1", template: tpl }));
    socket.emit(
      env("presence:template:pinned", {
        sceneId: "s1",
        templates: [{ id: "new", userId: "u2", template: tpl }],
      }),
    );

    expect([...presenceState.pinnedTemplates.keys()].sort()).toEqual(["new", "other"]);
    detach();
  });
});

describe("attachPresenceSync — presence:ping pull", () => {
  it("records a pull view only when the ping carries pull", () => {
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);
    const before = presenceState.pullView?.seq ?? 0;
    socket.emit({
      type: "presence:ping",
      ts: 1,
      payload: { userId: "p", x: 1, y: 2 },
    } as unknown as Envelope);
    expect(presenceState.pullView?.seq ?? 0).toBe(before);
    socket.emit({
      type: "presence:ping",
      ts: 2,
      payload: { userId: "gm", x: 30, y: 40, pull: true },
    } as unknown as Envelope);
    expect(presenceState.pullView).toEqual({ x: 30, y: 40, seq: before + 1 });
    detach();
  });
});

describe("attachPresenceSync - presence:show", () => {
  it("opens the shown item with the image URL and dismiss hides it locally", async () => {
    const { dismissShown } = await import("../presenceStore.svelte.js");
    const socket = new FakeSocket();
    const detach = attachPresenceSync(socket as unknown as Socket);
    socket.emit({
      type: "presence:show",
      ts: 1,
      payload: {
        title: "Mapa",
        image: { name: "a.webp", token: "t", exp: 5, userId: "u" },
      },
    } as unknown as Envelope);
    expect(presenceState.shown?.title).toBe("Mapa");
    expect(presenceState.shown?.imageUrl).toBe("/assets/a.webp?at=t&ae=5&au=u");
    dismissShown();
    expect(presenceState.shown).toBeNull();
    detach();
  });
});
