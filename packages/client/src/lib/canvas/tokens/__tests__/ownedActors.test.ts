/**
 * ownedActors — which actors the local user may move tokens for.
 *
 * Spec: 05-usuarios-e-permissoes.md §REQ-USR-005, REQ-USR-006.
 *
 * This is the set canMoveToken() consults. Getting it wrong in either
 * direction is a permission bug: too wide lets a player drag someone else's
 * token, too narrow locks a player out of their own character.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import { resolveOwnedActorIds } from "../ownedActors.js";

interface FakeActor {
  _id: string;
  ownership: Record<string, number>;
}

function mirrorWith(actors: FakeActor[]): { getByType: <T>(type: string) => T[] } {
  return {
    getByType: <T>(type: string): T[] => (type === "Actor" ? (actors as unknown as T[]) : []),
  };
}

const PLAYER = 1;
const ASSISTANT = 3;
const GAMEMASTER = 4;

describe("resolveOwnedActorIds", () => {
  it("includes an actor the user owns explicitly", () => {
    const mirror = mirrorWith([
      { _id: "a1", ownership: { default: OwnershipLevel.NONE, u1: OwnershipLevel.OWNER } },
    ]);
    expect(resolveOwnedActorIds(mirror, "u1", PLAYER)).toEqual(new Set(["a1"]));
  });

  it("excludes an actor where the user is only an observer", () => {
    const mirror = mirrorWith([
      { _id: "a1", ownership: { default: OwnershipLevel.NONE, u1: OwnershipLevel.OBSERVER } },
    ]);
    expect(resolveOwnedActorIds(mirror, "u1", PLAYER)).toEqual(new Set());
  });

  it("excludes another player's actor", () => {
    const mirror = mirrorWith([
      { _id: "a1", ownership: { default: OwnershipLevel.NONE, u2: OwnershipLevel.OWNER } },
    ]);
    expect(resolveOwnedActorIds(mirror, "u1", PLAYER)).toEqual(new Set());
  });

  it("includes an actor owned by everyone via the default entry", () => {
    const mirror = mirrorWith([{ _id: "a1", ownership: { default: OwnershipLevel.OWNER } }]);
    expect(resolveOwnedActorIds(mirror, "u1", PLAYER)).toEqual(new Set(["a1"]));
  });

  it("gives the GM every actor — REQ-USR-006, implicit OWNER on all documents", () => {
    const mirror = mirrorWith([
      { _id: "a1", ownership: { default: OwnershipLevel.NONE } },
      { _id: "a2", ownership: { default: OwnershipLevel.NONE, u2: OwnershipLevel.OWNER } },
    ]);
    expect(resolveOwnedActorIds(mirror, "gm", GAMEMASTER)).toEqual(new Set(["a1", "a2"]));
  });

  it("gives an assistant every actor too (role >= ASSISTANT)", () => {
    const mirror = mirrorWith([{ _id: "a1", ownership: { default: OwnershipLevel.NONE } }]);
    expect(resolveOwnedActorIds(mirror, "asst", ASSISTANT)).toEqual(new Set(["a1"]));
  });

  it("returns an empty set for an anonymous user, whatever the ownership says", () => {
    const mirror = mirrorWith([{ _id: "a1", ownership: { default: OwnershipLevel.OWNER } }]);
    expect(resolveOwnedActorIds(mirror, null, PLAYER)).toEqual(new Set());
  });

  it("returns an empty set when the world has no actors", () => {
    expect(resolveOwnedActorIds(mirrorWith([]), "u1", PLAYER)).toEqual(new Set());
  });

  it("survives an actor persisted without an ownership map", () => {
    const mirror = mirrorWith([{ _id: "a1" } as unknown as FakeActor]);
    expect(() => resolveOwnedActorIds(mirror, "u1", PLAYER)).not.toThrow();
    expect(resolveOwnedActorIds(mirror, "u1", PLAYER)).toEqual(new Set());
  });
});
