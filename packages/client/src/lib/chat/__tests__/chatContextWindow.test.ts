/**
 * chatContextWindow.test.ts — a janela de contexto, uma por vez (plano G038).
 *
 * Spec 38 (`specs/38-aba-chat.md`) §5.2:
 *
 *  - REQ-ACH-013: acionar um resultado abre a janela com a mensagem alvo destacada,
 *    as 5 mensagens VISÍVEIS de cada lado e um "mais 5" por lado. Quem conta o que é
 *    vizinho é o servidor (`chat:context`, REQ-CHT-051, provado na lane de servidor):
 *    aqui se prova o outro lado do contrato — o cliente pede a janela, mostra
 *    exatamente a sequência que recebeu e não filtra, não renumera e não desenha
 *    buraco no lugar do que foi pulado.
 *  - REQ-ACH-014: existe no máximo UMA janela de contexto; acionar outro resultado
 *    reaproveita a mesma, e o log ao vivo não se mexe enquanto ela está aberta.
 *
 * O servidor falso abaixo responde com um log já VISÍVEL ao solicitante — que é
 * exatamente o que o handler entrega. Ele não repete a regra de visibilidade do
 * servidor (isso seria teste circular); ele existe para que a janela tenha de quem
 * receber uma resposta honesta.
 *
 * O que só existe dentro de `ChatContextWindow.svelte` (o destaque do alvo, quais
 * controles existem e que ele não toca no log) é provado RENDERIZANDO o componente
 * com `render()` de `svelte/server`: a suíte do cliente roda em ambiente node sem
 * DOM, mas o componente não toca em DOM no setup, então a primeira pintura já
 * carrega tudo que estes requisitos pedem — e uma asserção sobre markup não passa
 * com o bloco dentro de um `{#if false}`, como uma asserção sobre a fonte passaria.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@fusion/shared";

import ChatContextWindow from "../../../components/chat/ChatContextWindow.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../i18n/index.js";
import { t } from "../../i18n/i18n.js";

import {
  CHAT_CONTEXT_PAGE,
  CHAT_CONTEXT_WINDOW_KEY,
  canExpandChatContext,
  chatContext,
  chatContextSequence,
  closeChatContext,
  expandChatContext,
  loadChatContext,
  openChatContextWindow,
  sliceContextSide,
  type ChatContextResult,
} from "../chatContext.svelte.js";
import { chatSession, chatStore } from "../chatStore.svelte.js";
import { windowManager } from "../../windows/window-manager.js";

// ---------------------------------------------------------------------------
// localStorage (window geometry persistence)
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(id: string, content: string, timestamp: number): ChatMessage {
  return {
    _id: id,
    _stats: {
      createdTime: timestamp,
      modifiedTime: timestamp,
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
    content,
    speaker: { userId: "user1", alias: "Alice" },
    timestamp,
    whisper: [],
    blind: false,
  } as unknown as ChatMessage;
}

interface SentEnvelope {
  channel: string;
  type: string;
  payload: { worldId: string; id: string; limit: number };
}

interface FakeServer {
  socket: Socket;
  sent: SentEnvelope[];
}

/**
 * A socket answering `chat:context` over a log the requester can see in full.
 *
 * The neighbour window is symmetric, exactly like the real handler: `limit` on
 * each side, plus the two "there is more beyond this" flags.
 */
function fakeServer(visibleLog: readonly ChatMessage[], failWith?: string): FakeServer {
  const sent: SentEnvelope[] = [];
  const socket = {
    emit(channel: string, envelope: SentEnvelope, ack: (res: unknown) => void): void {
      sent.push({ channel, type: envelope.type, payload: envelope.payload });
      if (failWith !== undefined) {
        ack({ ok: false, code: "NOT_FOUND", message: failWith });
        return;
      }
      const { id, limit } = envelope.payload;
      const index = visibleLog.findIndex((m) => m._id === id);
      if (index < 0) {
        ack({ ok: false, code: "NOT_FOUND", message: "Message not found" });
        return;
      }
      const firstBefore = Math.max(0, index - limit);
      const result: ChatContextResult = {
        target: visibleLog[index] as ChatMessage,
        before: visibleLog.slice(firstBefore, index) as ChatMessage[],
        after: visibleLog.slice(index + 1, index + 1 + limit) as ChatMessage[],
        hasMoreBefore: firstBefore > 0,
        hasMoreAfter: index + 1 + limit < visibleLog.length,
      };
      ack({ ok: true, result });
    },
  };
  return { socket: socket as unknown as Socket, sent };
}

/** A visible log of `n` lines: `v0`…`v{n-1}`. */
function visibleLog(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_unused, i) =>
    makeMessage(`v${String(i)}`, `linha ${String(i)}`, 1000 + i),
  );
}

const ids = (messages: readonly ChatMessage[]): string[] => messages.map((m) => m._id);

function closeAllWindows(): void {
  for (const id of [...windowManager.windows.keys()]) windowManager.close(id);
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear();
  closeAllWindows();
  closeChatContext();
  chatStore.messages = [];
  chatStore.unreadMarker = null;
  chatSession.scrollTop = null;
});

// ---------------------------------------------------------------------------
// REQ-ACH-013 — a janela: alvo, ±5 visíveis, "mais 5" de cada lado
// ---------------------------------------------------------------------------

describe("REQ-ACH-013: janela de contexto com o alvo e ±5 visíveis", () => {
  it("REQ-ACH-013: acionar um resultado consulta chat:context e mostra 5 visíveis de cada lado do alvo", async () => {
    const server = fakeServer(visibleLog(21));

    await loadChatContext(server.socket, "world1", "v10");

    // A consulta é uma LEITURA: vai pelo canal `query`, com o id do alvo e o
    // limite de 5 por lado.
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]?.channel).toBe("query");
    expect(server.sent[0]?.type).toBe("chat:context");
    expect(server.sent[0]?.payload).toEqual({
      worldId: "world1",
      id: "v10",
      limit: CHAT_CONTEXT_PAGE,
    });

    expect(chatContext.target?._id).toBe("v10");
    expect(ids(chatContext.before)).toEqual(["v5", "v6", "v7", "v8", "v9"]);
    expect(ids(chatContext.after)).toEqual(["v11", "v12", "v13", "v14", "v15"]);
    // E a janela é uma sequência contínua com o alvo no meio.
    expect(ids(chatContextSequence())).toEqual([
      "v5",
      "v6",
      "v7",
      "v8",
      "v9",
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
    ]);
  });

  it("REQ-ACH-013: “mais 5” cresce SÓ o lado acionado", async () => {
    const server = fakeServer(visibleLog(41));
    await loadChatContext(server.socket, "world1", "v20");

    await expandChatContext("before");
    expect(ids(chatContext.before)).toEqual([
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
      "v16",
      "v17",
      "v18",
      "v19",
    ]);
    // O outro lado continua com exatamente os 5 que tinha — pedir mais acima não
    // é pedir mais abaixo.
    expect(ids(chatContext.after)).toEqual(["v21", "v22", "v23", "v24", "v25"]);

    await expandChatContext("after");
    expect(chatContext.after).toHaveLength(10);
    expect(chatContext.before).toHaveLength(10);
    expect(ids(chatContext.after).at(-1)).toBe("v30");
  });

  it("REQ-ACH-013: o cliente mostra a sequência que o servidor entregou — sem buraco, sem placeholder, sem contagem do que foi pulado", async () => {
    // Ids salteados: o que o servidor removeu (sussurro alheio) simplesmente não
    // existe nesta resposta — e é assim que a janela deve mostrar.
    const log = [
      makeMessage("v0", "primeira", 1000),
      makeMessage("v4", "segunda", 1004),
      makeMessage("v9", "alvo", 1009),
      makeMessage("v13", "quarta", 1013),
      makeMessage("v20", "quinta", 1020),
    ];
    const server = fakeServer(log);

    await loadChatContext(server.socket, "world1", "v9");

    expect(ids(chatContextSequence())).toEqual(["v0", "v4", "v9", "v13", "v20"]);
    // Nenhuma linha fabricada: tudo que a janela mostra é uma mensagem real
    // vinda do servidor.
    for (const msg of chatContextSequence()) {
      expect(log.some((m) => m._id === msg._id)).toBe(true);
    }
    // E o estado não carrega nenhuma contagem de "pulados" para a tela desenhar.
    expect(Object.keys(chatContext).sort()).toEqual([
      "after",
      "afterWanted",
      "before",
      "beforeWanted",
      "error",
      "hasMoreAfter",
      "hasMoreBefore",
      "loading",
      "target",
      "targetId",
    ]);
  });

  it("REQ-ACH-013: o controle “mais 5” some no lado em que não há mais visíveis", async () => {
    const server = fakeServer(visibleLog(9));
    await loadChatContext(server.socket, "world1", "v2");

    // Só duas linhas antes do alvo, e o servidor disse que não há mais nada atrás.
    expect(ids(chatContext.before)).toEqual(["v0", "v1"]);
    expect(chatContext.hasMoreBefore).toBe(false);
    expect(canExpandChatContext("before")).toBe(false);
    // Do outro lado ainda há: v8 ficou fora da janela de 5.
    expect(chatContext.hasMoreAfter).toBe(true);
    expect(canExpandChatContext("after")).toBe(true);

    const before = server.sent.length;
    await expandChatContext("before");
    // Lado esgotado não repergunta nada ao servidor.
    expect(server.sent).toHaveLength(before);
  });

  it("REQ-ACH-013: o corte de cada lado respeita o que aquele lado pediu (janela simétrica do servidor)", () => {
    const log = visibleLog(8);
    // O servidor devolveu 8 vizinhos porque o OUTRO lado pediu 8; este pediu 5.
    const before = sliceContextSide(log, "before", 5, false);
    expect(ids(before.messages)).toEqual(["v3", "v4", "v5", "v6", "v7"]);
    // Os que sobraram são a prova de que ainda há mais para mostrar deste lado.
    expect(before.hasMore).toBe(true);

    const after = sliceContextSide(log, "after", 5, false);
    expect(ids(after.messages)).toEqual(["v0", "v1", "v2", "v3", "v4"]);
    expect(after.hasMore).toBe(true);

    // Sem sobra e sem aviso do servidor, o lado acabou.
    expect(sliceContextSide(log.slice(0, 3), "after", 5, false).hasMore).toBe(false);
    expect(sliceContextSide(log.slice(0, 3), "after", 5, true).hasMore).toBe(true);
  });

  it("REQ-ACH-013: recusa do servidor vira erro na janela, não janela mentindo com o alvo antigo", async () => {
    const ok = fakeServer(visibleLog(11));
    await loadChatContext(ok.socket, "world1", "v5");
    expect(chatContext.target?._id).toBe("v5");

    const refused = fakeServer(visibleLog(11), "Message not found");
    await loadChatContext(refused.socket, "world1", "v99");

    expect(chatContext.target).toBeNull();
    expect(chatContext.before).toEqual([]);
    expect(chatContext.after).toEqual([]);
    expect(chatContext.error).toBe("Message not found");
  });
});

// ---------------------------------------------------------------------------
// REQ-ACH-014 — uma janela por vez, e o log ao vivo parado
// ---------------------------------------------------------------------------

describe("REQ-ACH-014: uma janela de contexto por vez", () => {
  it("REQ-ACH-014: acionar outro resultado reaproveita a MESMA janela, com o novo alvo", async () => {
    const server = fakeServer(visibleLog(41));

    await openChatContextWindow(server.socket, "world1", "v10");
    expect(windowManager.windows.size).toBe(1);
    const firstId = [...windowManager.windows.keys()][0];
    expect([...windowManager.windows.values()][0]?.singletonKey).toBe(CHAT_CONTEXT_WINDOW_KEY);
    expect(chatContext.target?._id).toBe("v10");

    // O leitor abriu mais contexto de um lado antes de acionar outro resultado.
    await expandChatContext("before");
    expect(chatContext.before).toHaveLength(10);

    await openChatContextWindow(server.socket, "world1", "v30");

    // Nenhuma segunda janela nasceu, e é a mesma de antes (mesmo id).
    expect(windowManager.windows.size).toBe(1);
    expect([...windowManager.windows.keys()][0]).toBe(firstId);
    // O alvo é o novo, e os dois lados voltaram a 5 — é outro resultado, não uma
    // vista mais larga do anterior.
    expect(chatContext.target?._id).toBe("v30");
    expect(ids(chatContext.before)).toEqual(["v25", "v26", "v27", "v28", "v29"]);
    expect(ids(chatContext.after)).toEqual(["v31", "v32", "v33", "v34", "v35"]);
  });

  it("REQ-ACH-014: a janela reaproveitada volta à frente mesmo minimizada", async () => {
    const server = fakeServer(visibleLog(21));
    await openChatContextWindow(server.socket, "world1", "v5");
    const id = [...windowManager.windows.keys()][0] as string;
    windowManager.minimize(id);
    expect(windowManager.windows.get(id)?.minimized).toBe(true);

    await openChatContextWindow(server.socket, "world1", "v12");

    expect(windowManager.windows.size).toBe(1);
    expect(windowManager.windows.get(id)?.minimized).toBe(false);
    expect(windowManager.activeWindowId).toBe(id);
  });

  it("REQ-ACH-014: o log ao vivo não se move enquanto a janela de contexto trabalha", async () => {
    const live = [makeMessage("live1", "a", 10), makeMessage("live2", "b", 20)];
    chatStore.messages = [...live];
    chatSession.scrollTop = 137;
    const marker = { firstUnreadId: "live2", count: 1 };
    chatStore.unreadMarker = marker;

    const server = fakeServer(visibleLog(41));
    await openChatContextWindow(server.socket, "world1", "v20");
    await expandChatContext("before");
    await expandChatContext("after");

    // Nada da janela entrou no log, e a posição de leitura do log continua onde
    // o leitor a deixou.
    expect(ids(chatStore.messages)).toEqual(["live1", "live2"]);
    expect(chatSession.scrollTop).toBe(137);
    expect(chatStore.unreadMarker).toEqual(marker);
  });

  it("REQ-ACH-014: fechar a janela esquece o contexto — a próxima abre limpa", async () => {
    const server = fakeServer(visibleLog(41));
    await openChatContextWindow(server.socket, "world1", "v20");
    await expandChatContext("before");

    closeChatContext();

    expect(chatContext.targetId).toBeNull();
    expect(chatContext.target).toBeNull();
    expect(chatContext.before).toEqual([]);
    expect(chatContext.after).toEqual([]);
    expect(chatContext.beforeWanted).toBe(CHAT_CONTEXT_PAGE);
    expect(chatContext.afterWanted).toBe(CHAT_CONTEXT_PAGE);
    expect(chatContext.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// O componente — renderizado de verdade (`svelte/server`), não lido da fonte
// ---------------------------------------------------------------------------

/** Pictographs — the exact class of character the drawer bans. */
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** Svelte appends a scope hash to every styled class, so match the class as a token. */
function countClass(body: string, className: string): number {
  return (body.match(new RegExp(`class="[^"]*\\b${className}[ "]`, "g")) ?? []).length;
}

/** The `data-message-id` of every row the window painted, in reading order. */
function renderedIds(body: string): string[] {
  return [...body.matchAll(/data-message-id="([^"]+)"/g)].map((m) => m[1] as string);
}

/**
 * A render of the window with the props the window manager really hands it.
 *
 * `onDestroy` is the one lifecycle hook that also runs on the server, so each
 * render ends by closing the context — every case reloads before rendering.
 */
function renderWindow(): string {
  const { body } = render(ChatContextWindow, {
    props: { socket: {} as unknown as Socket, worldId: "world1", isGm: false, userId: "user1" },
  });
  return body;
}

describe("ChatContextWindow.svelte", () => {
  it("REQ-ACH-013: pinta o alvo destacado no meio, com os visíveis de cada lado e nada mais", async () => {
    const server = fakeServer(visibleLog(21));
    await loadChatContext(server.socket, "world1", "v10");

    const body = renderWindow();

    // Um único destaque, e é o alvo — não a primeira nem a última linha.
    expect(countClass(body, "chat-context__row--target")).toBe(1);
    const target = body.slice(body.indexOf("chat-context__row--target"));
    expect(target.slice(0, 200)).toContain('data-message-id="v10"');
    // E a janela pintou exatamente a sequência que recebeu, na ordem de leitura.
    expect(renderedIds(body)).toEqual([
      "v5",
      "v6",
      "v7",
      "v8",
      "v9",
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
    ]);
  });

  it("REQ-ACH-013: oferece um “mais 5” por lado, e some no lado que acabou", async () => {
    const wide = fakeServer(visibleLog(41));
    await loadChatContext(wide.socket, "world1", "v20");
    const both = renderWindow();

    expect(countClass(both, "chat-context__more")).toBe(2);
    expect(both).toContain(t("FUSION.Chat.Context.MoreBefore", { count: CHAT_CONTEXT_PAGE }));
    expect(both).toContain(t("FUSION.Chat.Context.MoreAfter", { count: CHAT_CONTEXT_PAGE }));

    // Alvo em v2 de um log de 9: atrás dele não sobrou nada, à frente sobrou.
    const narrow = fakeServer(visibleLog(9));
    await loadChatContext(narrow.socket, "world1", "v2");
    const onlyAfter = renderWindow();

    expect(countClass(onlyAfter, "chat-context__more")).toBe(1);
    expect(onlyAfter).not.toContain(
      t("FUSION.Chat.Context.MoreBefore", { count: CHAT_CONTEXT_PAGE }),
    );
    expect(onlyAfter).toContain(t("FUSION.Chat.Context.MoreAfter", { count: CHAT_CONTEXT_PAGE }));
  });

  it("REQ-ACH-013: os controles têm ícone desenhado, nunca pictograma", async () => {
    const server = fakeServer(visibleLog(41));
    await loadChatContext(server.socket, "world1", "v20");

    const body = renderWindow();
    // Two counting scopes on purpose. `controls` is narrowed to the window's OWN
    // "mais 5" buttons (chat-context__more) to prove there are exactly two of
    // them (REQ-ACH-013's "mais 5" per side). But the anti-pictograph gate below
    // covers EVERY <button> in the rendered body — renderWindow() also draws real
    // ChatMessage rows for the target and its neighbours, and each row a viewer
    // may invalidate/revalidate (A024, REQ-ACH-082/083) carries its own
    // hover-revealed <button> too. That control's own drawn-icon-not-pictograph
    // coverage lives in `ChatMessage.invalidate.test.ts` (component
    // `components/chat/__tests__/`), but the ban still has to hold HERE too, in
    // this window's own paint — a regression in either component's markup, or in
    // how this window composes them, must fail this test on its own.
    const controls = body.match(/<button class="chat-context__more[^"]*"[\s\S]*?<\/button>/g) ?? [];
    expect(controls).toHaveLength(2);

    const allButtons = body.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(allButtons.length).toBeGreaterThanOrEqual(controls.length);
    for (const button of allButtons) {
      expect(button).toContain("<svg");
      expect(button).not.toMatch(PICTOGRAPH);
    }
  });

  it("REQ-ACH-014: a janela reaproveitada pinta o NOVO alvo — o estado manda, não as props", async () => {
    // As props são as mesmas nas duas pinturas (o window manager não reaplica
    // `componentProps` ao focar o singleton), então só o estado pode mudar o alvo.
    const server = fakeServer(visibleLog(41));

    await loadChatContext(server.socket, "world1", "v10");
    const first = renderWindow();
    await loadChatContext(server.socket, "world1", "v30");
    const second = renderWindow();

    expect(
      first.slice(
        first.indexOf("chat-context__row--target"),
        200 + first.indexOf("chat-context__row--target"),
      ),
    ).toContain('data-message-id="v10"');
    expect(
      second.slice(
        second.indexOf("chat-context__row--target"),
        200 + second.indexOf("chat-context__row--target"),
      ),
    ).toContain('data-message-id="v30"');
    expect(renderedIds(second)).not.toContain("v10");
  });

  it("REQ-ACH-014: pintar a janela não mexe no log ao vivo nem mostra o que está nele", async () => {
    const live = [makeMessage("live1", "conversa ao vivo", 10), makeMessage("live2", "b", 20)];
    chatStore.messages = [...live];
    chatSession.scrollTop = 137;
    const marker = { firstUnreadId: "live2", count: 1 };
    chatStore.unreadMarker = marker;

    const server = fakeServer(visibleLog(41));
    await loadChatContext(server.socket, "world1", "v20");
    const body = renderWindow();

    // Nada do log ao vivo entrou na janela…
    expect(renderedIds(body)).not.toContain("live1");
    expect(body).not.toContain("conversa ao vivo");
    // …e o log continua exatamente onde o leitor o deixou.
    expect(ids(chatStore.messages)).toEqual(["live1", "live2"]);
    expect(chatSession.scrollTop).toBe(137);
    expect(chatStore.unreadMarker).toEqual(marker);
  });
});
