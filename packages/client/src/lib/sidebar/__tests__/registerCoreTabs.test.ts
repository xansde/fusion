/**
 * registerCoreTabs.test.ts — the core tabs enter through the public door (G016).
 *
 * The bridge this file guards: every panel the table already had (chat, actors,
 * combat, compendium, scenes) plus the settings placeholder is reachable through
 * `registerSidebarTab`, in the rail order of DEC-GAV-01, without the drawer knowing
 * any of their names.
 *
 * Covers REQ-GAV-030 (registration is the only door), REQ-GAV-003/REQ-GAV-004 (the
 * three blocks and what a player sees), REQ-GAV-020..023 (the badge each tab brings
 * and who may write it), RNF-GAV-02 (panels are loaders, never evaluated by the
 * rail), REQ-CEN-001 (the Cenas tab) and REQ-CFG-001 (the Configurações tab).
 *
 * Panels themselves are NOT loaded here: calling a loader would drag PIXI, the dice
 * box and the whole chat graph into a node test — and never calling them is exactly
 * what RNF-GAV-02 asks of the rail.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import {
  CORE_SIDEBAR_TAB_IDS,
  chatUnreadBadge,
  combatActiveBadge,
  registerCoreSidebarTabs,
} from "../registerCoreTabs.js";
import {
  clearSidebarTabs,
  getSidebarTab,
  getVisibleSidebarTabs,
  listVisibleSidebarTabs,
  registerSidebarTab,
  SETTINGS_TAB_ID,
} from "../registry.js";
import { formatSidebarBadge } from "../badges.svelte.js";
import { chatStore } from "../../chat/chatStore.svelte.js";
import SidebarRail from "../../../components/sidebar/SidebarRail.svelte";
import "../../i18n/index.js";

function idsOf(tabs: readonly { id: string }[]): string[] {
  return tabs.map((tab) => tab.id);
}

describe("the core tabs register through the public call (G016)", () => {
  beforeEach(() => {
    clearSidebarTabs();
    chatStore.unreadCount = 0;
    registerCoreSidebarTabs();
  });

  describe("REQ-GAV-030: one call per tab, nothing hard-wired in the drawer", () => {
    it("REQ-GAV-030: every panel of the table is in the registry after one bootstrap call", () => {
      expect(idsOf(listVisibleSidebarTabs(true))).toEqual([
        "chat",
        "actors",
        "combat",
        "compendium",
        "scenes",
        "settings",
      ]);
      expect(CORE_SIDEBAR_TAB_IDS).toEqual([
        "chat",
        "actors",
        "combat",
        "compendium",
        "scenes",
        "settings",
      ]);
    });

    it("REQ-GAV-030: every tab carries a drawn SVG icon and an i18n key, not a literal name", () => {
      for (const id of CORE_SIDEBAR_TAB_IDS) {
        const tab = getSidebarTab(id);
        expect(tab, `tab "${id}" is not registered`).toBeDefined();
        expect(tab!.icon).toContain("<svg");
        expect(tab!.label).toMatch(/^FUSION\./);
      }
    });

    it("REQ-GAV-033: bootstrapping twice leaves the registry untouched instead of throwing", () => {
      const before = listVisibleSidebarTabs(true);

      expect(() => {
        registerCoreSidebarTabs();
      }).not.toThrow();

      expect(idsOf(listVisibleSidebarTabs(true))).toEqual(idsOf(before));
      // The registry's own rule is untouched — the guard is in the bootstrap only.
      expect(() => {
        registerSidebarTab({ ...getSidebarTab("chat")! });
      }).toThrow(/already registered/);
    });
  });

  describe("REQ-GAV-003 / REQ-GAV-004: three blocks, and what a player is shown", () => {
    it("REQ-GAV-003: the GM rail is group all, then group gm, then Settings in the footer", () => {
      const visible = getVisibleSidebarTabs(true);

      expect(idsOf(visible.all)).toEqual(["chat", "actors", "combat", "compendium"]);
      expect(idsOf(visible.gm)).toEqual(["scenes"]);
      expect(idsOf(visible.footer)).toEqual([SETTINGS_TAB_ID]);
    });

    it("REQ-GAV-004: the player loses the gm block and keeps every other position", () => {
      const player = listVisibleSidebarTabs(false);
      const gm = listVisibleSidebarTabs(true);

      expect(idsOf(player)).toEqual(["chat", "actors", "combat", "compendium", "settings"]);
      for (const id of ["chat", "actors", "combat", "compendium"]) {
        expect(idsOf(player).indexOf(id)).toBe(idsOf(gm).indexOf(id));
      }
      expect(idsOf(player).at(-1)).toBe("settings");
    });

    it('REQ-CEN-001: Cenas is id "scenes", group gm, in the middle block', () => {
      const scenes = getSidebarTab("scenes");

      expect(scenes?.group).toBe("gm");
      expect(idsOf(getVisibleSidebarTabs(true).gm)).toContain("scenes");
      expect(idsOf(listVisibleSidebarTabs(false))).not.toContain("scenes");
    });

    it('REQ-CFG-001: Configurações is id "settings", group all, anchored to the footer', () => {
      const settings = getSidebarTab("settings");

      expect(settings?.group).toBe("all");
      expect(idsOf(getVisibleSidebarTabs(false).footer)).toEqual(["settings"]);
      expect(idsOf(getVisibleSidebarTabs(false).all)).not.toContain("settings");
    });
  });

  describe("RNF-GAV-02: a tab is a loader, and listing never runs it", () => {
    it("RNF-GAV-02: listing every tab for both roles evaluates no panel module", () => {
      // A loader that explodes if it is ever called, standing in for a heavy panel.
      registerSidebarTab({
        id: "exploding",
        icon: getSidebarTab("chat")!.icon,
        label: "FUSION.Sidebar.Tabs.Journal",
        group: "all",
        component: () => {
          throw new Error("the rail loaded a panel it should not have");
        },
      });

      expect(() => {
        listVisibleSidebarTabs(true);
        listVisibleSidebarTabs(false);
        render(SidebarRail, {
          props: { isGm: true, open: true, activeTabId: "chat", onSelect: () => {} },
        });
      }).not.toThrow();

      for (const id of CORE_SIDEBAR_TAB_IDS) {
        expect(typeof getSidebarTab(id)?.component).toBe("function");
      }
    });
  });

  describe("REQ-GAV-020..023: the badge each tab brings, and who writes it", () => {
    it("REQ-GAV-020: Chat brings a counter and Combate a state dot — never both on one tab", () => {
      chatStore.unreadCount = 3;

      expect(formatSidebarBadge(getSidebarTab("chat")?.badge?.value)).toEqual({
        kind: "counter",
        text: "3",
      });
      expect(formatSidebarBadge(combatActiveBadge.value).kind).toBe("none");
      expect(typeof chatUnreadBadge.value).toBe("number");
      expect(typeof combatActiveBadge.value).toBe("boolean");
    });

    it("REQ-GAV-021: the rail draws the counter in the corner of the icon", () => {
      chatStore.unreadCount = 2;

      const { body } = render(SidebarRail, {
        props: { isGm: true, open: true, activeTabId: "chat", onSelect: () => {} },
      });

      // Present even though Chat is the tab that is open right now.
      expect(body).toMatch(/data-badge-kind="counter"[^>]*>[\s\S]*?2/);
    });

    it("REQ-GAV-022: rendering the rail does not change any badge value", () => {
      chatStore.unreadCount = 5;

      for (const activeTabId of ["chat", "combat", null]) {
        render(SidebarRail, {
          props: { isGm: true, open: activeTabId !== null, activeTabId, onSelect: () => {} },
        });
      }

      expect(chatStore.unreadCount).toBe(5);
    });

    it("REQ-GAV-023: the value comes from the chat's own store, not from the rail", () => {
      chatStore.unreadCount = 7;
      expect(getSidebarTab("chat")?.badge?.value).toBe(7);

      chatStore.unreadCount = 0;
      expect(formatSidebarBadge(getSidebarTab("chat")?.badge?.value).kind).toBe("none");
    });

    it("REQ-GAV-020: tabs with no news carry no badge at all", () => {
      for (const id of ["actors", "compendium", "scenes", "settings"]) {
        expect(getSidebarTab(id)?.badge).toBeUndefined();
      }
    });
  });
});
