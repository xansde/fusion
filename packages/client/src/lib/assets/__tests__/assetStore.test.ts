/**
 * assetStore.test.ts — unit tests for the reactive asset store's non-upload
 * actions.
 *
 * Covers wi-mapa-som-01 review §3 (curation of the asset library):
 *   - removeAsset(): the delete button's target action — success removes the
 *     asset from the reactive list, failure keeps the list intact and
 *     propagates the error message for the caller to surface.
 *   - startUpload()'s `kinds` param: a file whose kind is outside the
 *     picker's `kinds` is rejected into the SAME error slot as any other
 *     validation failure, before any network call.
 *
 * No DOM, no Svelte component — global.fetch is stubbed directly (same
 * pattern as assetApi.test.ts). Runs in Vitest's "node" environment, so
 * XMLHttpRequest is not global; every test here that expects a REJECTION
 * never reaches uploadAsset()'s `new XMLHttpRequest()` call, which the
 * asserted (kinds-scoped) error message proves — a stray "XMLHttpRequest is
 * not defined" message would mean validation didn't short-circuit.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { assetStore } from "../assetStore.svelte.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

// ---------------------------------------------------------------------------
// removeAsset
// ---------------------------------------------------------------------------

describe("assetStore.removeAsset", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("removes the asset from the list on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          assets: [
            { name: "a.png", size: 10, mime_type: "image/png" },
            { name: "b.png", size: 20, mime_type: "image/png" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetStore.loadAssets("tok");
    expect(assetStore.assets.map((a) => a.name)).toEqual(["a.png", "b.png"]);

    await assetStore.removeAsset("tok", "a.png");

    expect(assetStore.assets.map((a) => a.name)).toEqual(["b.png"]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/assets/a.png",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps the list intact and propagates the server message on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, assets: [{ name: "a.png", size: 10, mime_type: "image/png" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: "You do not have permission to delete files." }, false, 403),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetStore.loadAssets("tok");

    await expect(assetStore.removeAsset("tok", "a.png")).rejects.toThrow(
      "You do not have permission to delete files.",
    );
    expect(assetStore.assets.map((a) => a.name)).toEqual(["a.png"]);
  });

  it("percent-encodes the asset name in the delete URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          assets: [{ name: "a b.png", size: 10, mime_type: "image/png" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await assetStore.loadAssets("tok");
    await assetStore.removeAsset("tok", "a b.png");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/assets/a%20b.png",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

// ---------------------------------------------------------------------------
// startUpload — kinds param (drop/file-input honoring the picker's scope)
// ---------------------------------------------------------------------------

describe("assetStore.startUpload — kinds param", () => {
  function makeFile(name: string, type: string): File {
    return new File([new Uint8Array(10)], name, { type });
  }

  it("rejects a file outside kinds into the upload-error slot, without touching the network", async () => {
    const file = makeFile("track.mp3", "audio/mpeg");

    await assetStore.startUpload("tok", file, undefined, ["image"]);

    const state = assetStore.uploads.get(file);
    expect(state?.status).toBe("error");
    expect(state?.errorMessage).toBe("track.mp3: not allowed in this picker (image only).");
  });

  it("omitting kinds falls back to the full allowlist (no extra restriction)", async () => {
    // No image/audio kind mismatch is possible here — an unsupported
    // extension is still rejected on its own terms.
    const file = makeFile("malware.exe", "application/octet-stream");

    await assetStore.startUpload("tok", file, undefined);

    const state = assetStore.uploads.get(file);
    expect(state?.status).toBe("error");
    expect(state?.errorMessage).toMatch(/not supported/i);
  });
});
