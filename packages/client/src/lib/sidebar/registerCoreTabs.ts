/**
 * registerCoreTabs.ts — the core tabs enter through the public door.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`), DEC-GAV-07 / REQ-GAV-030: the tabs of the
 * base game are registered by the very same `registerSidebarTab` call a mod would
 * use, never by an `{#if}` inside the drawer — "if the core cannot register a tab
 * through the public path, the path is wrong". This module is that first client.
 *
 * It is a BRIDGE, on purpose (plan G016): the panels it points at are the ones the
 * table already uses, unchanged. Each tab gets its own redesign in its own child
 * spec — Chat (38), Contatos (39), Combate (40), NPCs (42), Compêndio (43), Cenas
 * (44), Configurações (37) — and this file is where that lands, one entry at a time.
 *
 * Two consequences of that bridge are visible here and are deliberate:
 *
 *  - the second slot of the "all" group is **Contatos** (spec 39, REQ-CTT-001), and
 *    the old **Atores** directory is GONE (G078). It was kept alive past spec 39
 *    only because it was the last UI that created and deleted an Actor — the debt
 *    DEC-CTT-01 declared. Spec 42's NPCs tab took authoring of non-playables over,
 *    so the directory was buried: the debt is now paid by halves, on purpose —
 *    creating a player's character is spec 37's (G105) and deleting one has no
 *    screen at all, accepted in Q-NPC-06.
 *  - **Configurações** sits in the rail footer, which is what DEC-GAV-09/REQ-CFG-001
 *    ask for; the placeholder panel is gone — its index→section navigation is spec
 *    37's own (G100), and each section's content is filled in by its own task
 *    (G101..G106).
 *
 * Every `component` is a real `() => import(...)`: mounting the rail must not pull a
 * single panel module (RNF-GAV-02). Registration itself never calls a loader.
 */

import { chatStore } from "../chat/chatStore.svelte.js";
import { combatBadgeLit, combatBadgeTone } from "../combat/combatBadge.svelte.js";
import { compendiumImportBadge } from "../compendium/importActivity.js";
import { contactsStateDot } from "../contacts/knowledgeBadge.js";
import {
  chatIcon,
  combatIcon,
  compendiumIcon,
  contactsIcon,
  npcsIcon,
  scenesIcon,
  settingsIcon,
} from "../../components/sidebar/icons.js";
import { scenePrepareBadge } from "../scenes/prepareState.svelte.js";
import { getSidebarTab, registerSidebarTab } from "./registry.js";
import type { SidebarBadgeStore, SidebarBadgeTone, SidebarTabDefinition } from "./registry.js";

/**
 * Chat's unread counter (REQ-GAV-020 counter type).
 *
 * The value is read straight from the chat's own store, so the rule that lights it
 * up and puts it out stays where it belongs — `chatStore` zeroes it when the panel
 * becomes visible (REQ-CHT-039, and REQ-ACH-004 in spec 38). The drawer only reads
 * it (REQ-GAV-022, REQ-GAV-023).
 */
export const chatUnreadBadge: SidebarBadgeStore = {
  get value(): number {
    return chatStore.unreadCount;
  },
};

/**
 * Combat's "something is happening" dot (REQ-GAV-020 state-dot type, REQ-CBA-002).
 *
 * Whether a combat is running is spec 10's rule, kept in the combat store; this is
 * the same condition the legacy sidebar drew as a crossed-swords glyph — the glyph
 * is gone (REQ-NPC-094), the meaning is not.
 *
 * Both halves come from `lib/combat/combatBadge`, which is where DEC-CBA-07 lives:
 * the dot is lit while there is a live encounter on the active scene, montagem
 * included (REQ-CBA-003), and turns amber when the participant of the turn is this
 * user's (REQ-CBA-004). Nothing is computed here, so opening or collapsing the drawer
 * cannot move either one (REQ-GAV-022).
 */
export const combatActiveBadge: SidebarBadgeStore = {
  get value(): boolean {
    return combatBadgeLit();
  },
  get tone(): SidebarBadgeTone {
    return combatBadgeTone();
  },
};

/**
 * Contatos' "someone has been introduced" dot (REQ-GAV-020 state-dot type).
 *
 * The rule that lights it and puts it out is spec 39's own (REQ-CTT-002..004), kept
 * in `lib/contacts/knowledgeBadge.ts`: it lights when a contact rises in state for
 * one of the viewer's characters while the tab is closed, never lights for a
 * privileged seat, and goes out when the panel is opened. The rail only reads it
 * (REQ-GAV-022, REQ-GAV-023).
 */
export const contactsKnowledgeBadge: SidebarBadgeStore = contactsStateDot;

/**
 * Cenas' "you are not looking at the table's scene" dot (REQ-CEN-003, state-dot type).
 *
 * Re-exported from the scenes' own module for the same reason as the two above: the rule
 * that lights it — a local prepare that differs from the scene on air (REQ-CEN-004) —
 * belongs to spec 44, not to the rail. Opening the tab does not put it out (REQ-CEN-005):
 * unlike an unread counter, it describes a state that is still true after you look.
 */
export { scenePrepareBadge };

/**
 * The core tabs, in the order of DEC-GAV-01: group "all" (Chat, Contatos, Combate,
 * Compêndio), then group "gm" (NPCs, Cenas), then Configurações in the footer.
 *
 * Registration order is rail order inside a group, so this array is the source of
 * that order — the rail sorts nothing.
 */
const CORE_TABS: readonly SidebarTabDefinition[] = [
  {
    id: "chat",
    icon: chatIcon,
    label: "FUSION.Sidebar.Tabs.Chat",
    group: "all",
    component: () => import("../../components/chat/ChatPanel.svelte"),
    badge: chatUnreadBadge,
  },
  {
    // REQ-CTT-001: id "contacts", group "all", second of the group, with its own
    // drawn icon and an i18n label. REQ-CTT-002: one badge, and it is a state dot.
    id: "contacts",
    icon: contactsIcon,
    label: "FUSION.Sidebar.Tabs.Contacts",
    group: "all",
    component: () => import("../../components/contacts/ContactsPanel.svelte"),
    badge: contactsKnowledgeBadge,
  },
  {
    // REQ-CBA-001: id "combat", group "all", third of the group.
    id: "combat",
    icon: combatIcon,
    label: "FUSION.Sidebar.Tabs.Combat",
    group: "all",
    component: () => import("../../components/combat/CombatPanel.svelte"),
    badge: combatActiveBadge,
  },
  {
    id: "compendium",
    icon: compendiumIcon,
    label: "FUSION.Sidebar.Tabs.Compendium",
    group: "all",
    component: () => import("../../components/compendium/CompendiumBrowser.svelte"),
    // REQ-CPD-002..005: a state dot, lit only while a batch import THIS user
    // started is running. A compendium has no "new things you have not seen",
    // so there is nothing here for a counter to count.
    badge: compendiumImportBadge,
  },
  // The provisional Atores directory used to sit here, at the end of the "all"
  // group. G078 buried it: spec 42's NPCs tab authors non-playables, and with the
  // directory gone the "all" group is exactly the four tabs of REQ-GAV-003.
  {
    // REQ-NPC-001: id "npcs", group "gm", FIRST of the group, with its own drawn
    // icon and an i18n label. REQ-NPC-002: no badge of any kind — nothing happens
    // in this tab that was not the Mestre himself.
    id: "npcs",
    icon: npcsIcon,
    label: "FUSION.Sidebar.Tabs.Npcs",
    group: "gm",
    component: () => import("../../components/npcs/NpcsPanel.svelte"),
  },
  {
    // REQ-CEN-001: id "scenes", group "gm", in the middle block; it is also the
    // first-access tab of a privileged seat (REQ-CEN-002 / REQ-GAV-015), which the
    // preferences module already knows.
    id: "scenes",
    icon: scenesIcon,
    label: "FUSION.Sidebar.Tabs.Scenes",
    group: "gm",
    component: () => import("../../components/scenes/ScenesTab.svelte"),
    badge: scenePrepareBadge,
  },
  {
    // REQ-CFG-001: id "settings", group "all"; the registry anchors this one id to
    // the rail footer (DEC-GAV-09), so no mod tab can land there (REQ-GAV-003).
    id: "settings",
    icon: settingsIcon,
    label: "FUSION.Sidebar.Tabs.Settings",
    group: "all",
    component: () => import("../../components/settings/SettingsTab.svelte"),
  },
];

/**
 * Register every core tab (REQ-GAV-030). Call once during table boot, before the
 * drawer is mounted — it reads the registry to decide where a seat opens.
 *
 * Idempotent by id: a tab that is already registered is left alone instead of
 * throwing, so a remount (or a hot reload) does not take the table down. The
 * registry's own "same id twice throws" rule (REQ-GAV-033) is untouched — this is
 * a bootstrap guard, not a way around it.
 */
export function registerCoreSidebarTabs(): void {
  for (const tab of CORE_TABS) {
    if (getSidebarTab(tab.id) !== undefined) continue;
    registerSidebarTab(tab);
  }
}

/** Ids of the core tabs, in rail order. Exported for tests and for spec 37's audit. */
export const CORE_SIDEBAR_TAB_IDS: readonly string[] = CORE_TABS.map((tab) => tab.id);
