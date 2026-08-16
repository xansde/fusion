/**
 * SidebarResponsive.test.ts — narrow viewport and keyboard (spec 36 §5.5, G015).
 *
 * Covers REQ-GAV-040 (below 900px the open drawer takes everything left of the rail,
 * the rail keeps its 44px and its one gesture) and REQ-GAV-041 (the rail is operable by
 * the generic keyboard navigation, with visible focus and no global tab shortcut).
 *
 * The client project runs Vitest in a node environment — no jsdom, no testing-library —
 * so there is no viewport to resize and no `:focus-visible` to trigger. Both halves of
 * this task are, by design, declarative: the narrow layout is a media query and the
 * keyboard support is the native semantics of `<button>`. The assertions therefore look
 * at the two places where those are observable: the rendered markup (which must be the
 * SAME markup at any width — that is itself the requirement, since no FAB or swipe
 * replaces the gesture) and the component's own stylesheet.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Sidebar from "../Sidebar.svelte";
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

/** Source with every comment removed, so prose is never mistaken for a declaration. */
function codeOf(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every `@media (...) { ... }` block of a component, balanced by brace counting. */
function mediaBlocks(file: string): { condition: string; body: string }[] {
  const css = codeOf(file);
  const blocks: { condition: string; body: string }[] = [];
  const opener = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css)) !== null) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({
      condition: (match[1] ?? "").trim(),
      body: css.slice(opener.lastIndex, index - 1),
    });
    opener.lastIndex = index;
  }
  return blocks;
}

const SIDEBAR_FILES = ["Sidebar.svelte", "SidebarDrawer.svelte", "SidebarRail.svelte"];

// ---------------------------------------------------------------------------

describe("sidebar on a narrow screen and from the keyboard", () => {
  beforeEach(() => {
    localStorage.clear();
    clearSidebarTabs();
    registerCoreTabs();
  });

  describe("narrow viewport (REQ-GAV-040)", () => {
    it("REQ-GAV-040: the narrow rule fires below 900px, and it is the only breakpoint", () => {
      const blocks = mediaBlocks("Sidebar.svelte");
      expect(blocks).toHaveLength(1);

      const threshold = /max-width:\s*([\d.]+)px/.exec(blocks[0]!.condition)?.[1];
      expect(threshold, `unexpected media condition: ${blocks[0]!.condition}`).toBeDefined();
      // "below 900px": the last width that still gets the narrow layout is just under it.
      expect(Number(threshold)).toBeGreaterThanOrEqual(899);
      expect(Number(threshold)).toBeLessThan(900);

      // The panel itself has no breakpoint of its own — one place decides the layout.
      expect(mediaBlocks("SidebarDrawer.svelte")).toHaveLength(0);
    });

    it("REQ-GAV-040: below the threshold the open drawer spans everything left of the rail", () => {
      const [narrow] = mediaBlocks("Sidebar.svelte");
      expect(narrow).toBeDefined();

      // The overlay stops hugging the right edge and reaches the left one...
      expect(narrow!.body).toMatch(/\.fusion-sidebar--open\b[^{]*\{[^}]*left:\s*0/);
      // ...and the panel's width becomes everything the rail does not take. It is still
      // read from the same token by the drawer (REQ-GAV-012): the narrow layout retunes
      // the token for this subtree instead of overriding the panel's own rules.
      expect(narrow!.body).toMatch(
        /--fusion-sidebar-width:\s*calc\(\s*100%\s*-\s*var\(--fusion-sidebar-rail-width/,
      );
      expect(narrow!.body).not.toContain(".sidebar-drawer");

      // Collapsed, nothing changes: the canvas keeps the whole screen but the rail.
      expect(narrow!.body).not.toMatch(/\.fusion-sidebar\s*\{[^}]*left:/);
    });

    it("REQ-GAV-040: the rail keeps 44px and its single gesture at any width", () => {
      // No breakpoint at all in the rail, and its width is the 44px token.
      expect(mediaBlocks("SidebarRail.svelte")).toHaveLength(0);
      expect(codeOf("SidebarRail.svelte")).toMatch(
        /width:\s*var\(--fusion-sidebar-rail-width,\s*44px\)/,
      );

      // And the narrow rule does not touch the rail or its token.
      const [narrow] = mediaBlocks("Sidebar.svelte");
      expect(narrow!.body).not.toContain(".sidebar-rail");
      expect(narrow!.body).not.toMatch(/--fusion-sidebar-rail-width:/);
    });

    it("REQ-GAV-040: no FAB and no swipe stands in for the gesture on a narrow screen", () => {
      // A narrow screen is served by the SAME markup: no width is read in script, so
      // there is no second, touch-only way in or out of the drawer (it replaces the
      // FAB/swipe of REQ-UIF-062 for the drawer).
      for (const file of SIDEBAR_FILES) {
        const code = codeOf(file);
        expect(code, `${file} branches on the viewport`).not.toMatch(
          /innerWidth|matchMedia|ResizeObserver/,
        );
        expect(code, `${file} listens for a drag gesture`).not.toMatch(
          /ontouch|onpointer|swipe|drag/i,
        );
      }

      seedPreferences(true, "chat");
      const html = renderSidebar();
      const buttons = [...html.matchAll(/<button[^>]*>/g)].map((tag) => tag[0]);
      expect(buttons).toHaveLength(CORE_TABS.length);
      for (const tag of buttons) {
        expect(tag).toContain("data-tab-id=");
      }
      expect(html.toLowerCase()).not.toContain("fab");
    });
  });

  describe("keyboard (REQ-GAV-041)", () => {
    it("REQ-GAV-041: every rail tab is a native button, so Tab/Enter/Space just work", () => {
      seedPreferences(true, "chat");
      const html = renderSidebar();

      const buttons = [...html.matchAll(/<button[^>]*>/g)].map((tag) => tag[0]);
      expect(buttons).toHaveLength(CORE_TABS.length);
      for (const tag of buttons) {
        expect(tag).toMatch(/type="button"/);
        // No roving tabindex: every tab stays in the natural focus order (REQ-UIF-064).
        expect(tag).not.toMatch(/tabindex=/);
      }
    });

    it("REQ-GAV-041: the focused tab is visible", () => {
      expect(codeOf("SidebarRail.svelte")).toMatch(
        /\.sidebar-rail__button:focus-visible\s*\{[^}]*outline:\s*(?!none)/,
      );
    });

    it("REQ-GAV-041: no global shortcut opens a tab in the MVP", () => {
      const files = [
        ...SIDEBAR_FILES.map((file) => codeOf(file)),
        readFileSync(
          fileURLToPath(new URL("../../../lib/sidebar/drawerState.svelte.ts", import.meta.url)),
          "utf8",
        ).replace(/\/\*[\s\S]*?\*\//g, ""),
      ];
      for (const code of files) {
        expect(code).not.toMatch(/addEventListener\(\s*["']key/);
        expect(code).not.toMatch(/onkey(down|up|press)/);
        expect(code).not.toMatch(/accesskey/i);
      }
    });
  });
});
