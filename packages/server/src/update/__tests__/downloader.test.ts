/**
 * Tests for downloadAndVerify (M6/B5 — REQ-DST-023 items 1-2, CA-DST-07).
 * Uses the local mock update server — never the real internet.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server, type Socket } from "node:net";
import {
  downloadAndVerify,
  UpdateHashMismatchError,
  UpdateDownloadError,
  UpdateDownloadTimeoutError,
} from "../downloader.js";
import { startMockUpdateServer, sha256Of, type MockUpdateServer } from "./mock-update-server.js";

let server: MockUpdateServer | undefined;
let hangingServer: Server | undefined;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-update-dl-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  if (hangingServer) {
    // Force-destroy any still-open sockets FIRST — srv.close()'s callback
    // only fires once every connection is gone, and a socket the client
    // abandoned mid-abort can otherwise keep the teardown hanging.
    for (const socket of hangingSockets) {
      socket.destroy();
    }
    hangingSockets.clear();
    await new Promise<void>((resolve) => hangingServer?.close(() => resolve()));
    hangingServer = undefined;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Starts a raw TCP server that accepts the connection but never writes a
 * single byte back (no status line, no headers, nothing) and never closes
 * the socket — simulating a stalled/pending connection (e.g. a
 * misbehaving proxy) that a normal HTTP mock server cannot reproduce
 * (Fastify/undici always eventually respond). This is what FIX-2's
 * `AbortController` timeout exists to protect against.
 */
const hangingSockets = new Set<Socket>();

async function startHangingServer(): Promise<string> {
  const srv = createServer((socket) => {
    // Deliberately do nothing — never write, never end. Keep the socket
    // open so the client's fetch() sits waiting for a response. Tracked in
    // hangingSockets so afterEach can force-destroy it — otherwise the
    // still-open connection (the client aborted, but this raw `net` socket
    // was never told to close) keeps `srv.close()`'s callback from ever
    // firing, hanging the test's own teardown.
    hangingSockets.add(socket);
    socket.on("close", () => hangingSockets.delete(socket));
    socket.on("error", () => {
      // ignore ECONNRESET etc. once the client aborts and tears the socket down
    });
  });
  hangingServer = srv;
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const address = srv.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return `http://127.0.0.1:${String(port)}/artifacts/never-responds.exe`;
}

describe("downloadAndVerify", () => {
  it("downloads and writes the binary when the hash matches", async () => {
    const bytes = Buffer.from("fake-exe-bytes-v2");
    server = await startMockUpdateServer({
      manifest: {
        version: "2.0.0",
        releaseDate: "",
        releaseNotes: "",
        channel: "stable",
        platforms: {},
      },
      artifacts: { "fusion-server.exe": bytes },
    });

    const dir = makeTempDir();
    const destPath = join(dir, "fusion-server-new.exe");

    await downloadAndVerify({
      url: `${server.baseUrl}/artifacts/fusion-server.exe`,
      expectedSha256: sha256Of(bytes),
      destPath,
    });

    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath)).toEqual(bytes);
  });

  it("aborts and does NOT write the file when the hash diverges (CA-DST-07)", async () => {
    const bytes = Buffer.from("fake-exe-bytes-v2");
    server = await startMockUpdateServer({
      manifest: {
        version: "2.0.0",
        releaseDate: "",
        releaseNotes: "",
        channel: "stable",
        platforms: {},
      },
      artifacts: { "fusion-server.exe": bytes },
    });

    const dir = makeTempDir();
    const destPath = join(dir, "fusion-server-new.exe");

    await expect(
      downloadAndVerify({
        url: `${server.baseUrl}/artifacts/fusion-server.exe`,
        expectedSha256: "0".repeat(64), // deliberately wrong
        destPath,
      }),
    ).rejects.toThrow(UpdateHashMismatchError);

    expect(existsSync(destPath)).toBe(false);
  });

  it("throws UpdateDownloadError on HTTP failure (e.g. 404)", async () => {
    server = await startMockUpdateServer({
      manifest: {
        version: "2.0.0",
        releaseDate: "",
        releaseNotes: "",
        channel: "stable",
        platforms: {},
      },
    });

    const dir = makeTempDir();
    await expect(
      downloadAndVerify({
        url: `${server.baseUrl}/artifacts/does-not-exist.exe`,
        expectedSha256: "0".repeat(64),
        destPath: join(dir, "out.exe"),
      }),
    ).rejects.toThrow(UpdateDownloadError);
  });

  it("throws UpdateDownloadTimeoutError when the connection hangs forever (FIX-2)", async () => {
    const url = await startHangingServer();
    const dir = makeTempDir();
    const destPath = join(dir, "out.exe");

    // Injectable short timeout (FIX-2) — no need to wait out the real 10min
    // default. 80ms is comfortably longer than a local TCP handshake but
    // far shorter than any test-suite-wide timeout.
    await expect(
      downloadAndVerify({
        url,
        expectedSha256: "0".repeat(64),
        destPath,
        timeoutMs: 80,
      }),
    ).rejects.toThrow(UpdateDownloadTimeoutError);

    expect(existsSync(destPath)).toBe(false);
  });
});
