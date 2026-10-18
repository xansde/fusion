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

describe("tamanhoDaJanela", () => {
  it("keeps 940x640 on a roomy screen", async () => {
    const { tamanhoDaJanela } = await import("../openAvatarCreator.js");
    expect(tamanhoDaJanela(1920, 1080)).toEqual({ width: 940, height: 640 });
  });

  it("shrinks to a short screen so the action buttons stay on it", async () => {
    const { tamanhoDaJanela } = await import("../openAvatarCreator.js");
    expect(tamanhoDaJanela(1280, 620).height).toBe(510);
  });

  it("never goes under the window's minimum", async () => {
    const { tamanhoDaJanela } = await import("../openAvatarCreator.js");
    expect(tamanhoDaJanela(500, 400)).toEqual({ width: 620, height: 460 });
    expect(tamanhoDaJanela(undefined, undefined)).toEqual({ width: 940, height: 640 });
  });
});
