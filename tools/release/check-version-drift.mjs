#!/usr/bin/env node
/**
 * Fail fast if FUSION_VERSION (packages/shared/src/version.ts) has drifted
 * from the root package.json's "version" field.
 *
 * version.ts documents (see its own doc comment) that the two are kept in
 * lockstep BY CONVENTION, and explicitly names this batch (M6/B3) as the
 * owner of the automated check. This script is that check — run as the
 * first step of `pnpm build:release` so a forgotten bump fails loudly
 * instead of shipping a release binary whose /health, WS handshake and
 * WorldManifest.fusionVersion all disagree with the tag that triggered CI.
 *
 * Exit codes: 0 = versions match. 1 = drift detected (or file unreadable).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function extractFusionVersion(versionTsPath) {
  const src = readFileSync(versionTsPath, "utf8");
  const match = /export const FUSION_VERSION = "([^"]+)";/.exec(src);
  if (match === null) {
    throw new Error(
      `Could not find "export const FUSION_VERSION = ...;" in ${versionTsPath}. ` +
        `The regex this script uses is intentionally strict (see version.ts) — ` +
        `if the literal's formatting changed, update this script's pattern too.`,
    );
  }
  return match[1];
}

function main() {
  const versionTsPath = join(repoRoot, "packages", "shared", "src", "version.ts");
  const packageJsonPath = join(repoRoot, "package.json");

  const fusionVersion = extractFusionVersion(versionTsPath);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const packageVersion = packageJson.version;

  if (fusionVersion !== packageVersion) {
    process.stderr.write(
      `\n[check-version-drift] VERSION DRIFT DETECTED\n\n` +
        `  packages/shared/src/version.ts  FUSION_VERSION = "${fusionVersion}"\n` +
        `  package.json                    "version"      = "${packageVersion}"\n\n` +
        `These must be bumped together in the same commit. Fix one of them and re-run.\n\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`[check-version-drift] OK — both are "${fusionVersion}"\n`);
}

main();
