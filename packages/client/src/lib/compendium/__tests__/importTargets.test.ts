/**
 * Where an entry can be brought, and the drop the scene refuses (G095).
 *
 * Spec 43 §5.7 — REQ-CPD-060 (world is privileged), REQ-CPD-061 (a sheet takes
 * a compatible entry from whoever OWNS it), REQ-CPD-062 (an actor dropped on
 * the scene goes to the world first) and REQ-CPD-063 (anything else dropped on
 * the scene is refused WITHOUT importing).
 *
 * These are hints for drawing the panel; the wall is on the server (see
 * `packages/server/src/__tests__/compendium-import-to-actor.test.ts`). What is
 * tested here is that the panel never offers a door the server would slam, and
 * — the one that has teeth — that a refused scene drop is a VALUE the caller is
 * forced to handle rather than a silent no-op.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import {
  buildSheetTargets,
  canBringToSheet,
  canBringToWorld,
  decideSceneDrop,
  SCENE_DROP_NOT_AN_ACTOR_KEY,
} from "../importTargets.js";
import type { CompendiumDragPayload } from "../compendiumBrowser.js";

const PLAYER = { userId: "user-player", isPrivileged: false };
const GM = { userId: "user-gm", isPrivileged: true };

function actor(
  id: string,
  name: string,
  ownership: Record<string, number>,
): Record<string, unknown> {
  return { _id: id, name, type: "character", ownership };
}

const OWNED = actor("actor-owned", "Fofurinha", {
  default: OwnershipLevel.NONE,
  "user-player": OwnershipLevel.OWNER,
});
const OBSERVED = actor("actor-observed", "Tobias", {
  default: OwnershipLevel.NONE,
  "user-player": OwnershipLevel.OBSERVER,
});
const FOREIGN = actor("actor-foreign", "Goblin", { default: OwnershipLevel.NONE });

function dragPayload(over: Partial<CompendiumDragPayload>): CompendiumDragPayload {
  return {
    kind: "compendium-item",
    uuid: "Compendium.pf2e.conditions.Item.abc",
    packId: "pf2e.conditions",
    documentType: "Item",
    name: "Frightened",
    img: null,
    subtype: "condition",
    ...over,
  };
}

describe("sheet destinations (REQ-CPD-061)", () => {
  it("REQ-CPD-061: a player's destinations are the sheets he OWNS — nothing else", () => {
    const targets = buildSheetTargets([OWNED, OBSERVED, FOREIGN], PLAYER);

    expect(targets.map((t) => t.actorId)).toEqual(["actor-owned"]);
    expect(targets[0]?.name).toBe("Fofurinha");
  });

  it("REQ-CPD-061: OBSERVER is not OWNER — a sheet he can read is not a sheet he can fill", () => {
    expect(buildSheetTargets([OBSERVED], PLAYER)).toEqual([]);
  });

  it("REQ-CPD-061: default OWNER makes a sheet a destination without a per-user entry", () => {
    const shared = actor("actor-shared", "Party Bag", { default: OwnershipLevel.OWNER });

    expect(buildSheetTargets([shared], PLAYER).map((t) => t.actorId)).toEqual(["actor-shared"]);
  });

  it("REQ-CPD-073: a privileged seat owns every sheet, as the server resolves it", () => {
    const targets = buildSheetTargets([OWNED, OBSERVED, FOREIGN], GM);

    expect(targets.map((t) => t.actorId)).toEqual([
      "actor-owned",
      "actor-observed",
      "actor-foreign",
    ]);
  });

  it("junk in the mirror is skipped, not drawn as a nameless destination", () => {
    const targets = buildSheetTargets([null, 42, { name: "no id" }, OWNED], GM);

    expect(targets.map((t) => t.actorId)).toEqual(["actor-owned"]);
  });

  it("REQ-CPD-061: only a compatible type reaches a sheet, and only with a destination", () => {
    const targets = buildSheetTargets([OWNED], PLAYER);

    expect(canBringToSheet("Item", targets)).toBe(true);
    expect(canBringToSheet("Actor", targets)).toBe(false);
    expect(canBringToSheet("JournalEntry", targets)).toBe(false);
    expect(canBringToSheet("Item", [])).toBe(false);
  });

  it("REQ-CPD-060: bringing to the world stays privileged", () => {
    expect(canBringToWorld(GM)).toBe(true);
    expect(canBringToWorld(PLAYER)).toBe(false);
  });
});

describe("dropping on the scene (REQ-CPD-062, REQ-CPD-063)", () => {
  it("REQ-CPD-062: an actor entry is accepted, and the payload survives for the import", () => {
    const payload = dragPayload({ kind: "compendium-actor", documentType: "Actor" });

    const decision = decideSceneDrop(payload);

    expect(decision).toEqual({ accepted: true, payload });
  });

  it("REQ-CPD-063: an item entry is REFUSED with a reason — never accepted then discarded", () => {
    const decision = decideSceneDrop(dragPayload({}));

    expect(decision?.accepted).toBe(false);
    expect(decision).toEqual({ accepted: false, reasonKey: SCENE_DROP_NOT_AN_ACTOR_KEY });
  });

  it("REQ-CPD-063: a payload claiming actor kind but another type is refused too", () => {
    const decision = decideSceneDrop(
      dragPayload({ kind: "compendium-actor", documentType: "JournalEntry" }),
    );

    expect(decision?.accepted).toBe(false);
  });

  it("a drag that is not from the compendium is not this panel's refusal to give", () => {
    expect(decideSceneDrop(null)).toBeNull();
  });
});
