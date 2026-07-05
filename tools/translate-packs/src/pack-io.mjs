/**
 * pack-io.mjs — filesystem helpers shared by extract/grants-from-rules/apply/qa.
 *
 * Resolves systems/pf2e/packs/<slug>/ the same way the server's
 * resolveSystemPacksDir walks up to the monorepo root (see
 * packages/server/src/compendium/service.ts), by walking up from this file
 * until pnpm-workspace.yaml is found. Keeps this tool runnable from any cwd.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Walks up from a starting directory until pnpm-workspace.yaml is found. Returns the monorepo root. */
export function findMonorepoRoot(startDir = __dirname) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate monorepo root (pnpm-workspace.yaml) walking up from ${startDir}`);
}

/** Returns systems/<systemId>/packs (default systemId "pf2e"). */
export function resolveSystemPacksDir(systemId = "pf2e", root = findMonorepoRoot()) {
  return join(root, "systems", systemId, "packs");
}

/** Lists pack slugs under a packs root that have a documents.json (i.e. real packs). */
export function listPackSlugs(packsRoot) {
  if (!existsSync(packsRoot)) return [];
  return readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => existsSync(join(packsRoot, slug, "documents.json")))
    .sort();
}

/** Reads and normalizes a pack's documents.json into an array of docs (handles array or map-shaped files). */
export function readPackDocuments(packsRoot, slug) {
  const docsPath = join(packsRoot, slug, "documents.json");
  const raw = JSON.parse(readFileSync(docsPath, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.documents)) return raw.documents;
  if (Array.isArray(raw?.entries)) return raw.entries;
  return Object.values(raw);
}

/** Reads pack.json for a slug (used to get the "pf2e.<slug>" packId). */
export function readPackManifest(packsRoot, slug) {
  const manifestPath = join(packsRoot, slug, "pack.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/** Builds the "<systemId>.<slug>" packId, preferring pack.json's own id field when present. */
export function resolvePackId(packsRoot, slug, systemId = "pf2e") {
  try {
    const manifest = readPackManifest(packsRoot, slug);
    if (typeof manifest.id === "string" && manifest.id.length > 0) return manifest.id;
  } catch {
    // pack.json missing or unreadable — fall back to the conventional id.
  }
  return `${systemId}.${slug}`;
}

/**
 * Reads an existing JSON file at <baseDir>/<slug>/<filename>, or returns null
 * if absent. Generic over baseDir — used both for real pack overlays
 * (packsRoot) and for pipeline work-unit/output files (out/translate,
 * out/mechanics).
 */
export function readOverlay(baseDir, slug, filename) {
  const overlayPath = join(baseDir, slug, filename);
  if (!existsSync(overlayPath)) return null;
  return JSON.parse(readFileSync(overlayPath, "utf8"));
}

/**
 * Writes a JSON file at <baseDir>/<slug>/<filename> with stable 2-space
 * formatting + trailing newline (clean diffs). Generic over baseDir — see
 * readOverlay.
 */
export function writeOverlay(baseDir, slug, filename, data) {
  const dir = join(baseDir, slug);
  mkdirSync(dir, { recursive: true });
  const overlayPath = join(dir, filename);
  writeFileSync(overlayPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return overlayPath;
}

/** Ensures a directory exists (recursive mkdir). */
export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}
