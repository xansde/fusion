/**
 * targeting.test.ts — unit tests for the targeting-state reducer.
 *
 * Covers: applyTargeted, clearUserTargets, isTargetedByAnyone,
 * isTargetedByUser, targetedTokens, computeReticlePositions.
 *
 * REQ-CBT-053..055.
 */

import { describe, it, expect } from "vitest";
import {
  createTargetingState,
  applyTargeted,
  clearUserTargets,
  isTargetedByAnyone,
  isTargetedByUser,
  targetedTokens,
  computeReticlePositions,
  myTargets,
  diffMyTargets,
  type TokenFootprint,
  type TargetIdentity,
} from "../targeting.js";

describe("applyTargeted", () => {
  it("adds a target for a user", () => {
    const s = createTargetingState();
    const changed = applyTargeted(s, "tok1", true, "userA");
    expect(changed).toBe(true);
    expect(isTargetedByUser(s, "tok1", "userA")).toBe(true);
    expect(isTargetedByAnyone(s, "tok1")).toBe(true);
  });

  it("clearing a target removes it", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "userA");
    const changed = applyTargeted(s, "tok1", false, "userA");
    expect(changed).toBe(true);
    expect(isTargetedByAnyone(s, "tok1")).toBe(false);
  });

  it("reports no visible change when a second user targets an already-targeted token", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "userA");
    const changed = applyTargeted(s, "tok1", true, "userB");
    // The token was already targeted by anyone, so the any-user view is unchanged.
    expect(changed).toBe(false);
    expect(isTargetedByUser(s, "tok1", "userB")).toBe(true);
  });

  it("token stays visibly targeted until the LAST targeter clears it", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "userA");
    applyTargeted(s, "tok1", true, "userB");

    const changedA = applyTargeted(s, "tok1", false, "userA");
    expect(changedA).toBe(false); // userB still targets it
    expect(isTargetedByAnyone(s, "tok1")).toBe(true);

    const changedB = applyTargeted(s, "tok1", false, "userB");
    expect(changedB).toBe(true);
    expect(isTargetedByAnyone(s, "tok1")).toBe(false);
  });

  it("clearing a non-targeted token is a no-op", () => {
    const s = createTargetingState();
    const changed = applyTargeted(s, "tok1", false, "userA");
    expect(changed).toBe(false);
  });

  it("removes the user entry when their last target is cleared", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "userA");
    applyTargeted(s, "tok1", false, "userA");
    expect(s.byUser.has("userA")).toBe(false);
  });
});

describe("clearUserTargets (REQ-CBT-055)", () => {
  it("clears all of one user's targets and returns the newly-untargeted tokens", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "userA");
    applyTargeted(s, "tok2", true, "userA");

    const cleared = clearUserTargets(s, "userA");
    expect(cleared.sort()).toEqual(["tok1", "tok2"]);
    expect(isTargetedByAnyone(s, "tok1")).toBe(false);
    expect(isTargetedByAnyone(s, "tok2")).toBe(false);
  });

  it("preserves tokens still targeted by another user (open question 6)", () => {
    const s = createTargetingState();
    applyTargeted(s, "shared", true, "userA");
    applyTargeted(s, "shared", true, "userB");
    applyTargeted(s, "onlyA", true, "userA");

    const cleared = clearUserTargets(s, "userA");
    // "shared" is still targeted by userB, so it is NOT in the cleared list.
    expect(cleared).toEqual(["onlyA"]);
    expect(isTargetedByAnyone(s, "shared")).toBe(true);
    expect(isTargetedByUser(s, "shared", "userB")).toBe(true);
  });

  it("returns empty when the user had no targets", () => {
    const s = createTargetingState();
    expect(clearUserTargets(s, "ghost")).toEqual([]);
  });
});

describe("targetedTokens", () => {
  it("marks byLocalUser when the local user targets the token", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "tok2", true, "other");

    const views = targetedTokens(s, "me");
    const t1 = views.find((v) => v.tokenId === "tok1");
    const t2 = views.find((v) => v.tokenId === "tok2");
    expect(t1?.byLocalUser).toBe(true);
    expect(t2?.byLocalUser).toBe(false);
  });

  it("counts multiple targeters and sets byLocalUser if local is among them", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "tok1", true, "other");

    const views = targetedTokens(s, "me");
    expect(views).toHaveLength(1);
    expect(views[0]!.count).toBe(2);
    expect(views[0]!.byLocalUser).toBe(true);
  });
});

describe("computeReticlePositions", () => {
  const resolver =
    (positions: Record<string, TokenFootprint>) =>
    (tokenId: string): TokenFootprint | null =>
      positions[tokenId] ?? null;

  it("resolves footprints for targeted tokens", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");

    const out = computeReticlePositions(
      s,
      "me",
      resolver({ tok1: { x: 100, y: 200, gridSize: 50 } }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      tokenId: "tok1",
      x: 100,
      y: 200,
      gridSize: 50,
      byLocalUser: true,
    });
  });

  it("skips tokens that do not resolve (off-scene targets)", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "offscene", true, "me");

    const out = computeReticlePositions(s, "me", resolver({ tok1: { x: 0, y: 0, gridSize: 50 } }));
    expect(out.map((r) => r.tokenId)).toEqual(["tok1"]);
  });

  it("returns empty when nothing is targeted", () => {
    const s = createTargetingState();
    expect(computeReticlePositions(s, "me", resolver({}))).toEqual([]);
  });
});

describe("myTargets (REQ-CBT-056 — getMyTargets)", () => {
  const identityResolver =
    (identities: Record<string, TargetIdentity>) =>
    (tokenId: string): TargetIdentity | null =>
      identities[tokenId] ?? null;

  it("excludes a token targeted only by another user — token:targeted from someone else never enters myTargets", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "tok2", true, "other");

    const result = myTargets(
      s,
      "me",
      identityResolver({
        tok1: { actorId: "actor-1", name: "Alvo 1" },
        tok2: { actorId: "actor-2", name: "Alvo 2" },
      }),
    );

    expect(result).toEqual([{ tokenId: "tok1", actorId: "actor-1", name: "Alvo 1" }]);
  });

  it("returns empty when the local user has no targets", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "other");
    expect(myTargets(s, "me", identityResolver({}))).toEqual([]);
  });

  it("skips a targeted token that cannot be resolved (e.g. removed from the scene)", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    expect(myTargets(s, "me", identityResolver({}))).toEqual([]);
  });

  it("lists every token the local user targets, unaffected by other users also targeting them", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "tok1", true, "other");
    applyTargeted(s, "tok2", true, "me");

    const result = myTargets(
      s,
      "me",
      identityResolver({
        tok1: { actorId: "actor-1", name: "Alvo 1" },
        tok2: { actorId: null, name: "Alvo 2" },
      }),
    );

    expect(result).toEqual([
      { tokenId: "tok1", actorId: "actor-1", name: "Alvo 1" },
      { tokenId: "tok2", actorId: null, name: "Alvo 2" },
    ]);
  });
});

describe("diffMyTargets (REQ-CBT-056 — setMyTargets batch)", () => {
  it("marks every desired token not yet in the live selection", () => {
    const s = createTargetingState();
    const ops = diffMyTargets(s, "me", ["tok1", "tok2"]);
    expect(ops.sort((a, b) => a.tokenId.localeCompare(b.tokenId))).toEqual([
      { tokenId: "tok1", targeted: true },
      { tokenId: "tok2", targeted: true },
    ]);
  });

  it("clears live targets not present in the desired set", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "tok2", true, "me");

    const ops = diffMyTargets(s, "me", ["tok1"]);
    expect(ops).toEqual([{ tokenId: "tok2", targeted: false }]);
  });

  it("leaves a token that is already targeted and still desired untouched (no op)", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");

    const ops = diffMyTargets(s, "me", ["tok1"]);
    expect(ops).toEqual([]);
  });

  it("never touches another user's live selection", () => {
    const s = createTargetingState();
    applyTargeted(s, "shared", true, "other");

    const ops = diffMyTargets(s, "me", []);
    expect(ops).toEqual([]);
  });

  it("returns an empty diff when the desired set already matches the live selection exactly", () => {
    const s = createTargetingState();
    applyTargeted(s, "tok1", true, "me");
    applyTargeted(s, "tok2", true, "me");

    expect(diffMyTargets(s, "me", ["tok1", "tok2"])).toEqual([]);
  });
});
