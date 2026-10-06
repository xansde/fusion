/**
 * Contract of the `resync:request` ack: what the REAL handler answers must satisfy the shared schema the client
 * unwraps (`ResyncAckResultSchema`). The client's own test builds its answers from the same type, so the two ends
 * cannot drift apart unnoticed (L3 D4/D5: the client expected a bare payload, the server sent `{ type, payload }`).
 */
import { describe, it, expect } from "vitest";
import type { Namespace } from "socket.io";
import { ResyncAckResultSchema } from "@fusion/shared";
import { buildResyncRequestHandler } from "../net/handlers/sync-handlers.js";
import type { SyncHandlerDeps } from "../net/handlers/sync-handlers.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { Role } from "../auth/user-store.js";

function deps(opsAfter: () => unknown[] | null): SyncHandlerDeps {
  return {
    store: { getAll: () => [] },
    seqStore: { peek: () => 7, next: () => 8 },
    opBuffer: { opsAfter },
    ns: { sockets: new Map() } as unknown as Namespace,
    db: { prepare: () => ({ get: () => undefined, all: () => [] }) },
  } as unknown as SyncHandlerDeps;
}

const ctx = { userId: "player000000001", role: Role.PLAYER } as unknown as HandlerContext;

async function ask(d: SyncHandlerDeps): Promise<unknown> {
  const res = await buildResyncRequestHandler(d)({ lastSeq: 3 }, ctx);
  return (res as { result?: unknown }).result;
}

describe("resync:request ack contract", () => {
  it("a delta answer satisfies ResyncAckResultSchema", async () => {
    const parsed = ResyncAckResultSchema.safeParse(await ask(deps(() => [])));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.type).toBe("delta");
  });

  it("a full answer (lastSeq outside the buffer) satisfies ResyncAckResultSchema", async () => {
    const parsed = ResyncAckResultSchema.safeParse(await ask(deps(() => null)));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.type).toBe("full");
  });
});
