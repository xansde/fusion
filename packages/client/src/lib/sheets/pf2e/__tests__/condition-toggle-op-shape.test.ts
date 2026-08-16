/**
 * condition-toggle-op-shape.test.ts — pins the exact op shape
 * CharacterSheetVM.toggleCondition / NpcSheetVM.toggleCondition return (T034).
 *
 * WHY THIS FILE EXISTS: packages/server/src/__tests__/condition-toggle.test.ts
 * proves the fixed op shape works end-to-end against the real server, but it
 * cannot call these VMs directly — packages/server has no dependency on
 * @fusion/client (verified against packages/server/package.json). Its op
 * builders (buildAddConditionOpFixed / buildRemoveConditionOpFixed) instead
 * REPLICATE the shape by hand. This file is the other half of that proof: it
 * asserts the VMs actually return objects matching that exact replicated
 * shape, so a future change to toggleCondition that silently drifts from the
 * server test's assumption fails HERE instead of only being caught live.
 *
 * Keep the literals below in sync with condition-toggle.test.ts's op
 * builders if either changes.
 */

import { describe, it, expect } from "vitest";
import { CharacterSheetVM } from "../characterSheetVM.js";
import type { DocCreateEmbeddedPayload as CharacterDocCreateEmbeddedPayload } from "../characterSheetVM.js";
import { NpcSheetVM } from "../npcSheetVM.js";
import type { DocCreateEmbeddedPayload as NpcDocCreateEmbeddedPayload } from "../npcSheetVM.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures — minimal docs with one existing "frightened" condition item.
// ---------------------------------------------------------------------------

function makeCharacterDoc(): Record<string, unknown> {
  return {
    _id: "actor-shape-001",
    name: "Shape Test PC",
    type: "character",
    items: [
      {
        _id: "item-frightened",
        name: "Frightened",
        type: "condition",
        system: { slug: "frightened", value: 2 },
      },
    ],
    system: { details: { level: { value: 1 } } },
  };
}

function makeNpcDoc(): Record<string, unknown> {
  return {
    _id: "npc-shape-001",
    name: "Shape Test NPC",
    type: "npc",
    items: [
      {
        _id: "item-frightened",
        name: "Frightened",
        type: "condition",
        system: { slug: "frightened", value: 2 },
      },
    ],
    system: { level: { value: 1 } },
  };
}

// ---------------------------------------------------------------------------
// CharacterSheetVM
// ---------------------------------------------------------------------------

describe("CharacterSheetVM.toggleCondition — op shape (T034)", () => {
  it("add: doc:create embedded Item, no system.value key, label from the scaffolding catalog", () => {
    const vm = new CharacterSheetVM({
      doc: makeCharacterDoc(),
      actorId: "actor-shape-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });

    const op = vm.toggleCondition("prone");

    expect(op).toEqual({
      type: "doc:create",
      documentType: "Item",
      data: {
        type: "condition",
        name: "Prone",
        system: { slug: "prone" },
      },
      parent: { type: "Actor", id: "actor-shape-001" },
    });
    // Pin the absence explicitly too — `toEqual` above already fails if an
    // extra key like `value` existed, but this documents the exact bug the
    // omission fixes (ConditionSystemSchema rejects `value: null`).
    const data = (op as CharacterDocCreateEmbeddedPayload).data;
    expect("value" in (data["system"] as Record<string, unknown>)).toBe(false);
  });

  it("remove: doc:delete embedded Item targeting the existing condition's _id", () => {
    const vm = new CharacterSheetVM({
      doc: makeCharacterDoc(),
      actorId: "actor-shape-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });

    const op = vm.toggleCondition("frightened");

    expect(op).toEqual({
      type: "doc:delete",
      documentType: "Item",
      id: "item-frightened",
      parent: { type: "Actor", id: "actor-shape-001" },
    });
  });
});

// ---------------------------------------------------------------------------
// NpcSheetVM — identical contract
// ---------------------------------------------------------------------------

describe("NpcSheetVM.toggleCondition — op shape (T034)", () => {
  it("add: doc:create embedded Item, no system.value key, label from the scaffolding catalog", () => {
    const vm = new NpcSheetVM({
      doc: makeNpcDoc(),
      actorId: "npc-shape-001",
      ownership: OwnershipLevel.OWNER,
      isGm: true,
    });

    const op = vm.toggleCondition("prone");

    expect(op).toEqual({
      type: "doc:create",
      documentType: "Item",
      data: {
        type: "condition",
        name: "Prone",
        system: { slug: "prone" },
      },
      parent: { type: "Actor", id: "npc-shape-001" },
    });
    const data = (op as NpcDocCreateEmbeddedPayload).data;
    expect("value" in (data["system"] as Record<string, unknown>)).toBe(false);
  });

  it("remove: doc:delete embedded Item targeting the existing condition's _id", () => {
    const vm = new NpcSheetVM({
      doc: makeNpcDoc(),
      actorId: "npc-shape-001",
      ownership: OwnershipLevel.OWNER,
      isGm: true,
    });

    const op = vm.toggleCondition("frightened");

    expect(op).toEqual({
      type: "doc:delete",
      documentType: "Item",
      id: "item-frightened",
      parent: { type: "Actor", id: "npc-shape-001" },
    });
  });
});
