/**
 * A001 (ajustes r1, item 9) — editing a contact card's title used to trip the
 * server's mandatory `expectedVersion` gate for a non-privileged writer.
 * REQ-CTT-024 ("O título DEVE ser editável no próprio cartão por quem tem
 * posse") and REQ-CTT-085 ("Alterar o título DEVE ser permitido a papel
 * privilegiado e a...") — spec 39.
 *
 * `ContactsPanel.svelte`'s `commitTitle()` called `sendOp()` with a hand-built
 * wire envelope, bypassing `toEnvelope()`/`fillExpectedVersion` — the only
 * client-side path that fills `expectedVersion` from the DocumentMirror. This
 * file drives the real socket handler end-to-end (boot() + socket.io client,
 * mirroring expected-version.test.ts's infrastructure) to reproduce both
 * halves against a PLAYER who is OWNER of their own Actor:
 *
 *   (a) the OLD shape — no `expectedVersion` at all — is refused with the
 *       exact message doc-handlers.ts returns, and nothing is persisted;
 *   (b) the NEW shape — the same title diff `contactTitleDiff()` builds, with
 *       `expectedVersion` filled in (what `toEnvelope()` now does for
 *       `commitTitle()`) — succeeds, and the title is persisted under
 *       `flags.fusion.title` (CONTACT_TITLE_FLAG_PATH, contactsVM.ts).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";

// The same diff-path constant ContactsPanel's contactTitleDiff() writes to —
// duplicated as a literal (not imported) because this file lives in the
// server package, which cannot import client code (lint:boundaries,
// no-server-from-client).
const CONTACT_TITLE_FLAG_PATH = "flags.fusion.title";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors expected-version.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
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
  store: DocumentStore;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerUserId: string;
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
  // Plain PLAYER, OWNER of their own character — the exact seat A001 reports
  // as broken: "um jogador OWNER edita o título do próprio personagem".
  const { user: player } = await authService.createUser({
    name: "ContactsTitlePlayer",
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
      worldTitle: "Contacts Title World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
    },
  });

  return {
    dataDir,
    fusionDb,
    store: new DocumentStore({ db: fusionDb.raw }),
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("A001 — Contacts title edit and the mandatory expectedVersion gate (REQ-CTT-024, REQ-CTT-085)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let actorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // Fresh Actor per test, owned by the player — the character whose title
  // the player is editing on their own contact card.
  beforeEach(async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Fofurinha",
          type: "character",
          system: {},
          ownership: { default: 0, [ctx.playerUserId]: 3 },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    actorId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const created = ctx.store.get("actors", actorId);
    expect((created["_stats"] as Record<string, unknown>)["version"]).toBe(1);
  });

  it("reproduces the OLD bug: commitTitle's hand-built envelope (no expectedVersion) is refused with the exact message reported", async () => {
    // The shape ContactsPanel.svelte's commitTitle() sent BEFORE the A001
    // fix: `sendOp(socket, { type: "doc:update", payload: { documentType,
    // updates: [{ _id, diff }] } })` — a wire envelope built by hand, never
    // routed through toEnvelope()/fillExpectedVersion, so `expectedVersion`
    // never makes it onto the wire no matter what the client's mirror knew.
    const ack = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { [CONTACT_TITLE_FLAG_PATH]: "A Voz do Bosque" } }],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toBe(
      `expectedVersion is required for Actor/${actorId} — reload the document and retry`,
    );

    // Nothing persisted — the title stays absent.
    const persisted = ctx.store.get("actors", actorId);
    const flags = persisted["flags"] as Record<string, unknown> | undefined;
    const fusionFlags = flags?.["fusion"] as Record<string, unknown> | undefined;
    expect(fusionFlags?.["title"]).toBeUndefined();
    expect((persisted["_stats"] as Record<string, unknown>)["version"]).toBe(1);
  });

  it("the FIXED shape — same diff, with expectedVersion filled — succeeds and the title persists", async () => {
    // The shape commitTitle() sends AFTER the A001 fix: toEnvelope() filled
    // `expectedVersion` from the DocumentMirror (version 1, straight off the
    // doc:create ack this player would have received/seen in their mirror).
    const ack = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: actorId,
          diff: { [CONTACT_TITLE_FLAG_PATH]: "A Voz do Bosque" },
          expectedVersion: 1,
        },
      ],
    });

    expect(ack["ok"]).toBe(true);

    const persisted = ctx.store.get("actors", actorId);
    const flags = persisted["flags"] as Record<string, unknown>;
    const fusionFlags = flags["fusion"] as Record<string, unknown>;
    expect(fusionFlags["title"]).toBe("A Voz do Bosque");
    expect((persisted["_stats"] as Record<string, unknown>)["version"]).toBe(2);
  });
});
