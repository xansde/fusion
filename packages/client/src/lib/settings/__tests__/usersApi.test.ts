/**
 * usersApi.test.ts — wire contract for the GM-only user-administration HTTP
 * API (spec 37 §5.6, G105; spec 05 REQ-USR-025..029, REQ-CFG-050..054).
 *
 * No DOM, no Svelte — `fetch` is mocked directly (same pattern
 * `lib/assets/__tests__/assetApi.test.ts` already established for this
 * package's HTTP-API modules).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  deactivateUser,
  kickUser,
  UsersApiError,
} from "../usersApi.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("listUsers — REQ-CFG-050: GET /api/users", () => {
  it("sends the bearer token and returns the users array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        users: [{ id: "u1", name: "Alice", role: 1, color: "#ff0000", avatar: null, active: true }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const users = await listUsers("tok-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer tok-1" },
        credentials: "include",
      }),
    );
    expect(users).toEqual([
      { id: "u1", name: "Alice", role: 1, color: "#ff0000", avatar: null, active: true },
    ]);
  });

  it("throws UsersApiError with the server's code/message on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: "PERMISSION_DENIED", message: "GM only" }),
    }) as unknown as typeof fetch;

    await expect(listUsers("tok-1")).rejects.toThrow("GM only");
    await expect(listUsers("tok-1")).rejects.toBeInstanceOf(UsersApiError);
  });
});

describe("createUser — REQ-USR-025: POST /api/users", () => {
  it("posts name/role/color/password as JSON and returns the created user", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: "u2", name: "Bob", role: 1, color: "#00ff00", avatar: null, active: true },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = await createUser("tok-1", { name: "Bob", role: 1, color: "#00ff00" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer tok-1", "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: "Bob", role: 1, color: "#00ff00" }),
      }),
    );
    expect(user.id).toBe("u2");
  });

  it("surfaces NAME_TAKEN as a typed error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: "NAME_TAKEN", message: "Name already in use." }),
    }) as unknown as typeof fetch;

    try {
      await createUser("tok-1", { name: "Bob", role: 1 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UsersApiError);
      expect((err as UsersApiError).code).toBe("NAME_TAKEN");
    }
  });
});

describe("updateUser — REQ-USR-026 / REQ-CFG-052: PATCH /api/users/:id", () => {
  it("sends only the given fields and returns the updated user", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: "u1", name: "Alicia", role: 1, color: "#ff0000", avatar: null, active: true },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = await updateUser("tok-1", "u1", { name: "Alicia" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/u1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Alicia" }),
      }),
    );
    expect(user.name).toBe("Alicia");
  });

  it("encodes the id in the URL path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: "u/1", name: "X", role: 1, color: "#000000", avatar: null, active: true },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await updateUser("tok-1", "u/1", { active: false });

    expect(fetchMock).toHaveBeenCalledWith("/api/users/u%2F1", expect.anything());
  });
});

describe("resetPassword — REQ-USR-027 / REQ-CFG-053: POST /api/users/:id/reset-password", () => {
  it("returns the one-time plaintext password", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, password: "correct-horse" }),
    }) as unknown as typeof fetch;

    const result = await resetPassword("tok-1", "u1");

    expect(result).toEqual({ password: "correct-horse" });
  });

  it("returns null when removePassword makes the account passwordless", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, password: null }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await resetPassword("tok-1", "u1", { removePassword: true });

    expect(result).toEqual({ password: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/u1/reset-password",
      expect.objectContaining({ body: JSON.stringify({ removePassword: true }) }),
    );
  });
});

describe("deactivateUser — REQ-USR-028: DELETE /api/users/:id (soft-delete)", () => {
  it("sends DELETE with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await deactivateUser("tok-1", "u1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/u1",
      expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer tok-1" } }),
    );
    // No Content-Type header for a bodyless request (avoids Fastify's
    // FST_ERR_CTP_EMPTY_JSON_BODY, same reasoning as fusionApi's rawFetch).
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });
});

describe("kickUser — REQ-USR-029: POST /api/users/:id/kick", () => {
  it("sends POST with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await kickUser("tok-1", "u1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/u1/kick",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer tok-1" } }),
    );
  });

  it("throws on failure with the server's message", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: "USER_NOT_FOUND", message: "User not found." }),
    }) as unknown as typeof fetch;

    await expect(kickUser("tok-1", "ghost")).rejects.toThrow("User not found.");
  });
});
