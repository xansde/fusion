/**
 * sheetDisplayPrefsStore.test.ts — the live mirror a sheet reads the "i" toggle from.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  initSheetDisplayPrefs,
  resetSheetDisplayPrefsForTest,
  setSheetDisplayPref,
  sheetDisplayPrefs,
} from "../sheetDisplayPrefsStore.svelte.js";
import { loadClientPreferences } from "../clientPrefs.js";

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
  resetSheetDisplayPrefsForTest();
});

describe("sheetDisplayPrefs", () => {
  it("starts showing the icon", () => {
    expect(sheetDisplayPrefs.current.showBreakdownIcon).toBe(true);
  });

  it("a set updates the live value AND the saved one", () => {
    setSheetDisplayPref("w", "u", "showBreakdownIcon", false);
    expect(sheetDisplayPrefs.current.showBreakdownIcon).toBe(false);
    expect(loadClientPreferences("w", "u").sheetDisplay.showBreakdownIcon).toBe(false);
  });

  it("init loads the saved choice of this user", () => {
    setSheetDisplayPref("w", "u", "showBreakdownIcon", false);
    resetSheetDisplayPrefsForTest();
    initSheetDisplayPrefs("w", "u");
    expect(sheetDisplayPrefs.current.showBreakdownIcon).toBe(false);
    initSheetDisplayPrefs("w", "other");
    expect(sheetDisplayPrefs.current.showBreakdownIcon).toBe(true);
  });
});
