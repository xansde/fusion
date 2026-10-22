/**
 * action-bar-flags-socket.test.ts — `flags.fusion.actionBar` on `doc:update` / `doc:create`, over a
 * real socket (BAR-F3-05 for `icons`; BAR-F3-01 stacks the favourites on the same file).
 *
 *  - REQ-BAR-072: a player writes the icons of an actor he OWNS, and only those — the server refuses
 *    the write on anyone else's actor with PERMISSION_DENIED, whatever the shape of the diff.
 *  - REQ-BAR-073: the Mestre writes the icons of any actor.
 *  - REQ-BAR-068/069, CA-BAR-09: the RESULTING object (stored value + expanded diff) must pass
 *    `ActionBarFlagsSchema` — one icon-area path per value, at most 64 entries — for every role, on
 *    update and on create, so a partial diff cannot grow a valid map past the cap.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { DocumentStore } from "../documents/store.js";
import { PERMISSIONS_SETTING_KEY } from "../documents/world-permissions.js";
import {
  PROTOCOL_VERSION,
  ACTION_BAR_FAVORITES_FLAG_PATH,
  ACTION_BAR_ICON_AREA,
  ACTION_BAR_ICON_CAP,
  ACTION_BAR_SEEDED_FLAG_PATH,
  ACTION_BAR_SLOT_COUNT,
  actionBarFavoritesPatch,
  actionBarIconPatch,
} from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const OWN_ID = "ownActor00000001";
const OTHER_ID = "otherActor000001";
const LEGACY_ID = "legacyActor00001";
const NPC_ID = "npcLimited000001";

const ICON_A = `/assets/${ACTION_BAR_ICON_AREA}/hanabi-1a2b3c4d.png`;
const ICON_B = `/assets/${ACTION_BAR_ICON_AREA}/arco-eletrico-5e6f7a8b.webp`;

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  store: DocumentStore;
  port: number;
  worldId: string;
  gmToken: string;
  p1Token: string;
  p2Token: string;
  trustedToken: string;
  p1Id: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-action-bar-flags-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-action-bar-flags-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: p1 } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: p2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });
  const { user: t1 } = await authService.createUser({
    name: "Trusted1",
    role: Role.TRUSTED,
    password: "trusted1-pass",
  });
  const login = async (userId: string, password: string): Promise<string> =>
    (await authService.login({ userId, password, ip: "127.0.0.1" })).accessToken;

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const author = { userId: gm.id };
  // p1 owns OWN_ID; OTHER_ID is p2's character, which p1 can SEE (observer) but does not own.
  store.create(
    "actors",
    { _id: OWN_ID, name: "Heroi", type: "character", ownership: { default: 2, [p1.id]: 3 } },
    author,
  );
  store.create(
    "actors",
    { _id: OTHER_ID, name: "Outro", type: "character", ownership: { default: 2, [p2.id]: 3 } },
    author,
  );
  // An NPC every player can see as LIMITED, and nobody owns.
  store.create(
    "actors",
    { _id: NPC_ID, name: "Vilao", type: "npc", ownership: { default: 1 } },
    author,
  );
  // An actor whose STORED bar state predates the schema (hand-edited or legacy): 70 icons.
  const legacyIcons: Record<string, string> = {};
  for (let i = 0; i < 70; i++) legacyIcons[`strike:legado-${String(i)}`] = ICON_A;
  store.create(
    "actors",
    {
      _id: LEGACY_ID,
      name: "Legado",
      type: "character",
      ownership: { default: 2, [p1.id]: 3 },
      flags: { fusion: { actionBar: { icons: legacyIcons } } },
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Action Bar Flags World", systemId: "stub" },
  });
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    store,
    port: listeningPort(fastify),
    worldId,
    gmToken: await login(gm.id, gmPw),
    p1Token: await login(p1.id, "player1-pass"),
    p2Token: await login(p2.id, "player2-pass"),
    trustedToken: await login(t1.id, "trusted1-pass"),
    p1Id: p1.id,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connect(port: number, worldId: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 15_000);
  });
}

function sendOp(socket: ClientSocket, type: string, payload: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Record<string, unknown>);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

function iconMap(count: number, prefix = "golpe"): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < count; i++) map[`strike:${prefix}-${String(i)}`] = ICON_A;
  return map;
}

describe("flags.fusion.actionBar on doc:update and doc:create (BAR-F3-05)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let p1: ClientSocket;
  let p2: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    [gm, p1, p2] = await Promise.all([
      connect(ctx.port, ctx.worldId, ctx.gmToken),
      connect(ctx.port, ctx.worldId, ctx.p1Token),
      connect(ctx.port, ctx.worldId, ctx.p2Token),
    ]);
  }, 20_000);

  afterEach(async () => {
    gm.disconnect();
    p1.disconnect();
    p2.disconnect();
    await teardown(ctx);
  });

  const update = (socket: ClientSocket, actorId: string, diff: Record<string, unknown>) => {
    const stats = ctx.store.get("actors", actorId)["_stats"] as { version: number };
    return sendOp(socket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff, expectedVersion: stats.version }],
    });
  };
  const storedIcons = (actorId: string): Record<string, unknown> | undefined => {
    const doc = ctx.store.get("actors", actorId) as {
      flags?: { fusion?: { actionBar?: { icons?: Record<string, unknown> } } };
    };
    return doc.flags?.fusion?.actionBar?.icons;
  };

  // ---------------------------------------------------------------- who may write (REQ-BAR-072/073)

  it("the owner sets and restores the icon of an entry of his own character", async () => {
    const set = await update(p1, OWN_ID, actionBarIconPatch("strike:long.sword", ICON_A));
    expect(set["ok"], JSON.stringify(set)).toBe(true);
    const second = await update(p1, OWN_ID, actionBarIconPatch("spell:heal", ICON_B));
    expect(second["ok"], JSON.stringify(second)).toBe(true);
    expect(storedIcons(OWN_ID)).toEqual({ "strike:long.sword": ICON_A, "spell:heal": ICON_B });

    // "Restaurar ícone padrão": null removes that entry and only that entry.
    const restore = await update(p1, OWN_ID, actionBarIconPatch("strike:long.sword", null));
    expect(restore["ok"], JSON.stringify(restore)).toBe(true);
    expect(storedIcons(OWN_ID)).toEqual({ "spell:heal": ICON_B });
  });

  it("a player cannot write icons on a character he only observes — by any diff shape (negative)", async () => {
    const diffs: Record<string, unknown>[] = [
      actionBarIconPatch("strike:longsword", ICON_A),
      { "flags.fusion.actionBar.icons.strike:longsword": ICON_A },
      { "flags.fusion.actionBar": { icons: { "strike:longsword": ICON_A } } },
      { flags: { fusion: { actionBar: { icons: { "strike:longsword": ICON_A } } } } },
      { "flags.fusion.actionBar.icons": null },
    ];
    for (const diff of diffs) {
      const ack = await update(p1, OTHER_ID, diff);
      expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    }
    expect(storedIcons(OTHER_ID)).toBeUndefined();
  });

  it("a player cannot restore (delete) an icon of someone else's character either", async () => {
    const seeded = await update(gm, OTHER_ID, actionBarIconPatch("strike:longsword", ICON_A));
    expect(seeded["ok"], JSON.stringify(seeded)).toBe(true);
    const ack = await update(p1, OTHER_ID, actionBarIconPatch("strike:longsword", null));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(storedIcons(OTHER_ID)).toEqual({ "strike:longsword": ICON_A });
  });

  it("the Mestre changes the icons of any actor (REQ-BAR-073)", async () => {
    const a = await update(gm, OTHER_ID, actionBarIconPatch("strike:longsword", ICON_B));
    expect(a["ok"], JSON.stringify(a)).toBe(true);
    const b = await update(gm, OWN_ID, actionBarIconPatch("action:grapple", ICON_A));
    expect(b["ok"], JSON.stringify(b)).toBe(true);
    expect(storedIcons(OTHER_ID)).toEqual({ "strike:longsword": ICON_B });
    expect(storedIcons(OWN_ID)).toEqual({ "action:grapple": ICON_A });
  });

  it("ownership is the gate for every non-privileged role: LIMITED NPC and a TRUSTED player (negative)", async () => {
    const trusted = await connect(ctx.port, ctx.worldId, ctx.trustedToken);
    try {
      const cases: Array<[ClientSocket, string]> = [
        [p1, NPC_ID],
        [trusted, OWN_ID],
        [trusted, NPC_ID],
      ];
      for (const [socket, actorId] of cases) {
        for (const diff of [
          actionBarIconPatch("strike:claw", ICON_A),
          { flags: { fusion: { actionBar: { icons: { "strike:claw": ICON_A } } } } },
        ]) {
          const ack = await update(socket, actorId, diff);
          expect(ack, `${actorId} ${JSON.stringify(diff)}`).toMatchObject({
            ok: false,
            code: "PERMISSION_DENIED",
          });
        }
        expect(storedIcons(actorId), actorId).toBeUndefined();
      }
    } finally {
      trusted.disconnect();
    }
  });

  it("the other player keeps writing his own, and is refused on p1's", async () => {
    const own = await update(p2, OTHER_ID, actionBarIconPatch("strike:bow", ICON_B));
    expect(own["ok"], JSON.stringify(own)).toBe(true);
    const foreign = await update(p2, OWN_ID, actionBarIconPatch("strike:bow", ICON_B));
    expect(foreign).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  // ------------------------------------------------------------- what may be written (CA-BAR-09)

  it("refuses an icon value that is not one icon-area path, for the owner AND for the Mestre", async () => {
    const forged = [
      "https://evil.example/x.png",
      "//evil.example/x.png",
      "actionbar-icons/x.png",
      `/assets/${ACTION_BAR_ICON_AREA}/../segredo.png`,
      `/assets/${ACTION_BAR_ICON_AREA}/%2e%2e%2fsegredo.png`,
      "/assets/mapa-secreto-1a2b3c4d.png",
      `${ICON_A} ${ICON_B}`,
    ];
    for (const value of forged) {
      for (const socket of [p1, gm]) {
        const ack = await update(socket, OWN_ID, actionBarIconPatch("strike:longsword", value));
        expect(ack, value).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      }
    }
    expect(storedIcons(OWN_ID)).toBeUndefined();
  });

  it("the cap holds on the RESULT: 64 pass, a 65th entry by a later partial diff is refused", async () => {
    const full = await update(p1, OWN_ID, {
      "flags.fusion.actionBar.icons": iconMap(ACTION_BAR_ICON_CAP),
    });
    expect(full["ok"], JSON.stringify(full)).toBe(true);
    expect(Object.keys(storedIcons(OWN_ID) ?? {})).toHaveLength(ACTION_BAR_ICON_CAP);

    const oneMore = await update(p1, OWN_ID, actionBarIconPatch("spell:extra", ICON_B));
    expect(oneMore).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(Object.keys(storedIcons(OWN_ID) ?? {})).toHaveLength(ACTION_BAR_ICON_CAP);

    // Replacing one entry keeps the count, and is fine.
    const swap = await update(p1, OWN_ID, actionBarIconPatch("strike:golpe-0", ICON_B));
    expect(swap["ok"], JSON.stringify(swap)).toBe(true);
  });

  it("a batch naming the same actor twice is refused whole: the cap cannot be split across entries", async () => {
    // Adversarial review, finding 2: the pre-flight judged every entry against the same stored
    // snapshot, so three entries of 64 icons each for ONE actor passed one by one and stored 192.
    const version = (ctx.store.get("actors", OWN_ID)["_stats"] as { version: number }).version;
    const entry = (prefix: string) => ({
      _id: OWN_ID,
      diff: { "flags.fusion.actionBar.icons": iconMap(ACTION_BAR_ICON_CAP, prefix) },
      expectedVersion: version,
    });
    for (const socket of [p1, gm]) {
      const ack = await sendOp(socket, "doc:update", {
        documentType: "Actor",
        updates: [entry("a"), entry("b"), entry("c")],
      });
      expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
    expect(storedIcons(OWN_ID)).toBeUndefined();

    // Control: one entry per document is still a batch the server takes.
    const other = (ctx.store.get("actors", OTHER_ID)["_stats"] as { version: number }).version;
    const ok = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        { _id: OWN_ID, diff: actionBarIconPatch("strike:a", ICON_A), expectedVersion: version },
        { _id: OTHER_ID, diff: actionBarIconPatch("strike:b", ICON_B), expectedVersion: other },
      ],
    });
    expect(ok["ok"], JSON.stringify(ok)).toBe(true);
    expect(storedIcons(OWN_ID)).toEqual({ "strike:a": ICON_A });
    expect(storedIcons(OTHER_ID)).toEqual({ "strike:b": ICON_B });
  });

  it("refuses 5000 icons in one write, from the owner and from the Mestre", async () => {
    for (const socket of [p1, gm]) {
      const ack = await update(socket, OWN_ID, { "flags.fusion.actionBar.icons": iconMap(5000) });
      expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
    expect(storedIcons(OWN_ID)).toBeUndefined();
  });

  it("refuses an unknown field, a bad favourites list and a bar that is not an object", async () => {
    const diffs: Record<string, unknown>[] = [
      { "flags.fusion.actionBar.outra": 1 },
      { "flags.fusion.actionBar.favorites": Array.from({ length: 13 }, () => null) },
      { "flags.fusion.actionBar.seeded": "sim" },
      { "flags.fusion.actionBar": "tudo" },
      { "flags.fusion.actionBar.icons": { "nao-e-id": ICON_A } },
    ];
    for (const diff of diffs) {
      const ack = await update(p1, OWN_ID, diff);
      expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
  });

  it("does not freeze an actor whose stored bar is already invalid: unrelated writes still pass", async () => {
    const ack = await update(p1, LEGACY_ID, { name: "Legado renomeado" });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    // …but touching the bar must bring it back under the cap.
    const touch = await update(p1, LEGACY_ID, actionBarIconPatch("spell:novo", ICON_B));
    expect(touch).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    // Clearing the whole map is always allowed.
    const clear = await update(p1, LEGACY_ID, { "flags.fusion.actionBar.icons": null });
    expect(clear["ok"], JSON.stringify(clear)).toBe(true);
    expect(storedIcons(LEGACY_ID)).toBeUndefined();
  });

  // ------------------------------------------------------------------------------- the create door

  it("doc:create refuses an Actor born with an invalid bar, and accepts a valid one", async () => {
    const bad = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Nascido torto",
          type: "character",
          flags: { fusion: { actionBar: { icons: iconMap(ACTION_BAR_ICON_CAP + 1) } } },
        },
      ],
    });
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(ctx.store.getAll("actors").some((a) => a["name"] === "Nascido torto")).toBe(false);

    const good = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Nascido certo",
          type: "character",
          flags: { fusion: { actionBar: { icons: { "strike:longsword": ICON_A } } } },
        },
      ],
    });
    expect(good["ok"], JSON.stringify(good)).toBe(true);
  });

  it("a batch with one invalid Actor creates none of them (judged before anything is written)", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        { name: "Primeiro valido", type: "character" },
        {
          name: "Segundo torto",
          type: "character",
          flags: { fusion: { actionBar: { icons: { "strike:a": "https://evil.example/x.png" } } } },
        },
      ],
    });
    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    const names = ctx.store.getAll("actors").map((a) => a["name"]);
    expect(names).not.toContain("Primeiro valido");
    expect(names).not.toContain("Segundo torto");
  });

  it("when the Mestre opens Actor creation to players, a player's create is held to the same schema", async () => {
    ctx.store.create(
      "settings",
      { key: PERMISSIONS_SETTING_KEY, value: { ACTOR_CREATE: Role.PLAYER } },
      { userId: ctx.p1Id },
    );
    const bad = await sendOp(p1, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Do jogador",
          type: "character",
          flags: { fusion: { actionBar: { icons: iconMap(5000) } } },
        },
      ],
    });
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });

    const good = await sendOp(p1, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Do jogador ok", type: "character" }],
    });
    expect(good["ok"], JSON.stringify(good)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// BAR-F3-01 — the favourites row and the seeded flag, on the same two doors
// ---------------------------------------------------------------------------------------------------

describe("flags.fusion.actionBar favourites on doc:update and doc:create (BAR-F3-01)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let p1: ClientSocket;
  let p2: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    [gm, p1, p2] = await Promise.all([
      connect(ctx.port, ctx.worldId, ctx.gmToken),
      connect(ctx.port, ctx.worldId, ctx.p1Token),
      connect(ctx.port, ctx.worldId, ctx.p2Token),
    ]);
  }, 20_000);

  afterEach(async () => {
    gm.disconnect();
    p1.disconnect();
    p2.disconnect();
    await teardown(ctx);
  });

  const versionOf = (actorId: string): number =>
    (ctx.store.get("actors", actorId)["_stats"] as { version: number }).version;

  /** `expectedVersion` defaults to the stored one at the moment of the call; `null` leaves it out. */
  const write = (
    socket: ClientSocket,
    actorId: string,
    diff: Record<string, unknown>,
    expectedVersion: number | null = versionOf(actorId),
  ) =>
    sendOp(socket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: actorId,
          diff,
          ...(expectedVersion === null ? {} : { expectedVersion }),
        },
      ],
    });

  const storedBar = (actorId: string): Record<string, unknown> | undefined => {
    const doc = ctx.store.get("actors", actorId) as {
      flags?: { fusion?: { actionBar?: Record<string, unknown> } };
    };
    return doc.flags?.fusion?.actionBar;
  };

  /** A row of 12: the given ids from the first slot on, `null` for the rest. */
  const row = (...ids: Array<string | null>): Array<string | null> =>
    Array.from({ length: ACTION_BAR_SLOT_COUNT }, (_, index) => ids[index] ?? null);

  // ----------------------------------------------------------- who may write (REQ-BAR-061, D-BA01)

  it("the owner writes the row and the seeded flag of his own character, exactly as the client sends them", async () => {
    const favorites = row("strike:longsword", "spell:main:heal", null, "action:seek");

    const ack = await write(p1, OWN_ID, actionBarFavoritesPatch(favorites));

    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(storedBar(OWN_ID)).toEqual({ favorites, seeded: true });
  });

  it("the Mestre writes the row of any actor, and a later write replaces the row whole (arrays are replaced, not merged)", async () => {
    const first = await write(gm, OTHER_ID, actionBarFavoritesPatch(row("strike:a", "strike:b")));
    expect(first["ok"], JSON.stringify(first)).toBe(true);

    const second = await write(gm, OTHER_ID, actionBarFavoritesPatch(row(null, null, "strike:c")));

    expect(second["ok"], JSON.stringify(second)).toBe(true);
    expect(storedBar(OTHER_ID)).toEqual({ favorites: row(null, null, "strike:c"), seeded: true });
  });

  it("the row and the icons are siblings: writing the row keeps the icon map, and the other way round", async () => {
    await write(p1, OWN_ID, actionBarIconPatch("strike:longsword", ICON_A));

    await write(p1, OWN_ID, actionBarFavoritesPatch(row("strike:longsword")));
    expect(storedBar(OWN_ID)).toEqual({
      favorites: row("strike:longsword"),
      seeded: true,
      icons: { "strike:longsword": ICON_A },
    });

    await write(p1, OWN_ID, actionBarIconPatch("spell:heal", ICON_B));
    expect(storedBar(OWN_ID)).toEqual({
      favorites: row("strike:longsword"),
      seeded: true,
      icons: { "strike:longsword": ICON_A, "spell:heal": ICON_B },
    });
  });

  it("a player cannot write favourites or the seeded flag on a character he only observes — by any diff shape (negative, D-BA01)", async () => {
    const diffs: Record<string, unknown>[] = [
      actionBarFavoritesPatch(row("strike:roubado")),
      { [ACTION_BAR_FAVORITES_FLAG_PATH]: row("strike:roubado") },
      { [ACTION_BAR_SEEDED_FLAG_PATH]: true },
      {
        "flags.fusion.actionBar": { favorites: row("strike:roubado"), seeded: true },
      },
      { flags: { fusion: { actionBar: { favorites: row("strike:roubado"), seeded: true } } } },
      { [ACTION_BAR_FAVORITES_FLAG_PATH]: null },
    ];
    for (const diff of diffs) {
      const ack = await write(p1, OTHER_ID, diff);
      expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    }
    expect(storedBar(OTHER_ID)).toBeUndefined();
  });

  it("…and cannot wipe or un-seed a row the owner already has: the other player's favourites stand", async () => {
    const mine = row("strike:do-p2", "spell:do-p2");
    const seeded = await write(p2, OTHER_ID, actionBarFavoritesPatch(mine));
    expect(seeded["ok"], JSON.stringify(seeded)).toBe(true);

    const wipe = await write(p1, OTHER_ID, actionBarFavoritesPatch(row()));
    const unseed = await write(p1, OTHER_ID, { [ACTION_BAR_SEEDED_FLAG_PATH]: false });

    expect(wipe).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(unseed).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(storedBar(OTHER_ID)).toEqual({ favorites: mine, seeded: true });
  });

  it("ownership is the gate for every non-privileged role: a LIMITED NPC and a TRUSTED player (negative)", async () => {
    const trusted = await connect(ctx.port, ctx.worldId, ctx.trustedToken);
    try {
      const cases: Array<[ClientSocket, string]> = [
        [p1, NPC_ID],
        [trusted, OWN_ID],
        [trusted, NPC_ID],
      ];
      for (const [socket, actorId] of cases) {
        const ack = await write(socket, actorId, actionBarFavoritesPatch(row("strike:claw")));
        expect(ack, actorId).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
        expect(storedBar(actorId), actorId).toBeUndefined();
      }
    } finally {
      trusted.disconnect();
    }
  });

  it("a player's batch with his own actor AND someone else's is refused whole: his own row is not written either", async () => {
    const ack = await sendOp(p1, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: OWN_ID,
          diff: actionBarFavoritesPatch(row("strike:meu")),
          expectedVersion: versionOf(OWN_ID),
        },
        {
          _id: OTHER_ID,
          diff: actionBarFavoritesPatch(row("strike:dele")),
          expectedVersion: versionOf(OTHER_ID),
        },
      ],
    });

    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(storedBar(OWN_ID)).toBeUndefined();
    expect(storedBar(OTHER_ID)).toBeUndefined();
  });

  // --------------------------------------------------- what may be written (REQ-BAR-062, CA-BAR-09)

  it("refuses a row that is not 12 positions of ids-or-null, for the owner AND for the Mestre", async () => {
    const bad: Array<[string, unknown]> = [
      ["11 positions", row().slice(1)],
      ["13 positions", [...row(), null]],
      ["empty list", []],
      ["malformed id", row("strike:ok", "isto não é um id")],
      ["unknown kind", row("macro:x")],
      ["origin too long", row(`spell:${"a".repeat(121)}`)],
      ["a number in a slot", row("strike:ok", 7 as unknown as string)],
      ["not a list", "strike:x"],
      ["an object", { "0": "strike:x" }],
    ];
    for (const [what, favorites] of bad) {
      for (const socket of [p1, gm]) {
        const ack = await write(socket, OWN_ID, {
          [ACTION_BAR_FAVORITES_FLAG_PATH]: favorites,
          [ACTION_BAR_SEEDED_FLAG_PATH]: true,
        });
        expect(ack, what).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      }
    }
    expect(storedBar(OWN_ID)).toBeUndefined();
  });

  it("refuses a seeded flag that is not a boolean, and a field the bar does not have", async () => {
    for (const diff of [
      { [ACTION_BAR_SEEDED_FLAG_PATH]: "sim" },
      { [ACTION_BAR_SEEDED_FLAG_PATH]: 1 },
      { "flags.fusion.actionBar.hotbar": row("strike:x") },
      { "flags.fusion.actionBar.favourites": row("strike:x") },
    ]) {
      const ack = await write(p1, OWN_ID, diff);
      expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
    expect(storedBar(OWN_ID)).toBeUndefined();
  });

  it("a diff on one INDEX of the row turns the array into an object once merged: the RESULT is invalid, so it is refused and the stored row stays", async () => {
    const stored = row("strike:a", "strike:b", "strike:c");
    await write(p1, OWN_ID, actionBarFavoritesPatch(stored));

    const ack = await write(p1, OWN_ID, { "flags.fusion.actionBar.favorites.3": "strike:novo" });

    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(storedBar(OWN_ID)).toEqual({ favorites: stored, seeded: true });
  });

  it("a partial diff that is fine alone but makes the RESULT invalid is refused (the bar is judged whole)", async () => {
    // The stored bar has icons; a diff that only adds a 13-position row makes the resulting object
    // invalid even though `icons` itself is untouched and valid.
    await write(p1, OWN_ID, actionBarIconPatch("strike:longsword", ICON_A));

    const ack = await write(p1, OWN_ID, {
      [ACTION_BAR_FAVORITES_FLAG_PATH]: [...row("strike:x"), null],
    });

    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(storedBar(OWN_ID)).toEqual({ icons: { "strike:longsword": ICON_A } });
  });

  it("a stored bar that predates the schema (here: an 11-position row) does not freeze the actor, and a good row heals it", async () => {
    ctx.store.update(
      "actors",
      OWN_ID,
      { flags: { fusion: { actionBar: { favorites: row().slice(1), seeded: true } } } },
      { userId: ctx.p1Id },
    );

    const unrelated = await write(p1, OWN_ID, { name: "Heroi renomeado" });
    expect(unrelated["ok"], JSON.stringify(unrelated)).toBe(true);

    const healed = await write(p1, OWN_ID, actionBarFavoritesPatch(row("strike:a")));
    expect(healed["ok"], JSON.stringify(healed)).toBe(true);
    expect(storedBar(OWN_ID)).toEqual({ favorites: row("strike:a"), seeded: true });
  });

  // -------------------------------------------------- the version lock (REQ-BAR-063, DEC-NET-05)

  it("a player's write without expectedVersion is refused: the lock cannot be skipped by the one who needs it", async () => {
    const ack = await write(p1, OWN_ID, actionBarFavoritesPatch(row("strike:a")), null);

    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(storedBar(OWN_ID)).toBeUndefined();
  });

  it("a write on an old version is STALE_WRITE and changes nothing — not even for the Mestre, when he sends the version", async () => {
    const seen = versionOf(OWN_ID);
    await write(p1, OWN_ID, actionBarFavoritesPatch(row("strike:do-outro-aparelho")));

    const stalePlayer = await write(p1, OWN_ID, actionBarFavoritesPatch(row("strike:velho")), seen);
    const staleGm = await write(gm, OWN_ID, actionBarFavoritesPatch(row("strike:velho")), seen);

    expect(stalePlayer).toMatchObject({ ok: false, code: "STALE_WRITE" });
    expect(staleGm).toMatchObject({ ok: false, code: "STALE_WRITE" });
    expect(storedBar(OWN_ID)).toEqual({
      favorites: row("strike:do-outro-aparelho"),
      seeded: true,
    });
  });

  it("redoing a stale pin on the FRESH document keeps the other device's pin (nothing is overwritten)", async () => {
    // Device A and device B both saw version V of an empty row. A pins X.
    const seenByBoth = versionOf(OWN_ID);
    const a = await write(p1, OWN_ID, actionBarFavoritesPatch(row("strike:x")), seenByBoth);
    expect(a["ok"], JSON.stringify(a)).toBe(true);

    // B pins Y on the old version: refused. B re-reads the document and redoes the pin on it.
    const b = await write(gm, OWN_ID, actionBarFavoritesPatch(row("strike:y")), seenByBoth);
    expect(b).toMatchObject({ ok: false, code: "STALE_WRITE" });
    const fresh = storedBar(OWN_ID)?.["favorites"] as Array<string | null>;
    const redone = [...fresh];
    redone[redone.indexOf(null)] = "strike:y";
    const again = await write(gm, OWN_ID, actionBarFavoritesPatch(redone));

    expect(again["ok"], JSON.stringify(again)).toBe(true);
    expect(storedBar(OWN_ID)).toEqual({ favorites: row("strike:x", "strike:y"), seeded: true });
  });

  it("two devices seeding the same actor at the same instant (player and Mestre): exactly one seed is stored, the other gets STALE_WRITE", async () => {
    const seen = versionOf(OWN_ID);
    const playerSeed = row("strike:do-jogador", "spell:main:heal");
    const gmSeed = row("strike:do-mestre", "action:seek");

    const [byPlayer, byGm] = await Promise.all([
      write(p1, OWN_ID, actionBarFavoritesPatch(playerSeed), seen),
      write(gm, OWN_ID, actionBarFavoritesPatch(gmSeed), seen),
    ]);

    const winners = [byPlayer, byGm].filter((ack) => ack["ok"] === true);
    const losers = [byPlayer, byGm].filter((ack) => ack["ok"] !== true);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ ok: false, code: "STALE_WRITE" });
    const winnerSeed = byPlayer["ok"] === true ? playerSeed : gmSeed;
    expect(storedBar(OWN_ID)).toEqual({ favorites: winnerSeed, seeded: true });
    expect(versionOf(OWN_ID)).toBe(seen + 1);
  });

  // ------------------------------------------------------------------------------- the create door

  it("doc:create refuses an Actor born with a bad row or a bad seeded flag, and accepts a good one", async () => {
    for (const actionBar of [
      { favorites: [...row(), null] },
      { favorites: row("não é id") },
      { seeded: "sim" },
    ]) {
      const bad = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [{ name: "Nascido torto", type: "character", flags: { fusion: { actionBar } } }],
      });
      expect(bad, JSON.stringify(actionBar)).toMatchObject({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
    expect(ctx.store.getAll("actors").some((a) => a["name"] === "Nascido torto")).toBe(false);

    const good = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Nascido certo",
          type: "character",
          flags: { fusion: { actionBar: { favorites: row("strike:a"), seeded: true } } },
        },
      ],
    });
    expect(good["ok"], JSON.stringify(good)).toBe(true);
  });

  it("when the Mestre opens Actor creation to players, a player cannot create an Actor with a bad row either", async () => {
    ctx.store.create(
      "settings",
      { key: PERMISSIONS_SETTING_KEY, value: { ACTOR_CREATE: Role.PLAYER } },
      { userId: ctx.p1Id },
    );

    const bad = await sendOp(p1, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Do jogador torto",
          type: "character",
          flags: { fusion: { actionBar: { favorites: [...row(), "strike:a"] } } },
        },
      ],
    });

    expect(bad).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(ctx.store.getAll("actors").some((a) => a["name"] === "Do jogador torto")).toBe(false);
  });
});
