/**
 * Tests for manifest-client.ts's two source shapes (M6/B5 — REQ-DST-019/025).
 *
 * Covers what update-checker.test.ts and downloader.test.ts do NOT: the
 * GitHub-releases parsing path (`parseGithubReleases`, exercised only
 * indirectly through `fetchUpdateManifest` since it is not exported) with a
 * GitHub-API-shaped payload (never the real GitHub API — a fake `fetchImpl`
 * stands in), and the channel-mismatch guard on both the direct-manifest and
 * GitHub-asset paths (LOW fix from the M6/B5 audit).
 */

import { describe, it, expect } from "vitest";
import { fetchUpdateManifest, currentPlatformKey } from "../manifest-client.js";

/** Build a minimal fake `fetch` that answers a fixed sequence of URL -> response. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes[url];
    if (route === undefined) {
      throw new Error(`fakeFetch: no route registered for ${url}`);
    }
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 200 && status < 300 ? "OK" : "Error",
      json: async () => route.body,
    } as Response;
  }) as typeof fetch;
}

const REPO = "acme/fusion";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases`;

function githubRelease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: "v2.0.0",
    name: "v2.0.0",
    prerelease: false,
    assets: [
      {
        name: "latest-stable.json",
        browser_download_url:
          "https://github.com/acme/fusion/releases/download/v2.0.0/latest-stable.json",
      },
    ],
    ...overrides,
  };
}

function directManifestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "2.0.0",
    releaseDate: "2026-07-01T00:00:00.000Z",
    releaseNotes: "notes",
    channel: "stable",
    platforms: {
      "windows-x64": { url: "https://example.com/fusion.exe", sha256: "a".repeat(64), size: 123 },
    },
    ...overrides,
  };
}

describe("currentPlatformKey", () => {
  it("maps win32/darwin/linux to the release matrix's naming convention", () => {
    expect(currentPlatformKey("win32", "x64")).toBe("windows-x64");
    expect(currentPlatformKey("darwin", "arm64")).toBe("macos-arm64");
    expect(currentPlatformKey("linux", "x64")).toBe("linux-x64");
  });
});

describe("fetchUpdateManifest — GitHub releases path (parseGithubReleases)", () => {
  it("resolves the latest matching release, fetches its latest-<channel>.json asset, and reuses parseDirectManifest", async () => {
    const manifestAssetUrl =
      "https://github.com/acme/fusion/releases/download/v2.0.0/latest-stable.json";
    const fetchImpl = fakeFetch({
      [RELEASES_URL]: { body: [githubRelease()] },
      [manifestAssetUrl]: { body: directManifestBody() },
    });

    const result = await fetchUpdateManifest({ updateRepo: REPO, channel: "stable", fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.version).toBe("2.0.0");
      expect(result.manifest.channel).toBe("stable");
      expect(result.manifest.platforms["windows-x64"]?.sha256).toBe("a".repeat(64));
    }
  });

  it("filters releases by channel: a stable request skips prerelease/-dev-tagged releases", async () => {
    const stableAssetUrl =
      "https://github.com/acme/fusion/releases/download/v1.0.0/latest-stable.json";
    const fetchImpl = fakeFetch({
      [RELEASES_URL]: {
        body: [
          // Newest first, as GitHub returns them — a dev release ahead of the stable one.
          githubRelease({ tag_name: "v2.0.0-dev.3", name: "v2.0.0-dev.3", prerelease: true }),
          githubRelease({
            tag_name: "v1.0.0",
            name: "v1.0.0",
            prerelease: false,
            assets: [
              {
                name: "latest-stable.json",
                browser_download_url: stableAssetUrl,
              },
            ],
          }),
        ],
      },
      [stableAssetUrl]: { body: directManifestBody({ version: "1.0.0" }) },
    });

    const result = await fetchUpdateManifest({ updateRepo: REPO, channel: "stable", fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.version).toBe("1.0.0");
    }
  });

  it("filters releases by channel: a dev request only matches prerelease/-dev-tagged releases", async () => {
    const devAssetUrl =
      "https://github.com/acme/fusion/releases/download/v2.0.0-dev.3/latest-dev.json";
    const fetchImpl = fakeFetch({
      [RELEASES_URL]: {
        body: [
          githubRelease({
            tag_name: "v2.0.0-dev.3",
            name: "v2.0.0-dev.3",
            prerelease: true,
            assets: [{ name: "latest-dev.json", browser_download_url: devAssetUrl }],
          }),
          githubRelease({ tag_name: "v1.0.0", name: "v1.0.0", prerelease: false }),
        ],
      },
      [devAssetUrl]: { body: directManifestBody({ version: "2.0.0-dev.3", channel: "dev" }) },
    });

    const result = await fetchUpdateManifest({ updateRepo: REPO, channel: "dev", fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.version).toBe("2.0.0-dev.3");
      expect(result.manifest.channel).toBe("dev");
    }
  });

  it("fails cleanly when no release matches the requested channel", async () => {
    const fetchImpl = fakeFetch({
      [RELEASES_URL]: { body: [githubRelease({ prerelease: true, tag_name: "v2.0.0-dev.1" })] },
    });

    const result = await fetchUpdateManifest({ updateRepo: REPO, channel: "stable", fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('No release found for channel "stable"');
    }
  });

  it("fails cleanly when the matching release has no latest-<channel>.json asset", async () => {
    const fetchImpl = fakeFetch({
      [RELEASES_URL]: { body: [githubRelease({ assets: [] })] },
    });

    const result = await fetchUpdateManifest({ updateRepo: REPO, channel: "stable", fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("latest-stable.json");
    }
  });

  it("rejects a manifest asset whose own channel field disagrees with the requested channel (channel-mismatch guard)", async () => {
    const manifestAssetUrl =
      "https://github.com/acme/fusion/releases/download/v2.0.0/latest-stable.json";
    const fetchImpl = fakeFetch({
      [RELEASES_URL]: { body: [githubRelease()] },
      // Mixed-up asset: served under the "stable" name but declares channel "dev" internally.
      [manifestAssetUrl]: { body: directManifestBody({ channel: "dev" }) },
    });

    const result = await fetchUpdateManifest({ updateRepo: REPO, channel: "stable", fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Manifest channel mismatch");
      expect(result.reason).toContain('requested "stable"');
      expect(result.reason).toContain('declares "dev"');
    }
  });
});

describe("fetchUpdateManifest — direct manifestUrl path (parseDirectManifest)", () => {
  it("parses a well-formed manifest verbatim", async () => {
    const fetchImpl = fakeFetch({
      "https://mirror.example.com/latest-stable.json": { body: directManifestBody() },
    });

    const result = await fetchUpdateManifest({
      manifestUrl: "https://mirror.example.com/latest-stable.json",
      channel: "stable",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.version).toBe("2.0.0");
    }
  });

  it("does NOT enforce a channel-mismatch guard on the plain manifestUrl path (no expectedChannel passed)", async () => {
    // Documents existing behaviour: the direct manifestUrl path (self-hosted
    // mirrors / test fixtures) trusts the fetched manifest's own declared
    // channel rather than cross-checking it against the `channel` param —
    // unlike the GitHub asset path above, which now validates this.
    const fetchImpl = fakeFetch({
      "https://mirror.example.com/latest-stable.json": {
        body: directManifestBody({ channel: "dev" }),
      },
    });

    const result = await fetchUpdateManifest({
      manifestUrl: "https://mirror.example.com/latest-stable.json",
      channel: "stable",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.channel).toBe("dev");
    }
  });

  it("fails on a malformed manifest (missing required fields)", async () => {
    const fetchImpl = fakeFetch({
      "https://mirror.example.com/latest-stable.json": { body: { version: "2.0.0" } },
    });

    const result = await fetchUpdateManifest({
      manifestUrl: "https://mirror.example.com/latest-stable.json",
      channel: "stable",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("missing required fields");
    }
  });
});

describe("fetchUpdateManifest — DA-01 placeholder repo", () => {
  it("is a non-blocking no-op when updateRepo is unset and no manifestUrl is given", async () => {
    const result = await fetchUpdateManifest({ channel: "stable" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not configured");
    }
  });

  it("is a non-blocking no-op when updateRepo still has the REPLACE_ME placeholder", async () => {
    const result = await fetchUpdateManifest({
      updateRepo: "REPLACE_ME/fusion",
      channel: "stable",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not configured");
    }
  });
});
