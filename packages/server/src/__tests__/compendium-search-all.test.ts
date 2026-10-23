/**
 * Aggregated compendium search, owned by the SERVER (G090).
 *
 * Spec: 43-aba-compendio.md §5.4 — REQ-CPD-030 (the server serves the search
 * over every pack visible to the caller, accent- and case-insensitive),
 * REQ-CPD-031 (grouped by document type, count per group, every row naming its
 * source pack) and REQ-CPD-032 (limited per group, and a truncated group says
 * how many were left out and can offer opening that pack in its own scope).
 * RNF-CPD-01 (under 300 ms over the full acervo, measured on the server).
 * Spec 16: REQ-CMP-013a (the aggregated search is a server API, not N client
 * searches) and REQ-CMP-013b (both names — EN and pt-BR — are searchable).
 *
 * WHY THE REAL PACKS: every assertion runs against the COMMITTED
 * `systems/pf2e/packs` — 14 packs, ~4.2k documents, one of them
 * (`bestiary-core`) declaring `"audience": "gm"`. A synthetic two-pack fixture
 * would prove the grouping code compiles; the real acervo is what proves the
 * search crosses packs, that a player's search never touches the bestiary, and
 * that the time budget is met on data the table actually plays with.
 *
 * WHY THE PAYLOAD, NOT THE SCREEN: the behaviour tests read the ack the
 * PLAYER's and the GM's sockets receive. The aggregated search is precisely the
 * place where filtering only in the UI would hand a player the bestiary
 * (REQ-CPD-074).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import type { Logger } from "pino";

import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION, COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP } from "@fusion/shared";
import { reserveFreePort } from "./helpers/ports.js";
import { CompendiumService, resolveSystemPacksDir } from "../compendium/index.js";

// ---------------------------------------------------------------------------
// The data under test — committed, not synthetic
// ---------------------------------------------------------------------------

/** Declares `"audience": "gm"` in its committed pack.json (REQ-CPD-072). */
const GM_PACK_ID = "pf2e.bestiary-core";

/**
 * "goblin" is the query that makes the aggregation visible: it matches in the
 * hidden bestiary (`Goblin Warrior`, an Actor) AND in several audience-`all`
 * Item packs (ancestries, heritages, feats, actions, spells). One search, many
 * packs, two document types.
 */
const CROSS_PACK_QUERY = "goblin";

/**
 * The spell whose two names differ — the mesa says "Bola de Fogo", the book
 * says "Fireball" (REQ-CMP-013b, DEC-CPD-06).
 */
const BILINGUAL = {
  uuid: "Compendium.pf2e.spells-core.Item.8GpJtxdAIzontkFz",
  en: "fireball",
  pt: "bola de fogo",
};

// ---------------------------------------------------------------------------
// Payload shapes (the ack is untyped over the wire)
// ---------------------------------------------------------------------------

interface WireEntry {
  uuid: string;
  name: string;
  namePt?: string;
  packId: string;
  packLabel: string;
}

interface WireGroup {
  documentType: string;
  total: number;
  entries: WireEntry[];
  truncated: boolean;
  omitted: number;
  packs: Array<{ packId: string; label: string; matched: number }>;
}

interface WireResult {
  groups: WireGroup[];
  totalMatched: number;
  limitPerGroup: number;
  packsSearched: number;
}

function resultOf(ack: Record<string, unknown>): WireResult {
  expect(ack["ok"]).toBe(true);
  return ack["result"] as WireResult;
}

function groupOf(result: WireResult, documentType: string): WireGroup | undefined {
  return result.groups.find((g) => g.documentType === documentType);
}

function allEntries(result: WireResult): WireEntry[] {
  return result.groups.flatMap((g) => g.entries);
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cmp-searchall-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "cmp_search_all_world";

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
      worldTitle: "Compendium Aggregated Search World",
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

function sendQuery(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("query", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for query: ${type}`));
    }, 20000);
  });
}

// ---------------------------------------------------------------------------
// Behaviour over the socket
// ---------------------------------------------------------------------------

describe("compendium:searchAll — REQ-CPD-030, REQ-CPD-031, REQ-CPD-032, REQ-CMP-013a", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await waitForConnect(gm);
    await waitForConnect(player);
    // The first aggregated search builds the whole cross-pack index (14 packs,
    // ~4.2k docs). That build is REQ-CMP-049's budget, not RNF-CPD-01's, and it
    // is paid here so no behaviour test measures a cold cache.
    await sendQuery(gm, "compendium:searchAll", { text: "warmup" });
  }, 180_000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // REQ-CPD-030 — one search, the whole visible acervo, served by the server
  // -------------------------------------------------------------------------

  it("REQ-CPD-030 / REQ-CMP-013a: one call with no packId crosses every visible pack", async () => {
    const result = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );

    // Two document types answered the same query — the shelf's Actor packs and
    // its Item packs, without the caller naming a single pack.
    expect(result.groups.length).toBeGreaterThanOrEqual(2);
    expect(groupOf(result, "Actor")).toBeDefined();

    const items = groupOf(result, "Item");
    expect(items).toBeDefined();
    const sources = new Set(items!.entries.map((e) => e.packId));
    expect(sources.size).toBeGreaterThanOrEqual(2);

    // The search covered packs, not a pack: `packsSearched` is the GM's whole
    // visible shelf.
    expect(result.packsSearched).toBeGreaterThanOrEqual(10);
  });

  it("REQ-CPD-030: the search is accent- and case-insensitive", async () => {
    const plain = resultOf(await sendQuery(gm, "compendium:searchAll", { text: "bola de fogo" }));
    const shouty = resultOf(await sendQuery(gm, "compendium:searchAll", { text: "BÓLÁ DE FOGO" }));

    expect(allEntries(plain).map((e) => e.uuid)).toContain(BILINGUAL.uuid);
    expect(allEntries(shouty).map((e) => e.uuid)).toEqual(allEntries(plain).map((e) => e.uuid));
  });

  it("REQ-CPD-030 / REQ-CMP-013b: either name finds the same entry", async () => {
    const en = resultOf(await sendQuery(gm, "compendium:searchAll", { text: BILINGUAL.en }));
    const pt = resultOf(await sendQuery(gm, "compendium:searchAll", { text: BILINGUAL.pt }));

    expect(allEntries(en).map((e) => e.uuid)).toContain(BILINGUAL.uuid);
    expect(allEntries(pt).map((e) => e.uuid)).toContain(BILINGUAL.uuid);

    // And the row carries both names, so the line can show the two spellings.
    const row = allEntries(pt).find((e) => e.uuid === BILINGUAL.uuid)!;
    expect(row.name.toLowerCase()).toBe(BILINGUAL.en);
    expect(row.namePt?.toLowerCase()).toBe(BILINGUAL.pt);
  });

  // -------------------------------------------------------------------------
  // REQ-CPD-031 — grouped, counted, and every row names its source
  // -------------------------------------------------------------------------

  it("REQ-CPD-031: every row names the pack it came from", async () => {
    const listAck = await sendQuery(gm, "compendium:list", {});
    const manifests = (listAck["result"] as { packs: Array<{ id: string; label: string }> }).packs;
    const labelById = new Map(manifests.map((p) => [p.id, p.label]));

    const result = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );
    const rows = allEntries(result);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(labelById.has(row.packId)).toBe(true);
      expect(row.packLabel).toBe(labelById.get(row.packId));
      expect(row.packLabel.length).toBeGreaterThan(0);
      // The row belongs to the pack it names.
      expect(row.uuid.startsWith(`Compendium.${row.packId}.`)).toBe(true);
    }
  });

  it("REQ-CPD-031: each group carries its own count, and the counts add up", async () => {
    const result = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );

    let sum = 0;
    for (const group of result.groups) {
      expect(group.total).toBeGreaterThanOrEqual(group.entries.length);
      // The per-pack tally partitions the group's total (REQ-CPD-032: it is
      // what lets a truncated group offer opening a specific pack).
      const tallied = group.packs.reduce((acc, p) => acc + p.matched, 0);
      expect(tallied).toBe(group.total);
      sum += group.total;
    }
    expect(result.totalMatched).toBe(sum);
  });

  it("REQ-CPD-031: entries of a group all share that group's document type", async () => {
    const result = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );
    const actors = groupOf(result, "Actor")!;

    for (const row of actors.entries) {
      expect(row.uuid.startsWith(`Compendium.${row.packId}.Actor.`)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // REQ-CPD-032 — limited per group, and the truncated group says so
  // -------------------------------------------------------------------------

  it("REQ-CPD-032: a truncated group says how many were left out", async () => {
    const result = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY, limitPerGroup: 2 }),
    );

    const items = groupOf(result, "Item")!;
    expect(items.total).toBeGreaterThan(2);
    expect(items.entries).toHaveLength(2);
    expect(items.truncated).toBe(true);
    expect(items.omitted).toBe(items.total - 2);
    expect(result.limitPerGroup).toBe(2);
  });

  it("REQ-CPD-032: a truncated group names the packs it can be reopened in", async () => {
    const result = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY, limitPerGroup: 2 }),
    );

    const items = groupOf(result, "Item")!;
    expect(items.packs.length).toBeGreaterThanOrEqual(2);
    for (const tally of items.packs) {
      expect(tally.matched).toBeGreaterThan(0);
      expect(tally.label.length).toBeGreaterThan(0);
    }
    // Biggest contributor first, so the "abrir aquele pack" offer is ordered.
    const counts = items.packs.map((p) => p.matched);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // The tally survives truncation: packs whose matches were ALL cut still
    // appear, which is exactly what makes "abrir aquele pack" reachable.
    const delivered = new Set(items.entries.map((e) => e.packId));
    expect(items.packs.some((p) => !delivered.has(p.packId))).toBe(true);
  });

  it("REQ-CPD-032: an untruncated group reports nothing left out", async () => {
    const result = resultOf(await sendQuery(gm, "compendium:searchAll", { text: BILINGUAL.pt }));

    for (const group of result.groups) {
      if (group.entries.length === group.total) {
        expect(group.truncated).toBe(false);
        expect(group.omitted).toBe(0);
      }
    }
  });

  it("REQ-CPD-032: with no limit asked, the server applies its single configured ceiling", async () => {
    // Empty text = the whole visible acervo (~4.2k documents). Nothing close to
    // that reaches the wire: the server answers already limited.
    const result = resultOf(await sendQuery(gm, "compendium:searchAll", {}));

    expect(result.limitPerGroup).toBe(COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP);
    expect(result.totalMatched).toBeGreaterThan(1000);
    for (const group of result.groups) {
      expect(group.entries.length).toBeLessThanOrEqual(COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP);
    }
    const items = groupOf(result, "Item")!;
    expect(items.entries).toHaveLength(COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP);
    expect(items.truncated).toBe(true);
  });

  it("REQ-CPD-032: asking for the whole acervo in one response is refused, not clamped", async () => {
    const ack = await sendQuery(gm, "compendium:searchAll", { limitPerGroup: 5000 });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(ack["result"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // REQ-CPD-030 over the audience gate — the search sees only what the caller
  // may see (REQ-CPD-071, REQ-CMP-010a). This is the reason the search is on
  // the server at all.
  // -------------------------------------------------------------------------

  it("REQ-CPD-030 / REQ-CPD-071: the player's aggregated search never returns a row of the gm pack", async () => {
    const result = resultOf(
      await sendQuery(player, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );

    for (const row of allEntries(result)) {
      expect(row.packId).not.toBe(GM_PACK_ID);
    }
    for (const group of result.groups) {
      for (const tally of group.packs) {
        expect(tally.packId).not.toBe(GM_PACK_ID);
      }
    }
    // Not even as an empty group: the hidden pack's document type is absent
    // altogether, so no count betrays it.
    expect(groupOf(result, "Actor")).toBeUndefined();
  });

  it("REQ-CPD-030 / REQ-CPD-071: the GM running the very same query does get the creature", async () => {
    const gmResult = resultOf(
      await sendQuery(gm, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );
    const playerResult = resultOf(
      await sendQuery(player, "compendium:searchAll", { text: CROSS_PACK_QUERY }),
    );

    const gmActors = groupOf(gmResult, "Actor")!;
    expect(gmActors.entries.some((e) => e.packId === GM_PACK_ID)).toBe(true);

    // The player searched a strictly smaller shelf, and his totals say so
    // without ever naming what he is missing.
    expect(playerResult.packsSearched).toBeLessThan(gmResult.packsSearched);
    expect(playerResult.totalMatched).toBeLessThan(gmResult.totalMatched);
  });

  it("REQ-CPD-030 / REQ-CPD-071: an empty aggregated search does not count the hidden pack either", async () => {
    const result = resultOf(await sendQuery(player, "compendium:searchAll", {}));

    for (const group of result.groups) {
      for (const tally of group.packs) {
        expect(tally.packId).not.toBe(GM_PACK_ID);
      }
    }
    expect(groupOf(result, "Actor")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RNF-CPD-01 — the time budget, measured on the server
//
// Measured in-process against the committed pf2e acervo, without a socket in
// the middle: the requirement is about the SERVER's answer ("medida no
// servidor"), so the wire and the client are deliberately out of the sample.
// ---------------------------------------------------------------------------

/** The one line the service writes when it builds the cross-pack index. */
const BUILD_LOG_MESSAGE = "Built cross-pack compendium search index";

/**
 * A logger that only remembers the index-build announcements. It is the
 * observable that makes "built once" checkable without a stopwatch — see the
 * note on the reuse test below.
 */
function collectingLogger(): { logger: Logger; buildLogs: Array<Record<string, unknown>> } {
  const buildLogs: Array<Record<string, unknown>> = [];
  const noop = (): void => {
    /* the service's other log levels are irrelevant here */
  };
  const stub = {
    debug: (payload: unknown, message?: string): void => {
      if (message === BUILD_LOG_MESSAGE && typeof payload === "object" && payload !== null) {
        buildLogs.push(payload as Record<string, unknown>);
      }
    },
    trace: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    silent: noop,
  };
  return { logger: stub as unknown as Logger, buildLogs };
}

describe("RNF-CPD-01 — the aggregated search answers within budget on the full pf2e acervo", () => {
  /**
   * The requirement is < 300 ms on a REFERENCE machine. This assertion uses a
   * deliberately loose ceiling because a shared CI runner is not one: a
   * timing test that fails under a noisy neighbour teaches the team to ignore
   * red, which costs more than the milliseconds it guards. 1000 ms still
   * catches the regression that actually matters here — going back to
   * re-normalizing ~4.2k names (or, worse, re-reading documents.json) on every
   * keystroke, which is an order of magnitude, not a factor of three.
   */
  const CI_CEILING_MS = 1000;
  const TARGET_MS = 300;

  it("RNF-CPD-01: a warm aggregated search over every committed pf2e pack stays well under the budget", () => {
    const svc = new CompendiumService();
    const packsDir = resolveSystemPacksDir("pf2e");
    if (packsDir === null) throw new Error("Committed pf2e packs not found");
    svc.discoverPacks(packsDir, "pf2e");

    // Warm the index once. Building it is REQ-CMP-049's budget (1.5 s for ONE
    // big pack); RNF-CPD-01 is about answering a search, which is what the
    // table feels on every keystroke.
    const warm = svc.searchAllPacks(Role.GAMEMASTER, { text: "warmup" });
    expect(warm.packsSearched).toBeGreaterThanOrEqual(10);

    const queries = ["goblin", "fireball", "bola de fogo", "sword", "a"];
    let worst = 0;
    for (const text of queries) {
      const started = performance.now();
      const result = svc.searchAllPacks(Role.GAMEMASTER, { text });
      worst = Math.max(worst, performance.now() - started);
      expect(result.groups.length).toBeGreaterThan(0);
    }

    expect(worst).toBeLessThan(CI_CEILING_MS);
    // Reported, not asserted: the reference-machine target of RNF-CPD-01.
    if (worst >= TARGET_MS) {
      console.warn(
        `RNF-CPD-01: aggregated search took ${worst.toFixed(1)}ms (target ${String(TARGET_MS)}ms)`,
      );
    }
  }, 180_000);

  /**
   * WHY NOT A STOPWATCH: an earlier version of this test compared the second
   * search's wall time against the first one's. It did not hold — with the
   * cache REMOVED from the service the assertion still passed, because a
   * rebuild over the committed acervo is fast enough in absolute terms to sit
   * under any ceiling loose enough to survive a shared CI runner. The build is
   * therefore asserted where it is actually observable: the service announces
   * each build once, and a cached index announces it exactly once no matter how
   * many searches follow.
   */
  it("RNF-CPD-01: the cross-pack index is built once and reused (a second search does not rebuild it)", () => {
    const { logger, buildLogs } = collectingLogger();
    const svc = new CompendiumService(logger);
    const packsDir = resolveSystemPacksDir("pf2e");
    if (packsDir === null) throw new Error("Committed pf2e packs not found");
    svc.discoverPacks(packsDir, "pf2e");

    // Nothing is built until someone searches: the index is lazy.
    expect(buildLogs).toHaveLength(0);

    const first = svc.searchAllPacks(Role.GAMEMASTER, { text: "goblin" });
    expect(first.totalMatched).toBeGreaterThan(0);
    expect(buildLogs).toHaveLength(1);

    // More searches — different text, different filters, no text at all — and
    // the index is still the one built above.
    const second = svc.searchAllPacks(Role.GAMEMASTER, { text: "goblin" });
    const everything = svc.searchAllPacks(Role.GAMEMASTER, {});
    expect(second.totalMatched).toBe(first.totalMatched);
    expect(buildLogs).toHaveLength(1);

    // And that single build covered the whole shelf, cross-checked against the
    // aggregation's own tally rather than against itself: the GM sees every
    // pack, so an empty search reaches every row the build produced.
    const built = buildLogs[0]!;
    expect(built["packs"]).toBe(everything.packsSearched);
    expect(built["entries"]).toBe(everything.totalMatched);
  }, 180_000);
});
