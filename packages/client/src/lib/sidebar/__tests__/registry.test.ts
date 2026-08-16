/**
 * registry.test.ts — the sidebar (drawer) tab registry.
 *
 * Covers:
 *  - REQ-GAV-030 [MVP] the `registerSidebarTab({ id, icon, label, group, component, badge? })`
 *    shape and the rail query (group "all" → group "gm" → footer, DEC-GAV-09).
 *  - REQ-GAV-004 [MVP] a "gm" tab never reaches a non-privileged role — footer included,
 *    and with both queries of the module agreeing about the same tab.
 *  - REQ-GAV-032 [MVP] game systems do not register tabs in the MVP.
 *  - REQ-GAV-033 [MVP] registering a duplicate id fails loudly and never replaces.
 *  - REQ-GAV-031 [V2] mods registering tabs — declared only, out of the MVP; the icon
 *    allowlist is what makes that same door safe, since the rail injects the markup.
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
import { sidebarIcons } from "../../../components/sidebar/icons.js";

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
// REQ-GAV-030 / REQ-GAV-031 — o ícone é injetado no DOM pelo trilho ({@html}),
// então o registro é a porta que precisa provar que ele é um SVG desenhado.
// ---------------------------------------------------------------------------

describe("REQ-GAV-030 — o ícone registrado é markup que o trilho pode injetar", () => {
  it("REQ-GAV-030: recusa markup que contém '<svg' mas carrega script, handler ou segunda raiz", () => {
    const hostile: readonly string[] = [
      // Handler no próprio <svg> — o caso que passava por `includes("<svg")`.
      '<svg onload="alert(1)"></svg>',
      '<svg viewBox="0 0 24 24"><path d="M0 0h1v1H0z" onclick="alert(1)"/></svg>',
      // Segundo elemento raiz colado depois do SVG.
      '<svg></svg><img src="x" onerror="alert(1)">',
      // Script embutido na árvore do SVG.
      '<svg viewBox="0 0 24 24"><script>alert(1)</' + "script></svg>",
      // Elementos que buscam ou executam recurso externo.
      '<svg viewBox="0 0 24 24"><foreignObject><b>hi</b></foreignObject></svg>',
      '<svg viewBox="0 0 24 24"><use href="data:image/svg+xml,x"/></svg>',
      '<svg viewBox="0 0 24 24"><image href="javascript:alert(1)"/></svg>',
      '<svg viewBox="0 0 24 24"><animate onbegin="alert(1)" attributeName="x"/></svg>',
      // Atributos que carregam URL ou CSS.
      '<svg viewBox="0 0 24 24"><path d="M0 0h1v1H0z" style="background:url(javascript:alert(1))"/></svg>',
      '<svg viewBox="0 0 24 24"><a href="javascript:alert(1)"><path d="M0 0h1v1H0z"/></a></svg>',
      // Comentário condicional / doctype antes da raiz.
      "<!--<svg></svg>--><svg></svg>",
      // Markup que nem começa por <svg>.
      '<img src="x" onerror="alert(1)"><svg></svg>',
      // Valor de atributo não fechado, que escaparia do parser ingênuo.
      '<svg viewBox="0 0 24 24><path d="M0 0h1v1H0z"/></svg>',
    ];

    for (const icon of hostile) {
      expect(
        () => registerSidebarTab(tabDef({ id: `hostile-${icon.length}`, icon })),
        icon,
      ).toThrow(SidebarTabRegistrationError);
    }
    expect(listRegisteredSidebarTabs()).toHaveLength(0);
  });

  it("REQ-GAV-031: a mesma porta que um mod usará aceita o SVG desenhado das abas do núcleo", () => {
    // Os ícones reais (não uma cópia deles) precisam atravessar o mesmo portão.
    let registered = 0;
    for (const [id, icon] of Object.entries(sidebarIcons)) {
      registerSidebarTab(tabDef({ id, icon }));
      expect(getSidebarTab(id)?.icon).toBe(icon);
      registered += 1;
    }
    expect(registered).toBeGreaterThanOrEqual(7);

    // E formas legítimas que um mod poderia desenhar continuam entrando.
    registerSidebarTab(
      tabDef({
        id: "mod-tab",
        icon:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="1.75">\n  <g transform="translate(1 1)">' +
          '<rect x="2" y="2" width="8" height="8" rx="1"/><polyline points="1,1 5,5"/>' +
          "</g>\n</svg>",
      }),
    );
    expect(getSidebarTab("mod-tab")).toBeDefined();
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

  it("REQ-GAV-004: aba de rodapé declarada no grupo 'gm' some para o jogador — o rodapé não é exceção ao filtro", () => {
    // O rodapé é uma POSIÇÃO (DEC-GAV-09), não uma isenção: se a aba de Configurações
    // for registrada no grupo "gm", ela tem que desaparecer do trilho do jogador como
    // qualquer outra aba de GM (REQ-GAV-004).
    registerSidebarTab(tabDef({ id: "chat", group: "all" }));
    registerSidebarTab(tabDef({ id: SETTINGS_TAB_ID, group: "gm" }));

    expect(getVisibleSidebarTabs(false).footer).toEqual([]);
    expect(listVisibleSidebarTabs(false).map((t) => t.id)).toEqual(["chat"]);

    // E o GM continua vendo-a ancorada no rodapé.
    expect(getVisibleSidebarTabs(true).footer.map((t) => t.id)).toEqual([SETTINGS_TAB_ID]);
    expect(getVisibleSidebarTabs(true).gm).toEqual([]);
  });

  it("REQ-GAV-004: as duas consultas concordam sobre a mesma aba, para qualquer papel", () => {
    // `listVisibleSidebarTabs` alimenta o `visibleTabIds` da gaveta (o guarda de
    // `select`), enquanto `isSidebarTabVisible` decide a restauração da aba salva.
    // Divergirem significaria um painel montável por um clique que o trilho nega.
    registerSidebarTab(tabDef({ id: "chat", group: "all" }));
    registerSidebarTab(tabDef({ id: "scenes", group: "gm" }));
    registerSidebarTab(tabDef({ id: "mod-tab", group: "gm" }));
    // A aba do rodapé entra no grupo "gm": é exatamente aqui que as duas consultas
    // divergiam — o rodapé escapava do filtro, a consulta por id não.
    registerSidebarTab(tabDef({ id: SETTINGS_TAB_ID, group: "gm" }));

    for (const isPrivileged of [false, true]) {
      const listed = new Set(listVisibleSidebarTabs(isPrivileged).map((t) => t.id));
      for (const tab of listRegisteredSidebarTabs()) {
        expect(isSidebarTabVisible(tab.id, isPrivileged)).toBe(listed.has(tab.id));
      }
    }
  });

  it("REQ-GAV-004: a aba de rodapé no grupo 'gm' não escapa nem pela consulta por id", () => {
    registerSidebarTab(tabDef({ id: SETTINGS_TAB_ID, group: "gm" }));
    expect(isSidebarTabVisible(SETTINGS_TAB_ID, false)).toBe(false);
    expect(isSidebarTabVisible(SETTINGS_TAB_ID, true)).toBe(true);
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
  // REQ-GAV-031 é [V2]: carregar mod está fora do MVP — a spec 00 veta carregamento
  // dinâmico de plugin de terceiros. O registro já aceita a mesma chamada e coloca a
  // aba ao fim do grupo declarado — o que falta é o carregador de mods, assunto da
  // spec-filha de Configurações/Mods.
  it.todo("REQ-GAV-031 [V2]: um mod carregado registra aba pela mesma chamada");

  it("claims spec 00's compiled-systems rule where it is honoured, not here", () => {
    // `tools/spec-lint` counts ANY requirement id spelled inside `__tests__` as covered by
    // a test, and the coverage floor never goes back down. The [MVP] clause of spec 00 —
    // game systems are packages compiled into the monorepo, with no dynamic third-party
    // plugin loading — is not exercised anywhere in this file: the block above holds a
    // single `it.todo`, which asserts nothing. So that id must not be spelled here. It is
    // assembled from parts so this guard does not itself make the claim it guards against.
    const compiledSystemsId = ["REQ", "ESC", "012"].join("-");

    expect(readFileSync(fileURLToPath(import.meta.url), "utf8")).not.toContain(compiledSystemsId);
    // It stays cited in the registry, the production module that documents the restriction —
    // which the trace then reports as "cited only by production code".
    expect(
      readFileSync(fileURLToPath(new URL("../registry.ts", import.meta.url)), "utf8"),
    ).toContain(compiledSystemsId);
  });
});
