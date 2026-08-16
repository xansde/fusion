/**
 * compendiumApi.test.ts — socket availability guard for compendium calls.
 *
 * Regression for the spell-picker "endless spinner" bug: a stale/replaced
 * Socket instance buffers emits silently (the ack never fires and the
 * caller's Promise hangs until timeout). requireConnectedSocket() must fail
 * FAST with a typed error so the UI can show a visible "not connected"
 * state + retry instead of looping the loading state.
 *
 * Also pins the WIRE contract of the two import doors of spec 43 §5.7 —
 * `compendium:import` (world) and `compendium:importToActor` (sheet):
 * REQ-CPD-060, REQ-CPD-061, REQ-CPD-073.
 */

import { describe, it, expect } from "vitest";
import type { Socket } from "socket.io-client";
import {
  importToActor,
  importToWorld,
  requireConnectedSocket,
  SocketUnavailableError,
} from "../compendiumApi.js";

function fakeSocket(connected: boolean): Socket {
  return { connected, emit: () => undefined } as unknown as Socket;
}

interface SentOp {
  /** socket.io event name — `op` for a mutation, `query` for a read. */
  event: string;
  type: string;
  payload: unknown;
}

/** Socket that records every envelope it is given and acks with `result`. */
function recordingSocket(sent: SentOp[], result: unknown): Socket {
  return {
    connected: true,
    emit: (
      event: string,
      envelope: { type: string; payload: unknown },
      ack: (a: { ok: boolean; result?: unknown }) => void,
    ) => {
      sent.push({ event, type: envelope.type, payload: envelope.payload });
      ack({ ok: true, result });
    },
  } as unknown as Socket;
}

describe("requireConnectedSocket", () => {
  it("throws SocketUnavailableError (code NOT_CONNECTED) for null", () => {
    expect(() => requireConnectedSocket(null)).toThrowError(SocketUnavailableError);
    try {
      requireConnectedSocket(null);
    } catch (err) {
      expect(err).toBeInstanceOf(SocketUnavailableError);
      expect((err as SocketUnavailableError).code).toBe("NOT_CONNECTED");
    }
  });

  it("throws SocketUnavailableError for undefined", () => {
    expect(() => requireConnectedSocket(undefined)).toThrowError(SocketUnavailableError);
  });

  it("throws SocketUnavailableError for a disconnected socket (stale instance)", () => {
    // The frozen-socket failure mode: the object exists but is no longer
    // connected — socket.io would buffer its emits forever without erroring.
    expect(() => requireConnectedSocket(fakeSocket(false))).toThrowError(SocketUnavailableError);
  });

  it("returns the same socket when connected (no wrapping)", () => {
    const sock = fakeSocket(true);
    expect(requireConnectedSocket(sock)).toBe(sock);
  });

  it("fails synchronously — never leaves a pending promise/loading loop", () => {
    // Guard is synchronous by design: the caller's catch runs in the same
    // tick, so `loading` flips to an error state immediately (no 10s hang,
    // no flickering busy cursor).
    const before = Date.now();
    try {
      requireConnectedSocket(fakeSocket(false));
    } catch {
      // expected
    }
    expect(Date.now() - before).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// The two doors of §5.7 on the wire (spec 43, G095)
// ---------------------------------------------------------------------------
//
// The server half of REQ-CPD-073 is pinned by
// `packages/server/src/__tests__/compendium-import-to-actor.test.ts`, which
// speaks the wire literals directly. This is the CLIENT half: what the panel
// actually puts on the socket. Without it the only client-side evidence was a
// grep of `CompendiumBrowser.svelte`'s source for the local function name —
// which stays green through a renamed payload field, a wrong op literal, or a
// mutation sent as a read-only `query`. The envelope is the contract; the
// function name is not.

describe("the sheet door on the wire (REQ-CPD-061, REQ-CPD-073)", () => {
  it("REQ-CPD-061: importToActor emits an op named compendium:importToActor", async () => {
    const sent: SentOp[] = [];

    await importToActor(
      recordingSocket(sent, { actorId: "actor-1", created: [], failed: [] }),
      ["Compendium.pf2e.spells-core.Item.s1"],
      "actor-1",
    );

    expect(sent).toHaveLength(1);
    // A mutation rides "op", never the read-only "query" event: sending it as a
    // query would reach a handler that is not allowed to write anything.
    expect(sent[0]?.event).toBe("op");
    expect(sent[0]?.type).toBe("compendium:importToActor");
  });

  it("REQ-CPD-073: the payload names the destination actor, and carries no role of its own", async () => {
    const sent: SentOp[] = [];

    await importToActor(
      recordingSocket(sent, { actorId: "actor-1", created: [], failed: [] }),
      ["Compendium.pf2e.spells-core.Item.s1", "Compendium.pf2e.feats-core.Item.f1"],
      "actor-1",
    );

    // What protects this door is OWNER of the DESTINATION (REQ-CPD-073), so the
    // destination id is the whole payload's reason to exist. `actorId` is the
    // field name the server's CompendiumImportToActorPayloadSchema requires —
    // renaming it here is a silent VALIDATION_FAILED at runtime.
    expect(sent[0]?.payload).toEqual({
      uuids: ["Compendium.pf2e.spells-core.Item.s1", "Compendium.pf2e.feats-core.Item.f1"],
      actorId: "actor-1",
    });
    // The client asserts no role and no ownership: the server reads the role off
    // the socket and the ownership off the destination.
    const wire = JSON.stringify(sent[0]?.payload);
    expect(wire).not.toContain("role");
    expect(wire).not.toContain("ownership");
  });

  it("REQ-CPD-060/061: the world door and the sheet door are two different calls", async () => {
    const sent: SentOp[] = [];
    const socket = recordingSocket(sent, { created: [], failed: [] });

    await importToWorld(socket, ["Compendium.pf2e.spells-core.Item.s1"]);
    await importToActor(socket, ["Compendium.pf2e.spells-core.Item.s1"], "actor-1");

    // DEC-CPD-05: the sheet door is deliberately NOT a flag on the world call —
    // they are guarded by different rules, so they are different ops.
    expect(sent.map((s) => s.type)).toEqual(["compendium:import", "compendium:importToActor"]);
    // The world call names a folder, never an actor (`folderId` is absent here).
    expect(sent[0]?.payload).toEqual({ uuids: ["Compendium.pf2e.spells-core.Item.s1"] });
    expect(JSON.stringify(sent[0]?.payload)).not.toContain("actorId");
  });
});
