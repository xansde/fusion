/**
 * Update check orchestration (M6/B5 — REQ-DST-019/020/021/025, CA-DST-10).
 *
 * Wraps manifest-client.ts's non-blocking fetch with the semver comparison
 * against FUSION_VERSION, producing one typed result consumed by both:
 *   - the boot-time check (cli/commands/serve.ts — logged, never fatal)
 *   - GET /admin/update/check (routes.ts — returned to the GM + drives the
 *     `server.update_available` WS notification)
 */

import type { Logger } from "pino";
import { fetchUpdateManifest, type UpdateManifest, type UpdateChannel } from "./manifest-client.js";
import { isNewerVersion } from "./semver.js";

export interface UpdateCheckResult {
  checked: boolean;
  /** Present only when `checked` is true. */
  updateAvailable: boolean;
  currentVersion: string;
  /** Latest version found for the configured channel, when the check succeeded. */
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  channel: UpdateChannel;
  /** Human-readable reason the check did not complete (network error, placeholder repo, etc). */
  reason?: string;
}

export interface CheckForUpdateOptions {
  currentVersion: string;
  channel: UpdateChannel;
  updateRepo?: string;
  manifestUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Perform one update check. NEVER throws (REQ-DST-020) — every failure mode
 * collapses into `{ checked: false, reason }`.
 */
export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const { currentVersion, channel, updateRepo, manifestUrl, fetchImpl, timeoutMs, logger } =
    options;

  const fetchOptions: Parameters<typeof fetchUpdateManifest>[0] = { channel };
  if (updateRepo !== undefined) fetchOptions.updateRepo = updateRepo;
  if (manifestUrl !== undefined) fetchOptions.manifestUrl = manifestUrl;
  if (fetchImpl !== undefined) fetchOptions.fetchImpl = fetchImpl;
  if (timeoutMs !== undefined) fetchOptions.timeoutMs = timeoutMs;

  let result: Awaited<ReturnType<typeof fetchUpdateManifest>>;
  try {
    result = await fetchUpdateManifest(fetchOptions);
  } catch (err) {
    // Defensive — fetchUpdateManifest already catches internally, but an
    // update check must NEVER be allowed to throw past this function
    // (REQ-DST-020 is load-bearing for the boot-time call site).
    const reason = err instanceof Error ? err.message : String(err);
    logger?.warn({ err }, "Update check failed unexpectedly");
    return { checked: false, updateAvailable: false, currentVersion, channel, reason };
  }

  if (!result.ok) {
    logger?.info({ reason: result.reason }, "Update check did not complete");
    return {
      checked: false,
      updateAvailable: false,
      currentVersion,
      channel,
      reason: result.reason,
    };
  }

  const manifest: UpdateManifest = result.manifest;
  const updateAvailable = isNewerVersion(manifest.version, currentVersion);

  logger?.info(
    { currentVersion, latestVersion: manifest.version, updateAvailable, channel },
    "Update check completed",
  );

  return {
    checked: true,
    updateAvailable,
    currentVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    releaseDate: manifest.releaseDate,
    channel,
  };
}
