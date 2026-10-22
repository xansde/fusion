/**
 * targetingReplay.test.ts — the aim survives a browser reload (L2 round 2, D5; REQ-CBT-056).
 *
 * The live selection is server state per user (REQ-CBT-056). When a browser reloads, the server tells the new socket
 * which targets are alive with plain `token:targeted` ops, in the same tick it accepts the connection. The table screen
 * mounts only after the canvas has initialised, so a listener attached THERE hears nothing: the reticle stays off and the
 * actions that need an aimed target stay disabled. The listener has to exist the moment the socket does (session scope).
 */
import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Socket } from "socket.io-client";
import {
  attachTargetingSync,
  getTargetingState,
  setTargetingViewer,
  targetingStore,
} from "../combatStore.svelte.js";
import { isTargetedByAnyone } from "../targeting.js";

/** A socket the way socket.io delivers: frames emitted before a listener exists are gone. */
const makeSocket = (): { socket: Socket; replay: (payload: unknown) => void } => {
  const bus = new EventEmitter();
  return {
    socket: bus as unknown as Socket,
    replay: (payload) => bus.emit("op", { type: "token:targeted", ts: 1, payload }),
  };
};

describe("token:targeted replayed by the server to a reconnecting seat", () => {
  it("a listener attached with the socket applies the replay (no seq) to the live targeting", () => {
    const { socket, replay } = makeSocket();
    const detach = attachTargetingSync(socket);
    const before = targetingStore.version;
    replay({ tokenId: "tok-ogre-replay", targeted: true, userId: "u-replay" });
    expect(isTargetedByAnyone(getTargetingState(), "tok-ogre-replay")).toBe(true);
    expect(getTargetingState().byUser.get("u-replay")?.has("tok-ogre-replay")).toBe(true);
    expect(targetingStore.version).toBeGreaterThan(before);
    detach();
  });

  it("only this user's replayed targets are 'mine' (the viewer filter is unchanged)", () => {
    const { socket, replay } = makeSocket();
    const detach = attachTargetingSync(socket);
    setTargetingViewer("u-me");
    replay({ tokenId: "tok-a", targeted: true, userId: "u-other" });
    expect(getTargetingState().byUser.get("u-me")?.has("tok-a") ?? false).toBe(false);
    detach();
  });

  it("a detached listener hears nothing", () => {
    const { socket, replay } = makeSocket();
    attachTargetingSync(socket)();
    replay({ tokenId: "tok-gone", targeted: true, userId: "u-late" });
    expect(isTargetedByAnyone(getTargetingState(), "tok-gone")).toBe(false);
  });
});

describe("where the listener is attached", () => {
  const read = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

  it("the session attaches it as soon as the socket exists, before any await", () => {
    const session = read("../../session.svelte.ts");
    const connect = session.slice(session.indexOf("function _connectSocket"));
    expect(connect).toContain("attachTargetingSync(socket)");
    expect(connect.slice(0, connect.indexOf("attachTargetingSync(socket)"))).not.toContain("await");
  });

  it("the table screen no longer owns it (it would attach after the canvas initialises)", () => {
    const table = read("../../../components/TableScreen.svelte");
    expect(table).not.toContain("attachTargetingSync");
  });
});
