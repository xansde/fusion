#!/usr/bin/env node
/**
 * Fake "server exe" used by swap-helper.test.ts to exercise the relaunch
 * step of the swap without spawning a real Fusion server. Writes a marker
 * file recording that it started (with its own file path, so a test can
 * assert WHICH binary — old vs new — actually ended up running after the
 * swap) and then either stays alive (mode=stay-alive, default) or exits
 * immediately with a non-zero code (mode=crash, to exercise the rollback
 * path).
 *
 * Usage: node fake-exe.mjs <markerPath> [mode]
 */
import { writeFileSync, appendFileSync } from "node:fs";

const markerPath = process.argv[2];
const mode = process.argv[3] ?? "stay-alive";

if (markerPath === undefined) {
  process.stderr.write("fake-exe.mjs: missing markerPath argument\n");
  process.exit(2);
}

appendFileSync(markerPath, `started pid=${String(process.pid)} argv0=${process.argv[1]} mode=${mode}\n`);

if (mode === "crash") {
  process.exit(1);
}

// stay-alive: keep the event loop busy until killed.
setInterval(() => {}, 1000);
