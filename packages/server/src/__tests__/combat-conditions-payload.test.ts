/**
 * REQ-CBA-053, on the payload — where the condition source exists for a player, and
 * where it does not.
 *
 * REQ-CBA-053 [MVP]: "Condição de um participante cuja vida o usuário não pode ver
 * continua sendo exibida" (specs/40-aba-combate.md §5.6). The panel reads conditions off
 * the Actor documents its mirror holds (`packages/client/src/lib/combat/combatVitals.ts`),
 * so the requirement is only as true as the payload the player's socket receives. The
 * client tests exercise the RULE; this file exercises the SOURCE, and it deliberately
 * proves both halves:
 *
 *  - the NPC the GM shared at OBSERVER reaches the player WITH its condition items, while
 *    its combatant carries `hasPlayerOwner: false` — so the panel refuses its health
 *    (REQ-CBA-041) and still has everything it needs to draw the tag (REQ-CBA-053);
 *  - the ordinary creature, whose ownership resolves to NONE, does NOT reach the player at
 *    all: the snapshot filters Actor documents by ownership. For that participant there is
 *    no condition to draw on any client, which makes REQ-CBA-053 unfulfilled for it — a
 *    MISSING SOURCE, not a decision of the panel. Closing it means the server sending a
 *    redacted condition list beside the combatant, through the single redaction module;
 *    §7 of spec 40 today puts conditions on the actor, by the system API. Registered as an
 *    open question of this phase. The day it is closed, the assertion marked LIMITE below
 *    is the one that must fail.
 *
 * REQ-CBA-083 / Q-CBA-02 is visible here too: the shared NPC's hit points DO travel in the
 * player's payload. Refusing to draw them is a rule of the combat screen, not a seal.
 *
 * Every assertion inspects the PAYLOAD a PLAYER socket actually received, never the screen.
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
import { PROTOCOL_VERSION, KnowledgeState } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Harness (mirrors combat-hidden-payload-g056.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cba053-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

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

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "cba053-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
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
    worldInfo: { id: worldId, title: "CBA-053 World", systemId: "stub" },
  });
  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

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

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

function waitForEnvelope(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for envelope")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

/** The condition tags a panel could build from an actor body, by the shape it reads. */
function conditionSlugsOf(actor: Record<string, unknown> | undefined): string[] {
  const items = actor?.["items"];
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[])
    .filter((item) => item["type"] === "condition")
    .map((item) => String((item["system"] as Record<string, unknown> | undefined)?.["slug"] ?? ""));
}

function documentsOf(
  snapshotEnv: Record<string, unknown>,
  type: string,
): Record<string, unknown>[] {
  const snapshot = (snapshotEnv["payload"] as Record<string, unknown>)["snapshot"] as Record<
    string,
    unknown
  >;
  const documents = snapshot["documents"] as Record<string, unknown[]>;
  return (documents[type] ?? []) as Record<string, unknown>[];
}

function byName(
  docs: Record<string, unknown>[],
  name: string,
): Record<string, unknown> | undefined {
  return docs.find((doc) => doc["name"] === name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REQ-CBA-053 — a fonte de condição no payload do jogador", { timeout: 30000 }, () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  function conditionItem(slug: string, label: string, value?: number): Record<string, unknown> {
    return {
      _id: `item-${slug}`,
      name: label,
      type: "condition",
      system: { slug, ...(value === undefined ? {} : { value }) },
    };
  }

  /**
   * Three participants, three ownership shapes:
   *   - "Elara" — the player's own character (OWNER): health and conditions both his;
   *   - "Aliado do Bosque" — an NPC the GM shared at OBSERVER: in the mirror, NOT owned;
   *   - "Goblin" — the ordinary creature: ownership NONE, nobody but the GM has it.
   */
  async function setupEncounter(): Promise<{
    combatId: string;
    actorIds: Record<"elara" | "shared" | "goblin", string>;
  }> {
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Clareira", width: 1000, height: 1000 }],
    });
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]!["_id"] as string;

    const actorsAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Elara",
          type: "character",
          ownership: { default: 0, [ctx.playerUserId]: 3 },
          system: { attributes: { hp: { value: 21, max: 34 } } },
          items: [conditionItem("stunned", "Atordoado", 1)],
        },
        {
          name: "Aliado do Bosque",
          type: "npc",
          // OBSERVER: the player sees the document, but does not own it — which is
          // exactly the pair REQ-CBA-053 describes.
          ownership: { default: 0, [ctx.playerUserId]: 2 },
          system: { attributes: { hp: { value: 12, max: 40 } } },
          items: [conditionItem("frightened", "Amedrontado", 2)],
        },
        {
          name: "Goblin",
          type: "npc",
          ownership: { default: 0 },
          system: { attributes: { hp: { value: 7, max: 26 } } },
          items: [conditionItem("prone", "Caído")],
        },
      ],
    });
    const created = (actorsAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    expect(created.length).toBe(3);

    // Spec 39 (REQ-CTT-082): an NPC is a CONTACT, and a contact is hidden from a player
    // until the Mestre introduces it — ownership alone stopped being enough to deliver
    // its body. So the "shared" ally is introduced here, which is what makes it reach the
    // player's payload with its condition items. The Goblin is deliberately left
    // uninitiated: it is the LIMITE half of this file, and stays out of the payload.
    const introduced = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: created[1]!["_id"] as string, general: KnowledgeState.Known }],
    });
    expect(introduced["ok"]).toBe(true);

    const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
    const combatId = (
      (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
    )["_id"] as string;

    let initiative = 30;
    for (const actor of created) {
      initiative -= 5;
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: `t-${actor["_id"] as string}`,
        actorId: actor["_id"] as string,
        hidden: false,
        initiative,
      });
    }

    return {
      combatId,
      actorIds: {
        elara: created[0]!["_id"] as string,
        shared: created[1]!["_id"] as string,
        goblin: created[2]!["_id"] as string,
      },
    };
  }

  async function joinPlayer(): Promise<{
    socket: ClientSocket;
    snapshot: Record<string, unknown>;
  }> {
    const socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const sync = waitForEnvelope(socket, (env) => env["type"] === "resync:full");
    socket.connect();
    await waitForConnect(socket);
    return { socket, snapshot: await sync };
  }

  it("REQ-CBA-053: o Ator compartilhado chega ao jogador com as condições, e sem posse (hasPlayerOwner false)", async () => {
    const fx = await setupEncounter();
    const { socket: playerSocket, snapshot } = await joinPlayer();

    const actors = documentsOf(snapshot, "Actor");
    const shared = byName(actors, "Aliado do Bosque");

    // The source REQ-CBA-053 needs is in the player's payload.
    expect(shared).toBeDefined();
    expect(conditionSlugsOf(shared)).toEqual(["frightened"]);

    // And the health rule still refuses it, because the combatant is not a player
    // character (REQ-CBA-041): the two answers come from different facts.
    const combats = documentsOf(snapshot, "Combat");
    expect(combats.length).toBe(1);
    const combatants = combats[0]!["combatants"] as Record<string, unknown>[];
    const sharedCombatant = combatants.find((c) => c["actorId"] === fx.actorIds.shared);
    expect(sharedCombatant?.["hasPlayerOwner"]).toBe(false);
    // The player's own character is the control: same payload, opposite flag.
    expect(combatants.find((c) => c["actorId"] === fx.actorIds.elara)?.["hasPlayerOwner"]).toBe(
      true,
    );

    // REQ-CBA-083 / Q-CBA-02: the numbers themselves DO travel — not drawing them is a
    // rule of the combat screen, not redaction. Written down so nobody reads the panel's
    // refusal as a guarantee of secrecy.
    const sharedHp = (
      (shared?.["system"] as Record<string, unknown> | undefined)?.["attributes"] as
        | Record<string, unknown>
        | undefined
    )?.["hp"];
    expect(sharedHp).toEqual({ value: 12, max: 40 });

    playerSocket.disconnect();
  });

  it("LIMITE REQ-CBA-053: o Ator da criatura comum NÃO chega ao jogador, então não há condição para desenhar", async () => {
    const fx = await setupEncounter();
    const { socket: playerSocket, snapshot } = await joinPlayer();

    const actors = documentsOf(snapshot, "Actor");
    // The player's own character and the shared NPC are there...
    expect(byName(actors, "Elara")).toBeDefined();
    expect(byName(actors, "Aliado do Bosque")).toBeDefined();
    // ...and the ordinary creature is not: ownership NONE never passes the snapshot's
    // ownership filter, so no client of this player can read its condition items. This is
    // the half of REQ-CBA-053 that no panel code can keep — a missing source, registered
    // as an open question of this phase. When the server starts delivering a redacted
    // condition list for visible participants, THIS is the assertion that must fail.
    expect(byName(actors, "Goblin")).toBeUndefined();
    expect(JSON.stringify(actors)).not.toContain("prone");

    // The participant itself is still on the player's screen — the encounter is shared
    // world state — which is what makes the gap a gap: a row with no tag it should have.
    const combatants = documentsOf(snapshot, "Combat")[0]!["combatants"] as Record<
      string,
      unknown
    >[];
    expect(combatants.some((c) => c["actorId"] === fx.actorIds.goblin)).toBe(true);

    playerSocket.disconnect();
  });

  it("controle: o Mestre recebe os três Atores, com as condições dos três", async () => {
    await setupEncounter();

    // Without this the assertion above would pass even if the fixture had never created
    // the creature or its condition.
    const gmSync = waitForEnvelope(
      gmSocket,
      (env) => env["type"] === "resync:full" || env["type"] === "resync:delta",
    );
    const secondGm = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const secondSync = waitForEnvelope(secondGm, (env) => env["type"] === "resync:full");
    secondGm.connect();
    await waitForConnect(secondGm);
    void gmSync.catch(() => undefined);

    const actors = documentsOf(await secondSync, "Actor");
    expect(conditionSlugsOf(byName(actors, "Goblin"))).toEqual(["prone"]);
    expect(conditionSlugsOf(byName(actors, "Aliado do Bosque"))).toEqual(["frightened"]);
    expect(conditionSlugsOf(byName(actors, "Elara"))).toEqual(["stunned"]);

    secondGm.disconnect();
  });
});
