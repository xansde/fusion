/**
 * ChatMessage.colors.test.ts — per-sender color and fixed type colors (A022,
 * spec 38, chat-tab.prototype.html:410/592/623-624).
 *
 * REQ-ACH-025: the run of consecutive messages by the same author never repeats
 * the header — and, by the same token, a continuation row never repaints its
 * (absent) header with a color. DEC-ACH-02 (fixed search bar) and DEC-ACH-03
 * (full-width write box) do not touch color themselves; they are cited here
 * because the task that added this behavior ("Cobre: DEC-ACH-02/03,
 * REQ-ACH-025") names them alongside REQ-ACH-025.
 *
 * Rendered with `render()` from `svelte/server` — same instrument as
 * ChatMessage.test.ts, first-paint markup, no DOM/interaction required.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatMessage from "../ChatMessage.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";

import { speakerColor, speakerColorKey } from "../../../lib/chat/speakerColor.js";

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

function renderMsg(message: ChatMessageType, props: { continuesPrevious?: boolean } = {}): string {
  const { body } = render(ChatMessage, { props: { message, ...props } });
  return body;
}

describe("REQ-ACH-025 / DEC-ACH-02 / DEC-ACH-03 — per-sender border + name color", () => {
  it("paints a plain top-level message's border with the sender's deterministic color", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana);
    const expected = speakerColor(speakerColorKey(ana.speaker));
    expect(body).toContain(`border-left-color: ${expected}`);
  });

  it("paints the author's name with the same color as the border", () => {
    const ana = msg("m1", { speaker: { userId: "u1", alias: "Ana" } });
    const body = renderMsg(ana);
    const expected = speakerColor(speakerColorKey(ana.speaker));
    const aliasStart = body.indexOf('class="msg__alias');
    const aliasTag = body.slice(aliasStart, aliasStart + 120);
    expect(aliasTag).toContain(`color: ${expected}`);
  });

  it("gives two different senders two different border colors", () => {
    const ana = renderMsg(msg("m1", { speaker: { userId: "u1", alias: "Ana" } }));
    const bruno = renderMsg(msg("m2", { speaker: { userId: "u2", alias: "Bruno" } }));
    const anaColor = speakerColor(speakerColorKey({ userId: "u1", alias: "Ana" }));
    const brunoColor = speakerColor(speakerColorKey({ userId: "u2", alias: "Bruno" }));
    expect(anaColor).not.toBe(brunoColor);
    expect(ana).toContain(`border-left-color: ${anaColor}`);
    expect(bruno).toContain(`border-left-color: ${brunoColor}`);
  });

  it("gives the SAME sender the SAME border color across two separate messages", () => {
    const first = renderMsg(msg("m1", { speaker: { userId: "u9", alias: "Fofurinha" } }));
    const second = renderMsg(msg("m2", { speaker: { userId: "u9", alias: "Fofurinha" } }));
    const expected = speakerColor(speakerColorKey({ userId: "u9", alias: "Fofurinha" }));
    expect(first).toContain(`border-left-color: ${expected}`);
    expect(second).toContain(`border-left-color: ${expected}`);
  });

  it("a continuation row (REQ-ACH-025: no repeated header) never paints a per-sender border", () => {
    const body = renderMsg(msg("m2", { speaker: { userId: "u1", alias: "Ana" } }), {
      continuesPrevious: true,
    });
    // No inline border-left-color at all — the base .msg rule (neutral gray)
    // governs, exactly like the prototype's `cont` rows.
    expect(body).not.toContain("border-left-color");
    // And, as already covered by ChatMessage.test.ts, no header/alias to color.
    expect(body).not.toContain("msg__alias");
  });

  it("a whisper message keeps the FIXED whisper color, never the sender's own", () => {
    const body = renderMsg(
      msg("m1", { type: "whisper", whisper: ["u2"], speaker: { userId: "u1", alias: "Ana" } }),
    );
    expect(body).toContain("msg--whisper");
    expect(body).not.toContain("border-left-color");
  });

  it("a blind roll keeps the FIXED blind color, never the sender's own", () => {
    const body = renderMsg(
      msg("m1", { type: "roll", blind: true, speaker: { userId: "u1", alias: "Ana" } }),
    );
    expect(body).toContain("msg--blind");
    expect(body).not.toContain("border-left-color");
  });

  it("a system card keeps the FIXED sys color, never the sender's own", () => {
    const body = renderMsg(
      msg("m1", {
        type: "system",
        speaker: { userId: "u1", alias: "Gamemaster" },
        card: { title: "Ataque", systemId: "pf2e" },
      }),
    );
    expect(body).toContain("msg--sys");
    expect(body).not.toContain("border-left-color");
  });

  it("a whisper message STILL colors the author's name by sender (only the border is fixed)", () => {
    const body = renderMsg(
      msg("m1", { type: "whisper", whisper: ["u2"], speaker: { userId: "u1", alias: "Ana" } }),
    );
    const expected = speakerColor(speakerColorKey({ userId: "u1", alias: "Ana" }));
    const aliasStart = body.indexOf('class="msg__alias');
    const aliasTag = body.slice(aliasStart, aliasStart + 120);
    expect(aliasTag).toContain(`color: ${expected}`);
  });
});
