/**
 * assetApi.test.ts — unit tests for assetUrl(), assetNameFromPath(),
 * resolveAssetUrl() and resolveBrowseAssetUrl().
 *
 * BUG A regression test: scene.background / token.texture are persisted as
 * clean "/assets/<name>" paths (no query token). resolveAssetUrl() is the
 * single place that attaches a fresh short-lived credential right before an
 * asset is actually loaded (PIXI Assets.load / <img src>).
 *
 * T025: that credential is now a GRANT signed for one document, one user and one
 * canonical name — not a bearer that opened any file on the GM's disk. These
 * tests pin the client half of that contract: which endpoint is called, which
 * name is used to index the answer, and what happens when the answer does not
 * cover the name.
 *
 * No DOM, no Svelte — fetch is mocked directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assetUrl,
  assetNameFromPath,
  resolveAssetUrl,
  resolveBrowseAssetUrl,
  fetchAssetToken,
  uploadAsset,
  listIconGallery,
  iconGalleryUrl,
  deleteIconAsset,
} from "../assetApi.js";
import { clearAssetGrantCache, type AssetDocRef } from "../assetGrants.svelte.js";
import { ASSET_NAME_CANONICALIZATION_CASES } from "@fusion/shared";

const SCENE: AssetDocRef = { table: "scenes", id: "scene-1" };

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

describe("assetNameFromPath", () => {
  // This is the client's half of the identity of a file. If it stops agreeing
  // with the server's canonicalizeAssetName(), there is a pair of spellings
  // that authorises one file and opens another.
  it("strips the /assets/ prefix", () => {
    expect(assetNameFromPath("/assets/goblin.png")).toBe("goblin.png");
  });

  it("preserves the subdirectory — the basename is NOT the identity", () => {
    expect(assetNameFromPath("/assets/maps/segredo.jpg")).toBe("maps/segredo.jpg");
    expect(assetNameFromPath("/assets/segredo.jpg")).toBe("segredo.jpg");
    expect(assetNameFromPath("/assets/maps/segredo.jpg")).not.toBe(
      assetNameFromPath("/assets/segredo.jpg"),
    );
  });

  it("drops empty segments, exactly like the server does", () => {
    expect(assetNameFromPath("/assets/a//b.png")).toBe("a/b.png");
    expect(assetNameFromPath("/assets/a/b.png")).toBe("a/b.png");
  });

  it("decodes each segment ONCE, undoing assetUrl()'s encoding and no more", () => {
    expect(assetNameFromPath("/assets/a%20b.png")).toBe("a b.png");
    // %252e is an encoded "%2e": one decode yields the literal text "%2e",
    // never a ".". Decoding twice is what would produce a traversal segment.
    expect(assetNameFromPath("/assets/%252e%252e/x.png")).toBe("%2e%2e/x.png");
  });

  it("does not normalise case", () => {
    expect(assetNameFromPath("/assets/Mapa.PNG")).toBe("Mapa.PNG");
  });

  it("round-trips through assetUrl()", () => {
    for (const name of ["a b.png", "sub/dir/goblin.png", "Ação-Ébano.png", "100% real.png"]) {
      expect(assetNameFromPath(assetUrl(name))).toBe(name);
    }
  });

  it("derives every spelling in the SHARED contract table exactly as declared", () => {
    // The server asserts against this SAME list (asset-grant.test.ts). Two
    // suites over one table can only both pass by agreeing with each other;
    // two suites over two hand-written lists agree with their own authors,
    // which is precisely how these two divergences survived both sides green.
    for (const testCase of ASSET_NAME_CANONICALIZATION_CASES) {
      expect(
        assetNameFromPath(testCase.storedPath),
        `${testCase.storedPath} — ${testCase.why}`,
      ).toBe(testCase.canonical);
    }
  });

  it("does not THROW on a malformed percent escape — the server tolerates it too", () => {
    // `decodeURIComponent("100% real.png")` raises a URIError. The server
    // catches (reconcile.ts) and keeps the segment, so it happily SIGNED a
    // name this function could not spell: the error propagated out of
    // resolveAssetUrl and the caller painted a placeholder while the server
    // logged an authorised request. `100% real.png` is what a GM produces by
    // dropping a file into the assets folder by hand.
    expect(() => assetNameFromPath("/assets/100% real.png")).not.toThrow();
    expect(assetNameFromPath("/assets/100% real.png")).toBe("100% real.png");
    expect(assetNameFromPath("/assets/dir/%E0%A4%A.png")).toBe("dir/%E0%A4%A.png");
  });

  it("collapses an encoded slash the same way the server does, not one segment early", () => {
    // The order bug: dropping empty segments BEFORE the join turned `%2F` into
    // `a///b.png` here while the server derived `a/b.png`.
    expect(assetNameFromPath("/assets/a/%2F/b.png")).toBe("a/b.png");
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
      json: async () => ({ ok: true, token: "sig-abc", exp: 1700000005000, scope: "browse" }),
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

// ---------------------------------------------------------------------------
// resolveAssetUrl
// ---------------------------------------------------------------------------

/**
 * A fetch mock that answers the two endpoints separately, so a test can tell a
 * DOC grant apart from a BROWSE token by which call was made — not by reading
 * the value back out of the same object it put in.
 */
function routedFetch(grants: Record<string, string>, grantExp = Date.now() + 300_000) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url === "/api/assets/grant") {
      return { ok: true, status: 200, json: async () => ({ ok: true, exp: grantExp, grants }) };
    }
    if (url === "/api/assets/token") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, token: "browse-tok", exp: 1700000005000, scope: "browse" }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function urlsFor(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => call[0] as string);
}

describe("resolveAssetUrl", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAssetGrantCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mints a grant for the DOCUMENT and signs the URL with the grant for that name", async () => {
    const grantExp = Date.now() + 300_000;
    const fetchMock = routedFetch({ "map-bg-f00d.webp": "doc-sig" }, grantExp);
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveAssetUrl("/assets/map-bg-f00d.webp", "access-tok", "user-1", SCENE);

    expect(urlsFor(fetchMock)).toEqual(["/api/assets/grant"]);
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/assets/map-bg-f00d.webp");
    expect(parsed.searchParams.get("at")).toBe("doc-sig");
    expect(parsed.searchParams.get("au")).toBe("user-1");
    // `ae` is NOT decoration: the server puts the expiry inside the HMAC
    // preimage, so a URL carrying any other number verifies against nothing and
    // 404s — a failure that would look like "the image is missing".
    expect(parsed.searchParams.get("ae")).toBe(String(grantExp));
  });

  it("does NOT reach for a browse token when the document already covers the name", async () => {
    // The whole point of the gate: a PLAYER's browse token opens nothing, so
    // falling through to it on the happy path would silently break the table.
    const fetchMock = routedFetch({ "map-bg-f00d.webp": "doc-sig" });
    global.fetch = fetchMock as unknown as typeof fetch;

    await resolveAssetUrl("/assets/map-bg-f00d.webp", "access-tok", "user-1", SCENE);

    expect(urlsFor(fetchMock)).not.toContain("/api/assets/token");
  });

  it("uses the grant of the name being loaded, not just any grant of the document", async () => {
    const fetchMock = routedFetch({ "bg.png": "sig-bg", "goblin.png": "sig-goblin" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const bg = await resolveAssetUrl("/assets/bg.png", "access-tok", "user-1", SCENE);
    const goblin = await resolveAssetUrl("/assets/goblin.png", "access-tok", "user-1", SCENE);

    expect(new URL(bg, "http://localhost").searchParams.get("at")).toBe("sig-bg");
    expect(new URL(goblin, "http://localhost").searchParams.get("at")).toBe("sig-goblin");
  });

  it("pays ONE mint for a background and every token of the same scene", async () => {
    // The reuse the design is built on, at the level where it actually happens:
    // sceneLoader and TokenSprite both call this with the same docRef.
    const grants: Record<string, string> = { "bg.png": "sig-bg" };
    for (let i = 0; i < 40; i += 1) grants[`token-${String(i)}.png`] = `sig-${String(i)}`;
    const fetchMock = routedFetch(grants);
    global.fetch = fetchMock as unknown as typeof fetch;

    await resolveAssetUrl("/assets/bg.png", "access-tok", "user-1", SCENE);
    for (let i = 0; i < 40; i += 1) {
      await resolveAssetUrl(`/assets/token-${String(i)}.png`, "access-tok", "user-1", SCENE);
    }

    expect(urlsFor(fetchMock).filter((u) => u === "/api/assets/grant")).toHaveLength(1);
  });

  it("indexes the grants by the CANONICAL name, so an odd spelling still matches", async () => {
    // "/assets/a//b.png" and "/assets/a/b.png" are the same file; the server
    // signed the canonical form and this must find it.
    const fetchMock = routedFetch({ "a/b.png": "sig-ab" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveAssetUrl("/assets/a//b.png", "access-tok", "user-1", SCENE);

    expect(new URL(url, "http://localhost").searchParams.get("at")).toBe("sig-ab");
    expect(new URL(url, "http://localhost").pathname).toBe("/assets/a/b.png");
  });

  it("falls back to a browse token when the document carries no grant for the name", async () => {
    // Shadow-mode safety net. A request with NO credential at all is refused at
    // the identity step, before the shadow branch runs, so a projection miss
    // would black out the table even with enforcement off.
    const fetchMock = routedFetch({ "other.png": "sig-other" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveAssetUrl("/assets/missing.png", "access-tok", "user-1", SCENE);

    expect(urlsFor(fetchMock)).toEqual(["/api/assets/grant", "/api/assets/token"]);
    expect(new URL(url, "http://localhost").searchParams.get("at")).toBe("browse-tok");
  });

  it("does NOT call any endpoint for an external URL", async () => {
    const fetchMock = routedFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveAssetUrl("https://example.com/image.webp", "t", "user-1", SCENE);
    expect(url).toBe("https://example.com/image.webp");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT call any endpoint for a data URI", async () => {
    const fetchMock = routedFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    const dataUri = "data:image/png;base64,AAAA";
    expect(await resolveAssetUrl(dataUri, "t", "user-1", SCENE)).toBe(dataUri);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through an empty string without calling anything", async () => {
    const fetchMock = routedFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await resolveAssetUrl("", "t", "user-1", SCENE)).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("round-trips a name containing a slash without double-encoding", async () => {
    const fetchMock = routedFetch({ "sub/goblin.png": "sig" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveAssetUrl("/assets/sub/goblin.png", "access-tok", "user-1", SCENE);
    expect(new URL(url, "http://localhost").pathname).toBe("/assets/sub/goblin.png");
  });
});

describe("resolveBrowseAssetUrl", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAssetGrantCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses the browse token and never asks for a document grant", async () => {
    // The FilePicker's sibling: the value was just chosen and belongs to no
    // document, so there is nothing to ask a grant about.
    const fetchMock = routedFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveBrowseAssetUrl("/assets/pick.png", "access-tok", "user-1");

    expect(urlsFor(fetchMock)).toEqual(["/api/assets/token"]);
    expect(new URL(url, "http://localhost").searchParams.get("at")).toBe("browse-tok");
  });

  it("passes an external URL through untouched", async () => {
    const fetchMock = routedFetch({});
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await resolveBrowseAssetUrl("https://example.com/x.png", "t", "u")).toBe(
      "https://example.com/x.png",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The type gate
// ---------------------------------------------------------------------------

describe("docRef is a compile-time gate, not a runtime check", () => {
  it("a call without a docRef does not type-check", () => {
    // This assertion is enforced by `pnpm typecheck` (svelte-check runs over
    // src/**/*.ts, tests included), not by the runtime below. If `docRef` ever
    // gains a default or a `?`, this call becomes VALID and tsc then fails on
    // the unused '@ts-expect-error' directive — which is exactly the alarm we
    // want, since a consumer that cannot name its document would silently
    // start compiling again.
    const call = (): unknown =>
      // @ts-expect-error -- resolveAssetUrl requires a docRef; 3 args must not compile.
      resolveAssetUrl("/assets/x.png", "tok", "user-1");
    expect(typeof call).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// BAR-F3-05 — the icon upload, the shared gallery and the GM's delete
// ---------------------------------------------------------------------------

/** The smallest XMLHttpRequest the upload path touches; records what was opened and sent. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = "";
  private readonly listeners = new Map<string, () => void>();
  readonly upload = { addEventListener: (): void => {} };

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
  send(body: unknown): void {
    this.body = body;
    this.status = 201;
    this.responseText = JSON.stringify({
      ok: true,
      deduplicated: false,
      path: "actionbar-icons/hanabi-1a2b3c4d.png",
      digest: "d",
      mime_type: "image/png",
      file_size: 1,
      purpose: "icon",
    });
    queueMicrotask(() => this.listeners.get("load")?.());
  }
}

describe("uploadAsset — the icon purpose (BAR-F3-05, REQ-BAR-103)", () => {
  const originalXhr = globalThis.XMLHttpRequest;
  beforeEach(() => {
    FakeXhr.last = null;
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = originalXhr;
  });

  const file = (): File => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "Hanabi.png");

  it("declares the purpose in the query string, and nothing else names a folder", async () => {
    const result = await uploadAsset("tok", file(), undefined, { purpose: "icon" });
    expect(FakeXhr.last?.method).toBe("POST");
    expect(FakeXhr.last?.url).toBe("/api/assets/upload?purpose=icon");
    expect(FakeXhr.last?.headers["Authorization"]).toBe("Bearer tok");
    const form = FakeXhr.last?.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    expect(result.path).toBe("actionbar-icons/hanabi-1a2b3c4d.png");
  });

  it("without a purpose it is the generic upload, exactly as before", async () => {
    await uploadAsset("tok", file());
    expect(FakeXhr.last?.url).toBe("/api/assets/upload");
  });
});

describe("listIconGallery — the shared gallery (REQ-BAR-079/080)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GETs /api/assets/icons with the bearer and returns icons, expiry and grants", async () => {
    const body = {
      ok: true,
      assets: [{ name: "actionbar-icons/a-1a2b3c4d.png", size: 10, mime_type: "image/png" }],
      exp: 1_700_000_300_000,
      grants: { "actionbar-icons/a-1a2b3c4d.png": "sig-a" },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;

    const gallery = await listIconGallery("tok");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assets/icons",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer tok" } }),
    );
    expect(gallery).toEqual({ assets: body.assets, exp: body.exp, grants: body.grants });
  });

  it("a body without grants is a gallery that paints nothing, not a crash", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, assets: [] }),
    }) as unknown as typeof fetch;
    expect(await listIconGallery("tok")).toEqual({ assets: [], exp: 0, grants: {} });
  });

  it("throws the server message on a refusal", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Missing token." }),
    }) as unknown as typeof fetch;
    await expect(listIconGallery("")).rejects.toThrow("Missing token.");
  });
});

describe("iconGalleryUrl — painting one icon of the gallery", () => {
  const gallery = {
    assets: [],
    exp: 1_700_000_300_000,
    grants: { "actionbar-icons/a b-1a2b3c4d.png": "sig-a" },
  };

  it("attaches the icon's own grant, keyed by the canonical name", () => {
    const url = new URL(
      iconGalleryUrl(gallery, "actionbar-icons/a b-1a2b3c4d.png", "user-1"),
      "http://localhost",
    );
    expect(url.pathname).toBe("/assets/actionbar-icons/a%20b-1a2b3c4d.png");
    expect(url.searchParams.get("at")).toBe("sig-a");
    expect(url.searchParams.get("ae")).toBe(String(gallery.exp));
    expect(url.searchParams.get("au")).toBe("user-1");
  });

  it("an icon without a grant gets a bare path — never someone else's signature", () => {
    expect(iconGalleryUrl(gallery, "actionbar-icons/b-00000000.png", "user-1")).toBe(
      "/assets/actionbar-icons/b-00000000.png",
    );
  });
});

describe("deleteIconAsset — the GM removes an icon (REQ-BAR-081)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("DELETEs the file name inside the area, encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await deleteIconAsset("gm-tok", "actionbar-icons/a b-1a2b3c4d.png");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assets/icons/a%20b-1a2b3c4d.png",
      expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer gm-tok" } }),
    );
  });

  it("throws the server message on a refusal", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Minimum role required: GAMEMASTER." }),
    }) as unknown as typeof fetch;
    await expect(deleteIconAsset("p-tok", "actionbar-icons/x-00000000.png")).rejects.toThrow(
      "Minimum role required: GAMEMASTER.",
    );
  });
});
