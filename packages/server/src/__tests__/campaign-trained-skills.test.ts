/**
 * HJ-09 (#434, decisão D4) — "perícias treinadas pela campanha" is a WORLD
 * setting (`campaign.trainedSkills`, a list of skill slugs), not a rule of the
 * system and not a field of the actor. This drives the real socket handlers
 * end-to-end and proves the four things the 8C checklist item (c) asks of any
 * new piece of state that crosses the server:
 *
 *   1. only the GAMEMASTER writes it (a PLAYER is refused on create and update);
 *   2. the PLAYER can READ it (the Plano shows the origin "Campanha"), through
 *      both doors: the `settings:declarations` query and the live `Setting`
 *      broadcast — and nothing next to it leaks;
 *   3. changing it re-derives every Actor right then (REQ-CFG-035), broadcast
 *      to the clients, without any write on the actors;
 *   4. an actor can never grant itself the skills: the derivation always reads
 *      the WORLD value, so a `system.build.campaignSkills` the owner wrote into
 *      their own document is dropped before any step runs.
 *
 * Uses a FAKE system (the wiring is system-agnostic; the real rank math lives
 * in the satellite's own tests, `campaign-trained-skills.test.ts` there).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { defineSystem, type SystemModule } from "@fusion/system-api";
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
import { reserveFreePort } from "./helpers/ports.js";

const SYSTEM_ID = "fake-campaign-system";
const CAMPAIGN_KEY = `${SYSTEM_ID}:campaign.trainedSkills`;

function buildFakeCampaignSystem(): SystemModule {
  return defineSystem(
    {
      id: SYSTEM_ID,
      title: "Fake Campaign System",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: { Actor: ["hero"] },
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}).passthrough() });
      r.setting({
        key: "campaign.trainedSkills",
        scope: "world",
        schema: z.array(z.enum(["arcana", "occultism", "stealth"])),
        default: [],
        label: "Perícias treinadas pela campanha",
      });
      r.setting({
        key: "someOtherWorldSetting",
        scope: "world",
        schema: z.boolean(),
        default: false,
        label: "Outra",
      });
      // Echoes what `system.build.campaignSkills` held when the derivation ran,
      // exactly what the real skills step reads.
      r.derive({
        id: "fake.echo-campaign-skills",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "derived",
        reads: [],
        writes: ["system.derived.campaignSkillsSeen"],
        run: (doc) => {
          const d = doc as {
            system: { build?: { campaignSkills?: string[] }; derived?: Record<string, unknown> };
          };
          if (!d.system.derived || typeof d.system.derived !== "object") d.system.derived = {};
          d.system.derived["campaignSkillsSeen"] = d.system.build?.campaignSkills ?? null;
        },
      });
    },
  );
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-campaign-skills-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "campaign_skills_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "CampaignPlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Campaign Skills World",
      worldSystemId: SYSTEM_ID,
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
      systemId: SYSTEM_ID,
      systemModule: buildFakeCampaignSystem(),
    },
  });

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
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

function emitAck(
  socket: ClientSocket,
  channel: "op" | "query",
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit(channel, { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for ${channel}: ${type}`)), 8000);
  });
}

const sendOp = (s: ClientSocket, type: string, payload: unknown) => emitAck(s, "op", type, payload);
const sendQuery = (s: ClientSocket, type: string, payload: unknown) =>
  emitAck(s, "query", type, payload);

/** Next pushed `op` envelope matching the predicate. */
function waitForOp(
  socket: ClientSocket,
  predicate: (env: { type: string; payload: Record<string, unknown> }) => boolean,
  timeoutMs = 4000,
): Promise<{ type: string; payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("Timeout waiting for op envelope"));
    }, timeoutMs);
    function handler(env: { type: string; payload: Record<string, unknown> }) {
      if (!predicate(env)) return;
      clearTimeout(timer);
      socket.off("op", handler);
      resolve(env);
    }
    socket.on("op", handler);
  });
}

const isActorUpdate = (env: { type: string; payload: Record<string, unknown> }): boolean =>
  env.type === "doc:update" && env.payload["documentType"] === "Actor";

function seen(doc: Record<string, unknown> | undefined): unknown {
  const system = doc?.["system"] as Record<string, unknown> | undefined;
  return (system?.["derived"] as Record<string, unknown> | undefined)?.["campaignSkillsSeen"];
}

describe("REQ-CFG-038 — campaign.trainedSkills, world setting crossing the server (HJ-09, #434)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let actorId: string;
  let settingId: string;
  /** Latest `_stats.version` of the actor the server broadcast (a non-GM write needs it). */
  let actorVersion = 0;

  const rememberVersion = (doc: Record<string, unknown> | undefined): void => {
    const version = (doc?.["_stats"] as { version?: number } | undefined)?.version;
    if (typeof version === "number") actorVersion = version;
  };

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);

    const created = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Hero", type: "hero", ownership: { default: 3 }, system: {} }],
    });
    expect(created["ok"]).toBe(true);
    const actor = (created["result"] as { documents: Record<string, unknown>[] }).documents[0]!;
    actorId = actor["_id"] as string;
    // No Setting stored yet: the derivation saw no campaign list at all.
    expect(seen(actor)).toBeNull();
    rememberVersion(actor);
  });

  afterAll(async () => {
    gm.close();
    player.close();
    await teardown(ctx);
  });

  it("a PLAYER cannot create the setting (GAMEMASTER-strict write)", async () => {
    const ack = await sendOp(player, "doc:create", {
      documentType: "Setting",
      data: [{ key: CAMPAIGN_KEY, value: ["stealth"] }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("the GM's first write re-derives the actor right then, broadcast without any write on the actor", async () => {
    const rederived = waitForOp(gm, isActorUpdate);
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [{ key: CAMPAIGN_KEY, value: ["occultism"] }],
    });
    expect(ack["ok"]).toBe(true);
    settingId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const env = await rederived;
    const docs = env.payload["documents"] as Record<string, unknown>[];
    expect(docs).toHaveLength(1);
    expect(docs[0]?.["_id"]).toBe(actorId);
    expect(seen(docs[0])).toEqual(["occultism"]);
  });

  it("a PLAYER cannot update the setting, even when the document is theirs to read", async () => {
    const ack = await sendOp(player, "doc:update", {
      documentType: "Setting",
      updates: [{ _id: settingId, diff: { value: ["arcana", "stealth"] } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("the PLAYER reads the list through settings:declarations — and only it, not the sibling setting", async () => {
    const ack = await sendQuery(player, "settings:declarations", {});
    expect(ack["ok"]).toBe(true);
    const settings = (
      ack["result"] as { settings: Array<{ key: string; kind: string; value: unknown }> }
    ).settings;
    expect(settings.map((s) => s.key)).toEqual([CAMPAIGN_KEY]);
    expect(settings[0]).toMatchObject({ kind: "enumList", value: ["occultism"] });

    const gmAck = await sendQuery(gm, "settings:declarations", {});
    const gmKeys = (gmAck["result"] as { settings: Array<{ key: string }> }).settings.map(
      (s) => s.key,
    );
    expect(gmKeys.sort()).toEqual([CAMPAIGN_KEY, `${SYSTEM_ID}:someOtherWorldSetting`].sort());
  });

  it("the GM's update reaches the PLAYER's socket live (allowlisted key) and re-derives the actor", async () => {
    const playerSetting = waitForOp(
      player,
      (env) => env.type === "doc:update" && env.payload["documentType"] === "Setting",
    );
    const rederived = waitForOp(gm, isActorUpdate);

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Setting",
      updates: [{ _id: settingId, diff: { value: ["arcana", "stealth"] } }],
    });
    expect(ack["ok"]).toBe(true);

    const settingEnv = await playerSetting;
    const settingDocs = settingEnv.payload["documents"] as Array<{ key: string; value: unknown }>;
    expect(settingDocs.map((d) => d.key)).toEqual([CAMPAIGN_KEY]);
    expect(settingDocs[0]?.value).toEqual(["arcana", "stealth"]);

    const env = await rederived;
    expect(seen((env.payload["documents"] as Record<string, unknown>[])[0])).toEqual([
      "arcana",
      "stealth",
    ]);
  });

  it("clearing the list (an explicit []) re-derives to empty, not to 'no opinion'", async () => {
    const rederived = waitForOp(gm, isActorUpdate);
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Setting",
      updates: [{ _id: settingId, diff: { value: [] } }],
    });
    expect(ack["ok"]).toBe(true);
    const env = await rederived;
    const cleared = (env.payload["documents"] as Record<string, unknown>[])[0];
    expect(seen(cleared)).toEqual([]);
    rememberVersion(cleared);
  });

  it("an OWNER cannot grant their own actor skills: a self-written system.build.campaignSkills is dropped by the derivation", async () => {
    const ack = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: actorId,
          expectedVersion: actorVersion,
          diff: { "system.build.campaignSkills": ["stealth", "arcana"] },
        },
      ],
    });
    expect(ack, JSON.stringify(ack)).toMatchObject({ ok: true });
    const docs = (ack["result"] as { documents: Record<string, unknown>[] }).documents;
    // The world value (an explicit empty list) decides, never the document's own.
    expect(seen(docs[0])).toEqual([]);
  });
});
