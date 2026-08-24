/**
 * tokenSheetPlan.test.ts — what the map opens when a token is double-clicked.
 *
 * Spec: 41-token.md REQ-TOK-110..114 (the gesture and what it shows)
 * Spec: 06-canvas-e-renderizacao.md REQ-CNV-094 (the sheet opened FROM a token
 *       shows the effective actor, and an unlinked token gets its own window)
 * Spec: 41-token.md REQ-TOK-070/071 (hit points are cut by role, everywhere)
 */

import { describe, it, expect } from "vitest";
import { planTokenSheet } from "../tokenSheetPlan.js";

const BASE_ACTOR = {
  _id: "actor001",
  name: "Goblin Warrior",
  type: "npc",
  img: "/base.webp",
  system: { attributes: { hp: { value: 10, max: 10 } } },
};

function linkedToken(overrides: Record<string, unknown> = {}) {
  return { _id: "tok001", actorId: "actor001", actorLink: true, actorDelta: null, ...overrides };
}

function unlinkedToken(delta: Record<string, unknown> | null) {
  return { _id: "tok002", actorId: "actor001", actorLink: false, actorDelta: delta };
}

describe("planTokenSheet (REQ-TOK-110/112): the sheet the gesture opens", () => {
  it("a linked token opens the actor itself, keyed by the actor (REQ-CNV-094)", () => {
    const plan = planTokenSheet(linkedToken(), BASE_ACTOR, { isGm: true, isOwner: true });
    expect(plan.actorId).toBe("actor001");
    expect(plan.doc["name"]).toBe("Goblin Warrior");
    expect(plan.singletonKey).toBe("sheet:Actor:actor001");
    expect(plan.readOnly).toBe(false);
    expect(plan.ownership).toBe(3);
  });

  it("REQ-TOK-112: the sheet shows the EFFECTIVE actor, not the base one", () => {
    const plan = planTokenSheet(
      unlinkedToken({ name: "Goblin Boss", system: { attributes: { hp: { value: 3, max: 10 } } } }),
      BASE_ACTOR,
      { isGm: true, isOwner: true },
    );
    expect(plan.doc["name"]).toBe("Goblin Boss");
    const system = plan.doc["system"] as { attributes: { hp: { value: number } } };
    expect(system.attributes.hp.value).toBe(3);
  });

  it("REQ-CNV-094: an unlinked token gets ITS OWN window, never the actor's", () => {
    const plan = planTokenSheet(unlinkedToken({ name: "Goblin Boss" }), BASE_ACTOR, {
      isGm: true,
      isOwner: true,
    });
    expect(plan.singletonKey).toBe("sheet:Token:tok002");
  });

  it("REQ-TOK-113: an unlinked token with a delta opens read-only while token:updateActor does not exist", () => {
    const plan = planTokenSheet(unlinkedToken({ name: "Goblin Boss" }), BASE_ACTOR, {
      isGm: true,
      isOwner: true,
    });
    expect(plan.readOnly).toBe(true);
    expect(plan.ownership).toBe(0);
  });

  it("an unlinked token with NO delta is the base actor, and stays editable", () => {
    const plan = planTokenSheet(unlinkedToken(null), BASE_ACTOR, { isGm: true, isOwner: true });
    expect(plan.doc["name"]).toBe("Goblin Warrior");
    expect(plan.readOnly).toBe(false);
    expect(plan.ownership).toBe(3);
  });

  it("a player who owns the actor edits it; a GM always does", () => {
    expect(
      planTokenSheet(linkedToken(), BASE_ACTOR, { isGm: false, isOwner: true }).ownership,
    ).toBe(3);
    expect(
      planTokenSheet(linkedToken(), BASE_ACTOR, { isGm: true, isOwner: false }).ownership,
    ).toBe(3);
  });
});
