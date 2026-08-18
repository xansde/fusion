/**
 * PreferencesSection.test.ts — "Minhas preferências" content (G101).
 *
 * Server-rendered snapshots via `svelte/server`'s `render()`, same technique
 * `SettingsTab.test.ts` uses for the same reason: no client runtime is attached, so
 * this proves the RIGHT markup renders for saved/default state — the storage layer
 * itself (`lib/settings/clientPrefs.ts`) already carries the exhaustive behavioral
 * coverage, including the "never touches a socket" proof for RNF-CFG-01.
 *
 * Covers REQ-CFG-020, REQ-CFG-021, REQ-CFG-023, REQ-TOK-074 (TK080).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import PreferencesSection from "../PreferencesSection.svelte";
import { setNotificationPreference, setVolumeChannel } from "../../../lib/settings/clientPrefs.js";
import { setTokenDisplayPref } from "../../../lib/canvas/tokens/tokenDisplayPrefsStore.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

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

function renderSection(worldId: string, userId: string): string {
  const { body } = render(PreferencesSection, { props: { worldId, userId } });
  return body;
}

describe("PreferencesSection — REQ-CFG-020: the three audio channels", () => {
  it("shows a control for music, environment and interface, each at the saved percent", () => {
    setVolumeChannel("world-1", "user-1", "music", 0.75);
    setVolumeChannel("world-1", "user-1", "environment", 0.5);
    setVolumeChannel("world-1", "user-1", "interface", 0.25);

    const html = renderSection("world-1", "user-1");

    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Music", { percent: 75 }));
    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Environment", { percent: 50 }));
    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Interface", { percent: 25 }));
    expect(html).toMatch(/type="range"/);
  });

  it("defaults every channel to 100% for a seat that never saved anything", () => {
    const html = renderSection("world-1", "user-2");
    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Music", { percent: 100 }));
    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Environment", { percent: 100 }));
    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Interface", { percent: 100 }));
  });

  it("does not mix one user's saved volume into another user's render on the same device", () => {
    setVolumeChannel("world-1", "gm-1", "music", 0.1);
    const html = renderSection("world-1", "player-1");
    expect(html).toContain(t("FUSION.Settings.Preferences.Volume.Music", { percent: 100 }));
  });
});

describe("PreferencesSection — REQ-CFG-021: client notification preferences", () => {
  it("shows a checkbox for chat sound and one for turn alert, checked by default", () => {
    const html = renderSection("world-1", "user-1");

    expect(html).toContain(t("FUSION.Settings.Preferences.Notifications.ChatSound"));
    expect(html).toContain(t("FUSION.Settings.Preferences.Notifications.TurnAlert"));
    // Total checkbox count includes the two TK080 token-display toggles too
    // (see the describe block below) — the notifications section itself is
    // asserted by its two labels above and by the 4-checkbox count here.
    const checkboxCount = (html.match(/type="checkbox"/g) ?? []).length;
    expect(checkboxCount).toBe(4);
  });

  it("reflects a saved 'off' state instead of always showing the default", () => {
    setNotificationPreference("world-1", "user-1", "chatSound", false);
    const html = renderSection("world-1", "user-1");

    // Order on the page: chatSound, turnAlert, then TK080's showNames/showBars.
    const checkboxes = [...html.matchAll(/<input type="checkbox"([^>]*)>/g)];
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes[0]?.[1]).not.toMatch(/checked/);
    expect(checkboxes[1]?.[1]).toMatch(/checked/);
  });
});

// ---------------------------------------------------------------------------
// TK080 (spec 41-token.md REQ-TOK-074/075/076, DEC-TOK-11)
// ---------------------------------------------------------------------------

describe("PreferencesSection — REQ-TOK-074: token display preferences", () => {
  it("shows a checkbox for names and one for bars, both checked by default", () => {
    const html = renderSection("world-1", "user-1");

    expect(html).toContain(t("FUSION.Settings.Preferences.TokenDisplayTitle"));
    expect(html).toContain(t("FUSION.Settings.Preferences.TokenDisplay.ShowNames"));
    expect(html).toContain(t("FUSION.Settings.Preferences.TokenDisplay.ShowBars"));

    const checkboxes = [...html.matchAll(/<input type="checkbox"([^>]*)>/g)];
    expect(checkboxes).toHaveLength(4);
    // The last two checkboxes are showNames/showBars — both on by default.
    expect(checkboxes[2]?.[1]).toMatch(/checked/);
    expect(checkboxes[3]?.[1]).toMatch(/checked/);
  });

  it("reflects a saved 'off' state for showNames without disturbing showBars", () => {
    setTokenDisplayPref("world-1", "user-1", "showNames", false);
    const html = renderSection("world-1", "user-1");

    const checkboxes = [...html.matchAll(/<input type="checkbox"([^>]*)>/g)];
    expect(checkboxes[2]?.[1]).not.toMatch(/checked/);
    expect(checkboxes[3]?.[1]).toMatch(/checked/);
  });
});

describe("PreferencesSection — REQ-CFG-023: no locale or theme control", () => {
  it("renders no <select> and no idiom/theme labels", () => {
    const html = renderSection("world-1", "user-1");
    expect(html).not.toMatch(/<select/);
    expect(html.toLowerCase()).not.toMatch(/idioma|tema|locale|theme/);
  });
});
