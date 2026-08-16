/**
 * composeBox.test.ts — the write box's promises, tested away from the DOM (plan G033).
 *
 * Covers REQ-ACH-031 (one line growing to five, then scrolling), REQ-ACH-032 (Enter sends,
 * Shift+Enter breaks the line), REQ-ACH-033 (the typed line reaches the server verbatim,
 * with no local RNG) and REQ-ACH-034 (sending empties the box and takes the log to its
 * end).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_COMPOSE_ROWS,
  computeComposeRows,
  resolveComposeKey,
  rowsForContentHeight,
  submitChatLine,
} from "../composeBox.js";
import { InputHistory } from "../inputHistory.js";
import { chatSession } from "../chatStore.svelte.js";
import { registerLogScroller } from "../logScroller.js";

import type { ChatSendPayload } from "@fusion/shared";

afterEach(() => {
  registerLogScroller(null);
  chatSession.draft = "";
});

describe("altura da caixa: uma linha até cinco (REQ-ACH-031)", () => {
  it("starts at a single row for an empty box", () => {
    expect(computeComposeRows("")).toBe(1);
    expect(computeComposeRows("uma linha só")).toBe(1);
  });

  it("grows one row per hard break", () => {
    expect(computeComposeRows("a\nb")).toBe(2);
    expect(computeComposeRows("a\nb\nc\nd")).toBe(4);
  });

  it("stops growing at five and lets the rest scroll", () => {
    expect(MAX_COMPOSE_ROWS).toBe(5);
    expect(computeComposeRows("a\nb\nc\nd\ne")).toBe(5);
    expect(computeComposeRows("a\nb\nc\nd\ne\nf\ng\nh")).toBe(5);
  });

  it("counts soft-wrapped lines from the measured height, with the same ceiling", () => {
    // Three wrapped lines of 20px each in a box whose line box is 20px.
    expect(rowsForContentHeight(60, 20)).toBe(3);
    expect(rowsForContentHeight(400, 20)).toBe(5);
    // A box that has not been laid out yet must not report zero rows.
    expect(rowsForContentHeight(0, 20)).toBe(1);
    expect(rowsForContentHeight(60, 0)).toBe(1);
  });
});

describe("teclado: Enter envia, Shift+Enter quebra (REQ-ACH-032)", () => {
  it("sends on a bare Enter", () => {
    expect(resolveComposeKey({ key: "Enter" })).toBe("send");
    expect(resolveComposeKey({ key: "Enter", shiftKey: false })).toBe("send");
  });

  it("breaks the line on Shift+Enter instead of sending", () => {
    expect(resolveComposeKey({ key: "Enter", shiftKey: true })).toBe("newline");
  });

  it("walks the history with the arrows (REQ-ACH-026)", () => {
    expect(resolveComposeKey({ key: "ArrowUp" })).toBe("history-up");
    expect(resolveComposeKey({ key: "ArrowDown" })).toBe("history-down");
  });

  it("leaves Enter to the IME while a candidate window is open", () => {
    // Without this, typing an accented or CJK word would send half of it.
    expect(resolveComposeKey({ key: "Enter", isComposing: true })).toBe("none");
  });

  it("claims no other key", () => {
    expect(resolveComposeKey({ key: "a" })).toBe("none");
    expect(resolveComposeKey({ key: "Escape" })).toBe("none");
  });
});

describe("enviar: o servidor recebe o que foi digitado (REQ-ACH-033)", () => {
  it("hands the command over verbatim, with no roll result attached", async () => {
    chatSession.draft = "/roll 1d20+5";
    const sent: ChatSendPayload[] = [];

    await submitChatLine({
      text: chatSession.draft,
      worldId: "w1",
      selectorMode: "public",
      send: (payload) => {
        sent.push(payload);
      },
      history: new InputHistory(),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toBe("/roll 1d20+5");
    // No client-side RNG: the payload carries no total, no dice and no result
    // (REQ-ROL-020/024 — the server is the only place a die is rolled).
    const raw = sent[0] as unknown as Record<string, unknown>;
    expect(raw["rolls"]).toBeUndefined();
    expect(raw["result"]).toBeUndefined();
    expect(raw["total"]).toBeUndefined();
  });

  it("trims the line but never rewrites it", async () => {
    const sent: ChatSendPayload[] = [];
    await submitChatLine({
      text: "  /gmroll 2d6 + 3  ",
      worldId: "w1",
      selectorMode: "blindroll",
      send: (payload) => {
        sent.push(payload);
      },
      history: new InputHistory(),
    });
    expect(sent[0]?.content).toBe("/gmroll 2d6 + 3");
  });

  it("sends nothing when the box holds only whitespace", async () => {
    const send = vi.fn();
    const ok = await submitChatLine({
      text: "   \n  ",
      worldId: "w1",
      selectorMode: "public",
      send,
      history: new InputHistory(),
    });
    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("enviar limpa a caixa e leva o log ao fim (REQ-ACH-034)", () => {
  it("empties the draft, records the history entry and scrolls the log", async () => {
    const scroll = vi.fn();
    registerLogScroller(scroll);
    const history = new InputHistory();
    chatSession.draft = "olá mesa";

    await submitChatLine({
      text: chatSession.draft,
      worldId: "w1",
      selectorMode: "public",
      send: () => undefined,
      history,
    });

    expect(chatSession.draft).toBe("");
    expect(history.length).toBe(1);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("keeps the text when the send fails — the box is the only copy", async () => {
    const scroll = vi.fn();
    registerLogScroller(scroll);
    chatSession.draft = "mensagem que não saiu";

    await expect(
      submitChatLine({
        text: chatSession.draft,
        worldId: "w1",
        selectorMode: "public",
        send: () => Promise.reject(new Error("socket down")),
        history: new InputHistory(),
      }),
    ).rejects.toThrow("socket down");

    expect(chatSession.draft).toBe("mensagem que não saiu");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does not throw when there is no log on screen to scroll", async () => {
    registerLogScroller(null);
    await expect(
      submitChatLine({
        text: "oi",
        worldId: "w1",
        selectorMode: "public",
        send: () => undefined,
        history: new InputHistory(),
      }),
    ).resolves.toBe(true);
  });
});
