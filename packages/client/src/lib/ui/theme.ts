/**
 * theme.ts — light or dark, the reader's choice (ui-fundacao, 22/10/2026).
 *
 * The tokens of both themes live in `styles/base.css`; this module only decides which one is
 * on, by writing `data-theme="dark" | "light"` on <html>. The choice is a per-browser
 * convenience (localStorage), never world state: one player may read on cream while the GM
 * keeps the table dark. Storage can be missing or throw (private window, blocked site data),
 * so every access is guarded and the app still renders — in the default, dark.
 */

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "fusion.theme";

const PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"];
const LIGHT_QUERY = "(prefers-color-scheme: light)";

interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

/** What the module touches — injectable so it is testable without a DOM. */
export interface ThemeEnv {
  readonly root: { dataset: Record<string, string | undefined> };
  readonly storage?: Storage | null;
  readonly matchMedia?: ((query: string) => MediaQueryLike) | null;
}

function browserEnv(): ThemeEnv | null {
  if (typeof document === "undefined") return null;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    root: document.documentElement,
    storage,
    matchMedia: typeof window.matchMedia === "function" ? (q) => window.matchMedia(q) : null,
  };
}

export function readThemePreference(storage: Storage | null | undefined): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.includes(raw as ThemePreference) ? (raw as ThemePreference) : "dark";
  } catch {
    return "dark";
  }
}

export function writeThemePreference(
  pref: ThemePreference,
  storage: Storage | null | undefined,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
}

export function resolveTheme(pref: ThemePreference, prefersLight: boolean): ResolvedTheme {
  if (pref === "system") return prefersLight ? "light" : "dark";
  return pref;
}

let stopFollowing: (() => void) | null = null;

/**
 * Turn a preference on: store it, paint <html>, and — for "system" — keep following the OS
 * until another preference is applied. Returns the function that stops following.
 */
export function applyTheme(pref: ThemePreference, env: ThemeEnv | null = browserEnv()): () => void {
  stopFollowing?.();
  stopFollowing = null;
  if (env === null) return () => undefined;
  writeThemePreference(pref, env.storage);
  const query = env.matchMedia?.(LIGHT_QUERY) ?? null;
  env.root.dataset["theme"] = resolveTheme(pref, query?.matches ?? false);
  if (pref !== "system" || query === null) return () => undefined;
  const onChange = (event: { matches: boolean }): void => {
    env.root.dataset["theme"] = resolveTheme("system", event.matches);
  };
  query.addEventListener("change", onChange);
  const stop = (): void => {
    query.removeEventListener("change", onChange);
    if (stopFollowing === stop) stopFollowing = null;
  };
  stopFollowing = stop;
  return stop;
}

/** At boot: apply whatever this browser chose last (dark when nothing). */
export function initTheme(env: ThemeEnv | null = browserEnv()): ThemePreference {
  const pref = readThemePreference(env?.storage);
  applyTheme(pref, env);
  return pref;
}
