/**
 * badges.test.ts — the badge contract of the side drawer rail.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`) §5.3 / DEC-GAV-06. The point of these
 * tests is the negative one: the container (rail + drawer) walks through open,
 * switch and collapse and NOT ONE badge value moves — only the owning child tab
 * (faked here) moves it.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import * as badgesModule from "../badges.svelte.js";
import {
  SIDEBAR_BADGE_MAX_COUNT,
  SIDEBAR_BADGE_OVERFLOW_TEXT,
  createCounterBadge,
  createDotBadge,
  formatSidebarBadge,
  isSidebarBadgeVisible,
  readSidebarBadge,
} from "../badges.svelte.js";
import type { SidebarCounterBadge, SidebarDotBadge } from "../badges.svelte.js";

import * as registryModule from "../registry.js";
import {
  clearSidebarTabs,
  eagerPanel,
  getSidebarTab,
  getVisibleSidebarTabs,
  isSidebarTabVisible,
  listVisibleSidebarTabs,
  loadSidebarPanel,
  registerSidebarTab,
} from "../registry.js";
import type { SidebarBadgeStore } from "../registry.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A drawn icon, as REQ-NPC-094 demands; content is irrelevant here. */
const ICON = '<svg viewBox="0 0 16 16"><path d="M2 2h12v12H2z" /></svg>';

const PANEL = eagerPanel({ name: "FakePanel" });

/**
 * The container, faked exactly as far as this task needs it: it knows how to
 * open, switch and collapse (REQ-GAV-010/011) and nothing else. It is built on
 * top of the registry — the same queries the real rail and drawer use — so if
 * any of them mutated a badge, these tests would see it.
 */
function fakeDrawer(isGm: boolean): {
  open: boolean;
  activeTab: string | null;
  select: (tabId: string) => void;
  mount: (tabId: string) => Promise<unknown>;
} {
  const drawer = {
    open: false,
    activeTab: null as string | null,
    select(tabId: string): void {
      if (!isSidebarTabVisible(tabId, isGm)) return;
      if (drawer.open && drawer.activeTab === tabId) {
        drawer.open = false; // REQ-GAV-011: clicking the active tab collapses
        return;
      }
      drawer.open = true;
      drawer.activeTab = tabId;
    },
    async mount(tabId: string): Promise<unknown> {
      return loadSidebarPanel(tabId);
    },
  };
  return drawer;
}

function snapshotBadges(isGm: boolean): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const tab of listVisibleSidebarTabs(isGm)) {
    snapshot[tab.id] = tab.badge?.value ?? null;
  }
  return snapshot;
}

let chatUnread: SidebarCounterBadge;
let combatActive: SidebarDotBadge;

function registerCoreLikeTabs(): void {
  chatUnread = createCounterBadge();
  combatActive = createDotBadge();

  registerSidebarTab({
    id: "chat",
    icon: ICON,
    label: "FUSION.Sidebar.Tabs.Chat",
    group: "all",
    component: PANEL,
    badge: chatUnread,
  });
  registerSidebarTab({
    id: "combat",
    icon: ICON,
    label: "FUSION.Sidebar.Tabs.Combat",
    group: "all",
    component: PANEL,
    badge: combatActive,
  });
  registerSidebarTab({
    id: "scenes",
    icon: ICON,
    label: "FUSION.Sidebar.Tabs.Scenes",
    group: "gm",
    component: PANEL,
  });
}

beforeEach(() => {
  clearSidebarTabs();
  registerCoreLikeTabs();
});

afterEach(() => {
  clearSidebarTabs();
});

// ---------------------------------------------------------------------------
// REQ-GAV-020 — one badge per tab, of one of two types
// ---------------------------------------------------------------------------

describe("REQ-GAV-020 — contador ou ponto de estado, nunca os dois", () => {
  it("REQ-GAV-020: contador exibe o inteiro até 99", () => {
    expect(formatSidebarBadge(1)).toEqual({ kind: "counter", text: "1" });
    expect(formatSidebarBadge(7)).toEqual({ kind: "counter", text: "7" });
    expect(formatSidebarBadge(SIDEBAR_BADGE_MAX_COUNT)).toEqual({ kind: "counter", text: "99" });
  });

  it("REQ-GAV-020: acima de 99 o contador vira 99+", () => {
    expect(formatSidebarBadge(SIDEBAR_BADGE_MAX_COUNT + 1)).toEqual({
      kind: "counter",
      text: SIDEBAR_BADGE_OVERFLOW_TEXT,
    });
    expect(formatSidebarBadge(4321)).toEqual({
      kind: "counter",
      text: SIDEBAR_BADGE_OVERFLOW_TEXT,
    });
  });

  it("REQ-GAV-020: contador só existe a partir de 1 — zero e negativo não desenham nada", () => {
    expect(formatSidebarBadge(0)).toEqual({ kind: "none", text: null });
    expect(formatSidebarBadge(-3)).toEqual({ kind: "none", text: null });
    expect(isSidebarBadgeVisible(0)).toBe(false);
  });

  it("REQ-GAV-020: ponto de estado é booleano e não carrega número", () => {
    expect(formatSidebarBadge(true)).toEqual({ kind: "dot", text: null });
    expect(formatSidebarBadge(false)).toEqual({ kind: "none", text: null });
  });

  it("REQ-GAV-020: ausência de badge (null) não desenha nada", () => {
    expect(formatSidebarBadge(null)).toEqual({ kind: "none", text: null });
    expect(readSidebarBadge(undefined)).toEqual({ kind: "none", text: null });
    expect(isSidebarBadgeVisible(null)).toBe(false);
  });

  it("REQ-GAV-020: uma aba não pode ter os dois tipos — o contador nunca vira ponto", () => {
    const badge = createCounterBadge();
    badge.set(3);
    expect(typeof badge.value).toBe("number");
    expect(formatSidebarBadge(badge.value).kind).toBe("counter");
    badge.clear();
    expect(typeof badge.value).toBe("number");
    expect(formatSidebarBadge(badge.value).kind).toBe("none");
  });

  it("REQ-GAV-020: o ponto de estado nunca vira contador", () => {
    const badge = createDotBadge();
    badge.light();
    expect(typeof badge.value).toBe("boolean");
    expect(formatSidebarBadge(badge.value).kind).toBe("dot");
    badge.clear();
    expect(formatSidebarBadge(badge.value).kind).toBe("none");
  });

  it("REQ-GAV-020: contador normaliza entrada suja para inteiro não-negativo", () => {
    const badge = createCounterBadge(-5);
    expect(badge.value).toBe(0);
    badge.set(3.7);
    expect(badge.value).toBe(3);
    badge.increment();
    expect(badge.value).toBe(4);
    badge.increment(10);
    expect(badge.value).toBe(14);
    badge.set(Number.NaN);
    expect(badge.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-021 — rendered whenever it exists
// ---------------------------------------------------------------------------

describe("REQ-GAV-021 — badge existe independentemente do estado da gaveta", () => {
  it("REQ-GAV-021: a leitura do badge não recebe nem consulta open/activeTab", () => {
    // The formatting entry points take the value alone — there is no drawer
    // state to pass in, so a collapsed or active drawer cannot hide a badge.
    expect(formatSidebarBadge.length).toBe(1);
    expect(isSidebarBadgeVisible.length).toBe(1);
    expect(readSidebarBadge.length).toBe(1);
  });

  it("REQ-GAV-021: o badge é o mesmo com a gaveta recolhida, aberta e na aba ativa", () => {
    chatUnread.set(5);
    const drawer = fakeDrawer(true);

    const collapsed = readSidebarBadge(getSidebarTab("chat")?.badge);
    expect(collapsed).toEqual({ kind: "counter", text: "5" });

    drawer.select("chat"); // open on chat — chat is now the active tab
    expect(drawer.open).toBe(true);
    expect(drawer.activeTab).toBe("chat");
    expect(readSidebarBadge(getSidebarTab("chat")?.badge)).toEqual(collapsed);

    drawer.select("chat"); // collapse again (REQ-GAV-011)
    expect(drawer.open).toBe(false);
    expect(readSidebarBadge(getSidebarTab("chat")?.badge)).toEqual(collapsed);
  });

  it("REQ-GAV-021: o ponto de estado sobrevive na aba ativa e aberta", () => {
    combatActive.light();
    const drawer = fakeDrawer(true);
    drawer.select("combat");
    expect(readSidebarBadge(getSidebarTab("combat")?.badge)).toEqual({ kind: "dot", text: null });
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-022 — the rail never changes a badge
// ---------------------------------------------------------------------------

describe("REQ-GAV-022 — abrir, trocar e recolher não mexem em badge algum", () => {
  it("REQ-GAV-022: uma sessão inteira de abrir/trocar/recolher deixa todos os badges intactos", async () => {
    chatUnread.set(3);
    combatActive.light();

    const before = snapshotBadges(true);
    expect(before).toEqual({ chat: 3, combat: true, scenes: null });

    const drawer = fakeDrawer(true);
    drawer.select("chat"); // open
    await drawer.mount("chat"); // mounting the panel is not a badge event either
    drawer.select("combat"); // switch
    await drawer.mount("combat");
    drawer.select("scenes"); // switch to a badge-less tab
    drawer.select("scenes"); // collapse
    drawer.select("chat"); // reopen on the tab that carries a counter
    await drawer.mount("chat");
    drawer.select("chat"); // collapse again

    expect(snapshotBadges(true)).toEqual(before);
    expect(chatUnread.value).toBe(3);
    expect(combatActive.value).toBe(true);
  });

  it("REQ-GAV-022: as consultas do trilho são somente leitura sobre o badge", () => {
    chatUnread.set(12);
    combatActive.light();
    const before = snapshotBadges(true);

    getVisibleSidebarTabs(true);
    getVisibleSidebarTabs(false);
    listVisibleSidebarTabs(true);
    isSidebarTabVisible("scenes", false);
    getSidebarTab("chat");

    expect(snapshotBadges(true)).toEqual(before);
  });

  it("REQ-GAV-022: quem mexe é a filha — o fake do chat acende e apaga o contador", () => {
    const drawer = fakeDrawer(true);
    drawer.select("chat");
    expect(chatUnread.value).toBe(0);

    // The child tab (chat, spec 38) is the only one allowed to move this.
    chatUnread.increment();
    chatUnread.increment(2);
    expect(snapshotBadges(true)["chat"]).toBe(3);
    expect(readSidebarBadge(getSidebarTab("chat")?.badge)).toEqual({ kind: "counter", text: "3" });

    // ...and the child is also the one that clears it when it decides the
    // content was read; the container never does this on its own.
    chatUnread.clear();
    expect(readSidebarBadge(getSidebarTab("chat")?.badge)).toEqual({ kind: "none", text: null });
  });

  it("REQ-GAV-022: a filha do combate acende e apaga o ponto de estado", () => {
    const drawer = fakeDrawer(true);
    drawer.select("combat");
    expect(combatActive.value).toBe(false);

    combatActive.light();
    expect(snapshotBadges(true)["combat"]).toBe(true);

    drawer.select("chat"); // switching away does not end the combat
    expect(combatActive.value).toBe(true);

    combatActive.clear();
    expect(readSidebarBadge(getSidebarTab("combat")?.badge)).toEqual({ kind: "none", text: null });
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-023 — the value comes from the tab; no business rule in the container
// ---------------------------------------------------------------------------

describe("REQ-GAV-023 — o valor é da aba, o contêiner não tem regra de negócio", () => {
  it("REQ-GAV-023: o registro guarda a mesma referência de store que a aba criou", () => {
    expect(getSidebarTab("chat")?.badge).toBe(chatUnread as SidebarBadgeStore);
    chatUnread.set(9);
    expect(getSidebarTab("chat")?.badge?.value).toBe(9);
  });

  it("REQ-GAV-023: o registro não expõe nenhuma função que escreva badge", () => {
    const writers = Object.keys(registryModule).filter((name) =>
      /^(set|clear|increment|reset|mark|update)?.*badge/i.test(name),
    );
    expect(writers).toEqual([]);
  });

  it("REQ-GAV-023: o módulo de badges não conhece chat, combate nem qualquer regra de aba", () => {
    // No import of a feature store here: the helpers are generic on purpose, so
    // the unread rule (REQ-CHT-039) and the active-combat rule stay in their
    // own specs.
    const counter = createCounterBadge();
    const dot = createDotBadge();
    expect(Object.keys(counter).sort()).toEqual(["clear", "increment", "set", "value"]);
    expect(Object.keys(dot).sort()).toEqual(["clear", "light", "set", "value"]);
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-024 — no sound, no blinking
// ---------------------------------------------------------------------------

describe("REQ-GAV-024 — sem som, sem piscar, sem animação", () => {
  it("REQ-GAV-024: o badge desenhado tem só tipo e texto — nenhum canal de animação ou som", () => {
    expect(Object.keys(formatSidebarBadge(5)).sort()).toEqual(["kind", "text"]);
    expect(Object.keys(formatSidebarBadge(true)).sort()).toEqual(["kind", "text"]);
  });

  it("REQ-GAV-024: o módulo não exporta nada de piscar, animar ou tocar som", () => {
    const forbidden = /blink|flash|pulse|animate|animation|sound|audio|beep/i;
    const badExports = Object.keys(badgesModule).filter((name) => forbidden.test(name));
    expect(badExports).toEqual([]);
  });

  it("REQ-GAV-024: o valor não muda sozinho com o tempo — nenhum timer por trás", () => {
    vi.useFakeTimers();
    try {
      chatUnread.set(4);
      combatActive.light();
      vi.advanceTimersByTime(60_000);
      expect(chatUnread.value).toBe(4);
      expect(combatActive.value).toBe(true);
      expect(readSidebarBadge(getSidebarTab("chat")?.badge)).toEqual({
        kind: "counter",
        text: "4",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
