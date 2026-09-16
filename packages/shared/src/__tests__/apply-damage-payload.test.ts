/**
 * Tests for the ApplyDamage / ApplyCondition wire schemas.
 *
 * Asserts against the PF2e/plan RULE (REQ-SYS-142, plan §2.1/§2.4), never
 * against a hand-picked implementation detail:
 *   - an instance needs either `source` (server rereads the roll) or `amount`
 *     (privileged/actingAs:"system" caller) — never neither;
 *   - `type` stays a required field regardless of `category`;
 *   - `materials`/`ignoreResistance` are accepted (F5-09 / Exploitive Bomb);
 *   - `multiplier` and `basicSave` are mutually exclusive (REQ-SYS-142 step 1).
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142. Plan: docs/design/alquimista/tasks.md §2.1/§2.4.
 */
import { describe, it, expect } from "vitest";
import {
  DamageInstanceInputSchema,
  ActorApplyDamagePayloadSchema,
  ActorApplyConditionPayloadSchema,
  ActorDamageAppliedPayloadSchema,
} from "../protocol.js";

describe("DamageInstanceInputSchema", () => {
  it("rejects an instance without source and without amount", () => {
    const result = DamageInstanceInputSchema.safeParse({ type: "fire" });
    expect(result.success).toBe(false);
  });

  it("accepts an instance with only `source` (server rereads the total)", () => {
    const result = DamageInstanceInputSchema.safeParse({
      type: "fire",
      source: { messageId: "msg1", rollIndex: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an instance with only `amount` (privileged / actingAs:system)", () => {
    const result = DamageInstanceInputSchema.safeParse({ type: "fire", amount: 12 });
    expect(result.success).toBe(true);
  });

  it("rejects a persistent-category instance missing `type` (type stays required)", () => {
    const result = DamageInstanceInputSchema.safeParse({
      category: "persistent",
      amount: 4,
    });
    expect(result.success).toBe(false);
  });

  it("accepts `materials` on the instance (F5-09, e.g. cold-iron)", () => {
    const result = DamageInstanceInputSchema.safeParse({
      type: "piercing",
      amount: 8,
      materials: ["cold-iron"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown extra fields (anti-cheat: no passthrough)", () => {
    const result = DamageInstanceInputSchema.safeParse({
      type: "fire",
      amount: 12,
      forged: "value",
    });
    expect(result.success).toBe(false);
  });
});

describe("ActorApplyDamagePayloadSchema", () => {
  it("accepts `ignoreResistance` alongside a valid instance (Exploitive Bomb)", () => {
    const result = ActorApplyDamagePayloadSchema.safeParse({
      instances: [{ type: "fire", amount: 12 }],
      ignoreResistance: [{ type: "fire", value: 5 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty instances array", () => {
    const result = ActorApplyDamagePayloadSchema.safeParse({ instances: [] });
    expect(result.success).toBe(false);
  });

  it("rejects multiplier and basicSave together (REQ-SYS-142 step 1)", () => {
    const result = ActorApplyDamagePayloadSchema.safeParse({
      instances: [{ type: "fire", amount: 12 }],
      multiplier: 2,
      basicSave: { degree: "success" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts multiplier alone", () => {
    const result = ActorApplyDamagePayloadSchema.safeParse({
      instances: [{ type: "fire", source: { messageId: "msg1", rollIndex: 0 } }],
      multiplier: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("does not reject amount alongside source (server ignores amount at runtime, not the schema)", () => {
    // REQ-SYS-142 step 2: "com source... ignorar qualquer amount recebido" —
    // the server silently ignores it; the schema must not refuse the envelope.
    const result = ActorApplyDamagePayloadSchema.safeParse({
      instances: [{ type: "fire", amount: 999, source: { messageId: "msg1", rollIndex: 0 } }],
    });
    expect(result.success).toBe(true);
  });
});

describe("ActorApplyConditionPayloadSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = ActorApplyConditionPayloadSchema.safeParse({
      targetTokenIds: ["tok1"],
      slug: "frightened",
      mode: "increase",
      value: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an expiry anchor (FusionExpiry, plan §2.5)", () => {
    const result = ActorApplyConditionPayloadSchema.safeParse({
      targetTokenIds: ["tok1"],
      slug: "persistent-damage",
      mode: "add",
      data: {
        instance: { id: "pd1", damageType: "fire", formula: "2d6", dc: 15, assisted: false },
      },
      expiry: { on: "turn-end", ownerActorId: "actor1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mode", () => {
    const result = ActorApplyConditionPayloadSchema.safeParse({
      targetTokenIds: ["tok1"],
      slug: "frightened",
      mode: "obliterate",
    });
    expect(result.success).toBe(false);
  });
});

describe("ActorDamageAppliedPayloadSchema", () => {
  it("accepts a privileged (full) target line", () => {
    const result = ActorDamageAppliedPayloadSchema.safeParse({
      sourceMessageId: "msg1",
      targets: [
        {
          tokenId: "tok1",
          actorId: "actor1",
          name: "Goblin",
          byType: [{ type: "fire", amount: 7, resistanceApplied: 5 }],
          total: 7,
          hpBefore: 18,
          hpAfter: 11,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a redacted (non-privileged) target line without hp fields", () => {
    const result = ActorDamageAppliedPayloadSchema.safeParse({
      sourceMessageId: "msg1",
      targets: [
        {
          tokenId: "tok1",
          actorId: "actor1",
          name: "Goblin",
          byType: [{ type: "fire", amount: 7, resistanceApplied: 5 }],
          total: 7,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
