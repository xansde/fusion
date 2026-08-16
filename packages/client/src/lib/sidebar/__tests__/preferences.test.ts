/**
 * preferences.test.ts — the drawer's local preferences (spec 36, G013).
 *
 * Covers REQ-GAV-014 (per user + device, restored on reload, never sent to the server),
 * REQ-GAV-015 (first access by role), REQ-GAV-016 (saved tab the user cannot see falls
 * back to Chat) and REQ-CEN-002 (Scenes is the privileged role's first-access tab).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  CHAT_TAB_ID,
  DEFAULT_SIDEBAR_OPEN,
  SCENES_TAB_ID,
  clearSidebarPreferences,
  loadSidebarPreferences,
  resolveInitialSidebarState,
  resolveInitialTab,
  saveSidebarPreferences,
  sidebarPreferencesKey,
} from "../preferences.js";
import { clearSidebarTabs, listVisibleSidebarTabs, registerSidebarTab } from "../registry.js";

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as lib/windows/__tests__/window-manager.test.ts)
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
    snapshot: () => ({ ...store }),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

const WORLD = "world-abc";
const GM_ID = "user-gm";
const PLAYER_ID = "user-player";

/** Rail order of the MVP core tabs (DEC-GAV-01), as the registry would hand them over. */
const PLAYER_TABS = ["chat", "contacts", "combat", "compendium", "settings"];
const GM_TABS = ["chat", "contacts", "combat", "compendium", "npcs", "scenes", "settings"];

beforeEach(() => {
  localStorageMock.clear();
});

// ---------------------------------------------------------------------------
// REQ-GAV-015 / REQ-CEN-002 — first access by role
// ---------------------------------------------------------------------------

describe("first access without a saved preference (REQ-GAV-015)", () => {
  it("REQ-GAV-015/REQ-CEN-002: a privileged role opens on Scenes", () => {
    expect(resolveInitialTab({ saved: undefined, isGm: true, visibleTabIds: GM_TABS })).toBe(
      SCENES_TAB_ID,
    );
  });

  it("REQ-GAV-015: a non-privileged role opens on Chat", () => {
    expect(resolveInitialTab({ saved: undefined, isGm: false, visibleTabIds: PLAYER_TABS })).toBe(
      CHAT_TAB_ID,
    );
  });

  it("REQ-GAV-015: the drawer starts expanded when nothing was saved", () => {
    const state = resolveInitialSidebarState({
      worldId: WORLD,
      userId: GM_ID,
      isGm: true,
      visibleTabIds: GM_TABS,
    });
    expect(state).toEqual({ open: DEFAULT_SIDEBAR_OPEN, activeTab: SCENES_TAB_ID });
    expect(DEFAULT_SIDEBAR_OPEN).toBe(true);
  });

  it("REQ-GAV-015: a privileged role with no Scenes tab on the rail falls back to Chat", () => {
    expect(resolveInitialTab({ saved: undefined, isGm: true, visibleTabIds: PLAYER_TABS })).toBe(
      CHAT_TAB_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-014 — persisted per user and device, restored on reload
// ---------------------------------------------------------------------------

describe("local persistence per user and device (REQ-GAV-014)", () => {
  it("REQ-GAV-014: what the user left is what the next load restores", () => {
    saveSidebarPreferences(WORLD, PLAYER_ID, { open: false, activeTab: "compendium" });

    // A reload is just another read of the same key.
    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: PLAYER_ID,
        isGm: false,
        visibleTabIds: PLAYER_TABS,
      }),
    ).toEqual({ open: false, activeTab: "compendium" });
  });

  it("REQ-GAV-014: the key names the world and the user, and nothing else is written", () => {
    saveSidebarPreferences(WORLD, PLAYER_ID, { open: true, activeTab: "combat" });

    const keys = Object.keys(localStorageMock.snapshot());
    expect(keys).toEqual([sidebarPreferencesKey(WORLD, PLAYER_ID)]);
    expect(keys[0]).toContain(WORLD);
    expect(keys[0]).toContain(PLAYER_ID);
  });

  it("REQ-GAV-014: only `open` and `activeTab` are stored — nothing identifying travels", () => {
    saveSidebarPreferences(WORLD, GM_ID, { open: false, activeTab: SCENES_TAB_ID });

    const raw = localStorageMock.getItem(sidebarPreferencesKey(WORLD, GM_ID));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ open: false, activeTab: SCENES_TAB_ID });
  });

  it("REQ-GAV-014: another world keeps its own entry", () => {
    saveSidebarPreferences(WORLD, GM_ID, { open: false, activeTab: "combat" });
    saveSidebarPreferences("other-world", GM_ID, { open: true, activeTab: SCENES_TAB_ID });

    expect(loadSidebarPreferences(WORLD, GM_ID)).toEqual({ open: false, activeTab: "combat" });
    expect(loadSidebarPreferences("other-world", GM_ID)).toEqual({
      open: true,
      activeTab: SCENES_TAB_ID,
    });
  });

  it("REQ-GAV-014: no world or no user means no key is written and nothing is read", () => {
    saveSidebarPreferences("", PLAYER_ID, { open: false, activeTab: "combat" });
    saveSidebarPreferences(WORLD, "", { open: false, activeTab: "combat" });

    expect(Object.keys(localStorageMock.snapshot())).toEqual([]);
    expect(loadSidebarPreferences("", PLAYER_ID)).toBeNull();
    expect(loadSidebarPreferences(WORLD, "")).toBeNull();
  });

  it("REQ-GAV-014: corrupt or half-written storage degrades to first access, never throws", () => {
    localStorageMock.setItem(sidebarPreferencesKey(WORLD, GM_ID), "{not json");
    expect(loadSidebarPreferences(WORLD, GM_ID)).toBeNull();
    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: GM_ID,
        isGm: true,
        visibleTabIds: GM_TABS,
      }),
    ).toEqual({ open: true, activeTab: SCENES_TAB_ID });

    localStorageMock.setItem(
      sidebarPreferencesKey(WORLD, PLAYER_ID),
      JSON.stringify({ open: "yes", activeTab: 7 }),
    );
    expect(loadSidebarPreferences(WORLD, PLAYER_ID)).toEqual({});
    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: PLAYER_ID,
        isGm: false,
        visibleTabIds: PLAYER_TABS,
      }),
    ).toEqual({ open: true, activeTab: CHAT_TAB_ID });
  });

  it("REQ-GAV-014: clearing removes the entry and the next access is a first access", () => {
    saveSidebarPreferences(WORLD, PLAYER_ID, { open: false, activeTab: "combat" });
    clearSidebarPreferences(WORLD, PLAYER_ID);

    expect(loadSidebarPreferences(WORLD, PLAYER_ID)).toBeNull();
    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: PLAYER_ID,
        isGm: false,
        visibleTabIds: PLAYER_TABS,
      }),
    ).toEqual({ open: true, activeTab: CHAT_TAB_ID });
  });

  it("REQ-GAV-014: a recollapsed drawer comes back recollapsed on the same tab", () => {
    saveSidebarPreferences(WORLD, GM_ID, { open: true, activeTab: "compendium" });
    saveSidebarPreferences(WORLD, GM_ID, { open: false, activeTab: "compendium" });

    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: GM_ID,
        isGm: true,
        visibleTabIds: GM_TABS,
      }),
    ).toEqual({ open: false, activeTab: "compendium" });
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-016 — a saved tab the user can no longer see
// ---------------------------------------------------------------------------

describe("saved tab the user cannot see (REQ-GAV-016)", () => {
  it("REQ-GAV-016: shared device — the GM saved Scenes, a player on the same browser opens on Chat", () => {
    // Same device, same world, two users: each id has its own entry, and the player's
    // entry is untouched by the GM's (REQ-GAV-014).
    saveSidebarPreferences(WORLD, GM_ID, { open: true, activeTab: SCENES_TAB_ID });

    const gmState = resolveInitialSidebarState({
      worldId: WORLD,
      userId: GM_ID,
      isGm: true,
      visibleTabIds: GM_TABS,
    });
    expect(gmState.activeTab).toBe(SCENES_TAB_ID);

    const playerState = resolveInitialSidebarState({
      worldId: WORLD,
      userId: PLAYER_ID,
      isGm: false,
      visibleTabIds: PLAYER_TABS,
    });
    expect(playerState.activeTab).toBe(CHAT_TAB_ID);
    expect(playerState.open).toBe(true);
  });

  it("REQ-GAV-016: the very same user demoted out of the GM role falls back to Chat, no error", () => {
    // Same key as before: the user kept the device but lost the role.
    saveSidebarPreferences(WORLD, GM_ID, { open: true, activeTab: SCENES_TAB_ID });

    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: GM_ID,
        isGm: false,
        visibleTabIds: PLAYER_TABS,
      }),
    ).toEqual({ open: true, activeTab: CHAT_TAB_ID });
  });

  it("REQ-GAV-016: an unregistered tab id falls back to Chat", () => {
    expect(
      resolveInitialTab({ saved: "mod-tab-that-left", isGm: true, visibleTabIds: GM_TABS }),
    ).toBe(CHAT_TAB_ID);
  });

  it("REQ-GAV-016: the fallback keeps `open` — losing the tab does not collapse the drawer", () => {
    saveSidebarPreferences(WORLD, PLAYER_ID, { open: false, activeTab: SCENES_TAB_ID });

    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: PLAYER_ID,
        isGm: false,
        visibleTabIds: PLAYER_TABS,
      }),
    ).toEqual({ open: false, activeTab: CHAT_TAB_ID });
  });

  it("REQ-GAV-016: a saved tab that IS visible survives — the fallback is not a reset", () => {
    saveSidebarPreferences(WORLD, PLAYER_ID, { open: true, activeTab: "compendium" });

    expect(
      resolveInitialSidebarState({
        worldId: WORLD,
        userId: PLAYER_ID,
        isGm: false,
        visibleTabIds: PLAYER_TABS,
      }).activeTab,
    ).toBe("compendium");
  });
});

// ---------------------------------------------------------------------------
// Wiring against the real registry (G010), not a hand-written tab list
// ---------------------------------------------------------------------------

describe("against the rail's real visibility (REQ-GAV-015, REQ-GAV-016, REQ-CEN-002)", () => {
  const ICON = '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z" /></svg>';
  const panel = (): Promise<{ default: unknown }> => Promise.resolve({ default: {} });

  beforeEach(() => {
    clearSidebarTabs();
    registerSidebarTab({
      id: "chat",
      icon: ICON,
      label: "FUSION.Sidebar.Tabs.Chat",
      group: "all",
      component: panel,
    });
    registerSidebarTab({
      id: "compendium",
      icon: ICON,
      label: "FUSION.Sidebar.Tabs.Compendium",
      group: "all",
      component: panel,
    });
    registerSidebarTab({
      id: "scenes",
      icon: ICON,
      label: "FUSION.Sidebar.Tabs.Scenes",
      group: "gm",
      component: panel,
    });
  });

  it("REQ-CEN-002: with the registry as the source of visibility, the GM opens on Scenes", () => {
    const visibleTabIds = listVisibleSidebarTabs(true).map((tab) => tab.id);
    expect(resolveInitialTab({ saved: undefined, isGm: true, visibleTabIds })).toBe(SCENES_TAB_ID);
  });

  it("REQ-GAV-016: the player's rail has no Scenes, so a saved 'scenes' falls back to Chat", () => {
    const visibleTabIds = listVisibleSidebarTabs(false).map((tab) => tab.id);
    expect(visibleTabIds).not.toContain(SCENES_TAB_ID);
    expect(resolveInitialTab({ saved: SCENES_TAB_ID, isGm: false, visibleTabIds })).toBe(
      CHAT_TAB_ID,
    );
  });
});
