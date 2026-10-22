/**
 * run-cli.ts — run the built `fusion` CLI (dist/cli/index.js) as a child
 * process, without blocking the test worker.
 *
 * The CLI tests used `spawnSync`, which freezes the worker's event loop for the
 * whole child run (several seconds each, cold start). With the server project
 * reusing worker processes across files (vitest.isolation.ts), that froze
 * vitest's own RPC long enough to fail runs with "Timeout calling
 * onTaskUpdate". An async spawn costs the same and keeps the loop alive.
 */
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
export const CLI_ENTRY = join(SERVER_ROOT, "dist", "cli", "index.js");

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `node dist/cli/index.js <args> --data-dir <dataDir>`. Rejects — never
 * resolves with a fake exit code — when the child is killed by the timeout or
 * fails to spawn, so a hang is not mistaken for a logic failure (exit 1).
 */
export function runCli(args: string[], dataDir: string, timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args, "--data-dir", dataDir], {
      // Suppress pino pretty-print / colour codes.
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`CLI process failed to spawn: ${err.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === null) {
        reject(
          new Error(
            `CLI process did not exit cleanly: signal=${signal ?? "none"}\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
        return;
      }
      resolvePromise({ exitCode: code, stdout, stderr });
    });
  });
}
