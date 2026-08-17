/**
 * worldSettingsRegistry.test.ts — the client side of `settings:declarations`
 * (spec 37 §5.4, G102, REQ-CFG-030, RNF-CFG-02).
 *
 * Mirrors `lib/conditions/__tests__/conditionRegistry.test.ts`: proves the
 * declarations actually arrive (a fake system's rows, never hardcoded here),
 * that a refusal/timeout leaves the section with nothing to draw instead of
 * throwing, and that reopening the tab does not ask the server twice.
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { Socket } from "socket.io-client";

import {
  applyWorldSettingWrite,
  ensureWorldSettingsRegistry,
  resetWorldSettingsRegistry,
  seedWorldSettingsRegistry,
  worldSettingsRegistry,
} from "../worldSettingsRegistry.svelte.js";

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

// A FAKE system's declaration — the point is that this module never hardcodes
// any of this; see worldSettingsSection.test.ts for the render-side proof.
const FAKE_SYSTEM_ANSWER = {
  systemId: "fake-system",
  settings: [
    {
      id: null,
      key: "fake-system:neverSeenBeforeToggle",
      kind: "boolean" as const,
      label: "Nunca visto antes",
      value: false,
    },
  ],
};

beforeEach(() => {
  resetWorldSettingsRegistry();
});

describe("the active system's world settings reach the client (REQ-CFG-030)", () => {
  it("after the answer, the row is in worldSettingsRegistry.rows", async () => {
    const { socket } = fakeSocket(FAKE_SYSTEM_ANSWER);
    await ensureWorldSettingsRegistry(socket);

    expect(worldSettingsRegistry.systemId).toBe("fake-system");
    expect(worldSettingsRegistry.rows).toHaveLength(1);
    expect(worldSettingsRegistry.rows[0]?.key).toBe("fake-system:neverSeenBeforeToggle");
  });
});

describe("nothing waits on the declarations", () => {
  it("before any answer the list is empty, never undefined", () => {
    expect(worldSettingsRegistry.rows).toEqual([]);
    expect(worldSettingsRegistry.systemId).toBeNull();
  });

  it("a refused request leaves the list empty instead of throwing", async () => {
    const { socket } = fakeSocket(FAKE_SYSTEM_ANSWER, { fail: true });

    await expect(ensureWorldSettingsRegistry(socket)).resolves.toBeUndefined();
    expect(worldSettingsRegistry.rows).toEqual([]);
  });
});

describe("the declarations are fetched once (RNF-CFG-02: no rebuild needed to pick up a new one)", () => {
  it("REQ-GAV-017: reopening the section does not ask the server again", async () => {
    const { socket, asks } = fakeSocket(FAKE_SYSTEM_ANSWER);

    await ensureWorldSettingsRegistry(socket);
    await ensureWorldSettingsRegistry(socket);
    await ensureWorldSettingsRegistry(socket);

    expect(asks).toEqual(["settings:declarations"]);
  });

  it("can be seeded without a socket", () => {
    seedWorldSettingsRegistry(FAKE_SYSTEM_ANSWER);

    expect(worldSettingsRegistry.rows[0]?.key).toBe("fake-system:neverSeenBeforeToggle");
  });
});

describe("applyWorldSettingWrite — REQ-CFG-071: a confirmed write folds id + value back in", () => {
  it("a first-ever write attaches the Setting document id the ack returned", () => {
    seedWorldSettingsRegistry(FAKE_SYSTEM_ANSWER);

    applyWorldSettingWrite("fake-system:neverSeenBeforeToggle", "setting-xyz", true);

    const row = worldSettingsRegistry.rows.find(
      (r) => r.key === "fake-system:neverSeenBeforeToggle",
    );
    expect(row).toEqual({
      id: "setting-xyz",
      key: "fake-system:neverSeenBeforeToggle",
      kind: "boolean",
      label: "Nunca visto antes",
      value: true,
    });
  });

  it("a write for a key not in the registry changes nothing", () => {
    seedWorldSettingsRegistry(FAKE_SYSTEM_ANSWER);
    const before = worldSettingsRegistry.rows;

    applyWorldSettingWrite("some-other-system:unrelated", "id-1", 42);

    expect(worldSettingsRegistry.rows).toEqual(before);
  });
});
