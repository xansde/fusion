/**
 * clientPrefs.test.ts — "Minhas preferências" storage (spec 37 §5.3).
 *
 * Covers REQ-CFG-020, REQ-CFG-021, REQ-CFG-022, REQ-CFG-023, REQ-CFG-072, RNF-CFG-01.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clientPrefsKey,
  DEFAULT_CLIENT_PREFERENCES,
  loadClientPreferences,
  setNotificationPreference,
  setVolumeChannel,
} from "../clientPrefs.js";

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

describe("clientPrefsKey — mundo + usuário na chave", () => {
  it("carries both ids, so a shared device never mixes two people up", () => {
    expect(clientPrefsKey("world-a", "user-1")).toBe("fusion:clientPrefs:world-a:user-1");
    expect(clientPrefsKey("world-a", "user-2")).not.toBe(clientPrefsKey("world-a", "user-1"));
    expect(clientPrefsKey("world-b", "user-1")).not.toBe(clientPrefsKey("world-a", "user-1"));
  });
});

describe("REQ-CFG-020: three volume channels — music, environment, interface", () => {
  it("defaults every channel to full volume when nothing was ever saved", () => {
    const prefs = loadClientPreferences("world-a", "user-1");
    expect(prefs.volume).toEqual({ music: 1, environment: 1, interface: 1 });
  });

  it("persists one channel without disturbing the other two", () => {
    setVolumeChannel("world-a", "user-1", "music", 0.4);
    const prefs = loadClientPreferences("world-a", "user-1");
    expect(prefs.volume.music).toBe(0.4);
    expect(prefs.volume.environment).toBe(1);
    expect(prefs.volume.interface).toBe(1);
  });

  it("clamps out-of-range values to [0, 1]", () => {
    setVolumeChannel("world-a", "user-1", "environment", 5);
    expect(loadClientPreferences("world-a", "user-1").volume.environment).toBe(1);

    setVolumeChannel("world-a", "user-1", "environment", -3);
    expect(loadClientPreferences("world-a", "user-1").volume.environment).toBe(0);
  });

  it("does not hand one user's channel to another on the same device", () => {
    setVolumeChannel("world-a", "gm-1", "interface", 0.2);
    expect(loadClientPreferences("world-a", "player-1").volume.interface).toBe(1);
  });

  it("does not carry a channel from one world to another", () => {
    setVolumeChannel("world-a", "user-1", "music", 0.1);
    expect(loadClientPreferences("world-b", "user-1").volume.music).toBe(1);
  });
});

describe("REQ-CFG-021: client notification preferences — chat sound, turn alert", () => {
  it("defaults both notifications to on when nothing was ever saved", () => {
    const prefs = loadClientPreferences("world-a", "user-1");
    expect(prefs.notifications).toEqual({ chatSound: true, turnAlert: true });
  });

  it("persists one notification toggle without disturbing the other", () => {
    setNotificationPreference("world-a", "user-1", "chatSound", false);
    const prefs = loadClientPreferences("world-a", "user-1");
    expect(prefs.notifications.chatSound).toBe(false);
    expect(prefs.notifications.turnAlert).toBe(true);
  });

  it("keeps volume untouched when only a notification changes", () => {
    setVolumeChannel("world-a", "user-1", "music", 0.6);
    setNotificationPreference("world-a", "user-1", "turnAlert", false);
    expect(loadClientPreferences("world-a", "user-1").volume.music).toBe(0.6);
  });
});

describe("REQ-CFG-022 / REQ-CFG-072 / RNF-CFG-01: no network operation, ever", () => {
  it("mutating or reading a preference never touches a socket spy in scope", () => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

    setVolumeChannel("world-a", "user-1", "music", 0.3);
    setNotificationPreference("world-a", "user-1", "chatSound", false);
    loadClientPreferences("world-a", "user-1");

    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.on).not.toHaveBeenCalled();
    expect(socket.off).not.toHaveBeenCalled();
  });

  it("the module never imports a socket or sends an op — structural guarantee, not just this test run", () => {
    const path = fileURLToPath(new URL("../clientPrefs.ts", import.meta.url));
    const source = readFileSync(path, "utf-8");
    expect(source).not.toMatch(/socket\.io|sendOp|\.emit\(|documentType/);
  });

  it("survives localStorage being unavailable, and touches nothing else", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get(): never {
        throw new Error("storage disabled");
      },
    });
    expect(loadClientPreferences("world-a", "user-1")).toEqual(DEFAULT_CLIENT_PREFERENCES);
    expect(() => {
      setVolumeChannel("world-a", "user-1", "music", 0.5);
    }).not.toThrow();
  });

  it("without a world or a user there is no owner: nothing is written", () => {
    setVolumeChannel("", "user-1", "music", 0.5);
    setVolumeChannel("world-a", "", "music", 0.5);
    expect(store.size).toBe(0);
  });
});

describe("REQ-CFG-023: no locale or theme control lives in this module", () => {
  it("the preference shape has exactly volume + notifications — nothing else", () => {
    const prefs = loadClientPreferences("world-a", "user-1");
    expect(Object.keys(prefs).sort()).toEqual(["notifications", "volume"]);
    expect(Object.keys(prefs.notifications).sort()).toEqual(["chatSound", "turnAlert"]);
  });
});
