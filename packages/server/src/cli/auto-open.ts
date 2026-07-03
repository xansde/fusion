/**
 * First-run auto-open-browser gate (M6 UX fix).
 *
 * Design target (docs/design/m6-distribuicao.md guiding principle): "the GM
 * double-clicks the exe, answers a short wizard in the browser, and sends a
 * link to the players". Double-clicking fusion-server-*.exe on Windows opens
 * a terminal with no argv — `fusion serve` now boots (see args.ts's
 * implicitServe default) but the GM still has to notice the console and copy
 * a URL by hand. This module decides WHEN it is safe/desirable to save them
 * that step by opening the OS default browser automatically, and does the
 * actual (best-effort, never-fatal) spawn.
 *
 * `decideAutoOpen` is a pure predicate — fully unit-testable without ever
 * touching child_process — covering all four gate conditions from the design
 * note:
 *   (a) running as a packaged SEA executable (dev `node dist/index.js` never
 *       auto-opens anything — it's a developer, not a GM double-clicking an
 *       exe)
 *   (b) no --world flag (a --world boot is either a scripted/automated launch
 *       or an already-configured GM who knows what they're doing)
 *   (c) setupCompleted is false (first run only — once the wizard has run
 *       once, re-opening a browser tab on every `fusion serve` would be
 *       annoying, not helpful)
 *   (d) --no-open was not passed, AND process.env.CI is not set (CI/smoke
 *       runs must never pop a browser)
 */

export interface AutoOpenContext {
  /** True when this process is a packaged SEA executable (see sea-detect.ts). */
  isSea: boolean;
  /** True when `--world <slug>` was passed to `fusion serve`. */
  hasWorldFlag: boolean;
  /** The effective config's setupCompleted flag (Config/fusion.json). */
  setupCompleted: boolean;
  /** True when `--no-open` was passed. */
  noOpen: boolean;
  /** True when the CI env var is set (any non-empty value). */
  isCi: boolean;
}

/**
 * Pure gate: returns true only when all four first-run conditions hold.
 * No I/O, no process access beyond what the caller already resolved into
 * `ctx` — trivially unit-testable.
 */
export function decideAutoOpen(ctx: AutoOpenContext): boolean {
  return ctx.isSea && !ctx.hasWorldFlag && !ctx.setupCompleted && !ctx.noOpen && !ctx.isCi;
}

/**
 * Best-effort, fire-and-forget open of the OS default browser at `url`.
 * NEVER throws and NEVER blocks the caller — failure to open a browser must
 * never be treated as fatal for `fusion serve` (the console URL is always
 * the fallback). Any error is swallowed after being reported to `onError`
 * (typically a logger.warn call) so it's still observable.
 */
export function openBrowserBestEffort(
  url: string,
  onError: (err: unknown) => void,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    // Deferred import: this module is imported unconditionally by serve.ts,
    // but child_process.spawn is only ever invoked from inside this
    // function, keeping the pure decideAutoOpen() path free of any
    // process-spawning side effects for tests that only exercise the gate.
    void import("node:child_process")
      .then(({ spawn }) => {
        let command: string;
        let args: string[];
        const shell = false;
        if (platform === "win32") {
          // `cmd /c start "" <url>` — the empty "" title arg prevents `start`
          // from treating a URL containing spaces/special chars as the window
          // title.
          command = "cmd";
          args = ["/c", "start", '""', url];
        } else if (platform === "darwin") {
          command = "open";
          args = [url];
        } else {
          command = "xdg-open";
          args = [url];
        }
        const child = spawn(command, args, { detached: true, stdio: "ignore", shell });
        child.on("error", onError);
        child.unref();
      })
      .catch(onError);
  } catch (err) {
    onError(err);
  }
}
