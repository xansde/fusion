/**
 * The free title of a contact, over the real socket (G062, spec 39 §5.9).
 *
 * Covers REQ-CTT-085 — rewriting the title is allowed to a privileged role and to
 * whoever holds `OWNER` over the character, and refused to anyone else — and
 * REQ-CTT-080, which is the reason this file exists at all: the Contatos panel
 * hides the pencil from a player who does not own the card, and hiding a control
 * is not the protection. The assertions read the ACK the socket received and the
 * document as `world.db` kept it, never a screen.
 *
 * The title has no handler of its own: it is a field of the actor
 * (`flags.fusion.title`, spec 39 §7) written through the ordinary `doc:update`,
 * whose ownership gate is the one under test.
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
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Infrastructure (mirrors contacts-knowledge.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  // Data dir lives in the OS temp dir, never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-contacts-title-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  ownerToken: string;
  ownerId: string;
  strangerToken: string;
  strangerId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "contacts_title_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: owner } = await authService.createUser({
    name: "TitleOwner",
    role: Role.PLAYER,
    password: "owner-pass",
  });
  const { user: stranger } = await authService.createUser({
    name: "TitleStranger",
    role: Role.PLAYER,
    password: "stranger-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const ownerLogin = await authService.login({
    userId: owner.id,
    password: "owner-pass",
    ip: "127.0.0.1",
  });
  const strangerLogin = await authService.login({
    userId: stranger.id,
    password: "stranger-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Contacts Title World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e",
      systemModule: pf2eSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  return {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    ownerToken: ownerLogin.accessToken,
    ownerId: owner.id,
    strangerToken: strangerLogin.accessToken,
    strangerId: stranger.id,
  };
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("The contact title — REQ-CTT-085 over the real socket (G062)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let owner: ClientSocket;
  let stranger: ClientSocket;
  let characterId: string;

  /** The title as `world.db` holds it — the actor's own document (spec 39 §7). */
  function titleInStore(actorId: string): unknown {
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as
      | { data: string }
      | undefined;
    if (!row) throw new Error(`Actor ${actorId} not found in world.db`);
    const doc = JSON.parse(row.data) as Record<string, unknown>;
    const flags = (doc["flags"] ?? {}) as Record<string, unknown>;
    const fusion = (flags["fusion"] ?? {}) as Record<string, unknown>;
    return fusion["title"];
  }

  function setTitle(socket: ClientSocket, title: string): Promise<Record<string, unknown>> {
    return sendOp(socket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: characterId, diff: { "flags.fusion.title": title } }],
    });
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    owner = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    stranger = connectClient(ctx.port, ctx.worldId, ctx.strangerToken);
    gm.connect();
    owner.connect();
    stranger.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(owner), waitForConnect(stranger)]);

    // The stranger is an OBSERVER: he sees the card and may not rewrite its title.
    const created = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Fofurinha",
          type: "character",
          ownership: { default: 0, [ctx.ownerId]: 3, [ctx.strangerId]: 2 },
        },
      ],
    });
    expect(created["ok"]).toBe(true);
    const result = created["result"] as { documents?: Record<string, unknown>[] } | undefined;
    const id = result?.documents?.[0]?.["_id"];
    if (typeof id !== "string") throw new Error("Actor create returned no _id");
    characterId = id;
  }, 40000);

  afterAll(async () => {
    gm?.disconnect();
    owner?.disconnect();
    stranger?.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("REQ-CTT-085: whoever holds OWNER over the character may rewrite the title", async () => {
    const ack = await setTitle(owner, "A Voz do Bosque");

    expect(ack["ok"]).toBe(true);
    expect(titleInStore(characterId)).toBe("A Voz do Bosque");
  });

  it("REQ-CTT-085: a privileged role may rewrite the title of a character it does not own", async () => {
    const ack = await setTitle(gm, "Guardiã do Bosque");

    expect(ack["ok"]).toBe(true);
    expect(titleInStore(characterId)).toBe("Guardiã do Bosque");
  });

  it("REQ-CTT-080/REQ-CTT-085: another player is refused by the server, and the stored title is untouched", async () => {
    const before = titleInStore(characterId);
    const ack = await setTitle(stranger, "Apelido que não é dele");

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(titleInStore(characterId)).toBe(before);
  });

  it("REQ-CTT-085: clearing the title is an ordinary write, not a deletion of the actor", async () => {
    const ack = await setTitle(owner, "");

    expect(ack["ok"]).toBe(true);
    expect(titleInStore(characterId)).toBe("");
    // The actor itself is still there — clearing a title never removes a contact.
    const row = ctx.fusionDb.raw.prepare("SELECT id FROM actors WHERE id = ?").get(characterId) as
      | { id: string }
      | undefined;
    expect(row?.id).toBe(characterId);
  });
});
