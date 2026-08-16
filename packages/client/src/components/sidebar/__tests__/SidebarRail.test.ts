/**
 * SidebarRail.test.ts — the icon-only rail of the side drawer (spec 36 §5.1).
 *
 * Rendered with `render()` from `svelte/server`: the client project runs Vitest in a
 * node environment with no jsdom and no testing-library, so the assertions are made
 * on the server-rendered markup. That is enough for everything this task owns —
 * order of the three blocks, absence of textual labels, absence of emoji — because
 * all of it is structural. Click behaviour (open/switch/collapse) belongs to the
 * drawer (G012) and is tested as a module there.
 *
 * Covers REQ-GAV-001, REQ-GAV-002, REQ-GAV-003, REQ-GAV-004, REQ-GAV-005 and
 * REQ-NPC-094.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import SidebarRail from "../SidebarRail.svelte";
import { sidebarIcons } from "../icons.js";
import { clearSidebarTabs, registerSidebarTab } from "../../../lib/sidebar/registry.js";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real
// labels instead of raw keys — which is what makes the "no visible text" and
// "the name is only in aria-label/tooltip" assertions meaningful.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A panel loader that is never called: drawing the rail must not load panels. */
const neverLoaded = (): Promise<{ default: unknown }> => {
  throw new Error("the rail must never load a panel component");
};

/** The seven core tabs in the order of DEC-GAV-01. */
const CORE_TABS = [
  { id: "chat", label: "FUSION.Sidebar.Tabs.Chat", group: "all" as const },
  { id: "contacts", label: "FUSION.Sidebar.Tabs.Actors", group: "all" as const },
  { id: "combat", label: "FUSION.Sidebar.Tabs.Combat", group: "all" as const },
  { id: "compendium", label: "FUSION.Sidebar.Tabs.Compendium", group: "all" as const },
  { id: "npcs", label: "FUSION.Sidebar.Tabs.Actors", group: "gm" as const },
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
      component: neverLoaded,
    });
  }
}

interface RailProps {
  isGm: boolean;
  open?: boolean;
  activeTabId?: string | null;
}

function renderRail(props: RailProps): string {
  const { body } = render(SidebarRail, {
    props: {
      isGm: props.isGm,
      open: props.open ?? true,
      activeTabId: props.activeTabId ?? null,
      onSelect: () => {
        /* the rail only reports the click; the drawer decides (G012) */
      },
    },
  });
  return body;
}

// ---------------------------------------------------------------------------
// Markup helpers (no DOM available — plain string surgery on the SSR output)
// ---------------------------------------------------------------------------

/** Ids of the rail buttons, top to bottom. */
function tabOrder(html: string): string[] {
  return [...html.matchAll(/data-tab-id="([^"]+)"/g)].map((m) => m[1]!);
}

/** The whole `<button>` element of one tab. */
function buttonOf(html: string, id: string): string {
  const match = new RegExp(`<button[^>]*data-tab-id="${id}"[\\s\\S]*?</button>`).exec(html);
  expect(match, `no rail button for tab "${id}"`).not.toBeNull();
  return match![0];
}

/**
 * Text that a sighted user reads in the rail, i.e. everything left after removing
 * the drawn tooltips (the only text REQ-GAV-002 allows), the badge in the corner of
 * the icon (a count, not a label — REQ-GAV-021), SSR comments and every tag — which
 * also drops `aria-label`, since attributes live inside tags.
 */
function visibleTextOutsideTooltips(html: string): string {
  return html
    .replace(/<span[^>]*class="[^"]*rail__tooltip[^"]*"[^>]*>[\s\S]*?<\/span\s*>/g, "")
    .replace(/<span[^>]*class="[^"]*sidebar-badge[^"]*"[^>]*>[\s\S]*?<\/span\s*>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Emoji and symbol characters that must never appear in the rail (REQ-NPC-094).
 * The range deliberately covers the three glyphs the pre-drawer sidebar used —
 * U+276F (❯), U+2630 (☰) and U+2694 (⚔) — plus the emoji planes and the
 * variation selector that turns a symbol into an emoji.
 */
const PICTOGRAPH_OR_SYMBOL =
  /[\u{2190}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1FAFF}]|\p{Extended_Pictographic}/u;

// ---------------------------------------------------------------------------

describe("SidebarRail", () => {
  beforeEach(() => {
    clearSidebarTabs();
    registerCoreTabs();
  });

  describe("three blocks, in the order of DEC-GAV-01 (REQ-GAV-003)", () => {
    it("REQ-GAV-003: the GM sees group all, then group gm, then Settings in the footer", () => {
      const html = renderRail({ isGm: true });

      expect(tabOrder(html)).toEqual([
        "chat",
        "contacts",
        "combat",
        "compendium",
        "npcs",
        "scenes",
        "settings",
      ]);
    });

    it("REQ-GAV-004: the player sees no gm tab, and every other tab keeps its position", () => {
      const playerHtml = renderRail({ isGm: false });
      const gmHtml = renderRail({ isGm: true });

      const playerOrder = tabOrder(playerHtml);
      expect(playerOrder).toEqual(["chat", "contacts", "combat", "compendium", "settings"]);
      expect(playerHtml).not.toContain('data-tab-id="npcs"');
      expect(playerHtml).not.toContain('data-tab-id="scenes"');

      // REQ-GAV-004: the shared tabs sit at the same index for both roles, so the
      // muscle memory of one seat matches the other. Only the footer tab, which is
      // pushed to the bottom by the layout, changes index — and it is last in both.
      const gmOrder = tabOrder(gmHtml);
      for (const id of ["chat", "contacts", "combat", "compendium"]) {
        expect(playerOrder.indexOf(id)).toBe(gmOrder.indexOf(id));
      }
      expect(playerOrder.at(-1)).toBe("settings");
      expect(gmOrder.at(-1)).toBe("settings");
    });

    it("REQ-GAV-003: a tab registered later enters at the end of its group, never in the footer", () => {
      registerSidebarTab({
        id: "mod-notes",
        icon: sidebarIcons["chat"]!,
        label: "FUSION.Sidebar.Tabs.Journal",
        group: "all",
        component: neverLoaded,
      });

      const order = tabOrder(renderRail({ isGm: true }));

      expect(order.indexOf("mod-notes")).toBeGreaterThan(order.indexOf("compendium"));
      expect(order.indexOf("mod-notes")).toBeLessThan(order.indexOf("settings"));
      expect(order.at(-1)).toBe("settings");
    });

    it("REQ-GAV-003: the gm block is a separate group, absent from the player's rail", () => {
      expect(renderRail({ isGm: true })).toContain('data-rail-group="gm"');
      expect(renderRail({ isGm: false })).not.toContain('data-rail-group="gm"');
    });
  });

  describe("icon-only, with the tab name reachable (REQ-GAV-001, REQ-GAV-002)", () => {
    it("REQ-GAV-001: renders no textual label — every text node outside the tooltip is empty", () => {
      expect(visibleTextOutsideTooltips(renderRail({ isGm: true }))).toBe("");
      expect(visibleTextOutsideTooltips(renderRail({ isGm: false }))).toBe("");
    });

    it("REQ-GAV-001: every button carries a drawn SVG icon and no character glyph", () => {
      const html = renderRail({ isGm: true });

      for (const id of tabOrder(html)) {
        const button = buttonOf(html, id);
        expect(button).toContain("<svg");
        // Nothing between the tags but the tooltip: no character used as an icon.
        expect(visibleTextOutsideTooltips(button)).toBe("");
      }
    });

    it("REQ-GAV-002: the tab name is exposed by aria-label and by a drawn tooltip", () => {
      const html = renderRail({ isGm: true });

      for (const tab of CORE_TABS) {
        const name = t(tab.label);
        expect(name).not.toBe(tab.label); // the bundle really resolved
        const button = buttonOf(html, tab.id);
        expect(button).toContain(`aria-label="${name}"`);
        expect(button).toMatch(new RegExp(`class="[^"]*rail__tooltip[^"]*"[^>]*>${name}<`));
      }
    });

    it("REQ-GAV-002: the tooltip is the only place the name appears as text", () => {
      const html = renderRail({ isGm: true });
      const withoutTooltips = html.replace(
        /<span[^>]*class="[^"]*rail__tooltip[^"]*"[^>]*>[\s\S]*?<\/span>/g,
        "",
      );
      // Attributes still hold it (aria-label), body text no longer does.
      const bodyText = withoutTooltips.replace(/<[^>]*>/g, "");
      for (const tab of CORE_TABS) {
        expect(bodyText).not.toContain(t(tab.label));
      }
    });
  });

  describe("no emoji anywhere (REQ-NPC-094)", () => {
    it("REQ-NPC-094: the rendered rail contains no emoji or symbol character, for either role", () => {
      for (const isGm of [true, false]) {
        const html = renderRail({ isGm });
        const offender = PICTOGRAPH_OR_SYMBOL.exec(html);
        expect(
          offender,
          `rail markup contains the pictograph ${JSON.stringify(offender?.[0])}`,
        ).toBeNull();
      }
    });

    it("REQ-NPC-094: the guard would catch the glyphs the old sidebar used", () => {
      // Sanity check of the regex itself, so the assertion above cannot pass vacuously.
      for (const glyph of ["❯", "☰", "⚔"]) {
        expect(PICTOGRAPH_OR_SYMBOL.test(glyph)).toBe(true);
      }
    });
  });

  describe("the active tab, only while the drawer is open (REQ-GAV-005)", () => {
    it("REQ-GAV-005: the open drawer's tab is marked active and joined to the panel", () => {
      const html = renderRail({ isGm: true, open: true, activeTabId: "combat" });

      expect(buttonOf(html, "combat")).toContain('aria-selected="true"');
      expect(buttonOf(html, "combat")).toMatch(/class="[^"]*rail__button--active/);
      expect(buttonOf(html, "chat")).toContain('aria-selected="false"');
      expect(buttonOf(html, "chat")).not.toMatch(/class="[^"]*rail__button--active/);
    });

    it("REQ-GAV-005: with the drawer collapsed no tab is shown as active", () => {
      const html = renderRail({ isGm: true, open: false, activeTabId: "combat" });

      expect(html).not.toContain("rail__button--active");
      expect(html).not.toContain('aria-selected="true"');
      // The rail itself stays on screen and clickable while collapsed (REQ-GAV-013).
      expect(tabOrder(html)).toHaveLength(7);
    });
  });
});
