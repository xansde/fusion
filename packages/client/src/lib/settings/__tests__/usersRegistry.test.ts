/**
 * usersRegistry.test.ts — the client side of `GET /api/users` (spec 37 §5.6,
 * G105, REQ-CFG-050..054).
 *
 * Mirrors `permissionsRegistry.test.ts`/`worldSettingsRegistry.test.ts`:
 * proves the rows actually arrive, that a refusal/timeout leaves the section
 * with nothing to draw instead of throwing, and that reopening the tab does
 * not ask the server twice. `usersApi.js` is mocked at the module boundary
 * (an HTTP call, not a socket op — see `usersApi.ts`'s own docstring).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../usersApi.js", () => ({
  listUsers: vi.fn(),
}));

import { listUsers } from "../usersApi.js";
import {
  applyCreatedUser,
  applyDeactivatedUser,
  applyUpdatedUser,
  ensureUsersRegistry,
  resetUsersRegistry,
  seedUsersRegistry,
  usersRegistry,
} from "../usersRegistry.svelte.js";

const listUsersMock = vi.mocked(listUsers);

const FAKE_USER = {
  id: "u1",
  name: "Alice",
  role: 1,
  color: "#ff0000",
  avatar: null,
  active: true,
};

beforeEach(() => {
  resetUsersRegistry();
  listUsersMock.mockReset();
});

describe("the user list reaches the client (REQ-CFG-050)", () => {
  it("after the answer, the user is in usersRegistry.users", async () => {
    listUsersMock.mockResolvedValue([FAKE_USER]);

    await ensureUsersRegistry("tok-1");

    expect(usersRegistry.users).toEqual([FAKE_USER]);
    expect(listUsersMock).toHaveBeenCalledWith("tok-1");
  });
});

describe("nothing waits on the user list", () => {
  it("before any answer the list is empty, never undefined", () => {
    expect(usersRegistry.users).toEqual([]);
  });

  it("a refused request leaves the list empty instead of throwing", async () => {
    listUsersMock.mockRejectedValue(new Error("PERMISSION_DENIED"));

    await expect(ensureUsersRegistry("tok-1")).resolves.toBeUndefined();
    expect(usersRegistry.users).toEqual([]);
  });
});

describe("the users are fetched once", () => {
  it("REQ-GAV-017: reopening the section does not ask the server again", async () => {
    listUsersMock.mockResolvedValue([FAKE_USER]);

    await ensureUsersRegistry("tok-1");
    await ensureUsersRegistry("tok-1");
    await ensureUsersRegistry("tok-1");

    expect(listUsersMock).toHaveBeenCalledTimes(1);
  });

  it("can be seeded without a fetch", () => {
    seedUsersRegistry([FAKE_USER]);
    expect(usersRegistry.users).toEqual([FAKE_USER]);
    expect(listUsersMock).not.toHaveBeenCalled();
  });
});

describe("applyCreatedUser — REQ-USR-025", () => {
  it("appends the newly created user", () => {
    seedUsersRegistry([FAKE_USER]);
    const newUser = {
      id: "u2",
      name: "Bob",
      role: 1,
      color: "#00ff00",
      avatar: null,
      active: true,
    };

    applyCreatedUser(newUser);

    expect(usersRegistry.users).toEqual([FAKE_USER, newUser]);
  });
});

describe("applyUpdatedUser — REQ-USR-026/REQ-CFG-052", () => {
  it("replaces only the matching user, leaving others untouched", () => {
    const other = { id: "u2", name: "Bob", role: 1, color: "#00ff00", avatar: null, active: true };
    seedUsersRegistry([FAKE_USER, other]);

    applyUpdatedUser({ ...FAKE_USER, name: "Alicia" });

    expect(usersRegistry.users).toEqual([{ ...FAKE_USER, name: "Alicia" }, other]);
  });
});

describe("applyDeactivatedUser — REQ-USR-028", () => {
  it("flips active to false for the matching user only", () => {
    const other = { id: "u2", name: "Bob", role: 1, color: "#00ff00", avatar: null, active: true };
    seedUsersRegistry([FAKE_USER, other]);

    applyDeactivatedUser("u1");

    expect(usersRegistry.users.find((u) => u.id === "u1")?.active).toBe(false);
    expect(usersRegistry.users.find((u) => u.id === "u2")?.active).toBe(true);
  });
});
