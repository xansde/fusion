/**
 * chatUnreadMarker.test.ts — "abrir é o gesto de ler" (plano G037).
 *
 * Spec 38 (`specs/38-aba-chat.md`) §5.1/§5.3 §6. The counting rule itself is next
 * door in `chatUnread.test.ts` (REQ-CHT-039); what is proved HERE is everything the
 * counter is *for*:
 *
 *  - the badge of the tab is that counter, of the counter kind (REQ-ACH-002);
 *  - it moves only while the tab is closed (REQ-ACH-003);
 *  - opening zeroes it AND leaves behind the "N novas" divider anchored at the
 *    first unread, because landing at the end of the log would lose exactly the
 *    messages the badge promised (REQ-ACH-004);
 *  - only reaching the end retires the divider — a tab switch never recreates it
 *    (REQ-ACH-005);
 *  - with the tab open and the log scrolled up, a new message neither moves the
 *    log nor lights the rail (REQ-ACH-006);
 *  - landing on the first unread reads the page pagination already brought in,
 *    never the whole history (RNF-ACH-02);
 *  - draft, log position and ↑↓ history live outside the panel component, which
 *    the drawer unmounts on every tab switch (REQ-ACH-026, REQ-GAV-017).
 *
 * The client suite runs in a node environment with no DOM, so the two facts that
 * only exist inside `ChatLog.svelte` (where the divider is drawn, and that the
 * position is handed to the session before the component goes) are read from its
 * source — the same trap `chatUnread.test.ts` uses for the panel pair.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChatMessage } from "@fusion/shared";

import {
  chatInputHistory,
  chatSession,
  chatStore,
  dismissUnreadMarker,
  handleIncomingMessage,
  resetChatSession,
  resolveUnreadAnchorIndex,
  setChatTabVisible,
} from "../chatStore.svelte.js";
import { ScrollStateManager, resolveMarkerAnchorId } from "../scrollState.js";
import { chatUnreadBadge } from "../../sidebar/registerCoreTabs.js";
import { formatSidebarBadge } from "../../sidebar/badges.svelte.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let nextId = 0;

function makeTextMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  nextId += 1;
  return {
    _id: `msg${String(nextId)}`,
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "user1",
      createdBy: "user1",
      coreVersion: "0.1.0",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 1,
      systemSchemaVersion: null,
    },
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    type: "text",
    worldId: "world1",
    content: "hello",
    speaker: { userId: "user1", alias: "Alice" },
    timestamp: 1000 + nextId,
    whisper: [],
    blind: false,
    ...overrides,
  } as unknown as ChatMessage;
}

/** Receive `n` messages and hand back the ones that arrived, in order. */
function receive(n: number): ChatMessage[] {
  const received: ChatMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    const msg = makeTextMessage();
    handleIncomingMessage(msg);
    received.push(msg);
  }
  return received;
}

function makeScrollHarness(): {
  manager: ScrollStateManager;
  scrollCalls: number[];
  notices: { visible: boolean; count: number }[];
  endReached: number;
} {
  const harness = {
    scrollCalls: [] as number[],
    notices: [] as { visible: boolean; count: number }[],
    endReached: 0,
    manager: null as unknown as ScrollStateManager,
  };
  harness.manager = new ScrollStateManager({
    scrollToBottom: () => harness.scrollCalls.push(1),
    setIndicatorVisible: (visible, count) => harness.notices.push({ visible, count }),
    reachedEnd: () => {
      harness.endReached += 1;
    },
  });
  return harness;
}

/** Raw source of a file, relative to this test. */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

beforeEach(() => {
  setChatTabVisible(false);
  chatStore.messages = [];
  chatStore.unreadCount = 0;
  chatStore.hasMore = false;
  chatStore.nextCursor = null;
  dismissUnreadMarker();
  resetChatSession();
});

// ---------------------------------------------------------------------------
// Badge (REQ-ACH-002, REQ-ACH-003)
// ---------------------------------------------------------------------------

describe("REQ-ACH-002 / REQ-ACH-003 — o badge da aba é o contador de não lidas", () => {
  it("REQ-ACH-002: o badge registrado da aba é do tipo contador e vale o não-lido do chat", () => {
    receive(3);

    expect(chatUnreadBadge.value).toBe(3);
    expect(formatSidebarBadge(chatUnreadBadge.value)).toEqual({ kind: "counter", text: "3" });
  });

  it("REQ-ACH-003: mensagem recebida com a aba fechada incrementa o contador", () => {
    receive(2);

    expect(chatStore.unreadCount).toBe(2);
    expect(chatUnreadBadge.value).toBe(2);
  });

  it("REQ-ACH-003 / REQ-ACH-006: com a aba aberta o contador não sobe e o trilho não acende", () => {
    setChatTabVisible(true);

    receive(4);

    expect(chatStore.unreadCount).toBe(0);
    // The messages arrived — what did not happen is the badge.
    expect(chatStore.messages).toHaveLength(4);
    expect(formatSidebarBadge(chatUnreadBadge.value).kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Opening (REQ-ACH-004, REQ-CHT-039)
// ---------------------------------------------------------------------------

describe("REQ-ACH-004 — abrir zera o contador e marca a primeira não lida", () => {
  it("REQ-ACH-004 / REQ-CHT-039: abrir zera o contador e deixa o marcador na primeira não lida", () => {
    const older = makeTextMessage();
    setChatTabVisible(true);
    handleIncomingMessage(older); // read while the tab was open — not unread
    setChatTabVisible(false);

    const unread = receive(3);

    setChatTabVisible(true);

    expect(chatStore.unreadCount).toBe(0);
    expect(chatStore.unreadMarker).toEqual({ firstUnreadId: unread[0]?._id, count: 3 });
    // Not the last one, and not the message that was already read.
    expect(chatStore.unreadMarker?.firstUnreadId).not.toBe(older._id);
    expect(chatStore.unreadMarker?.firstUnreadId).not.toBe(unread[2]?._id);
  });

  it("REQ-ACH-004: o marcador resolve para a posição da primeira não lida no log carregado", () => {
    setChatTabVisible(true);
    handleIncomingMessage(makeTextMessage());
    handleIncomingMessage(makeTextMessage());
    setChatTabVisible(false);
    const unread = receive(2);
    setChatTabVisible(true);

    // Two read messages before it: the divider lands at index 2, not at the end.
    expect(resolveUnreadAnchorIndex()).toBe(2);
    expect(chatStore.messages[2]?._id).toBe(unread[0]?._id);
    expect(resolveUnreadAnchorIndex()).toBeLessThan(chatStore.messages.length - 1);
  });

  it("REQ-ACH-004: o marcador fica imediatamente acima da linha da primeira não lida", () => {
    setChatTabVisible(true);
    handleIncomingMessage(makeTextMessage());
    setChatTabVisible(false);
    const unread = receive(2);
    setChatTabVisible(true);

    const orderedIds = chatStore.messages.map((m) => m._id);
    expect(
      resolveMarkerAnchorId(orderedIds, orderedIds, chatStore.unreadMarker?.firstUnreadId),
    ).toBe(unread[0]?._id);
  });

  it("REQ-ACH-004: rolagem filha não é linha do log — o marcador cai na linha do card que a contém", () => {
    // The first unread is a nested roll: it is drawn inside its parent's card and
    // has no row of its own, so the divider goes above the row the reader has to
    // look at — the parent card.
    const orderedIds = ["a", "card", "childRoll", "b"];
    const topLevelIds = ["a", "card", "b"];

    expect(resolveMarkerAnchorId(orderedIds, topLevelIds, "childRoll")).toBe("b");
  });

  it("REQ-ACH-004: abrir sem nada não lido não inventa marcador", () => {
    setChatTabVisible(true);

    expect(chatStore.unreadMarker).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Retiring the divider (REQ-ACH-005)
// ---------------------------------------------------------------------------

describe("REQ-ACH-005 — o marcador só some ao alcançar o fim do log", () => {
  it("REQ-ACH-005: trocar de aba e voltar não recria o marcador já retirado", () => {
    receive(2);
    setChatTabVisible(true);
    expect(chatStore.unreadMarker).not.toBeNull();

    // The reader reached the end — the log retires it.
    dismissUnreadMarker();
    expect(chatStore.unreadMarker).toBeNull();

    // Switch away and back, with nothing new in between.
    setChatTabVisible(false);
    setChatTabVisible(true);

    expect(chatStore.unreadMarker).toBeNull();
  });

  it("REQ-ACH-005: recolher a gaveta com o marcador de pé o preserva intacto", () => {
    const unread = receive(2);
    setChatTabVisible(true);
    const before = chatStore.unreadMarker;

    setChatTabVisible(false);
    setChatTabVisible(true);

    expect(chatStore.unreadMarker).toEqual(before);
    expect(chatStore.unreadMarker?.firstUnreadId).toBe(unread[0]?._id);
  });

  it("REQ-ACH-005: novas não lidas somam ao marcador de pé sem mover a âncora", () => {
    const first = receive(2);
    setChatTabVisible(true);
    setChatTabVisible(false);

    receive(3);
    setChatTabVisible(true);

    expect(chatStore.unreadMarker).toEqual({ firstUnreadId: first[0]?._id, count: 5 });
  });

  it("REQ-ACH-005: alcançar o fim rolando avisa uma vez só", () => {
    const h = makeScrollHarness();
    h.manager.onScroll(0, 1000, 300); // scrolled up
    expect(h.endReached).toBe(0);

    h.manager.onScroll(700, 1000, 300); // back at the end
    expect(h.endReached).toBe(1);

    h.manager.onScroll(695, 1000, 300); // still at the end — not a new arrival
    expect(h.endReached).toBe(1);
  });

  it("REQ-ACH-005: abrir na primeira não lida NÃO conta como ter alcançado o fim", () => {
    const h = makeScrollHarness();

    h.manager.positionAtAnchor();

    expect(h.endReached).toBe(0);
    expect(h.manager.pinned).toBe(false);
  });

  it("REQ-ACH-005 / REQ-ACH-006: log que cabe na tela já É o fim — a âncora não deixa o marcador de pé", () => {
    // Sessão recém-começada: o log inteiro cabe na altura da gaveta, então não
    // sobra rolagem nenhuma (scrollHeight === clientHeight) e nenhum evento de
    // scroll vai acontecer depois da montagem. Pousar na âncora aqui é pousar no
    // fim do log: o marcador tem que se retirar (REQ-ACH-005) e a vista tem que
    // voltar a grudar, senão a próxima mensagem acende "↓ 1 nova" apontando para
    // uma linha que já está à vista (REQ-ACH-006).
    const h = makeScrollHarness();

    h.manager.positionAtAnchor();
    h.manager.onScroll(0, 300, 300);

    expect(h.endReached).toBe(1);
    expect(h.manager.pinned).toBe(true);

    h.manager.onNewMessage();

    expect(h.manager.pendingCount).toBe(0);
    expect(h.notices.at(-1)).toEqual({ visible: false, count: 0 });
  });

  it("REQ-ACH-005: o log entrega as métricas reais depois de pousar na âncora", () => {
    // Sem isso o caso "não há o que rolar" nunca chega ao gerenciador, e o
    // marcador fica de pé para sempre — o defeito que este par de testes fecha.
    const log = source("../../../components/chat/ChatLog.svelte")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(log).toMatch(
      /positionAtAnchor\(\);\s*scrollManager\.onScroll\(\s*logEl\.scrollTop,\s*logEl\.scrollHeight,\s*logEl\.clientHeight,?\s*\);\s*return true;/,
    );
  });

  it("REQ-ACH-005: âncora no meio de um log longo continua sem retirar o marcador", () => {
    // A contraprova do teste acima: entregar as métricas não pode retirar o
    // marcador de quem realmente parou no meio do log.
    const h = makeScrollHarness();

    h.manager.positionAtAnchor();
    h.manager.onScroll(120, 2000, 300);

    expect(h.endReached).toBe(0);
    expect(h.manager.pinned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// New message must not steal the scroll (REQ-ACH-006)
// ---------------------------------------------------------------------------

describe("REQ-ACH-006 — com o log fora do fim, mensagem nova não rouba o scroll", () => {
  it("REQ-ACH-006: mensagem nova fora do fim não rola o log e acumula no aviso", () => {
    const h = makeScrollHarness();
    h.manager.onScroll(0, 1000, 300); // reader scrolled up
    const scrollsBefore = h.scrollCalls.length;

    h.manager.onNewMessage();
    h.manager.onNewMessage();
    h.manager.onNewMessage();

    expect(h.scrollCalls).toHaveLength(scrollsBefore); // the log did not move
    expect(h.manager.pendingCount).toBe(3);
    expect(h.notices.at(-1)).toEqual({ visible: true, count: 3 });
  });

  it("REQ-ACH-006: acionar o aviso leva ao fim e o zera", () => {
    const h = makeScrollHarness();
    h.manager.onScroll(0, 1000, 300);
    h.manager.onNewMessage();
    const scrollsBefore = h.scrollCalls.length;

    h.manager.jumpToBottom();

    expect(h.scrollCalls.length).toBeGreaterThan(scrollsBefore);
    expect(h.manager.pendingCount).toBe(0);
    expect(h.notices.at(-1)).toEqual({ visible: false, count: 0 });
    expect(h.endReached).toBe(1); // reaching the end retires the divider (REQ-ACH-005)
  });

  it("REQ-ACH-006: no fim do log a mensagem nova continua rolando junto", () => {
    const h = makeScrollHarness();

    h.manager.onNewMessage();

    expect(h.scrollCalls).toHaveLength(1);
    expect(h.manager.pendingCount).toBe(0);
  });

  it("REQ-ACH-006: o aviso do log não acende o badge do trilho", () => {
    setChatTabVisible(true);
    const h = makeScrollHarness();
    h.manager.onScroll(0, 1000, 300);

    receive(2);
    h.manager.onNewMessage();
    h.manager.onNewMessage();

    expect(h.manager.pendingCount).toBe(2);
    expect(formatSidebarBadge(chatUnreadBadge.value).kind).toBe("none");
  });

  it("REQ-ACH-006: o log desenha o aviso com a contagem acumulada", () => {
    const log = source("../../../components/chat/ChatLog.svelte");
    expect(log).toMatch(/FUSION\.Chat\.Log\.NewBelow/);
    expect(log).toMatch(/pendingBelow/);
  });
});

// ---------------------------------------------------------------------------
// Positioning without loading the whole history (RNF-ACH-02)
// ---------------------------------------------------------------------------

describe("RNF-ACH-02 — posicionar na primeira não lida sem carregar o histórico inteiro", () => {
  it("RNF-ACH-02: com histórico extenso ainda paginado, a âncora é resolvida na página carregada", () => {
    setChatTabVisible(true);
    for (let i = 0; i < 200; i += 1) handleIncomingMessage(makeTextMessage());
    // There is much more history behind the cursor.
    chatStore.hasMore = true;
    chatStore.nextCursor = chatStore.messages[0]?._id ?? null;
    const cursorBefore = chatStore.nextCursor;

    setChatTabVisible(false);
    const unread = receive(2);
    setChatTabVisible(true);

    expect(resolveUnreadAnchorIndex()).toBe(200);
    expect(chatStore.messages[200]?._id).toBe(unread[0]?._id);
    // Resolving the anchor is a read of what is loaded: pagination did not move.
    expect(chatStore.hasMore).toBe(true);
    expect(chatStore.nextCursor).toBe(cursorBefore);
  });

  it("RNF-ACH-02: âncora que saiu da página carregada não dispara busca — some sem marcador", () => {
    receive(2);
    setChatTabVisible(true);
    chatStore.hasMore = true;
    chatStore.nextCursor = "cursor-1";

    // The anchor aged out of the loaded window (older page dropped).
    chatStore.messages = chatStore.messages.slice(2);

    expect(chatStore.unreadMarker).not.toBeNull(); // still declared…
    expect(resolveUnreadAnchorIndex()).toBe(-1); // …but nothing to point at
    const orderedIds = chatStore.messages.map((m) => m._id);
    expect(
      resolveMarkerAnchorId(orderedIds, orderedIds, chatStore.unreadMarker?.firstUnreadId),
    ).toBeNull();
    expect(chatStore.hasMore).toBe(true);
    expect(chatStore.nextCursor).toBe("cursor-1");
  });
});

// ---------------------------------------------------------------------------
// Session scratch (REQ-ACH-026)
// ---------------------------------------------------------------------------

describe("REQ-ACH-026 — rascunho, posição e histórico sobrevivem à troca de aba", () => {
  it("REQ-ACH-026: o rascunho não enviado sobrevive a fechar e reabrir a aba", () => {
    chatSession.draft = "/roll 1d20 pela porta";

    setChatTabVisible(false); // drawer switched away — ChatPanel unmounted
    setChatTabVisible(true); // and back

    expect(chatSession.draft).toBe("/roll 1d20 pela porta");
  });

  it("REQ-ACH-026: a posição do log sobrevive a fechar e reabrir a aba", () => {
    chatSession.scrollTop = 512;

    setChatTabVisible(false);
    setChatTabVisible(true);

    expect(chatSession.scrollTop).toBe(512);
  });

  it("REQ-ACH-026: o histórico de entrada ↑↓ sobrevive a fechar e reabrir a aba", () => {
    chatInputHistory.push("primeira");
    chatInputHistory.push("segunda");

    setChatTabVisible(false);
    setChatTabVisible(true);

    expect(chatInputHistory.navigateUp("")).toBe("segunda");
    expect(chatInputHistory.navigateUp("")).toBe("primeira");
  });

  it("REQ-ACH-026: os três vivem fora do componente do painel, e só o fim da mesa os apaga", () => {
    chatSession.draft = "rascunho";
    chatSession.scrollTop = 42;
    chatInputHistory.push("dita");

    resetChatSession();

    expect(chatSession.draft).toBe("");
    expect(chatSession.scrollTop).toBeNull();
    expect(chatInputHistory.length).toBe(0);
  });

  it("REQ-ACH-026: o ChatLog entrega a posição à sessão ao desmontar e a retoma ao montar", () => {
    // The drawer unmounts the panel on every tab switch (REQ-GAV-017), so a
    // position held in the component is a position thrown away by a click.
    const log = source("../../../components/chat/ChatLog.svelte")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(log).toMatch(/onDestroy\(\(\)\s*=>\s*\{[\s\S]*?chatSession\.scrollTop\s*=/);
    expect(log).toMatch(/onMount\(\(\)\s*=>\s*\{[\s\S]*?chatSession\.scrollTop/);
  });
});
