/**
 * SettingsTab.test.ts — the index↔section panel of the footer tab (G100).
 *
 * Server-rendered snapshots via `svelte/server`'s `render()`: no client runtime is
 * attached, so clicks are not simulated here — the `SettingsNav` machine itself is
 * exhaustively tested in `lib/settings/__tests__/settingsNav.test.ts`. What this file
 * proves is that the component draws the RIGHT markup for a given nav state: the
 * index for `null`, and the section header + body once `nav` is pre-opened on one
 * (the same injectable-state pattern `TurnHead.test.ts` uses for `TurnHeadState`).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render } from "svelte/server";

import SettingsTab from "../SettingsTab.svelte";
import { SettingsNav, SETTINGS_SECTIONS } from "../../../lib/settings/settingsNav.svelte.js";
import {
  resetWorldSettingsRegistry,
  seedWorldSettingsRegistry,
} from "../../../lib/settings/worldSettingsRegistry.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

beforeEach(() => {
  resetWorldSettingsRegistry();
});

function renderTab(isGm: boolean, nav?: SettingsNav): string {
  const { body } = render(SettingsTab, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-1",
      isGm,
      activeSceneId: null,
      ...(nav ? { nav } : {}),
    },
  });
  return body;
}

describe("SettingsTab — the index (REQ-CFG-003..005)", () => {
  it("REQ-CFG-003: opening the tab shows the index with its own title", () => {
    const html = renderTab(true);
    expect(html).toContain(t("FUSION.Sidebar.Settings.Title"));
  });

  it("REQ-CFG-005: a non-privileged seat sees exactly one entry — Minhas preferências", () => {
    const html = renderTab(false);

    expect(html).toContain(t("FUSION.Settings.Sections.Preferences.Title"));
    expect(html).not.toContain(t("FUSION.Settings.Sections.World.Title"));
    expect(html).not.toContain(t("FUSION.Settings.Sections.Permissions.Title"));
    expect(html).not.toContain(t("FUSION.Settings.Sections.Users.Title"));
    expect(html).not.toContain(t("FUSION.Settings.Sections.Mods.Title"));
  });

  it("REQ-CFG-003: the Mestre sees all five sections", () => {
    const html = renderTab(true);

    for (const section of SETTINGS_SECTIONS) {
      expect(html).toContain(t(section.titleKey));
      expect(html).toContain(t(section.descriptionKey));
    }
  });

  it("REQ-CFG-004: index rows carry a title and a description, but no icon markup", () => {
    const html = renderTab(true);
    const indexMatch = /<ul class="settings-tab__index[^"]*">([\s\S]*?)<\/ul>/.exec(html);
    expect(indexMatch).not.toBeNull();
    expect(indexMatch?.[1]).not.toContain("<svg");
  });
});

describe("SettingsTab — drill-in (REQ-CFG-010..013)", () => {
  it("REQ-CFG-010: an open section replaces the index with its own content, in the same panel", () => {
    const nav = new SettingsNav();
    nav.open("world");
    const html = renderTab(true, nav);

    expect(html).toContain(t("FUSION.Settings.Sections.World.Title"));
    expect(html).not.toContain('class="settings-tab__index"');
  });

  it("REQ-CFG-011: the section header shows a voltar control and the section's name, and nothing else", () => {
    const nav = new SettingsNav();
    nav.open("permissions");
    const html = renderTab(true, nav);

    expect(html).toContain(t("FUSION.Settings.Nav.Back"));
    expect(html).toContain(t("FUSION.Settings.Sections.Permissions.Title"));
    // REQ-GAV-011/DEC-GAV-03: no ✕ and no other collapse control anywhere in the tab.
    expect(html).not.toMatch(/[✕✖×]/);
  });

  it("REQ-CFG-012: a session that starts at the index (no injected nav) shows the index, never a section — collapsing and reopening has nothing to carry over because the drawer mounts a fresh panel (REQ-GAV-017)", () => {
    const html = renderTab(true);
    expect(html).toContain("settings-tab__index");
  });

  it("REQ-CFG-013: no markup in this tab addresses the window manager — everything renders inside .settings-tab__body", () => {
    const nav = new SettingsNav();
    nav.open("mods");
    const html = renderTab(true, nav);

    expect(html).toContain("settings-tab__body");
    expect(html).not.toContain("window-host");
    expect(html).not.toContain("fusion-window");
  });
});

describe("SettingsTab — Minhas preferências (G101, REQ-CFG-020/021)", () => {
  it("opening 'preferences' renders the real section, not the pending placeholder", () => {
    const nav = new SettingsNav();
    nav.open("preferences");
    const html = renderTab(false, nav);

    expect(html).not.toContain(t("FUSION.Settings.SectionPending"));
    expect(html).toContain(t("FUSION.Settings.Preferences.VolumeTitle"));
    expect(html).toContain(t("FUSION.Settings.Preferences.NotificationsTitle"));
  });
});

describe("SettingsTab — Mundo (G102, REQ-CFG-030/031)", () => {
  it("opening 'world' renders the real section, not the pending placeholder", () => {
    // A FAKE system's declaration, never referenced anywhere in SettingsTab.svelte
    // or WorldSection.svelte by key — proving the tab renders it purely from the
    // schema (RNF-CFG-02), not from a hardcoded row.
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: null,
          key: "fake-system:neverSeenBeforeToggle",
          kind: "boolean",
          label: "Nunca visto antes",
          value: false,
        },
      ],
    });
    const nav = new SettingsNav();
    nav.open("world");
    const html = renderTab(true, nav);

    expect(html).not.toContain(t("FUSION.Settings.SectionPending"));
    expect(html).toContain("Nunca visto antes");
    expect(html).toContain('type="checkbox"');
  });

  it("REQ-CFG-030: a system with no declared world settings shows the honest empty state", () => {
    seedWorldSettingsRegistry({ systemId: "fake-system", settings: [] });
    const nav = new SettingsNav();
    nav.open("world");
    const html = renderTab(true, nav);

    expect(html).toContain(t("FUSION.Settings.World.Empty"));
  });
});
