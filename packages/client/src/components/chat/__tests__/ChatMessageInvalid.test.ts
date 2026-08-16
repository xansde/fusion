/**
 * ChatMessageInvalid.test.ts — what a voided message looks like in the log.
 *
 * Rendered with `render()` from `svelte/server` (the client project runs Vitest in a node
 * environment, with no jsdom and no testing-library), so the assertions are made on the
 * first paint of the markup — which is the right instrument for REQ-ACH-081: the
 * attenuation, the strike and the stamp have to be there without any interaction.
 *
 * Covers REQ-ACH-081 (stays in the log, attenuated, value struck through, and says who
 * voided it) and REQ-ACH-080 (nothing is deleted — the content is still on screen).
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatMessage from "../ChatMessage.svelte";
import { presenceState } from "../../../lib/presence/presenceStore.svelte.js";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

import type { ChatMessage as ChatMessageType, RollResultData } from "@fusion/shared";

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

function rollData(): RollResultData {
  return {
    rollId: "roll-1",
    formula: "1d20+7",
    expandedFormula: "1d20+7",
    total: 24,
    terms: [
      {
        type: "dice",
        expression: "1d20",
        total: 17,
        faces: 20,
        number: 1,
        results: [{ result: 17, active: true }],
      },
      { type: "operator", expression: "+", total: 0 },
      { type: "numeric", expression: "7", total: 7 },
    ],
    rollMode: "public",
    timestamp: 1000,
    warnings: [],
  };
}

function renderMsg(message: ChatMessageType): string {
  const { body } = render(ChatMessage, { props: { message } });
  return body;
}

afterEach(() => {
  presenceState.onlineUsers = [];
});

describe("REQ-ACH-081 — the voided message reads as voided", () => {
  const voided = msg("m1", {
    content: "Isso não aconteceu",
    invalid: true,
    invalidatedBy: "gm-1",
    invalidatedAt: 1_700_000_100_000,
  });

  it("marks the whole row as invalidated (attenuated, with its value struck)", () => {
    const body = renderMsg(voided);
    expect(body).toContain("msg--invalid");
  });

  it("says who voided it, by name when that user is known", () => {
    presenceState.onlineUsers = [
      { userId: "gm-1", userName: "Mestra Iris", color: "#fff", online: true },
    ];
    const body = renderMsg(voided);
    expect(body).toContain(t("FUSION.Chat.Invalidated.By", { who: "Mestra Iris" }));
  });

  it("still says who when the name cannot be resolved — never an anonymous void", () => {
    const body = renderMsg(voided);
    expect(body).toContain(t("FUSION.Chat.Invalidated.By", { who: "gm-1" }));
  });

  it("strikes the roll total as well, not only the text", () => {
    const body = renderMsg(
      msg("m2", {
        type: "roll",
        content: "",
        invalid: true,
        invalidatedBy: "u1",
        rolls: [rollData()],
      }),
    );
    expect(body).toContain("msg--invalid");
    // The value is still printed — struck, not removed (REQ-ACH-080/085).
    expect(body).toContain(">24<");
  });

  it("keeps the message in the log: the content is untouched (REQ-ACH-080)", () => {
    const body = renderMsg(voided);
    expect(body).toContain("Isso não aconteceu");
  });

  it("adds nothing to a message that was never voided", () => {
    const body = renderMsg(msg("m3"));
    expect(body).not.toContain("msg--invalid");
    expect(body).not.toContain(t("FUSION.Chat.Invalidated.Badge"));
  });
});
