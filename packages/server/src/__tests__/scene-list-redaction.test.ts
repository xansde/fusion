/**
 * The scene LIST is privileged data — spec 44, §5.8.
 *
 * REQ-CEN-070: every scene ACTION requires `isRolePrivileged` server-side, not
 *              merely the absence of the icon on the rail (REQ-GAV-034).
 * REQ-CEN-071: the server must not hand the scene list to a non-privileged user,
 *              and the refusal must be indistinguishable from the scene not existing.
 * REQ-CEN-072: the scene ON AIR keeps flowing, so the player can still render it.
 * REQ-CEN-073: the name of a scene that is not on air must not appear in ANY
 *              payload destined to a non-privileged user.
 * REQ-GAV-034: the rail hiding a GM-group tab is ergonomics, not a boundary —
 *              every datum a panel draws is protected server-side (DEC-CEN-11).
 *
 * These tests read the PAYLOAD the player's socket receives — never the screen —
 * across every channel that can carry a Scene body: the live broadcast, the join
 * snapshot, the delta-resync replay from the OpBuffer, and the ACK of the
 * player's own op.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { listeningPort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const OFF_AIR_NAME = "Cena Secreta do Mestre";
const ON_AIR_NAME = "Taverna do Javali";

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerUserId: string;
}

function makeTempDir(): string {
  // Data dir lives in the OS temp dir — never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-scene-list-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "scene-list-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: join(dataDir, "world.db"), skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, join(dataDir, "world.db"));

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Jogador",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Scene List World", systemId: "stub" },
  });
  // port 0 + listeningPort(): this test never goes through boot(), so the OS
  // picks the port and nothing hardcodes one (helpers/ports.ts).
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const port = listeningPort(fastify);

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(ctx: TestContext, token: string, lastSeq?: number): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION, lastSeq },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout waiting for ack: ${type}`));
    }, 6000);
  });
}

/** Record EVERY envelope a socket receives, so the whole traffic can be searched. */
function recordEnvelopes(socket: ClientSocket): Record<string, unknown>[] {
  const received: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    received.push(env);
  });
  return received;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

/** Every Scene document carried by an envelope of the given op types. */
function sceneDocsIn(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const env of envelopes) {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (!payload) continue;
    // Live / replayed op.
    if (payload["documentType"] === "Scene" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
    // resync:delta — ops nested inside the payload.
    if (Array.isArray(payload["ops"])) {
      docs.push(...sceneDocsIn(payload["ops"] as Record<string, unknown>[]));
    }
    // resync:full — the join snapshot.
    const snapshot = payload["snapshot"] as Record<string, unknown> | undefined;
    if (snapshot) {
      const byType = snapshot["documents"] as Record<string, unknown[]> | undefined;
      const scenes = byType?.["Scene"];
      if (Array.isArray(scenes)) docs.push(...(scenes as Record<string, unknown>[]));
    }
  }
  return docs;
}

/**
 * The observable signature of a refusal: code plus message with the probed id
 * blanked out. Two refusals are "indistinguishable" (REQ-CEN-071) when their
 * signatures are equal — the id itself is the only thing the caller already
 * knew, so it may differ.
 */
function refusalSignature(ack: Record<string, unknown>, probedId: string): string {
  const code = String(ack["code"] ?? "");
  const message = String(ack["message"] ?? "")
    .split(probedId)
    .join("<id>");
  return `${String(ack["ok"])}|${code}|${message}`;
}

/** Every Scene-shaped body an ack carries, across `documents[]` and `parent`. */
function sceneBodiesInAck(ack: Record<string, unknown>): Record<string, unknown>[] {
  const result = ack["result"] as Record<string, unknown> | undefined;
  if (!result) return [];
  const bodies: Record<string, unknown>[] = [];
  const documents = result["documents"];
  if (Array.isArray(documents)) {
    for (const doc of documents as Record<string, unknown>[]) {
      if (Array.isArray(doc["tokens"])) bodies.push(doc);
    }
  }
  const parent = result["parent"] as Record<string, unknown> | undefined;
  if (parent && Array.isArray(parent["tokens"])) bodies.push(parent);
  return bodies;
}

async function createScene(gmSocket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name }],
  });
  expect(ack["ok"]).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  return docs[0]?.["_id"] as string;
}

// ---------------------------------------------------------------------------

describe("spec 44 §5.8 — the scene list is server-side privileged (REQ-GAV-034)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerSocket = connectClient(ctx, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await settle();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("REQ-CEN-071/REQ-CEN-073: no envelope the player receives carries the name of a scene that is not on air", async () => {
    const playerTraffic = recordEnvelopes(playerSocket);

    await createScene(gmSocket, OFF_AIR_NAME);
    await settle();

    // The whole traffic, not just the Scene branch: the name must not surface
    // anywhere, under any key.
    expect(JSON.stringify(playerTraffic)).not.toContain(OFF_AIR_NAME);
    expect(sceneDocsIn(playerTraffic)).toHaveLength(0);
  });

  it("REQ-CEN-071: the refusal is indistinguishable from inexistence — the envelope still arrives, with an empty batch", async () => {
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: OFF_AIR_NAME }],
    });
    await settle();

    // The seq must still reach the player — swallowing the envelope would trip
    // the client mirror's gap detector and put every player in a resync loop.
    const creates = playerTraffic.filter((env) => env["type"] === "doc:create");
    const sceneCreate = creates.find(
      (env) => (env["payload"] as Record<string, unknown>)["documentType"] === "Scene",
    );
    expect(sceneCreate).toBeDefined();
    expect(sceneCreate?.["seq"]).toBe(ack["seq"]);
    expect((sceneCreate?.["payload"] as Record<string, unknown>)["documents"]).toEqual([]);
  });

  it("REQ-CEN-071: the same op carries the full document to the privileged socket", async () => {
    const gmTraffic = recordEnvelopes(gmSocket);

    await createScene(gmSocket, OFF_AIR_NAME);
    await settle();

    const names = sceneDocsIn(gmTraffic).map((doc) => doc["name"]);
    expect(names).toContain(OFF_AIR_NAME);
  });

  it("REQ-CEN-072: the scene put on air does reach the player, name and all", async () => {
    const sceneId = await createScene(gmSocket, ON_AIR_NAME);
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId });
    expect(ack["ok"]).toBe(true);
    await settle();

    const onAirDocs = sceneDocsIn(playerTraffic).filter((doc) => doc["_id"] === sceneId);
    expect(onAirDocs.length).toBeGreaterThan(0);
    expect(onAirDocs[0]?.["name"]).toBe(ON_AIR_NAME);

    // …and the body lands BEFORE the pointer that references it, so the canvas
    // never sees an active id with no document behind it.
    const bodySeq = playerTraffic.find(
      (env) =>
        env["type"] === "doc:update" &&
        (env["payload"] as Record<string, unknown>)["documentType"] === "Scene",
    )?.["seq"] as number;
    const pointerSeq = playerTraffic.find((env) => env["type"] === "world:activeScene")?.[
      "seq"
    ] as number;
    expect(bodySeq).toBeLessThan(pointerSeq);
  });

  it("REQ-CEN-072/REQ-CEN-073: with one scene on air, edits to the OTHER scene stay invisible", async () => {
    const onAirId = await createScene(gmSocket, ON_AIR_NAME);
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);
    await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { name: `${OFF_AIR_NAME} (renomeada)` } }],
    });
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: onAirId, diff: { "grid.size": 140 } }],
    });
    await settle();

    expect(JSON.stringify(playerTraffic)).not.toContain(OFF_AIR_NAME);
    const seen = sceneDocsIn(playerTraffic);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((doc) => doc["_id"] === onAirId)).toBe(true);
  });

  it("REQ-CEN-071: the join snapshot lists only the scene on air", async () => {
    const onAirId = await createScene(gmSocket, ON_AIR_NAME);
    await createScene(gmSocket, OFF_AIR_NAME);
    await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId });
    await settle();

    const joiner = connectClient(ctx, ctx.playerToken);
    const joinerTraffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await settle();

    expect(JSON.stringify(joinerTraffic)).not.toContain(OFF_AIR_NAME);
    const scenes = sceneDocsIn(joinerTraffic);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.["_id"]).toBe(onAirId);
    joiner.disconnect();
  });

  it("REQ-CEN-073: the delta replayed on reconnect carries no off-air scene name", async () => {
    // The player records where it stands, goes away, and the GM works on a
    // scene the player must never learn about.
    let playerLastSeq = 0;
    const seqProbe = connectClient(ctx, ctx.playerToken);
    seqProbe.on("op", (env: Record<string, unknown>) => {
      if (env["type"] === "resync:full") {
        const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
          string,
          unknown
        > | null;
        if (snap) playerLastSeq = snap["seq"] as number;
      }
    });
    seqProbe.connect();
    await waitForConnect(seqProbe);
    await settle();
    seqProbe.disconnect();

    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { "grid.size": 200 } }],
    });
    await settle();

    const reconnected = connectClient(ctx, ctx.playerToken, playerLastSeq);
    const replayTraffic = recordEnvelopes(reconnected);
    reconnected.connect();
    await waitForConnect(reconnected);
    await settle();

    expect(JSON.stringify(replayTraffic)).not.toContain(OFF_AIR_NAME);
    expect(sceneDocsIn(replayTraffic)).toHaveLength(0);
    reconnected.disconnect();
  });

  it("REQ-CEN-071: deleting an off-air scene tells the player nothing — not even the id", async () => {
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Scene",
      ids: [offAirId],
    });
    expect(ack["ok"]).toBe(true);
    await settle();

    const deletes = playerTraffic.filter((env) => env["type"] === "doc:delete");
    expect(deletes).toHaveLength(1);
    expect((deletes[0]?.["payload"] as Record<string, unknown>)["ids"]).toEqual([]);
    expect(JSON.stringify(playerTraffic)).not.toContain(offAirId);

    // The GM's own copy of the same op still names the id — the redaction is
    // scoped by role (isRolePrivileged), not a blanket strip.
    const gmTraffic = recordEnvelopes(gmSocket);
    const secondId = await createScene(gmSocket, "Outra Cena");
    await sendOp(gmSocket, "doc:delete", { documentType: "Scene", ids: [secondId] });
    await settle();
    expect(JSON.stringify(gmTraffic)).toContain(secondId);
  });
});

// ---------------------------------------------------------------------------
// Every scene ACTION is gated by role, and the refusal says nothing
// ---------------------------------------------------------------------------

describe("spec 44 §5.8 — every scene action is gated server-side (REQ-CEN-070)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  /** An id shaped like a document id that was never minted. */
  const GHOST_ID = "ghostghostghost1";

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerSocket = connectClient(ctx, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await settle();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("REQ-CEN-070/REQ-CEN-071: a player editing an off-air scene gets the same answer as editing an id that never existed", async () => {
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);

    const onReal = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { name: "Invadida" } }],
    });
    const onGhost = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: GHOST_ID, diff: { name: "Invadida" } }],
    });

    expect(onReal["ok"]).toBe(false);
    // Byte-identical once the probed id is blanked: a refusal that said
    // PERMISSION_DENIED for the scene that exists would be an existence oracle
    // over ids, and knowing a scene is there is the first half of REQ-CEN-073.
    expect(refusalSignature(onReal, offAirId)).toBe(refusalSignature(onGhost, GHOST_ID));

    // …and nothing was written: the GM still reads the original name.
    const gmTraffic = recordEnvelopes(gmSocket);
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { "grid.size": 111 } }],
    });
    await settle();
    const seen = sceneDocsIn(gmTraffic).find((doc) => doc["_id"] === offAirId);
    expect(seen?.["name"]).toBe(OFF_AIR_NAME);
  });

  it("REQ-CEN-070: ownership of the Scene document does not open the door — only the role does", async () => {
    // The GM hands the player OWNER on the scene document itself. The generic
    // document path would take that as a licence to write; spec 44 says the
    // gate is isRolePrivileged, full stop (DEC-CEN-11).
    const sceneId = await createScene(gmSocket, OFF_AIR_NAME);
    const grant = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { ownership: { default: 0, [ctx.playerUserId]: 3 } } }],
    });
    expect(grant["ok"]).toBe(true);

    const attempt = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Invadida" } }],
    });
    expect(attempt["ok"]).toBe(false);
    const ghost = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: GHOST_ID, diff: { name: "Invadida" } }],
    });
    expect(refusalSignature(attempt, sceneId)).toBe(refusalSignature(ghost, GHOST_ID));
  });

  it("REQ-CEN-070: the very same edit from the privileged socket goes through", async () => {
    const sceneId = await createScene(gmSocket, OFF_AIR_NAME);
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Renomeada pelo Mestre" } }],
    });
    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    expect(docs[0]?.["name"]).toBe("Renomeada pelo Mestre");
  });

  it("REQ-CEN-070: a player cannot create a scene, and none is minted", async () => {
    const ack = await sendOp(playerSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Cena do Jogador" }],
    });
    expect(ack["ok"]).toBe(false);

    // Nothing reached the world: a joining GM sees no scene at all.
    const gmJoiner = connectClient(ctx, ctx.gmToken);
    const gmTraffic = recordEnvelopes(gmJoiner);
    gmJoiner.connect();
    await waitForConnect(gmJoiner);
    await settle();
    expect(sceneDocsIn(gmTraffic)).toHaveLength(0);
    gmJoiner.disconnect();
  });

  it("REQ-CEN-070/REQ-CEN-071: a player deleting an off-air scene gets the same answer as deleting a ghost, and the scene survives", async () => {
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);

    const onReal = await sendOp(playerSocket, "doc:delete", {
      documentType: "Scene",
      ids: [offAirId],
    });
    const onGhost = await sendOp(playerSocket, "doc:delete", {
      documentType: "Scene",
      ids: [GHOST_ID],
    });
    expect(onReal["ok"]).toBe(false);
    expect(refusalSignature(onReal, offAirId)).toBe(refusalSignature(onGhost, GHOST_ID));

    // Still there for the GM.
    const alive = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { "grid.size": 123 } }],
    });
    expect(alive["ok"]).toBe(true);
  });

  it("REQ-CEN-070: putting a scene on air and resetting its fog are both refused to the player", async () => {
    const sceneId = await createScene(gmSocket, ON_AIR_NAME);

    const activate = await sendOp(playerSocket, "world:activeScene", { sceneId });
    expect(activate["ok"]).toBe(false);

    // Environment shortcut of the head (REQ-VIS-086) — same gate.
    const reset = await sendOp(playerSocket, "fog:reset", { sceneId, target: "all" });
    expect(reset["ok"]).toBe(false);

    // The pointer never moved: a joining player still sees nothing on air.
    const joiner = connectClient(ctx, ctx.playerToken);
    const joinerTraffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await settle();
    expect(JSON.stringify(joinerTraffic)).not.toContain(ON_AIR_NAME);
    joiner.disconnect();
  });

  it("REQ-CEN-072/REQ-CEN-073: the ack of a token move carries the scene on air, and no scene at all when it is off air", async () => {
    // An actor the player OWNS, with a token of it in each of two scenes.
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Personagem", type: "pc", ownership: { default: 0, [ctx.playerUserId]: 3 } }],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const onAirId = await createScene(gmSocket, ON_AIR_NAME);
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);

    async function placeToken(sceneId: string): Promise<string> {
      const ack = await sendOp(gmSocket, "doc:create", {
        documentType: "Token",
        data: [{ name: "Ficha", actorId, x: 10, y: 20, hidden: false }],
        parent: { type: "Scene", id: sceneId },
      });
      expect(ack["ok"]).toBe(true);
      const parent = (ack["result"] as Record<string, unknown>)["parent"] as Record<
        string,
        unknown
      >;
      const tokens = parent["tokens"] as Record<string, unknown>[];
      return tokens[tokens.length - 1]?.["_id"] as string;
    }

    const onAirTokenId = await placeToken(onAirId);
    const offAirTokenId = await placeToken(offAirId);
    await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId });
    await settle();

    // On air: the player moves their token and gets the scene back — that body
    // is what the canvas renders (REQ-CEN-072).
    const onAirMove = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        { _id: onAirTokenId, diff: { x: 111, y: 222 }, embedded: { type: "Token", id: onAirId } },
      ],
    });
    expect(onAirMove["ok"]).toBe(true);
    const onAirBodies = sceneBodiesInAck(onAirMove);
    expect(onAirBodies.length).toBeGreaterThan(0);
    expect(onAirBodies.every((doc) => doc["_id"] === onAirId)).toBe(true);
    expect(JSON.stringify(onAirMove)).toContain(ON_AIR_NAME);

    // Off air: the ack must not hand back a scene the player is not allowed to
    // know exists — not its body, not its name (REQ-CEN-073).
    const offAirMove = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        { _id: offAirTokenId, diff: { x: 333, y: 444 }, embedded: { type: "Token", id: offAirId } },
      ],
    });
    expect(JSON.stringify(offAirMove)).not.toContain(OFF_AIR_NAME);
    expect(sceneBodiesInAck(offAirMove)).toHaveLength(0);
  });

  it("REQ-CEN-071/REQ-CEN-073: probing an off-air scene through the embedded path answers like a scene that never existed", async () => {
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);

    const onReal = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        { _id: "tokenghost000001", diff: { x: 1 }, embedded: { type: "Token", id: offAirId } },
      ],
    });
    const onGhost = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        { _id: "tokenghost000001", diff: { x: 1 }, embedded: { type: "Token", id: GHOST_ID } },
      ],
    });

    expect(onReal["ok"]).toBe(false);
    expect(refusalSignature(onReal, offAirId)).toBe(refusalSignature(onGhost, GHOST_ID));
  });
});
