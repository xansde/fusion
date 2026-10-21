import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { OpError } from "../../docs/sendOp.js";
import { _resetEscritaParaTestes, atualizarAtor } from "../escrita.js";

type Ack = { ok: true; result: unknown } | { ok: false; code: string; message: string };

/** A socket whose acks are scripted, recording what was sent. */
function socketFalso(acks: Ack[]) {
  const enviados: Array<Record<string, unknown>> = [];
  const socket = {
    emit: vi.fn((_evento: string, envelope: Record<string, unknown>, cb: (a: Ack) => void) => {
      enviados.push(envelope);
      const ack = acks.shift() ?? { ok: true, result: { documents: [] } };
      cb(ack);
    }),
  };
  return { socket: socket as unknown as Socket, enviados };
}

function espelho(version: number | undefined) {
  return {
    getDoc: () => (version === undefined ? undefined : { _id: "a1", _stats: { version } }),
  } as never;
}

const payloadDe = (e: Record<string, unknown>) =>
  (e["payload"] as { updates: Array<Record<string, unknown>> }).updates[0]!;

describe("atualizarAtor", () => {
  beforeEach(() => _resetEscritaParaTestes());

  it("sends the mirror's version as expectedVersion (the server refuses a player's write without it)", async () => {
    const { socket, enviados } = socketFalso([
      { ok: true, result: { documents: [{ _id: "a1", _stats: { version: 8 } }] } },
    ]);
    await atualizarAtor(socket, "a1", { img: "/assets/x.png" }, espelho(7));
    expect(payloadDe(enviados[0]!)).toMatchObject({
      _id: "a1",
      diff: { img: "/assets/x.png" },
      expectedVersion: 7,
    });
  });

  it("chains writes on the version the previous ack confirmed, even if the mirror lags", async () => {
    const { socket, enviados } = socketFalso([
      { ok: true, result: { documents: [{ _id: "a1", _stats: { version: 8 } }] } },
      { ok: true, result: { documents: [{ _id: "a1", _stats: { version: 9 } }] } },
    ]);
    await atualizarAtor(socket, "a1", { a: 1 }, espelho(7));
    await atualizarAtor(socket, "a1", { b: 2 }, espelho(7));
    expect(payloadDe(enviados[1]!)["expectedVersion"]).toBe(8);
  });

  it("retries once on STALE_WRITE with the freshest version", async () => {
    const { socket, enviados } = socketFalso([
      { ok: false, code: "STALE_WRITE", message: "stale" },
      { ok: true, result: { documents: [{ _id: "a1", _stats: { version: 12 } }] } },
    ]);
    let v = 10;
    const m = { getDoc: () => ({ _id: "a1", _stats: { version: v++ } }) } as never;
    await atualizarAtor(socket, "a1", { a: 1 }, m);
    expect(enviados).toHaveLength(2);
    expect(payloadDe(enviados[1]!)["expectedVersion"]).toBe(11);
  });

  it("rejects with the server's error when it is not a stale write", async () => {
    const { socket } = socketFalso([{ ok: false, code: "PERMISSION_DENIED", message: "no" }]);
    await expect(atualizarAtor(socket, "a1", { a: 1 }, espelho(1))).rejects.toBeInstanceOf(OpError);
  });
});
