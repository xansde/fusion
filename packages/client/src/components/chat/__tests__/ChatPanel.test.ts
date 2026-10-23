/**
 * ChatPanel.test.ts — the shape of the chat tab (plan G033).
 *
 * Rendered with `render()` from `svelte/server`: the client project runs Vitest in a node
 * environment with no jsdom and no testing-library, so the assertions are made on the
 * server-rendered markup. Everything this task owns there is structural.
 *
 * Covers REQ-ACH-010 (fixed bar: search across the width, "⋯" at the right, no title),
 * REQ-ACH-015 **only in the half the panel delivers** — the favourites editor for every role
 * and the GAMEMASTER gate on the two log entries; exporting and clearing have no server
 * operation and are a registered gap (task G041), never a covered requirement, as the second
 * "⋯" block below states at length —, REQ-ACH-020 (the log fills what is left,
 * and the results take its place while a term is typed), REQ-ACH-030 (the box shares its
 * line with the send button and nothing else), REQ-ACH-031 (one row to start) and
 * REQ-ACH-032 (the Enter / Shift+Enter instruction lives in the send button's tooltip,
 * never inside the field).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatPanel from "../ChatPanel.svelte";
import { chatSearch, clearChatSearch } from "../../../lib/chat/chatSearch.svelte.js";
import { chatStore } from "../../../lib/chat/chatStore.svelte.js";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@fusion/shared";

const WORLD = "world-abc";
const USER = "user-1";

/** The panel never touches the socket during a server render. */
const socket = {} as unknown as Socket;

function installStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
      key: (i: number): string | null => [...store.keys()][i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
}

function renderPanel(isGm = false): string {
  const { body } = render(ChatPanel, {
    props: { socket, worldId: WORLD, userId: USER, isGm },
  });
  return body;
}

function makeMessage(id: string, content: string): ChatMessage {
  return {
    _id: id,
    content,
    type: "ic",
    speaker: { userId: "u1", alias: "Tobias" },
    timestamp: 1_700_000_000_000,
    whisper: [],
    blind: false,
  } as unknown as ChatMessage;
}

/** Server-rendered attributes escape quotes; compare against what the markup really holds. */
function escaped(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}

/** Pictographs — the exact class of character the drawer bans. */
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/**
 * The "⋯" menu markup alone. The menu ends where the band below the bar begins: G040 took
 * the dice canvas host out of the panel (RNF-ACH-03), so the favourites row is the landmark.
 */
function menuMarkup(body: string): string {
  return body.slice(body.indexOf('class="chat-panel__menu '), body.indexOf('class="dice-tray'));
}

/** Svelte appends a scope hash to every styled class, so match the class as a token. */
function hasClass(body: string, className: string): boolean {
  return new RegExp(`class="${className}[ "]`).test(body);
}

beforeEach(() => {
  installStorage();
  clearChatSearch();
  chatStore.messages = [];
});

afterEach(() => {
  clearChatSearch();
  chatStore.messages = [];
});

describe("barra superior fixa: pesquisa e ⋯, sem título (REQ-ACH-010)", () => {
  it("draws a search field and a more-actions button, and no heading", () => {
    const body = renderPanel();

    expect(hasClass(body, "chat-panel__bar")).toBe(true);
    expect(body).toContain('type="search"');
    expect(body).toContain(escaped(t("FUSION.Chat.Search.Label")));
    expect(body).toContain('aria-haspopup="menu"');
    // No textual title of the tab: the lit rail icon already says where the reader is.
    expect(body).not.toMatch(/<h[1-6][\s>]/);

    // Nothing is written between the bar opening and the search field — the bar starts
    // with the field, it does not start with a label.
    const barOpen = body.indexOf(">", body.indexOf('class="chat-panel__bar')) + 1;
    const searchOpen = body.lastIndexOf("<", body.indexOf('class="chat-panel__search'));
    const beforeSearch = body.slice(barOpen, searchOpen);
    expect(beforeSearch.replace(/<[^>]*>/g, "").trim()).toBe("");
  });

  it("shows the same bar to a player and to the GAMEMASTER", () => {
    const player = renderPanel(false);
    const gm = renderPanel(true);
    for (const body of [player, gm]) {
      expect(body).toContain('type="search"');
      expect(body).toContain('aria-haspopup="menu"');
    }
  });

  it("uses drawn icons and no emoji", () => {
    const body = renderPanel(true);
    expect(body).toContain("<svg");
    expect(PICTOGRAPH.test(body)).toBe(false);
  });
});

/**
 * The half of REQ-ACH-015 this panel really delivers: the favourites editor opens for every
 * role, and the two log entries are gated on `role === GAMEMASTER`. Nothing here reads the
 * disabled state as fulfilment — that lives in its own block below, on purpose.
 */
describe("o menu ⋯ abre o editor de favoritos para qualquer papel (REQ-ACH-015)", () => {
  it("offers the favourites editor to a player, and nothing about the log", () => {
    const body = renderPanel(false);

    expect(body).toContain('data-action="favorites"');
    expect(body).toContain(t("FUSION.Chat.Menu.Favorites"));
    expect(body).not.toContain('data-action="export"');
    expect(body).not.toContain('data-action="clear-log"');
  });

  it("keeps the favourites entry live for every role — it is the one that acts", () => {
    for (const body of [renderPanel(false), renderPanel(true)]) {
      const menu = menuMarkup(body);
      expect(menu).toMatch(/data-action="favorites"(?![^>]* disabled)/);
    }
  });

  it("shows the two log entries to the GAMEMASTER alone (role gate, REQ-ACH-015)", () => {
    const body = renderPanel(true);

    expect(body).toContain('data-action="favorites"');
    expect(body).toContain('data-action="export"');
    expect(body).toContain('data-action="clear-log"');
  });

  it("starts closed and is a real menu of real buttons", () => {
    const body = renderPanel(true);
    expect(body).toContain('aria-expanded="false"');
    expect(body).toMatch(/class="chat-panel__menu [^"]*"[^>]*role="menu"/);
    expect(body).toMatch(/class="chat-panel__menu [^>]*hidden=""/);
    expect(body).toContain('role="menuitem"');
  });
});

/**
 * LEIA ANTES DE CONTAR COBERTURA. Este bloco prova o OPOSTO de um requisito entregue: que
 * exportar e limpar o log NÃO agem. As citações de REQ-CHT-006 (flush) e REQ-CHT-037
 * (export) que aparecem aqui e no componente são **pendência registrada**, nunca prova de
 * comportamento — não existe handler para nenhuma das duas no servidor, e a spec 38 §5.10
 * exige que ambas sejam verificadas lá, então o painel também não pode fabricá-las no
 * cliente. A operação está registrada como tarefa própria: G041 em
 * `docs/design/gaveta-lateral/tasks.md`. Enquanto ela não existir, REQ-ACH-015 está
 * entregue pela METADE — o painel põe os dois itens onde a spec manda, desabilitados e com
 * o motivo, e quem auditar a rastreabilidade tem que ler isto como lacuna aberta.
 */
describe("exportar e limpar seguem sem operação de servidor: o painel não finge que agem", () => {
  it("draws both entries disabled, with the reason, instead of a control that does nothing", () => {
    const body = renderPanel(true);
    const menu = menuMarkup(body);
    const reason = escaped(t("FUSION.Chat.Menu.Unavailable"));

    expect(menu).toMatch(/data-action="export"[^>]* disabled/);
    expect(menu).toMatch(/data-action="clear-log"[^>]* disabled/);
    // Exactly those two, and nothing else in the menu, is inert.
    expect(menu.match(/ disabled/g)).toHaveLength(2);
    expect(menu).toContain(reason);
    expect(menu).toMatch(/title="[^"]*Indispon/);
  });
});

describe("o log ocupa o meio, e a pesquisa toma o lugar dele (REQ-ACH-020)", () => {
  it("mounts the live log while the field is empty", () => {
    const body = renderPanel();
    expect(hasClass(body, "chat-log")).toBe(true);
    expect(hasClass(body, "chat-panel__results")).toBe(false);
  });

  it("replaces the log with the results as soon as the field holds a term", () => {
    chatSearch.term = "porta";
    chatSearch.results = [makeMessage("m1", "a porta secreta range")];

    const body = renderPanel();

    expect(hasClass(body, "chat-panel__results")).toBe(true);
    expect(hasClass(body, "chat-log")).toBe(false);
  });

  it("shows author, time and the marked term on each result (REQ-ACH-011)", () => {
    chatSearch.term = "porta";
    chatSearch.results = [makeMessage("m1", "a porta secreta range")];

    const body = renderPanel();

    expect(body).toContain('data-message-id="m1"');
    expect(body).toContain("Tobias");
    expect(body).toContain("chat-panel__result-time");
    expect(body).toContain("<mark");
    expect(body).toContain("porta</mark>");
  });

  it("says so when a term finds nothing, instead of falling back to the log", () => {
    chatSearch.term = "nada disso";
    chatSearch.results = [];

    const body = renderPanel();

    expect(body).toContain(t("FUSION.Chat.Search.Empty"));
    expect(hasClass(body, "chat-log")).toBe(false);
  });

  it("keeps the favourites row and the box below whatever is on screen", () => {
    chatSearch.term = "porta";
    chatSearch.results = [makeMessage("m1", "porta")];

    const body = renderPanel();

    expect(hasClass(body, "dice-tray")).toBe(true);
    expect(body).toContain("chat-input__textarea");
    // Order on screen: results/log, then the favourites row, then the box (REQ-ACH-020).
    expect(body.indexOf("chat-panel__results")).toBeLessThan(body.indexOf('class="dice-tray'));
    expect(body.indexOf('class="dice-tray')).toBeLessThan(body.indexOf("chat-input__textarea"));
  });
});

describe("a caixa de escrita e o botão de enviar (REQ-ACH-030, REQ-ACH-031, REQ-ACH-032)", () => {
  it("puts the box and the send button alone on their line", () => {
    const body = renderPanel();
    const line = body.slice(
      body.indexOf('class="chat-input__line'),
      body.indexOf('role="radiogroup"'),
    );

    expect(line).toContain("<textarea");
    // Exactly one control beside the field on that line: the send button.
    expect(line.match(/<button/g)).toHaveLength(1);
    expect(line).not.toContain('role="radiogroup"');
  });

  it("keeps the roll mode selector on its own line, below the box (REQ-ACH-040)", () => {
    const body = renderPanel();
    expect(body.indexOf("chat-input__line")).toBeLessThan(body.indexOf('role="radiogroup"'));
    expect(body.indexOf("<textarea")).toBeLessThan(body.indexOf('role="radiogroup"'));
  });

  it("starts as a single row", () => {
    const body = renderPanel();
    expect(body).toMatch(/<textarea[^>]*rows="1"/);
  });

  it("carries the Enter / Shift+Enter instruction in the button's tooltip, not in the field", () => {
    const body = renderPanel();
    const hint = escaped(t("FUSION.Chat.Compose.SendHint"));

    expect(body).toContain(`title="${hint}"`);
    expect(body).toContain(`aria-label="${hint}"`);
    // The placeholder is short and instruction-free (REQ-ACH-031).
    expect(body).toContain(`placeholder="${escaped(t("FUSION.Chat.Compose.Placeholder"))}"`);
    expect(body).not.toMatch(/placeholder="[^"]*Enter/);
    expect(body).not.toMatch(/placeholder="[^"]*Shift/);
  });
});
