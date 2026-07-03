#!/usr/bin/env node
/**
 * Re-stamp a single platform's manifest entry (sha256/size/artifactName)
 * AFTER the raw SEA artifact produced by `build-release.mjs` has been
 * repackaged into its final distributable form (AppImage on Linux, .dmg on
 * macOS — see release.yml's "[Linux/macOS, CI-only] Package ..." steps).
 *
 * WHY THIS EXISTS (B3-FIXES MÉDIA A). `build-release.mjs` (phase 7/8) writes
 * `latest-<channel>.json` with the sha256/size/url of the RAW artifact it
 * just assembled. On Linux/macOS, release.yml THEN wraps that raw artifact
 * into an AppImage/.dmg and deletes the raw file (`rm -f "$ARTIFACT"`) — so
 * by the time the workflow uploads artifacts, the manifest on disk points at
 * a sha256/size/filename that no longer exists in the Release. This script
 * closes that gap: it re-hashes whatever file actually ends up in
 * dist-release/ under the platform's final artifact name and rewrites JUST
 * that platform's `platforms[platformKey]` entry, reusing manifest.mjs's own
 * `writeManifest` (same merge-without-clobbering semantics the multi-leg
 * publish job already depends on).
 *
 * Usage:
 *   node restamp-manifest.mjs <manifestPath> <platformKey> <finalArtifactPath>
 *
 * `finalArtifactPath` must already exist on disk (the packaging step must
 * run BEFORE this script). `manifestPath` must already exist (written by
 * build-release.mjs earlier in the same job) — this script only rewrites the
 * one platform entry, it does not fabricate version/channel/releaseNotes.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { writeManifest } from "./manifest.mjs";

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function main() {
  const [manifestPath, platformKey, finalArtifactPath] = process.argv.slice(2);

  if (manifestPath === undefined || platformKey === undefined || finalArtifactPath === undefined) {
    process.stderr.write(
      "Usage: node restamp-manifest.mjs <manifestPath> <platformKey> <finalArtifactPath>\n",
    );
    process.exit(1);
  }

  if (!existsSync(manifestPath)) {
    throw new Error(
      `Manifest not found at ${manifestPath} — build-release.mjs must run (and write the ` +
        `platform's initial manifest entry) before restamping it.`,
    );
  }
  if (!existsSync(finalArtifactPath)) {
    throw new Error(
      `Final artifact not found at ${finalArtifactPath} — the packaging step (AppImage/.dmg) ` +
        `must run before restamp-manifest.mjs.`,
    );
  }

  const existing = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = existing.version;
  const channel = existing.channel;
  if (typeof version !== "string" || typeof channel !== "string") {
    throw new Error(
      `Manifest at ${manifestPath} is missing version/channel — cannot restamp. Contents: ` +
        JSON.stringify(existing),
    );
  }

  const size = statSync(finalArtifactPath).size;
  const sha256 = sha256File(finalArtifactPath);
  const artifactName = finalArtifactPath.split(/[\\/]/).pop();

  const { manifestPath: writtenPath } = writeManifest({
    manifestPath,
    version,
    channel,
    platformKey,
    artifactName,
    sha256,
    size,
  });

  process.stdout.write(
    `[restamp-manifest] ${platformKey} -> ${artifactName} (${String(size)} bytes, sha256=${sha256}) ` +
      `written to ${writtenPath}\n`,
  );
}

main();
