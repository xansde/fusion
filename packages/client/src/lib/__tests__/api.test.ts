/**
 * Tests for fusionApi — fetch wrapper with auto-refresh.
 *
 * Uses global fetch mocking (Vitest globalThis.fetch override) so no
 * browser/DOM is required. All tests run in a Node environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// We need to reset the module between test groups because api.ts holds
// module-level state (_accessToken). Use vi.isolateModules() per suite.
// ---------------------------------------------------------------------------

// Helper: build a mock Response
function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("fusionApi.fetchWorldInfo", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns world info on success", async () => {
    const world = {
      id: "world-1",
      title: "Test World",
      systemId: "pf2e",
      users: [{ id: "u1", name: "Aldric", color: "#ff0000", hasPassword: false }],
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true, world }));

    const { fusionApi } = await import("../api.js");
    const result = await fusionApi.fetchWorldInfo();

    expect(result.id).toBe("world-1");
    expect(result.title).toBe("Test World");
    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.name).toBe("Aldric");
  });

  it("throws ApiError on server error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: false, code: "INTERNAL_ERROR", message: "oops" }, 500),
    );

    const { fusionApi, ApiError } = await import("../api.js");
    await expect(fusionApi.fetchWorldInfo()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("fusionApi.login", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("stores access token in memory and returns user", async () => {
    const user = {
      id: "u1",
      name: "Aldric",
      role: 4,
      color: "#ff0000",
      avatar: null,
      active: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: true, accessToken: "tok-abc", user }),
    );

    const { fusionApi } = await import("../api.js");
    const result = await fusionApi.login("u1");

    expect(result.accessToken).toBe("tok-abc");
    expect(result.user.name).toBe("Aldric");
    // Token is in memory — fusionApi.hasToken() returns true
    expect(fusionApi.hasToken()).toBe(true);
  });

  it("does NOT add Authorization header for public login request", async () => {
    const user = {
      id: "u1",
      name: "Aldric",
      role: 1,
      color: "#ff0000",
      avatar: null,
      active: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: true, accessToken: "tok-xyz", user }),
    );

    const { fusionApi } = await import("../api.js");
    await fusionApi.login("u1", "secret");

    // The first (and only) fetch call should be to /api/auth/login
    const [_url, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    // Before login there is no token — header should be absent
    expect(headers.has("Authorization")).toBe(false);
  });

  it("sends password in body when provided", async () => {
    const user = {
      id: "u1",
      name: "Aldric",
      role: 1,
      color: "#ff0000",
      avatar: null,
      active: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true, accessToken: "tok", user }));

    const { fusionApi } = await import("../api.js");
    await fusionApi.login("u1", "mysecret");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as { userId: string; password?: string };
    expect(body.password).toBe("mysecret");
  });

  it("omits password field when empty string is provided", async () => {
    const user = {
      id: "u1",
      name: "Aldric",
      role: 1,
      color: "#ff0000",
      avatar: null,
      active: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true, accessToken: "tok", user }));

    const { fusionApi } = await import("../api.js");
    await fusionApi.login("u1", "");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as { userId: string; password?: string };
    expect(body.password).toBeUndefined();
  });

  it("throws ApiError with retryAfterSecs on 429", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: false, code: "LOCKED_OUT", message: "Too many attempts." }, 429, {
        "Retry-After": "900",
      }),
    );

    const { fusionApi, ApiError } = await import("../api.js");
    try {
      await fusionApi.login("u1", "wrong");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).httpStatus).toBe(429);
      expect((err as InstanceType<typeof ApiError>).retryAfterSecs).toBe(900);
    }
  });
});

describe("fusionApi auto-refresh on 401", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries request with new token after successful refresh", async () => {
    // First: simulate a login to set a token
    const user = {
      id: "u1",
      name: "Aldric",
      role: 1,
      color: "#ff0000",
      avatar: null,
      active: true,
    };

    vi.mocked(fetch)
      // Login response
      .mockResolvedValueOnce(mockResponse({ ok: true, accessToken: "old-tok", user }))
      // Logout: 401 (token expired)
      .mockResolvedValueOnce(
        mockResponse({ ok: false, code: "UNAUTHORIZED", message: "expired" }, 401),
      )
      // Refresh success
      .mockResolvedValueOnce(mockResponse({ ok: true, accessToken: "new-tok", user }))
      // Logout retry after refresh
      .mockResolvedValueOnce(mockResponse({ ok: true }, 200));

    const { fusionApi } = await import("../api.js");
    // Prime the token
    await fusionApi.login("u1");
    // Logout should auto-refresh and succeed
    await fusionApi.logout();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it("calls onSessionExpired and throws SESSION_EXPIRED when refresh also fails", async () => {
    const user = {
      id: "u1",
      name: "Aldric",
      role: 1,
      color: "#ff0000",
      avatar: null,
      active: true,
    };
    const expiredCb = vi.fn();

    vi.mocked(fetch)
      // Login
      .mockResolvedValueOnce(mockResponse({ ok: true, accessToken: "tok", user }))
      // Logout: 401
      .mockResolvedValueOnce(
        mockResponse({ ok: false, code: "UNAUTHORIZED", message: "expired" }, 401),
      )
      // Refresh also fails
      .mockResolvedValueOnce(
        mockResponse({ ok: false, code: "TOKEN_INVALID", message: "invalid" }, 401),
      );

    const { fusionApi, ApiError } = await import("../api.js");
    fusionApi.onSessionExpired(expiredCb);
    await fusionApi.login("u1");

    try {
      await fusionApi.logout();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).code).toBe("SESSION_EXPIRED");
    }

    expect(expiredCb).toHaveBeenCalledOnce();
    expect(fusionApi.hasToken()).toBe(false);
  });
});

describe("fusionApi.clearSession", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("clears the in-memory token", async () => {
    const user = {
      id: "u1",
      name: "Aldric",
      role: 1,
      color: "#ff0000",
      avatar: null,
      active: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true, accessToken: "tok", user }));

    const { fusionApi } = await import("../api.js");
    await fusionApi.login("u1");
    expect(fusionApi.hasToken()).toBe(true);

    fusionApi.clearSession();
    expect(fusionApi.hasToken()).toBe(false);
  });
});

describe("ApiError parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("extracts code and message from JSON error body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: false, code: "VALIDATION_FAILED", message: "userId is required" }, 400),
    );

    const { fusionApi, ApiError } = await import("../api.js");
    try {
      await fusionApi.fetchWorldInfo();
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.code).toBe("VALIDATION_FAILED");
      expect(apiErr.message).toBe("userId is required");
      expect(apiErr.httpStatus).toBe(400);
    }
  });

  it("falls back to statusText when body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Bad Gateway", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const { fusionApi, ApiError } = await import("../api.js");
    try {
      await fusionApi.fetchWorldInfo();
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).httpStatus).toBe(502);
    }
  });
});

describe("Content-Type on bodyless requests (issue #2)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Read the Content-Type the wrapper sent on the Nth fetch call. */
  function sentContentType(callIndex = 0): string | null {
    const call = vi.mocked(fetch).mock.calls[callIndex];
    const init = call?.[1] as RequestInit | undefined;
    return new Headers(init?.headers).get("Content-Type");
  }

  it("omits Content-Type on POST /api/auth/refresh (Fastify rejects empty JSON body)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: true, accessToken: "tok", user: { id: "u1", name: "Aldric" } }),
    );

    const { fusionApi } = await import("../api.js");
    await fusionApi.tryRefresh();

    expect(sentContentType()).toBeNull();
  });

  it("omits Content-Type on POST /api/auth/logout", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true }));

    const { fusionApi } = await import("../api.js");
    await fusionApi.logout();

    expect(sentContentType()).toBeNull();
  });

  it("still sends Content-Type when there is a body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ ok: true, accessToken: "tok", user: { id: "u1", name: "Aldric" } }),
    );

    const { fusionApi } = await import("../api.js");
    await fusionApi.login("u1", "secret");

    expect(sentContentType()).toBe("application/json");
  });

  it("recovers a 401 through refresh without a bodyless Content-Type", async () => {
    vi.mocked(fetch)
      // 1. original request → 401
      .mockResolvedValueOnce(mockResponse({ ok: false, code: "UNAUTHORIZED" }, 401))
      // 2. refresh → 200
      .mockResolvedValueOnce(
        mockResponse({ ok: true, accessToken: "tok2", user: { id: "u1", name: "Aldric" } }),
      )
      // 3. retry → 200
      .mockResolvedValueOnce(mockResponse({ ok: true }));

    // logout is the only endpoint routed through apiFetch (the auto-refresh path)
    const { fusionApi } = await import("../api.js");
    await fusionApi.logout();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    // none of the three carries a body, so none may declare a JSON Content-Type
    expect(sentContentType(0)).toBeNull();
    expect(sentContentType(1)).toBeNull();
    expect(sentContentType(2)).toBeNull();
  });
});
