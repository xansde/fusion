/**
 * user-character-broadcast.test.ts — REQ-USR-025e: the blank character born with a new user reaches the clients that are
 * already connected (#254, REQ-USR-025).
 *
 * `POST /api/users` creates the character through the REST path, not through a socket `doc:create`, so nothing
 * announced it: the Mestre who made the user saw "Na mesa" stay at the old count until a reload. The route now
 * hands the created Actor to `onCharacterCreated`; the boot wires that to `SocketManager.broadcastDocCreated`,
 * which stamps it with a world seq, keeps it in the op buffer (a reconnecting client replays it) and sends it
 * through the same `broadcastToWorld` funnel (redaction included) as every other write.
 *
 * Real SQLite in a temp dir; Fastify `inject()` for HTTP and a real socket.io client for the broadcast
 * (port from `helpers/ports.ts`, never a literal).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { OwnershipLevel, PROTOCOL_VERSION } from "@fusion/shared";
import type { Envelope } from "@fusion/shared";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const WORLD_ID = "test-user-character-broadcast";

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  gmToken: string;
  onCharacterCreated: ReturnType<typeof vi.fn>;
}

async function buildCtx(opts: { hook: "spy" | "socket" | "throws" }): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-user-char-broadcast-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const authService = new AuthService(fusionDb.raw, secret, WORLD_ID);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  socketManager.registerWorldNamespace({
    worldId: WORLD_ID,
    db: fusionDb.raw,
    secret,
    authService,
  });

  const onCharacterCreated = vi.fn((actor: Record<string, unknown>) => {
    if (opts.hook === "throws") throw new Error("socket layer is down");
    if (opts.hook === "socket") socketManager.broadcastDocCreated(WORLD_ID, "Actor", [actor]);
  });
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: WORLD_ID, title: "Broadcast World", systemId: "stub" },
    onCharacterCreated,
  });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });

  const gmToken = (await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" }))
    .accessToken;
  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port: listeningPort(fastify),
    gmToken,
    onCharacterCreated,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connect(port: number, token: string): Promise<{ socket: ClientSocket; ops: Envelope[] }> {
  return new Promise((resolve, reject) => {
    const ops: Envelope[] = [];
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${WORLD_ID}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    let joined = false;
    socket.on("op", (envelope: Envelope) => {
      ops.push(envelope);
      if (!joined) {
        joined = true;
        resolve({ socket, ops });
      }
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

async function createUser(
  ctx: Ctx,
  body: { name: string; role: number },
): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  const resp = await ctx.fastify.inject({
    method: "POST",
    url: "/api/users",
    headers: { authorization: `Bearer ${ctx.gmToken}` },
    payload: body,
  });
  return { statusCode: resp.statusCode, json: resp.json<Record<string, unknown>>() };
}

async function waitFor<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("POST /api/users hands the new character to onCharacterCreated (#254)", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildCtx({ hook: "spy" });
  }, 20_000);
  afterEach(() => teardown(ctx));

  it("PLAYER: called once with the stored Actor (type character, the new user as OWNER)", async () => {
    const res = await createUser(ctx, { name: "Alice", role: Role.PLAYER });
    expect(res.statusCode).toBe(201);
    const userId = (res.json["user"] as { id: string }).id;

    expect(ctx.onCharacterCreated).toHaveBeenCalledTimes(1);
    const actor = ctx.onCharacterCreated.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(actor["name"]).toBe("Alice");
    expect(actor["type"]).toBe("character");
    expect(typeof actor["_id"]).toBe("string");
    expect((actor["ownership"] as Record<string, unknown>)[userId]).toBe(OwnershipLevel.OWNER);
  });

  it("the HTTP answer still carries no actor (REQ-CFG-051a)", async () => {
    const res = await createUser(ctx, { name: "Bia", role: Role.TRUSTED });
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json).sort()).toEqual(["ok", "user"]);
  });

  it("ASSISTANT and GAMEMASTER get no character, so nothing is announced", async () => {
    await createUser(ctx, { name: "Ajudante", role: Role.ASSISTANT });
    await createUser(ctx, { name: "Mestre2", role: Role.GAMEMASTER });
    expect(ctx.onCharacterCreated).not.toHaveBeenCalled();
  });

  it("a duplicate name creates nothing and announces nothing", async () => {
    await createUser(ctx, { name: "Caio", role: Role.PLAYER });
    ctx.onCharacterCreated.mockClear();
    const again = await createUser(ctx, { name: "Caio", role: Role.PLAYER });
    expect(again.statusCode).toBe(409);
    expect(ctx.onCharacterCreated).not.toHaveBeenCalled();
  });
});

describe("a failing announcement never fails the creation", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildCtx({ hook: "throws" });
  }, 20_000);
  afterEach(() => teardown(ctx));

  it("the user and the character exist and the answer is 201", async () => {
    const res = await createUser(ctx, { name: "Duda", role: Role.PLAYER });
    expect(res.statusCode).toBe(201);
    expect(ctx.onCharacterCreated).toHaveBeenCalledTimes(1);
  });
});

describe("the Mestre's open session learns of the new character without a reload (#254)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ops: Envelope[];
  beforeEach(async () => {
    ctx = await buildCtx({ hook: "socket" });
    ({ socket: gm, ops } = await connect(ctx.port, ctx.gmToken));
  }, 20_000);
  afterEach(async () => {
    gm.disconnect();
    await teardown(ctx);
  });

  it("a doc:create of the Actor arrives on the connected GM socket, with a world seq", async () => {
    const before = ops.length;
    const res = await createUser(ctx, { name: "Eva", role: Role.PLAYER });
    expect(res.statusCode).toBe(201);

    const envelope = await waitFor(
      () =>
        ops
          .slice(before)
          .find(
            (op) =>
              op.type === "doc:create" &&
              (op.payload as { documentType?: string }).documentType === "Actor",
          ),
      "the Actor doc:create",
    );
    const payload = envelope.payload as { documents: Record<string, unknown>[] };
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0]?.["name"]).toBe("Eva");
    expect(payload.documents[0]?.["type"]).toBe("character");
    expect(typeof envelope.seq).toBe("number");
  });

  it("two creations announce two consecutive seqs (no gap for the mirror to trip on)", async () => {
    const before = ops.length;
    await createUser(ctx, { name: "Fabio", role: Role.PLAYER });
    await createUser(ctx, { name: "Gina", role: Role.PLAYER });
    const creates = await waitFor(() => {
      const found = ops
        .slice(before)
        .filter(
          (op) =>
            op.type === "doc:create" &&
            (op.payload as { documentType?: string }).documentType === "Actor",
        );
      return found.length === 2 ? found : undefined;
    }, "two Actor doc:create");
    expect((creates[1]?.seq ?? 0) - (creates[0]?.seq ?? 0)).toBe(1);
  });
});
