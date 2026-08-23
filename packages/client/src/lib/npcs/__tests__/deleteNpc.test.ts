/**
 * deleteNpc.test.ts — the client side of deleting a non-playable (spec 42 §5.7,
 * G075).
 *
 * Covers REQ-NPC-050 (only this tab's own non-playables are deleted, through the
 * ordinary `doc:delete`), REQ-NPC-051 (the reading that says what falls: presences
 * per scene, the knowledge, the sheet's items), REQ-NPC-052 (an unfinished
 * encounter blocks, and the refusal reaches the caller), REQ-NPC-053/REQ-NPC-054
 * (the two consequences the reading announces) and REQ-NPC-055 (a player's
 * character is never deleted by this tab, in any role).
 *
 * What the fake socket records is the WIRE: "the tab does not delete a character"
 * is proven by there being no op on the wire, not by reading the source.
 */

import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import { KnowledgeState, type ActorDeletePreviewResult } from "@fusion/shared";

import {
  buildDeleteNpcOp,
  deleteNpc,
  isDeletableNpcSubtype,
  isDeleteBlocked,
  knowledgeFalls,
  loadActorDeletePreview,
} from "../deleteNpc.js";

// ---------------------------------------------------------------------------
// Fake socket — records what went on the wire and acks it
// ---------------------------------------------------------------------------

interface Sent {
  readonly event: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface Replies {
  readonly preview?: ActorDeletePreviewResult;
  /** When set, `doc:delete` is refused with this ack (REQ-NPC-052). */
  readonly deleteRefusal?: { code: string; message: string };
}

function fakeSocket(sent: Sent[], replies: Replies = {}): Socket {
  return {
    connected: true,
    emit(
      event: string,
      envelope: { type: string; payload: Record<string, unknown> },
      ack: (result: unknown) => void,
    ): void {
      sent.push({ event, type: envelope.type, payload: envelope.payload });
      if (envelope.type === "actor:deletePreview") {
        ack({ ok: true, result: replies.preview ?? preview() });
        return;
      }
      if (envelope.type === "doc:delete" && replies.deleteRefusal !== undefined) {
        ack({ ok: false, ...replies.deleteRefusal });
        return;
      }
      ack({ ok: true, result: {} });
    },
  } as unknown as Socket;
}

function preview(overrides: Partial<ActorDeletePreviewResult> = {}): ActorDeletePreviewResult {
  return {
    actorId: "act-bram00000001",
    name: "Bram",
    type: "npc",
    presences: [
      { sceneId: "scn-clareira0001", sceneName: "Clareira", presenceCount: 2 },
      { sceneId: "scn-caverna00001", sceneName: "Caverna", presenceCount: 1 },
    ],
    presenceCount: 3,
    knowledge: {
      general: KnowledgeState.Hidden,
      exceptionCount: 2,
      knownBy: 1,
      glimpsedBy: 1,
    },
    itemCount: 4,
    blockingCombats: [],
    deletable: true,
    ...overrides,
  };
}

describe("REQ-NPC-050 / REQ-NPC-055: what this tab may delete", () => {
  it("REQ-NPC-050: a non-playable is deleted through the ordinary doc:delete", async () => {
    const sent: Sent[] = [];
    const done = await deleteNpc(fakeSocket(sent), "act-bram00000001", "npc");

    expect(done).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.event).toBe("op");
    expect(sent[0]?.type).toBe("doc:delete");
    expect(sent[0]?.payload).toEqual({ documentType: "Actor", ids: ["act-bram00000001"] });
  });

  it("REQ-NPC-050: a hazard is deleted the same way — it is a row of this tab", () => {
    expect(buildDeleteNpcOp("act-fosso0000001", "hazard")).toEqual({
      type: "doc:delete",
      payload: { documentType: "Actor", ids: ["act-fosso0000001"] },
    });
  });

  it("REQ-NPC-055: a player's character is not deleted here, and NOTHING goes on the wire", async () => {
    for (const subtype of ["character", "familiar", "loot"]) {
      const sent: Sent[] = [];
      const done = await deleteNpc(fakeSocket(sent), "act-fofurinha001", subtype);

      expect(done).toBe(false);
      expect(sent).toEqual([]);
      expect(buildDeleteNpcOp("act-fofurinha001", subtype)).toBeNull();
      expect(isDeletableNpcSubtype(subtype)).toBe(false);
    }
  });

  it("REQ-NPC-055: an unknown or missing subtype is refused rather than assumed deletable", () => {
    expect(buildDeleteNpcOp("act-bram00000001", undefined)).toBeNull();
    expect(buildDeleteNpcOp("act-bram00000001", null)).toBeNull();
    expect(buildDeleteNpcOp("", "npc")).toBeNull();
  });
});

describe("REQ-NPC-051: the reading that says what falls", () => {
  it("REQ-NPC-051: the tab asks the SERVER, naming the actor", async () => {
    const sent: Sent[] = [];
    const result = await loadActorDeletePreview(fakeSocket(sent), "act-bram00000001");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("actor:deletePreview");
    expect(sent[0]?.payload).toEqual({ actorId: "act-bram00000001" });
    expect(result.name).toBe("Bram");
  });

  it("REQ-NPC-053: the reading says how many presences and in which scenes", async () => {
    const sent: Sent[] = [];
    const result = await loadActorDeletePreview(fakeSocket(sent), "act-bram00000001");

    expect(result.presenceCount).toBe(3);
    expect(result.presences.map((p) => `${p.sceneName}:${p.presenceCount.toString()}`)).toEqual([
      "Clareira:2",
      "Caverna:1",
    ]);
    // REQ-NPC-036: how many and where — never anything of the single presence.
    expect(JSON.stringify(result.presences)).not.toContain("tokenId");
  });

  it("REQ-NPC-051: the reading says how many items the sheet carries", async () => {
    const sent: Sent[] = [];
    const result = await loadActorDeletePreview(fakeSocket(sent), "act-bram00000001");

    expect(result.itemCount).toBe(4);
  });

  it("REQ-NPC-054: knowledge falls when anything about the actor was recorded", () => {
    expect(
      knowledgeFalls({
        general: KnowledgeState.Hidden,
        exceptionCount: 2,
        knownBy: 1,
        glimpsedBy: 1,
      }),
    ).toBe(true);
    // A general rule alone is enough: every character knows it, with no exception.
    expect(
      knowledgeFalls({
        general: KnowledgeState.Known,
        exceptionCount: 0,
        knownBy: 0,
        glimpsedBy: 0,
      }),
    ).toBe(true);
  });

  it("REQ-NPC-054: nothing recorded means nothing announced", () => {
    expect(
      knowledgeFalls({
        general: KnowledgeState.Hidden,
        exceptionCount: 0,
        knownBy: 0,
        glimpsedBy: 0,
      }),
    ).toBe(false);
  });
});

describe("REQ-NPC-052: an unfinished encounter blocks the delete", () => {
  const blocking = preview({
    blockingCombats: [
      {
        combatId: "cbt-emboscada01",
        sceneId: "scn-clareira0001",
        sceneName: "Clareira",
        combatantCount: 1,
      },
    ],
    deletable: false,
  });

  it("REQ-NPC-052: the reading blocks, and names the encounter and its scene", () => {
    expect(isDeleteBlocked(blocking)).toBe(true);
    expect(blocking.blockingCombats[0]?.sceneName).toBe("Clareira");
  });

  it("REQ-NPC-052: an encounter listed blocks even if the server forgot the flag", () => {
    expect(isDeleteBlocked({ ...blocking, deletable: true })).toBe(true);
  });

  it("REQ-NPC-052: nothing blocks a clean actor, and no reading blocks nothing", () => {
    expect(isDeleteBlocked(preview())).toBe(false);
    expect(isDeleteBlocked(null)).toBe(false);
  });

  it("REQ-NPC-052: a refusal at confirm time reaches the caller instead of being swallowed", async () => {
    const sent: Sent[] = [];
    const socket = fakeSocket(sent, {
      deleteRefusal: {
        code: "VALIDATION_FAILED",
        message:
          'Actor/act-bram00000001 is in an active combat and cannot be deleted: cbt-emboscada01 (scene "Clareira"). ' +
          "End the encounter (combat:endCombat) or take the actor out of it (combat:removeCombatant), then delete again.",
      },
    });

    await expect(deleteNpc(socket, "act-bram00000001", "npc")).rejects.toThrow(/active combat/);
    expect(sent.map((s) => s.type)).toEqual(["doc:delete"]);
  });
});
