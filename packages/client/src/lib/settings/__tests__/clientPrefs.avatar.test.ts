/**
 * The avatar overlay preferences (show/hide, size, position) — per viewer,
 * client-only, scoped by world + user like everything in clientPrefs.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clientPrefsKey,
  DEFAULT_AVATAR_OVERLAY,
  loadClientPreferences,
  setAvatarOverlayPreference,
  setVolumeChannel,
} from "../clientPrefs.js";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => void store.set(key, value),
      removeItem: (key: string): void => void store.delete(key),
    },
  });
});

describe("avatar overlay preferences", () => {
  it("defaults to visible, 192 px, bottom-right, no dragged position", () => {
    expect(loadClientPreferences("w", "u").avatarOverlay).toEqual({
      visivel: true,
      tamanho: 192,
      canto: "inferior-direito",
      livre: null,
    });
    expect(DEFAULT_AVATAR_OVERLAY.visivel).toBe(true);
  });

  it("persists each change and survives a reload (a fresh load from storage)", () => {
    setAvatarOverlayPreference("w", "u", { tamanho: 256 });
    setAvatarOverlayPreference("w", "u", { canto: "superior-esquerdo" });
    setAvatarOverlayPreference("w", "u", { visivel: false });
    expect(loadClientPreferences("w", "u").avatarOverlay).toEqual({
      visivel: false,
      tamanho: 256,
      canto: "superior-esquerdo",
      livre: null,
    });
  });

  it("a dragged position is kept, and choosing a corner drops it", () => {
    setAvatarOverlayPreference("w", "u", { livre: { x: 0.4, y: 0.2 } });
    expect(loadClientPreferences("w", "u").avatarOverlay.livre).toEqual({ x: 0.4, y: 0.2 });
    setAvatarOverlayPreference("w", "u", { canto: "inferior-esquerdo", livre: null });
    expect(loadClientPreferences("w", "u").avatarOverlay.livre).toBeNull();
  });

  it("does not disturb the other preferences, nor is disturbed by them", () => {
    setVolumeChannel("w", "u", "music", 0.3);
    setAvatarOverlayPreference("w", "u", { tamanho: 128 });
    const p = loadClientPreferences("w", "u");
    expect(p.volume.music).toBe(0.3);
    expect(p.avatarOverlay.tamanho).toBe(128);
  });

  it("is per viewer: another user in the same world keeps the defaults", () => {
    setAvatarOverlayPreference("w", "u", { visivel: false });
    expect(loadClientPreferences("w", "outro").avatarOverlay.visivel).toBe(true);
  });

  it("repairs junk: size clamped to 64..320, unknown corner, broken position", () => {
    store.set(
      clientPrefsKey("w", "u"),
      JSON.stringify({ avatarOverlay: { visivel: "sim", tamanho: 9999, canto: "meio", livre: { x: "a" } } }),
    );
    expect(loadClientPreferences("w", "u").avatarOverlay).toEqual(DEFAULT_AVATAR_OVERLAY_WITH({ tamanho: 320 }));
    store.set(clientPrefsKey("w", "u"), JSON.stringify({ avatarOverlay: { tamanho: 10, livre: { x: 5, y: -2 } } }));
    const p = loadClientPreferences("w", "u").avatarOverlay;
    expect(p.tamanho).toBe(64);
    expect(p.livre).toEqual({ x: 1, y: 0 });
  });

  it("works without storage at all (private mode): defaults, no throw", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    expect(loadClientPreferences("w", "u").avatarOverlay).toEqual(DEFAULT_AVATAR_OVERLAY);
    expect(() => setAvatarOverlayPreference("w", "u", { tamanho: 100 })).not.toThrow();
  });
});

function DEFAULT_AVATAR_OVERLAY_WITH(extra: Partial<typeof DEFAULT_AVATAR_OVERLAY>) {
  return { ...DEFAULT_AVATAR_OVERLAY, ...extra };
}
