/**
 * @fusion/system-sf2e — Augmentation slot-limit pure-logic tests.
 *
 * Unit coverage for the pure validation logic (REQ-SF2-024, CA-SF2-05).
 * The real-handler-path proof (that this logic actually runs during a
 * doc:create round-trip) lives in
 * packages/server/src/__tests__/augmentation-slot-limit.test.ts — this
 * suite covers the pure function's edge cases cheaply and in isolation.
 */

import { describe, it, expect } from "vitest";
import {
  countNonApexAugmentations,
  validateAugmentationSlotLimit,
  AUGMENTATION_SLOT_LIMIT,
  AUGMENTATION_SLOT_LIMIT_I18N_KEY,
  type AugmentationLikeItem,
} from "../hooks/augmentation.js";

function aug(isApex = false): AugmentationLikeItem {
  return { type: "augmentation", system: { isApex } };
}

describe("countNonApexAugmentations", () => {
  it("counts only augmentation-type items", () => {
    const items: AugmentationLikeItem[] = [aug(), aug(), { type: "weapon" }];
    expect(countNonApexAugmentations(items)).toBe(2);
  });

  it("excludes apex augmentations from the count", () => {
    const items: AugmentationLikeItem[] = [aug(), aug(true), aug(true)];
    expect(countNonApexAugmentations(items)).toBe(1);
  });

  it("treats missing system.isApex as non-apex (schema default is false)", () => {
    const items: AugmentationLikeItem[] = [{ type: "augmentation" }];
    expect(countNonApexAugmentations(items)).toBe(1);
  });

  it("returns 0 for an empty collection", () => {
    expect(countNonApexAugmentations([])).toBe(0);
  });
});

describe("validateAugmentationSlotLimit (REQ-SF2-024, CA-SF2-05)", () => {
  it("allows a non-augmentation item regardless of existing count", () => {
    const existing = [aug(), aug(), aug(), aug()];
    const result = validateAugmentationSlotLimit(existing, { type: "weapon" });
    expect(result.ok).toBe(true);
  });

  it("allows the 1st..4th non-apex augmentation", () => {
    let existing: AugmentationLikeItem[] = [];
    for (let i = 1; i <= AUGMENTATION_SLOT_LIMIT; i++) {
      const result = validateAugmentationSlotLimit(existing, aug());
      expect(result.ok).toBe(true);
      expect(result.currentNonApexCount).toBe(i - 1);
      existing = [...existing, aug()];
    }
  });

  it("rejects the 5th non-apex augmentation with the slot-limit i18n key", () => {
    const existing = [aug(), aug(), aug(), aug()];
    const result = validateAugmentationSlotLimit(existing, aug());
    expect(result.ok).toBe(false);
    expect(result.currentNonApexCount).toBe(4);
    expect(result.i18nKey).toBe(AUGMENTATION_SLOT_LIMIT_I18N_KEY);
    expect(AUGMENTATION_SLOT_LIMIT_I18N_KEY).toBe("sf2e.augmentation.slotLimit");
  });

  it("apex augmentations never trigger rejection, even with 4 non-apex already installed", () => {
    const existing = [aug(), aug(), aug(), aug()];
    const result = validateAugmentationSlotLimit(existing, aug(true));
    expect(result.ok).toBe(true);
  });

  it("apex augmentations can stack unbounded alongside 4 non-apex", () => {
    const existing = [aug(), aug(), aug(), aug(), aug(true), aug(true), aug(true)];
    const result = validateAugmentationSlotLimit(existing, aug(true));
    expect(result.ok).toBe(true);
  });

  it("AUGMENTATION_SLOT_LIMIT is 4 (REQ-SF2-024)", () => {
    expect(AUGMENTATION_SLOT_LIMIT).toBe(4);
  });
});
