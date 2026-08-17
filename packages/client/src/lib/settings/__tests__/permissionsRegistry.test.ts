/**
 * permissionsRegistry.test.ts — the client side of `settings:permissions`
 * (spec 37 §5.5, G104, REQ-USR-008/009, REQ-CFG-040..042/073).
 *
 * Mirrors `worldSettingsRegistry.test.ts`: proves the rows actually arrive
 * (a fake permission table, never hardcoded here), that a refusal/timeout
 * leaves the section with nothing to draw instead of throwing, and that
 * reopening the tab does not ask the server twice.
 *
 * The `commitPermissionWrite` block is where REQ-CFG-073 is proved directly:
 * a write the server refuses must leave `registry.rows` at the value the
 * server last actually confirmed — never the value the user picked in the
 * selector.
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { Socket } from "socket.io-client";

import {
  applyPermissionWrite,
  commitPermissionWrite,
  ensurePermissionsRegistry,
  permissionsRegistry,
  resetPermissionsRegistry,
  seedPermissionsRegistry,
} from "../permissionsRegistry.svelte.js";

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

// A FAKE permission table — the point is this module never hardcodes the
// real REQ-USR-008 keys; see permissionsSection.test.ts for the pure logic
// exercised against real keys.
const FAKE_ANSWER = {
  settingId: null,
  permissions: [{ key: "FAKE_PERMISSION", minRole: 2, defaultMinRole: 2 }],
};

beforeEach(() => {
  resetPermissionsRegistry();
});

describe("the world's permission table reaches the client (REQ-CFG-040)", () => {
  it("after the answer, the row is in permissionsRegistry.rows", async () => {
    const { socket } = fakeSocket(FAKE_ANSWER);
    await ensurePermissionsRegistry(socket);

    expect(permissionsRegistry.settingId).toBeNull();
    expect(permissionsRegistry.rows).toHaveLength(1);
    expect(permissionsRegistry.rows[0]?.key).toBe("FAKE_PERMISSION");
  });
});

describe("nothing waits on the permission table", () => {
  it("before any answer the list is empty, never undefined", () => {
    expect(permissionsRegistry.rows).toEqual([]);
    expect(permissionsRegistry.settingId).toBeNull();
  });

  it("a refused request leaves the list empty instead of throwing", async () => {
    const { socket } = fakeSocket(FAKE_ANSWER, { fail: true });

    await expect(ensurePermissionsRegistry(socket)).resolves.toBeUndefined();
    expect(permissionsRegistry.rows).toEqual([]);
  });
});

describe("the rows are fetched once", () => {
  it("REQ-GAV-017: reopening the section does not ask the server again", async () => {
    const { socket, asks } = fakeSocket(FAKE_ANSWER);

    await ensurePermissionsRegistry(socket);
    await ensurePermissionsRegistry(socket);
    await ensurePermissionsRegistry(socket);

    expect(asks).toEqual(["settings:permissions"]);
  });

  it("can be seeded without a socket", () => {
    seedPermissionsRegistry(FAKE_ANSWER);

    expect(permissionsRegistry.rows[0]?.key).toBe("FAKE_PERMISSION");
  });
});

describe("applyPermissionWrite — a confirmed write folds settingId + the row's new floor back in", () => {
  it("a first-ever write attaches the shared Setting document id the ack returned", () => {
    seedPermissionsRegistry(FAKE_ANSWER);

    applyPermissionWrite("setting-perms-xyz", "FAKE_PERMISSION", 1);

    expect(permissionsRegistry.settingId).toBe("setting-perms-xyz");
    const row = permissionsRegistry.rows.find((r) => r.key === "FAKE_PERMISSION");
    expect(row).toEqual({ key: "FAKE_PERMISSION", minRole: 1, defaultMinRole: 2 });
  });

  it("a write for a key not in the registry changes nothing about the rows", () => {
    seedPermissionsRegistry(FAKE_ANSWER);
    const before = permissionsRegistry.rows;

    applyPermissionWrite("setting-perms-xyz", "some-other-key", 4);

    expect(permissionsRegistry.rows).toEqual(before);
  });
});

describe("commitPermissionWrite — REQ-CFG-042/073: server-validated, refusal keeps the previous value", () => {
  it("REQ-CFG-042: a confirmed write is what actually changes the row's effective floor", async () => {
    seedPermissionsRegistry(FAKE_ANSWER);
    const { socket } = fakeSocket({ documents: [{ _id: "setting-perms-1" }] });

    await commitPermissionWrite(
      socket,
      { key: "FAKE_PERMISSION", minRole: 2, defaultMinRole: 2 },
      1,
    );

    expect(permissionsRegistry.settingId).toBe("setting-perms-1");
    expect(permissionsRegistry.rows.find((r) => r.key === "FAKE_PERMISSION")?.minRole).toBe(1);
  });

  it("REQ-CFG-073: a write the server refuses rejects, and the row keeps its previous value — nothing was applied optimistically", async () => {
    seedPermissionsRegistry({
      settingId: "setting-perms-1",
      permissions: [{ key: "FAKE_PERMISSION", minRole: 2, defaultMinRole: 2 }],
    });
    const { socket } = fakeSocket(null, { fail: true });

    await expect(
      commitPermissionWrite(socket, { key: "FAKE_PERMISSION", minRole: 2, defaultMinRole: 2 }, 1),
    ).rejects.toThrow();

    // The refused write never touched the registry: same settingId, same minRole.
    expect(permissionsRegistry.settingId).toBe("setting-perms-1");
    expect(permissionsRegistry.rows.find((r) => r.key === "FAKE_PERMISSION")?.minRole).toBe(2);
  });
});
