/**
 * ports.ts — never hardcode a port in a test.
 *
 * Tests that boot a real server used to pick a literal (33701, 33778, 33806…).
 * Vitest runs test FILES in parallel (pool forks, maxForks 4), so two files
 * holding the same literal — or a port still in TIME_WAIT from an earlier run
 * on the same runner — collide and the boot dies with EADDRINUSE. That is a
 * failure of the harness, not of the code under test, and it took down CI
 * twice while merging the r24 batches (ports 33706, 33778 and 33806).
 *
 * The fix is to ask the OS for a free port instead of guessing one:
 * `reserveFreePort()` binds on port 0, reads what the OS picked, releases it
 * and hands the number over.
 *
 * Why not simply boot on port 0 and read the assigned port afterwards? Because
 * `boot()` wires `currentPort: config.port` into the admin routes BEFORE
 * `fastify.listen()` runs (boot.ts) — with `port: 0` the server would advertise
 * port 0 as its own and `/admin/setup/apply` would 409 against itself. The
 * server has to be told a real port up front.
 *
 * That leaves a small window between releasing the probe and the real bind.
 * It is not zero, but it beats a literal: two files sharing 33801 collide
 * deterministically, while two independent draws from the OS's ephemeral range
 * essentially never do.
 */
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";

/**
 * A port that was free a moment ago, straight from the OS's ephemeral range.
 *
 * Use it wherever a test used to hardcode 337xx/338xx: boot the server on it
 * and every downstream assertion (setup/apply payloads, check-port, invite
 * URLs) can name the same port without a magic number.
 */
export async function reserveFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = address !== null && typeof address !== "string" ? address.port : null;
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  if (port === null) throw new Error("Could not read a port from the probe listener");
  return port;
}

/**
 * The port the server is ACTUALLY bound to, after `fastify.listen()`.
 *
 * Pass this around instead of a literal whenever a test needs to name its own
 * port — `/admin/setup/apply` payloads, check-port assertions, invite URLs.
 */
export function listeningPort(fastify: FastifyInstance): number {
  const address = fastify.server.address();
  if (address === null || typeof address === "string") {
    throw new Error(
      "Server is not listening on a TCP port — boot it with `port: 0` before asking for the assigned port.",
    );
  }
  return address.port;
}

/**
 * Keeps `port` occupied until the returned function is called.
 *
 * For the rare test that needs two DIFFERENT ports across sequential boots:
 * once the first server shuts down, the OS is free to hand its port straight
 * back to the next `port: 0` bind, which would silently collapse the two into
 * one and make the test assert nothing. Holding the first port forces the
 * second boot somewhere else. (This is what the disk-vs-boot regression test
 * used the 33661/33663 literals for.)
 */
export async function holdPort(port: number): Promise<() => Promise<void>> {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, "127.0.0.1", resolve);
  });
  return () =>
    new Promise<void>((resolve) => {
      blocker.close(() => {
        resolve();
      });
    });
}
