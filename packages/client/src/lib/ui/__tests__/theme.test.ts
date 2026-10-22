import { describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ThemeEnv,
} from "../theme.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function throwingStorage(): Storage {
  const boom = (): never => {
    throw new Error("SecurityError");
  };
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom };
}

function fakeEnv(prefersLight: boolean, storage: Storage = memoryStorage()) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const query = {
    matches: prefersLight,
    addEventListener: (_: "change", fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: "change", fn: (e: { matches: boolean }) => void) =>
      listeners.delete(fn),
  };
  const root = { dataset: {} as Record<string, string> };
  const env: ThemeEnv = { root, storage, matchMedia: () => query };
  return {
    env,
    root,
    listeners,
    flip(to: boolean) {
      query.matches = to;
      for (const fn of listeners) fn({ matches: to });
    },
  };
}

describe("theme — the reader's choice of light or dark, kept per browser", () => {
  it("defaults to dark (maps are dark) when nothing was chosen", () => {
    expect(readThemePreference(memoryStorage())).toBe("dark");
  });

  it("reads back what was chosen and ignores garbage", () => {
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light");
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: "system" }))).toBe("system");
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("dark");
  });

  it("survives a browser that refuses storage (private window, blocked site data)", () => {
    expect(readThemePreference(throwingStorage())).toBe("dark");
    expect(() => writeThemePreference("light", throwingStorage())).not.toThrow();
  });

  it("system follows the operating system", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("applies the resolved theme on <html> and stores the preference", () => {
    const { env, root } = fakeEnv(false);
    applyTheme("light", env);
    expect(root.dataset["theme"]).toBe("light");
    expect(env.storage?.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("with system, keeps following the OS until another choice is applied", () => {
    const { env, root, listeners, flip } = fakeEnv(false);
    const stop = applyTheme("system", env);
    expect(root.dataset["theme"]).toBe("dark");
    flip(true);
    expect(root.dataset["theme"]).toBe("light");
    stop();
    expect(listeners.size).toBe(0);
  });

  it("a fixed choice does not listen to the OS", () => {
    const { env, listeners } = fakeEnv(true);
    const spy = vi.fn();
    applyTheme("dark", env);
    expect(listeners.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
