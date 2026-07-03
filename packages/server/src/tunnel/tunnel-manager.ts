/**
 * TunnelManager — lifecycle of the `cloudflared` quick-tunnel child process
 * (M6/B4, REQ-DST-034, DEC-M6-02).
 *
 * Responsibilities:
 *   - ensure a verified `cloudflared` binary is present (downloader.ts)
 *   - spawn `cloudflared tunnel --url http://localhost:<port>` as a child
 *   - parse the public `*.trycloudflare.com` URL from its output
 *   - expose current status ({ tunnelUrl, status }) for /admin/network
 *   - emit a status-change callback so callers can push a WS event to the GM
 *   - guarantee the child is killed on stop()/server shutdown/SIGINT — never
 *     leave a `cloudflared` process orphaned.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import { ensureCloudflared } from "./downloader.js";
import { extractTunnelUrl } from "./url-parser.js";

export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export interface TunnelState {
  status: TunnelStatus;
  tunnelUrl: string | undefined;
  error: string | undefined;
}

export type TunnelStateListener = (state: TunnelState) => void;

export interface TunnelManagerOptions {
  dataDir: string;
  /** Local port the server is listening on — the tunnel forwards to this. */
  port: number;
  logger?: Logger;
  /**
   * Timeout waiting for the public URL to appear in cloudflared's output
   * before start() rejects. Default: 20000ms — quick tunnels normally print
   * the URL within a few seconds of the process starting.
   */
  urlTimeoutMs?: number;
  /** Injectable for tests — defaults to node:child_process spawn. */
  spawnImpl?: typeof spawn;
  /** Forwarded to ensureCloudflared for tests. */
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
}

/**
 * Thrown by start() when cloudflared exits, or times out, before printing a
 * public URL — surfaced by the /admin/network/tunnel route as a clear error
 * rather than leaving the caller to guess why tunnelUrl is still undefined.
 */
export class TunnelStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelStartError";
  }
}

export class TunnelManager {
  private readonly dataDir: string;
  private readonly port: number;
  private readonly logger: Logger | undefined;
  private readonly urlTimeoutMs: number;
  private readonly spawnImpl: typeof spawn;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly platform: NodeJS.Platform | undefined;
  private readonly arch: string | undefined;

  private child: ChildProcessWithoutNullStreams | undefined;
  private state: TunnelState = { status: "stopped", tunnelUrl: undefined, error: undefined };
  private readonly listeners = new Set<TunnelStateListener>();

  constructor(options: TunnelManagerOptions) {
    this.dataDir = options.dataDir;
    this.port = options.port;
    this.logger = options.logger;
    this.urlTimeoutMs = options.urlTimeoutMs ?? 20_000;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.fetchImpl = options.fetchImpl;
    this.platform = options.platform;
    this.arch = options.arch;
  }

  getState(): TunnelState {
    return { ...this.state };
  }

  onStateChange(listener: TunnelStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: Partial<TunnelState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  /**
   * Start the tunnel: download/verify cloudflared if needed, spawn it, wait
   * for the public URL to appear. Resolves with the URL once available.
   * Throws {@link TunnelStartError} if the child exits or times out first.
   * No-op (resolves immediately) if a tunnel is already running.
   */
  async start(): Promise<string> {
    if (this.state.status === "running" && this.state.tunnelUrl !== undefined) {
      return this.state.tunnelUrl;
    }
    if (this.state.status === "starting") {
      throw new TunnelStartError("Tunnel is already starting");
    }

    this.setState({ status: "starting", tunnelUrl: undefined, error: undefined });

    let binPath: string;
    try {
      binPath = await ensureCloudflared({
        dataDir: this.dataDir,
        ...(this.logger !== undefined ? { logger: this.logger } : {}),
        ...(this.platform !== undefined ? { platform: this.platform } : {}),
        ...(this.arch !== undefined ? { arch: this.arch } : {}),
        ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ status: "error", error: message });
      throw err;
    }

    return new Promise<string>((resolve, reject) => {
      const localUrl = `http://localhost:${String(this.port)}`;
      this.logger?.info({ binPath, localUrl }, "Starting cloudflared quick tunnel");

      // spawn()'s return type is generic over the stdio tuple; with
      // stdio: ["ignore", "pipe", "pipe"] it is actually
      // ChildProcessByStdio<null, Readable, Readable> at the type level,
      // which structurally has non-null stdout/stderr (what this class
      // uses) but a null stdin — narrower than ChildProcessWithoutNullStreams
      // (which requires non-null stdin too). We never touch stdin (spawned
      // with stdio "ignore" for it), so the cast via `unknown` is safe: only
      // the stdout/stderr/on/kill surface used below needs to line up, and
      // it does at runtime regardless of the stdin type mismatch.
      const child = this.spawnImpl(binPath, ["tunnel", "--url", localUrl], {
        stdio: ["ignore", "pipe", "pipe"],
      }) as unknown as ChildProcessWithoutNullStreams;
      this.child = child;

      let settled = false;
      let buffer = "";

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const message =
          `cloudflared did not print a public URL within ${String(this.urlTimeoutMs)}ms. ` +
          `Last output: ${buffer.slice(-500)}`;
        this.setState({ status: "error", error: message });
        this.killChild();
        reject(new TunnelStartError(message));
      }, this.urlTimeoutMs);

      const handleChunk = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (settled) return;
        const url = extractTunnelUrl(buffer);
        if (url !== undefined) {
          settled = true;
          clearTimeout(timer);
          this.setState({ status: "running", tunnelUrl: url, error: undefined });
          this.logger?.info({ tunnelUrl: url }, "Cloudflare quick tunnel is up");
          resolve(url);
        }
      };

      child.stdout.on("data", handleChunk);
      child.stderr.on("data", handleChunk);

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const message = `Failed to spawn cloudflared: ${err.message}`;
        this.setState({ status: "error", error: message });
        reject(new TunnelStartError(message));
      });

      child.on("exit", (code, signal) => {
        this.child = undefined;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const message = `cloudflared exited before printing a public URL (code=${String(code)}, signal=${String(signal)}). Last output: ${buffer.slice(-500)}`;
          this.setState({ status: "error", error: message });
          reject(new TunnelStartError(message));
          return;
        }
        // Exited after having been running — reflect that it's down now,
        // unless a fresh start() already moved state past "running".
        if (this.state.status === "running") {
          this.setState({ status: "stopped", tunnelUrl: undefined, error: undefined });
        }
        this.logger?.info({ code, signal }, "cloudflared process exited");
      });
    });
  }

  private killChild(): void {
    if (this.child === undefined) return;
    const child = this.child;
    this.child = undefined;
    try {
      child.kill();
    } catch (err) {
      this.logger?.warn({ err }, "Error killing cloudflared child process");
    }
  }

  /**
   * Stop the tunnel, killing the child process if running. Safe to call when
   * already stopped (no-op). Always used on server shutdown/SIGINT to
   * guarantee cloudflared is never left orphaned.
   */
  async stop(): Promise<void> {
    if (this.child === undefined) {
      this.setState({ status: "stopped", tunnelUrl: undefined, error: undefined });
      return;
    }

    const child = this.child;
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
      this.killChild();
      // Safety net: if the process does not exit promptly (e.g. ignored
      // SIGTERM on some platform), force-kill after a short grace period so
      // stop() never hangs the caller (e.g. server shutdown/SIGINT path).
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead — fine.
        }
        resolve();
      }, 3000).unref();
    });

    // The child's own "exit" handler (registered in start()) already moves
    // state to "stopped" once the process actually exits — avoid emitting a
    // second redundant "stopped" transition to onStateChange listeners here.
    if (this.state.status !== "stopped") {
      this.setState({ status: "stopped", tunnelUrl: undefined, error: undefined });
    }
  }

  isRunning(): boolean {
    return this.state.status === "running";
  }
}
