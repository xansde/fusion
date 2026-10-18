/**
 * soundBadge.ts — the Som tab's state dot: lit while the browser blocks the
 * ambient track's audio (autoplay policy) and a track is on the air, so a
 * player with the drawer closed still has a cue that a click will turn it on.
 */
import type { SidebarBadgeStore } from "../sidebar/registry.js";
import { soundStore } from "./soundStore.svelte.js";

export const soundUnlockBadge: SidebarBadgeStore = {
  get value(): boolean {
    return soundStore.track !== null && !soundStore.unlocked;
  },
};
