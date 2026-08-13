/**
 * An Actor never reaches a player who may not see it — by ANY of the four
 * emission paths (REQ-NET-096, REQ-NET-024, DEC-CNV-15).
 *
 * Why a real server and real sockets: the leak this test closes was invisible
 * to unit tests precisely because each path is a different function. The join
 * snapshot had been filtering Actors by ownership since M0; `broadcastToWorld`
 * only ever redacted `documentType === "Scene"` and fell through to a
 * namespace-wide `ns.emit` for everything else; and `filterOpsForRole` returned
 * every non-Scene/non-Combat op untouched. So every `doc:update` on an Actor —
 * `system.attributes.hp`, `system.derived` — went to every connected socket,
 * live and again on resync, while the snapshot looked correct.
 *
 * That is what makes a token HP bar worth having: hiding the bar in the client
 * over a payload every player already holds is decoration, not privacy.
 *
 * Harness mirrors tile-gm-only.test.ts, with a port from the ports helper.
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
// Harness
// ---------------------------------------------------------------------------

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  /** Player with OBSERVER (2) on the actor — the party member. */
  observerId: string;
  observerToken: string;
  /** Player with no ownership entry at all — the rest of the table. */
  strangerId: string;
  strangerToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "actor_hp_world";
  const dataDir = join(
    tmpdir(),
    `fusion-actor-hp-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: observer } = await authService.createUser({
    name: "Observadora",
    role: Role.PLAYER,
    password: "observer-pass",
  });
  const { user: stranger } = await authService.createUser({
    name: "Estranho",
    role: Role.PLAYER,
    password: "stranger-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const observerLogin = await authService.login({
    userId: observer.id,
    password: "observer-pass",
    ip: "127.0.0.1",
  });
  const strangerLogin = await authService.login({
    userId: stranger.id,
    password: "stranger-pass",
    ip: "127.0.0.1",
  });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Actor HP World",
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

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    observerId: observer.id,
    observerToken: observerLogin.accessToken,
    strangerId: stranger.id,
    strangerToken: strangerLogin.accessToken,
  };
}

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: { ...auth, protocolVersion: PROTOCOL_VERSION },
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for op: ${type}`));
    }, 8000);
  });
}

/** Records every `op` envelope a socket receives, for after-the-fact assertions. */
function recordOps(socket: ClientSocket): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    seen.push(env);
  });
  return seen;
}

/** Connect and resolve once the initial resync (full or delta) has arrived. */
async function connectAndSync(
  ctx: Ctx,
  auth: Record<string, unknown>,
): Promise<{ socket: ClientSocket; lastSeq: number; snapshot: Record<string, unknown> | null }> {
  const socket = connectClient(ctx.port, ctx.worldId, auth);
  let lastSeq = 0;
  let snapshot: Record<string, unknown> | null = null;
  const synced = new Promise<void>((resolve) => {
    socket.on("op", (env: Record<string, unknown>) => {
      const t = env["type"];
      if (t === "resync:full") {
        const p = env["payload"] as Record<string, unknown>;
        snapshot = (p["snapshot"] as Record<string, unknown> | null) ?? null;
        if (snapshot) lastSeq = snapshot["seq"] as number;
        resolve();
      } else if (t === "resync:delta") {
        lastSeq = env["seq"] as number;
        resolve();
      }
    });
  });
  socket.connect();
  await waitForConnect(socket);
  await synced;
  return { socket, lastSeq, snapshot };
}

/**
 * Reconnect with a `lastSeq` and collect the ops the server replays in the
 * `resync:delta`. Throws when the server falls back to a full snapshot — that
 * would mean the buffer lost the window and the test asserted nothing.
 */
async function replayedOps(
  ctx: Ctx,
  auth: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const socket = connectClient(ctx.port, ctx.worldId, auth);
  const ops: Record<string, unknown>[] = [];
  let sawDelta = false;
  const got = new Promise<void>((resolve) => {
    socket.on("op", (env: Record<string, unknown>) => {
      const t = env["type"];
      if (t === "resync:delta") {
        sawDelta = true;
        const p = env["payload"] as { ops?: Record<string, unknown>[] };
        ops.push(...(p.ops ?? []));
        resolve();
      } else if (t === "resync:full") {
        resolve();
      }
    });
  });
  socket.connect();
  await waitForConnect(socket);
  await got;
  socket.disconnect();
  if (!sawDelta) throw new Error("Expected a resync:delta, got a full snapshot");
  return ops;
}

/** The Actor documents carried by an `op` envelope, or [] when it carries none. */
function actorDocsIn(env: Record<string, unknown>): Record<string, unknown>[] {
  const type = env["type"];
  if (type !== "doc:create" && type !== "doc:update") return [];
  const payload = env["payload"] as Record<string, unknown> | undefined;
  if (!payload || payload["documentType"] !== "Actor") return [];
  const docs = payload["documents"];
  return Array.isArray(docs) ? (docs as Record<string, unknown>[]) : [];
}

/** Give the server a beat to emit anything it was going to emit. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}

// ---------------------------------------------------------------------------

describe("an Actor only reaches users who may see it (REQ-NET-096)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let actorId = "";

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, { token: ctx.gmToken });
    gm.connect();
    await waitForConnect(gm);

    // The party member's sheet: the observer may read it, the stranger may not.
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Fofurinha",
          type: "character",
          ownership: { default: 0, [ctx.observerId]: 2 },
          system: { attributes: { hp: { value: 30, max: 30 } } },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    actorId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("the live broadcast reaches the OBSERVER and skips the stranger", async () => {
    const observer = await connectAndSync(ctx, { token: ctx.observerToken });
    const stranger = await connectAndSync(ctx, { token: ctx.strangerToken });
    const observerOps = recordOps(observer.socket);
    const strangerOps = recordOps(stranger.socket);

    try {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: actorId, diff: { "system.attributes.hp.value": 12 } }],
      });
      expect(ack["ok"]).toBe(true);
      await settle();

      const observerActors = observerOps.flatMap(actorDocsIn);
      expect(observerActors.map((a) => a["_id"])).toContain(actorId);
      const hp = (
        (observerActors.find((a) => a["_id"] === actorId)?.["system"] as Record<string, unknown>)[
          "attributes"
        ] as Record<string, Record<string, unknown>>
      )["hp"];
      expect(hp?.["value"]).toBe(12);

      // The stranger must not learn the actor exists, let alone its HP.
      expect(strangerOps.flatMap(actorDocsIn)).toHaveLength(0);
    } finally {
      observer.socket.disconnect();
      stranger.socket.disconnect();
    }
  }, 30000);

  it("the delta replay on resync applies the same cut", async () => {
    // Both clients sync, note their seq, then miss an update while away.
    const observerFirst = await connectAndSync(ctx, { token: ctx.observerToken });
    const strangerFirst = await connectAndSync(ctx, { token: ctx.strangerToken });
    const observerSeq = observerFirst.lastSeq;
    const strangerSeq = strangerFirst.lastSeq;
    observerFirst.socket.disconnect();
    strangerFirst.socket.disconnect();

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { "system.attributes.hp.value": 7 } }],
    });
    expect(ack["ok"]).toBe(true);

    // Reconnecting with lastSeq replays the buffered ops — the path that is
    // easiest to forget, because it re-emits the very envelopes the live path
    // had already redacted for someone else.
    const observerDelta = await replayedOps(ctx, {
      token: ctx.observerToken,
      lastSeq: observerSeq,
    });
    const strangerDelta = await replayedOps(ctx, {
      token: ctx.strangerToken,
      lastSeq: strangerSeq,
    });

    expect(observerDelta.flatMap(actorDocsIn).map((a) => a["_id"])).toContain(actorId);
    expect(strangerDelta.flatMap(actorDocsIn)).toHaveLength(0);

    // The replay must still cover the whole window: the client applies an op
    // only at `seq === current + 1`, so an op REMOVED from the delta leaves the
    // viewer stuck at that seq and the next resync replays the same hole.
    expect(strangerDelta).toHaveLength(observerDelta.length);
    expect(strangerDelta.map((op) => op["seq"])).toEqual(observerDelta.map((op) => op["seq"]));
  }, 30000);

  it("the join snapshot still behaves as it always did", async () => {
    const observer = await connectAndSync(ctx, { token: ctx.observerToken });
    const stranger = await connectAndSync(ctx, { token: ctx.strangerToken });

    try {
      const actorsOf = (snap: Record<string, unknown> | null): Record<string, unknown>[] => {
        const documents = snap?.["documents"] as Record<string, unknown[]> | undefined;
        return (documents?.["Actor"] ?? []) as Record<string, unknown>[];
      };

      expect(actorsOf(observer.snapshot).map((a) => a["_id"])).toContain(actorId);
      expect(actorsOf(stranger.snapshot).map((a) => a["_id"])).not.toContain(actorId);
    } finally {
      observer.socket.disconnect();
      stranger.socket.disconnect();
    }
  }, 30000);

  /**
   * Redacting an Actor away must not tear a hole in the socket's seq stream.
   *
   * `DocumentMirror._applyOp` (client) applies an op only when `seq` is exactly
   * `current + 1`; anything higher is a GAP, which it discards while firing the
   * listener that sends a `resync:request`. So a viewer who is simply SKIPPED
   * for one op stalls at that seq: the next op it does receive reads as a gap,
   * the resync replays the same window with the same op filtered out, and the
   * hole never closes. Every other redaction in this codebase strips CONTENT
   * and keeps the envelope, which is why nothing had to think about this before.
   *
   * The invariant: a socket receives every seq, in order — the ones it may not
   * read arrive carrying no documents. `documents: []` says "an op happened",
   * which the shared seq counter already says anyway, and says nothing about
   * which document or whose.
   */
  it("keeps the seq stream contiguous for the viewer it redacts (REQ-NET-096)", async () => {
    const stranger = await connectAndSync(ctx, { token: ctx.strangerToken });
    const seen = recordOps(stranger.socket);

    try {
      // (1) an Actor update the stranger may not see, then (2) a Scene create
      // they may — if (1) is dropped outright, (2) arrives as a gap.
      const hidden = await sendOp(gm, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: actorId, diff: { "system.attributes.hp.value": 3 } }],
      });
      expect(hidden["ok"]).toBe(true);

      const visible = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Depois do dano" }],
      });
      expect(visible["ok"]).toBe(true);
      await settle();

      const seqs = seen
        .map((env) => env["seq"])
        .filter((s): s is number => typeof s === "number")
        .sort((a, b) => a - b);

      expect(seqs.length).toBeGreaterThanOrEqual(2);
      expect(seqs[0]).toBe(stranger.lastSeq + 1);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1]! + 1);
      }

      // Contiguous, yes — but still carrying nothing about that Actor.
      expect(seen.flatMap(actorDocsIn)).toHaveLength(0);
    } finally {
      stranger.socket.disconnect();
    }
  }, 30000);
});
