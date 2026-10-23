/**
 * partyVM.test.ts — which actors the Mestre's party table lists, and the generic HP fallback.
 */

import { describe, expect, it } from "vitest";

import {
  genericHp,
  placePartyPopover,
  selectPartyActors,
  shouldShowPartyStrip,
} from "../partyVM.js";

const GM = "user-gm";
const ALEX = "user-alex";
const BIA = "user-bia";

const alex = { _id: "a1", name: "Zelda", type: "character", ownership: { default: 0, [ALEX]: 3 } };
const bia = {
  _id: "a2",
  name: "Alice",
  type: "character",
  ownership: { default: 0, [BIA]: 3, [ALEX]: 1 },
};
const npc = { _id: "n1", name: "Goblin", type: "npc", ownership: { default: 0, [ALEX]: 3 } };
const gmOwned = { _id: "g1", name: "PJ do Mestre", type: "character", ownership: { default: 0, [GM]: 3 } };
const unowned = { _id: "u1", name: "Sem dono", type: "character", ownership: { default: 0 } };
const observable = { _id: "o1", name: "Observavel", type: "character", ownership: { default: 2 } };

describe("selectPartyActors", () => {
  it("keeps only characters owned by a player, sorted by name", () => {
    const rows = selectPartyActors([alex, npc, bia, gmOwned, unowned, observable], GM);
    expect(rows.map((a) => a._id)).toEqual(["a2", "a1"]);
  });

  it("does not count the viewer himself as the player owner", () => {
    expect(selectPartyActors([{ ...alex, ownership: { [GM]: 3, [ALEX]: 3 } }], GM)).toHaveLength(1);
    expect(selectPartyActors([gmOwned], GM)).toHaveLength(0);
  });

  it("is empty for a world with no actors", () => {
    expect(selectPartyActors([], GM)).toEqual([]);
  });
});

describe("genericHp", () => {
  it("reads the derived hit points when present", () => {
    expect(genericHp({ system: { derived: { hp: { value: 7, max: 20 } } } })).toEqual({
      value: 7,
      max: 20,
    });
  });

  it("falls back to the raw attribute, then to null", () => {
    expect(genericHp({ system: { attributes: { hp: { value: 3, max: 9 } } } })).toEqual({
      value: 3,
      max: 9,
    });
    expect(genericHp({ system: {} })).toBeNull();
    expect(genericHp({})).toBeNull();
  });
});

describe("shouldShowPartyStrip", () => {
  it("shows for the Mestre only while no action bar is drawn", () => {
    expect(shouldShowPartyStrip(true, 0)).toBe(true);
    expect(shouldShowPartyStrip(true, 96)).toBe(false);
    expect(shouldShowPartyStrip(false, 0)).toBe(false);
  });
});

describe("placePartyPopover", () => {
  const view = { width: 1200, height: 800 };

  it("opens above the strip, centred on the chip", () => {
    const place = placePartyPopover({ left: 500, width: 100 }, { top: 730 }, 340, view);
    expect(place.left).toBe(550 - 170);
    expect(place.bottom).toBe(800 - 730 + 6);
  });

  it("stays inside the window at both edges", () => {
    expect(placePartyPopover({ left: 0, width: 100 }, { top: 730 }, 340, view).left).toBe(8);
    expect(placePartyPopover({ left: 1150, width: 100 }, { top: 730 }, 340, view).left).toBe(
      1200 - 340 - 8,
    );
  });

  it("never asks for more height than there is above the strip", () => {
    expect(placePartyPopover({ left: 500, width: 100 }, { top: 730 }, 340, view).maxHeight).toBe(
      730 - 8,
    );
  });
});
