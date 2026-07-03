/**
 * Download the new server binary for an update and verify its SHA-256
 * against the manifest (M6/B5 — REQ-DST-023 items 1-2, CA-DST-07).
 *
 * Mirrors tunnel/downloader.ts's download+hash-verify shape (same project
 * pattern: fetch to a Buffer, hash it, compare against a pinned/published
 * value, throw a typed error and discard the bytes on mismatch — never write
 * an unverified file to a path anything else might load from).
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export class UpdateHashMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Downloaded update binary failed SHA-256 verification. ` +
        `Expected ${expected}, got ${actual}. The download was discarded and the ` +
        `current binary was left untouched (CA-DST-07).`,
    );
    this.name = "UpdateHashMismatchError";
  }
}

export class UpdateDownloadError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "UpdateDownloadError";
  }
}

/**
 * FIX-2 (baixa): thrown when a download does not complete within
 * {@link DEFAULT_DOWNLOAD_TIMEOUT_MS}. Distinct from {@link UpdateDownloadError}
 * (network/HTTP failure) so callers/logs can tell "the remote actively
 * rejected us" apart from "the remote never answered at all" (e.g. a
 * connection stuck behind a misbehaving proxy or firewall silently dropping
 * packets) — a scenario `downloadAndVerify` previously had no protection
 * against at all, since a bare `fetch()` with no `AbortController` can hang
 * indefinitely.
 */
export class UpdateDownloadTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(
      `Update download timed out after ${String(timeoutMs)}ms. The connection may be stalled ` +
        `(e.g. a firewall/proxy silently dropping packets). The current binary was left untouched.`,
    );
    this.name = "UpdateDownloadTimeoutError";
  }
}

/** Default deadline for a single download attempt — generous because release binaries are ~100+MB and GM connections may be slow/residential. */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface DownloadAndVerifyOptions {
  url: string;
  expectedSha256: string;
  /** Absolute path the verified binary is written to (a tmp file — caller decides the final swap). */
  destPath: string;
  fetchImpl?: typeof fetch;
  /**
   * FIX-2 (baixa): deadline in ms for the whole download attempt, enforced
   * via an internal `AbortController`. Defaults to
   * {@link DEFAULT_DOWNLOAD_TIMEOUT_MS} (10 minutes) — generous for a large
   * binary on a slow connection, but finite: without this, a stalled
   * connection (e.g. a proxy that accepts the TCP connection but never
   * sends bytes) hangs `downloadAndVerify` forever. Injectable so tests can
   * use a short value instead of waiting out the real default.
   */
  timeoutMs?: number;
}

/**
 * Download the artifact at `url` into memory, verify its SHA-256 against
 * `expectedSha256`, and — only on success — write it to `destPath`. On hash
 * mismatch, nothing is written to `destPath` and {@link UpdateHashMismatchError}
 * is thrown (CA-DST-07: "mantém o binário atual com erro claro"). On any
 * network/HTTP failure, {@link UpdateDownloadError} is thrown. If the
 * download does not complete within `timeoutMs`, {@link UpdateDownloadTimeoutError}
 * is thrown instead (FIX-2).
 */
export async function downloadAndVerify(options: DownloadAndVerifyOptions): Promise<void> {
  const {
    url,
    expectedSha256,
    destPath,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let bytes: Buffer;
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    } catch (err) {
      // `fetch` rejects with a DOMException/Error named "AbortError" when
      // the signal fires — distinguish "we gave up waiting" from any other
      // network failure so callers get a typed, actionable error instead of
      // a generic UpdateDownloadError that reads like a normal HTTP failure.
      if (err instanceof Error && err.name === "AbortError") {
        throw new UpdateDownloadTimeoutError(timeoutMs);
      }
      throw err;
    }
    if (!res.ok) {
      throw new UpdateDownloadError(
        `Failed to download update from ${url}: HTTP ${String(res.status)} ${res.statusText}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    bytes = Buffer.from(arrayBuffer);
  } catch (err) {
    if (err instanceof UpdateDownloadTimeoutError) throw err;
    if (err instanceof UpdateDownloadError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new UpdateDownloadError(`Failed to download update from ${url}: ${message}`, err);
  } finally {
    clearTimeout(timer);
  }

  const actualHash = sha256Hex(bytes);
  if (actualHash !== expectedSha256) {
    throw new UpdateHashMismatchError(expectedSha256, actualHash);
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, bytes, { mode: 0o755 });
}

/** Best-effort cleanup of a downloaded-but-unused tmp file (e.g. after an aborted apply). */
export function cleanupTmpFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // best-effort
  }
}
