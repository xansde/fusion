/**
 * REQ-CFG-035 — flipping a `variantRules.classLevels`/`freeArchetype`
 * world-scope Setting re-derives every Actor RIGHT THEN, not on their next
 * unrelated write.
 *
 * Bug this closes (achado 6, adversarial review of core#273/satélite#278,
 * 26/09/2026): `resolveWorldVariantRules` overlay (DEC-MCL-09) made
 * `runActorDerivation` READ the world's current setting correctly, but
 * nothing ever called it again when the setting itself changed — an actor's
 * `system.derived` (HP, proficiencies, ...) stayed stale until whatever
 * incidental write happened to touch that actor next. `doc-handlers.ts`'s
 * `rederiveActorsForChangedVariantRules` closes this by re-running
 * derivation for every Actor inside the SAME doc:create/doc:update handler
 * call that persisted the Setting, and broadcasting the ones that changed
 * as a second `doc:update("Actor", ...)` envelope.
 *
 * Uses a FAKE system (mirrors derive-runner.test.ts's
 * buildFakeSystemReadingBuild), not pf2e — the point here is the WIRING
 * (does changing a Setting reach other actors' derived block, unprompted),
 * which is system-agnostic; the real class-levels HP math is already
 * covered by systems/pf2e/src/__tests__/class-levels-derivation.test.ts and
 * fusion-systems-2e's own engine-2e tests.
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
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fake system — echoes `system.build.variantRules.classLevels` /
// `system.build.freeArchetype` onto `system.derived`, exactly what
// resolveClassLevels/pf2e's freeArchetype getter do for real.
// ---------------------------------------------------------------------------

function buildFakeVariantSystem(): SystemModule {
  return defineSystem(
    {
      id: "fake-variant-system",
      title: "Fake Variant System",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: { Actor: ["hero"] },
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.derive({
        id: "fake.echo-class-levels",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "derived",
        reads: [],
        writes: ["system.derived.classLevelsSeen"],
        run: (doc) => {
          const d = doc as {
            system: {
              build?: { variantRules?: { classLevels?: boolean } };
              derived?: Record<string, unknown>;
            };
          };
          if (!d.system.derived || typeof d.system.derived !== "object") {
            d.system.derived = {};
          }
          d.system.derived["classLevelsSeen"] = d.system.build?.variantRules?.classLevels ?? false;
        },
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors derive-wiring.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-variant-rederivation-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "variant_rederivation_world";
  const systemId = "fake-variant-system";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

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
      worldTitle: "Variant Rederivation World",
      worldSystemId: systemId,
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId,
      systemModule: buildFakeVariantSystem(),
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

/** Waits for the next pushed `op` envelope of `envelopeType` for `documentType`. */
function waitForBroadcast(
  socket: ClientSocket,
  envelopeType: string,
  documentType: string,
  timeoutMs = 4000,
): Promise<{ documents: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("op", handler);
      reject(new Error(`Timeout waiting for ${envelopeType}/${documentType} broadcast`));
    }, timeoutMs);
    function handler(envelope: { type: string; payload: unknown }) {
      if (envelope.type !== envelopeType) return;
      const payload = envelope.payload as { documentType?: string; documents?: unknown };
      if (payload.documentType !== documentType) return;
      clearTimeout(timer);
      socket.off("op", handler);
      resolve(payload as { documents: Record<string, unknown>[] });
    }
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REQ-CFG-035 — Setting write re-derives Actors immediately", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  });

  afterAll(async () => {
    gm.close();
    await teardown(ctx);
  });

  it("creating the classLevels Setting for the first time re-derives an existing actor and broadcasts it, without the actor itself being written", async () => {
    const createActorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Hero", type: "hero", ownership: { default: 0 }, system: {} }],
    });
    expect(createActorAck["ok"]).toBe(true);
    const actorDoc = (createActorAck["result"] as { documents: Record<string, unknown>[] })
      .documents[0]!;
    expect((actorDoc["system"] as Record<string, unknown>)["derived"]).toMatchObject({
      classLevelsSeen: false,
    });

    const broadcastPromise = waitForBroadcast(gm, "doc:update", "Actor");

    const settingAck = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [
        {
          key: "fake-variant-system:variantRules.classLevels",
          value: true,
          ownership: { default: 0 },
        },
      ],
    });
    expect(settingAck["ok"]).toBe(true);

    // The re-derivation is a SIDE EFFECT of the Setting create, not a write
    // the test itself performs on the actor — proves REQ-CFG-035 fires
    // without any further actor-side write.
    const rederived = await broadcastPromise;
    expect(rederived.documents).toHaveLength(1);
    expect(rederived.documents[0]?.["_id"]).toBe(actorDoc["_id"]);
    expect(
      (rederived.documents[0]?.["system"] as Record<string, unknown>)["derived"],
    ).toMatchObject({ classLevelsSeen: true });
  });

  it("a Setting write on an UNRELATED key never triggers a rederivation broadcast", async () => {
    let sawBroadcast = false;
    const handler = (envelope: { type: string; payload: unknown }) => {
      if (envelope.type !== "doc:update") return;
      const payload = envelope.payload as { documentType?: string };
      if (payload.documentType === "Actor") sawBroadcast = true;
    };
    gm.on("op", handler);

    // A Setting key the fake system never registered as a variant-rules
    // suffix (isVariantRulesSettingKey only matches
    // `:variantRules.classLevels`/`:variantRules.freeArchetype`) — proves
    // the hook is keyed on the SUFFIX, not "any Setting write at all".
    const settingAck = await sendOp(gm, "doc:create", {
      documentType: "Setting",
      data: [
        {
          key: "fake-variant-system:someOtherSetting",
          value: true,
          ownership: { default: 0 },
        },
      ],
    });
    expect(settingAck["ok"]).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 800));
    gm.off("op", handler);
    expect(sawBroadcast).toBe(false);
  });
});
