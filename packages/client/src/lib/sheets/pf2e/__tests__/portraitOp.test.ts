/**
 * portraitOp.test.ts — the portrait swap/remove path produces the correct
 * doc:update op AND normalizes to the server wire shape (r19-W4).
 *
 * The character-sheet header calls vm.fieldUpdate("img", <path>) to swap the
 * portrait and vm.fieldUpdate("img", "") to remove it (back to the initials
 * fallback). sendOp/toEnvelope then normalizes the flat { id, diff } op into
 * the DocUpdatePayloadSchema wire shape { documentType, updates:[{ _id, diff }] }.
 *
 * Headless: no DOM, no Svelte, no network.
 */

import { describe, it, expect } from "vitest";
import { CharacterSheetVM } from "../characterSheetVM.js";
import { toEnvelope } from "../../../docs/sendOp.js";
import { OwnershipLevel } from "@fusion/shared";

function makeVM(opts: { ownership?: number; isGm?: boolean; img?: string } = {}): CharacterSheetVM {
  return new CharacterSheetVM({
    doc: {
      _id: "actor-001",
      name: "Finn",
      type: "character",
      img: opts.img ?? "icons/placeholder/npc.svg",
      system: {},
    },
    actorId: "actor-001",
    ownership: opts.ownership ?? OwnershipLevel.OWNER,
    userId: "user-1",
    isGm: opts.isGm ?? false,
  });
}

describe("portrait update op (fieldUpdate 'img')", () => {
  it("builds a doc:update op setting the new asset path on img", () => {
    const vm = makeVM();
    const op = vm.fieldUpdate("img", "/assets/finn-a3b4c5d6.webp");
    expect(op).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "actor-001",
      diff: { img: "/assets/finn-a3b4c5d6.webp" },
    });
  });

  it("normalizes to the server wire shape { documentType, updates:[{ _id, diff }] }", () => {
    const vm = makeVM();
    const op = vm.fieldUpdate("img", "/assets/finn-a3b4c5d6.webp");
    const envelope = toEnvelope(op!);
    expect(envelope).toEqual({
      type: "doc:update",
      payload: {
        documentType: "Actor",
        updates: [{ _id: "actor-001", diff: { img: "/assets/finn-a3b4c5d6.webp" } }],
      },
    });
  });

  it("removing the portrait sets img to an empty string (falls back to initials)", () => {
    const vm = makeVM({ img: "/assets/finn-a3b4c5d6.webp" });
    const op = vm.fieldUpdate("img", "");
    expect(op?.diff).toEqual({ img: "" });
    const envelope = toEnvelope(op!);
    expect(envelope.payload).toEqual({
      documentType: "Actor",
      updates: [{ _id: "actor-001", diff: { img: "" } }],
    });
  });

  it("a non-owner (no GM, no OWNER) cannot change the portrait — op is null", () => {
    const vm = makeVM({ ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.fieldUpdate("img", "/assets/x.webp")).toBeNull();
  });

  it("the GM can change the portrait even without an ownership grant", () => {
    const vm = makeVM({ ownership: OwnershipLevel.NONE, isGm: true });
    expect(vm.fieldUpdate("img", "/assets/x.webp")).not.toBeNull();
  });
});
