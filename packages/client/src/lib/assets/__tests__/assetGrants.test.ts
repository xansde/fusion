/**
 * assetGrants.test.ts — the per-document grant cache (T025).
 *
 * What is actually being asserted here is COST and REUSE: the server signs one
 * bundle per document, and a scene with a background plus forty tokens must pay
 * for exactly one round-trip, not forty-one. Everything else in this file exists
 * to pin the edges of that: what is cached, what is deliberately NOT cached, and
 * what happens when two consumers of the same document ask at the same tick.
 *
 * No DOM, no Svelte — fetch is mocked directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assetGrantsFor,
  assetGrantsCovering,
  invalidateAssetGrants,
  clearAssetGrantCache,
  peekAssetGrants,
  type AssetDocRef,
} from "../assetGrants.svelte.js";

const SCENE: AssetDocRef = { table: "scenes", id: "scene-1" };
const OTHER_SCENE: AssetDocRef = { table: "scenes", id: "scene-2" };
const ACTOR: AssetDocRef = { table: "actors", id: "scene-1" };

/** A mint answer 5 minutes out, like the server's ASSET_GRANT_TTL_MS. */
function grantResponse(grants: Record<string, string>, ttlMs = 300_000): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, exp: Date.now() + ttlMs, grants }),
  };
}

const originalFetch = global.fetch;

describe("assetGrantsFor", () => {
  beforeEach(() => {
    clearAssetGrantCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts { table, id } as a lookup key, with the bearer header — never content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({ "bg.png": "sig-bg" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsFor(SCENE, "access-tok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/assets/grant");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer access-tok",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ table: "scenes", id: "scene-1" });
  });

  it("mints ONCE per document and serves every later reader from the cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(grantResponse({ "bg.png": "sig-bg", "goblin.png": "sig-goblin" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await assetGrantsFor(SCENE, "access-tok");
    const second = await assetGrantsFor(SCENE, "access-tok");
    const third = await assetGrantsFor(SCENE, "access-tok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first.grants["goblin.png"]).toBe("sig-goblin");
  });

  it("collapses CONCURRENT asks for the same document into one request", async () => {
    // The real shape of the scene load: the background and forty token sprites
    // all ask in the same tick, before any answer has come back. Without the
    // in-flight map the cache would be empty for all of them and every sprite
    // would mint its own.
    const deferred: { release: () => void } = { release: () => undefined };
    const gate = new Promise<void>((resolve) => {
      deferred.release = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(async () => {
      await gate;
      return grantResponse({ "bg.png": "sig-bg" });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const all = Promise.all(Array.from({ length: 41 }, () => assetGrantsFor(SCENE, "access-tok")));
    deferred.release();
    const bundles = await all;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const bundle of bundles) expect(bundle).toBe(bundles[0]);
  });

  it("keys the cache by table AND id — a same-id row of another table is another document", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({ "x.png": "sig-x" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsFor(SCENE, "access-tok");
    await assetGrantsFor(ACTOR, "access-tok"); // same id string, different table
    await assetGrantsFor(OTHER_SCENE, "access-tok");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("re-mints once the cached bundle is close enough to expiry to be a race", async () => {
    // 20 s of life left is below the 30 s floor: handing that URL to an <img>
    // would put the expiry race inside the image request itself.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(grantResponse({ "bg.png": "old-sig" }, 20_000))
      .mockResolvedValueOnce(grantResponse({ "bg.png": "new-sig" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const stale = await assetGrantsFor(SCENE, "access-tok");
    expect(stale.grants["bg.png"]).toBe("old-sig");
    expect(peekAssetGrants(SCENE)).toBeNull(); // never entered the cache

    const fresh = await assetGrantsFor(SCENE, "access-tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fresh.grants["bg.png"]).toBe("new-sig");
  });

  it("does NOT cache a refused mint: a 404 now must not blind the next five minutes", async () => {
    // A player asks while the scene is still off air (404), the GM puts it on
    // air, the player asks again. A cached refusal would keep the map black
    // until the TTL ran out with nothing on screen to explain it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, code: "NOT_FOUND", message: "Document not found." }),
      })
      .mockResolvedValueOnce(grantResponse({ "bg.png": "sig-bg" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const refused = await assetGrantsFor(SCENE, "access-tok");
    expect(refused.grants).toEqual({});
    expect(peekAssetGrants(SCENE)).toBeNull();

    const allowed = await assetGrantsFor(SCENE, "access-tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(allowed.grants["bg.png"]).toBe("sig-bg");
  });

  it("never rejects — a network failure resolves to an empty bundle", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    await expect(assetGrantsFor(SCENE, "access-tok")).resolves.toEqual({ exp: 0, grants: {} });
  });

  it("caches an EMPTY-but-granted answer: a document with no art still costs one mint", async () => {
    // The folder case, and the scene with a solid-colour background: `grants` is
    // {} with a 200 and a real expiry. That is an answer, not a refusal.
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsFor({ table: "folders", id: "f1" }, "access-tok");
    await assetGrantsFor({ table: "folders", id: "f1" }, "access-tok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekAssetGrants({ table: "folders", id: "f1" })?.grants).toEqual({});
  });

  it("clearAssetGrantCache forgets everything — a grant is signed for ONE user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({ "bg.png": "sig-bg" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsFor(SCENE, "access-tok");
    clearAssetGrantCache();
    expect(peekAssetGrants(SCENE)).toBeNull();

    await assetGrantsFor(SCENE, "access-tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The stale bundle — a document changes while the table is playing
// ---------------------------------------------------------------------------

describe("assetGrantsCovering", () => {
  beforeEach(() => {
    clearAssetGrantCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("re-mints when the cached bundle has no signature for the name asked about", async () => {
    // THE MESA-BREAKER the adversarial review proved. A bundle is a photograph
    // of a document up to five minutes old, and nothing ever ADDS a name to
    // one. The GM drags a monster onto the scene mid-combat, the player's
    // client applies the doc:update and asks for the new texture — and with
    // `assetGrantsFor` the answer came out of a cache that was minted when he
    // entered the scene, so the token painted as a placeholder for up to five
    // minutes. (Verified: exactly ONE POST was ever made, and the second name
    // silently fell through to a browse token, which a PLAYER cannot use.)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(grantResponse({ "bg.png": "sig-bg" }))
      .mockResolvedValueOnce(grantResponse({ "bg.png": "sig-bg", "goblin.png": "sig-goblin" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await assetGrantsCovering(SCENE, "bg.png", "tok");
    expect(first.grants["goblin.png"]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await assetGrantsCovering(SCENE, "goblin.png", "tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.grants["goblin.png"]).toBe("sig-goblin");
  });

  it("serves a name the cached bundle DOES cover without a round-trip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({ "bg.png": "sig-bg" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsCovering(SCENE, "bg.png", "tok");
    await assetGrantsCovering(SCENE, "bg.png", "tok");
    await assetGrantsCovering(SCENE, "bg.png", "tok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not storm: a name the document genuinely lacks re-mints ONCE, not per repaint", async () => {
    // The cooldown is the whole reason the recovery above is safe to have. A
    // player asking for art he is not entitled to — or a path that no longer
    // exists anywhere — must not turn every repaint into a mint.
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({ "bg.png": "sig-bg" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsCovering(SCENE, "bg.png", "tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i += 1) {
      await assetGrantsCovering(SCENE, "nunca-existiu.png", "tok");
    }
    // One recovery attempt, and then silence until the cooldown lapses.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidateAssetGrants forces the next ask to mint again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse({ "bg.png": "sig-bg" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetGrantsFor(SCENE, "tok");
    expect(peekAssetGrants(SCENE)).not.toBeNull();

    invalidateAssetGrants(SCENE);
    expect(peekAssetGrants(SCENE)).toBeNull();

    await assetGrantsFor(SCENE, "tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // And it does not leak across documents.
    invalidateAssetGrants(OTHER_SCENE);
    expect(peekAssetGrants(SCENE)).not.toBeNull();
  });
});
