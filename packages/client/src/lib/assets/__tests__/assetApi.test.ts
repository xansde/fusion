/**
 * assetApi.test.ts — unit tests for assetUrl() and resolveAssetUrl().
 *
 * BUG A regression test: scene.background / token.texture are persisted as
 * clean "/assets/<name>" paths (no query token). resolveAssetUrl() is the
 * single place that mints a fresh short-lived token and appends it right
 * before an asset is actually loaded (PIXI Assets.load / <img src>).
 *
 * No DOM, no Svelte — fetch is mocked directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assetUrl, resolveAssetUrl, fetchAssetToken } from "../assetApi.js";

describe("assetUrl", () => {
  it("returns a clean path with no query token by default", () => {
    expect(assetUrl("goblin-a3b4c5d6.webp")).toBe("/assets/goblin-a3b4c5d6.webp");
  });

  it("percent-encodes segments but keeps the slash separator", () => {
    expect(assetUrl("a b/c.png")).toBe("/assets/a%20b/c.png");
  });

  it("appends at/ae/au query params when a queryToken is given", () => {
    const url = assetUrl("goblin.webp", { token: "sig123", exp: 1700000000000, userId: "u1" });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/assets/goblin.webp");
    expect(parsed.searchParams.get("at")).toBe("sig123");
    expect(parsed.searchParams.get("ae")).toBe("1700000000000");
    expect(parsed.searchParams.get("au")).toBe("u1");
  });
});

describe("fetchAssetToken", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts to /api/assets/token with the bearer header and returns the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, token: "sig-abc", exp: 1700000005000 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAssetToken("access-tok", "user-42");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assets/token",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer access-tok" },
      }),
    );
    expect(result).toEqual({ token: "sig-abc", exp: 1700000005000, userId: "user-42" });
  });

  it("throws with the server message on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "unauthorized" }),
    }) as unknown as typeof fetch;

    await expect(fetchAssetToken("bad-tok", "user-42")).rejects.toThrow("unauthorized");
  });
});

describe("resolveAssetUrl", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, token: "fresh-token", exp: 1700000005000 }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mints a fresh token and appends it for a local /assets/ path", async () => {
    const url = await resolveAssetUrl("/assets/map-bg-f00d.webp", "access-tok", "user-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/assets/token",
      expect.objectContaining({ method: "POST" }),
    );
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/assets/map-bg-f00d.webp");
    expect(parsed.searchParams.get("at")).toBe("fresh-token");
    expect(parsed.searchParams.get("au")).toBe("user-1");
  });

  it("round-trips a name containing a slash without double-encoding", async () => {
    const url = await resolveAssetUrl("/assets/sub/goblin.png", "access-tok", "user-1");
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/assets/sub/goblin.png");
  });

  it("does NOT call the token endpoint for an external URL", async () => {
    const url = await resolveAssetUrl("https://example.com/image.webp", "access-tok", "user-1");
    expect(url).toBe("https://example.com/image.webp");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT call the token endpoint for a data URI", async () => {
    const dataUri = "data:image/png;base64,AAAA";
    const url = await resolveAssetUrl(dataUri, "access-tok", "user-1");
    expect(url).toBe(dataUri);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes through an empty string without calling the token endpoint", async () => {
    const url = await resolveAssetUrl("", "access-tok", "user-1");
    expect(url).toBe("");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
