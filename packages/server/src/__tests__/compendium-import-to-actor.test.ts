/**
 * Bringing to the WORLD vs bringing to a SHEET (G095).
 *
 * Spec: 43-aba-compendio.md §5.7 / DEC-CPD-05 — REQ-CPD-060 (a privileged role
 * brings an entry to the world), REQ-CPD-061 (whoever has `OWNER` of an actor
 * brings a compatible entry to THAT actor's sheet, and the server validates the
 * ownership of the DESTINATION), REQ-CPD-064 (bringing the same entry twice is
 * allowed and produces a second document) and REQ-CPD-073 (world needs
 * `isRolePrivileged`; sheet needs `OWNER` of the destination).
 *
 * AND WHAT THE REFUSAL MAY NOT SAY: REQ-SEC-021 (repeated for this tab by
 * REQ-CPD-071) forbids the recusa from revealing that a Document the caller
 * cannot see exists at all, so a player probing actorIds must get one identical
 * answer for "not yours" and for "not there".
 *
 * WHY THE PAYLOAD, NOT THE SCREEN: every assertion below reads the ack — or the
 * broadcast — the PLAYER's own socket receives. A disabled button would satisfy
 * nothing here: the point of DEC-CPD-05 is that the predicate is enforced by the
 * server, over the destination, and a hand-rolled `emit` from a browser console
 * has to hit the same wall (REQ-CPD-074).
 *
 * WHY THE REAL PACKS: the committed `pf2e.conditions` (`documentType: "Item"`,
 * `audience: "all"`) is what a player would actually reach for, and the
 * committed `pf2e.bestiary-core` (`audience: "gm"`) is what he must not reach
 * through this new door — a sheet import is not a side entrance into the
 * bestiary.
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
import { PROTOCOL_VERSION, OwnershipLevel } from "@fusion/shared";
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";

/** `documentType: "Item"`, `audience: "all"` — the pack a player can reach. */
const ITEM_PACK_ID = "pf2e.conditions";
/** `documentType: "Actor"`, `audience: "gm"` — never reachable by a player. */
const GM_ACTOR_PACK_ID = "pf2e.bestiary-core";
/** A uuid no pack ever published — the "does not exist" reference answer. */
const UNKNOWN_UUID = "Compendium.pf2e.conditions.Item.no-such-doc-id-at-all";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cmp-to-actor-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerId: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "cmp_to_actor_world";

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
      worldTitle: "Compendium Sheet Import World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
      systemId: "pf2e",
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
    playerId: player.id,
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

function send(
  socket: ClientSocket,
  event: "op" | "query",
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit(event, { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for ${event}: ${type}`));
    }, 8000);
  });
}

/** Read the persisted actor straight from the world db — the ground truth. */
function readActorItems(ctx: Ctx, actorId: string): Record<string, unknown>[] {
  const store = new DocumentStore({ db: ctx.fusionDb.raw });
  const actor = store.get("actors", actorId);
  const items = actor["items"];
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

describe("bringing a compendium entry to a sheet (REQ-CPD-061, REQ-CPD-073)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  /** An Item entry from a pack the player can see. */
  let itemUuid: string;
  let itemUuid2: string;
  /** An Actor entry — a type no sheet can receive (REQ-CPD-061). */
  let creatureUuid: string;
  /** Actor the PLAYER owns; actor he does not. */
  let ownedActorId: string;
  let foreignActorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await waitForConnect(gm);
    await waitForConnect(player);

    const itemIndex = await send(player, "query", "compendium:index", { packId: ITEM_PACK_ID });
    const itemEntries = (itemIndex["result"] as { entries: Array<{ uuid: string }> }).entries;
    itemUuid = itemEntries[0]!.uuid;
    itemUuid2 = itemEntries[1]!.uuid;

    const creatureIndex = await send(gm, "query", "compendium:index", {
      packId: GM_ACTOR_PACK_ID,
    });
    const creatureEntries = (creatureIndex["result"] as { entries: Array<{ uuid: string }> })
      .entries;
    creatureUuid = creatureEntries[0]!.uuid;

    const ownedAck = await send(gm, "op", "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Sheet Of Mine",
          type: "character",
          ownership: { default: OwnershipLevel.NONE, [ctx.playerId]: OwnershipLevel.OWNER },
        },
      ],
    });
    ownedActorId = (
      (ownedAck["result"] as { documents: Array<Record<string, unknown>> }).documents[0] as {
        _id: string;
      }
    )._id;

    const foreignAck = await send(gm, "op", "doc:create", {
      documentType: "Actor",
      data: [{ name: "Not Yours", type: "npc", ownership: { default: OwnershipLevel.NONE } }],
    });
    foreignActorId = (
      (foreignAck["result"] as { documents: Array<Record<string, unknown>> }).documents[0] as {
        _id: string;
      }
    )._id;
    // boot() discovers and indexes every committed pf2e pack before the first
    // query answers; that alone has crossed the default hook ceiling on a
    // loaded runner. Infra headroom, not behaviour under test.
  }, 120_000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // The player's own sheet — the door DEC-CPD-05 opens
  // -------------------------------------------------------------------------

  it("REQ-CPD-061 / REQ-CPD-073: a player brings an entry to a sheet he OWNS", async () => {
    const before = readActorItems(ctx, ownedActorId).length;

    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: ownedActorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { actorId: string; created: string[]; failed: unknown[] };
    expect(result.actorId).toBe(ownedActorId);
    expect(result.created).toHaveLength(1);
    expect(result.failed).toEqual([]);

    const after = readActorItems(ctx, ownedActorId);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.["_id"]).toBe(result.created[0]);
  });

  it("REQ-CPD-061: the sheet copy keeps its origin and drops the pack-only fields", async () => {
    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: ownedActorId,
    });
    const created = (ack["result"] as { created: string[] }).created[0];

    const item = readActorItems(ctx, ownedActorId).find((i) => i["_id"] === created);
    expect(item).toBeDefined();
    // The clone points back at the pack (DEC-CPD-12) but is not the pack doc.
    expect(
      (item?.["flags"] as { fusion?: { sourceId?: string } } | undefined)?.fusion?.sourceId,
    ).toBeTruthy();
    expect(item?.["uuid"]).toBeUndefined();
    expect(item?.["i18n"]).toBeUndefined();
  });

  it("REQ-CPD-064: bringing the same entry twice creates a SECOND document", async () => {
    const first = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid2],
      actorId: ownedActorId,
    });
    const second = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid2],
      actorId: ownedActorId,
    });

    const firstId = (first["result"] as { created: string[] }).created[0];
    const secondId = (second["result"] as { created: string[] }).created[0];

    expect(second["ok"]).toBe(true);
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);

    const items = readActorItems(ctx, ownedActorId);
    expect(items.filter((i) => i["_id"] === firstId || i["_id"] === secondId)).toHaveLength(2);
  });

  it("REQ-CPD-061: the changed sheet is announced on the ordinary doc:update channel", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const onOp = (env: Record<string, unknown>): void => {
      if (env["type"] === "doc:update") seen.push(env);
    };
    player.on("op", onOp);

    await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: ownedActorId,
    });
    await new Promise((r) => setTimeout(r, 250));
    player.off("op", onOp);

    const actorUpdates = seen.filter((env) => {
      const payload = env["payload"] as { documentType?: string } | undefined;
      return payload?.documentType === "Actor";
    });
    expect(actorUpdates.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // The destination is the predicate — not the caller's role
  // -------------------------------------------------------------------------

  it("REQ-CPD-073: a player is refused a sheet he does not OWN, and nothing is written", async () => {
    const before = readActorItems(ctx, foreignActorId).length;

    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: foreignActorId,
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(readActorItems(ctx, foreignActorId)).toHaveLength(before);
  });

  it("REQ-SEC-021 / REQ-CPD-071: for a player, a sheet he cannot see and a sheet that is not there answer the SAME", async () => {
    // The probe: two ids, one naming a real actor with `default: NONE` and no
    // entry for this player, the other naming nothing at all. If the two acks
    // differ in ANY field, the handler has just told the player which of his
    // guesses named a real sheet — REQ-SEC-021's "NONE é indistinguível de
    // 'não existe'", repeated for this tab by REQ-CPD-071.
    const foreign = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: foreignActorId,
    });
    const nonexistent = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: "no-such-actor-id",
    });

    expect(foreign["ok"]).toBe(false);
    expect(nonexistent["ok"]).toBe(false);
    // Same code AND same message — the id echoed back is the one the player
    // himself sent, so it discloses nothing he did not already know.
    expect(nonexistent["code"]).toBe(foreign["code"]);
    expect(String(nonexistent["message"]).replace("no-such-actor-id", "<id>")).toBe(
      String(foreign["message"]).replace(foreignActorId, "<id>"),
    );
  });

  it("REQ-CPD-060 / REQ-CPD-073: the GM brings to any sheet, owning it by role", async () => {
    const before = readActorItems(ctx, foreignActorId).length;

    const ack = await send(gm, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: foreignActorId,
    });

    expect(ack["ok"]).toBe(true);
    expect((ack["result"] as { created: string[] }).created).toHaveLength(1);
    expect(readActorItems(ctx, foreignActorId)).toHaveLength(before + 1);
  });

  it("REQ-CPD-073: bringing to the WORLD stays privileged — the player is refused", async () => {
    const ack = await send(player, "op", "compendium:import", { uuids: [itemUuid] });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("REQ-CPD-060: the GM brings the same entry to the world", async () => {
    const ack = await send(gm, "op", "compendium:import", { uuids: [itemUuid] });

    expect(ack["ok"]).toBe(true);
    expect((ack["result"] as { created: string[] }).created).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Type compatibility, and the audience that does not reopen here
  // -------------------------------------------------------------------------

  it("REQ-CPD-061: an Actor entry is refused by a sheet — wrong type, not wrong permission", async () => {
    const before = readActorItems(ctx, foreignActorId).length;

    const ack = await send(gm, "op", "compendium:importToActor", {
      uuids: [creatureUuid],
      actorId: foreignActorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as {
      created: string[];
      failed: Array<{ uuid: string; reason: string }>;
    };
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.uuid).toBe(creatureUuid);
    expect(readActorItems(ctx, foreignActorId)).toHaveLength(before);
  });

  it("REQ-CPD-071 / REQ-CPD-073: the sheet door is no side entrance into a gm pack", async () => {
    const hidden = await send(player, "op", "compendium:importToActor", {
      uuids: [creatureUuid],
      actorId: ownedActorId,
    });
    const unknown = await send(player, "op", "compendium:importToActor", {
      uuids: [UNKNOWN_UUID],
      actorId: ownedActorId,
    });

    const hiddenFailed = (hidden["result"] as { failed: Array<{ reason: string }> }).failed;
    const unknownFailed = (unknown["result"] as { failed: Array<{ reason: string }> }).failed;

    expect(hidden["ok"]).toBe(true);
    expect((hidden["result"] as { created: string[] }).created).toEqual([]);
    // Same reason, word for word: nothing in the answer tells the player whether
    // the bestiary exists (REQ-SEC-020).
    expect(hiddenFailed[0]?.reason).toBe(unknownFailed[0]?.reason);
  });

  // -------------------------------------------------------------------------
  // Batch, and the destination that is not there
  // -------------------------------------------------------------------------

  it("REQ-CPD-065: a batch reports every uuid it brought, in one write", async () => {
    const before = readActorItems(ctx, ownedActorId).length;

    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [itemUuid, itemUuid2],
      actorId: ownedActorId,
    });

    expect(ack["ok"]).toBe(true);
    expect((ack["result"] as { created: string[] }).created).toHaveLength(2);
    expect(readActorItems(ctx, ownedActorId)).toHaveLength(before + 2);
  });

  it("REQ-CPD-061 / REQ-SEC-021: a destination that does not exist answers NOT_FOUND to a privileged role", async () => {
    // The GM already sees every actor in the world, so naming the absence back
    // to him hides nothing — the collapse of the two refusals is owed to the
    // caller who CANNOT see them (covered above).
    const ack = await send(gm, "op", "compendium:importToActor", {
      uuids: [itemUuid],
      actorId: "no-such-actor-id",
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
  });

  it("REQ-CPD-061: an empty uuid list is a validation failure, not an empty success", async () => {
    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [],
      actorId: ownedActorId,
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });
});
