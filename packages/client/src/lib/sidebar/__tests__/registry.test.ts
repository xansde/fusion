/**
 * registry.test.ts — the sidebar (drawer) tab registry.
 *
 * Covers:
 *  - REQ-GAV-030 [MVP] the `registerSidebarTab({ id, icon, label, group, component, badge? })`
 *    shape and the rail query (group "all" → group "gm" → footer, DEC-GAV-09).
 *  - REQ-GAV-032 [MVP] game systems do not register tabs in the MVP.
 *  - REQ-GAV-033 [MVP] registering a duplicate id fails loudly and never replaces.
 *  - REQ-GAV-031 [V2] mods registering tabs — declared only, out of the MVP.
 *  - RNF-GAV-02 [MVP] mounting the rail must not load panel code (dynamic import per tab).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerSidebarTab,
  clearSidebarTabs,
  getSidebarTab,
  listRegisteredSidebarTabs,
  getVisibleSidebarTabs,
  listVisibleSidebarTabs,
  isSidebarTabVisible,
  loadSidebarPanel,
  eagerPanel,
  SidebarTabRegistrationError,
  SETTINGS_TAB_ID,
  type SidebarBadgeStore,
  type SidebarPanelComponent,
  type SidebarPanelLoader,
  type SidebarTabDefinition,
} from "../registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A drawn icon: inline SVG markup, never an emoji (REQ-NPC-094). */
const ICON = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /></svg>';

/** Stand-in for a Svelte component constructor — the registry never calls it. */
function FakePanel(): void {
  /* never invoked by the registry */
}

function loaderFor(component: SidebarPanelComponent): {
  loader: SidebarPanelLoader;
  calls: () => number;
} {
  let calls = 0;
  const loader: SidebarPanelLoader = () => {
    calls += 1;
    return Promise.resolve({ default: component });
  };
  return { loader, calls: () => calls };
}

function tabDef(
  over: Partial<SidebarTabDefinition> & Pick<SidebarTabDefinition, "id">,
): SidebarTabDefinition {
  return {
    icon: ICON,
    label: `FUSION.Sidebar.Tabs.${over.id}`,
    group: "all",
    component: eagerPanel(FakePanel),
    ...over,
  };
}

/** Register the seven MVP tabs of DEC-GAV-01 in trilho order. */
function registerCoreTabs(): void {
  registerSidebarTab(tabDef({ id: "chat", group: "all" }));
  registerSidebarTab(tabDef({ id: "contacts", group: "all" }));
  registerSidebarTab(tabDef({ id: "combat", group: "all" }));
  registerSidebarTab(tabDef({ id: "compendium", group: "all" }));
  registerSidebarTab(tabDef({ id: "npcs", group: "gm" }));
  registerSidebarTab(tabDef({ id: "scenes", group: "gm" }));
  registerSidebarTab(tabDef({ id: SETTINGS_TAB_ID, group: "all" }));
}

beforeEach(() => {
  clearSidebarTabs();
});

// ---------------------------------------------------------------------------
// REQ-GAV-030 — the registration form
// ---------------------------------------------------------------------------

describe("REQ-GAV-030 — registro de abas no cliente", () => {
  it("REQ-GAV-030: aceita { id, icon, label, group, component, badge? } e devolve a aba registrada", () => {
    const badge: SidebarBadgeStore = { value: 3 };
    registerSidebarTab(tabDef({ id: "chat", group: "all", badge }));

    const entry = getSidebarTab("chat");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("chat");
    expect(entry?.icon).toBe(ICON);
    expect(entry?.label).toBe("FUSION.Sidebar.Tabs.chat");
    expect(entry?.group).toBe("all");
    expect(typeof entry?.component).toBe("function");
    expect(entry?.badge?.value).toBe(3);
  });

  it("REQ-GAV-030: badge é opcional — aba sem badge registra e fica sem badge", () => {
    registerSidebarTab(tabDef({ id: "compendium" }));
    expect(getSidebarTab("compendium")?.badge).toBeUndefined();
  });

  it("REQ-GAV-030: o badge é um store reativo lido a cada consulta (number | boolean | null)", () => {
    let unread = 0;
    const badge: SidebarBadgeStore = {
      get value(): number | boolean | null {
        return unread === 0 ? null : unread;
      },
    };
    registerSidebarTab(tabDef({ id: "chat", badge }));

    expect(getSidebarTab("chat")?.badge?.value).toBeNull();
    unread = 2;
    expect(getSidebarTab("chat")?.badge?.value).toBe(2);

    const dot: SidebarBadgeStore = { value: true };
    registerSidebarTab(tabDef({ id: "combat", badge: dot }));
    expect(getSidebarTab("combat")?.badge?.value).toBe(true);
  });

  it("REQ-GAV-030: as sete abas de DEC-GAV-01 entram pela mesma chamada", () => {
    registerCoreTabs();
    expect(listRegisteredSidebarTabs().map((t) => t.id)).toEqual([
      "chat",
      "contacts",
      "combat",
      "compendium",
      "npcs",
      "scenes",
      SETTINGS_TAB_ID,
    ]);
  });

  it("REQ-GAV-030: recusa registro malformado — id vazio, grupo inválido, label vazio, ícone emoji", () => {
    expect(() => registerSidebarTab(tabDef({ id: "  " }))).toThrow(SidebarTabRegistrationError);
    expect(() =>
      registerSidebarTab(tabDef({ id: "x", group: "everyone" as unknown as "all" })),
    ).toThrow(SidebarTabRegistrationError);
    expect(() => registerSidebarTab(tabDef({ id: "y", label: "" }))).toThrow(
      SidebarTabRegistrationError,
    );
    // Ícone desenhado, nunca emoji nem caractere de símbolo (REQ-NPC-094).
    expect(() => registerSidebarTab(tabDef({ id: "z", icon: "⚔" }))).toThrow(
      SidebarTabRegistrationError,
    );
    expect(() => registerSidebarTab(tabDef({ id: "w", icon: "❯" }))).toThrow(
      SidebarTabRegistrationError,
    );
    expect(listRegisteredSidebarTabs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-030 / DEC-GAV-09 — a consulta que o trilho usa
// ---------------------------------------------------------------------------

describe("REQ-GAV-030 — consulta do trilho por papel", () => {
  it("REQ-GAV-030: GM vê grupo all, depois grupo gm, e Configurações ancorada no rodapé (DEC-GAV-09)", () => {
    registerCoreTabs();
    const visible = getVisibleSidebarTabs(true);

    expect(visible.all.map((t) => t.id)).toEqual(["chat", "contacts", "combat", "compendium"]);
    expect(visible.gm.map((t) => t.id)).toEqual(["npcs", "scenes"]);
    expect(visible.footer.map((t) => t.id)).toEqual([SETTINGS_TAB_ID]);
    expect(listVisibleSidebarTabs(true).map((t) => t.id)).toEqual([
      "chat",
      "contacts",
      "combat",
      "compendium",
      "npcs",
      "scenes",
      SETTINGS_TAB_ID,
    ]);
  });

  it("REQ-GAV-030: jogador não vê o grupo gm e mantém Configurações no rodapé, na mesma posição", () => {
    registerCoreTabs();
    const visible = getVisibleSidebarTabs(false);

    expect(visible.all.map((t) => t.id)).toEqual(["chat", "contacts", "combat", "compendium"]);
    expect(visible.gm).toEqual([]);
    expect(visible.footer.map((t) => t.id)).toEqual([SETTINGS_TAB_ID]);
    expect(isSidebarTabVisible("scenes", false)).toBe(false);
    expect(isSidebarTabVisible("scenes", true)).toBe(true);
    expect(isSidebarTabVisible("chat", false)).toBe(true);
    expect(isSidebarTabVisible("nao-registrada", true)).toBe(false);
  });

  it("REQ-GAV-030: aba de teste group 'gm' aparece ao FIM do grupo GM para o GM e some para o jogador", () => {
    registerCoreTabs();
    registerSidebarTab(tabDef({ id: "test-tab", group: "gm" }));

    expect(getVisibleSidebarTabs(true).gm.map((t) => t.id)).toEqual(["npcs", "scenes", "test-tab"]);
    expect(getVisibleSidebarTabs(false).gm).toEqual([]);
    expect(listVisibleSidebarTabs(false).map((t) => t.id)).not.toContain("test-tab");
  });

  it("REQ-GAV-030: aba extra do grupo 'all' entra ao fim do grupo, nunca no rodapé (DEC-GAV-09)", () => {
    registerCoreTabs();
    registerSidebarTab(tabDef({ id: "mod-tab", group: "all" }));

    expect(getVisibleSidebarTabs(false).all.map((t) => t.id)).toEqual([
      "chat",
      "contacts",
      "combat",
      "compendium",
      "mod-tab",
    ]);
    expect(getVisibleSidebarTabs(false).footer.map((t) => t.id)).toEqual([SETTINGS_TAB_ID]);
  });

  it("REQ-GAV-030: sem a aba de Configurações registrada, o rodapé fica vazio", () => {
    registerSidebarTab(tabDef({ id: "chat" }));
    expect(getVisibleSidebarTabs(false).footer).toEqual([]);
    expect(listVisibleSidebarTabs(false).map((t) => t.id)).toEqual(["chat"]);
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-033 — id duplicado
// ---------------------------------------------------------------------------

describe("REQ-GAV-033 — id repetido falha com erro explícito", () => {
  it("REQ-GAV-033: registrar o mesmo id de novo lança erro nomeando o id", () => {
    registerSidebarTab(tabDef({ id: "scenes", group: "gm" }));
    expect(() => registerSidebarTab(tabDef({ id: "scenes", group: "gm" }))).toThrow(
      SidebarTabRegistrationError,
    );
    expect(() => registerSidebarTab(tabDef({ id: "scenes", group: "gm" }))).toThrow(/scenes/);
  });

  it("REQ-GAV-033: o registro NÃO substitui em silêncio — a aba original sobrevive à tentativa", () => {
    const first = eagerPanel(FakePanel);
    registerSidebarTab(
      tabDef({ id: "scenes", group: "gm", label: "FUSION.Sidebar.Tabs.Scenes", component: first }),
    );

    const intruder = eagerPanel(function Other(): void {});
    expect(() =>
      registerSidebarTab(
        tabDef({ id: "scenes", group: "all", label: "INTRUDER", component: intruder }),
      ),
    ).toThrow(SidebarTabRegistrationError);

    const entry = getSidebarTab("scenes");
    expect(entry?.group).toBe("gm");
    expect(entry?.label).toBe("FUSION.Sidebar.Tabs.Scenes");
    expect(entry?.component).toBe(first);
    expect(listRegisteredSidebarTabs()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RNF-GAV-02 — import dinâmico por aba
// ---------------------------------------------------------------------------

describe("RNF-GAV-02 — o trilho não carrega painel de aba não ativa", () => {
  it("RNF-GAV-02: registrar e listar as abas não invoca o loader de painel nenhum", () => {
    const chat = loaderFor(FakePanel);
    const scenes = loaderFor(FakePanel);
    registerSidebarTab(tabDef({ id: "chat", component: chat.loader }));
    registerSidebarTab(tabDef({ id: "scenes", group: "gm", component: scenes.loader }));

    listVisibleSidebarTabs(true);
    getVisibleSidebarTabs(true);

    expect(chat.calls()).toBe(0);
    expect(scenes.calls()).toBe(0);
  });

  it("RNF-GAV-02: só a aba ativa carrega, e a segunda montagem reusa o módulo já carregado", async () => {
    const chat = loaderFor(FakePanel);
    const scenes = loaderFor(FakePanel);
    registerSidebarTab(tabDef({ id: "chat", component: chat.loader }));
    registerSidebarTab(tabDef({ id: "scenes", group: "gm", component: scenes.loader }));

    const panel = await loadSidebarPanel("chat");
    expect(panel).toBe(FakePanel);
    expect(chat.calls()).toBe(1);
    expect(scenes.calls()).toBe(0);

    await loadSidebarPanel("chat");
    expect(chat.calls()).toBe(1);
  });

  it("RNF-GAV-02: carregar aba não registrada falha com erro explícito", async () => {
    await expect(loadSidebarPanel("fantasma")).rejects.toThrow(SidebarTabRegistrationError);
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-032 — sistemas de jogo não registram abas
// ---------------------------------------------------------------------------

describe("REQ-GAV-032 — sistemas de jogo não registram abas no MVP", () => {
  const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../../..");

  function walk(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|mts|svelte|mjs)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("REQ-GAV-032: nenhum arquivo de systems/ chama registerSidebarTab nem importa o registro", () => {
    const files = walk(join(repoRoot, "systems"), []);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("registerSidebarTab") || src.includes("lib/sidebar/registry");
    });
    expect(offenders).toEqual([]);
  });

  it("REQ-GAV-032: o pacote de API de sistema (system-api) não expõe registro de aba de gaveta", () => {
    const files = walk(join(repoRoot, "packages", "system-api", "src"), []);
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("registerSidebarTab"));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// REQ-GAV-031 — mods (V2)
// ---------------------------------------------------------------------------

describe("REQ-GAV-031 — abas de mod", () => {
  // REQ-GAV-031 é [V2]: carregar mod está fora do MVP (REQ-ESC-012). O registro já
  // aceita a mesma chamada e coloca a aba ao fim do grupo declarado — o que falta é
  // o carregador de mods, assunto da spec-filha de Configurações/Mods.
  it.todo("REQ-GAV-031 [V2]: um mod carregado registra aba pela mesma chamada");
});
