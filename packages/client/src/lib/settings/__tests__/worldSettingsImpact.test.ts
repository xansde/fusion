/**
 * worldSettingsImpact.test.ts — the wire wrapper REQ-CFG-082's confirmation
 * asks its "quantos são afetados" count through (spec 37 §5.4/§5.9, G103).
 *
 * Uses the "recording socket" pattern from `compendiumApi.test.ts`: a fake
 * `Socket` that captures the exact envelope emitted and acks with a canned
 * result — proving the WIRE contract (event name, query type, payload shape)
 * without a real server.
 */

import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";

import { querySettingDisableImpact } from "../worldSettingsImpact.js";

interface SentQuery {
  event: string;
  type: string;
  payload: unknown;
}

function recordingSocket(
  sent: SentQuery[],
  ack: { ok: boolean; result?: unknown; code?: string; message?: string },
): Socket {
  return {
    emit: (
      event: string,
      envelope: { type: string; payload: unknown },
      cb: (a: { ok: boolean; result?: unknown; code?: string; message?: string }) => void,
    ) => {
      sent.push({ event, type: envelope.type, payload: envelope.payload });
      cb(ack);
    },
  } as unknown as Socket;
}

describe("querySettingDisableImpact — REQ-CFG-082's impact query", () => {
  it("emits on the read-only 'query' event, never 'op', with the setting's key", async () => {
    const sent: SentQuery[] = [];
    const socket = recordingSocket(sent, { ok: true, result: { count: 3 } });

    await querySettingDisableImpact(socket, "pf2e:freeArchetype");

    expect(sent).toEqual([
      { event: "query", type: "settings:impact", payload: { key: "pf2e:freeArchetype" } },
    ]);
  });

  it("resolves with the server's real count — REQ-CFG-082 requires the actual number, never a guess", async () => {
    const socket = recordingSocket([], { ok: true, result: { count: 5 } });
    const result = await querySettingDisableImpact(socket, "pf2e:freeArchetype");
    expect(result).toEqual({ count: 5 });
  });

  it("a count of zero round-trips correctly (falsy value, not 'no result')", async () => {
    const socket = recordingSocket([], { ok: true, result: { count: 0 } });
    const result = await querySettingDisableImpact(socket, "pf2e:variantRules.classLevels");
    expect(result).toEqual({ count: 0 });
  });

  it("REQ-CFG-031: the same call shape works for any system's key — nothing here branches on it", async () => {
    const sentA: SentQuery[] = [];
    const sentB: SentQuery[] = [];
    await querySettingDisableImpact(
      recordingSocket(sentA, { ok: true, result: { count: 1 } }),
      "pf2e:freeArchetype",
    );
    await querySettingDisableImpact(
      recordingSocket(sentB, { ok: true, result: { count: 1 } }),
      "totally-different-system:someOtherToggle",
    );
    expect(sentA[0]?.type).toBe(sentB[0]?.type);
  });

  it("rejects when the server refuses the query", async () => {
    const socket = recordingSocket([], { ok: false, message: "boom" });
    await expect(querySettingDisableImpact(socket, "pf2e:freeArchetype")).rejects.toThrow("boom");
  });
});
