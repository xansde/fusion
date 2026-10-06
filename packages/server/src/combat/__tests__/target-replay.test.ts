/**
 * Targeting replay on (re)connection (L2 defect D5).
 *
 * The live selection is the server's (REQ-CBT-056 `resolveTargetSelection`), per user, and survives the browser
 * reloading. A client that comes back starts empty, so without a replay the reticle is gone and the buttons that
 * need a target stay disabled while the server still counts the target. The server therefore tells the connecting
 * socket, and only it, the selections that are alive: its own and everyone else's (the reticles other users draw).
 */
import { describe, it, expect } from "vitest";
import type { Socket } from "socket.io";
import { TargetingStore } from "../targeting-store.js";
import { replayTargetingTo } from "../target-handler.js";

function fakeSocket(): { socket: Socket; sent: Array<{ event: string; envelope: any }> } {
  const sent: Array<{ event: string; envelope: any }> = [];
  const socket = {
    emit: (event: string, envelope: unknown) => sent.push({ event, envelope }),
  } as unknown as Socket;
  return { socket, sent };
}

describe("replayTargetingTo", () => {
  it("sends one token:targeted per live target of every user, to that socket only", () => {
    const store = new TargetingStore();
    store.setTarget("player-1", "tok-ogre", true);
    store.setTarget("player-1", "tok-goblin", true);
    store.setTarget("gm-1", "tok-ogre", true);
    const { socket, sent } = fakeSocket();

    replayTargetingTo(socket, store);

    const payloads = sent.map((s) => s.envelope.payload);
    expect(sent.every((s) => s.event === "op" && s.envelope.type === "token:targeted")).toBe(true);
    // Not a canonical op: no seq, so the world mirror ignores it instead of reading a gap.
    expect(sent.every((s) => s.envelope.seq === undefined)).toBe(true);
    expect(payloads).toHaveLength(3);
    expect(payloads).toContainEqual({ tokenId: "tok-ogre", targeted: true, userId: "player-1" });
    expect(payloads).toContainEqual({ tokenId: "tok-goblin", targeted: true, userId: "player-1" });
    expect(payloads).toContainEqual({ tokenId: "tok-ogre", targeted: true, userId: "gm-1" });
  });

  it("sends nothing when nobody is targeting", () => {
    const { socket, sent } = fakeSocket();
    replayTargetingTo(socket, new TargetingStore());
    expect(sent).toEqual([]);
  });
});
