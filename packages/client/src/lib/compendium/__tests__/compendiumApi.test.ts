/**
 * compendiumApi.test.ts — socket availability guard for compendium calls.
 *
 * Regression for the spell-picker "endless spinner" bug: a stale/replaced
 * Socket instance buffers emits silently (the ack never fires and the
 * caller's Promise hangs until timeout). requireConnectedSocket() must fail
 * FAST with a typed error so the UI can show a visible "not connected"
 * state + retry instead of looping the loading state.
 */

import { describe, it, expect } from "vitest";
import type { Socket } from "socket.io-client";
import { requireConnectedSocket, SocketUnavailableError } from "../compendiumApi.js";

function fakeSocket(connected: boolean): Socket {
  return { connected, emit: () => undefined } as unknown as Socket;
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
