/**
 * E2E M1-C — Token integration test script.
 *
 * Scenario:
 *   1. GM creates scene → activates it → creates 2 tokens (1 visible, 1 hidden)
 *   2. Player connects → receives snapshot → sees only 1 token (hidden filtered)
 *   3. Player moves own token (update embedded x/y) → GM receives broadcast
 *   4. Player tries to move GM-only token (no actorId ownership) → PERMISSION_DENIED
 *   5. GM toggles hidden → player receives broadcast with token now visible
 *
 * Run: node e2e-m1c-tokens.mjs
 * Exit code 0 = all checks passed; 1 = failure
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(__filename);

// Server internals from built dist
const dist = "./packages/server/dist";
const { openDatabase, applyMigrations } = require(`${dist}/db/index.js`);
const { AuthService } = require(`${dist}/auth/service.js`);
const { Role } = require(`${dist}/auth/user-store.js`);
const { loadOrCreateSecret } = require(`${dist}/auth/crypto.js`);
const { registerAuthRoutes } = require(`${dist}/auth/routes.js`);
const { SocketManager } = require(`${dist}/net/socket-manager.js`);
const { PROTOCOL_VERSION } = require("./packages/shared/dist/index.js");
const { io: ioClient } = require(
  "./packages/server/node_modules/socket.io-client/build/cjs/index.js",
);
const Fastify = require("./packages/server/node_modules/fastify/fastify.js");
const fastifyCookie = require("./packages/server/node_modules/@fastify/cookie/plugin.js");

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function makeTempDir() {
  const dir = join(
    tmpdir(),
    `fusion-e2e-m1c-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function connectClient(port, worldId, auth) {
  return ioClient(`http://127.0.0.1:${port}/world/${worldId}`, {
    auth,
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (err) =>
      reject(new Error(`connect_error: ${err.message}`)),
    );
  });
}

function sendOp(socket, type, payload, requestId) {
  return new Promise((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), requestId, payload },
      (r) => resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout: ${type}`)), 8000);
  });
}

/** Wait for first op event matching the predicate. */
function waitForOp(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("Timeout waiting for op"));
    }, timeoutMs);

    const handler = (env) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

/** Register a snapshot listener before connecting. */
function waitForSnapshot(socket) {
  return new Promise((resolve) => {
    const handler = (env) => {
      const t = env["type"];
      if (t === "resync:full" || t === "resync:delta") {
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function check(label, condition, details = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    pass++;
  } else {
    console.error(`  [FAIL] ${label}${details ? ` — ${details}` : ""}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== E2E M1-C Token Test ===\n");

  // ------------------------------------------------------------------
  // Build server
  // ------------------------------------------------------------------
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "e2e-m1c-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  // Create users
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });

  const gmLogin = await authService.login({
    userId: gm.id,
    password: gmPw,
    ip: "127.0.0.1",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false });
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "E2E M1-C", systemId: "stub" },
  });
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = address.port;

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: {
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: () => {},
    },
    origin: `http://127.0.0.1:${port}`,
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });

  console.log(`Server listening on port ${port}\n`);

  // ------------------------------------------------------------------
  // Connect GM
  // ------------------------------------------------------------------
  const gmSocket = connectClient(port, worldId, {
    token: gmLogin.accessToken,
    protocolVersion: PROTOCOL_VERSION,
  });
  const gmSnapPromise = waitForSnapshot(gmSocket);
  gmSocket.connect();
  await waitForConnect(gmSocket);
  await gmSnapPromise; // consume GM's initial snapshot

  console.log("Step 1: GM creates scene, activates it, adds 2 tokens (1 hidden)");

  // GM creates actor owned by the player (to grant move permission)
  const actorAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [
      {
        name: "Player Actor",
        type: "pc",
        ownership: { default: 0, [player.id]: 3 }, // OWNER = 3
      },
    ],
  });
  check("GM creates Actor OK", actorAck["ok"] === true);
  const actorId = actorAck["result"]["documents"][0]["_id"];

  // GM creates scene with OBSERVER ownership (so players can see it in snapshot)
  // OBSERVER = 2 per OwnershipLevel enum in shared/document.ts
  const sceneAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name: "M1-C Scene", ownership: { default: 2 } }],
  });
  check("GM creates Scene OK", sceneAck["ok"] === true);
  const sceneId = sceneAck["result"]["documents"][0]["_id"];

  // GM activates scene
  const activateAck = await sendOp(gmSocket, "world:activeScene", { sceneId });
  check("GM activates Scene OK", activateAck["ok"] === true);

  // GM creates visible token linked to player's actor
  const visibleTokenAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Token",
    data: [{ name: "Player Token", actorId, x: 100, y: 100, hidden: false }],
    parent: { type: "Scene", id: sceneId },
  });
  check("GM creates visible token OK", visibleTokenAck["ok"] === true);
  const allTokensAfterVisible = visibleTokenAck["result"]["parent"]["tokens"];
  const visibleTokenId = allTokensAfterVisible.find(
    (t) => t.name === "Player Token",
  )?.["_id"];
  check("Visible token has _id", typeof visibleTokenId === "string");

  // GM creates hidden token (no actorId → only GM can move)
  const hiddenTokenAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Token",
    data: [{ name: "Hidden Goblin", x: 200, y: 200, hidden: true }],
    parent: { type: "Scene", id: sceneId },
  });
  check("GM creates hidden token OK", hiddenTokenAck["ok"] === true);
  const allTokensAfterHidden = hiddenTokenAck["result"]["parent"]["tokens"];
  const hiddenTokenId = allTokensAfterHidden.find(
    (t) => t.name === "Hidden Goblin",
  )?.["_id"];
  check("Hidden token has _id", typeof hiddenTokenId === "string");

  // GM sees both tokens in the scene
  check("GM sees 2 tokens in scene", allTokensAfterHidden.length === 2);

  // ------------------------------------------------------------------
  console.log(
    "\nStep 2: Player connects → snapshot must show only 1 token (hidden filtered)",
  );
  // ------------------------------------------------------------------

  const playerSocket = connectClient(port, worldId, {
    token: playerLogin.accessToken,
    protocolVersion: PROTOCOL_VERSION,
  });
  const playerSnapPromise = waitForSnapshot(playerSocket);
  playerSocket.connect();
  await waitForConnect(playerSocket);
  const playerSnap = await playerSnapPromise;

  let playerTokenCount = 0;
  let playerSeesVisibleToken = false;
  let playerSeesHiddenToken = false;

  if (playerSnap["type"] === "resync:full") {
    const snap = playerSnap["payload"]["snapshot"];
    const docs = snap["documents"];
    const scenes = docs["Scene"] ?? [];
    const playerScene = scenes.find((s) => s["_id"] === sceneId);
    const tokens = playerScene?.["tokens"] ?? [];
    playerTokenCount = tokens.length;
    playerSeesVisibleToken = tokens.some((t) => t["name"] === "Player Token");
    playerSeesHiddenToken = tokens.some((t) => t["name"] === "Hidden Goblin");
  }

  check(
    "Player snapshot contains exactly 1 token (hidden filtered)",
    playerTokenCount === 1,
    `got ${playerTokenCount}`,
  );
  check("Player sees the visible token", playerSeesVisibleToken);
  check("Player does NOT see the hidden token", !playerSeesHiddenToken);

  // ------------------------------------------------------------------
  console.log("\nStep 3: Player moves own token → GM receives broadcast");
  // ------------------------------------------------------------------

  // Set up GM listener BEFORE player sends the op
  const gmBroadcastPromise = waitForOp(
    gmSocket,
    (env) => {
      if (env["type"] !== "doc:update") return false;
      const docs = env["payload"]?.["documents"] ?? [];
      const scene = docs.find((d) => d["_id"] === sceneId);
      const tokens = scene?.["tokens"] ?? [];
      return tokens.some(
        (t) => t["_id"] === visibleTokenId && t["x"] === 300 && t["y"] === 300,
      );
    },
    6000,
  );

  const playerMoveAck = await sendOp(playerSocket, "doc:update", {
    documentType: "Token",
    updates: [
      {
        _id: visibleTokenId,
        diff: { x: 300, y: 300 },
        embedded: { type: "Token", id: sceneId },
      },
    ],
  });
  check("Player moves own token: ack ok", playerMoveAck["ok"] === true);

  let gmReceivedBroadcast = false;
  try {
    await gmBroadcastPromise;
    gmReceivedBroadcast = true;
  } catch {
    gmReceivedBroadcast = false;
  }
  check("GM receives token move broadcast with new position", gmReceivedBroadcast);

  // ------------------------------------------------------------------
  console.log("\nStep 4: Player tries to move hidden GM token → PERMISSION_DENIED");
  // ------------------------------------------------------------------

  const deniedAck = await sendOp(playerSocket, "doc:update", {
    documentType: "Token",
    updates: [
      {
        _id: hiddenTokenId,
        diff: { x: 999, y: 999 },
        embedded: { type: "Token", id: sceneId },
      },
    ],
  });
  check("Player move GM token denied: ok=false", deniedAck["ok"] === false);
  check(
    "Denial code is PERMISSION_DENIED",
    deniedAck["code"] === "PERMISSION_DENIED",
    `got: ${deniedAck["code"]}`,
  );

  // ------------------------------------------------------------------
  console.log(
    "\nStep 5: GM toggles hidden → player receives broadcast with token now visible",
  );
  // ------------------------------------------------------------------

  // Set up player listener BEFORE GM sends the toggle
  const playerRevealPromise = waitForOp(
    playerSocket,
    (env) => {
      if (env["type"] !== "doc:update") return false;
      const docs = env["payload"]?.["documents"] ?? [];
      const scene = docs.find((d) => d["_id"] === sceneId);
      const tokens = scene?.["tokens"] ?? [];
      return tokens.some(
        (t) => t["_id"] === hiddenTokenId && t["hidden"] === false,
      );
    },
    6000,
  );

  const toggleAck = await sendOp(gmSocket, "doc:update", {
    documentType: "Token",
    updates: [
      {
        _id: hiddenTokenId,
        diff: { hidden: false },
        embedded: { type: "Token", id: sceneId },
      },
    ],
  });
  check("GM toggles hidden OK", toggleAck["ok"] === true);

  let playerSawReveal = false;
  try {
    await playerRevealPromise;
    playerSawReveal = true;
  } catch {
    playerSawReveal = false;
  }
  check(
    "Player receives broadcast when hidden token becomes visible",
    playerSawReveal,
  );

  // ------------------------------------------------------------------
  // Teardown
  // ------------------------------------------------------------------
  gmSocket.disconnect();
  playerSocket.disconnect();
  await new Promise((r) => setTimeout(r, 100));
  await socketManager.close();
  await fastify.close();
  fusionDb.close();
  rmSync(dataDir, { recursive: true, force: true });

  // ------------------------------------------------------------------
  // Results
  // ------------------------------------------------------------------
  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
