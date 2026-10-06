/**
 * FusionExpiry "after-roll" at the wire (BHR-F2-06, DC-05).
 *
 * `actor:applyCondition` validates `expiry` with this schema; without
 * `after-roll` + `rollPredicate` the server would refuse the Monster Hunter's
 * "until your next attack roll" effect. The schema is `.strict()`: a typo'd
 * field is still refused.
 */
import { describe, it, expect } from "vitest";
import { FusionExpirySchema } from "../protocol.js";

describe("FusionExpirySchema after-roll", () => {
  it("accepts after-roll with a roll predicate", () => {
    const r = FusionExpirySchema.safeParse({
      on: "after-roll",
      ownerActorId: "a1",
      rollPredicate: ["attack-roll", "target:mark:monster-hunter"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts after-roll without a predicate (the owner's first roll)", () => {
    expect(FusionExpirySchema.safeParse({ on: "after-roll", ownerActorId: "a1" }).success).toBe(
      true,
    );
  });

  it("still refuses unknown fields and unknown kinds", () => {
    expect(
      FusionExpirySchema.safeParse({ on: "after-roll", ownerActorId: "a1", extra: 1 }).success,
    ).toBe(false);
    expect(FusionExpirySchema.safeParse({ on: "after-sleep", ownerActorId: "a1" }).success).toBe(
      false,
    );
    expect(
      FusionExpirySchema.safeParse({ on: "after-roll", ownerActorId: "a1", rollPredicate: [""] })
        .success,
    ).toBe(false);
  });
});
