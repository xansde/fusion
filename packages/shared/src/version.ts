/**
 * Single source of truth for the Fusion application version.
 *
 * REQ-DST-036/037/038: the server MUST report one consistent version string
 * across /health, the post-connection WebSocket "hello" event (REQ-DST-036,
 * emitted by net/socket-manager.ts right after a socket is accepted),
 * WorldManifest.fusionVersion, and the CLI. Before this module existed,
 * "0.1.0" was hardcoded independently in at least three places (boot.ts,
 * world-manager.ts, cli/help.ts) and would silently drift.
 *
 * Mechanism (deliberately simple for the M6/B0 batch):
 *
 *   FUSION_VERSION is a plain exported constant, kept in lockstep with the
 *   "version" field of the root package.json by convention (bump both in
 *   the same commit/PR). A build-time JSON import of the root package.json
 *   was considered and rejected: @fusion/shared is consumed four different
 *   ways across the monorepo (system-api and boundary-test via `paths` to
 *   shared/src/index.ts, server via node_modules/shared/dist, client via a
 *   Vite alias to shared/src/index.ts — see CLAUDE.md's resolution table).
 *   A JSON import would need to resolve correctly relative to the root
 *   package.json from all four contexts (src AND dist, bundled AND
 *   type-checked-only), which is fragile — especially since shared's
 *   tsconfig sets `rootDir: "src"`, so a JSON file outside that root would
 *   need path gymnastics that differ per consumer. A single literal constant
 *   has zero build machinery and behaves identically everywhere.
 *
 *   The M6/B3 batch (release pipeline) is expected to own real version-bump
 *   automation (e.g. `pnpm version` across the workspace, or a script that
 *   regenerates this literal from the root package.json at release time).
 *   Until then, this constant is the only place a human needs to edit.
 */
export const FUSION_VERSION = "0.1.0";
