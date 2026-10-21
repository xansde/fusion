/**
 * character-actor-redaction.test.ts — #240 (REQ-NET-096): a player `character`
 * Actor answers to `ownership` at the SAME LIMITED threshold on every emission
 * path, exactly like the join snapshot. Before the fix the live/replay/ack
 * funnel treated any `type: "character"` as always visible.
 */
import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import { redactActorDocsForViewer, type ContactViewer } from "../redaction.js";

function pc(id: string, ownership: Record<string, number>): Record<string, unknown> {
  return {
    _id: id,
    name: `PC ${id}`,
    type: "character",
    ownership,
    system: { derived: { ac: 18 }, attributes: { hp: { value: 5, max: 9 } } },
    flags: {},
  };
}

const viewer: ContactViewer = { userId: "me", role: 1, ownedCharacterIds: ["mine"] };

describe("redactActorDocsForViewer — player characters follow ownership (#240)", () => {
  it("drops another player's character when the viewer has no ownership (default NONE)", () => {
    const { documents, removedIds } = redactActorDocsForViewer(
      [pc("other", { default: OwnershipLevel.NONE, otherUser: OwnershipLevel.OWNER })],
      viewer,
    );
    expect(documents).toEqual([]);
    expect(removedIds).toEqual(["other"]);
  });

  it("keeps the viewer's own character", () => {
    const { documents } = redactActorDocsForViewer(
      [pc("mine", { default: OwnershipLevel.NONE, me: OwnershipLevel.OWNER })],
      viewer,
    );
    expect(documents.map((d) => d["_id"])).toEqual(["mine"]);
  });

  it("keeps a character shared at LIMITED or above, still without hit points", () => {
    const { documents } = redactActorDocsForViewer(
      [pc("shared", { default: OwnershipLevel.LIMITED, otherUser: OwnershipLevel.OWNER })],
      viewer,
    );
    expect(documents).toHaveLength(1);
    const attributes = (documents[0]?.["system"] as Record<string, unknown>)["attributes"] as
      | Record<string, unknown>
      | undefined;
    expect(attributes && "hp" in attributes).toBe(false);
  });

  it("hands every character to a privileged viewer", () => {
    const gm: ContactViewer = { userId: "gm", role: 4, ownedCharacterIds: [] };
    const { documents } = redactActorDocsForViewer([pc("other", { default: 0 })], gm);
    expect(documents).toHaveLength(1);
  });
});
