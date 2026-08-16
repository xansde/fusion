/**
 * Condition toggle — real handler path integration test (T034).
 *
 * The sheet's condition toggle (CharacterSheetVM.toggleCondition /
 * NpcSheetVM.toggleCondition, packages/client/src/lib/sheets/pf2e/) used to
 * build a doc:update Actor op with synthetic dot-path diff keys
 * ("items.-<id>" to remove, "items.+" to add). The server never implemented
 * those operators: applyDotPathDiff expands the path literally to
 * `{ items: { "-<id>": true } }`, deepMerge replaces the whole `items` array
 * with that object, and schema validation rejects the corrupted doc with
 * VALIDATION_FAILED — the Actor is never touched. This is proven in this
 * file's "regression" block below by sending that exact legacy shape against
 * the real server.
 *
 * The fix (this test's main subject) routes toggleCondition through the
 * EMBEDDED item CRUD path instead — doc:create with `parent: {type:"Actor"}`
 * to add, doc:delete with `parent: {type:"Actor"}` to remove — the same path
 * embedded-item-actor.test.ts already proves for spells/spellcastingEntries.
 *
 * NOTE ON THE OP UNDER TEST: packages/server cannot import
 * `@fusion/client` (no such workspace dependency — verified against
 * packages/server/package.json), so the ops below are REPLICATED by hand
 * from characterSheetVM.ts's toggleCondition, not produced by calling the
 * real VM function. `condition-toggle-op-shape.test.ts` on the client side
 * (packages/client/src/lib/sheets/pf2e/__tests__/) asserts the VM actually
 * returns objects matching this exact shape, closing the gap between "what
 * this file sends" and "what the VM really produces".
 *
 * Also note the `value` omission on add: ConditionSystemSchema's `value` is
 * `z.number().int().min(1).optional()` — it accepts `undefined` but REJECTS
 * `null`. The legacy op sent `system: { slug, value: null }`, which would
 * have failed schema validation even if the dot-path diff bug were fixed
 * (verified directly: `value: null` rejects, an omitted key passes,
 * `value: 2` passes). The fix (and this test) omits the key entirely.
 *
 * Spec: 17-sistema-pf2e.md REQ-PF2-050..054, 15-api-de-sistemas.md
 * REQ-SYS-011/020..025.
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

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-condition-toggle-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  ownerUserId: string;
  outsiderToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "condition_toggle_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  // Plain PLAYER, OWNER of their own Actor — the exact shape the sheet runs
  // under (a player toggling a condition on their own character), matching
  // embedded-item-actor.test.ts's ownership setup.
  const { user: owner } = await authService.createUser({
    name: "ConditionOwnerPlayer",
    role: Role.PLAYER,
    password: "owner-pass",
  });
  const { user: outsider } = await authService.createUser({
    name: "ConditionOutsiderPlayer",
    role: Role.PLAYER,
    password: "outsider-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const ownerLogin = await authService.login({
    userId: owner.id,
    password: "owner-pass",
    ip: "127.0.0.1",
  });
  const outsiderLogin = await authService.login({
    userId: outsider.id,
    password: "outsider-pass",
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
      worldTitle: "Condition Toggle World",
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
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    ownerToken: ownerLogin.accessToken,
    ownerUserId: owner.id,
    outsiderToken: outsiderLogin.accessToken,
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
// Op builders — REPLICATED from characterSheetVM.ts's toggleCondition (see
// file docstring: packages/server cannot import @fusion/client). Each is the
// client-normalized WIRE shape (data/ids as arrays — mirrors what
// makeSendOpFn/toEnvelope in packages/client/src/lib/docs/sendOp.ts produce
// from the VM's flat op), not the VM's raw flat return value.
// ---------------------------------------------------------------------------

/**
 * Current (fixed) shape: doc:create embedded, value key omitted entirely.
 *
 * `name` carries the human label, not the slug — that is what the VM sends
 * (SCAFFOLDING_CONDITION_CATALOG supplies it) and what ends up as the chip
 * text on the sheet. The client-side companion of this test,
 * condition-toggle-op-shape.test.ts, pins the same literals against the real
 * VM, which is what keeps the two files from drifting apart.
 */
function buildAddConditionOpFixed(
  actorId: string,
  slug: string,
  label: string,
): Record<string, unknown> {
  return {
    documentType: "Item",
    data: [{ type: "condition", name: label, system: { slug } }],
    parent: { type: "Actor", id: actorId },
  };
}

/** Current (fixed) shape: doc:delete embedded. */
function buildRemoveConditionOpFixed(actorId: string, itemId: string): Record<string, unknown> {
  return {
    documentType: "Item",
    ids: [itemId],
    parent: { type: "Actor", id: actorId },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Condition toggle — real doc:create/doc:delete handler path (pf2e, T034)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let outsiderSocket: ClientSocket;
  let actorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    ownerSocket = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    outsiderSocket = connectClient(ctx.port, ctx.worldId, ctx.outsiderToken);
    gm.connect();
    ownerSocket.connect();
    outsiderSocket.connect();
    await Promise.all([
      waitForConnect(gm),
      waitForConnect(ownerSocket),
      waitForConnect(outsiderSocket),
    ]);

    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Condition Test PC",
          type: "character",
          system: { details: { level: { value: 1 } } },
          ownership: { default: 0, [ctx.ownerUserId]: 3 },
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const docs = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents;
    actorId = docs[0]!._id;
    expect(actorId).toBeTruthy();
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // Case 1 + 2: OWNER player, fixed embedded-CRUD shape
  // -------------------------------------------------------------------------

  let conditionItemId: string;

  it("case 1: OWNER player's add op creates a condition Item with no system.value key", async () => {
    const ack = await sendOp(
      ownerSocket,
      "doc:create",
      buildAddConditionOpFixed(actorId, "prone", "Prone"),
    );
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documents: Array<Record<string, unknown>> };
    const created = result.documents[0]!;
    conditionItemId = created["_id"] as string;
    expect(conditionItemId).toBeTruthy();
    expect(created["type"]).toBe("condition");
    const system = created["system"] as Record<string, unknown>;
    expect(system["slug"]).toBe("prone");
    // The bug this test guards: `value: null` fails ConditionSystemSchema
    // (z.number().int().min(1).optional() accepts undefined, rejects null).
    // The fixed op omits the key entirely.
    expect("value" in system).toBe(false);
  });

  it("case 2: OWNER player's remove op deletes the condition Item; items reverts", async () => {
    const ack = await sendOp(
      ownerSocket,
      "doc:delete",
      buildRemoveConditionOpFixed(actorId, conditionItemId),
    );
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { parent: Record<string, unknown> };
    const items = result.parent["items"] as Array<Record<string, unknown>>;
    expect(items.find((i) => i["_id"] === conditionItemId)).toBeUndefined();
    expect(items.some((i) => i["type"] === "condition")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Case 3: outsider (no ownership) rejected
  // -------------------------------------------------------------------------

  it("case 3: a player without ownership is rejected with PERMISSION_DENIED", async () => {
    const ack = await sendOp(
      outsiderSocket,
      "doc:create",
      buildAddConditionOpFixed(actorId, "off-guard", "Off-Guard"),
    );
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // Regression: the LEGACY dot-path diff shape (what toggleCondition sent
  // before the T034 fix) is rejected by the real server — VALIDATION_FAILED,
  // never a mutation. Proves the bug this file's fix addresses, and (run
  // manually against a temporarily-reverted VM — see PR notes) that cases 1
  // and 2 above are NOT vacuous: swapping their op builders for the legacy
  // shape below turns them red.
  //
  // T013 NOTE: both ops below now carry `expectedVersion` (read off the
  // Actor doc handed back by the preceding embedded op). Without it, T013's
  // NEW "expectedVersion is mandatory for non-privileged writers" guard would
  // fire FIRST and return VALIDATION_FAILED for a completely different
  // reason (a missing field, not the legacy dot-path shape) — same code,
  // same ok:false, so the assertions below would still go green while no
  // longer proving what this block claims to prove. Supplying the correct
  // version keeps these tests exercising the shape-validation bug they were
  // written for.
  // -------------------------------------------------------------------------

  describe("regression: legacy dot-path diff (pre-T034) never mutates the Actor", () => {
    /** Actor `_stats.version` after the last successful embedded op below. */
    let actorVersion: number;

    it("legacy remove op ({ items.-<id>: true } diff) is rejected, not applied", async () => {
      // Re-add a condition to have something a legacy "remove" could target.
      const addAck = await sendOp(
        ownerSocket,
        "doc:create",
        buildAddConditionOpFixed(actorId, "blinded", "Blinded"),
      );
      expect(addAck["ok"]).toBe(true);
      const addResult = addAck["result"] as {
        documents: Array<{ _id: string }>;
        parent: Record<string, unknown>;
      };
      const addedId = addResult.documents[0]!._id;
      actorVersion = (addResult.parent["_stats"] as Record<string, unknown>)["version"] as number;

      const legacyRemoveAck = await sendOp(ownerSocket, "doc:update", {
        documentType: "Actor",
        updates: [
          {
            _id: actorId,
            diff: { [`items.-${addedId}`]: true },
            expectedVersion: actorVersion,
          },
        ],
      });
      expect(legacyRemoveAck["ok"]).toBe(false);
      expect(legacyRemoveAck["code"]).toBe("VALIDATION_FAILED");

      // Clean up via the FIXED path so later tests aren't affected.
      const cleanupAck = await sendOp(
        ownerSocket,
        "doc:delete",
        buildRemoveConditionOpFixed(actorId, addedId),
      );
      expect(cleanupAck["ok"]).toBe(true);
      const cleanupParent = (cleanupAck["result"] as { parent: Record<string, unknown> }).parent;
      actorVersion = (cleanupParent["_stats"] as Record<string, unknown>)["version"] as number;
    });

    it("legacy add op ({ items.+: {...} } diff) is rejected, not applied", async () => {
      // Read the current version here rather than inheriting it from the test
      // above: with T013's mandatory field, a stale `undefined` would make the
      // op fail on the missing field instead of on the legacy diff shape —
      // green for the wrong reason, and only when run in isolation.
      const row = ctx.fusionDb.raw.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as {
        data: string;
      };
      const currentVersion = (
        (JSON.parse(row.data) as Record<string, unknown>)["_stats"] as Record<string, unknown>
      )["version"] as number;

      const legacyAddAck = await sendOp(ownerSocket, "doc:update", {
        documentType: "Actor",
        updates: [
          {
            _id: actorId,
            diff: {
              "items.+": {
                type: "condition",
                name: "stunned",
                system: { slug: "stunned", value: null },
              },
            },
            expectedVersion: currentVersion,
          },
        ],
      });
      expect(legacyAddAck["ok"]).toBe(false);
      expect(legacyAddAck["code"]).toBe("VALIDATION_FAILED");
    });
  });
});
