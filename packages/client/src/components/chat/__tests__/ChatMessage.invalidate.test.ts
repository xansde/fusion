/**
 * ChatMessage.invalidate.test.ts — client-side rendering of the
 * invalidate/revalidate control (A024, spec 38).
 *
 * `invalidateButton.test.ts` (lib/chat/__tests__/) already proves the pure
 * resolver `resolveInvalidateAction` in isolation. Nothing renders
 * ChatMessage.svelte itself with `isGm`/`userId` set to prove the button
 * actually reaches the markup for the viewers REQ-ACH-082/083 name, and is
 * absent for everyone else — that is the gap this file closes.
 *
 * Rendered with `render()` from `svelte/server` — same instrument as
 * ChatMessage.colors.test.ts, first-paint markup, no DOM/interaction
 * required.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatMessage from "../ChatMessage.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

import type { ChatMessage as ChatMessageType } from "@fusion/shared";

function msg(id: string, overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    _id: id,
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "u1",
      createdBy: "u1",
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
    worldId: "w1",
    content: id,
    speaker: { userId: "u1", alias: "Ana" },
    timestamp: 1_700_000_000_000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

function renderMsg(
  message: ChatMessageType,
  props: { isGm?: boolean; userId?: string; readOnly?: boolean } = {},
): string {
  const { body } = render(ChatMessage, { props: { message, ...props } });
  return body;
}

const invalidateLabel = t("FUSION.Chat.Invalidate.Button");
const revalidateLabel = t("FUSION.Chat.Revalidate.Button");

/** Pictographs — the exact class of character the drawer bans (clean-room: no emoji icons). */
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** Extracts the `msg__act` button markup alone, so an emoji elsewhere in the row can't hide behind it. */
function actButton(body: string): string {
  const match = /<button[^>]*class="[^"]*\bmsg__act\b[^"]*"[\s\S]*?<\/button>/.exec(body);
  if (!match) throw new Error("msg__act button not found in rendered body");
  return match[0];
}

describe("REQ-ACH-082 — invalidate control visibility", () => {
  it("renders the invalidate button for the message's AUTHOR (not GM)", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana, { isGm: false, userId: "u1" });
    expect(body).toContain("msg__act");
    expect(body).toContain(invalidateLabel);
  });

  it("renders the invalidate button for the GAMEMASTER, even as a non-author viewer", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana, { isGm: true, userId: "gm-1" });
    expect(body).toContain("msg__act");
    expect(body).toContain(invalidateLabel);
  });

  it("omits the button ENTIRELY for a third party (not the author, not the GM)", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana, { isGm: false, userId: "u2" });
    expect(body).not.toContain("msg__act");
  });

  it("omits the button for the default anonymous viewer (isGm/userId unset)", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana);
    expect(body).not.toContain("msg__act");
  });
});

describe("REQ-ACH-083 — revalidate control visibility", () => {
  it("renders the revalidate button for the GAMEMASTER on an invalidated message", () => {
    const invalidated = msg("m1", {
      speaker: { userId: "u1", alias: "Ana" },
      invalid: true,
      invalidatedBy: "gm-1",
    });
    const body = renderMsg(invalidated, { isGm: true, userId: "gm-1" });
    expect(body).toContain("msg__act");
    expect(body).toContain(revalidateLabel);
  });

  it("renders the revalidate button for the AUTHOR when he invalidated his own message", () => {
    const invalidated = msg("m1", {
      speaker: { userId: "u1", alias: "Ana" },
      invalid: true,
      invalidatedBy: "u1",
    });
    const body = renderMsg(invalidated, { isGm: false, userId: "u1" });
    expect(body).toContain("msg__act");
    expect(body).toContain(revalidateLabel);
  });

  it("omits the button for the AUTHOR when the GM's invalidation is the standing one (last word)", () => {
    const invalidated = msg("m1", {
      speaker: { userId: "u1", alias: "Ana" },
      invalid: true,
      invalidatedBy: "gm-1",
    });
    const body = renderMsg(invalidated, { isGm: false, userId: "u1" });
    expect(body).not.toContain("msg__act");
  });
});

describe("REQ-ACH-014 — readOnly suppresses the control (ChatContextWindow.svelte)", () => {
  // Achado da revisão: a janela de contexto (ChatContextWindow.svelte) reusa
  // este componente mas nunca assina o `doc:update` que uma invalidação
  // dispara — um clique ali alcançaria o servidor de verdade sem que a janela
  // jamais mostrasse o resultado, sucesso ou recusa. `readOnly` é o que essa
  // janela passa para nunca oferecer esse botão, mesmo quando o viewer é o
  // autor ou o Mestre.
  it("omits the invalidate button for the AUTHOR when readOnly is set", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana, { isGm: false, userId: "u1", readOnly: true });
    expect(body).not.toContain("msg__act");
    expect(body).not.toContain(invalidateLabel);
  });

  it("omits the invalidate button for the GAMEMASTER when readOnly is set", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana, { isGm: true, userId: "gm-1", readOnly: true });
    expect(body).not.toContain("msg__act");
    expect(body).not.toContain(invalidateLabel);
  });

  it("omits the revalidate button for the GAMEMASTER on an invalidated message when readOnly is set", () => {
    const invalidated = msg("m1", {
      speaker: { userId: "u1", alias: "Ana" },
      invalid: true,
      invalidatedBy: "gm-1",
    });
    const body = renderMsg(invalidated, { isGm: true, userId: "gm-1", readOnly: true });
    expect(body).not.toContain("msg__act");
    expect(body).not.toContain(revalidateLabel);
  });
});

describe("REQ-ACH-082/083 — the control's icon is drawn, never a pictograph", () => {
  it("draws the invalidate icon as inline SVG, no emoji", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana, { isGm: false, userId: "u1" });
    const button = actButton(body);
    expect(button).toContain("<svg");
    expect(button).not.toMatch(PICTOGRAPH);
  });

  it("draws the revalidate icon as inline SVG, no emoji", () => {
    const invalidated = msg("m1", {
      speaker: { userId: "u1", alias: "Ana" },
      invalid: true,
      invalidatedBy: "gm-1",
    });
    const body = renderMsg(invalidated, { isGm: true, userId: "gm-1" });
    const button = actButton(body);
    expect(button).toContain("<svg");
    expect(button).not.toMatch(PICTOGRAPH);
  });
});
