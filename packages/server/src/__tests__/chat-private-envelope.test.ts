/**
 * A private chat message must never leave a seq hole for the sockets that may not see it.
 *
 * The mirror gates ops on a contiguous seq and fires its gap detector on a jump, so `broadcastChatMessage` burning a seq
 * and skipping the socket (what it used to do) cost every player a resync round for each GM-only line, whisper or blind
 * roll. The funnel (`redaction.ts`) documents the rule: emit the envelope with empty `documents`, never swallow it.
 */

import { describe, it, expect } from "vitest";
import type { Namespace } from "socket.io";
import { Role } from "../auth/user-store.js";
import { broadcastChatMessage, buildBaseMessage } from "../chat/chat-handler.js";
import type { SeqStore } from "../net/seq-store.js";

interface Emitted {
  event: string;
  envelope: { seq?: number; payload: { documentType: string; documents: unknown[] } };
}

function fakeSocket(userId: string, role: number) {
  const emitted: Emitted[] = [];
  return {
    data: { userId, role },
    emitted,
    emit(event: string, envelope: Emitted["envelope"]) {
      emitted.push({ event, envelope });
    },
  };
}

function fakeNamespace(sockets: ReturnType<typeof fakeSocket>[]): Namespace {
  const map = new Map(sockets.map((s, i) => [`s${String(i)}`, s]));
  return { sockets: map } as unknown as Namespace;
}

describe("broadcastChatMessage — private message envelope", () => {
  it("sends the non-eligible player an EMPTY envelope with the same seq (no hole, no content)", () => {
    const gm = fakeSocket("gm0000000000001", Role.GM);
    const player = fakeSocket("player000000001", Role.PLAYER);
    const ns = fakeNamespace([gm, player]);
    const seqStore = { next: () => 41 } as unknown as SeqStore;

    const msg = buildBaseMessage(
      "w1",
      { userId: "gm0000000000001", alias: "Mestre" } as never,
      "whisper",
      "segredo do Mestre",
    );
    msg.whisper = ["gm0000000000001"];

    const seq = broadcastChatMessage(ns, seqStore, msg, "gm0000000000001");

    expect(seq).toBe(41);
    // The GM gets the message.
    expect(gm.emitted).toHaveLength(1);
    expect(gm.emitted[0]?.envelope.payload.documents).toHaveLength(1);
    // The player gets the envelope (so the seq stays contiguous) but nothing inside it.
    expect(player.emitted).toHaveLength(1);
    expect(player.emitted[0]?.envelope.seq).toBe(41);
    expect(player.emitted[0]?.envelope.payload.documentType).toBe("ChatMessage");
    expect(player.emitted[0]?.envelope.payload.documents).toEqual([]);
    expect(JSON.stringify(player.emitted)).not.toContain("segredo do Mestre");
  });
});
