/**
 * Pinned `cloudflared` release metadata (M6/B4 — REQ-DST-034, DEC-M6-02, DA-05).
 *
 * `cloudflared` is Cloudflare's tunnel client, licensed Apache-2.0
 * (https://github.com/cloudflare/cloudflared). It is NOT an npm dependency —
 * per DEC-M6-02 it is downloaded on demand, at runtime, only when the GM
 * opts in via `fusion serve --tunnel` or the admin "Compartilhar pela
 * internet" toggle. This keeps it out of `package.json` and out of the
 * distributed bundle entirely; nothing is redistributed, only referenced by
 * URL. Attribution: cloudflared is Copyright (c) Cloudflare, Inc., licensed
 * under the Apache License, Version 2.0
 * (https://github.com/cloudflare/cloudflared/blob/master/LICENSE).
 *
 * Pinning strategy: this module hardcodes one specific upstream release
 * (version + per-platform download URL + SHA-256). Bumping the pinned
 * version is a deliberate code change (new constant here), never automatic —
 * TunnelManager refuses to trust a hash it does not already know (see
 * downloader.ts). The hashes below were computed by downloading each asset
 * directly from the URLs below over HTTPS (GitHub Releases, TLS-verified)
 * and running SHA-256 over the bytes; there is no official checksums.txt
 * published for this release to cross-check against.
 */

export const CLOUDFLARED_VERSION = "2026.6.1";

/** One entry per (OS, arch) pair we support downloading a binary for. */
export interface CloudflaredAsset {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Direct download URL for this asset at the pinned version. */
  readonly url: string;
  /** Lowercase hex-encoded SHA-256 of the downloaded file, exactly as-is (no extraction). */
  readonly sha256: string;
  /**
   * Whether the asset at `url` is a gzip-compressed tarball (macOS releases)
   * that must be extracted to obtain the `cloudflared` binary, vs. a raw
   * executable (Windows/Linux) that can be used as downloaded.
   */
  readonly archive: "tgz" | "raw";
}

const RELEASE_BASE = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

/**
 * Pinned assets for {@link CLOUDFLARED_VERSION}. Covers the four platform/arch
 * combinations the M6 design doc's release matrix targets (§1.3): Windows
 * x64, Linux x64/arm64, macOS x64/arm64 (Windows 386 is fetched too since
 * upstream publishes it, but is not part of our own release matrix — kept
 * here only if a future batch needs it; unused entries cost nothing).
 */
export const CLOUDFLARED_ASSETS: readonly CloudflaredAsset[] = [
  {
    platform: "win32",
    arch: "x64",
    url: `${RELEASE_BASE}/cloudflared-windows-amd64.exe`,
    sha256: "5253e66f1f493c4e13539749f1aa86fd0c61e3072900fec29a44ba046a6d97e2",
    archive: "raw",
  },
  {
    platform: "linux",
    arch: "x64",
    url: `${RELEASE_BASE}/cloudflared-linux-amd64`,
    sha256: "5861a10a438fe8ddcfebb3b830f83966cbf193edafce0fe2eeb198fbae1f7a22",
    archive: "raw",
  },
  {
    platform: "linux",
    arch: "arm64",
    url: `${RELEASE_BASE}/cloudflared-linux-arm64`,
    sha256: "59816ce9b16db71f5bc2a86d59b3632a96c8c3ee934bde2bc8641ee83a6070eb",
    archive: "raw",
  },
  {
    platform: "darwin",
    arch: "x64",
    url: `${RELEASE_BASE}/cloudflared-darwin-amd64.tgz`,
    sha256: "d7a66b525fe76820da6e5406611b61e48b40de682368ac00454d9158f085be4b",
    archive: "tgz",
  },
  {
    platform: "darwin",
    arch: "arm64",
    url: `${RELEASE_BASE}/cloudflared-darwin-arm64.tgz`,
    sha256: "f6d4c439c6c782b83264951d327989ce5e23373acc5942b872411601fedb020d",
    archive: "tgz",
  },
];

/**
 * Resolve the pinned asset for the current (or given) platform/arch.
 * Returns undefined when no pinned asset covers the combination — callers
 * must surface this as a clear "unsupported platform" error, never attempt
 * an unpinned download.
 */
export function resolveCloudflaredAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): CloudflaredAsset | undefined {
  return CLOUDFLARED_ASSETS.find((a) => a.platform === platform && a.arch === arch);
}

/** Local filename the extracted/downloaded binary is cached under, per platform. */
export function cloudflaredBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}
