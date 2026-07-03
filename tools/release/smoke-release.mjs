#!/usr/bin/env node
/**
 * Automated release smoke test (M6/B3 — design doc §5.2, the "critério de
 * fumaça" gate between "compiled" and "distribuível").
 *
 * Runs entirely against the REAL BUILT ARTIFACT (never packages/server/dist
 * dev output) to prove: the executable this pipeline produces (a) boots,
 * (b) can create + open a real world (proves the SQLite addon loaded), (c)
 * serves /health with the right version, and (d) accepts a real socket.io
 * handshake and receives the join snapshot (proves the SPA/native-addon/net
 * stack all work together end to end).
 *
 * Steps (design doc §5.2; step 4b added by M6/B3-FIXES MÉDIA B):
 *   1. Temp data dir + `<artifact> world create smoke --system pf2e --gm-password ...`
 *   2. `<artifact> serve --world smoke --port <free>` in the background
 *   3. Poll /health until it answers { ok: true, version: FUSION_VERSION }
 *   4. Log in as the GM (proves the Argon2 addon loaded — REQ-SEC-010) and
 *      open a socket.io connection to the world namespace; wait for the
 *      "hello" event and an "op" event of type "resync:full" (the join
 *      snapshot).
 *   4b. Send a `compendium:list` query and assert it returns the pf2e packs
 *      embedded in the artifact (REQ-CMP-006 in the packaged exe). This is
 *      the regression guard for the exact gap B3-FIXES MÉDIA B closed:
 *      before that fix, resolveSystemPacksDir's monorepo walk-up always
 *      returned null on a clean machine running the SEA exe (no checkout
 *      next to it), so compendium:list silently returned `[]` — the exe
 *      booted fine, /health was green, the WS handshake worked, and this
 *      gap was invisible to every OTHER smoke step. Without this assertion
 *      the regression could ship again undetected forever.
 *   5. Tear down (SIGTERM the child, wait for exit).
 *
 * Exit codes: 0 = every step passed. 1 = any step failed (message printed).
 *
 * Usage: node smoke-release.mjs <path-to-artifact>
 *   (defaults to auto-discovering the single fusion-server-* artifact under
 *   dist-release/ if no path is given — convenient for local + CI use after
 *   build-release.mjs just produced one).
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { io as ioClient } from "socket.io-client";
import { FUSION_VERSION, PROTOCOL_VERSION } from "@fusion/shared";

function log(msg) {
  process.stdout.write(`[smoke] ${msg}\n`);
}

/**
 * Find a free TCP port by briefly binding to port 0 and reading back the OS
 * assignment — more reliable than trusting the artifact's own --port 0
 * handling, since /health currently echoes the CONFIGURED port value, not
 * the actually-bound one (a pre-existing, out-of-scope gap noted during
 * this batch — see boot.ts's /health handler). Picking the number ourselves
 * sidesteps that gap entirely.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      srv.close(() => {
        if (port === null) reject(new Error("Could not determine a free port"));
        else resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

async function waitForHealth(baseUrl, expectedVersion, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.ok === true) {
          if (body.version !== expectedVersion) {
            throw new Error(
              `/health reports version "${body.version}", expected "${expectedVersion}" ` +
                `(FUSION_VERSION mismatch — the artifact may be stale).`,
            );
          }
          return body;
        }
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for /health to respond ok. Last error: ${String(lastErr)}`);
}

function findArtifact(explicitPath) {
  if (explicitPath !== undefined) {
    if (!existsSync(explicitPath)) throw new Error(`Artifact not found: ${explicitPath}`);
    return explicitPath;
  }

  const distReleaseDir = join(process.cwd(), "dist-release");
  if (!existsSync(distReleaseDir)) {
    throw new Error(
      `No artifact path given and dist-release/ does not exist. Run "pnpm build:release" first, ` +
        `or pass the artifact path explicitly.`,
    );
  }
  const candidates = readdirSync(distReleaseDir).filter((f) => f.startsWith("fusion-server-"));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one fusion-server-* artifact under dist-release/, found ${String(candidates.length)}: ` +
        candidates.join(", "),
    );
  }
  return join(distReleaseDir, candidates[0]);
}

async function main() {
  const explicitPath = process.argv[2];
  const artifactPath = findArtifact(explicitPath);
  log(`Using artifact: ${artifactPath}`);

  const dataDir = mkdtempSync(join(tmpdir(), "fusion-smoke-"));
  log(`Temp data dir: ${dataDir}`);

  const gmPassword = "smoke-test-password-not-secret";
  let child;

  try {
    // -----------------------------------------------------------------------
    // Step 1 — world create (proves the SQLite addon loads: world.db is
    // opened/migrated; proves the Argon2 addon loads: GM password is hashed)
    // -----------------------------------------------------------------------
    log("Step 1/5 — world create smoke --system pf2e");
    const createOutput = execFileSync(
      artifactPath,
      [
        "world",
        "create",
        "smoke",
        "--system",
        "pf2e",
        "--data-dir",
        dataDir,
        "--gm-password",
        gmPassword,
      ],
      { encoding: "utf8" },
    );
    log(createOutput.trim());

    const gmUserIdMatch = /gmUserId:\s*(\S+)/.exec(createOutput);
    if (gmUserIdMatch === null) {
      throw new Error(
        "Could not find 'gmUserId: <id>' in world create output — did the CLI output format change?",
      );
    }
    const gmUserId = gmUserIdMatch[1];
    log(`GM user id: ${gmUserId}`);

    // -----------------------------------------------------------------------
    // Step 2 — serve --world smoke --port <free> (background)
    // -----------------------------------------------------------------------
    const port = await findFreePort();
    log(`Step 2/5 — serve --world smoke --port ${String(port)} (background)`);

    child = spawn(artifactPath, ["serve", "--world", "smoke", "--port", String(port), "--data-dir", dataDir], {
      stdio: ["ignore", "pipe", "pipe"],
      // --world is already passed above, which alone keeps the M6 first-run
      // auto-open-browser gate (cli/auto-open.ts's decideAutoOpen) closed —
      // CI=1 is set here as well, belt-and-suspenders, so this smoke test
      // never pops a browser even if that gate's conditions ever change.
      env: { ...process.env, CI: "1" },
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    let exitedEarly = false;
    let earlyExitInfo = "";
    child.once("exit", (code, signal) => {
      if (!exitedEarly) {
        exitedEarly = true;
        earlyExitInfo = `code=${String(code)} signal=${String(signal)}`;
      }
    });

    const baseUrl = `http://127.0.0.1:${String(port)}`;

    // -----------------------------------------------------------------------
    // Step 3 — /health
    // -----------------------------------------------------------------------
    log("Step 3/5 — waiting for /health");

    // FUSION_VERSION/PROTOCOL_VERSION are imported directly from the built
    // @fusion/shared package (this script's own devDependency — see
    // tools/release/package.json) rather than re-parsed from source: by the
    // time this script runs, build-release.mjs has already (a) asserted
    // zero version drift and (b) run `pnpm -r build`, so @fusion/shared's
    // compiled dist/ IS the exact source of truth the artifact itself was
    // built from — importing it directly is both simpler and stricter than
    // duplicating check-version-drift.mjs's regex a second time.
    const expectedVersion = FUSION_VERSION;

    if (exitedEarly) {
      throw new Error(
        `Server process exited before /health became reachable (${earlyExitInfo}).\n` +
          `stdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
      );
    }

    const health = await waitForHealth(baseUrl, expectedVersion, 20_000);
    log(`/health OK: ${JSON.stringify(health)}`);

    // -----------------------------------------------------------------------
    // Step 4 — log in + socket.io handshake + join snapshot
    // -----------------------------------------------------------------------
    log("Step 4/5 — logging in as GM and opening a socket.io connection");

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: gmUserId, password: gmPassword }),
    });
    if (!loginRes.ok) {
      throw new Error(`POST /api/auth/login failed: HTTP ${String(loginRes.status)} ${await loginRes.text()}`);
    }
    const loginBody = await loginRes.json();
    if (typeof loginBody.accessToken !== "string") {
      throw new Error(`Login response missing accessToken: ${JSON.stringify(loginBody)}`);
    }
    log("Login OK, accessToken obtained");

    const socket = ioClient(`${baseUrl}/world/smoke`, {
      auth: { token: loginBody.accessToken, protocolVersion: PROTOCOL_VERSION },
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
    });

    const helloPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for 'hello' event")), 10_000);
      socket.once("hello", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    const snapshotPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for resync:full op event")), 10_000);
      socket.on("op", (payload) => {
        if (payload && payload.type === "resync:full") {
          clearTimeout(timer);
          resolve(payload);
        }
      });
    });
    const connectErrorPromise = new Promise((_resolve, reject) => {
      socket.once("connect_error", (err) => reject(new Error(`socket connect_error: ${err.message}`)));
    });

    socket.connect();
    const hello = await Promise.race([helloPromise, connectErrorPromise]);
    log(`Received 'hello': ${JSON.stringify(hello)}`);
    if (hello.serverVersion !== expectedVersion) {
      throw new Error(
        `'hello' event reports serverVersion "${hello.serverVersion}", expected "${expectedVersion}"`,
      );
    }

    const snapshot = await Promise.race([snapshotPromise, connectErrorPromise]);
    log(`Received join snapshot (resync:full), seq=${snapshot.seq}`);

    // -----------------------------------------------------------------------
    // Step 4b — compendium:list must return the embedded pf2e packs
    // (B3-FIXES MÉDIA B — see module doc comment)
    // -----------------------------------------------------------------------
    log("Step 4b/5 — compendium:list must return the embedded pf2e packs");

    const compendiumAck = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for compendium:list ack")), 10_000);
      socket.emit("query", { type: "compendium:list", ts: Date.now(), payload: { systemId: "pf2e" } }, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });

    if (compendiumAck?.ok !== true) {
      throw new Error(`compendium:list did not ack ok: ${JSON.stringify(compendiumAck)}`);
    }
    const packs = compendiumAck.result?.packs ?? [];
    const packIds = packs.map((p) => p.id);
    const EXPECTED_PACK_IDS = ["pf2e.bestiary-core", "pf2e.conditions", "pf2e.weapons-core", "pf2e.spells-core"];
    const missing = EXPECTED_PACK_IDS.filter((id) => !packIds.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `compendium:list is missing expected pf2e pack(s) ${JSON.stringify(missing)} — got ${JSON.stringify(packIds)}. ` +
          `This means the packaged exe cannot find systems/pf2e/packs on this (clean) machine — ` +
          `see resolveSystemPacksDir / ensureSystemPacksExtracted (B3-FIXES MÉDIA B).`,
      );
    }
    log(`compendium:list OK: found ${String(packIds.length)} pack(s): ${packIds.join(", ")}`);

    socket.disconnect();

    // -----------------------------------------------------------------------
    // Step 5 — teardown
    // -----------------------------------------------------------------------
    log("Step 5/5 — tearing down");
    child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || exitedEarly) {
        resolve();
        return;
      }
      child.once("exit", resolve);
      setTimeout(resolve, 5_000); // don't hang the smoke test forever on a stuck child
    });

    log("SMOKE TEST PASSED");
  } finally {
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        // best-effort
      }
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke] SMOKE TEST FAILED: ${err.stack ?? String(err)}\n`);
  process.exit(1);
});
