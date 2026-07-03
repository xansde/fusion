/**
 * UpdateManifest (latest-<channel>.json) shape builder (M6/B3 — REQ-DST-027,
 * spec 22's `UpdateManifest` model). Pulled out of build-release.mjs into
 * its own pure, importable module so the manifest SHAPE has a dedicated
 * unit test independent of running the full release pipeline (which needs
 * real build tools/native rebuilds and is comparatively slow/environment-
 * sensitive).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * DA-01: the GitHub `owner/repo` slug is not yet decided by the project
 * owner — this placeholder mirrors config.ts's `ServerConfigSchema`
 * default exactly, so a real value only ever needs to be set in ONE place
 * once DA-01 is resolved.
 */
export const UPDATE_REPO_PLACEHOLDER = "REPLACE_ME/fusion";

/**
 * Build (or update) the UpdateManifest object for one platform's release,
 * merging into whatever is already on disk at `manifestPath` (so a later
 * matrix leg — e.g. macOS — adds its platform entry without clobbering an
 * earlier leg's — e.g. Windows — already-written entry; see release.yml's
 * per-matrix-leg build job, each of which calls this independently before
 * the publish job merges all of them together).
 *
 * Pure with respect to its inputs otherwise — no process.argv/env reads,
 * no logging — so it is trivially unit-testable.
 */
export function buildManifest(options) {
  const { manifestPath, version, channel, platformKey, artifactName, sha256, size, updateRepo } = options;

  /** @type {Record<string, unknown>} */
  let manifest = {};
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }

  const repo = updateRepo ?? UPDATE_REPO_PLACEHOLDER;

  manifest.version = version;
  manifest.releaseDate = new Date().toISOString();
  manifest.releaseNotes = manifest.releaseNotes ?? `Fusion ${version}`;
  manifest.channel = channel;
  manifest.platforms = manifest.platforms ?? {};
  manifest.platforms[platformKey] = {
    url: `https://github.com/${repo}/releases/download/v${version}/${artifactName}`,
    sha256,
    size,
  };

  return manifest;
}

/** Build the manifest (see {@link buildManifest}) AND write it to disk. */
export function writeManifest(options) {
  const manifest = buildManifest(options);
  mkdirSync(dirname(options.manifestPath), { recursive: true });
  writeFileSync(options.manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath: options.manifestPath };
}
