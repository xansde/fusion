/**
 * T025 — asset authorisation: mint (`POST /api/assets/grant`) and serve
 * (`GET /assets/*`).
 *
 * ---------------------------------------------------------------------------
 * HOW TO READ THIS FILE
 * ---------------------------------------------------------------------------
 *
 * Every `it()` here is named after an ATTACK that actually killed a proposal
 * during this task's design rounds, or after a REGRESSION one of those
 * proposals would have shipped. They are not coverage: each one is a specific
 * claim about the gate that someone got wrong first.
 *
 * The suite is deliberately written against the REAL Fastify routes via
 * `inject()` — never against the helper functions on their own — because three
 * of the killed designs were correct in their helpers and wrong in the seam
 * between the two ends (a name canonicalised one way at the mint and another
 * way at the serve). A unit test of `canonicalizeAssetName` cannot see that
 * class of defect at all.
 *
 * No port is bound anywhere: `fastify.inject()` drives the real router without
 * a socket, so nothing in here can collide with another test file.
 *
 * MUTATION-TESTED. Each block below was confirmed to FAIL when the defence it
 * covers is removed from production; the pairs are recorded in the PR report.
 * A test that stays green with the defence deleted is proving nothing, and this
 * repo has shipped 80 of those before (#48).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

import { openDatabase, applyMigrations } from "../../db/index.js";
import { AuthService } from "../../auth/service.js";
import { Role } from "../../auth/user-store.js";
import { UserRole, OwnershipLevel } from "../../documents/ownership.js";
import { loadOrCreateSecret } from "../../auth/crypto.js";
import { registerAuthRoutes } from "../../auth/routes.js";
import { registerAssetRoutes } from "../routes.js";
import { canonicalizeAssetName } from "../asset-name.js";
import {
  lp,
  signDocGrant,
  signBrowseGrant,
  SCOPE_TAG,
  ASSET_GRANT_TTL_MS,
} from "../asset-grant.js";
import { ASSET_FIELD_PATHS, projectAssetFields, projectedAssetRefs } from "../asset-fields.js";
import { assetRefToStorageName } from "../reconcile.js";
import { ASSET_NAME_CANONICALIZATION_CASES, KnowledgeState } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A 1x1 PNG — real magic bytes, so `guessMime` and the browser agree. */
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
    "0000000c4944415408d763f8cfc0000000020001e221bc330000000049454e44ae426082",
  "hex",
);

/**
 * Names deliberately chosen to break a naive encoder: a space, parentheses
 * (which `encodeURIComponent` does NOT escape), an apostrophe, a literal `%`,
 * accented characters, and the same basename in two directories.
 */
const DISK_FILES = [
  "mapa.png",
  "MAPA.PNG",
  "segredo.jpg",
  "maps/segredo.jpg",
  "a b.png",
  "mapa (1).jpg",
  "Ação-Ébano.png",
  "cofre'do'GM.png",
  "100% real.png",
  "sub/dir/goblin.png",
  "fundo-da-cena.png",
  "retrato.png",
  "taverna-demo.jpg",
] as const;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Ctx {
  dataDir: string;
  assetsDir: string;
  fastify: FastifyInstance;
  db: Database;
  secret: Uint8Array;
  gm: { id: string; token: string };
  trusted: { id: string; token: string };
  player: { id: string; token: string };
  otherPlayer: { id: string; token: string };
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-t025-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const NOW = 1_700_000_000_000;

/**
 * Insert one document row directly.
 *
 * Only the NOT NULL columns without a default are named, so this stays correct
 * across migrations that add or drop the denormalised mirror columns — as
 * migration 008 did when it dropped `scenes.active` (the on-air flag lives in
 * the JSON, which is the only copy the server reads).
 */
function insertDoc(db: Database, table: string, id: string, data: Record<string, unknown>): void {
  const json = JSON.stringify({ _id: id, ...data });
  const name = String(data["name"] ?? id);
  const type = String(data["type"] ?? "npc");

  switch (table) {
    case "scenes":
    case "region_maps":
      db.prepare(
        `INSERT INTO ${table} (id, data, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, json, name, NOW, NOW);
      return;
    case "actors":
    case "items":
    case "folders":
      db.prepare(
        `INSERT INTO ${table} (id, data, name, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, json, name, type, NOW, NOW);
      return;
    case "combats":
      db.prepare(`INSERT INTO combats (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
        id,
        json,
        NOW,
        NOW,
      );
      return;
    default:
      throw new Error(`insertDoc: unsupported table ${table}`);
  }
}

async function buildCtx(grantEnforce = true): Promise<Ctx> {
  const dataDir = makeTempDir();
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  for (const name of DISK_FILES) {
    const target = join(assetsDir, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, PNG_BYTES);
  }

  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  const handle = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(handle.raw, dbPath);
  const authService = new AuthService(handle.raw, secret, "t025-world");

  const { user: gmUser, password: gmPass } = await authService.bootstrapGm();
  const { user: trustedUser } = await authService.createUser({
    name: "Trusted",
    role: Role.TRUSTED,
    password: "t-pass",
  });
  const { user: playerUser } = await authService.createUser({
    name: "Tobias",
    role: Role.PLAYER,
    password: "p-pass",
  });
  const { user: otherUser } = await authService.createUser({
    name: "Outro",
    role: Role.PLAYER,
    password: "o-pass",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: "t025-world", title: "T025", systemId: "stub" },
  });
  registerAssetRoutes(fastify, {
    authService,
    assetsDir,
    secret,
    db: handle.raw,
    grantEnforce,
  });
  await fastify.ready();

  async function login(id: string, password: string): Promise<string> {
    const resp = await fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: id, password },
    });
    return (resp.json() as { accessToken: string }).accessToken;
  }

  return {
    dataDir,
    assetsDir,
    fastify,
    db: handle.raw,
    secret,
    gm: { id: gmUser.id, token: await login(gmUser.id, gmPass) },
    trusted: { id: trustedUser.id, token: await login(trustedUser.id, "t-pass") },
    player: { id: playerUser.id, token: await login(playerUser.id, "p-pass") },
    otherPlayer: { id: otherUser.id, token: await login(otherUser.id, "o-pass") },
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface GrantResponse {
  ok: boolean;
  exp: number;
  grants: Record<string, string>;
}

async function mint(
  ctx: Ctx,
  token: string,
  table: string,
  id: string,
): Promise<{ status: number; body: GrantResponse }> {
  const resp = await ctx.fastify.inject({
    method: "POST",
    url: "/api/assets/grant",
    headers: { authorization: `Bearer ${token}` },
    payload: { table, id },
  });
  return { status: resp.statusCode, body: resp.json() as GrantResponse };
}

/** `/assets/<name>` with each segment percent-encoded, exactly like the client. */
function assetPath(name: string): string {
  return `/assets/${name.split("/").map(encodeURIComponent).join("/")}`;
}

interface ServeOptions {
  bearer?: string;
  at?: string;
  ae?: number;
  au?: string;
  /** Bypass the per-segment encoder — for raw traversal spellings. */
  rawPath?: string;
}

function serve(ctx: Ctx, name: string, options: ServeOptions) {
  const base = options.rawPath ?? assetPath(name);
  const params = new URLSearchParams();
  if (options.at !== undefined) params.set("at", options.at);
  if (options.ae !== undefined) params.set("ae", String(options.ae));
  if (options.au !== undefined) params.set("au", options.au);
  const url = params.toString().length > 0 ? `${base}?${params.toString()}` : base;
  return ctx.fastify.inject({
    method: "GET",
    url,
    ...(options.bearer !== undefined
      ? { headers: { authorization: `Bearer ${options.bearer}` } }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * ONE context for the whole file, on purpose.
 *
 * Building it means hashing four passwords with the real KDF, which costs
 * seconds; doing that per test pushed this single file past a minute and a half
 * of CI wall-clock for no isolation gain. Every test below seeds its own
 * document ids and asserts only about those, so they do not observe each other.
 * The one test that removes a file from disk puts it back.
 */
let ctx: Ctx;
const tempDirs: string[] = [];

beforeAll(async () => {
  ctx = await buildCtx();
  tempDirs.push(ctx.dataDir);
});

afterAll(async () => {
  await ctx.fastify.close();
  ctx.db.close();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold the sqlite file; the OS reaps the temp dir */
    }
  }
});

// ===========================================================================
// Against "write it, then read it" (dead rounds 1 and 2; attack 1 vs `capacidade`)
// ===========================================================================

describe("grant — the mint never signs what the requester wrote", () => {
  it("does not sign free text: 500 filenames in a player's own biography yield ZERO grants", async () => {
    // `system` is a passthrough record and the player is OWNER of his own
    // sheet, so every one of these strings really is persisted verbatim.
    const biography = Array.from(
      { length: 500 },
      (_unused, i) => `<p>/assets/x-${String(i)}.jpg</p>`,
    ).join("");

    insertDoc(ctx.db, "actors", "actorFreeText001", {
      name: "Ficha do Tobias",
      type: "character",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
      system: { details: { biography, publicNotes: "/assets/fundo-da-cena.png" } },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "actorFreeText001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual([]);
  });

  it("a bearer FIELD the player controls yields exactly ONE grant, never a thousand", async () => {
    // The residual this design accepts by name (§4.1): a player who already
    // knows a filename can put it in `actors.img` and read it. The point of the
    // projection is that it costs him one write per name, not one write for a
    // thousand names. This test PINS the accepted hole so it can never quietly
    // grow back into the amplification.
    insertDoc(ctx.db, "actors", "actorSelfRef001", {
      name: "Ficha do Tobias",
      type: "character",
      img: "/assets/fundo-da-cena.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "actorSelfRef001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual(["fundo-da-cena.png"]);
  });

  it("500 names IN the bearer field itself still yield ZERO grants, not 500", async () => {
    // The one the adversarial review found, and the reason the previous test
    // was passing for the wrong reason: it put its 500 decoys in `biography`,
    // a field the projection excludes anyway, so it never exercised the field
    // whose name it carries. With the refs read out of the projection's TEXT,
    // `img` was a bulk oracle: measured against the real route, 5000 space-
    // separated refs in this ONE field returned 5000 grants and 398,932 bytes
    // in a single request — a dictionary attack per round-trip instead of per
    // write, on an endpoint with no rate limit.
    //
    // A bearer field holds ONE path. `projectedAssetRefs` matches the value
    // WHOLE, so a field carrying a LIST carries no reference at all.
    const many = Array.from({ length: 500 }, (_unused, i) => `/assets/x-${String(i)}.jpg`).join(
      " ",
    );

    insertDoc(ctx.db, "actors", "actorAmplify001", {
      name: "Ficha do Tobias",
      type: "character",
      img: many,
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "actorAmplify001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual([]);
  });

  it("a scene cannot be turned into a dictionary either: one texture, one name", async () => {
    // Same defence on the OTHER player-writable bearer (`tokens[].texture`,
    // writable via handleEmbeddedUpdate on a scene he does not own), where the
    // amplification would have been per token AND per token.
    insertDoc(ctx.db, "scenes", "sceneAmplify001", {
      name: "Taverna",
      active: true,
      background: "/assets/fundo-da-cena.png",
      tokens: [
        {
          _id: "tokGreedy",
          hidden: false,
          texture: Array.from({ length: 200 }, (_unused, i) => `/assets/y-${String(i)}.jpg`).join(
            " ",
          ),
        },
        { _id: "tokHonest", hidden: false, texture: "/assets/retrato.png" },
      ],
      walls: [],
      ownership: { default: OwnershipLevel.NONE },
    });

    const { body } = await mint(ctx, ctx.player.token, "scenes", "sceneAmplify001");
    expect(Object.keys(body.grants).sort()).toEqual(["fundo-da-cena.png", "retrato.png"]);
  });

  it("embedded items do NOT multiply the mint (actors.items[].img is out of the projection)", async () => {
    // Measured regression guard for §D3: a player can create embedded Items on
    // his own sheet with no batch cap and with `img` copied raw from his
    // payload. Including that path turned 1 grant into 501.
    const items = Array.from({ length: 500 }, (_unused, i) => ({
      _id: `item${String(i)}`,
      img: `/assets/loot-${String(i)}.png`,
    }));

    insertDoc(ctx.db, "actors", "actorEmbedded001", {
      name: "Ficha do Tobias",
      type: "character",
      img: "/assets/retrato.png",
      items,
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { body } = await mint(ctx, ctx.player.token, "actors", "actorEmbedded001");
    expect(Object.keys(body.grants)).toEqual(["retrato.png"]);
  });

  it("a player cannot deny the table: writing the scene's background on his own sheet changes nothing for anyone else", async () => {
    // Regression against the death-by-MINIMUM of the `indice` design, where a
    // player writing a name lowered its permission for the whole world.
    insertDoc(ctx.db, "scenes", "sceneOnAir001", {
      name: "Taverna",
      active: true,
      background: "/assets/fundo-da-cena.png",
      tokens: [],
      walls: [],
      ownership: { default: OwnershipLevel.NONE },
    });
    insertDoc(ctx.db, "actors", "actorPoison001", {
      name: "Ficha do Tobias",
      type: "character",
      img: "/assets/fundo-da-cena.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { body } = await mint(ctx, ctx.otherPlayer.token, "scenes", "sceneOnAir001");
    expect(Object.keys(body.grants)).toEqual(["fundo-da-cena.png"]);

    const resp = await serve(ctx, "fundo-da-cena.png", {
      at: body.grants["fundo-da-cena.png"],
      ae: body.exp,
      au: ctx.otherPlayer.id,
    });
    expect(resp.statusCode).toBe(200);
  });
});

// ===========================================================================
// Against the HMAC encoding (attack 2 vs `capacidade`)
// ===========================================================================

describe("grant — the signature encoding", () => {
  it("is length-prefixed, so no boundary between parts can be shifted", () => {
    // The collision this rules out is concrete: with a plain concatenation,
    // (user "u", exp 12, name "3x") and (user "u1", exp 23, name "x") both
    // produce the preimage "du123x" and therefore the same digest. Swap `lp`
    // for the identity function in asset-grant.ts and this line goes green
    // in the wrong direction.
    expect(signDocGrant("u", 12, "3x", ctx.secret)).not.toBe(
      signDocGrant("u1", 23, "x", ctx.secret),
    );
  });

  it("is injective where a NUL-joined encoding is not", () => {
    const naive = (parts: string[]): string => parts.join("\u0000");
    // The broken encoding, reproduced: one part containing the separator is
    // indistinguishable from two parts. And `%00` reaches the router decoded,
    // so this separator is attacker-supplied, not hypothetical.
    expect(naive(["a\u0000b"])).toBe(naive(["a", "b"]));
    expect(["a\u0000b"].map(lp).join("")).not.toBe(["a", "b"].map(lp).join(""));
  });

  it("separates the two scopes: a browse signature is never a doc signature", () => {
    expect(signBrowseGrant("u", 12, ctx.secret)).not.toBe(signDocGrant("u", 12, "", ctx.secret));
  });

  it("carries a scope TAG, and the tag is not the same byte for both scopes", () => {
    // The assertion above passes with the tags blanked — the length-prefix
    // alone separates a 3-part preimage from a 2-part one, verified by
    // mutation. So it does NOT cover the tag, and an uncovered constant is a
    // constant a refactor deletes as dead indirection right before someone
    // else "simplifies" `lp()` into a join with a separator. At that point a
    // browse token — which ANY player may mint — verifies on the doc branch,
    // and the doc branch checks no role at all.
    //
    // Blunt on purpose: it is the only assertion in this file that can die
    // with the tag, and it dies immediately.
    expect(SCOPE_TAG.doc).not.toBe(SCOPE_TAG.browse);
    expect(SCOPE_TAG.doc.length).toBeGreaterThan(0);
    expect(SCOPE_TAG.browse.length).toBeGreaterThan(0);
  });

  it("refuses a name carrying a NUL, rather than sanitising it", async () => {
    // `/assets/a.jpg%00b.jpg` survives the projection and comes out of
    // assetRefToStorageName with a real 0x00 inside — measured, not assumed.
    insertDoc(ctx.db, "actors", "actorNul001", {
      name: "Ficha",
      type: "character",
      img: "/assets/a.jpg%00b.jpg",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "actorNul001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("a.jpg");
  });

  it("refuses a dot segment, rather than resolving it", async () => {
    insertDoc(ctx.db, "actors", "actorDots001", {
      name: "Ficha",
      type: "character",
      img: "/assets/..%2F..%2Fworld.db",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "actorDots001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual([]);
  });

  it("refuses a WINDOWS traversal, which splitting on / alone let through", async () => {
    // Found by the adversarial review: a backslash path has no control
    // character and, split on `/`, is ONE segment that is neither `.` nor
    // `..` — so hygiene passed and the server SIGNED a traversal path. No
    // bytes escaped (guardPath refuses it on the way out, and the 400 it
    // produces is even distinguishable from the uniform 404), but this
    // module's stated contract is that a name needing repair is never signed,
    // and the GM's server runs on the one OS where the backslash IS the
    // separator.
    insertDoc(ctx.db, "actors", "actorBackslash001", {
      name: "Ficha",
      type: "character",
      img: "/assets/..%5C..%5Cworld.db",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "actorBackslash001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("world.db");
  });

  it("one poisoned name costs that name — never the whole document", async () => {
    // The other half of the fix: a document with a bad reference must still
    // hand over its good ones. The next block is why refusing in bulk was a
    // weapon rather than a precaution.
    insertDoc(ctx.db, "scenes", "sceneMixed001", {
      name: "Taverna",
      active: true,
      background: "/assets/fundo-da-cena.png",
      tokens: [
        { _id: "tokBad", hidden: false, texture: "/assets/x%00y.png" },
        { _id: "tokGood", hidden: false, texture: "/assets/retrato.png" },
      ],
      walls: [],
      ownership: { default: OwnershipLevel.NONE },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "scenes", "sceneMixed001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants).sort()).toEqual(["fundo-da-cena.png", "retrato.png"]);
  });
});

// ===========================================================================
// The denial of service the whole-document refusal was
// ===========================================================================

describe("grant — a player cannot blank the map for the table", () => {
  it("a poisoned token texture on the shared on-air scene does not deny anyone else", async () => {
    // The attack the adversarial review PROVED, and the reason hygiene stopped
    // refusing documents. `scenes.tokens[].texture` is a bearer field a PLAYER
    // can write (handleEmbeddedUpdate authorises by the ownership of the ACTOR
    // the token references, never by the scene's, and the patched token is
    // stored without schema validation). With a whole-document refusal, ONE
    // token carrying an empty-segment path turned every mint of the scene on
    // air into a 400 — for every player at once, and silently, because the GM
    // keeps his browse credential and sees nothing wrong.
    //
    // The `indice` design died for exactly this shape of hole; it came back in
    // through the hygiene check, and the test that was meant to catch it ("a
    // player cannot deny the table") poisoned the player's OWN sheet, which by
    // construction affects nobody.
    const poisons = ["/assets/a%00b.png", "/assets/x//y.png", "/assets/..%2Ffora.png"];

    for (const [index, poison] of poisons.entries()) {
      const sceneId = `sceneDos00${String(index)}`;
      insertDoc(ctx.db, "scenes", sceneId, {
        name: "Taverna",
        active: true,
        background: "/assets/fundo-da-cena.png",
        tokens: [
          // The attacker's token — one write, any spelling he likes.
          { _id: "tokAttacker", hidden: false, texture: poison },
          // The victim's token, and the map everyone needs.
          { _id: "tokVictim", hidden: false, texture: "/assets/retrato.png" },
        ],
        walls: [],
        ownership: { default: OwnershipLevel.NONE },
      });

      const victim = await mint(ctx, ctx.otherPlayer.token, "scenes", sceneId);
      expect(victim.status, `victim vs ${poison}`).toBe(200);
      expect(Object.keys(victim.body.grants).sort(), `victim vs ${poison}`).toEqual([
        "fundo-da-cena.png",
        "retrato.png",
      ]);

      // And the bytes really come back — the grant is not merely present.
      const resp = await serve(ctx, "fundo-da-cena.png", {
        at: victim.body.grants["fundo-da-cena.png"],
        ae: victim.body.exp,
        au: ctx.otherPlayer.id,
      });
      expect(resp.statusCode, `serve vs ${poison}`).toBe(200);
    }
  });
});

// ===========================================================================
// Against a choosable key (dead round 2, `indice`, `classe`)
// ===========================================================================

describe("serve — the key that authorises is the key that opens", () => {
  const SPELLINGS = [
    "a b.png",
    "mapa (1).jpg",
    "Ação-Ébano.png",
    "cofre'do'GM.png",
    "100% real.png",
    "sub/dir/goblin.png",
  ];

  it("decides the same for every equivalent spelling of a name", async () => {
    for (const name of SPELLINGS) {
      insertDoc(ctx.db, "actors", `spell-${name}`, {
        name,
        type: "npc",
        img: `/assets/${name.split("/").map(encodeURIComponent).join("/")}`,
        ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
      });

      const { body } = await mint(ctx, ctx.player.token, "actors", `spell-${name}`);
      const canonical = canonicalizeAssetName(name);
      expect(Object.keys(body.grants), `mint for ${name}`).toEqual([canonical]);

      const resp = await serve(ctx, name, {
        at: body.grants[canonical],
        ae: body.exp,
        au: ctx.player.id,
      });
      expect(resp.statusCode, `serve ${name}`).toBe(200);
    }
  });

  it("collapses an empty segment the same way at both ends (a//b === a/b)", async () => {
    insertDoc(ctx.db, "actors", "actorDouble001", {
      name: "Goblin",
      type: "npc",
      img: "/assets/sub/dir/goblin.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorDouble001");
    const token = body.grants["sub/dir/goblin.png"];

    const resp = await serve(ctx, "", {
      rawPath: "/assets/sub//dir/goblin.png",
      at: token,
      ae: body.exp,
      au: ctx.player.id,
    });
    expect(resp.statusCode).toBe(200);
  });

  it("does not treat the basename as the identity: segredo.jpg and maps/segredo.jpg are two files", async () => {
    // This is the finding that killed the `indice` design: a basename key puts
    // two different files in one bucket, and the GM's copy comes out.
    insertDoc(ctx.db, "actors", "actorRoot001", {
      name: "Raiz",
      type: "npc",
      img: "/assets/segredo.jpg",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorRoot001");
    const token = body.grants["segredo.jpg"];
    expect(token).toBeTypeOf("string");

    const own = await serve(ctx, "segredo.jpg", { at: token, ae: body.exp, au: ctx.player.id });
    expect(own.statusCode).toBe(200);

    const other = await serve(ctx, "maps/segredo.jpg", {
      bearer: ctx.player.token,
      at: token,
      ae: body.exp,
      au: ctx.player.id,
    });
    expect(other.statusCode).toBe(404);
    expect(other.rawPayload.equals(PNG_BYTES)).toBe(false);
  });

  it("never decodes twice", async () => {
    const attempts = ["/assets/%252e%252e/world.db", "/assets/..%2f..%2fworld.db", "/assets/%2e/"];
    for (const rawPath of attempts) {
      const resp = await serve(ctx, "", { rawPath, bearer: ctx.gm.token });
      expect([400, 404], rawPath).toContain(resp.statusCode);
      expect(resp.rawPayload.includes(Buffer.from("SQLite format")), rawPath).toBe(false);
    }
  });

  it("does not normalise case — even on Windows, where existsSync is case-insensitive", async () => {
    insertDoc(ctx.db, "actors", "actorCase001", {
      name: "Mapa",
      type: "npc",
      img: "/assets/mapa.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorCase001");
    const token = body.grants["mapa.png"];

    const exact = await serve(ctx, "mapa.png", { at: token, ae: body.exp, au: ctx.player.id });
    expect(exact.statusCode).toBe(200);

    const shouted = await serve(ctx, "MAPA.PNG", {
      bearer: ctx.player.token,
      at: token,
      ae: body.exp,
      au: ctx.player.id,
    });
    expect(shouted.statusCode).toBe(404);
  });

  it("a grant for one name does not open another — with no identity at all it is a 401", async () => {
    insertDoc(ctx.db, "actors", "actorOne001", {
      name: "Um",
      type: "npc",
      img: "/assets/mapa.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorOne001");
    const token = body.grants["mapa.png"];

    for (const target of ["segredo.jpg", "maps/segredo.jpg", "mapa.png/x"]) {
      const resp = await serve(ctx, target, { at: token, ae: body.exp, au: ctx.player.id });
      expect(resp.statusCode, target).toBe(401);
    }
  });

  it("a grant for one name does not open another — with a bearer identity it is the uniform 404", async () => {
    insertDoc(ctx.db, "actors", "actorOne002", {
      name: "Um",
      type: "npc",
      img: "/assets/mapa.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorOne002");

    const resp = await serve(ctx, "segredo.jpg", {
      bearer: ctx.player.token,
      at: body.grants["mapa.png"],
      ae: body.exp,
      au: ctx.player.id,
    });
    expect(resp.statusCode).toBe(404);
    expect(resp.json()).toMatchObject({ code: "ASSET_NOT_FOUND", error: "asset_not_found" });
  });

  it("a grant issued to one user does not travel to another", async () => {
    insertDoc(ctx.db, "actors", "actorMine001", {
      name: "Meu",
      type: "npc",
      img: "/assets/mapa.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorMine001");

    // The other player presents the grant claiming to be its owner.
    const stolen = await serve(ctx, "mapa.png", {
      bearer: ctx.otherPlayer.token,
      at: body.grants["mapa.png"],
      ae: body.exp,
      au: ctx.player.id,
    });
    expect(stolen.statusCode).toBe(404);
  });
});

// ===========================================================================
// Against the open door and against the blackout
// ===========================================================================

describe("serve — the hole this task closes", () => {
  it("a plain bearer token from a PLAYER opens nothing (the reproduced PoC)", async () => {
    const resp = await serve(ctx, "mapa.png", { bearer: ctx.player.token });
    expect(resp.statusCode).toBe(404);
    expect(resp.rawPayload.equals(PNG_BYTES)).toBe(false);
  });

  it("a plain bearer token from TRUSTED still browses (the file picker keeps working)", async () => {
    const resp = await serve(ctx, "mapa.png", { bearer: ctx.trusted.token });
    expect(resp.statusCode).toBe(200);
  });

  it("answers identically whether the file exists or not", async () => {
    // The refusal must not be a file-existence oracle. Same request, same user,
    // same name — the only thing that changes between the two calls is whether
    // the bytes are on disk.
    const filePath = join(ctx.assetsDir, "mapa.png");
    const present = await serve(ctx, "mapa.png", { bearer: ctx.player.token });
    unlinkSync(filePath);
    try {
      const absent = await serve(ctx, "mapa.png", { bearer: ctx.player.token });

      expect(present.statusCode).toBe(absent.statusCode);
      expect(present.rawPayload.equals(absent.rawPayload)).toBe(true);

      const strip = (headers: Record<string, unknown>): Record<string, unknown> => {
        const { date: _date, ...rest } = headers;
        return rest;
      };
      expect(strip(present.headers as Record<string, unknown>)).toEqual(
        strip(absent.headers as Record<string, unknown>),
      );
    } finally {
      // The context is shared across this file — put the file back.
      writeFileSync(filePath, PNG_BYTES);
    }
  });

  it("says at BOOT, once, that it is not enforcing — and does not say it when it is", async () => {
    // The state the server actually runs in has to be legible before a session
    // starts. `boot.ts` does not pass `grantEnforce`, and nothing sets
    // ASSET_GRANT_ENFORCE, so the DEFAULT the operator gets is shadow mode: the
    // PoC of this whole task is still reproducible until someone flips it. The
    // per-request warning is unreadable during play and invisible before it, so
    // this line is the one a human can be pointed at.
    //
    // This test does not endorse the default; it makes the default impossible
    // to be surprised by. Flipping it is a product decision.
    const lines: string[] = [];
    const stream = {
      write(chunk: string): void {
        lines.push(chunk);
      },
    };

    const dir = makeTempDir();
    tempDirs.push(dir);
    const app = Fastify({ logger: { level: "warn", stream } }) as unknown as FastifyInstance;
    registerAssetRoutes(app, {
      authService: {} as never,
      assetsDir: join(dir, "assets"),
      grantEnforce: false,
    });
    await app.ready();
    await app.close();

    const shadowLine = lines.filter((line) => line.includes("SHADOW MODE"));
    expect(shadowLine.length).toBe(1);
    expect(shadowLine[0]).toContain("ASSET_GRANT_ENFORCE");

    const enforcedLines: string[] = [];
    const enforcedApp = Fastify({
      logger: {
        level: "warn",
        stream: {
          write(chunk: string): void {
            enforcedLines.push(chunk);
          },
        },
      },
    }) as unknown as FastifyInstance;
    registerAssetRoutes(enforcedApp, {
      authService: {} as never,
      assetsDir: join(dir, "assets2"),
      grantEnforce: true,
    });
    await enforcedApp.ready();
    await enforcedApp.close();
    expect(enforcedLines.filter((line) => line.includes("SHADOW MODE"))).toEqual([]);
  });

  it("shadow mode logs the refusal and serves anyway", async () => {
    const shadow = await buildCtx(false);
    tempDirs.push(shadow.dataDir);
    try {
      const resp = await serve(shadow, "mapa.png", { bearer: shadow.player.token });
      expect(resp.statusCode).toBe(200);
      expect(resp.rawPayload.equals(PNG_BYTES)).toBe(true);
    } finally {
      await shadow.fastify.close();
      shadow.db.close();
    }
  });
});

// ===========================================================================
// Visibility — the mint reuses the snapshot's computation, never a new one
// ===========================================================================

describe("grant — visibility per table", () => {
  it("refuses a table outside its own allowlist with 400, and never with a default branch", async () => {
    for (const table of ["users", "settings", "chat_messages", "sqlite_master", "nao-existe"]) {
      const resp = await ctx.fastify.inject({
        method: "POST",
        url: "/api/assets/grant",
        headers: { authorization: `Bearer ${ctx.gm.token}` },
        payload: { table, id: "whatever" },
      });
      expect(resp.statusCode, table).toBe(400);
    }
  });

  it("answers a missing document and an invisible one with the SAME 404", async () => {
    insertDoc(ctx.db, "actors", "actorHidden001", {
      name: "Do Mestre",
      type: "npc",
      img: "/assets/segredo.jpg",
      ownership: { default: OwnershipLevel.NONE },
    });

    const invisible = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/grant",
      headers: { authorization: `Bearer ${ctx.player.token}` },
      payload: { table: "actors", id: "actorHidden001" },
    });
    const missing = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/grant",
      headers: { authorization: `Bearer ${ctx.player.token}` },
      payload: { table: "actors", id: "naoExisteNemUmPouco" },
    });

    expect(invisible.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(invisible.body).toBe(missing.body);
  });

  it("uses LIMITED as the threshold, exactly like buildSnapshot", async () => {
    // Pinned on `items` rather than on `actors`: Actors do NOT answer to
    // ownership alone (see the contact-knowledge block below), and pinning the
    // ownership threshold on a table that has a second rule on top of it is
    // how a test ends up passing for a reason unrelated to its name.
    insertDoc(ctx.db, "items", "itemLimited001", {
      name: "Compartilhado",
      type: "equipment",
      img: "/assets/retrato.png",
      ownership: { [ctx.player.id]: OwnershipLevel.LIMITED },
    });
    const { status, body } = await mint(ctx, ctx.player.token, "items", "itemLimited001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual(["retrato.png"]);

    insertDoc(ctx.db, "items", "itemNone001", {
      name: "Só do Mestre",
      type: "equipment",
      img: "/assets/retrato.png",
      ownership: { default: OwnershipLevel.NONE },
    });
    const denied = await mint(ctx, ctx.player.token, "items", "itemNone001");
    expect(denied.status).toBe(404);
  });

  it("region_maps follows the ownership INSIDE its data — the map on the real table", async () => {
    // The real world's only player-reaching surface: `{"default":2}` on a
    // region map. A role gate here would blank the minimap for the whole table.
    insertDoc(ctx.db, "region_maps", "regionShared001", {
      name: "Vale",
      image: "/assets/taverna-demo.jpg",
      ownership: { default: OwnershipLevel.OBSERVER },
      pins: [{ icon: "🔥", kind: "gm" }],
    });
    const shared = await mint(ctx, ctx.player.token, "region_maps", "regionShared001");
    expect(shared.status).toBe(200);
    expect(Object.keys(shared.body.grants)).toEqual(["taverna-demo.jpg"]);

    insertDoc(ctx.db, "region_maps", "regionSecret001", {
      name: "Covil",
      image: "/assets/segredo.jpg",
      ownership: { default: OwnershipLevel.NONE },
    });
    const secret = await mint(ctx, ctx.player.token, "region_maps", "regionSecret001");
    expect(secret.status).toBe(404);

    // And the GM keeps both.
    const gmSecret = await mint(ctx, ctx.gm.token, "region_maps", "regionSecret001");
    expect(gmSecret.status).toBe(200);
    expect(Object.keys(gmSecret.body.grants)).toEqual(["segredo.jpg"]);
  });

  it("a folder answers 200 with an empty grant map", async () => {
    // Rewritten from the design's case 16, which tested a folder ICON that does
    // not exist in FolderSchema. `folders` is in SNAPSHOT_TABLES and therefore
    // grantable; it simply carries no art.
    insertDoc(ctx.db, "folders", "folder001", {
      name: "Retratos",
      type: "Actor",
      ownership: { default: OwnershipLevel.OBSERVER },
    });
    const { status, body } = await mint(ctx, ctx.player.token, "folders", "folder001");
    expect(status).toBe(200);
    expect(body.grants).toEqual({});
  });

  it("a scene that is not on air yields no grant, for anyone but the GM", async () => {
    insertDoc(ctx.db, "scenes", "sceneOffAir001", {
      name: "Segredo",
      active: false,
      background: "/assets/segredo.jpg",
      tokens: [],
      walls: [],
      ownership: { default: OwnershipLevel.OWNER },
    });

    const player = await mint(ctx, ctx.player.token, "scenes", "sceneOffAir001");
    expect(player.status).toBe(404);

    const gm = await mint(ctx, ctx.gm.token, "scenes", "sceneOffAir001");
    expect(gm.status).toBe(200);
    expect(Object.keys(gm.body.grants)).toEqual(["segredo.jpg"]);
  });

  it("a hidden token's texture never reaches the mint of an on-air scene", async () => {
    insertDoc(ctx.db, "scenes", "sceneTokens001", {
      name: "Taverna",
      active: true,
      background: "/assets/fundo-da-cena.png",
      tokens: [
        { _id: "tokVisible", texture: "/assets/retrato.png", hidden: false },
        { _id: "tokHidden", texture: "/assets/segredo.jpg", hidden: true },
      ],
      walls: [{ _id: "w1", doorType: "secret", doorState: "closed" }],
      ownership: { default: OwnershipLevel.NONE },
    });

    const { body } = await mint(ctx, ctx.player.token, "scenes", "sceneTokens001");
    expect(Object.keys(body.grants).sort()).toEqual(["fundo-da-cena.png", "retrato.png"]);
    expect(JSON.stringify(body)).not.toContain("segredo.jpg");

    const gm = await mint(ctx, ctx.gm.token, "scenes", "sceneTokens001");
    expect(Object.keys(gm.body.grants).sort()).toEqual([
      "fundo-da-cena.png",
      "retrato.png",
      "segredo.jpg",
    ]);
  });

  it("a combat is visible to everyone, but a hidden combatant's art is not", async () => {
    insertDoc(ctx.db, "combats", "combat001", {
      combatants: [
        { _id: "c1", img: "/assets/retrato.png", hidden: false },
        { _id: "c2", img: "/assets/segredo.jpg", hidden: true },
      ],
      ownership: { default: OwnershipLevel.NONE },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "combats", "combat001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual(["retrato.png"]);

    const gm = await mint(ctx, ctx.gm.token, "combats", "combat001");
    expect(Object.keys(gm.body.grants).sort()).toEqual(["retrato.png", "segredo.jpg"]);
  });
});

// ===========================================================================
// Cost and state (attack 4, and the deaths of `indice`)
// ===========================================================================

// ===========================================================================
// Actors answer to the contact-knowledge funnel, not to ownership
// (both directions were wrong before the adversarial review)
// ===========================================================================

describe("grant — the Actor branch is redactActorDocsForViewer, and nothing else", () => {
  /**
   * A character owned by the player, so the viewer has an id knowledge can be
   * written about. `contactKnowledgeSourceFromDb` finds it by `type`, exactly
   * as `contactKnowledgeSourceFromStore` does on the socket paths.
   */
  const CHAR_ID = "charTobias001";

  beforeAll(() => {
    insertDoc(ctx.db, "actors", CHAR_ID, {
      name: "Tobias",
      type: "character",
      img: "/assets/retrato.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
  });

  it("does NOT sign the portrait of a contact the viewer has merely GLIMPSED", async () => {
    // THE LEAK. The snapshot delivers a glimpsed contact through
    // `glimpsedContactView`: no name, no title, no portrait (REQ-CTT-081).
    // Gating the mint on ownership alone signed that portrait's FILENAME —
    // usually the slug of the NPC — and then served its bytes. Proved by
    // execution with `grantEnforce: true`; the file came back 200.
    //
    // This channel did not exist before T025: the snapshot strips `img`, and
    // `GET /api/assets` needs TRUSTED. A gate that opens a door the thing it
    // replaces kept shut is not a gate.
    insertDoc(ctx.db, "actors", "contactGlimpsed001", {
      name: "O Vilão",
      type: "npc",
      img: "/assets/segredo.jpg",
      ownership: { default: OwnershipLevel.OBSERVER },
      flags: {
        fusion: {
          knowledge: {
            general: KnowledgeState.Hidden,
            exceptions: { [CHAR_ID]: KnowledgeState.Glimpsed },
          },
        },
      },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "contactGlimpsed001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("segredo.jpg");
  });

  it("answers 404 for a HIDDEN contact, however generous its ownership is", async () => {
    // Ownership says OBSERVER, knowledge says nothing — and the snapshot drops
    // the document entirely (REQ-CTT-082). An ownership-only mint answered 200
    // and signed the art, which confirms the actor exists to someone who holds
    // only a stale id.
    insertDoc(ctx.db, "actors", "contactHidden001", {
      name: "Ainda Secreto",
      type: "npc",
      img: "/assets/segredo.jpg",
      ownership: { default: OwnershipLevel.OBSERVER },
    });

    const { status } = await mint(ctx, ctx.player.token, "actors", "contactHidden001");
    expect(status).toBe(404);
  });

  it("DOES sign an identified contact whose ownership grants the player nothing", async () => {
    // The other direction, and it is a mesa-breaker rather than a leak: an
    // identified contact reaches the player through `stripKnowledgeMap` WITH
    // its `img`, and the rule is knowledge per contact×character (spec 39), not
    // ownership. An ownership gate answered 404 here and blanked every portrait
    // in the "Conhecidos" block of the contacts drawer, while the client had
    // the filename in its mirror all along.
    insertDoc(ctx.db, "actors", "contactKnown001", {
      name: "O Estalajadeiro",
      type: "npc",
      img: "/assets/retrato.png",
      ownership: { default: OwnershipLevel.NONE },
      flags: {
        fusion: {
          knowledge: {
            general: KnowledgeState.Hidden,
            exceptions: { [CHAR_ID]: KnowledgeState.Known },
          },
        },
      },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "contactKnown001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual(["retrato.png"]);
  });

  it("DOES sign another player's character, which ownership never grants", async () => {
    // `actorEscapingKnowledgeIsVisible` returns true for every character
    // unconditionally (REQ-CTT-014/020), and the live broadcast and the replay
    // apply that funnel with NO ownership filter — so the body, `img` included,
    // really is in this player's mirror. Refusing to sign it buys nothing (he
    // already has the filename) and empties the "Na mesa" row of the drawer.
    insertDoc(ctx.db, "actors", "charOutro001", {
      name: "Personagem do Outro",
      type: "character",
      img: "/assets/retrato.png",
      ownership: { [ctx.otherPlayer.id]: OwnershipLevel.OWNER, default: OwnershipLevel.NONE },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "actors", "charOutro001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toEqual(["retrato.png"]);
  });

  it("keeps ownership for what knowledge is not about (a chest at OBSERVER)", async () => {
    // REQ-CTT-074: escaping the knowledge filter is not a grant, and `loot` is
    // neither a character nor a contact. It answers to ownership, at the same
    // LIMITED threshold as everything else.
    insertDoc(ctx.db, "actors", "lootShared001", {
      name: "Baú da comitiva",
      type: "loot",
      img: "/assets/retrato.png",
      ownership: { default: OwnershipLevel.OBSERVER },
    });
    const shared = await mint(ctx, ctx.player.token, "actors", "lootShared001");
    expect(shared.status).toBe(200);
    expect(Object.keys(shared.body.grants)).toEqual(["retrato.png"]);

    insertDoc(ctx.db, "actors", "lootSecret001", {
      name: "Baú do Mestre",
      type: "loot",
      img: "/assets/segredo.jpg",
      ownership: { default: OwnershipLevel.NONE },
    });
    const secret = await mint(ctx, ctx.player.token, "actors", "lootSecret001");
    expect(secret.status).toBe(404);
  });

  it("the GM still sees everything", async () => {
    for (const id of ["contactGlimpsed001", "contactHidden001", "lootSecret001"]) {
      const { status, body } = await mint(ctx, ctx.gm.token, "actors", id);
      expect(status, id).toBe(200);
      expect(Object.keys(body.grants).length, id).toBe(1);
    }
  });
});

// ===========================================================================
// Expiry — the only revocation window a grant has
// ===========================================================================

describe("grant — expiry", () => {
  it("refuses a DOC grant whose `ae` has already passed", async () => {
    // The suite had NO expiry case for the doc scope: deleting the expiry check
    // left this file 38/38 green and only broke a browse-scope test in another
    // file. Since revoking ownership does NOT invalidate a grant already
    // issued, the 5-minute TTL is the only revocation this design has.
    const expired = Date.now() - 1000;
    const token = signDocGrant(ctx.player.id, expired, "mapa.png", ctx.secret);

    const resp = await serve(ctx, "mapa.png", {
      at: token,
      ae: expired,
      au: ctx.player.id,
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.rawPayload.equals(PNG_BYTES)).toBe(false);
  });

  it("the same signature works while it is still fresh (the control)", async () => {
    const fresh = Date.now() + 60_000;
    const token = signDocGrant(ctx.player.id, fresh, "mapa.png", ctx.secret);
    const resp = await serve(ctx, "mapa.png", { at: token, ae: fresh, au: ctx.player.id });
    expect(resp.statusCode).toBe(200);
  });

  it("mints with the declared TTL, so shortening or lengthening it shows up here", async () => {
    insertDoc(ctx.db, "actors", "actorTtl001", {
      name: "Ficha",
      type: "character",
      img: "/assets/mapa.png",
      ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
    });
    const before = Date.now();
    const { body } = await mint(ctx, ctx.player.token, "actors", "actorTtl001");
    const after = Date.now();

    expect(body.exp).toBeGreaterThanOrEqual(before + ASSET_GRANT_TTL_MS);
    expect(body.exp).toBeLessThanOrEqual(after + ASSET_GRANT_TTL_MS);
  });
});

// ===========================================================================
// The canonical-name contract, against the SHARED table the client also uses
// ===========================================================================

describe("the canonical name is the one @fusion/shared declares", () => {
  it("derives every declared spelling exactly as the table says", () => {
    // The client asserts against the SAME list (assetApi.test.ts). Two suites
    // over one table can only both pass by agreeing with each other; two
    // suites over two hand-written lists agree with their own authors, which
    // is how a `%2F` divergence and a throwing `decodeURIComponent` survived
    // both sides being green.
    for (const testCase of ASSET_NAME_CANONICALIZATION_CASES) {
      const derived = canonicalizeAssetName(assetRefToStorageName(testCase.storedPath));
      expect(derived, `${testCase.storedPath} — ${testCase.why}`).toBe(testCase.canonical);
    }
  });
});

describe("serve — cost and state", () => {
  it("never reads a document table", async () => {
    const seen: string[] = [];
    const handle = ctx.db as unknown as { prepare: (sql: string) => unknown };
    const original = handle.prepare.bind(ctx.db);
    handle.prepare = (sql: string): unknown => {
      seen.push(sql);
      return original(sql);
    };

    try {
      insertDoc(ctx.db, "actors", "actorCost001", {
        name: "Mapa",
        type: "npc",
        img: "/assets/mapa.png",
        ownership: { [ctx.player.id]: OwnershipLevel.OWNER },
      });
      const { body } = await mint(ctx, ctx.player.token, "actors", "actorCost001");

      seen.length = 0;
      const resp = await serve(ctx, "mapa.png", {
        at: body.grants["mapa.png"],
        ae: body.exp,
        au: ctx.player.id,
      });
      expect(resp.statusCode).toBe(200);
    } finally {
      handle.prepare = original;
    }

    // The spy has to be proven live, or "no document query" is vacuously true:
    // resolving the user's identity DOES hit `users`.
    expect(seen.some((sql) => /\busers\b/i.test(sql))).toBe(true);
    const documentTables =
      /\b(scenes|actors|items|journal_entries|macros|roll_tables|playlists|folders|combats|region_maps)\b/i;
    expect(seen.filter((sql) => documentTables.test(sql))).toEqual([]);
  });

  it("keeps the asset URL O(1): a scene with 200 tokens signs the same 64-hex token as one with 2", async () => {
    // The rejected variant shipped the whole NAME LIST inside the URL, which
    // reached ~9.5 KB in base64 for a busy scene — on every image request. One
    // HMAC per name means the credential is a constant 64 hex characters no
    // matter how large the document is.
    const tokens = (count: number): Array<Record<string, unknown>> =>
      Array.from({ length: count }, (_unused, i) => ({
        _id: `tok${String(i)}`,
        texture: `/assets/token-${String(i)}.png`,
        hidden: false,
      }));

    insertDoc(ctx.db, "scenes", "sceneSmall001", {
      name: "Pequena",
      active: true,
      background: "/assets/mapa.png",
      tokens: tokens(2),
      walls: [],
      ownership: { default: OwnershipLevel.NONE },
    });
    insertDoc(ctx.db, "scenes", "sceneBig001", {
      name: "Grande",
      active: true,
      background: "/assets/mapa.png",
      tokens: tokens(200),
      walls: [],
      ownership: { default: OwnershipLevel.NONE },
    });

    const small = await mint(ctx, ctx.player.token, "scenes", "sceneSmall001");
    const big = await mint(ctx, ctx.player.token, "scenes", "sceneBig001");

    expect(Object.keys(small.body.grants)).toHaveLength(3);
    expect(Object.keys(big.body.grants)).toHaveLength(201);

    const lengths = new Set(Object.values(big.body.grants).map((t) => t.length));
    expect(lengths).toEqual(new Set([64]));

    const urlFor = (r: typeof small): number =>
      assetPath("mapa.png").length +
      `?at=${r.body.grants["mapa.png"] ?? ""}&ae=${String(r.body.exp)}&au=${ctx.player.id}`.length;
    expect(urlFor(big)).toBe(urlFor(small));
  });

  it("one mint covers a whole document: background + 9 visible tokens in a single call", async () => {
    insertDoc(ctx.db, "scenes", "sceneOneMint001", {
      name: "Taverna",
      active: true,
      background: "/assets/fundo-da-cena.png",
      tokens: Array.from({ length: 9 }, (_unused, i) => ({
        _id: `tok${String(i)}`,
        texture: `/assets/tok-${String(i)}.png`,
        hidden: false,
      })),
      walls: [],
      ownership: { default: OwnershipLevel.NONE },
    });

    const { status, body } = await mint(ctx, ctx.player.token, "scenes", "sceneOneMint001");
    expect(status).toBe(200);
    expect(Object.keys(body.grants)).toHaveLength(10);
  });
});

// ===========================================================================
// The browse scope (the file picker's death in dead round 2)
// ===========================================================================

describe("serve — the browse scope", () => {
  it("one browse token serves a whole grid for TRUSTED", async () => {
    const tokenResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/token",
      headers: { authorization: `Bearer ${ctx.trusted.token}` },
    });
    const { token, exp } = tokenResp.json() as { token: string; exp: number };

    for (const name of ["mapa.png", "segredo.jpg", "sub/dir/goblin.png", "a b.png"]) {
      const resp = await serve(ctx, name, { at: token, ae: exp, au: ctx.trusted.id });
      expect(resp.statusCode, name).toBe(200);
    }
  });

  it("a browse token does NOT open a name for a role below the browse threshold", async () => {
    const tokenResp = await ctx.fastify.inject({
      method: "POST",
      url: "/api/assets/token",
      headers: { authorization: `Bearer ${ctx.player.token}` },
    });
    const { token, exp } = tokenResp.json() as { token: string; exp: number };

    const resp = await serve(ctx, "mapa.png", { at: token, ae: exp, au: ctx.player.id });
    expect(resp.statusCode).toBe(404);
    expect(resp.rawPayload.equals(PNG_BYTES)).toBe(false);
  });
});

// ===========================================================================
// Consistency of the two hand-written tables
// ===========================================================================

describe("the field table and the allowlist agree", () => {
  it("every grantable table has a projection entry and vice versa", async () => {
    // Two lists written by hand in two modules; nothing derives one from the
    // other, so nothing stops them from drifting except this.
    const grantable = [
      "actors",
      "items",
      "scenes",
      "journal_entries",
      "macros",
      "roll_tables",
      "playlists",
      "folders",
      "combats",
      "region_maps",
    ].sort();
    expect(Object.keys(ASSET_FIELD_PATHS).sort()).toEqual(grantable);

    // And the endpoint really does accept exactly those (a table missing from
    // the route's own set answers 400, which the loop above would catch).
    for (const table of grantable) {
      const resp = await ctx.fastify.inject({
        method: "POST",
        url: "/api/assets/grant",
        headers: { authorization: `Bearer ${ctx.gm.token}` },
        payload: { table, id: "definitelyMissing" },
      });
      expect(resp.statusCode, table).toBe(404); // 404 = accepted table, absent row
    }
  });

  it("every declared path is either a scalar or a single-level array path", () => {
    for (const [table, paths] of Object.entries(ASSET_FIELD_PATHS)) {
      for (const path of paths) {
        expect(path, `${table}.${path}`).toMatch(/^(?:[^[\].]+|[^[\].]+\[\]\.[^[\].]+)$/);
      }
    }
  });

  it("a bearer field yields at most ONE reference, whatever text is in it", () => {
    // The structural bound, unit-level. `projectedAssetRefs` anchors the match,
    // so N references crammed into one field are not N references — they are a
    // field that is not a path. Swap the anchors for a global scan and this
    // goes from 1 to 500 (that is exactly what the code did before review).
    const many = Array.from({ length: 500 }, (_unused, i) => `/assets/x-${String(i)}.jpg`).join(
      " ",
    );
    expect(projectedAssetRefs({ img: many })).toEqual([]);
    expect(projectedAssetRefs({ img: "/assets/mapa.png" })).toEqual(["/assets/mapa.png"]);
    expect(
      projectedAssetRefs({ background: "/assets/a.png", tokens: [{ texture: "/assets/b.png" }] }),
    ).toEqual(["/assets/a.png", "/assets/b.png"]);
    // A whole projection can never carry more references than it has fields.
    const projection = projectAssetFields("scenes", {
      background: many,
      thumb: many,
      tokens: Array.from({ length: 50 }, () => ({ texture: many })),
    });
    expect(projectedAssetRefs(projection)).toEqual([]);
  });

  it("the projection reaches nothing under system or flags", () => {
    const projected = projectAssetFields("actors", {
      img: "/assets/retrato.png",
      system: { details: { biography: "/assets/segredo.jpg" } },
      flags: { fusion: { assetSubstitutions: [{ original: "/assets/segredo.jpg" }] } },
    });
    expect(JSON.stringify(projected)).not.toContain("segredo.jpg");
    expect(projected).toEqual({ img: "/assets/retrato.png" });
  });

  it("Role and UserRole still agree numerically (the mint casts between them)", () => {
    expect(Role.PLAYER as number).toBe(UserRole.PLAYER as number);
    expect(Role.TRUSTED as number).toBe(UserRole.TRUSTED as number);
    expect(Role.ASSISTANT as number).toBe(UserRole.ASSISTANT as number);
    expect(Role.GAMEMASTER as number).toBe(UserRole.GAMEMASTER as number);
  });
});
