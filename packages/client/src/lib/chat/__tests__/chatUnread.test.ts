/**
 * chatUnread.test.ts — the unread counter and who is allowed to zero it.
 *
 * Covers REQ-CHT-039 (spec 09 §: the client shows a badge counting the messages
 * received while the chat panel is not in view, and that badge is zeroed when the
 * panel is opened/focused). The badge *drawing* half lives next door — the rail
 * renders `chatStore.unreadCount` and never writes it (REQ-GAV-022/REQ-GAV-023,
 * proved in `lib/sidebar/__tests__/registerCoreTabs.test.ts`). What is proved HERE
 * is the counting rule itself, plus the signal that drives it.
 *
 * Why the signal needs a test of its own: with the side drawer, only the active
 * tab's panel is mounted (REQ-GAV-017), so `ChatPanel` mount/unmount IS "the chat
 * tab became visible / stopped being visible". That pair — `setChatTabVisible(true)`
 * on mount, `setChatTabVisible(false)` on destroy — replaced the `$effect` that
 * watched `activeTab` from inside the old sidebar container. Nothing else in the
 * client calls `setChatTabVisible`, so dropping either half leaves every other test
 * green while the badge silently stops working: either it never counts, or it never
 * clears. The last block below is the trap for that, read from the panel's source
 * (the client suite runs in a node environment with no DOM to mount into).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChatMessage } from "@fusion/shared";

import { chatStore, handleIncomingMessage, setChatTabVisible } from "../chatStore.svelte.js";

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

/** Raw source of a file, relative to this test — used by the panel-pair trap. */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("REQ-CHT-039 — o contador de não lidas e quem o zera", () => {
  beforeEach(() => {
    // The store and the visibility flag are module-level, so each test starts from
    // "panel not in view, nothing unread".
    setChatTabVisible(false);
    chatStore.messages = [];
    chatStore.unreadCount = 0;
  });

  it("REQ-CHT-039: mensagem recebida com o painel fora de vista incrementa o contador", () => {
    handleIncomingMessage(makeTextMessage());
    handleIncomingMessage(makeTextMessage());

    expect(chatStore.unreadCount).toBe(2);
    // The messages themselves arrive either way — the counter is about *seeing* them.
    expect(chatStore.messages).toHaveLength(2);
  });

  it("REQ-CHT-039: abrir o painel zera o contador", () => {
    handleIncomingMessage(makeTextMessage());
    handleIncomingMessage(makeTextMessage());
    expect(chatStore.unreadCount).toBe(2);

    setChatTabVisible(true);

    expect(chatStore.unreadCount).toBe(0);
    // Zeroing the badge is not throwing the log away.
    expect(chatStore.messages).toHaveLength(2);
  });

  it("REQ-CHT-039: com o painel à vista, mensagem nova não incrementa o contador", () => {
    setChatTabVisible(true);

    handleIncomingMessage(makeTextMessage());
    handleIncomingMessage(makeTextMessage());

    expect(chatStore.unreadCount).toBe(0);
    expect(chatStore.messages).toHaveLength(2);
  });

  it("REQ-CHT-039: sair do painel volta a contar, a partir do zero deixado ao abrir", () => {
    handleIncomingMessage(makeTextMessage());
    setChatTabVisible(true);
    setChatTabVisible(false);

    handleIncomingMessage(makeTextMessage());

    expect(chatStore.unreadCount).toBe(1);
  });

  it("REQ-CHT-039: reabrir o painel zera de novo, quantas vezes for", () => {
    for (const expected of [1, 2, 3]) {
      setChatTabVisible(false);
      for (let i = 0; i < expected; i += 1) handleIncomingMessage(makeTextMessage());
      expect(chatStore.unreadCount).toBe(expected);

      setChatTabVisible(true);
      expect(chatStore.unreadCount).toBe(0);
    }
  });
});

describe("REQ-CHT-039: o ciclo de vida do ChatPanel é o sinal de visibilidade", () => {
  /**
   * `ChatPanel.svelte` is a component and this suite has no DOM to mount it into,
   * so the pair is read from its source. Comments are stripped first: the file
   * *explains* the pair in prose right above it, and prose must not stand in for
   * the call.
   */
  const panel = source("../../../components/chat/ChatPanel.svelte")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  function lifecycleBody(hook: "onMount" | "onDestroy"): string {
    const opener = new RegExp(`${hook}\\(\\(\\)\\s*=>\\s*\\{`, "g");
    const match = opener.exec(panel);
    if (!match) return "";
    let depth = 1;
    let index = opener.lastIndex;
    while (index < panel.length && depth > 0) {
      if (panel[index] === "{") depth += 1;
      else if (panel[index] === "}") depth -= 1;
      index += 1;
    }
    return panel.slice(opener.lastIndex, index - 1);
  }

  it("REQ-CHT-039: montar o painel avisa que a aba ficou visível", () => {
    expect(lifecycleBody("onMount")).toMatch(/setChatTabVisible\(\s*true\s*\)/);
  });

  it("REQ-CHT-039: desmontar o painel avisa que a aba deixou de estar visível", () => {
    // The half that is easiest to lose: without it the counter never restarts,
    // because nothing else in the client ever passes `false`.
    expect(lifecycleBody("onDestroy")).toMatch(/setChatTabVisible\(\s*false\s*\)/);
  });

  it("REQ-CHT-039: o painel do chat é o único a mexer nesse sinal", () => {
    // The container must not take the signal back (REQ-GAV-022): only the tab that
    // owns the rule writes it. Anyone else calling it would be a second, competing
    // source of truth for "the chat is in view".
    // `function setChatTabVisible(` is the declaration in the store, not a call.
    const CALL = /(?<!function\s)setChatTabVisible\(/g;
    const EXPECTED_CALLS: readonly (readonly [string, number])[] = [
      ["../chatStore.svelte.ts", 0],
      ["../../../components/chat/ChatPanel.svelte", 2], // the mount/destroy pair
      ["../../../components/chat/ChatLog.svelte", 0],
      ["../../../components/sidebar/Sidebar.svelte", 0],
      ["../../../components/sidebar/SidebarDrawer.svelte", 0],
      ["../../../components/sidebar/SidebarRail.svelte", 0],
      ["../../sidebar/drawerState.svelte.ts", 0],
      ["../../sidebar/registerCoreTabs.ts", 0],
    ];

    for (const [relative, expected] of EXPECTED_CALLS) {
      const calls = source(relative).match(CALL) ?? [];
      expect(calls, `${relative} calls setChatTabVisible`).toHaveLength(expected);
    }
  });
});
