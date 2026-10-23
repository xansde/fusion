/**
 * chatInvalidateEmit.test.ts — the wire shape of chat:invalidate, straight
 * from `sendChatInvalidate` — the client's ONLY door to this op
 * (chatStore.svelte.ts's header comment on `sendChatInvalidate`;
 * ChatMessage.svelte's button, A024, has no other path to the server).
 *
 * Nothing exercised this payload before this file: `chatGrouping.test.ts`
 * only mentions `chat:invalidate` in a comment, and every rendering test
 * (`ChatMessage.invalidate.test.ts`, `ChatMessageInvalid.test.ts`) proves the
 * button appears/disappears, never what it puts on the wire. A field-name
 * typo (`id` instead of `_id`, a missing `worldId`) would sail through every
 * green test while failing VALIDATION_FAILED in production against the
 * server's own `ChatInvalidateRequestSchema`
 * (`packages/server/src/chat/chat-handler.ts`'s `buildChatInvalidateHandler`)
 * — the exact failure mode documented in
 * `lib/canvas/tokens/__tests__/token-manager-contract.test.ts`'s header.
 *
 * Socket stub pattern lifted from `chatSearch.test.ts`: records every emit
 * and answers with whatever the test queued — what matters here is WHICH
 * channel and WHICH envelope goes on the wire, not what the server does with
 * it (that is `packages/server/src/__tests__/chat-invalidate.test.ts`).
 *
 * REQ-ACH-080..086.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ChatInvalidateRequestSchema } from "@fusion/shared";

import { chatStore, sendChatInvalidate } from "../chatStore.svelte.js";

import type { Socket } from "socket.io-client";

interface Recorded {
  event: string;
  envelope: { type: string; payload: Record<string, unknown> };
}

/** Socket stub: records every emit and answers with whatever the test queued. */
function makeSocket(answer: (payload: Record<string, unknown>) => unknown): {
  socket: Socket;
  sent: Recorded[];
} {
  const sent: Recorded[] = [];
  const socket = {
    emit: (event: string, envelope: Recorded["envelope"], ack: (res: unknown) => void): void => {
      sent.push({ event, envelope });
      ack(answer(envelope.payload));
    },
  } as unknown as Socket;
  return { socket, sent };
}

beforeEach(() => {
  chatStore.error = null;
});

describe("REQ-ACH-080..086 — sendChatInvalidate puts a schema-valid envelope on op", () => {
  it("emits on the op channel (not query) with type chat:invalidate", async () => {
    const { socket, sent } = makeSocket(() => ({ ok: true }));

    await sendChatInvalidate(socket, "world1", "msg1", true);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.event).toBe("op");
    expect(sent[0]!.envelope.type).toBe("chat:invalidate");
  });

  it("builds a payload that parses against the SAME schema the server runs (ChatInvalidateRequestSchema)", async () => {
    const { socket, sent } = makeSocket(() => ({ ok: true }));

    await sendChatInvalidate(socket, "world1", "msg1", true);

    const parsed = ChatInvalidateRequestSchema.safeParse(sent[0]!.envelope.payload);
    expect(parsed.success).toBe(true);
  });

  it("sets invalid: true and carries worldId/_id to invalidate", async () => {
    const { socket, sent } = makeSocket(() => ({ ok: true }));

    await sendChatInvalidate(socket, "world1", "msg1", true);

    expect(sent[0]!.envelope.payload).toEqual({ worldId: "world1", _id: "msg1", invalid: true });
  });

  it("sets invalid: false to revalidate", async () => {
    const { socket, sent } = makeSocket(() => ({ ok: true }));

    await sendChatInvalidate(socket, "world1", "msg1", false);

    expect(sent[0]!.envelope.payload).toEqual({ worldId: "world1", _id: "msg1", invalid: false });
  });

  it("rejects the promise and populates chatStore.error on a refusal ack, without a second attempt", async () => {
    const { socket, sent } = makeSocket(() => ({ ok: false, message: "not the author" }));

    await expect(sendChatInvalidate(socket, "world1", "msg1", true)).rejects.toThrow(
      "not the author",
    );

    expect(chatStore.error).toBe("not the author");
    expect(sent).toHaveLength(1);
  });
});
