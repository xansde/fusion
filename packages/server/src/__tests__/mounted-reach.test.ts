/**
 * BHR-F5-06 — reach and the Apoio of the antelope, measured from the MOUNT (REQ-BHR-181, REQ-BHR-182,
 * REQ-PET-125).
 *
 * The rules, written here from Player Core, not read from the code or the pack:
 *   - a creature on a mount attacks from ANY square the mount occupies: distance and reach are measured from the
 *     nearest square of the mount or of the rider, whichever is closer;
 *   - Grasping Reach gives a two-handed weapon 10 feet of reach; a rider on a Large antelope, with the target 10
 *     feet from the mount and 15 feet from his own token, reaches it;
 *   - persistent damage is dealt once the creature is hit and is not doubled by a critical hit (it is its own
 *     damage, not dice of the Strike);
 *   - the antelope's Support counts only while the owner is mounted on THAT antelope (REQ-PET-125).
 */

import { describe, it, expect } from "vitest";
import type { ResolvedExtraDamage } from "@fusion/system-api";
import {
  distanceBetween,
  isWithinStrikeReach,
  strikeDistance,
  type PositionGrid,
  type PositionedToken,
} from "../combat/position.js";
import { settleChatRollExtraDamage, settleExtraDamage } from "../chat/extra-damage.js";

type Rec = Record<string, unknown>;

const SQUARE = 100;
const grid: PositionGrid = { size: SQUARE, distance: 5, type: "square" };

/** Large antelope at columns 0-1, rows 0-1. */
const mount: PositionedToken = { id: "mountToken", x: 0, y: 0, size: "lg" };
/** The rider sits on the near corner of the mount. */
const rider: PositionedToken = { id: "riderToken", x: 0, y: 0, size: "med" };
/** The target is two squares past the mount's far edge: 10 feet from the mount, 15 from the rider. */
const foe: PositionedToken = { id: "foeToken", x: 3 * SQUARE, y: 0, size: "med" };

describe("reach measured from the mount (REQ-BHR-181)", () => {
  it("the fixture is what the test says: 10 feet from the mount, 15 from the rider's own square", () => {
    expect(distanceBetween(mount, foe, grid)).toBe(10);
    expect(distanceBetween(rider, foe, grid)).toBe(15);
  });

  it("mounted, the strike distance is the nearest square of the mount or of the rider", () => {
    expect(strikeDistance(rider, foe, grid, mount)).toBe(10);
    expect(strikeDistance(rider, foe, grid, null)).toBe(15);
    expect(strikeDistance(rider, foe, grid)).toBe(15);
  });

  it("a rider on a Large mount reaches a target 10 feet from the mount with Grasping Reach (10 feet), not without it", () => {
    expect(isWithinStrikeReach({ attacker: rider, target: foe, grid, reachFeet: 10, mount })).toBe(
      true,
    );
    // 5 feet of ordinary reach: even from the mount's edge the target is out.
    expect(isWithinStrikeReach({ attacker: rider, target: foe, grid, reachFeet: 5, mount })).toBe(
      false,
    );
  });

  it("the same rider on foot (no mount) does not reach a target 15 feet away with 10 feet of reach", () => {
    expect(isWithinStrikeReach({ attacker: rider, target: foe, grid, reachFeet: 10 })).toBe(false);
  });

  it("a Large mount adjacent to the target lets the rider strike with ordinary 5-foot reach", () => {
    const near: PositionedToken = { id: "near", x: 2 * SQUARE, y: SQUARE, size: "med" };
    expect(isWithinStrikeReach({ attacker: rider, target: near, grid, reachFeet: 5, mount })).toBe(
      true,
    );
    expect(isWithinStrikeReach({ attacker: rider, target: near, grid, reachFeet: 5 })).toBe(false);
  });
});

describe("Apoio do antílope: persistent bleed only while mounted (REQ-BHR-182, REQ-PET-125)", () => {
  const SCENE = "scene000000000001";
  const ANTELOPE_ACTOR = "antelopeActor001";
  const OWNER_ACTOR = "ownerActor000001";
  const FOE_ACTOR = "foeActor00000001";
  const OTHER_ACTOR = "otherActor000001";
  const MOUNT_TOKEN = "mountToken000001";
  const RIDER_TOKEN = "riderToken000001";
  const FOE_TOKEN = "foeToken00000001";
  const OTHER_MOUNT_TOKEN = "otherMount00001";

  const actors: Record<string, Rec> = {
    [ANTELOPE_ACTOR]: { _id: ANTELOPE_ACTOR, system: { traits: { size: { value: "lg" } } } },
    [OWNER_ACTOR]: { _id: OWNER_ACTOR, system: { traits: { size: { value: "med" } } } },
    [FOE_ACTOR]: { _id: FOE_ACTOR, system: { traits: { size: { value: "med" } } } },
    [OTHER_ACTOR]: { _id: OTHER_ACTOR, system: { traits: { size: { value: "lg" } } } },
  };
  const getActor = (id: string): Rec | null => actors[id] ?? null;

  type MountCase = "yes" | "no" | "stale" | "other-mount";

  const flagsOf = (state: Rec): Rec => ({ fusion: { mount: state } });

  /**
   * yes: the rider and the antelope confirm each other. no: nobody is mounted. stale: only the rider's flag points
   * at the antelope. other-mount: the rider is mounted on a different creature.
   */
  function scene(mounted: MountCase): Rec {
    const riderFlags: Rec =
      mounted === "yes" || mounted === "stale"
        ? flagsOf({ mountTokenId: MOUNT_TOKEN })
        : mounted === "other-mount"
          ? flagsOf({ mountTokenId: OTHER_MOUNT_TOKEN })
          : {};
    const antelopeFlags: Rec = mounted === "yes" ? flagsOf({ riderTokenId: RIDER_TOKEN }) : {};
    return {
      _id: SCENE,
      grid: { size: SQUARE, distance: 5, type: "square" },
      tokens: [
        { _id: MOUNT_TOKEN, actorId: ANTELOPE_ACTOR, x: 0, y: 0, flags: antelopeFlags },
        { _id: RIDER_TOKEN, actorId: OWNER_ACTOR, x: 0, y: 0, flags: riderFlags },
        { _id: FOE_TOKEN, actorId: FOE_ACTOR, x: 2 * SQUARE, y: 0 },
        {
          _id: OTHER_MOUNT_TOKEN,
          actorId: OTHER_ACTOR,
          x: 0,
          y: 5 * SQUARE,
          flags: flagsOf({ riderTokenId: RIDER_TOKEN }),
        },
      ],
    };
  }

  const bleed = (over: Partial<ResolvedExtraDamage> = {}): ResolvedExtraDamage => ({
    slug: "support-antelope",
    label: "Apoio do antílope",
    count: 1,
    die: "d6",
    damageType: "bleed",
    category: "persistent",
    doubleOnCrit: false,
    gate: {
      withinReachOf: "companion",
      companionActorId: ANTELOPE_ACTOR,
      reachFeet: 5,
      requiresMounted: true,
    },
    ...over,
  });

  const target = { tokenId: FOE_TOKEN, actorId: FOE_ACTOR, sceneId: SCENE };

  function settle(
    mounted: MountCase,
    hit: "success" | "criticalSuccess" | null = "success",
    extra: ResolvedExtraDamage[] = [bleed()],
    rollerActorId: string | null = OWNER_ACTOR,
  ) {
    return settleExtraDamage({
      extra,
      target,
      hit,
      world: { scenes: [scene(mounted)], getActor },
      ...(rollerActorId !== null ? { rollerActorId } : {}),
    });
  }

  it("mounted on the antelope: the Strike that hits gets 1d6 persistent bleed, announced, not rolled with the formula", () => {
    const out = settle("yes");
    expect(out.formulaSuffix).toBe("");
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]).toMatchObject({
      dice: "1d6",
      damageType: "bleed",
      category: "persistent",
      rolled: false,
    });
    expect(out.applied[0]?.summary).toBe(
      "Apoio do antílope: 1d6 de dano de sangramento persistente (não entra na rolagem)",
    );
  });

  it("dismounted: the Strike gets no bleed", () => {
    expect(settle("no")).toMatchObject({ formulaSuffix: "", applied: [], notes: [] });
  });

  it("a flag the antelope does not confirm (stale) is not mounted", () => {
    expect(settle("stale").applied).toEqual([]);
  });

  it("mounted on ANOTHER mount: the antelope's Support does not count", () => {
    expect(settle("other-mount").applied).toEqual([]);
  });

  it("a roll with no roller named cannot prove the mount: the gate does not open", () => {
    expect(settle("yes", "success", [bleed()], null).applied).toEqual([]);
  });

  it("a Strike that misses gets no bleed even when mounted", () => {
    expect(settle("yes", null).applied).toEqual([]);
  });

  it("a critical hit does not double the persistent bleed, even if the part says it would double", () => {
    expect(settle("yes", "criticalSuccess").applied[0]?.dice).toBe("1d6");
    expect(settle("yes", "criticalSuccess", [bleed({ doubleOnCrit: true })]).applied[0]?.dice).toBe(
      "1d6",
    );
  });

  it("2d6 for a Nimble or Savage antelope", () => {
    expect(settle("yes", "success", [bleed({ count: 2 })]).applied[0]?.dice).toBe("2d6");
  });

  it("a part that does not ask for the mount (the bear) is unaffected by the mount state", () => {
    const bear: ResolvedExtraDamage = {
      slug: "support-bear",
      label: "Apoio do urso",
      count: 1,
      die: "d8",
      damageType: "slashing",
      doubleOnCrit: false,
      gate: { withinReachOf: "companion", companionActorId: ANTELOPE_ACTOR, reachFeet: 5 },
    };
    expect(settle("no", "success", [bear], null).formulaSuffix).toBe(" + 1d8");
  });

  it("through the chat settlement the roller (the speaker's actor) is the rider the mount is proven for", () => {
    const sceneDoc = scene("yes");
    const db = {
      prepare: () => ({
        all: () => [
          {
            data: JSON.stringify({
              speaker: { userId: "u1", actorId: OWNER_ACTOR },
              flags: {
                pf2e: { checkContext: { kind: "attack" } },
                fusion: { targetSnapshot: [{ tokenId: FOE_TOKEN }] },
              },
              rolls: [{ degreeOfSuccess: "success" }],
            }),
          },
        ],
      }),
    };
    const store = {
      getAll: () => [sceneDoc],
      getRaw: () => sceneDoc,
      get: (_c: "actors", id: string) => actors[id] as Rec,
    };
    const run = (actorId: string) =>
      settleChatRollExtraDamage({
        db,
        store,
        userId: "u1",
        actorId,
        selectors: ["strike-damage"],
        extra: [bleed()],
        snapshot: [target],
        parentMessageId: "card1",
      });
    expect(run(OWNER_ACTOR).applied).toHaveLength(1);
    // Another speaker is not the rider: the attack proof fails first, and no mount is proven either way.
    expect(run(FOE_ACTOR).applied).toEqual([]);
  });

  it("with a second token of the same antelope actor, the reach is measured from the token the rider is on", () => {
    const sceneDoc = scene("yes") as { tokens: Rec[] };
    // A decoy token of the same actor stands next to the foe, earlier in the list; the rider is on the other one.
    sceneDoc.tokens.unshift({
      _id: "decoyToken00001",
      actorId: ANTELOPE_ACTOR,
      x: 3 * SQUARE,
      y: 0,
    });
    // Move the mounted pair far away from the foe (rider and antelope together).
    for (const t of sceneDoc.tokens) {
      if (t["_id"] === MOUNT_TOKEN || t["_id"] === RIDER_TOKEN) t["x"] = -6 * SQUARE;
    }
    const out = settleExtraDamage({
      extra: [bleed()],
      target,
      hit: "success",
      world: { scenes: [sceneDoc as Rec], getActor },
      rollerActorId: OWNER_ACTOR,
    });
    expect(out.applied).toEqual([]);
  });
});
