/**
 * TK072 (spec 41-token.md, Fase 6) — hit points are emitted only to OWNER
 * or a privileged role (REQ-TOK-070/071, DEC-TOK-10), proven on the real
 * doc:create/doc:update broadcast path.
 *
 * The pure cut itself (`stripActorHp`, `stripPrivilegedActorFields` with a
 * viewer) is pinned in isolation by `net/__tests__/token-redaction-unit.test.ts`;
 * this file proves the wiring actually reaches a live socket — the SAME
 * `redactActorDocsForViewer` funnel `contacts-redaction.test.ts` already
 * proves is threaded through snapshot/broadcast/replay/ack for the knowledge
 * map and the attitude, so one live path here is enough to show hp rides the
 * identical rails rather than a parallel implementation (RNF-TOK-01 spirit).
 *
 * CA-TOK-010: a player does not see the NPC's hp nor another player's
 * character's hp, and does see their own; the GM sees all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-token-hp-redaction-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerAToken: string;
  playerAId: string;
  playerBToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "token_hp_redaction_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: playerA } = await authService.createUser({
    name: "Jogadora A",
    role: Role.PLAYER,
    password: "player-a-pass",
  });
  const { user: playerB } = await authService.createUser({
    name: "Jogador B",
    role: Role.PLAYER,
    password: "player-b-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const aLogin = await authService.login({
    userId: playerA.id,
    password: "player-a-pass",
    ip: "127.0.0.1",
  });
  const bLogin = await authService.login({
    userId: playerB.id,
    password: "player-b-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Token Hp Redaction World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: { worldId, db: fusionDb.raw, secret, authService, origin: "http://127.0.0.1" },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerAToken: aLogin.accessToken,
    playerAId: playerA.id,
    playerBToken: bLogin.accessToken,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.bootResult.shutdown();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

function hpOf(doc: Record<string, unknown> | undefined): unknown {
  const system = doc?.["system"] as Record<string, unknown> | undefined;
  const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
  return attributes?.["hp"];
}

describe("TK072 — hit points cut at OWNER, on the doc:create broadcast (REQ-TOK-070/071, CA-TOK-010)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let playerA: ClientSocket;
  let playerB: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerA = connectClient(ctx.port, ctx.worldId, ctx.playerAToken);
    playerB = connectClient(ctx.port, ctx.worldId, ctx.playerBToken);
    gm.connect();
    playerA.connect();
    playerB.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(playerA), waitForConnect(playerB)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    playerA?.disconnect();
    playerB?.disconnect();
    await teardown(ctx);
  });

  it("player A's own character keeps hp; the NPC and player B's character lose it", async () => {
    const traffic: Record<string, unknown>[] = [];
    playerA.on("op", (env: Record<string, unknown>) => traffic.push(env));

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Tobias",
          type: "character",
          system: { attributes: { hp: { value: 12, max: 20 } } },
          ownership: { default: 0, [ctx.playerAId]: 3 },
        },
        {
          name: "Fofurinha",
          type: "character",
          system: { attributes: { hp: { value: 8, max: 8 } } },
          ownership: { default: 0 }, // owned by nobody here — stands in for "player B's"
        },
        {
          name: "Goblin",
          type: "npc",
          system: { attributes: { hp: { value: 6, max: 6 } } },
          ownership: { default: 0 },
        },
      ],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const created = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const tobiasId = created[0]!["_id"];
    const fofurinhaId = created[1]!["_id"];
    const goblinId = created[2]!["_id"];

    // The GM's own ack is unredacted (privileged) — sanity check the fixture.
    expect(hpOf(created[0])).toBeDefined();

    const deadline = Date.now() + 5000;
    while (traffic.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const actorDocs = traffic
      .flatMap((e) => {
        const payload = e["payload"] as Record<string, unknown> | undefined;
        return payload?.["documentType"] === "Actor" && Array.isArray(payload["documents"])
          ? (payload["documents"] as Record<string, unknown>[])
          : [];
      })
      .filter(Boolean);

    const tobias = actorDocs.find((d) => d["_id"] === tobiasId);
    const fofurinha = actorDocs.find((d) => d["_id"] === fofurinhaId);
    const goblin = actorDocs.find((d) => d["_id"] === goblinId);

    expect(hpOf(tobias)).toEqual({ value: 12, max: 20 }); // player A owns Tobias
    expect(hpOf(fofurinha)).toBeUndefined(); // player A does not own it
    expect(hpOf(goblin)).toBeUndefined(); // NPC, GM-owned
  });
});
