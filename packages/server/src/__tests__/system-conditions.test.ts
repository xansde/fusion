/**
 * system-conditions.test.ts — the door the condition display contract comes
 * through (spec 15 REQ-SYS-043, spec 39 DEC-CTT-11).
 *
 * The drawer paints a condition from what the SYSTEM declared: colour from
 * `tone` (REQ-CTT-031), filled emphasis from `critical` (REQ-CTT-032), tooltip
 * from `help` (REQ-CTT-034). The client package cannot import a game system —
 * only the server resolves one, per world — so if this payload does not carry
 * the three fields, none of those requirements has a live path in the app.
 *
 * These assertions are about the PAYLOAD the handler answers with, not about a
 * screen: what is proved here is that the declaration crosses the wire intact,
 * for every seat, and that a system which declared nothing still gets an answer.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import {
  buildSystemConditionsHandler,
  type ConditionRegistrySource,
  type SystemConditionsResult,
} from "../net/handlers/system.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { UserRole } from "../documents/ownership.js";
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
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A stand-in for the world's SystemModule. Written by hand on purpose: reading
 * the answer back out of the same registry the handler read would prove
 * nothing about the contract, only that a Map round-trips.
 */
function systemWith(
  conditions: {
    slug: string;
    label: string;
    img?: string;
    tone?: string;
    help?: string;
    critical?: boolean;
  }[],
): ConditionRegistrySource {
  return {
    manifest: { id: "pf2e" },
    registries: { conditions: new Map(conditions.map((def) => [def.slug, def])) },
  };
}

function ctx(role: number): HandlerContext {
  return { userId: "user-1", role, worldId: "world-1" };
}

const DECLARED = systemWith([
  {
    slug: "frightened",
    label: "Amedrontado",
    img: "systems/pf2e/icons/frightened.webp",
    tone: "harm",
    help: "Penalidade de status em testes e CD.",
  },
  {
    slug: "dying",
    label: "Morrendo",
    img: "systems/pf2e/icons/dying.webp",
    tone: "harm",
    help: "Inconsciente e a um passo da morte.",
    critical: true,
  },
  { slug: "hasted", label: "Célere", img: "systems/pf2e/icons/hasted.webp", tone: "benefit" },
  // Registered before the display contract existed: still valid, still served.
  { slug: "clumsy", label: "Desajeitado", img: "systems/pf2e/icons/clumsy.webp" },
]);

function conditionsOf(source: ConditionRegistrySource, role = UserRole.PLAYER) {
  const ack = buildSystemConditionsHandler(source)({}, ctx(role));
  if (!("ok" in ack) || !ack.ok) throw new Error("handler refused");
  return ack.result;
}

// ---------------------------------------------------------------------------
// The contract crosses the wire — REQ-SYS-043
// ---------------------------------------------------------------------------

describe("the condition display contract reaches the client (REQ-SYS-043)", () => {
  it("REQ-CTT-031: the declared tone is in the payload, so the chip has a colour to derive", () => {
    const byslug = new Map(conditionsOf(DECLARED).conditions.map((c) => [c.slug, c]));

    expect(byslug.get("frightened")?.tone).toBe("harm");
    expect(byslug.get("hasted")?.tone).toBe("benefit");
  });

  it("REQ-CTT-032: a condition declared critical says so in the payload", () => {
    const byslug = new Map(conditionsOf(DECLARED).conditions.map((c) => [c.slug, c]));

    expect(byslug.get("dying")?.critical).toBe(true);
    expect(byslug.get("frightened")?.critical).toBeUndefined();
  });

  it("REQ-CTT-034: the declared help travels with it, or there is no tooltip to draw", () => {
    const byslug = new Map(conditionsOf(DECLARED).conditions.map((c) => [c.slug, c]));

    expect(byslug.get("dying")?.help).toBe("Inconsciente e a um passo da morte.");
    expect(byslug.get("hasted")?.help).toBeUndefined();
  });

  it("REQ-CTT-030: the declared icon never crosses — it is the system's artwork", () => {
    const serialized = JSON.stringify(conditionsOf(DECLARED));

    expect(serialized).not.toContain("icons");
    expect(serialized).not.toContain("img");
  });
});

// ---------------------------------------------------------------------------
// Degradation — REQ-CTT-035
// ---------------------------------------------------------------------------

describe("an incomplete or absent declaration still answers (REQ-CTT-035)", () => {
  it("REQ-CTT-035: a condition with no tone/help/critical is served, not dropped", () => {
    const bare = conditionsOf(DECLARED).conditions.find((c) => c.slug === "clumsy");

    expect(bare).toEqual({ slug: "clumsy", label: "Desajeitado" });
  });

  it("REQ-CTT-035: a world with no system answers with an empty list, never an error", () => {
    const ack = buildSystemConditionsHandler(undefined)({}, ctx(UserRole.PLAYER));

    expect(ack).toEqual({ ok: true, result: { systemId: null, conditions: [] } });
  });
});

// ---------------------------------------------------------------------------
// Who gets it
// ---------------------------------------------------------------------------

describe("the dictionary is the same for every seat", () => {
  it("REQ-CTT-031: a player receives the same declarations as the Mestre", () => {
    const asPlayer = conditionsOf(DECLARED, UserRole.PLAYER);
    const asGm = conditionsOf(DECLARED, UserRole.GAMEMASTER);

    // It is the system's static dictionary — it says nothing about any actor,
    // and WHICH conditions a seat sees comes from the redacted Actor payload.
    expect(asPlayer).toEqual(asGm);
    expect(asPlayer.systemId).toBe("pf2e");
  });
});

// ---------------------------------------------------------------------------
// The door is open — over the real socket, on a booted server
// ---------------------------------------------------------------------------

/**
 * The unit tests above prove the handler answers correctly; this one proves the
 * client can reach it at all. A contract nobody can call is exactly the defect
 * this test file exists to close: the display fields were declared, typed and
 * unit-tested, and no path in the running app ever carried them.
 */
function makeTempDir(): string {
  // Data dir lives in the OS temp dir, never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-system-conditions-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "system_conditions_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "ConditionsPlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const login = await authService.login({
    userId: player.id,
    password: "player-pass",
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
      worldTitle: "System Conditions World",
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
    playerToken: login.accessToken,
  };
}

describe("system:conditions over the real socket", () => {
  let ctx: Ctx;
  let socket: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    socket = ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
      auth: { token: ctx.playerToken, protocolVersion: PROTOCOL_VERSION },
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
    });
    socket.connect();
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
  }, 60_000);

  afterAll(async () => {
    socket.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  function ask(): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.emit(
        "op",
        { type: "system:conditions", ts: Date.now(), payload: {} },
        (response: Record<string, unknown>) => resolve(response),
      );
      setTimeout(() => reject(new Error("Timeout for op: system:conditions")), 8000);
    });
  }

  it("REQ-SYS-043: the world's system answers a player with its condition dictionary", async () => {
    const ack = await ask();

    expect(ack.ok).toBe(true);
    const result = ack.result as SystemConditionsResult;
    expect(result.systemId).toBe("pf2e");
    // Not an assertion about any one condition's metadata (that would only echo
    // the pack back at itself) — about the dictionary existing and being named.
    expect(result.conditions.length).toBeGreaterThan(10);
    expect(result.conditions.map((c) => c.slug)).toContain("frightened");
    expect(result.conditions.every((c) => c.label.length > 0)).toBe(true);
  });

  it("REQ-CTT-030: no condition artwork crosses the wire, for any system", async () => {
    const ack = await ask();

    expect(JSON.stringify(ack.result)).not.toContain("/icons/");
  });
});
