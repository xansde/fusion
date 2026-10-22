/**
 * BHR-F4-09 — the extra damage of the Apoio on a Strike's damage roll (REQ-PET-119, REQ-CHT-064), judged on the
 * SERVER.
 *
 * The rule, written here from Player Core (the bear's Support Benefit), not read from the effect:
 *   - the owner's Strike that HITS a creature within the bear's reach deals +1d8 slashing (2d8 once the companion
 *     is Nimble or Savage); a Strike that misses adds nothing;
 *   - "within reach" is measured edge to edge on the scene: a creature adjacent to the bear (5 feet) is in reach, one
 *     30 feet away is not, even if the owner's Strike hit it;
 *   - the extra damage is the bear's ("the creature takes 1d8 from the bear"), so a critical hit does NOT double it (unless the effect says so; the real pack effect is chained to this settlement in extra-damage-pack.test.ts).
 *
 * `settleExtraDamage` is pure (scenes and actors in); `readStrikeHit` reads the card from an in-memory database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { ResolvedExtraDamage } from "@fusion/system-api";
import {
  readStrikeHit,
  settleChatRollExtraDamage,
  settleExtraDamage,
  withExtraDice,
} from "../chat/extra-damage.js";

type Rec = Record<string, unknown>;

const SCENE = "scene000000000001";
const BEAR_ACTOR = "bearActor0000001";
const BEAR_TOKEN = "bearToken0000001";
const FOE_ACTOR = "foeActor00000001";
const FOE_TOKEN = "foeToken00000001";
const OWNER_ACTOR = "ownerActor000001";

/** One square = 100 px = 5 feet. */
const SQUARE = 100;

function scene(foeSquaresAway: number, id = SCENE): Rec {
  return {
    _id: id,
    grid: { size: SQUARE, distance: 5, type: "square" },
    tokens: [
      { _id: BEAR_TOKEN, actorId: BEAR_ACTOR, x: 0, y: 0 },
      { _id: FOE_TOKEN, actorId: FOE_ACTOR, x: foeSquaresAway * SQUARE, y: 0 },
    ],
  };
}

const actors: Record<string, Rec> = {
  [BEAR_ACTOR]: { _id: BEAR_ACTOR, system: { traits: { size: { value: "med" } } } },
  [FOE_ACTOR]: { _id: FOE_ACTOR, system: { traits: { size: { value: "med" } } } },
};
const getActor = (id: string): Rec | null => actors[id] ?? null;

const bearSupport = (over: Partial<ResolvedExtraDamage> = {}): ResolvedExtraDamage => ({
  slug: "support-bear",
  label: "Apoio do urso",
  count: 1,
  die: "d8",
  damageType: "slashing",
  doubleOnCrit: false,
  gate: { withinReachOf: "companion", companionActorId: BEAR_ACTOR, reachFeet: 5 },
  ...over,
});

const target = { tokenId: FOE_TOKEN, actorId: FOE_ACTOR, sceneId: SCENE };

function settle(
  foeSquaresAway: number,
  hit: "success" | "criticalSuccess" | null,
  extra: ResolvedExtraDamage[] = [bearSupport()],
) {
  return settleExtraDamage({
    extra,
    target,
    hit,
    world: { scenes: [scene(foeSquaresAway)], getActor },
  });
}

describe("Apoio do urso: a Strike that hits a creature within the bear's reach", () => {
  it("adds 1d8 slashing to the damage when the target is adjacent to the bear (5 feet)", () => {
    const out = settle(1, "success");
    expect(out.formulaSuffix).toBe(" + 1d8");
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]).toMatchObject({ dice: "1d8", damageType: "slashing", rolled: true });
    expect(out.applied[0]?.summary).toBe("Apoio do urso: +1d8 de dano cortante");
    expect(out.notes[0]).toMatchObject({ title: "Apoio do urso", text: "+1d8 de dano cortante" });
  });

  it("adds nothing when the target is 30 feet from the bear, although the Strike hit", () => {
    expect(settle(6, "success").formulaSuffix).toBe("");
  });

  it("adds nothing when the Strike missed (no proof of a hit)", () => {
    expect(settle(1, null)).toMatchObject({ formulaSuffix: "", applied: [], notes: [] });
  });

  it("a bear standing on the target's own square or 5 feet away counts; 10 feet is out of a 5-foot reach", () => {
    expect(settle(2, "success").formulaSuffix).toBe("");
    expect(
      settle(2, "success", [
        bearSupport({
          gate: { withinReachOf: "companion", companionActorId: BEAR_ACTOR, reachFeet: 10 },
        }),
      ]).formulaSuffix,
    ).toBe(" + 1d8");
  });

  it("2d8 for a Nimble or Savage bear", () => {
    expect(settle(1, "success", [bearSupport({ count: 2 })]).formulaSuffix).toBe(" + 2d8");
  });

  it("a critical hit does NOT double the bear's damage", () => {
    expect(settle(1, "criticalSuccess").formulaSuffix).toBe(" + 1d8");
    expect(settle(1, "criticalSuccess", [bearSupport({ count: 2 })]).formulaSuffix).toBe(" + 2d8");
  });

  it("an effect that is the owner's own damage (doubleOnCrit) doubles on a critical hit only", () => {
    const own = bearSupport({ doubleOnCrit: true });
    expect(settle(1, "success", [own]).formulaSuffix).toBe(" + 1d8");
    expect(settle(1, "criticalSuccess", [own]).formulaSuffix).toBe(" + 2d8");
  });

  it("without a companion token in the target's scene the gate does not open", () => {
    const sceneWithoutBear: Rec = {
      ...scene(1),
      tokens: [{ _id: FOE_TOKEN, actorId: FOE_ACTOR, x: SQUARE, y: 0 }],
    };
    expect(
      settleExtraDamage({
        extra: [bearSupport()],
        target,
        hit: "success",
        world: { scenes: [sceneWithoutBear], getActor },
      }).formulaSuffix,
    ).toBe("");
  });

  it("a bear in ANOTHER scene is not in reach of anything here", () => {
    const elsewhere = scene(1, "scene000000000002");
    (elsewhere["tokens"] as Rec[])[1] = { _id: "other", actorId: FOE_ACTOR, x: SQUARE, y: 0 };
    const here: Rec = { ...scene(1), tokens: [(scene(1)["tokens"] as Rec[])[1]] };
    expect(
      settleExtraDamage({
        extra: [bearSupport()],
        target,
        hit: "success",
        world: { scenes: [here, elsewhere], getActor },
      }).formulaSuffix,
    ).toBe("");
  });

  it("a hex grid cannot be measured: the gate stays shut instead of guessing", () => {
    const hex = scene(1);
    (hex["grid"] as Rec)["type"] = "hexrow";
    expect(
      settleExtraDamage({
        extra: [bearSupport()],
        target,
        hit: "success",
        world: { scenes: [hex], getActor },
      }).formulaSuffix,
    ).toBe("");
  });

  it("no target, no extra damage", () => {
    expect(
      settleExtraDamage({
        extra: [bearSupport()],
        target: null,
        hit: "success",
        world: { scenes: [scene(1)], getActor },
      }).formulaSuffix,
    ).toBe("");
  });

  it("a persistent part (the antelope's bleed) is announced, never added to the formula", () => {
    const out = settle(1, "success", [
      bearSupport({
        slug: "support-antelope",
        label: "Apoio do antílope",
        die: "d6",
        damageType: "bleed",
        category: "persistent",
      }),
    ]);
    expect(out.formulaSuffix).toBe("");
    expect(out.applied[0]).toMatchObject({ rolled: false, dice: "1d6", category: "persistent" });
    expect(out.notes[0]?.text).toContain("sangramento persistente");
  });
});

describe("withExtraDice", () => {
  it("appends before the flavor", () => {
    expect(withExtraDice({ formula: "2d8+4 # Dano" }, " + 1d8")).toEqual({
      formula: "2d8+4 + 1d8",
      flavor: "Dano",
    });
  });
  it("keeps a flavor the formula already split off", () => {
    expect(withExtraDice({ formula: "2d8+4", flavor: "Dano" }, " + 1d8")).toEqual({
      formula: "2d8+4 + 1d8",
      flavor: "Dano",
    });
  });
  it("returns the roll untouched with nothing to append", () => {
    const rolled = { formula: "2d8+4 # Dano" };
    expect(withExtraDice(rolled, "")).toBe(rolled);
  });
});

// ---------------------------------------------------------------------------
// The proof of a hit, from the chat history
// ---------------------------------------------------------------------------

describe("readStrikeHit: the server's own grading of the attack under the same card", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(
      "CREATE TABLE chat_messages (id TEXT PRIMARY KEY, data TEXT NOT NULL, timestamp INTEGER NOT NULL)",
    );
  });

  function attack(
    id: string,
    over: {
      degree?: string | null;
      parent?: string;
      userId?: string;
      actorId?: string;
      tokenId?: string;
      timestamp?: number;
      kind?: string;
    } = {},
  ): void {
    const msg = {
      _id: id,
      timestamp: over.timestamp ?? 1,
      speaker: { userId: over.userId ?? "u1", actorId: over.actorId ?? OWNER_ACTOR },
      rolls: [
        {
          total: 20,
          ...(over.degree === null ? {} : { degreeOfSuccess: over.degree ?? "success" }),
        },
      ],
      flags: {
        pf2e: { checkContext: { kind: over.kind ?? "attack", mapIndex: 0 } },
        fusion: {
          parentMessageId: over.parent ?? "card1",
          targetSnapshot: [
            { tokenId: over.tokenId ?? FOE_TOKEN, actorId: FOE_ACTOR, sceneId: SCENE },
          ],
        },
      },
    };
    db.prepare("INSERT INTO chat_messages (id, data, timestamp) VALUES (?, ?, ?)").run(
      id,
      JSON.stringify(msg),
      msg.timestamp,
    );
  }
  const read = (
    over: Partial<{
      parentMessageId: string;
      userId: string;
      actorId: string;
      targetTokenId: string;
    }> = {},
  ) =>
    readStrikeHit(db, {
      parentMessageId: "card1",
      userId: "u1",
      actorId: OWNER_ACTOR,
      targetTokenId: FOE_TOKEN,
      ...over,
    });

  it("a hit and a critical hit are proof; a miss and a critical miss are not", () => {
    attack("a1", { degree: "success" });
    expect(read()).toBe("success");
    db.exec("DELETE FROM chat_messages");
    attack("a1", { degree: "criticalSuccess" });
    expect(read()).toBe("criticalSuccess");
    db.exec("DELETE FROM chat_messages");
    attack("a1", { degree: "failure" });
    expect(read()).toBeNull();
    db.exec("DELETE FROM chat_messages");
    attack("a1", { degree: "criticalFailure" });
    expect(read()).toBeNull();
  });

  it("an attack the server did not grade is no proof", () => {
    attack("a1", { degree: null });
    expect(read()).toBeNull();
  });

  it("an attack under another card, by another speaker or another actor, against another token, is no proof", () => {
    attack("a1", { parent: "card2" });
    attack("a2", { userId: "u2", timestamp: 2 });
    attack("a3", { actorId: "someoneElse", timestamp: 3 });
    attack("a4", { tokenId: "otherToken", timestamp: 4 });
    expect(read()).toBeNull();
  });

  it("a roll that is not an attack (a skill check, a save) is no proof", () => {
    attack("a1", { kind: "skill" });
    attack("a2", { kind: "save", timestamp: 2 });
    expect(read()).toBeNull();
  });

  it("the latest attack of the card wins: a later miss is not overruled by an earlier hit", () => {
    attack("a1", { degree: "success", timestamp: 1 });
    attack("a2", { degree: "failure", timestamp: 2 });
    expect(read()).toBeNull();
    attack("a3", { degree: "criticalSuccess", timestamp: 3 });
    expect(read()).toBe("criticalSuccess");
  });

  describe("settleChatRollExtraDamage: only a Strike's damage roll, nested, with exactly one live target", () => {
    const store = {
      getAll: (_c: "scenes" | "actors") => [{ _id: SCENE }] as Rec[],
      getRaw: (_c: "scenes", _id: string) => scene(1),
      get: (_c: "actors", id: string) => {
        const found = actors[id];
        if (!found) throw new Error("not found");
        return found;
      },
    };
    const base = () => ({
      db,
      store,
      userId: "u1",
      actorId: OWNER_ACTOR,
      selectors: ["strike-damage", "damage"],
      extra: [bearSupport()],
      snapshot: [target],
      parentMessageId: "card1" as string | undefined,
    });

    it("counts when the card carries a hit on the same target", () => {
      attack("a1", { degree: "success" });
      expect(settleChatRollExtraDamage(base()).formulaSuffix).toBe(" + 1d8");
    });

    it("a miss under the card adds nothing", () => {
      attack("a1", { degree: "failure" });
      expect(settleChatRollExtraDamage(base()).formulaSuffix).toBe("");
    });

    it("a loose damage roll (no card) adds nothing", () => {
      attack("a1", { degree: "success" });
      expect(
        settleChatRollExtraDamage({ ...base(), parentMessageId: undefined }).formulaSuffix,
      ).toBe("");
    });

    it("two targets selected: no single target, nothing added", () => {
      attack("a1", { degree: "success" });
      expect(
        settleChatRollExtraDamage({ ...base(), snapshot: [target, { ...target, tokenId: "x" }] })
          .formulaSuffix,
      ).toBe("");
    });

    it("an attack roll (not a damage roll) adds nothing", () => {
      attack("a1", { degree: "success" });
      expect(
        settleChatRollExtraDamage({ ...base(), selectors: ["attack-roll"] }).formulaSuffix,
      ).toBe("");
    });
  });
});
