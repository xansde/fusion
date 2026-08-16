/**
 * SidebarDrawer.test.ts — the container half of the side drawer (spec 36, G012).
 *
 * Rendered with `render()` from `svelte/server`, like `SidebarRail.test.ts`: the client
 * project runs Vitest in a node environment, with no jsdom and no testing-library, so
 * markup is what a component test can look at. The gesture itself (open / switch /
 * collapse) is behaviour and lives in `lib/sidebar/drawerState.svelte.ts`, tested as a
 * module in `lib/sidebar/__tests__/drawerState.test.ts`.
 *
 * Two assertions here read the component's own source instead of its output — the ones
 * about CSS and about controls that must NOT exist. Svelte's server renderer emits no
 * `<style>` and no event handler, so "the drawer is an overlay of one fixed width" and
 * "there is no second way to collapse it" are simply not observable in the markup. They
 * are still the requirement, so they are checked where they are visible.
 *
 * Covers REQ-GAV-010, REQ-GAV-011, REQ-GAV-012, REQ-GAV-013, REQ-GAV-017 and RNF-GAV-01.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Sidebar from "../Sidebar.svelte";
import SidebarDrawer from "../SidebarDrawer.svelte";
import SettingsTab from "../../settings/SettingsTab.svelte";
import { sidebarIcons } from "../icons.js";
import { clearSidebarTabs, registerSidebarTab } from "../../../lib/sidebar/registry.js";
import { sidebarPreferencesKey } from "../../../lib/sidebar/preferences.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage mock — the drawer reads its starting state from it (REQ-GAV-014)
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "world-1";
const USER_ID = "user-1";

const CORE_TABS = [
  { id: "chat", label: "FUSION.Sidebar.Tabs.Chat", group: "all" as const },
  { id: "combat", label: "FUSION.Sidebar.Tabs.Combat", group: "all" as const },
  { id: "compendium", label: "FUSION.Sidebar.Tabs.Compendium", group: "all" as const },
  { id: "scenes", label: "FUSION.Sidebar.Tabs.Scenes", group: "gm" as const },
  { id: "settings", label: "FUSION.Sidebar.Tabs.Settings", group: "all" as const },
];

function registerCoreTabs(): void {
  for (const tab of CORE_TABS) {
    registerSidebarTab({
      id: tab.id,
      icon: sidebarIcons[tab.id] ?? sidebarIcons["chat"]!,
      label: tab.label,
      group: tab.group,
      // Never awaited during a server render: the panel only lands once the import
      // resolves, which is a client-side concern (RNF-GAV-02).
      component: () => Promise.resolve({ default: null }),
    });
  }
}

function seedPreferences(open: boolean, activeTab: string): void {
  localStorage.setItem(
    sidebarPreferencesKey(WORLD_ID, USER_ID),
    JSON.stringify({ open, activeTab }),
  );
}

function renderSidebar(isGm = true): string {
  const { body } = render(Sidebar, {
    props: {
      socket: {} as never,
      worldId: WORLD_ID,
      userId: USER_ID,
      isGm,
      activeSceneId: null,
    },
  });
  return body;
}

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose about the canvas is not mistaken for code. */
function codeOf(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The opening tag of the panel container, or null when it is not rendered.
 * Svelte appends its scoping class, hence the open-ended class match.
 */
function drawerTag(html: string): string | null {
  return /<div[^>]*class="sidebar-drawer[^"]*"[^>]*>/.exec(html)?.[0] ?? null;
}

// ---------------------------------------------------------------------------

describe("Sidebar / SidebarDrawer", () => {
  beforeEach(() => {
    localStorage.clear();
    clearSidebarTabs();
    registerCoreTabs();
  });

  describe("one width for every tab (REQ-GAV-012)", () => {
    it("REQ-GAV-012: the theme token is 300px of panel plus a 44px rail", () => {
      const css = readFileSync(
        fileURLToPath(new URL("../../../styles/base.css", import.meta.url)),
        "utf8",
      );

      expect(css).toMatch(/--fusion-sidebar-width:\s*300px/);
      expect(css).toMatch(/--fusion-sidebar-rail-width:\s*44px/);
    });

    it("REQ-GAV-012: switching tabs changes nothing about the drawer but which tab it names", () => {
      seedPreferences(true, "chat");
      const onChat = renderSidebar();
      localStorage.clear();
      seedPreferences(true, "compendium");
      const onCompendium = renderSidebar();

      const strip = (tag: string | null): string =>
        (tag ?? "").replace(/ data-active-tab="[^"]*"/, "");

      expect(drawerTag(onChat)).toContain('data-active-tab="chat"');
      expect(drawerTag(onCompendium)).toContain('data-active-tab="compendium"');
      // Same element, same classes, no per-tab sizing of any kind.
      expect(strip(drawerTag(onChat))).toBe(strip(drawerTag(onCompendium)));
      expect(onChat).not.toMatch(/style="[^"]*width/);
      expect(onCompendium).not.toMatch(/style="[^"]*width/);
    });

    it("REQ-GAV-012: the width comes from the token alone, and nothing resizes it", () => {
      const drawerCss = source("SidebarDrawer.svelte");

      // Every width declaration in the component reads the token.
      const widths = [
        ...drawerCss.matchAll(/^\s*(?:flex|width|min-width|max-width):\s*([^;]+);/gm),
      ];
      expect(widths.length).toBeGreaterThan(0);
      for (const [, value] of widths) {
        expect(value).toContain("var(--fusion-sidebar-width)");
      }
      // No resize affordance: neither CSS resize nor a drag handle.
      expect(drawerCss).not.toMatch(/\bresize\s*:/);
      expect(drawerCss.toLowerCase()).not.toContain("resizer");
    });
  });

  describe("one gesture, and no second control (REQ-GAV-010, REQ-GAV-011)", () => {
    it("REQ-GAV-010: the drawer opens on the tab the rail marks as active", () => {
      seedPreferences(true, "combat");
      const html = renderSidebar();

      expect(drawerTag(html)).toContain('data-active-tab="combat"');
      expect(html).toMatch(/<button[^>]*data-tab-id="combat"[^>]*aria-selected="true"/);
    });

    it("REQ-GAV-011: the only clickable controls in the sidebar are the rail's tabs", () => {
      seedPreferences(true, "chat");
      const html = renderSidebar();

      const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
      const railButtons = buttons.filter((tag) => tag.includes("data-tab-id="));
      // Five registered tabs for the GM, and not one control beyond them: no chevron
      // in the rail, no ✕ in the panel (DEC-GAV-03).
      expect(railButtons).toHaveLength(5);
      expect(buttons).toHaveLength(railButtons.length);
      expect(html).not.toMatch(/close|collapse|toggle/i);
    });

    it("REQ-GAV-011: no component of the drawer listens for Escape or any key", () => {
      for (const file of ["Sidebar.svelte", "SidebarDrawer.svelte", "SidebarRail.svelte"]) {
        const code = source(file);
        // `Esc` is the canvas' cancel gesture; the drawer must not steal it.
        expect(code, `${file} reacts to Escape`).not.toMatch(/["']Escape["']/);
        expect(code, `${file} installs a key handler`).not.toMatch(/onkey(down|up|press)/);
      }
    });
  });

  describe("an overlay, not a column of the shell (REQ-GAV-013, RNF-GAV-01)", () => {
    it("REQ-GAV-013: the sidebar is absolutely positioned under the header on the right edge", () => {
      const css = source("Sidebar.svelte");

      expect(css).toMatch(/\.fusion-sidebar\s*\{[^}]*position:\s*absolute/);
      expect(css).toMatch(/\.fusion-sidebar\s*\{[^}]*top:\s*var\(--fusion-header-height\)/);
      expect(css).toMatch(/\.fusion-sidebar\s*\{[^}]*right:\s*0/);
      expect(css).toMatch(/\.fusion-sidebar\s*\{[^}]*z-index:\s*\d+/);
    });

    it("RNF-GAV-01: opening or collapsing the drawer cannot touch the canvas", () => {
      // The drawer reserves no layout, so there is nothing to resize; and no file of
      // the drawer imports or calls the canvas, so it cannot ask for one either.
      const files = ["Sidebar.svelte", "SidebarDrawer.svelte", "SidebarRail.svelte"];
      for (const file of files) {
        const code = codeOf(file);
        expect(code, `${file} imports the canvas`).not.toMatch(/from\s+["'][^"']*(canvas|pixi)/i);
        expect(code, `${file} touches a canvas API`).not.toMatch(/\b(FusionCanvas|canvas)\./);
        expect(code, `${file} triggers a resize`).not.toMatch(
          /\bresize\(|dispatchEvent|["']resize["']/,
        );
      }
      // The state module behind the gesture is just as isolated.
      const state = readFileSync(
        fileURLToPath(new URL("../../../lib/sidebar/drawerState.svelte.ts", import.meta.url)),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(state).not.toMatch(/from\s+["'][^"']*(canvas|pixi)/i);
      expect(state).not.toMatch(/\bresize\(|dispatchEvent/);
    });

    it("REQ-GAV-013: the rail stays on screen and clickable with the drawer collapsed", () => {
      seedPreferences(false, "chat");
      const html = renderSidebar();

      expect(drawerTag(html)).toBeNull();
      expect([...html.matchAll(/data-tab-id="([^"]+)"/g)]).toHaveLength(5);
    });
  });

  describe("one mounted panel (REQ-GAV-017)", () => {
    it("REQ-GAV-017: exactly one panel container exists while open, and none while collapsed", () => {
      seedPreferences(true, "chat");
      const open = renderSidebar();
      expect([...open.matchAll(/class="sidebar-drawer[^"]*"/g)]).toHaveLength(1);
      expect([...open.matchAll(/role="tabpanel"/g)]).toHaveLength(1);

      localStorage.clear();
      seedPreferences(false, "chat");
      const collapsed = renderSidebar();
      expect(collapsed).not.toContain("sidebar-drawer");
      expect(collapsed).not.toContain('role="tabpanel"');
    });

    it("REQ-GAV-017: the resolved panel is really mounted inside the drawer, with its props", () => {
      // Every other case here hands the drawer `panel: null`, which renders an empty
      // container — so nothing proved that a resolved panel ever reaches the screen.
      // A real (cheap) panel is used, so the slot is exercised end to end.
      const { body } = render(SidebarDrawer, {
        props: {
          open: true,
          activeTabId: "settings",
          panel: SettingsTab,
          panelProps: {
            socket: {} as never,
            worldId: WORLD_ID,
            userId: USER_ID,
            isGm: true,
            activeSceneId: null,
          },
        },
      });

      const drawer = /<div[^>]*class="sidebar-drawer[^"]*"[^>]*>([\s\S]*)<\/div>/.exec(body)?.[1];
      expect(drawer).toContain("settings-tab");

      // And the collapsed drawer mounts it not at all (REQ-GAV-017).
      const { body: collapsed } = render(SidebarDrawer, {
        props: {
          open: false,
          activeTabId: "settings",
          panel: SettingsTab,
          panelProps: {
            socket: {} as never,
            worldId: WORLD_ID,
            userId: USER_ID,
            isGm: true,
            activeSceneId: null,
          },
        },
      });
      expect(collapsed).not.toContain("settings-tab");
    });

    it("REQ-GAV-017: the panel is rendered by the drawer, not kept alive beside it", () => {
      // A single dynamic slot in the template — no per-tab branch that could leave a
      // second panel mounted behind the active one.
      const drawerSource = source("SidebarDrawer.svelte");
      expect([...drawerSource.matchAll(/<Panel\b/g)]).toHaveLength(1);
      expect(drawerSource).not.toMatch(/\{#if\s+activeTabId\s*===/);
    });
  });
});
