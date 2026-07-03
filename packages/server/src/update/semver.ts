/**
 * Minimal semver comparison for auto-update version checks (M6/B5 —
 * REQ-DST-019/020). No new dependency: only `major.minor.patch` ordering is
 * needed (comparing `FUSION_VERSION` against a GitHub release tag / manifest
 * `version` field), never full semver ranges/pre-release precedence rules —
 * a real `semver` package would be overkill for this one comparison.
 *
 * Accepts an optional leading "v" (GitHub tags are usually `v1.2.3`) and an
 * optional pre-release/build suffix, which is ignored for ordering purposes
 * (treated as equal to the bare major.minor.patch — good enough for this
 * project's MVP versioning scheme; there is no current use of pre-release
 * tags in FUSION_VERSION).
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)/;

/**
 * Parse a version string into its major/minor/patch components. Returns
 * `null` for anything that does not start with a recognizable
 * `[v]X.Y.Z` prefix — callers must treat that as "cannot compare" rather
 * than throwing (an update-check response can legitimately contain a
 * malformed/unexpected tag from a misconfigured release).
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = VERSION_RE.exec(raw.trim());
  if (match === null) return null;
  const [, majorStr, minorStr, patchStr] = match;
  return {
    major: Number(majorStr),
    minor: Number(minorStr),
    patch: Number(patchStr),
  };
}

/**
 * Compare two version strings. Returns:
 *   -1 if `a` < `b`
 *    0 if `a` == `b` (or either fails to parse — treated as "not newer")
 *    1 if `a` > `b`
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return 0;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

/** True iff `candidate` is a strictly newer version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}
