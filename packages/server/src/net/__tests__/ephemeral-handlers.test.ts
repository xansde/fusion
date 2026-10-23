/**
 * Unit tests for buildPresenceOnlineBroadcast — REQ-NET-043.
 *
 * Integration coverage (the actual socket payload on connect/disconnect)
 * lives in `__tests__/ephemeral.test.ts`; this file exercises the pure
 * envelope-shaping function in isolation, with no DB and no socket.
 */

import { describe, it, expect } from "vitest";
import { buildPresenceOnlineBroadcast } from "../ephemeral-handlers.js";

describe("buildPresenceOnlineBroadcast (REQ-NET-043)", () => {
  const accounts = [
    { id: "u-gm", name: "Mestra Iris", color: "#e03030" },
    { id: "u-p1", name: "Tobias", color: "#1f8dd6" },
  ];

  it("marks every account online/offline against the connected-id set", () => {
    const envelope = buildPresenceOnlineBroadcast(accounts, new Set(["u-gm"]), 1000);

    expect(envelope.type).toBe("presence:online");
    expect(envelope.ts).toBe(1000);
    expect(envelope.payload.users).toEqual([
      { userId: "u-gm", userName: "Mestra Iris", color: "#e03030", online: true },
      { userId: "u-p1", userName: "Tobias", color: "#1f8dd6", online: false },
    ]);
  });

  it("keeps an account in the roster (online:false) when nobody is connected", () => {
    const envelope = buildPresenceOnlineBroadcast(accounts, new Set(), 2000);

    expect(envelope.payload.users).toHaveLength(2);
    expect(envelope.payload.users.every((u) => !u.online)).toBe(true);
  });

  it("is a pure function: same input always yields the same output", () => {
    const first = buildPresenceOnlineBroadcast(accounts, new Set(["u-p1"]), 5000);
    const second = buildPresenceOnlineBroadcast(accounts, new Set(["u-p1"]), 5000);
    expect(second).toEqual(first);
  });
});
