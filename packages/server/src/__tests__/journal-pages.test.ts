/**
 * The quest board's foundation through a real server — DEC-HUB-04, Q-JRN-003.
 *
 * The rule under test is one sentence: a journal entry is ONE document whose
 * pages are revealed one at a time, per player. Everything the Missões panel
 * will draw rests on it, and the failure mode is not a broken screen — it is a
 * player reading the ending of an adventure they have not played.
 *
 * So, as in `region-map.test.ts`, nothing here calls a redaction function
 * directly. Everything goes through the ops a client actually sends and is
 * read back off the paths a client actually receives: the join snapshot, the
 * live broadcast, and the ack the requester gets.
 *
 * What it proves, in the order it matters at the table:
 *
 *   1. a new objective is invisible even inside a quest the party is reading;
 *   2. revealing one objective reveals exactly that one, for exactly that
 *      player — the others do not learn it exists;
 *   3. renaming or completing an objective never changes who can read it;
 *   4. a player cannot write a page, reveal one, or read a hidden one.
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
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  tobiasId: string;
  tobiasToken: string;
  comedorId: string;
  comedorToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "quest_board_world";
  const dataDir = join(
    tmpdir(),
    `fusion-journal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: tobias } = await authService.createUser({
    name: "Tobias",
    role: Role.PLAYER,
    password: "tobias-pass",
  });
  const { user: comedor } = await authService.createUser({
    name: "Comedor",
    role: Role.PLAYER,
    password: "comedor-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const tobiasLogin = await authService.login({
    userId: tobias.id,
    password: "tobias-pass",
    ip: "127.0.0.1",
  });
  const comedorLogin = await authService.login({
    userId: comedor.id,
    password: "comedor-pass",
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
      worldTitle: "Quest Board World",
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
    tobiasId: tobias.id,
    tobiasToken: tobiasLogin.accessToken,
    comedorId: comedor.id,
    comedorToken: comedorLogin.accessToken,
  };
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for op: ${type}`));
    }, 8000);
  });
}

interface WirePage {
  _id: string;
  name: string;
  content: string;
  sort: number;
  ownership: Record<string, number>;
  flags: Record<string, Record<string, unknown>>;
}

/** Join as this user and read the pages their JOIN SNAPSHOT carries. */
async function snapshotPages(ctx: Ctx, token: string, entryId: string): Promise<WirePage[]> {
  const socket = connectClient(ctx.port, ctx.worldId, token);
  const arrived = new Promise<WirePage[]>((resolve, reject) => {
    socket.on("op", (env: Record<string, unknown>) => {
      if (env["type"] !== "resync:full") return;
      const payload = env["payload"] as Record<string, unknown>;
      const snap = payload["snapshot"] as Record<string, unknown> | null;
      if (!snap) return;
      const documents = snap["documents"] as Record<string, unknown[]>;
      const entries = (documents["JournalEntry"] ?? []) as Record<string, unknown>[];
      const entry = entries.find((e) => e["_id"] === entryId);
      resolve((entry?.["pages"] ?? []) as WirePage[]);
    });
    setTimeout(() => {
      reject(new Error("Timeout waiting for join snapshot"));
    }, 8000);
  });
  socket.connect();
  await waitForConnect(socket);
  try {
    return await arrived;
  } finally {
    socket.disconnect();
  }
}

/**
 * Wait for an op carrying this entry whose pages satisfy `until`.
 *
 * The predicate is not decoration: writing a page and revealing it are two
 * ops, so a listener attached after the first ack still races the first
 * BROADCAST, and "the next op" is whichever of the two arrives — which made
 * this assert against the wrong payload. Waiting for the state under test
 * removes the race without weakening it: a reveal that never lands still fails,
 * by timeout.
 */
function nextEntryOpPages(
  socket: ClientSocket,
  entryId: string,
  until: (pages: WirePage[]) => boolean = () => true,
): Promise<WirePage[]> {
  return new Promise<WirePage[]>((resolve, reject) => {
    const onOp = (env: Record<string, unknown>): void => {
      const type = env["type"];
      if (type !== "doc:update" && type !== "doc:create") return;
      const payload = env["payload"] as Record<string, unknown> | undefined;
      if (payload?.["documentType"] !== "JournalEntry") return;
      const docs = (payload["documents"] ?? []) as Record<string, unknown>[];
      const entry = docs.find((d) => d["_id"] === entryId);
      if (!entry) return;
      const pages = (entry["pages"] ?? []) as WirePage[];
      if (!until(pages)) return;
      socket.off("op", onOp);
      resolve(pages);
    };
    socket.on("op", onOp);
    setTimeout(() => {
      socket.off("op", onOp);
      reject(new Error("Timeout waiting for journal op"));
    }, 8000);
  });
}

function pagesOfAck(ack: Record<string, unknown>): WirePage[] {
  const result = ack["result"] as { documents: Array<Record<string, unknown>> };
  return (result.documents[0]?.["pages"] ?? []) as WirePage[];
}

describe("journal pages — per-page reveal (the quest board's foundation)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let tobias: ClientSocket;
  let comedor: ClientSocket;
  let entryId = "";
  let hookId = "";
  let objectiveId = "";

  beforeAll(async () => {
    ctx = await buildCtx();

    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    tobias = connectClient(ctx.port, ctx.worldId, ctx.tobiasToken);
    tobias.connect();
    await waitForConnect(tobias);

    comedor = connectClient(ctx.port, ctx.worldId, ctx.comedorToken);
    comedor.connect();
    await waitForConnect(comedor);

    // The quest itself is open to the table — what is held back are its pages.
    const ack = await sendOp(gm, "doc:create", {
      documentType: "JournalEntry",
      data: [
        {
          name: "Cães da Estrada",
          ownership: { default: OwnershipLevel.OBSERVER },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    entryId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    tobias.disconnect();
    comedor.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("a new page is hidden even inside a quest the party can open", async () => {
    const ack = await sendOp(gm, "journal:createPage", {
      entryId,
      page: { name: "Gancho", content: "O gado de Godford some há três luas." },
    });
    expect(ack["ok"]).toBe(true);

    const gmPages = await snapshotPages(ctx, ctx.gmToken, entryId);
    expect(gmPages).toHaveLength(1);
    hookId = gmPages[0]!._id;

    // The entry reached Tobias (he can open the quest) but carries no page.
    expect(await snapshotPages(ctx, ctx.tobiasToken, entryId)).toHaveLength(0);
  });

  it("a page created as visible reaches the table at once", async () => {
    const ack = await sendOp(gm, "journal:createPage", {
      entryId,
      page: { name: "Boato", content: "Dizem que a estrada anda comendo gente." },
      visible: true,
    });
    expect(ack["ok"]).toBe(true);

    const seen = await snapshotPages(ctx, ctx.tobiasToken, entryId);
    expect(seen.map((p) => p.name)).toEqual(["Boato"]);
  });

  it("reveals one objective to one player, and only that one", async () => {
    const created = await sendOp(gm, "journal:createPage", {
      entryId,
      page: { name: "Pista do curral", content: "As pegadas afundam demais para lobo." },
    });
    expect(created["ok"]).toBe(true);
    const gmPages = pagesOfAck(created);
    objectiveId = gmPages.find((p) => p.name === "Pista do curral")!._id;

    const landed = nextEntryOpPages(tobias, entryId, (pages) =>
      pages.some((p) => p._id === objectiveId),
    );
    const ack = await sendOp(gm, "journal:revealPage", {
      entryId,
      pageId: objectiveId,
      userIds: [ctx.tobiasId],
      level: OwnershipLevel.OBSERVER,
    });
    expect(ack["ok"]).toBe(true);

    // Tobias receives the objective, whole — title and body together.
    const tobiasPages = await landed;
    const objective = tobiasPages.find((p) => p._id === objectiveId);
    expect(objective?.name).toBe("Pista do curral");
    expect(objective?.content).toBe("As pegadas afundam demais para lobo.");

    // Comedor does not learn that a third page exists.
    const comedorPages = await snapshotPages(ctx, ctx.comedorToken, entryId);
    expect(comedorPages.map((p) => p.name)).toEqual(["Boato"]);
  });

  it("hands a hidden page to nobody, not even blanked", async () => {
    const pages = await snapshotPages(ctx, ctx.tobiasToken, entryId);

    // "Gancho" is still hidden from everyone, and its absence is total: no
    // placeholder, no empty title. REQ-HUB-022 — absence of payload, not v-if.
    expect(pages.some((p) => p._id === hookId)).toBe(false);
    expect(JSON.stringify(pages)).not.toContain("Godford");
  });

  it("renaming an objective does not change who reads it (REQ-HUB-032a)", async () => {
    const ack = await sendOp(gm, "journal:updatePage", {
      entryId,
      pageId: objectiveId,
      patch: { name: "A coisa na neblina" },
    });
    expect(ack["ok"]).toBe(true);

    const pages = await snapshotPages(ctx, ctx.tobiasToken, entryId);
    expect(pages.find((p) => p._id === objectiveId)?.name).toBe("A coisa na neblina");
    expect(await snapshotPages(ctx, ctx.comedorToken, entryId)).toHaveLength(1);
  });

  it("marks an objective done for the table, per objective (Q-HUB-04)", async () => {
    const ack = await sendOp(gm, "journal:updatePage", {
      entryId,
      pageId: objectiveId,
      patch: { hub: { done: true, pois: ["aaaaaaaaaaaaaaaa"] } },
    });
    expect(ack["ok"]).toBe(true);

    const pages = await snapshotPages(ctx, ctx.tobiasToken, entryId);
    const hub = pages.find((p) => p._id === objectiveId)?.flags["fusion"]?.["hub"] as
      | Record<string, unknown>
      | undefined;
    expect(hub?.["done"]).toBe(true);
    // Each objective points at its OWN places — the party is sent to the right
    // one, not to the quest's single location (REQ-HUB-038, per objective).
    expect(hub?.["pois"]).toEqual(["aaaaaaaaaaaaaaaa"]);
  });

  it("a player cannot write, reveal or delete a page", async () => {
    const written = await sendOp(tobias, "journal:createPage", {
      entryId,
      page: { name: "minha missão" },
    });
    expect(written["ok"]).toBe(false);

    const revealed = await sendOp(tobias, "journal:revealPage", {
      entryId,
      pageId: hookId,
      userIds: [ctx.tobiasId],
      level: OwnershipLevel.OBSERVER,
    });
    expect(revealed["ok"]).toBe(false);

    const removed = await sendOp(tobias, "journal:deletePage", { entryId, pageId: hookId });
    expect(removed["ok"]).toBe(false);

    // And the hidden page is still hidden after all three attempts.
    expect((await snapshotPages(ctx, ctx.tobiasToken, entryId)).some((p) => p._id === hookId)).toBe(
      false,
    );
  });

  it("a payload carrying `ownership` is refused, not quietly stripped", async () => {
    // The reveal is not editable through a content edit: the schema IS the
    // boundary, so this fails validation rather than being sanitised
    // somewhere downstream that a later refactor could skip.
    const ack = await sendOp(gm, "journal:updatePage", {
      entryId,
      pageId: hookId,
      patch: { name: "Gancho", ownership: { default: OwnershipLevel.OBSERVER } },
    });

    expect(ack["ok"]).toBe(false);
    expect(await snapshotPages(ctx, ctx.tobiasToken, entryId)).not.toContainEqual(
      expect.objectContaining({ _id: hookId }),
    );
  });

  it("the GM always sees every page, authored", async () => {
    const pages = await snapshotPages(ctx, ctx.gmToken, entryId);

    expect(pages.map((p) => p.name).sort()).toEqual(["A coisa na neblina", "Boato", "Gancho"]);
  });

  it("deleting a page removes it for everyone", async () => {
    const ack = await sendOp(gm, "journal:deletePage", { entryId, pageId: hookId });
    expect(ack["ok"]).toBe(true);

    const pages = await snapshotPages(ctx, ctx.gmToken, entryId);
    expect(pages.map((p) => p._id)).not.toContain(hookId);
  });
});
