/**
 * The sheet door obeys the SAME server rules the sheet picker obeys (G095).
 *
 * Spec: 43-aba-compendio.md §5.7 / DEC-CPD-05 — REQ-CPD-061 (whoever has
 * `OWNER` of an actor brings a COMPATIBLE entry to that actor's sheet, and the
 * server executes it), REQ-CPD-064 (a repeat is never refused for being a
 * repeat), REQ-CPD-073 (sheet needs `OWNER` of the destination, not a role);
 * 18-sistema-sf2e.md — REQ-SF2-024 / CA-SF2-05 (at most 4 non-apex
 * augmentations installed on one actor).
 *
 * WHAT THIS FILE LOCKS DOWN, AND WHY IT IS NOT COVERED BY
 * compendium-import-to-actor.test.ts: `compendium:importToActor` writes into
 * the very same `Actor.items[]` array that `doc:create` with
 * `parent={type:"Actor"}` writes into — and DEC-CPD-05 hands that door to a
 * PLAIN PLAYER, because the predicate there is ownership of the destination,
 * not the caller's role. The rationale in the decision is explicit that this
 * must not become a second rulebook for the same gesture ("proibir na aba
 * criaria duas regras para o mesmo gesto"). A door that skipped the server
 * rules would be the cheapest way around them: a player who cannot install a
 * 5th augmentation through his own sheet could install it from the shelf.
 *
 * WHY THE PAYLOAD, NOT THE SCREEN: every assertion reads the ack the PLAYER's
 * own socket receives, plus the actor as PERSISTED in the world db. A greyed
 * button would satisfy nothing here (REQ-CPD-074).
 *
 * WHY A FIXTURE PACK: the committed `sf2e.augmentations-core` stores its
 * augmentations as `type: "equipment"` (see systems/sf2e/src/schemas/
 * item-augmentation.ts for the delta against the real compendium data), so no
 * committed pack can exercise the slot limit at all. The pack written here is
 * OUR OWN content (CC0, no Paizo text), served through the real
 * `netContext.packsDir` boot path — the server code under test is untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { sf2eSystem } from "@fusion/system-sf2e";
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Fixture pack — our own documents, CC0, generated into a temp packs root.
// ---------------------------------------------------------------------------

const PACK_ID = "sf2e.sheet-rules-fixture";

/** Six non-apex augmentations: two more than REQ-SF2-024 allows installed. */
const NON_APEX_IDS = ["augA", "augB", "augC", "augD", "augE", "augF"];
/** An apex augmentation — never counts toward the limit (REQ-SF2-024). */
const APEX_ID = "augApex";
/** A `type` the sf2e manifest does not declare — no data model can accept it. */
const UNDECLARED_TYPE_ID = "notAType";

function uuidOf(docId: string): string {
  return `Compendium.${PACK_ID}.Item.${docId}`;
}

function writeFixturePack(packsRoot: string): void {
  const packDir = join(packsRoot, "sheet-rules-fixture");
  mkdirSync(packDir, { recursive: true });

  const documents = [
    ...NON_APEX_IDS.map((id, i) => ({
      _id: id,
      name: `Fixture Augmentation ${String(i + 1)}`,
      type: "augmentation",
      system: { augType: "tech", level: { value: 1 } },
    })),
    {
      _id: APEX_ID,
      name: "Fixture Apex Augmentation",
      type: "augmentation",
      system: { augType: "apex", isApex: true, level: { value: 9 } },
    },
    {
      _id: UNDECLARED_TYPE_ID,
      name: "Fixture Nonsense",
      type: "quantumSprocket",
      system: {},
    },
  ];

  writeFileSync(
    join(packDir, "pack.json"),
    JSON.stringify({
      id: PACK_ID,
      label: "Sheet Rules Fixture",
      documentType: "Item",
      systemId: "sf2e",
      indexFields: [],
      license: {
        license: "CC0",
        attribution: "Fusion test fixture — original content",
        reservedNotice: "",
      },
      audience: "all",
      source: { repo: null, version: null, importerVersion: "0.0.0-test" },
      documentCount: documents.length,
      generatedAt: "2026-08-16T00:00:00.000Z",
      schemaVersion: 1,
    }),
    "utf8",
  );
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(documents), "utf8");
}

/**
 * A character whose abilities carry NO `mod`. The sf2e/pf2e ability step
 * mirrors the computed modifier onto `system.abilities.<x>.mod` as an internal
 * cache — a field the canonical recompute derives on a CLONE and never
 * persists. Authoring the actor without it is what makes the leak visible.
 */
function makeCharacterData(name: string, playerId: string): Record<string, unknown> {
  return {
    name,
    type: "character",
    ownership: { default: OwnershipLevel.NONE, [playerId]: OwnershipLevel.OWNER },
    system: {
      systemVersion: "0.1.0",
      level: { value: 5 },
      abilities: {
        str: { value: 18 },
        dex: { value: 16 },
        con: { value: 14 },
        int: { value: 10 },
        wis: { value: 12 },
        cha: { value: 8 },
      },
      attributes: {
        hp: { value: 75, max: 75, temp: 0 },
        ac: { value: 10 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: { fortitude: { rank: 2 }, reflex: { rank: 1 }, will: { rank: 2 } },
      perception: { rank: 2, senses: [] },
      skills: { athletics: { rank: 2 } },
      proficiencies: {
        classDC: { rank: 2 },
        weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
        armor: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level: 5 },
      traits: { rarity: "common", value: [], size: "med" },
    },
  };
}

// ---------------------------------------------------------------------------
// Infrastructure (mirrors compendium-import-to-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cmp-sheet-rules-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Ctx {
  dataDir: string;
  packsRoot: string;
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
  const worldId = "cmp_sheet_rules_world";

  // Packs root OUTSIDE the git worktree (temp dir of the OS), like every other
  // data dir in this suite.
  const packsRoot = join(dataDir, "packs");
  mkdirSync(packsRoot, { recursive: true });
  writeFixturePack(packsRoot);

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
      worldTitle: "Compendium Sheet Rules World",
      worldSystemId: "sf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
      systemId: "sf2e",
      systemModule: sf2eSystem,
      packsDir: packsRoot,
    },
  });

  return {
    dataDir,
    packsRoot,
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

interface ImportResult {
  actorId: string;
  created: string[];
  failed: Array<{ uuid: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("the sheet door runs the same embedded-Item rules as doc:create", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  /** Destination of the slot-limit batch. */
  let slotActorId: string;
  /** Destination of the derivation checks. */
  let deriveActorId: string;
  /** Destination of the undeclared-type check. */
  let typeActorId: string;

  function readActor(actorId: string): Record<string, unknown> {
    const store = new DocumentStore({ db: ctx.fusionDb.raw });
    return store.get("actors", actorId);
  }

  function readItems(actorId: string): Record<string, unknown>[] {
    const items = readActor(actorId)["items"];
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  }

  function countNonApexAugmentations(actorId: string): number {
    return readItems(actorId).filter((item) => {
      if (item["type"] !== "augmentation") return false;
      const sys = item["system"] as { isApex?: unknown } | undefined;
      return sys?.isApex !== true;
    }).length;
  }

  async function createOwnedActor(name: string): Promise<string> {
    const ack = await send(gm, "op", "doc:create", {
      documentType: "Actor",
      data: [makeCharacterData(name, ctx.playerId)],
    });
    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    return docs[0]!["_id"] as string;
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await waitForConnect(gm);
    await waitForConnect(player);

    slotActorId = await createOwnedActor("Slot Limit Sheet");
    deriveActorId = await createOwnedActor("Derivation Sheet");
    typeActorId = await createOwnedActor("Type Check Sheet");
  }, 120_000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // The cross-item business rule: SF2e's augmentation slot limit
  // -------------------------------------------------------------------------

  it("REQ-SF2-024 / REQ-CPD-061: a player's batch of six augmentations installs at most four", async () => {
    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: NON_APEX_IDS.map(uuidOf),
      actorId: slotActorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as ImportResult;

    // Four in, two refused — and the refusal names the limit, not the sheet.
    expect(result.created).toHaveLength(4);
    expect(result.failed).toHaveLength(2);
    for (const entry of result.failed) {
      expect(entry.reason).toContain("sf2e.augmentation.slotLimit");
    }

    // The persisted sheet is the ground truth: the limit held on disk.
    expect(countNonApexAugmentations(slotActorId)).toBe(4);
  });

  it("REQ-SF2-024: an apex augmentation still comes in with the four regular slots full", async () => {
    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [uuidOf(APEX_ID)],
      actorId: slotActorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as ImportResult;
    expect(result.created).toHaveLength(1);
    expect(result.failed).toEqual([]);
    // Apex never counts (REQ-SF2-024), so the regular tally is untouched.
    expect(countNonApexAugmentations(slotActorId)).toBe(4);
  });

  it("REQ-CPD-064 / REQ-SF2-024: what refuses a fifth is the limit, and the two doors agree", async () => {
    const shelf = await send(player, "op", "compendium:importToActor", {
      uuids: [uuidOf(NON_APEX_IDS[0]!)],
      actorId: slotActorId,
    });
    expect(shelf["ok"]).toBe(true);
    const shelfResult = shelf["result"] as ImportResult;
    expect(shelfResult.created).toEqual([]);
    expect(shelfResult.failed[0]?.reason).toContain("sf2e.augmentation.slotLimit");

    // The sheet picker's own door — doc:create with an Actor parent — refuses
    // the SAME fifth augmentation. Independently derived answer: this is the
    // pre-existing production path, not the code under test.
    const picker = await send(player, "op", "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: slotActorId },
      data: [
        {
          name: "Hand-added Augmentation",
          type: "augmentation",
          system: { augType: "tech", level: { value: 1 } },
        },
      ],
    });
    expect(picker["ok"]).toBe(false);
    expect(picker["code"]).toBe("VALIDATION_FAILED");
    expect(String(picker["message"])).toContain("sf2e.augmentation.slotLimit");

    expect(countNonApexAugmentations(slotActorId)).toBe(4);
  });

  // -------------------------------------------------------------------------
  // The per-item shape: the system's data model
  // -------------------------------------------------------------------------

  it("REQ-CPD-061: an entry whose type the system does not declare is refused per uuid", async () => {
    const before = readItems(typeActorId).length;

    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [uuidOf(UNDECLARED_TYPE_ID), uuidOf(NON_APEX_IDS[0]!)],
      actorId: typeActorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as ImportResult;

    // The undeclared type fails; the compatible entry in the same batch still
    // comes in — one bad uuid never sinks the batch (REQ-CPD-065).
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.uuid).toBe(uuidOf(UNDECLARED_TYPE_ID));
    expect(result.failed[0]?.reason).toContain("quantumSprocket");
    expect(result.created).toHaveLength(1);

    const items = readItems(typeActorId);
    expect(items).toHaveLength(before + 1);
    expect(items.some((item) => item["type"] === "quantumSprocket")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The recompute: derived is refreshed, the derivation's cache fields are not
  // persisted (r24 S2 — the sheet import is player-triggered, so any leak here
  // is a leak a player writes)
  // -------------------------------------------------------------------------

  it("REQ-CPD-061: the import refreshes system.derived without persisting the derivation's cache fields", async () => {
    const abilitiesBefore = (readActor(deriveActorId)["system"] as Record<string, unknown>)[
      "abilities"
    ] as Record<string, Record<string, unknown>>;
    // Precondition: nothing has written the cached modifier yet.
    expect(abilitiesBefore["str"]?.["mod"]).toBeUndefined();

    const ack = await send(player, "op", "compendium:importToActor", {
      uuids: [uuidOf(NON_APEX_IDS[0]!)],
      actorId: deriveActorId,
    });
    expect(ack["ok"]).toBe(true);

    const system = readActor(deriveActorId)["system"] as Record<string, unknown>;

    // The recompute ran: the sheet has fresh derived values to render.
    const derived = system["derived"] as Record<string, unknown> | undefined;
    expect(derived).toBeDefined();
    expect((derived?.["ac"] as { total?: number } | undefined)?.total).toBeDefined();

    // ...and only `system.derived` was written. `abilities.<x>.mod` is an
    // internal cache the DeriveSteps write on the working copy; persisting the
    // whole mutated `system` would smuggle it into the db.
    const abilities = system["abilities"] as Record<string, Record<string, unknown>>;
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      expect(abilities[ability]?.["mod"]).toBeUndefined();
    }
  });
});
