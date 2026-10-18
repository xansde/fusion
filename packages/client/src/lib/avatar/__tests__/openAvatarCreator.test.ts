import { describe, expect, it } from "vitest";
import { actorHasAvatar, avatarHeaderActions, canEditAvatar } from "../openAvatarCreator.js";

describe("openAvatarCreator helpers", () => {
  it("edits only as OWNER or GM", () => {
    expect(canEditAvatar(3, false)).toBe(true);
    expect(canEditAvatar(2, false)).toBe(false);
    expect(canEditAvatar(0, true)).toBe(true);
  });

  it("offers the avatar only for characters", () => {
    expect(actorHasAvatar({ type: "character" })).toBe(true);
    expect(actorHasAvatar({ type: "npc" })).toBe(false);
  });

  it("returns a header action for characters and none for NPCs", () => {
    const perms = { ownership: 3, isGm: false };
    expect(avatarHeaderActions("a1", { type: "character" }, perms)).toHaveLength(1);
    expect(avatarHeaderActions("a1", { type: "npc" }, perms)).toHaveLength(0);
  });
});
