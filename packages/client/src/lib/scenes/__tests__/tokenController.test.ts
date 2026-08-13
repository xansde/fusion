/**
 * tokenController — the op the token config dialog sends when the GM saves.
 *
 * This asserts the WIRE, for the same reason `tileController.test.ts` does: the
 * dialog had a complete-looking chain with nothing connected to it. It saved as
 * a SCENE `doc:update` with `tokens.<id>.<field>` dot-paths, which the server
 * rejects outright (`VALIDATION_FAILED: tokens: Expected array, received
 * object` — proved by `token-display-bars-e2e.test.ts` on the server side), so
 * every field in that dialog, vision and light included, silently never
 * persisted. The shape asserted here is the embedded-document form the token
 * drag and the tile panel already use.
 *
 * REQ-CNV-089 / REQ-CNV-090 (spec 06): configuring `bar1.attribute` and
 * `displayBars` needs a real path from the screen to the server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendOpMock = vi.fn(async (_socket: unknown, _envelope: unknown) => ({}));
vi.mock("../../docs/sendOp.js", () => ({
  sendOp: (socket: unknown, envelope: unknown) => sendOpMock(socket, envelope) as unknown,
  OpError: class extends Error {},
}));

const { updateToken } = await import("../tokenController.js");

const SOCKET = {} as never;
const SCENE = "scene00000000001";
const TOKEN = "token00000000001";

function envelope(n = 0): { type: string; payload: Record<string, unknown> } {
  return sendOpMock.mock.calls[n]?.[1] as never;
}

beforeEach(() => {
  sendOpMock.mockClear();
});

describe("updateToken", () => {
  it("addresses the token as an EMBEDDED document of its scene", async () => {
    await updateToken(SOCKET, SCENE, TOKEN, { displayBars: "hoverAll" });

    const env = envelope();
    expect(env.type).toBe("doc:update");
    expect(env.payload["documentType"]).toBe("Token");

    const updates = env.payload["updates"] as Record<string, unknown>[];
    expect(updates).toHaveLength(1);
    expect(updates[0]?.["_id"]).toBe(TOKEN);
    expect(updates[0]?.["embedded"]).toEqual({ type: "Token", id: SCENE });
  });

  it("never sends the scene as the document being updated", async () => {
    await updateToken(SOCKET, SCENE, TOKEN, { displayBars: "never" });

    const env = envelope();
    expect(env.payload["documentType"]).not.toBe("Scene");
    const updates = env.payload["updates"] as Record<string, unknown>[];
    expect(updates[0]?.["_id"]).not.toBe(SCENE);
  });

  it("passes the patch through as plain token fields — no dot-paths", async () => {
    await updateToken(SOCKET, SCENE, TOKEN, {
      name: "Goblin",
      bar1: { attribute: "attributes.hp" },
      bar2: { attribute: null },
      displayBars: "observer",
    });

    const updates = envelope().payload["updates"] as Record<string, unknown>[];
    const diff = updates[0]?.["diff"] as Record<string, unknown>;
    expect(diff).toEqual({
      name: "Goblin",
      bar1: { attribute: "attributes.hp" },
      bar2: { attribute: null },
      displayBars: "observer",
    });
    for (const key of Object.keys(diff)) {
      expect(key.startsWith("tokens.")).toBe(false);
    }
  });
});
