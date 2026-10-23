/**
 * Actor attitude model — pure helpers (spec 42 §5.5).
 *
 * Covers REQ-NPC-037 (three values, stored on the actor, one per actor),
 * REQ-NPC-038 (a single activation walks the cycle) and REQ-NPC-039 (there is
 * no per-character exception to express — the shape itself forbids it).
 */

import { describe, it, expect } from "vitest";
import {
  ActorAttitude,
  ATTITUDE_CYCLE,
  ATTITUDE_FLAG_PATH,
  ActorAttitudeSchema,
  isActorAttitude,
  readActorAttitude,
  readAttitudeFlagValue,
  touchesAttitudeFlag,
  attitudeFlagPatch,
  cycleAttitude,
} from "../attitude.js";

describe("REQ-NPC-037 — the three attitudes, stored on the actor", () => {
  it("REQ-NPC-037: accepts exactly enemy, neutral and ally", () => {
    expect(isActorAttitude("enemy")).toBe(true);
    expect(isActorAttitude("neutral")).toBe(true);
    expect(isActorAttitude("ally")).toBe(true);
    expect(isActorAttitude("hostile")).toBe(false);
    expect(isActorAttitude("")).toBe(false);
    expect(isActorAttitude(0)).toBe(false);
    expect(isActorAttitude(null)).toBe(false);
    expect(ActorAttitudeSchema.safeParse("ally").success).toBe(true);
    expect(ActorAttitudeSchema.safeParse("friend").success).toBe(false);
  });

  it("REQ-NPC-037: lives at flags.fusion.attitude on the actor document", () => {
    expect(ATTITUDE_FLAG_PATH).toBe("flags.fusion.attitude");

    const actor = {
      _id: "a1",
      type: "npc",
      flags: { fusion: { attitude: ActorAttitude.Enemy } },
    };
    expect(readActorAttitude(actor)).toBe("enemy");
    expect(readAttitudeFlagValue(actor)).toBe("enemy");
  });

  it("REQ-NPC-037: an actor with no attitude reads as none, and never throws", () => {
    expect(readActorAttitude({ _id: "a1", type: "npc" })).toBeUndefined();
    expect(readActorAttitude({ _id: "a1", flags: {} })).toBeUndefined();
    expect(readActorAttitude({ _id: "a1", flags: { fusion: {} } })).toBeUndefined();
    // A corrupted value reads as "no attitude" rather than throwing: this runs
    // on the emission path.
    expect(readActorAttitude({ flags: { fusion: { attitude: 42 } } })).toBeUndefined();
    expect(readActorAttitude(null)).toBeUndefined();
    expect(readActorAttitude("nope")).toBeUndefined();
  });

  it("REQ-NPC-037: a patch that touches the flag is recognized, including a clear", () => {
    expect(touchesAttitudeFlag(attitudeFlagPatch(ActorAttitude.Neutral))).toBe(true);
    expect(touchesAttitudeFlag(attitudeFlagPatch(null))).toBe(true);
    expect(touchesAttitudeFlag({ name: "Bram" })).toBe(false);
    expect(touchesAttitudeFlag({ flags: { fusion: { title: "Ferreiro" } } })).toBe(false);
    expect(touchesAttitudeFlag(null)).toBe(false);
  });
});

describe("REQ-NPC-038 — one activation, one step of the cycle", () => {
  it("REQ-NPC-038: cycles ally → neutral → enemy → ally (CA-NPC-009)", () => {
    expect(cycleAttitude(ActorAttitude.Ally)).toBe("neutral");
    expect(cycleAttitude(ActorAttitude.Neutral)).toBe("enemy");
    expect(cycleAttitude(ActorAttitude.Enemy)).toBe("ally");
  });

  it("REQ-NPC-038: three activations return to where they started", () => {
    let value: ActorAttitude = ActorAttitude.Neutral;
    for (let i = 0; i < ATTITUDE_CYCLE.length; i += 1) value = cycleAttitude(value);
    expect(value).toBe(ActorAttitude.Neutral);
  });

  it("REQ-NPC-038: an actor with no attitude enters the cycle instead of being skipped", () => {
    expect(cycleAttitude(undefined)).toBe(ATTITUDE_CYCLE[0]);
    expect(cycleAttitude("lixo")).toBe(ATTITUDE_CYCLE[0]);
  });
});

describe("REQ-NPC-039 — one attitude for the whole party", () => {
  it("REQ-NPC-039: the stored shape is a single scalar, with no per-character map", () => {
    const patch = attitudeFlagPatch(ActorAttitude.Enemy);
    const namespace = (patch["flags"] as Record<string, Record<string, unknown>>)["fusion"];
    expect(namespace).toEqual({ attitude: "enemy" });
    // Unlike knowledge (DEC-CTT-03), there is no `exceptions` key to write an
    // override into — the model itself forbids a per-character attitude.
    expect(Object.keys(namespace ?? {})).toEqual(["attitude"]);
  });

  it("REQ-NPC-039: reading is independent of any character id", () => {
    const actor = { type: "npc", flags: { fusion: { attitude: "ally" } } };
    // The reader takes the document and nothing else: there is no viewer, no
    // character and therefore no way to answer differently per player.
    expect(readActorAttitude(actor)).toBe("ally");
    expect(readActorAttitude.length).toBe(1);
  });
});
