/**
 * actionBarIcons.test.ts — the custom image of a bar entry on the client (BAR-F3-05).
 *
 * REQ-BAR-029: the slot draws the chosen image or, without one, the generic icon.
 * REQ-BAR-072/073: only an owner or a privileged role is OFFERED the change (the server is the
 * gate; `action-bar-flags-socket.test.ts` proves the refusal).
 * REQ-BAR-074: "Trocar ícone…" and "Restaurar ícone padrão".
 */

import { describe, it, expect } from "vitest";
import { ACTION_BAR_ICON_AREA, ACTION_BAR_ICON_CAP, OwnershipLevel } from "@fusion/shared";
import {
  customIconOf,
  customIconCount,
  canEditActorIcons,
  iconMenuItems,
  iconWriteOp,
  ICON_MENU_CHANGE,
  ICON_MENU_RESTORE,
} from "../actionBarIcons.js";

const ICON = `/assets/${ACTION_BAR_ICON_AREA}/hanabi-1a2b3c4d.png`;

function actorWith(icons: Record<string, unknown>, ownership: Record<string, number> = {}) {
  return { _id: "a1", ownership, flags: { fusion: { actionBar: { icons } } } };
}

describe("customIconOf — what the slot draws (REQ-BAR-029)", () => {
  it("returns the chosen image of the entry", () => {
    expect(customIconOf(actorWith({ "strike:katana": ICON }), "strike:katana")).toBe(ICON);
  });

  it("is null without one: the generic icon", () => {
    expect(customIconOf(actorWith({ "strike:katana": ICON }), "spell:heal")).toBeNull();
    expect(customIconOf({ _id: "a1" }, "strike:katana")).toBeNull();
    expect(customIconOf(null, "strike:katana")).toBeNull();
  });

  it("never hands an arbitrary stored string to an <img>: a forged value is the generic icon", () => {
    for (const forged of [
      "https://evil.example/x.png",
      "/assets/mapa-secreto.png",
      `/assets/${ACTION_BAR_ICON_AREA}/../segredo.png`,
      "javascript:alert(1)",
      42,
      { nested: ICON },
    ]) {
      expect(
        customIconOf(actorWith({ "strike:a": forged }), "strike:a"),
        String(forged),
      ).toBeNull();
    }
  });

  it("counts the custom images of the actor", () => {
    expect(customIconCount(actorWith({ "strike:a": ICON, "spell:b": ICON }))).toBe(2);
    expect(customIconCount({})).toBe(0);
  });
});

describe("canEditActorIcons — who is offered the change (REQ-BAR-072/073)", () => {
  it("the owner of the actor", () => {
    expect(canEditActorIcons(actorWith({}, { u1: OwnershipLevel.OWNER }), "u1", false)).toBe(true);
  });

  it("not a player who only observes it, nor one without a user id", () => {
    const actor = actorWith({}, { u1: OwnershipLevel.OWNER, default: OwnershipLevel.OBSERVER });
    expect(canEditActorIcons(actor, "u2", false)).toBe(false);
    expect(canEditActorIcons(actor, null, false)).toBe(false);
  });

  it("the Mestre (a privileged role), on any actor", () => {
    expect(canEditActorIcons(actorWith({}, {}), "gm", true)).toBe(true);
  });
});

describe("iconMenuItems — the slot's menu (REQ-BAR-074)", () => {
  it("offers nothing to someone who may not write the actor", () => {
    expect(iconMenuItems({ canEdit: false, current: ICON, count: 1 })).toEqual([]);
  });

  it("offers 'Trocar ícone…' alone while the entry has the generic icon", () => {
    expect(iconMenuItems({ canEdit: true, current: null, count: 3 })).toEqual([
      { id: ICON_MENU_CHANGE, label: "Trocar ícone…" },
    ]);
  });

  it("adds 'Restaurar ícone padrão' once the entry has an image", () => {
    expect(
      iconMenuItems({ canEdit: true, current: ICON, count: 3 }).map((item) => item.id),
    ).toEqual([ICON_MENU_CHANGE, ICON_MENU_RESTORE]);
  });

  it("at the cap a NEW image is offered disabled, with the reason; replacing one still works", () => {
    const atCap = iconMenuItems({ canEdit: true, current: null, count: ACTION_BAR_ICON_CAP });
    expect(atCap[0]?.disabled).toBe(true);
    expect(atCap[0]?.reason).toContain(String(ACTION_BAR_ICON_CAP));
    const replace = iconMenuItems({ canEdit: true, current: ICON, count: ACTION_BAR_ICON_CAP });
    expect(replace[0]?.disabled).toBeUndefined();
  });
});

describe("iconWriteOp — what the change sends", () => {
  it("one doc:update on the actor, the map nested under the dot-path key", () => {
    expect(iconWriteOp("a1", "strike:long.sword", ICON)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      updates: [
        { _id: "a1", diff: { "flags.fusion.actionBar.icons": { "strike:long.sword": ICON } } },
      ],
    });
  });

  it("null restores the generic icon", () => {
    expect(iconWriteOp("a1", "strike:x", null).updates[0]?.diff).toEqual({
      "flags.fusion.actionBar.icons": { "strike:x": null },
    });
  });
});
