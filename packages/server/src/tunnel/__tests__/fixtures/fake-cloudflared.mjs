#!/usr/bin/env node
/**
 * Fake `cloudflared` process used by tunnel-manager.test.ts to exercise real
 * child-process lifecycle (spawn, stdout/stderr parsing, kill on stop())
 * without downloading or running the real binary.
 *
 * Usage: node fake-cloudflared.mjs [mode]
 *   mode=success (default) — prints a realistic quick-tunnel URL block to
 *     stderr after a short delay, then stays alive until killed.
 *   mode=never-prints — stays alive forever, never prints a URL (exercises
 *     the TunnelManager start() timeout path).
 *   mode=crash — exits immediately with a non-zero code before printing
 *     anything (exercises the "exited before printing a URL" error path).
 *   mode=ignore-sigterm — like "success", but ignores SIGTERM so the
 *     manager's SIGKILL fallback in stop() is exercised.
 */

const mode = process.argv[2] ?? "success";

function printUrlBlock() {
  process.stderr.write(
    "2026-07-02T10:15:32Z INF +--------------------------------------------------------------------------------------------+\n" +
      "2026-07-02T10:15:32Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):   |\n" +
      "2026-07-02T10:15:32Z INF |  https://fake-tunnel-test.trycloudflare.com                                                 |\n" +
      "2026-07-02T10:15:32Z INF +--------------------------------------------------------------------------------------------+\n",
  );
}

if (mode === "crash") {
  process.stderr.write("fatal: could not connect to Cloudflare edge\n");
  process.exit(1);
}

if (mode === "ignore-sigterm") {
  process.on("SIGTERM", () => {
    // deliberately do nothing — forces the manager's SIGKILL fallback
  });
  setTimeout(printUrlBlock, 50);
  setInterval(() => {}, 1000); // keep event loop alive
} else if (mode === "never-prints") {
  setInterval(() => {}, 1000); // keep event loop alive, print nothing
} else {
  setTimeout(printUrlBlock, 50);
  setInterval(() => {}, 1000); // keep event loop alive until killed
}
