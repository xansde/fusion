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
  props: { isGm?: boolean; userId?: string } = {},
): string {
  const { body } = render(ChatMessage, { props: { message, ...props } });
  return body;
}

const invalidateLabel = t("FUSION.Chat.Invalidate.Button");
const revalidateLabel = t("FUSION.Chat.Revalidate.Button");

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
