/**
 * Animal companion creation permission (BHR-F4-04, spec 29 REQ-PET-109..111, spec 52 DC-07).
 *
 * Rule under test (PF2e remaster, written here, not read from the pack): the Animal
 * Companion feat (Druid or Ranger) grants ONE animal companion and the Beastmaster
 * Dedication grants ONE more; the cap is the number of grants, counted on the server.
 * A character with no grant gets none, a mount is never created by a player, and the GM
 * skips the check. Each companion keeps the `grantSlotId` of the Plan slot that made it.
 *
 * Runs on the REAL doc:create handler (boot()). The feats are the real feats-core
 * documents: the pack supplies only the item identity (`flags.fusion.sourceId`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { DocumentStore } from "../documents/store.js";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-companion-animal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  outsiderUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "companion_animal_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  // Plain PLAYER: owns the master, must be able to create/delete its familiar.
  const { user: owner } = await authService.createUser({
    name: "OwnerPlayer",
    role: Role.PLAYER,
    password: "owner-pass",
  });
  // A second player who does NOT own the master — used to prove a companion
  // pointing at someone else's master is rejected.
  const { user: outsider } = await authService.createUser({
    name: "OutsiderPlayer",
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

  const reservedPort = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: reservedPort, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Companion Animal World",
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
    outsiderUserId: outsider.id,
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
// Fixtures
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FEATS = resolve(
  __dirname,
  "../../../../external/fusion-systems-2e/systems/pf2e/packs/feats-core/documents.json",
);

function featItem(name: string, id: string): Record<string, unknown> {
  const docs = JSON.parse(readFileSync(FEATS, "utf-8")) as Array<Record<string, unknown>>;
  const found = docs.find((d) => d["name"] === name && d["type"] === "feat");
  if (!found) throw new Error(`feat ${name} missing from feats-core`);
  return { ...found, _id: id };
}

const FAMILIAR_FEAT: Record<string, unknown> = {
  _id: "feat-familiar",
  name: "Familiar",
  type: "feat",
  system: { rules: [] },
};

/** `level` is explicit test data, never a player's record. */
function character(
  ownerId: string,
  name: string,
  level: number,
  items: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    name,
    type: "character",
    system: { details: { level: { value: level } } },
    ownership: { default: 0, [ownerId]: 3 },
    items,
  };
}

function companionPayload(
  masterId: string,
  kind: string,
  name: string,
  grantSlotId?: string,
): Record<string, unknown> {
  const system: Record<string, unknown> = { companionKind: kind, masterActorId: masterId };
  if (grantSlotId !== undefined) {
    system["companion"] = { typeSlug: "bear", stage: "young", grantSlotId, active: true };
  }
  return { name, type: "familiar", system };
}

type Ack = Record<string, unknown>;

function firstDoc(ack: Ack): Record<string, unknown> {
  return (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Animal companion creation permission (BHR-F4-04)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let outsiderSocket: ClientSocket;
  let rangerId = ""; // 1 grant (Animal Companion, Ranger)
  let dedicatedId = ""; // 2 grants (Animal Companion + Beastmaster Dedication)
  let batchId = ""; // 1 grant, used for the in-batch cap
  let wizardId = ""; // familiar feat only
  let matureOnlyId = ""; // upgrade feat only
  let slotCheckId = ""; // 2 grants, slot checks
  let gmCapId = ""; // 1 grant, GM bypass

  async function createAs(socket: ClientSocket, data: Record<string, unknown>[]): Promise<Ack> {
    return sendOp(socket, "doc:create", { documentType: "Actor", data });
  }

  async function createMaster(doc: Record<string, unknown>): Promise<string> {
    const ack = await createAs(gm, [doc]);
    expect(ack["ok"]).toBe(true);
    return firstDoc(ack)["_id"] as string;
  }

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
    const animal = (id: string) => featItem("Animal Companion (Ranger)", id);
    const dedication = (id: string) => featItem("Beastmaster Dedication", id);
    rangerId = await createMaster(character(ctx.ownerUserId, "Ranger1", 1, [animal("ac1")]));
    dedicatedId = await createMaster(
      character(ctx.ownerUserId, "Ranger2", 2, [animal("ac1"), dedication("bd1")]),
    );
    batchId = await createMaster(character(ctx.ownerUserId, "Batch", 1, [animal("ac1")]));
    wizardId = await createMaster(character(ctx.ownerUserId, "Wizard", 1, [FAMILIAR_FEAT]));
    matureOnlyId = await createMaster(
      character(ctx.ownerUserId, "MatureOnly", 4, [
        featItem("Mature Animal Companion (Ranger)", "mc1"),
      ]),
    );
    slotCheckId = await createMaster(
      character(ctx.ownerUserId, "Slots", 2, [animal("ac1"), dedication("bd1")]),
    );
    gmCapId = await createMaster(character(ctx.ownerUserId, "GmCap", 1, [animal("ac1")]));
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await teardown(ctx);
  });

  it("level 1 (one grant): the first companion is created and keeps its grantSlotId, the second is refused", async () => {
    const first = await createAs(ownerSocket, [
      companionPayload(rangerId, "animalCompanion", "Urso A", "slot-animal"),
    ]);
    expect(first["ok"]).toBe(true);
    const system = firstDoc(first)["system"] as Record<string, unknown>;
    expect(system["companionKind"]).toBe("animalCompanion");
    expect((system["companion"] as Record<string, unknown>)["grantSlotId"]).toBe("slot-animal");
    expect(firstDoc(first)["ownership"]).toEqual({ default: 0, [ctx.ownerUserId]: 3 });

    const second = await createAs(ownerSocket, [
      companionPayload(rangerId, "animalCompanion", "Urso B", "slot-other"),
    ]);
    expect(second["ok"]).toBe(false);
    expect(second["code"]).toBe("VALIDATION_FAILED");
  });

  it("level 2 (Animal Companion + Dedication): two are created, the third is refused", async () => {
    const a = await createAs(ownerSocket, [
      companionPayload(dedicatedId, "animalCompanion", "Urso", "slot-animal"),
    ]);
    expect(a["ok"]).toBe(true);
    const b = await createAs(ownerSocket, [
      companionPayload(dedicatedId, "animalCompanion", "Antilope", "slot-dedication"),
    ]);
    expect(b["ok"]).toBe(true);
    const c = await createAs(ownerSocket, [
      companionPayload(dedicatedId, "animalCompanion", "Terceiro", "slot-extra"),
    ]);
    expect(c["ok"]).toBe(false);
    expect(c["code"]).toBe("VALIDATION_FAILED");
  });

  it("a character with no grant is refused (familiar feat only, or an upgrade feat only)", async () => {
    for (const masterId of [wizardId, matureOnlyId]) {
      const ack = await createAs(ownerSocket, [
        companionPayload(masterId, "animalCompanion", "Sem concessao", "slot-x"),
      ]);
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    }
  });

  it("a player who does not own the master is refused", async () => {
    const ack = await createAs(outsiderSocket, [
      companionPayload(slotCheckId, "animalCompanion", "Roubado", "slot-theft"),
    ]);
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("mount stays refused to a player even with every grant", async () => {
    const ack = await createAs(ownerSocket, [
      companionPayload(dedicatedId, "mount", "Montaria", "slot-mount"),
    ]);
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("two companions in ONE batch cannot exceed the cap; the whole batch is refused", async () => {
    const ack = await createAs(ownerSocket, [
      companionPayload(batchId, "animalCompanion", "Gemeo 1", "slot-b1"),
      companionPayload(batchId, "animalCompanion", "Gemeo 2", "slot-b2"),
    ]);
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    const ok = await createAs(ownerSocket, [
      companionPayload(batchId, "animalCompanion", "Unico", "slot-b1"),
    ]);
    expect(ok["ok"]).toBe(true);
  });

  it("an animal companion needs the grantSlotId of the slot that creates it", async () => {
    const ack = await createAs(ownerSocket, [
      companionPayload(slotCheckId, "animalCompanion", "Sem slot"),
    ]);
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("one slot creates one companion: a repeated grantSlotId is refused even under the cap", async () => {
    const a = await createAs(ownerSocket, [
      companionPayload(slotCheckId, "animalCompanion", "Primeiro", "slot-same"),
    ]);
    expect(a["ok"]).toBe(true);
    const b = await createAs(ownerSocket, [
      companionPayload(slotCheckId, "animalCompanion", "Repetido", "slot-same"),
    ]);
    expect(b["ok"]).toBe(false);
    expect(b["code"]).toBe("VALIDATION_FAILED");
  });

  it("an animal companion and a familiar are separate groups", async () => {
    const both = await createMaster(
      character(ctx.ownerUserId, "Both", 1, [featItem("Animal Companion", "ac9"), FAMILIAR_FEAT]),
    );
    const animal = await createAs(ownerSocket, [
      companionPayload(both, "animalCompanion", "Lobo", "slot-wolf"),
    ]);
    expect(animal["ok"]).toBe(true);
    const familiar = await createAs(ownerSocket, [companionPayload(both, "familiar", "Rato")]);
    expect(familiar["ok"]).toBe(true);
  });

  // I-6 (onda 4): the link fields are written at creation; an owner cannot rewrite them through doc:update
  // (it would free a slot, turn a pet into a mount, or void the unique slot).
  describe("doc:update does not rewrite the companion link", () => {
    let petId = "";
    let otherMasterId = "";
    beforeAll(async () => {
      const master = await createMaster(
        character(ctx.ownerUserId, "LinkMaster", 1, [featItem("Animal Companion (Ranger)", "ac1")]),
      );
      otherMasterId = await createMaster(character(ctx.ownerUserId, "OtherMaster", 1, []));
      const ack = await createAs(ownerSocket, [
        companionPayload(master, "animalCompanion", "Urso Link", "slot-link"),
      ]);
      expect(ack["ok"]).toBe(true);
      petId = firstDoc(ack)["_id"] as string;
    });

    const version = (): number => {
      const store = new DocumentStore({ db: ctx.fusionDb.raw, coreVersion: "0.1.0" });
      return (store.get("actors", petId)["_stats"] as { version: number }).version;
    };
    const update = (socket: ClientSocket, diff: Record<string, unknown>): Promise<Ack> =>
      sendOp(socket, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: petId, diff, expectedVersion: version() }],
      });

    it("the owner is refused on companionKind, masterActorId and grantSlotId, by dot path and by object", async () => {
      const attempts: Record<string, unknown>[] = [
        { "system.companionKind": "mount" },
        { system: { companionKind: "mount" } },
        { "system.masterActorId": otherMasterId },
        { system: { masterActorId: otherMasterId } },
        { "system.companion.grantSlotId": "slot-stolen" },
        { system: { companion: { grantSlotId: "slot-stolen" } } },
        { "system.companion": { typeSlug: "bear", grantSlotId: "slot-stolen" } },
      ];
      for (const diff of attempts) {
        const ack = await update(ownerSocket, diff);
        expect(ack["ok"], JSON.stringify(diff)).toBe(false);
        expect(ack["code"], JSON.stringify(diff)).toBe("PERMISSION_DENIED");
      }
    });

    it("the owner still edits unrelated fields of the companion", async () => {
      const ack = await update(ownerSocket, { name: "Urso Renomeado" });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    });

    it("the GM may rewrite the link", async () => {
      const ack = await update(gm, { "system.masterActorId": otherMasterId });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    });
  });

  // DEC-BHR-10 / DC-07 (fix onda 5): one ACTIVE companion per master. The server decides, never the client
  // (the payload below forges `active: true` on both).
  it("only one animal companion is active: the first is born active, the next one inactive, the first stays active", async () => {
    const master = await createMaster(
      character(ctx.ownerUserId, "TwoGrants", 2, [
        featItem("Animal Companion (Ranger)", "ac1"),
        featItem("Beastmaster Dedication", "bd1"),
      ]),
    );
    const activeOf = (doc: Record<string, unknown>): unknown =>
      ((doc["system"] as Record<string, unknown>)["companion"] as Record<string, unknown>)["active"];
    const first = await createAs(ownerSocket, [
      companionPayload(master, "animalCompanion", "Urso", "slot-1"),
    ]);
    expect(first["ok"]).toBe(true);
    expect(activeOf(firstDoc(first))).toBe(true);
    const second = await createAs(ownerSocket, [
      companionPayload(master, "animalCompanion", "Antilope", "slot-2"),
    ]);
    expect(second["ok"]).toBe(true);
    expect(activeOf(firstDoc(second))).toBe(false);
    const store = new DocumentStore({ db: ctx.fusionDb.raw, coreVersion: "0.1.0" });
    expect(activeOf(store.get("actors", firstDoc(first)["_id"] as string))).toBe(true);
    expect(activeOf(store.get("actors", firstDoc(second)["_id"] as string))).toBe(false);
  });

  it("the GM skips the grant and the cap", async () => {
    for (const name of ["G1", "G2", "G3"]) {
      const ack = await createAs(gm, [companionPayload(gmCapId, "animalCompanion", name)]);
      expect(ack["ok"]).toBe(true);
    }
  });
});
