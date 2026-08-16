/**
 * npc-folder-delete.test.ts — `folder:delete`, the composed operation of the NPCs
 * tab (spec 42 §5.3, G070).
 *
 * Covers REQ-NPC-020 (the tree is `Folder` documents nested by `parentId`),
 * REQ-NPC-021 (a privileged seat creates, renames and nests them) and above all
 * REQ-NPC-022: deleting a folder deletes NO actor — its actors go back to "Sem
 * pasta" and its subfolders rise one level.
 *
 * Everything is asserted on the PAYLOAD the socket carries and on a fresh join
 * snapshot, never on a client-side view: what matters is what the server actually
 * persisted and what it actually hands out afterwards.
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
import { PROTOCOL_VERSION, createDocumentId } from "@fusion/shared";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `fusion-${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  trustedToken: string;
  trustedUserId: string;
}

let ctx: Ctx;
let gmSocket: ClientSocket;

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

/** Collect the resync:full snapshot the server pushes on join. */
function waitForSnapshot(socket: ClientSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for snapshot")), timeoutMs);
    const handler = (env: Record<string, unknown>): void => {
      if (env["type"] === "resync:full") {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

/** Everything the server currently holds, read through a fresh GM join. */
async function readWorld(token: string): Promise<Record<string, Record<string, unknown>[]>> {
  const socket = connectClient(ctx.port, ctx.worldId, token);
  const snapshotP = waitForSnapshot(socket);
  socket.connect();
  await waitForConnect(socket);
  const env = await snapshotP;
  socket.disconnect();

  const snapshot = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
    string,
    unknown
  >;
  return (snapshot["documents"] ?? {}) as Record<string, Record<string, unknown>[]>;
}

async function createFolder(name: string, parentId: string | null): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Folder",
    data: [{ name, type: "Actor", parentId, sort: 0 }],
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const result = ack["result"] as Record<string, unknown>;
  const docs = result["documents"] as Record<string, unknown>[];
  return docs[0]!["_id"] as string;
}

async function createNpc(name: string, folderId: string | null): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type: "npc", folder: folderId, ownership: { default: 0 }, flags: {} }],
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const result = ack["result"] as Record<string, unknown>;
  const docs = result["documents"] as Record<string, unknown>[];
  return docs[0]!["_id"] as string;
}

/**
 * Insert an actor row DIRECTLY into SQLite, bypassing `DocumentStore.create`
 * (and its validation) entirely — the only way to reproduce, in a test, the
 * "legacy row a prior pack/migration wrote that no longer matches the current
 * schema" scenario the atomicity fix targets. `_stats` deliberately omits
 * `version`: `buildUpdateStats` (documents/store.ts) then computes
 * `existing.version + 1` = NaN on the next update, which fails
 * `DocumentStatsSchema`'s `z.number()` check for `version` — a
 * `DocumentValidationError` raised mid-cascade, not before it (the row reads
 * back fine via `store.get`/`store.query`, which never validate).
 */
function insertLegacyActor(name: string, folderId: string): string {
  const id = createDocumentId();
  const now = Date.now();
  const data = {
    _id: id,
    _stats: {
      createdTime: now,
      modifiedTime: now,
      lastModifiedBy: null,
      createdBy: null,
      coreVersion: "0.0.0-legacy",
      systemId: null,
      systemVersion: null,
      // `version` intentionally absent.
    },
    name,
    type: "npc",
    folder: folderId,
    ownership: { default: 0 },
    flags: {},
  };
  ctx.fusionDb.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, folder_id, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, JSON.stringify(data), name, "npc", folderId, 0, now, now);
  return id;
}

beforeAll(async () => {
  const worldId = "npc-folder-world";
  const dataDir = makeTempDir(worldId);
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const { user: player } = await authService.createUser({
    name: "Tobias",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  const { user: trusted } = await authService.createUser({
    name: "Escudeiro",
    role: Role.TRUSTED,
    password: "trusted-pass",
  });
  const trustedLogin = await authService.login({
    userId: trusted.id,
    password: "trusted-pass",
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
      worldTitle: "NPC Folder World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  ctx = {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    trustedToken: trustedLogin.accessToken,
    trustedUserId: trusted.id,
  };

  gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
  gmSocket.connect();
  await waitForConnect(gmSocket);
}, 30_000);

afterAll(async () => {
  gmSocket?.disconnect();
  if (!ctx) return;
  await ctx.bootResult.shutdown();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REQ-NPC-020 / REQ-NPC-021: the folder tree is real documents on the server", () => {
  it("REQ-NPC-021: a privileged seat creates, nests and renames a folder", async () => {
    const aldeia = await createFolder("Aldeia", null);
    const taverna = await createFolder("Taverna", aldeia);

    const renameAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Folder",
      updates: [{ _id: taverna, diff: { name: "Taverna do Javali" } }],
    });
    expect(renameAck["ok"]).toBe(true);

    const world = await readWorld(ctx.gmToken);
    const folders = world["Folder"] ?? [];
    const stored = folders.find((doc) => doc["_id"] === taverna);

    // REQ-NPC-020: the nesting is `parentId`, and it survived the rename.
    expect(stored?.["name"]).toBe("Taverna do Javali");
    expect(stored?.["parentId"]).toBe(aldeia);
    expect(stored?.["type"]).toBe("Actor");
  });
});

describe("REQ-NPC-022: deleting a folder deletes no actor", () => {
  it("REQ-NPC-022: the actors go to Sem pasta and the subfolders rise one level", async () => {
    const raiz = await createFolder("Raiz", null);
    const meio = await createFolder("Meio", raiz);
    const fundo = await createFolder("Fundo", meio);
    const dentroDoMeio = await createNpc("Taverneiro", meio);
    const dentroDoFundo = await createNpc("Rato", fundo);

    const ack = await sendOp(gmSocket, "folder:delete", { folderId: meio });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const result = ack["result"] as Record<string, unknown>;
    expect(result["folderId"]).toBe(meio);
    expect(result["reparentedFolderIds"]).toEqual([fundo]);
    expect(result["releasedDocumentIds"]).toEqual([dentroDoMeio]);

    const world = await readWorld(ctx.gmToken);
    const folders = world["Folder"] ?? [];
    const actors = world["Actor"] ?? [];

    // The folder is gone ...
    expect(folders.some((doc) => doc["_id"] === meio)).toBe(false);
    // ... its subfolder rose to the deleted folder's own parent ...
    expect(folders.find((doc) => doc["_id"] === fundo)?.["parentId"]).toBe(raiz);
    // ... the actor that was IN it still exists, now with no folder ...
    const taverneiro = actors.find((doc) => doc["_id"] === dentroDoMeio);
    expect(taverneiro).toBeDefined();
    expect(taverneiro?.["name"]).toBe("Taverneiro");
    expect(taverneiro?.["folder"]).toBeNull();
    // ... and the actor of the subfolder was not touched at all.
    expect(actors.find((doc) => doc["_id"] === dentroDoFundo)?.["folder"]).toBe(fundo);
  });

  it("REQ-NPC-022: deleting a ROOT folder lifts its subfolders to the root", async () => {
    const topo = await createFolder("Topo", null);
    const filha = await createFolder("Filha", topo);

    const ack = await sendOp(gmSocket, "folder:delete", { folderId: topo });
    expect(ack["ok"]).toBe(true);

    const folders = (await readWorld(ctx.gmToken))["Folder"] ?? [];
    const stored = folders.find((doc) => doc["_id"] === filha);
    expect(stored).toBeDefined();
    // Null, not the id of a folder that no longer exists.
    expect(stored?.["parentId"]).toBeNull();
  });

  it("REQ-NPC-022: every client is told, on the same pipe, what moved and what went", async () => {
    const pasta = await createFolder("Anunciada", null);
    const dentro = await createNpc("Anunciado", pasta);

    const seen: Record<string, unknown>[] = [];
    const listener = (env: Record<string, unknown>): void => {
      seen.push(env);
    };
    gmSocket.on("op", listener);

    const ack = await sendOp(gmSocket, "folder:delete", { folderId: pasta });
    expect(ack["ok"]).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    gmSocket.off("op", listener);

    const actorUpdate = seen.find(
      (env) =>
        env["type"] === "doc:update" &&
        (env["payload"] as Record<string, unknown>)["documentType"] === "Actor",
    );
    const folderDelete = seen.find(
      (env) =>
        env["type"] === "doc:delete" &&
        (env["payload"] as Record<string, unknown>)["documentType"] === "Folder",
    );

    // The released actor travels as an ordinary Actor delta — same seq pipe, same
    // redaction funnel — so no client has to reload to see it in "Sem pasta".
    expect(actorUpdate).toBeDefined();
    const released = (actorUpdate!["payload"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    expect(released.some((doc) => doc["_id"] === dentro && doc["folder"] === null)).toBe(true);

    expect(folderDelete).toBeDefined();
    expect((folderDelete!["payload"] as Record<string, unknown>)["ids"]).toEqual([pasta]);
  });

  it("REQ-NPC-022: an id that names no folder is refused, and nothing is written", async () => {
    const ack = await sendOp(gmSocket, "folder:delete", { folderId: "fld-nao-existe" });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
  });
});

describe("REQ-NPC-022: the reparent+release+delete triad is atomic", () => {
  it("REQ-NPC-022: a validation failure on the release step rolls back the reparent step too", async () => {
    const raiz = await createFolder("Raiz Atomica", null);
    const meio = await createFolder("Meio Atomico", raiz);
    // A subfolder of `meio` — step 1 (reparent) would lift it to `raiz`.
    const netinha = await createFolder("Netinha", meio);
    // A normal, releasable actor — step 2 would move it to "Sem pasta".
    const bom = await createNpc("Bom", meio);
    // A legacy row that fails schema validation on write — the one that
    // makes step 2 throw partway through.
    const legado = insertLegacyActor("Legado", meio);

    const seen: Record<string, unknown>[] = [];
    const listener = (env: Record<string, unknown>): void => {
      seen.push(env);
    };
    gmSocket.on("op", listener);

    const ack = await sendOp(gmSocket, "folder:delete", { folderId: meio });
    await new Promise((resolve) => setTimeout(resolve, 200));
    gmSocket.off("op", listener);

    // The ack must NOT claim success over a world it left half-changed, and
    // must name the real cause instead of crashing the handler.
    expect(ack["ok"], JSON.stringify(ack)).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");

    // No delta of ANY kind reached the socket — the old three-transactions
    // shape could commit step 1 (reparent) and step 2's first item and still
    // broadcast nothing, leaving clients silently stale until a resync.
    expect(seen).toEqual([]);

    const world = await readWorld(ctx.gmToken);
    const folders = world["Folder"] ?? [];
    const actors = world["Actor"] ?? [];

    // The folder itself is still there ...
    expect(folders.some((doc) => doc["_id"] === meio)).toBe(true);
    // ... its subfolder was NOT lifted — step 1 rolled back together with
    // step 2's failure, because the whole triad shares one transaction now ...
    expect(folders.find((doc) => doc["_id"] === netinha)?.["parentId"]).toBe(meio);
    // ... and neither actor was released — not even the one that would have
    // validated fine on its own.
    expect(actors.find((doc) => doc["_id"] === bom)?.["folder"]).toBe(meio);
    expect(actors.find((doc) => doc["_id"] === legado)?.["folder"]).toBe(meio);
  });
});

describe("REQ-NPC-080: the check is on the server, not on the tab that is not drawn", () => {
  it("REQ-NPC-080: a player emitting folder:delete is refused", async () => {
    const pasta = await createFolder("Do Mestre", null);
    const dentro = await createNpc("Guarda", pasta);

    const playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    playerSocket.connect();
    await waitForConnect(playerSocket);

    const ack = await sendOp(playerSocket, "folder:delete", { folderId: pasta });
    playerSocket.disconnect();

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    // And nothing moved: the folder is still there, with its actor in it.
    const world = await readWorld(ctx.gmToken);
    expect((world["Folder"] ?? []).some((doc) => doc["_id"] === pasta)).toBe(true);
    expect((world["Actor"] ?? []).find((doc) => doc["_id"] === dentro)?.["folder"]).toBe(pasta);
  });

  // REQ-NPC-080: "criar e excluir pasta" is one of the operations the requirement
  // names for `isRolePrivileged`. TRUSTED (role 2) is a real, creatable seat that
  // is NOT privileged (`isRolePrivileged` is `>= ASSISTANT_GM`, role 3) — the
  // generic `doc:create`/`doc:delete` path used to fall through to the plain
  // `role >= TRUSTED` floor for any documentType not in GM_ONLY_CREATE_DELETE,
  // and Folder was missing from that set.
  it("REQ-NPC-080 / REQ-NPC-021: a TRUSTED socket emitting doc:create for Folder is refused", async () => {
    const trustedSocket = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    trustedSocket.connect();
    await waitForConnect(trustedSocket);

    const ack = await sendOp(trustedSocket, "doc:create", {
      documentType: "Folder",
      data: [{ name: "Pasta forjada", type: "Actor", parentId: null, sort: 0 }],
    });
    trustedSocket.disconnect();

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    const world = await readWorld(ctx.gmToken);
    expect((world["Folder"] ?? []).some((doc) => doc["name"] === "Pasta forjada")).toBe(false);
  });

  // REQ-NPC-022: `folder:delete` is the only door because it is a COMPOSED
  // operation (subfolders lift, actors release, only then does the row go).
  // Membership in GM_ONLY_CREATE_DELETE alone is not enough to protect that
  // invariant: it still lets a privileged caller reach the plain OWNER/GM
  // delete branch of the generic path, which removes the row without doing
  // any of the reparenting. This must be refused for EVERY role, privileged
  // included — the same way ChatMessage is refused by type on this path.
  it("REQ-NPC-022 / REQ-NPC-080: doc:delete of a Folder is refused even for a privileged (GM) socket, naming folder:delete", async () => {
    const raiz = await createFolder("Raiz Genérica", null);
    const filha = await createFolder("Filha Genérica", raiz);
    const dentro = await createNpc("Morador", raiz);

    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Folder",
      ids: [raiz],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(String(ack["message"])).toContain("folder:delete");

    // Nothing moved: no reparenting happened because nothing was deleted.
    const world = await readWorld(ctx.gmToken);
    expect((world["Folder"] ?? []).some((doc) => doc["_id"] === raiz)).toBe(true);
    expect((world["Folder"] ?? []).find((doc) => doc["_id"] === filha)?.["parentId"]).toBe(raiz);
    expect((world["Actor"] ?? []).find((doc) => doc["_id"] === dentro)?.["folder"]).toBe(raiz);
  });

  // Same refusal, but for TRUSTED with a self-forged `ownership` — the exact
  // path finding #14 traced: with Folder absent from GM_ONLY_CREATE_DELETE the
  // generic delete branch used `resolveOwnership` against whatever `ownership`
  // the create payload carried, and nothing forced it the way r17-P1 forces a
  // companion's. Adding Folder to GM_ONLY_CREATE_DELETE closes create for
  // TRUSTED outright (proven above), so this asserts the delete side is closed
  // independently of that, for defense in depth.
  it("REQ-NPC-022 / REQ-NPC-080: doc:delete of a Folder is refused for TRUSTED too, naming folder:delete", async () => {
    const pasta = await createFolder("Alvo TRUSTED", null);

    const trustedSocket = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    trustedSocket.connect();
    await waitForConnect(trustedSocket);

    const ack = await sendOp(trustedSocket, "doc:delete", {
      documentType: "Folder",
      ids: [pasta],
    });
    trustedSocket.disconnect();

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(String(ack["message"])).toContain("folder:delete");

    const world = await readWorld(ctx.gmToken);
    expect((world["Folder"] ?? []).some((doc) => doc["_id"] === pasta)).toBe(true);
  });
});
