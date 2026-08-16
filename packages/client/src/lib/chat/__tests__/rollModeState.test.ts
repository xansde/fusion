/**
 * rollModeState.test.ts — the selector's value is one value, readable from anywhere.
 *
 * REQ-ACH-042 (spec 38 §5.5): the chosen mode applies to EVERY roll this user starts —
 * the chat box, the favorites row, the roll builder, a sheet button, a card button. Those
 * origins live far from the chat panel, and the panel unmounts on every drawer tab switch
 * (REQ-GAV-017), so the value cannot be component state. This store is where it lives.
 *
 * Covers REQ-ACH-041 and REQ-ACH-042.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  currentRollMode,
  initRollMode,
  rollModeState,
  setRollMode,
} from "../rollModeState.svelte.js";
import { buildChatSendPayload } from "../resolveRollMode.js";
import { rollModeKey } from "../rollModePreference.js";

let store: Map<string, string>;

beforeEach(() => {
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
  initRollMode("world-a", "user-1");
});

describe("rollModeState — um valor, lido de qualquer origem (REQ-ACH-042)", () => {
  it("starts on public and restores what this user saved in this world (REQ-ACH-041)", () => {
    expect(currentRollMode()).toBe("public");

    store.set(rollModeKey("world-a", "user-1"), "gmroll");
    expect(initRollMode("world-a", "user-1")).toBe("gmroll");
    expect(rollModeState.mode).toBe("gmroll");
  });

  it("a choice made in the chat box is what a sheet or card roll will use", () => {
    setRollMode("world-a", "user-1", "blindroll");

    // Any other origin builds its payload from the same value — no second copy of the
    // rule and no way for two origins to disagree about the audience.
    const fromSheet = buildChatSendPayload({
      content: "/roll 1d20+7",
      worldId: "world-a",
      selectorMode: currentRollMode(),
    });
    expect(fromSheet.rollMode).toBe("blindroll");
  });

  it("persists the choice, so reopening the world restores it (REQ-ACH-041)", () => {
    setRollMode("world-a", "user-1", "selfroll");
    expect(store.get(rollModeKey("world-a", "user-1"))).toBe("selfroll");

    initRollMode("world-a", "user-1");
    expect(currentRollMode()).toBe("selfroll");
  });

  it("switching to another user on the same device does not carry the mode over", () => {
    setRollMode("world-a", "gm-1", "blindroll");
    expect(initRollMode("world-a", "player-1")).toBe("public");
  });
});
