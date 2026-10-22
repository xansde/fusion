/**
 * Single loader for the better-sqlite3 native addon (M6/B3, fix #285).
 *
 * Every runtime (non-type) use of `better-sqlite3` in the server MUST go
 * through this module. A top-level `import Database from "better-sqlite3"`
 * anywhere else in the SEA bundle graph breaks the release executable with
 * ERR_UNKNOWN_BUILTIN_MODULE (guarded by
 * runtime/__tests__/native-import-guard.test.ts).
 */

import type BetterSqlite3Ctor from "better-sqlite3";
import { createRequire } from "node:module";

// Why createRequire (M6/B3 — SEA compatibility, see runtime/native-loader.ts)
//
// A plain top-level `import Database from "better-sqlite3"` (equivalently,
// after esbuild's CJS bundling, a bare top-level `require("better-sqlite3")`
// inside the bundle) is loaded through Node's SEA-specific main-script
// loader when this file ends up bundled into the SEA entry point
// (runtime/sea-entry.ts). That loader ONLY resolves Node builtins and
// modules embedded at build time — verified empirically while implementing
// this batch: it bypasses BOTH `Module._resolveFilename` and
// `Module.prototype.require` entirely and throws
// `ERR_UNKNOWN_BUILTIN_MODULE` for anything else, so
// native-loader.ts's `installNativeAddonResolutionHook` (which patches
// exactly those two things) never even gets a chance to run for a bare
// top-level `require`/`import`.
//
// `createRequire(...)` produces a DIFFERENT require function — one that DOES
// go through `Module._resolveFilename` even inside a SEA main script (also
// verified empirically) — so routing the native-addon load through it here
// makes `installNativeAddonResolutionHook`'s redirect actually take effect
// under SEA, while remaining 100% identical to a normal `require()` in every
// other context (plain `node dist/index.js`, tests, ordinary dev). This is
// the ONLY reason this file uses `createRequire` instead of a plain
// `import`. Everything else imports `Database` from here (or only the types).
const nativeRequire = createRequire(import.meta.url);
export const Database = nativeRequire("better-sqlite3") as typeof BetterSqlite3Ctor;
