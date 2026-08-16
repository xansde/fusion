/**
 * npcAttitude.test.ts — the client half of the attitude (spec 42 §5.5, G073).
 *
 * Covers REQ-NPC-037 (three values on the actor; a subtype that carries none
 * produces nothing at all), REQ-NPC-038 (one activation walks one step of the
 * cycle, and the activation becomes exactly one `doc:update`) and REQ-NPC-039
 * (the write is a single scalar for the whole party — no character id can enter
 * it, which is the contrast with the knowledge grid of spec 39).
 *
 * The test asserts BEHAVIOUR of the activation — what goes on the wire — and
 * never re-states the cycle table by reading it from the module under test.
 */

import { describe, expect, it } from "vitest";

import { ATTITUDE_FLAG_PATH, readActorAttitude, type ActorAttitude } from "@fusion/shared";

import {
  ATTITUDE_LABEL_KEYS,
  ATTITUDE_OP_TYPE,
  attitudeCycleOp,
  attitudeLabelKey,
  attitudeOfActor,
  displayedAttitude,
  nextAttitude,
  subtypeAcceptsAttitude,
} from "../npcAttitude.js";

/** The single diff value an activation produces, unwrapped. */
function writtenValue(op: ReturnType<typeof attitudeCycleOp>): unknown {
  const update = op?.payload.updates[0];
  return update?.diff[ATTITUDE_FLAG_PATH];
}

describe("REQ-NPC-037 — an attitude exists only where it applies", () => {
  it("REQ-NPC-037: an npc accepts one; a hazard does not", () => {
    expect(subtypeAcceptsAttitude("npc")).toBe(true);
    expect(subtypeAcceptsAttitude("hazard")).toBe(false);
    // Nothing else this client knows about carries one either.
    expect(subtypeAcceptsAttitude("character")).toBe(false);
    expect(subtypeAcceptsAttitude("loot")).toBe(false);
    expect(subtypeAcceptsAttitude(null)).toBe(false);
    expect(subtypeAcceptsAttitude(undefined)).toBe(false);
  });

  it("REQ-NPC-037: activating a hazard produces no op at all — not even a refused one", () => {
    const op = attitudeCycleOp({ id: "act-fosso0000001", subtype: "hazard", attitude: null });

    expect(op).toBeNull();
  });

  it("REQ-NPC-037: a hazard carrying a stray flag still displays nothing", () => {
    const hazard = {
      _id: "act-fosso0000001",
      type: "hazard",
      flags: { fusion: { attitude: "enemy" } },
    };

    // The flag is really there — this is not a fixture that forgot to set it.
    expect(readActorAttitude(hazard)).toBe("enemy");
    // And the row still shows no indication whatsoever (CA-NPC-010).
    expect(attitudeOfActor(hazard)).toBeNull();
    expect(displayedAttitude({ id: "x", subtype: "hazard", attitude: "enemy" })).toBeNull();
  });

  it("REQ-NPC-037: an npc with no attitude displays nothing, but is not barred from getting one", () => {
    const npc = { _id: "act-bram00000001", type: "npc" };

    expect(attitudeOfActor(npc)).toBeNull();
    expect(
      attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude: null }),
    ).not.toBeNull();
  });

  it("REQ-NPC-037: each of the three values is displayable and has a word to display", () => {
    for (const attitude of ["enemy", "neutral", "ally"] as const) {
      expect(displayedAttitude({ id: "a", subtype: "npc", attitude })).toBe(attitude);
      expect(attitudeLabelKey(attitude)).toBe(ATTITUDE_LABEL_KEYS[attitude]);
      expect(attitudeLabelKey(attitude)).toContain(attitude);
    }
  });
});

describe("REQ-NPC-038 — one activation, one step, one op", () => {
  it("REQ-NPC-038: three activations visit the three values and come back", () => {
    const first = nextAttitude(null);
    const second = nextAttitude(first);
    const third = nextAttitude(second);

    expect(new Set([first, second, third]).size).toBe(3);
    expect(nextAttitude(third)).toBe(first);
  });

  it("REQ-NPC-038: an activation on the row emits exactly one doc:update for that row", () => {
    const op = attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude: "ally" });

    expect(op?.type).toBe(ATTITUDE_OP_TYPE);
    expect(op?.type).toBe("doc:update");
    expect(op?.payload.documentType).toBe("Actor");
    expect(op?.payload.updates).toHaveLength(1);
    expect(op?.payload.updates[0]?._id).toBe("act-bram00000001");
  });

  it("REQ-NPC-038: the op writes the NEXT value at the actor's attitude path", () => {
    const current: ActorAttitude = "ally";
    const op = attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude: current });

    expect(writtenValue(op)).toBe(nextAttitude(current));
    expect(writtenValue(op)).not.toBe(current);
    expect(Object.keys(op?.payload.updates[0]?.diff ?? {})).toEqual([ATTITUDE_FLAG_PATH]);
  });

  it("REQ-NPC-038: activating an actor with no attitude gives it one instead of skipping it", () => {
    const op = attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude: null });

    expect(writtenValue(op)).toBe(nextAttitude(null));
    expect(typeof writtenValue(op)).toBe("string");
  });

  it("REQ-NPC-038: chaining activations walks the cycle and returns to the start", () => {
    let attitude: ActorAttitude | null = null;
    const seen: ActorAttitude[] = [];

    for (let i = 0; i < 3; i += 1) {
      const op = attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude });
      attitude = writtenValue(op) as ActorAttitude;
      seen.push(attitude);
    }

    expect(new Set(seen).size).toBe(3);
    expect(writtenValue(attitudeCycleOp({ id: "a", subtype: "npc", attitude }))).toBe(seen[0]);
  });

  it("REQ-NPC-038: a row with no id asks for nothing", () => {
    expect(attitudeCycleOp({ id: "", subtype: "npc", attitude: "ally" })).toBeNull();
  });
});

describe("REQ-NPC-039 — one attitude for the whole party", () => {
  it("REQ-NPC-039: the write is a single scalar, with no per-character map anywhere", () => {
    const op = attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude: "neutral" });
    const value = writtenValue(op);

    expect(typeof value).toBe("string");
    expect(Array.isArray(value)).toBe(false);
    // Nothing shaped like the knowledge map's exceptions can travel here.
    expect(JSON.stringify(op)).not.toContain("exceptions");
    expect(JSON.stringify(op)).not.toContain("general");
  });

  it("REQ-NPC-039: the op is the same no matter which character is at the table", () => {
    const target = { id: "act-bram00000001", subtype: "npc", attitude: "ally" } as const;

    // There is no character argument to pass: the function has one parameter, and
    // two calls made while different characters are on screen are byte-identical.
    expect(attitudeCycleOp.length).toBe(1);
    expect(JSON.stringify(attitudeCycleOp(target))).toBe(JSON.stringify(attitudeCycleOp(target)));
  });

  it("REQ-NPC-039: no character id can reach the payload", () => {
    const op = attitudeCycleOp({ id: "act-bram00000001", subtype: "npc", attitude: "enemy" });
    const serialized = JSON.stringify(op);

    for (const characterId of ["act-tobias00001", "act-fofurinha01"]) {
      expect(serialized).not.toContain(characterId);
    }
  });
});
