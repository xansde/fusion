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
 * The rail never evaluates a loader (RNF-GAV-02), and that is asserted with a loader
 * that explodes when called. The bridge itself, though, is only real if each id opens
 * the panel it promises — so ONE block here does resolve every loader and checks the
 * component that comes back against the panel named by hand in the test. Without it,
 * pointing `chat` at another panel keeps the whole suite green.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import {
  CORE_SIDEBAR_TAB_IDS,
  chatUnreadBadge,
  combatActiveBadge,
  contactsKnowledgeBadge,
  registerCoreSidebarTabs,
} from "../registerCoreTabs.js";
import { contactsStateDot } from "../../contacts/knowledgeBadge.js";
import {
  clearSidebarTabs,
  getSidebarTab,
  getVisibleSidebarTabs,
  listVisibleSidebarTabs,
  loadSidebarPanel,
  registerSidebarTab,
  SETTINGS_TAB_ID,
} from "../registry.js";
import type { SidebarPanelModule } from "../registry.js";
import { formatSidebarBadge } from "../badges.svelte.js";
import { chatStore } from "../../chat/chatStore.svelte.js";
import {
  compendiumImportBadge,
  finishCompendiumBatchImport,
  resetCompendiumImportActivity,
  startCompendiumBatchImport,
} from "../../compendium/importActivity.js";
import { scenePrepareBadge, scenePrepareState } from "../../scenes/prepareState.svelte.js";
import { activeSceneState } from "../../docs/activeScene.svelte.js";
import SidebarRail from "../../../components/sidebar/SidebarRail.svelte";
import "../../i18n/index.js";

function idsOf(tabs: readonly { id: string }[]): string[] {
  return tabs.map((tab) => tab.id);
}

function renderRail(activeTabId: string | null = "chat"): string {
  return render(SidebarRail, {
    props: { isGm: true, open: true, activeTabId, onSelect: () => {} },
  }).body;
}

/**
 * The text the counter badge of the Chat button actually draws.
 *
 * Both regexes are *delimited* on purpose. An open-ended search for the number
 * (`data-badge-kind="counter"[^>]*>[\s\S]*?2`) walks past the badge into the next
 * button, where every drawn icon carries `viewBox="0 0 24 24"` — so it matched a
 * digit from an SVG and passed with any badge text at all. Anchoring on the
 * badge's own `</span>`, inside the Chat button's own `</button>`, is what makes
 * a wrong number fail.
 */
function drawnCounterOfChatButton(body: string): string | null {
  const button = /<button[^>]*data-tab-id="chat"[\s\S]*?<\/button>/.exec(body);
  if (!button) return null;
  const badge = /<span[^>]*data-badge-kind="counter"[^>]*>([^<]*)<\/span>/.exec(button[0]);
  return badge ? badge[1]! : null;
}

describe("the core tabs register through the public call (G016)", () => {
  beforeEach(() => {
    clearSidebarTabs();
    chatStore.unreadCount = 0;
    resetCompendiumImportActivity();
    contactsStateDot.clear();
    // Four tabs now own a badge (Chat, Contatos, Compêndio, Cenas) plus Combate's dot; a
    // test that counts drawn dots only means something if every other store starts put out.
    scenePrepareState.sceneId = null;
    activeSceneState.id = null;
    registerCoreSidebarTabs();
  });

  describe("REQ-GAV-030: one call per tab, nothing hard-wired in the drawer", () => {
    it("REQ-GAV-030: every panel of the table is in the registry after one bootstrap call", () => {
      expect(idsOf(listVisibleSidebarTabs(true))).toEqual([
        "chat",
        "contacts",
        "combat",
        "compendium",
        "actors",
        "scenes",
        "settings",
      ]);
      expect(CORE_SIDEBAR_TAB_IDS).toEqual([
        "chat",
        "contacts",
        "combat",
        "compendium",
        "actors",
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

      // REQ-GAV-003 order of the "all" group, then the provisional Atores directory at
      // the end of the group (REQ-GAV-031 position), which DEC-CTT-01 keeps until spec 42.
      expect(idsOf(visible.all)).toEqual(["chat", "contacts", "combat", "compendium", "actors"]);
      expect(idsOf(visible.gm)).toEqual(["scenes"]);
      expect(idsOf(visible.footer)).toEqual([SETTINGS_TAB_ID]);
    });

    it("REQ-GAV-004: the player loses the gm block and keeps every other position", () => {
      const player = listVisibleSidebarTabs(false);
      const gm = listVisibleSidebarTabs(true);

      expect(idsOf(player)).toEqual([
        "chat",
        "contacts",
        "combat",
        "compendium",
        "actors",
        "settings",
      ]);
      for (const id of ["chat", "contacts", "combat", "compendium", "actors"]) {
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

    it('REQ-CTT-001: Contatos is id "contacts", group all, second of the group', () => {
      const contacts = getSidebarTab("contacts");

      expect(contacts?.group).toBe("all");
      expect(contacts?.label).toBe("FUSION.Sidebar.Tabs.Contacts");
      expect(idsOf(getVisibleSidebarTabs(false).all)[1]).toBe("contacts");
      expect(idsOf(getVisibleSidebarTabs(true).all)[1]).toBe("contacts");
      // DEC-CTT-01: the provisional Atores directory is still registered, because it
      // is the only UI that creates and deletes an Actor until the NPCs tab lands.
      expect(idsOf(listVisibleSidebarTabs(true))).toContain("actors");
      expect(contacts?.icon).not.toBe(getSidebarTab("actors")?.icon);
    });

    it('REQ-CBA-001: Combate is id "combat", group all, third of the group', () => {
      const combat = getSidebarTab("combat");

      expect(combat?.group).toBe("all");
      expect(combat?.label).toBe("FUSION.Sidebar.Tabs.Combat");
      // Third for every role: the provisional Atores directory sits at the end of the
      // group precisely so it cannot push Combate out of the position REQ-CBA-001 names.
      expect(idsOf(getVisibleSidebarTabs(false).all)[2]).toBe("combat");
      expect(idsOf(getVisibleSidebarTabs(true).all)[2]).toBe("combat");
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

  describe("REQ-GAV-030: each id opens its own panel — the bridge of G016", () => {
    /**
     * The expected half of this table is written HERE, by hand, from the panels the
     * table already had (spec 36 §7 lists the tab each one becomes). It is never read
     * back from `registerCoreTabs.ts` — comparing the module against itself would pass
     * for any wiring, including a `chat` that opens Configurações.
     */
    const EXPECTED_PANEL_OF: readonly (readonly [string, () => Promise<SidebarPanelModule>])[] = [
      ["chat", () => import("../../../components/chat/ChatPanel.svelte")],
      // REQ-CTT-001: Contatos is spec 39's own panel, second in the group.
      ["contacts", () => import("../../../components/contacts/ContactsPanel.svelte")],
      ["combat", () => import("../../../components/combat/CombatPanel.svelte")],
      ["compendium", () => import("../../../components/compendium/CompendiumBrowser.svelte")],
      // DEC-CTT-01: the Atores directory stays until the NPCs tab takes authoring
      // over — it is still the only UI that creates and deletes an Actor.
      ["actors", () => import("../../../components/actors/ActorDirectory.svelte")],
      // REQ-CEN-001: Cenas is the panel extracted from the pre-drawer sidebar.
      ["scenes", () => import("../../../components/scenes/ScenesTab.svelte")],
      // REQ-CFG-001: Configurações is the placeholder panel of spec 36 §7.4.
      ["settings", () => import("../../../components/settings/SettingsTab.svelte")],
    ];

    it("REQ-GAV-030: the table covers every core tab, so no id escapes the check", () => {
      expect(EXPECTED_PANEL_OF.map(([id]) => id)).toEqual([...CORE_SIDEBAR_TAB_IDS]);
    });

    for (const [id, loadExpected] of EXPECTED_PANEL_OF) {
      it(`REQ-GAV-030: "${id}" resolves to its own panel component`, async () => {
        const resolved: unknown = await loadSidebarPanel(id);
        const expected: unknown = (await loadExpected()).default;

        expect(typeof resolved).toBe("function");
        expect(resolved).toBe(expected);
      });
    }

    it("REQ-GAV-030: no two tabs resolve to the same panel", async () => {
      const panels = await Promise.all(CORE_SIDEBAR_TAB_IDS.map((id) => loadSidebarPanel(id)));

      expect(new Set(panels).size).toBe(CORE_SIDEBAR_TAB_IDS.length);
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

    it("REQ-GAV-021: the rail draws the counter, with the store's number, in the corner of the icon", () => {
      // Present even though Chat is the tab that is open right now.
      chatStore.unreadCount = 2;
      expect(drawnCounterOfChatButton(renderRail())).toBe("2");

      // The drawn digits follow the store: a badge frozen on a literal fails here.
      chatStore.unreadCount = 7;
      expect(drawnCounterOfChatButton(renderRail())).toBe("7");

      // And the counter belongs to Chat alone — no other tab draws one.
      expect(renderRail().match(/data-badge-kind="counter"/g)).toHaveLength(1);
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
      // "contacts", "compendium" and "scenes" are absent from this list on purpose: spec
      // 39 gives the first a state dot (REQ-CTT-002), spec 43 the second (REQ-CPD-002)
      // and spec 44 the third (REQ-CEN-003) — all three asserted right below.
      for (const id of ["actors", "settings"]) {
        expect(getSidebarTab(id)?.badge).toBeUndefined();
      }
    });

    it("REQ-CPD-002/REQ-CPD-005: Compêndio brings a state dot, and it draws nothing at rest", () => {
      // Spec 43 §5.1 gave this tab a badge where G016 had none: a dot for a
      // running batch import of this user, never a counter, and off otherwise.
      const badge = getSidebarTab("compendium")?.badge;

      expect(badge).toBe(compendiumImportBadge);
      expect(typeof badge?.value).toBe("boolean");
      expect(formatSidebarBadge(badge?.value).kind).toBe("none");
    });

    it("REQ-CPD-003/REQ-CPD-004: the dot follows the import, and drawing the rail does not move it", () => {
      startCompendiumBatchImport("run-1");

      expect(formatSidebarBadge(getSidebarTab("compendium")?.badge?.value)).toEqual({
        kind: "dot",
        text: null,
      });
      // Opening, switching and collapsing the drawer leave it exactly as it was.
      renderRail();
      expect(compendiumImportBadge.value).toBe(true);

      finishCompendiumBatchImport("run-1");
      expect(formatSidebarBadge(getSidebarTab("compendium")?.badge?.value).kind).toBe("none");
    });

    it("REQ-CTT-002: Contatos brings a state dot — one badge, and never a number", () => {
      expect(getSidebarTab("contacts")?.badge).toBe(contactsKnowledgeBadge);
      expect(typeof contactsKnowledgeBadge.value).toBe("boolean");
      expect(contactsStateDot.value).toBe(false);

      // Whoever owns the rule moves the store; the rail only draws what it finds.
      contactsStateDot.light();
      expect(formatSidebarBadge(getSidebarTab("contacts")?.badge?.value)).toEqual({
        kind: "dot",
        text: null,
      });
      // Exactly one dot: neither Combate (no encounter) nor Cenas (no local prepare)
      // is lit here, which the beforeEach guarantees.
      expect(renderRail().match(/data-badge-kind="dot"/g)).toHaveLength(1);
      expect(renderRail().match(/data-badge-kind="counter"/g)).toBeNull();

      contactsStateDot.clear();
      expect(formatSidebarBadge(getSidebarTab("contacts")?.badge?.value).kind).toBe("none");
    });

    it("REQ-CEN-003: Cenas brings a state dot of its own, lit by the local prepare", () => {
      // Spec 44 gave the Cenas tab a badge (REQ-CEN-003/004), so it left the list above.
      // Its rule is the scenes' own — a prepare that differs from the scene on air — and
      // the rail only reads it (REQ-GAV-023).
      const badge = getSidebarTab("scenes")?.badge;
      expect(badge).toBe(scenePrepareBadge);
      expect(typeof badge?.value).toBe("boolean");

      scenePrepareState.sceneId = null;
      expect(formatSidebarBadge(badge?.value).kind).toBe("none");

      activeSceneState.id = "on-air";
      scenePrepareState.sceneId = "being-prepared";
      expect(formatSidebarBadge(badge?.value)).toEqual({ kind: "dot", text: null });

      scenePrepareState.sceneId = null;
    });
  });
});
