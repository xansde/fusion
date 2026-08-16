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
 *  - the second slot of the "all" group is the old **Atores** directory standing in
 *    for **Contatos** (DEC-GAV-01). Contatos and NPCs are content decisions of specs
 *    39 and 42; splitting the directory before those exist would be redesigning the
 *    panel, which G016 must not do. The position is already the final one.
 *  - **Configurações** is a placeholder panel with nothing but its empty state
 *    (spec 36 §7.4) until spec 37 lands; the tab itself already sits in the rail
 *    footer, which is what DEC-GAV-09/REQ-CFG-001 ask for.
 *
 * Every `component` is a real `() => import(...)`: mounting the rail must not pull a
 * single panel module (RNF-GAV-02). Registration itself never calls a loader.
 */

import { chatStore } from "../chat/chatStore.svelte.js";
import { combatStore } from "../combat/combatStore.svelte.js";
import {
  chatIcon,
  combatIcon,
  compendiumIcon,
  contactsIcon,
  scenesIcon,
  settingsIcon,
} from "../../components/sidebar/icons.js";
import { getSidebarTab, registerSidebarTab } from "./registry.js";
import type { SidebarBadgeStore, SidebarTabDefinition } from "./registry.js";

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
 * Combat's "something is happening" dot (REQ-GAV-020 state-dot type).
 *
 * Whether a combat is running is spec 10's rule, kept in the combat store; this is
 * the same condition the legacy sidebar drew as a crossed-swords glyph — the glyph
 * is gone (REQ-NPC-094), the meaning is not.
 */
export const combatActiveBadge: SidebarBadgeStore = {
  get value(): boolean {
    return combatStore.combat !== null;
  },
};

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
    // Provisional occupant of the Contatos slot — see the module header.
    id: "actors",
    icon: contactsIcon,
    label: "FUSION.Sidebar.Tabs.Actors",
    group: "all",
    component: () => import("../../components/actors/ActorDirectory.svelte"),
  },
  {
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
