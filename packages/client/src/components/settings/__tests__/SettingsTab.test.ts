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
import {
  resetPermissionsRegistry,
  seedPermissionsRegistry,
} from "../../../lib/settings/permissionsRegistry.svelte.js";
import {
  resetUsersRegistry,
  seedUsersRegistry,
} from "../../../lib/settings/usersRegistry.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

beforeEach(() => {
  resetWorldSettingsRegistry();
  resetPermissionsRegistry();
  resetUsersRegistry();
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

  it("REQ-CFG-004: index rows carry a title, a description and an advance indicator, but no per-section icon", () => {
    const html = renderTab(true);
    const indexMatch = /<ul class="settings-tab__index[^"]*">([\s\S]*?)<\/ul>/.exec(html);
    expect(indexMatch).not.toBeNull();
    const indexHtml = indexMatch?.[1] ?? "";
    // No SVG pictograph identifying a section (the prohibitive half of the requirement).
    expect(indexHtml).not.toContain("<svg");
    // Every row still carries the advance indicator (the mandatory half): one
    // indicator per rendered row, none of them the section's own SVG icon.
    const rowCount = SETTINGS_SECTIONS.length;
    const indicatorMatches = indexHtml.match(/settings-tab__index-item-indicator/g) ?? [];
    expect(indicatorMatches).toHaveLength(rowCount);
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

describe("SettingsTab — Permissões (G104, REQ-USR-008/009, REQ-CFG-040..042)", () => {
  it("opening 'permissions' renders the real section, not the pending placeholder", () => {
    seedPermissionsRegistry({
      settingId: null,
      permissions: [{ key: "JOURNAL_CREATE", minRole: 2, defaultMinRole: 2 }],
    });
    const nav = new SettingsNav();
    nav.open("permissions");
    const html = renderTab(true, nav);

    expect(html).not.toContain(t("FUSION.Settings.SectionPending"));
    expect(html).toContain(t("FUSION.Settings.Permissions.Keys.JOURNAL_CREATE"));
  });

  it("REQ-CFG-040: one row per permission, never a matrix — no <table> anywhere in the section", () => {
    seedPermissionsRegistry({
      settingId: null,
      permissions: [
        { key: "JOURNAL_CREATE", minRole: 2, defaultMinRole: 2 },
        { key: "TOKEN_CREATE", minRole: 2, defaultMinRole: 2 },
      ],
    });
    const nav = new SettingsNav();
    nav.open("permissions");
    const html = renderTab(true, nav);

    expect(html).not.toContain("<table");
  });
});

describe("SettingsTab — Usuários (G105, REQ-CFG-050..054)", () => {
  it("opening 'users' renders the real section, not the pending placeholder", () => {
    seedUsersRegistry([
      { id: "u1", name: "Alice", role: 1, color: "#ff0000", avatar: null, active: true },
    ]);
    const nav = new SettingsNav();
    nav.open("users");
    const html = renderTab(true, nav);

    expect(html).not.toContain(t("FUSION.Settings.SectionPending"));
    expect(html).toContain("Alice");
    expect(html).toContain(t("FUSION.Settings.Users.Actions.Edit"));
  });
});

describe("SettingsTab — Mods (G106, REQ-CFG-060..064)", () => {
  it("REQ-CFG-060: opening 'mods' renders the real section, not the pending placeholder", () => {
    const nav = new SettingsNav();
    nav.open("mods");
    const html = renderTab(true, nav);

    expect(html).not.toContain(t("FUSION.Settings.SectionPending"));
    expect(html).toContain(t("FUSION.Settings.Mods.Empty"));
  });

  it("REQ-CFG-063: the install control is disabled with a legible reason", () => {
    const nav = new SettingsNav();
    nav.open("mods");
    const html = renderTab(true, nav);

    expect(html).toMatch(/<button[^>]*class="mods-section__install[^"]*"[^>]*disabled/);
    expect(html).toContain(t("FUSION.Settings.Mods.InstallDisabledReason"));
  });

  it("REQ-CFG-061: a player never sees the Mods entry in the index, nor its content when injected directly", () => {
    const indexHtml = renderTab(false);
    expect(indexHtml).not.toContain(t("FUSION.Settings.Sections.Mods.Title"));

    // Even if a nav were somehow forced open on "mods" for a non-privileged seat
    // (bypassing the index click), SettingsTab's own isGm guard keeps
    // ModsSection from mounting at all — "nem em leitura" holds structurally,
    // not just because the index button is unclickable.
    const nav = new SettingsNav();
    nav.open("mods");
    const forcedHtml = renderTab(false, nav);
    expect(forcedHtml).not.toContain(t("FUSION.Settings.Mods.Empty"));
    expect(forcedHtml).not.toContain(t("FUSION.Settings.Mods.InstallDisabledReason"));
  });
});

describe("SettingsTab — Mundo section markup", () => {
  it("REQ-CFG-032: a variant-rule-shaped row (requiresConfirmOnDisable) still renders through the same generic toggle — no separate markup for it", () => {
    // Shaped exactly like PF2e's freeArchetype/classLevels world settings
    // would arrive (REQ-CFG-032, REQ-MCL-001/004) — including the confirm
    // metadata (REQ-CFG-082) — but declared here by a fake system, never
    // pf2e, so this proves the render path carries zero PF2e knowledge
    // (REQ-CFG-031). Interactivity (the confirm dialog itself) is exercised
    // where it can be: worldSettingsSection.test.ts's needsDisableConfirm and
    // worldSettingsImpact.test.ts's wire contract — svelte/server's render()
    // never fires DOM events, so only the markup shape is asserted here.
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: "setting-fa-1",
          key: "fake-system:freeArchetype",
          kind: "boolean",
          label: "Arquétipo Livre",
          requiresConfirmOnDisable: true,
          value: true,
        },
      ],
    });
    const nav = new SettingsNav();
    nav.open("world");
    const html = renderTab(true, nav);

    expect(html).toContain("Arquétipo Livre");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain(t("FUSION.Settings.World.Empty"));
  });
});
