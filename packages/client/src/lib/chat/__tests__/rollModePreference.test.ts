/**
 * rollModePreference.test.ts — the roll mode selector persists per world AND user.
 *
 * REQ-ACH-041 (spec 38 §5.5): the chosen mode lives in `localStorage`, is restored when
 * the world is reopened, and is NEVER sent to the server as a preference. The key carries
 * the world's identity and the user's id, so a browser shared by the GM and a player keeps
 * two independent entries and moving to another world does not carry the mode over.
 *
 * Covers REQ-ACH-041 and REQ-CHT-017.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  LEGACY_ROLL_MODE_KEY,
  loadRollMode,
  rollModeKey,
  saveRollMode,
} from "../rollModePreference.js";

// ---------------------------------------------------------------------------
// localStorage stub — the client suite runs in a node environment (no DOM).
// ---------------------------------------------------------------------------

let store: Map<string, string>;

function installLocalStorage(): void {
  store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => void store.set(key, value),
      removeItem: (key: string): void => void store.delete(key),
      clear: (): void => store.clear(),
    },
  });
}

beforeEach(() => {
  installLocalStorage();
});

describe("rollModeKey — mundo + usuário na chave (REQ-ACH-041)", () => {
  it("carries both ids, so a shared device never mixes two people up", () => {
    expect(rollModeKey("world-a", "user-1")).toBe("fusion:rollMode:world-a:user-1");
    expect(rollModeKey("world-a", "user-2")).not.toBe(rollModeKey("world-a", "user-1"));
    expect(rollModeKey("world-b", "user-1")).not.toBe(rollModeKey("world-a", "user-1"));
  });
});

describe("loadRollMode / saveRollMode (REQ-ACH-041, REQ-CHT-017)", () => {
  it("defaults to public when nothing was ever saved", () => {
    expect(loadRollMode("world-a", "user-1")).toBe("public");
  });

  it("restores what this user saved in this world", () => {
    saveRollMode("world-a", "user-1", "blindroll");
    expect(loadRollMode("world-a", "user-1")).toBe("blindroll");
  });

  it("does not hand one user's mode to another on the same device", () => {
    saveRollMode("world-a", "gm-1", "blindroll");
    expect(loadRollMode("world-a", "player-1")).toBe("public");
  });

  it("does not carry the mode from one world to another", () => {
    saveRollMode("world-a", "user-1", "selfroll");
    expect(loadRollMode("world-b", "user-1")).toBe("public");
  });

  it("ignores a corrupt stored value instead of trusting it", () => {
    store.set(rollModeKey("world-a", "user-1"), "shout-it-everywhere");
    expect(loadRollMode("world-a", "user-1")).toBe("public");
  });

  it("falls back to the pre-scoped key so an existing device keeps its choice", () => {
    store.set(LEGACY_ROLL_MODE_KEY, "gmroll");
    expect(loadRollMode("world-a", "user-1")).toBe("gmroll");

    // Once the user picks a mode, the scoped key owns the answer.
    saveRollMode("world-a", "user-1", "public");
    expect(loadRollMode("world-a", "user-1")).toBe("public");
  });

  it("writes only under the scoped key — the legacy key is read-only", () => {
    saveRollMode("world-a", "user-1", "selfroll");
    expect(store.get(rollModeKey("world-a", "user-1"))).toBe("selfroll");
    expect(store.has(LEGACY_ROLL_MODE_KEY)).toBe(false);
  });

  it("without a world or a user there is no owner: nothing is written", () => {
    saveRollMode("", "user-1", "gmroll");
    saveRollMode("world-a", "", "gmroll");
    expect(store.size).toBe(0);
  });

  it("survives localStorage being unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get(): never {
        throw new Error("storage disabled");
      },
    });
    expect(loadRollMode("world-a", "user-1")).toBe("public");
    expect(() => {
      saveRollMode("world-a", "user-1", "gmroll");
    }).not.toThrow();
  });
});
