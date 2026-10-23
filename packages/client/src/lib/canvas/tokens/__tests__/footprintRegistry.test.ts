/**
 * footprintRegistry.test.ts — the client side of the size→footprint table
 * (spec 15 REQ-SYS-009, spec 41-token.md TK041/DEC-TOK-03).
 *
 * `footprint.ts` is proved separately against a seeded map; what is proved
 * HERE is that the table arrives at all — that the map `footprintOf` reads
 * comes from the system the world is running, not from an empty Map that
 * silently leaves every token at 1×1 forever.
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { Socket } from "socket.io-client";

import {
  footprintRegistry,
  ensureFootprintRegistry,
  indexSizeToFootprint,
  resetFootprintRegistry,
  seedFootprintRegistry,
} from "../footprintRegistry.svelte.js";

interface FakeSocket {
  socket: Socket;
  asks: string[];
}

function fakeSocket(answer: unknown, options: { fail?: boolean } = {}): FakeSocket {
  const asks: string[] = [];
  const socket = {
    emit(event: string, envelope: { type: string; requestId?: string }, ack: (a: unknown) => void) {
      void event;
      asks.push(envelope.type);
      const requestId = envelope.requestId;
      queueMicrotask(() => {
        ack(
          options.fail === true
            ? { ok: false, requestId, code: "PERMISSION_DENIED", message: "no" }
            : { ok: true, requestId, result: answer },
        );
      });
    },
  } as unknown as Socket;
  return { socket, asks };
}

const PF2E_ANSWER = {
  systemId: "pf2e",
  sizeToFootprint: {
    tiny: { width: 1, height: 1 },
    med: { width: 1, height: 1 },
    lg: { width: 2, height: 2 },
    huge: { width: 3, height: 3 },
    grg: { width: 4, height: 4 },
  },
};

beforeEach(() => {
  resetFootprintRegistry();
});

describe("indexSizeToFootprint", () => {
  it("keys by size category and drops empty-string keys", () => {
    const map = indexSizeToFootprint({
      lg: { width: 2, height: 2 },
      "": { width: 9, height: 9 },
    });
    expect(map.get("lg")).toEqual({ width: 2, height: 2 });
    expect(map.has("")).toBe(false);
  });
});

describe("the active system's sizeToFootprint reaches the client (REQ-SYS-009)", () => {
  it("after the answer, the table is populated", async () => {
    const { socket, asks } = fakeSocket(PF2E_ANSWER);

    await ensureFootprintRegistry(socket);

    expect(asks).toEqual(["system:footprint"]);
    expect(footprintRegistry.sizeToFootprint.get("lg")).toEqual({ width: 2, height: 2 });
    expect(footprintRegistry.sizeToFootprint.get("grg")).toEqual({ width: 4, height: 4 });
  });

  it("is single-flight: a second caller does not ask again", async () => {
    const { socket, asks } = fakeSocket(PF2E_ANSWER);

    await Promise.all([ensureFootprintRegistry(socket), ensureFootprintRegistry(socket)]);

    expect(asks).toEqual(["system:footprint"]);
  });

  it("fails open: a refusal leaves the map empty, never throws", async () => {
    const { socket } = fakeSocket(null, { fail: true });

    await expect(ensureFootprintRegistry(socket)).resolves.toBeUndefined();
    expect(footprintRegistry.sizeToFootprint.size).toBe(0);
  });

  it("a world with no system answers an empty table, leaving the map empty", async () => {
    const { socket } = fakeSocket({ systemId: null, sizeToFootprint: {} });

    await ensureFootprintRegistry(socket);

    expect(footprintRegistry.sizeToFootprint.size).toBe(0);
  });
});

describe("seedFootprintRegistry / resetFootprintRegistry", () => {
  it("seed puts the table in place without a socket", () => {
    seedFootprintRegistry({ lg: { width: 2, height: 2 } });
    expect(footprintRegistry.sizeToFootprint.get("lg")).toEqual({ width: 2, height: 2 });
  });

  it("reset forgets the table and the single-flight guard", async () => {
    seedFootprintRegistry({ lg: { width: 2, height: 2 } });
    resetFootprintRegistry();
    expect(footprintRegistry.sizeToFootprint.size).toBe(0);

    // seedFootprintRegistry also sets the single-flight guard: a fresh
    // ensureFootprintRegistry call after reset must ask again.
    const { socket, asks } = fakeSocket(PF2E_ANSWER);
    await ensureFootprintRegistry(socket);
    expect(asks).toEqual(["system:footprint"]);
  });
});
