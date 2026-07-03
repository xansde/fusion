/**
 * Fetch the update manifest for the configured channel (M6/B5 —
 * REQ-DST-019/020/025).
 *
 * Two source shapes are supported, both returning the same
 * {@link UpdateManifest} envelope:
 *
 *  1. GitHub Releases API (production): `GET
 *     https://api.github.com/repos/{owner}/{repo}/releases` — filtered by
 *     channel (a release is "dev" if its tag/name contains "-dev" or it is
 *     marked prerelease; everything else is "stable") and reduced to the
 *     latest matching release. Rather than hand-matching each platform's
 *     binary asset by naming convention, the matching release's own
 *     `latest-<channel>.json` asset (published by release.yml's `publish`
 *     job — see that workflow's "Collect binaries for the release" step) is
 *     located via `assets[].browser_download_url`, fetched, and parsed with
 *     the SAME {@link parseDirectManifest} used for path 2 below — so the
 *     GitHub path always yields the full multi-platform manifest the release
 *     pipeline actually built and hashed, not a hand-reconstructed one.
 *
 *  2. Direct manifest URL (tests / self-hosted mirrors): a
 *     `latest-<channel>.json` file matching the exact
 *     `UpdateManifest`/{@link buildManifest} shape from
 *     tools/release/manifest.mjs, fetched verbatim. This is what the test
 *     suite's local mock Fastify server serves — it is deliberately the
 *     SAME shape the real release pipeline publishes, so a test manifest
 *     and the production GitHub-hosted one are interchangeable inputs to
 *     {@link parseDirectManifest}.
 *
 * Non-blocking by construction (REQ-DST-020): every function here returns a
 * typed result object instead of throwing on network failure — callers
 * (update-checker.ts) decide how to surface "could not check" without ever
 * treating it as fatal to boot.
 */

import { platform as osPlatform, arch as osArch } from "node:os";

// ---------------------------------------------------------------------------
// Types — mirrors tools/release/manifest.mjs's UpdateManifest shape exactly.
// ---------------------------------------------------------------------------

export interface UpdateManifestPlatformEntry {
  url: string;
  sha256: string;
  size: number;
  signature?: string;
}

export interface UpdateManifest {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  channel: "stable" | "dev";
  platforms: Record<string, UpdateManifestPlatformEntry>;
}

export type UpdateChannel = "stable" | "dev";

/**
 * Resolve the platform key this running process should look up in
 * `manifest.platforms` — matches the naming convention
 * tools/release/build-release.mjs uses when it writes each matrix leg's
 * entry (see manifest.mjs's `platformKey` parameter and release.yml).
 */
export function currentPlatformKey(
  platform: NodeJS.Platform = osPlatform(),
  arch: string = osArch(),
): string {
  const platformName = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  return `${platformName}-${arch}`;
}

export class ManifestFetchError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ManifestFetchError";
  }
}

export interface FetchManifestOptions {
  /**
   * Direct URL to a `latest-<channel>.json` file. When provided, this wins
   * over `updateRepo`/GitHub entirely — used by tests and by self-hosted
   * mirrors. Config.ts does not expose this today (REQ-DST-025 only
   * specifies `updateRepo` + `updateChannel`), so in production this is
   * always undefined and the GitHub path below is used.
   */
  manifestUrl?: string;
  /** `owner/repo` GitHub slug (config.ts's `updateRepo`, DA-01). */
  updateRepo?: string;
  channel: UpdateChannel;
  /** Injectable fetch for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms. Default: 5000 — must stay short (REQ-DST-020, non-blocking boot check). */
  timeoutMs?: number;
}

/**
 * Fetch and parse the update manifest for `options.channel`. Never throws —
 * resolves `{ ok: true, manifest }` on success or `{ ok: false, reason }` on
 * ANY failure (network error, timeout, non-2xx, malformed JSON, placeholder
 * repo). This is the load-bearing non-blocking contract (REQ-DST-020).
 */
export async function fetchUpdateManifest(
  options: FetchManifestOptions,
): Promise<{ ok: true; manifest: UpdateManifest } | { ok: false; reason: string }> {
  const { manifestUrl, updateRepo, channel, fetchImpl = fetch, timeoutMs = 5000 } = options;

  if (
    manifestUrl === undefined &&
    (updateRepo === undefined || updateRepo.startsWith("REPLACE_ME"))
  ) {
    // DA-01: placeholder repo — update checking is deliberately a no-op
    // rather than a hard error, so a fresh checkout with no owner/repo
    // configured yet never logs scary failures on every boot.
    return { ok: false, reason: "Update checking disabled: updateRepo is not configured." };
  }

  const url = manifestUrl ?? `https://api.github.com/repos/${String(updateRepo)}/releases`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: manifestUrl !== undefined ? "application/json" : "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: `Update check request failed: HTTP ${String(res.status)} ${res.statusText}`,
      };
    }

    const body: unknown = await res.json();

    if (manifestUrl !== undefined) {
      return parseDirectManifest(body);
    }
    return await parseGithubReleases(body, channel, fetchImpl, controller.signal);
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Update check timed out after ${String(timeoutMs)}ms`
          : err.message
        : String(err);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDirectManifest(
  body: unknown,
  expectedChannel?: UpdateChannel,
): { ok: true; manifest: UpdateManifest } | { ok: false; reason: string } {
  if (!isPlainObject(body)) {
    return { ok: false, reason: "Manifest response was not a JSON object." };
  }
  const version = body["version"];
  const channel = body["channel"];
  const platforms = body["platforms"];
  if (
    typeof version !== "string" ||
    (channel !== "stable" && channel !== "dev") ||
    !isPlainObject(platforms)
  ) {
    return {
      ok: false,
      reason: "Manifest response is missing required fields (version/channel/platforms).",
    };
  }

  // MEDIA fix (manifest-client.ts): reject a manifest whose own `channel`
  // field disagrees with the channel the caller asked for. Without this, a
  // stale or hand-edited `latest-<channel>.json` (or a mixed-up asset from
  // the wrong release) could silently report itself as e.g. "stable" while
  // actually being served in response to a "dev" channel request — the GM
  // would apply an update believing it matches their configured channel
  // when it does not. `expectedChannel` is undefined for the plain
  // `manifestUrl` test/self-hosted-mirror path, where the caller does not
  // pass one — that path keeps its existing behaviour (trust the fetched
  // manifest's own declared channel) unchanged.
  if (expectedChannel !== undefined && channel !== expectedChannel) {
    return {
      ok: false,
      reason: `Manifest channel mismatch: requested "${expectedChannel}" but manifest declares "${channel}".`,
    };
  }

  const releaseNotes = typeof body["releaseNotes"] === "string" ? body["releaseNotes"] : "";
  const releaseDate =
    typeof body["releaseDate"] === "string" ? body["releaseDate"] : new Date(0).toISOString();

  const parsedPlatforms: Record<string, UpdateManifestPlatformEntry> = {};
  for (const [key, value] of Object.entries(platforms)) {
    if (!isPlainObject(value)) continue;
    const { url, sha256, size } = value;
    if (typeof url === "string" && typeof sha256 === "string" && typeof size === "number") {
      parsedPlatforms[key] = { url, sha256, size };
      const signature = value["signature"];
      if (typeof signature === "string") {
        parsedPlatforms[key] = { ...parsedPlatforms[key], signature };
      }
    }
  }

  return {
    ok: true,
    manifest: { version, releaseDate, releaseNotes, channel, platforms: parsedPlatforms },
  };
}

/**
 * Map a GitHub `/releases` list response into the same UpdateManifest shape,
 * picking the latest release matching `channel`:
 *   - "dev": release.prerelease === true, OR tag/name contains "-dev".
 *   - "stable": everything else (prerelease === false and no "-dev" marker).
 * GitHub already returns releases newest-first, so the first match wins.
 *
 * ASSET-MATCHING (MEDIA fix): release.yml's `publish` job already builds and
 * uploads a merged `latest-<channel>.json` as a release asset (see
 * `Collect binaries for the release` / `cp latest-stable.json release-files/`
 * in that workflow) — the SAME shape `parseDirectManifest` already knows how
 * to parse, with real per-platform `url`/`sha256`/`size` entries. Rather than
 * hand-rolling asset-name matching against `assets[].browser_download_url`
 * for every binary AND re-deriving version/date/notes from the GitHub
 * release metadata, fetch that manifest asset and delegate to
 * `parseDirectManifest` — the two code paths become "find the right asset
 * URL, then reuse the exact same parser", eliminating an entire duplicate
 * (and previously nonexistent) platform-matching implementation.
 */
async function parseGithubReleases(
  body: unknown,
  channel: UpdateChannel,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ ok: true; manifest: UpdateManifest } | { ok: false; reason: string }> {
  if (!Array.isArray(body)) {
    return { ok: false, reason: "GitHub releases response was not an array." };
  }

  const manifestAssetName = `latest-${channel}.json`;

  for (const entry of body) {
    if (!isPlainObject(entry)) continue;
    const tagName = typeof entry["tag_name"] === "string" ? entry["tag_name"] : "";
    const name = typeof entry["name"] === "string" ? entry["name"] : "";
    const prerelease = entry["prerelease"] === true;
    const isDevMarked = tagName.includes("-dev") || name.includes("-dev") || prerelease;

    if (channel === "dev" && !isDevMarked) continue;
    if (channel === "stable" && isDevMarked) continue;

    const version = tagName.replace(/^v/, "");
    if (version.length === 0) continue;

    const assets: unknown = entry["assets"];
    if (!Array.isArray(assets)) {
      return {
        ok: false,
        reason: `Release "${tagName}" has no assets array — cannot locate ${manifestAssetName}.`,
      };
    }

    const manifestAsset: unknown = (assets as unknown[]).find(
      (asset) => isPlainObject(asset) && asset["name"] === manifestAssetName,
    );
    if (!isPlainObject(manifestAsset)) {
      return {
        ok: false,
        reason: `Release "${tagName}" does not have a "${manifestAssetName}" asset — cannot resolve platform download URLs.`,
      };
    }
    const downloadUrl = manifestAsset["browser_download_url"];
    if (typeof downloadUrl !== "string") {
      return {
        ok: false,
        reason: `Release "${tagName}"'s "${manifestAssetName}" asset has no browser_download_url.`,
      };
    }

    let manifestBody: unknown;
    try {
      const res = await fetchImpl(downloadUrl, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: `Fetching ${manifestAssetName} failed: HTTP ${String(res.status)} ${res.statusText}`,
        };
      }
      manifestBody = await res.json();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Fetching ${manifestAssetName} failed: ${reason}` };
    }

    return parseDirectManifest(manifestBody, channel);
  }

  return { ok: false, reason: `No release found for channel "${channel}".` };
}
