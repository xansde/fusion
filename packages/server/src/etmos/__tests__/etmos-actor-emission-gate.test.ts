/**
 * REQ-NET-096: an `Actor` must not reach a user below LIMITED by ANY emission
 * path — and `broadcastToWorld` is not the only one that emits Actors.
 *
 * Two Etmos handlers build their own `doc:update` envelope and hand it to
 * `ns.emit`, bypassing `broadcastToWorld` entirely:
 *   - `conjuracao-handlers.ts` (Estresse/Fadiga after a resolved conjuração)
 *   - `progressao-handler.ts`  (the confirmed progressão patch)
 *
 * Both ship the WHOLE Actor document — `system`, `ownership`, everything the
 * store holds — so gating only the doc-handlers path leaves the requirement
 * false the moment an Etmos table plays a round. The delta-replay path is
 * already safe (these handlers push into the OpBuffer, and `filterOpsForRole`
 * gates by `documentType`), which is exactly what makes the live emit easy to
 * miss: reconnecting proves nothing, only listening does.
 *
 * The harness mirrors `conjuracao-handlers.test.ts`, with one difference that
 * is the whole point: its MockNamespace's per-socket `emit` is a no-op, so a
 * per-socket leak is invisible there. Here every socket records what it gets.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { DocumentStore } from "../../documents/store.js";
import { SeqStore } from "../../net/seq-store.js";
import { OpBuffer } from "../../net/op-buffer.js";
import { UserRole } from "../../documents/ownership.js";
import {
  buildConjuracaoProporHandler,
  buildConjuracaoArbitrarHandler,
  buildConjuracaoRolarHandler,
  buildConjuracaoResolverHandler,
  type ConjuracaoHandlerDeps,
} from "../conjuracao-handlers.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, Envelope, ChatMessage } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Harness — every socket records what it was sent
// ---------------------------------------------------------------------------

interface RecordingSocket {
  data: { userId: string; role: number };
  received: Envelope[];
  emit(event: string, envelope: Envelope): void;
}

class RecordingNamespace {
  readonly broadcasts: Envelope[] = [];
  readonly sockets = new Map<string, RecordingSocket>();

  /** Namespace-wide emit — reaches EVERY socket, gate or no gate. */
  emit(event: string, envelope: Envelope): void {
    this.broadcasts.push(envelope);
    for (const socket of this.sockets.values()) socket.received.push(envelope);
  }

  addSocket(userId: string, role: number): RecordingSocket {
    const socket: RecordingSocket = {
      data: { userId, role },
      received: [],
      emit: (_event: string, envelope: Envelope): void => {
        socket.received.push(envelope);
      },
    };
    this.sockets.set(userId, socket);
    return socket;
  }

  socketFor(userId: string): RecordingSocket {
    const s = this.sockets.get(userId);
    if (!s) throw new Error(`no socket for ${userId}`);
    return s;
  }
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: RecordingNamespace;
  deps: ConjuracaoHandlerDeps;
}

function buildHarness(): Harness {
  const dataDir = join(
    tmpdir(),
    `fusion-etmos-gate-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const opBuffer = new OpBuffer();
  const ns = new RecordingNamespace();
  ns.addSocket("gm-user", UserRole.GAMEMASTER);
  ns.addSocket("player-1", UserRole.PLAYER);
  ns.addSocket("player-2", UserRole.PLAYER);

  const deps: ConjuracaoHandlerDeps = {
    store,
    db: fusionDb.raw,
    ns: ns as unknown as ConjuracaoHandlerDeps["ns"],
    seqStore,
    opBuffer,
    worldId: "unit-world",
    rollServiceOptions: { rng: { next: () => 1000 } },
  };

  return { dataDir, fusionDb, store, seqStore, opBuffer, ns, deps };
}

function teardown(h: Harness): void {
  h.fusionDb.close();
  rmSync(h.dataDir, { recursive: true, force: true });
}

const GM_CTX: HandlerContext = {
  userId: "gm-user",
  role: UserRole.GAMEMASTER,
  worldId: "unit-world",
};

function playerCtx(userId: string): HandlerContext {
  return { userId, role: UserRole.PLAYER, worldId: "unit-world" };
}

/** An Orador owned by `ownerId` alone — `default: 0` shuts everyone else out. */
function createOrador(h: Harness, ownerId: string): string {
  const actor = h.store.create(
    "actors",
    {
      name: "Test Orador",
      type: "orador",
      ownership: { default: 0, [ownerId]: 3 },
      system: {
        atributos: {
          corpo: { value: 3, max: 6 },
          alma: { value: 3, max: 6 },
          mente: { value: 3, max: 6 },
        },
        estresse: { atual: 0, limite: 7 },
        fadiga: { estado: "normal" },
        totem: { possui: false, rank: 0 },
        attributes: { hp: { value: 30, max: 30 } },
      },
    },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

function fraseFixture(): Record<string, unknown> {
  return {
    funcao_slug: "et",
    objeto_slugs: ["imu"],
    caracteristica_slugs: [],
    criadores: [],
    modificador_slugs: [],
    intencao: "Curar um ferimento leve",
    frase_completa: "Etimu",
    complexidade: null,
    estresse_gerado: 0,
    favorita: false,
  };
}

/** Every Actor document this socket was handed, across all envelopes. */
function actorDocsSeenBy(socket: RecordingSocket): Record<string, unknown>[] {
  return socket.received.flatMap((env) => {
    if (env.type !== "doc:create" && env.type !== "doc:update") return [];
    const payload = env.payload as { documentType?: string; documents?: unknown };
    if (payload.documentType !== "Actor") return [];
    return Array.isArray(payload.documents) ? (payload.documents as Record<string, unknown>[]) : [];
  });
}

// ---------------------------------------------------------------------------

describe("Etmos Actor broadcasts respect the emission gate (REQ-NET-096)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  it("a resolved conjuração does not ship the Actor to a player with no ownership", async () => {
    const actorId = createOrador(h, "player-1");

    const proporAck = (await buildConjuracaoProporHandler(h.deps)(
      { conjuradorActorId: actorId, frase: fraseFixture() },
      playerCtx("player-1"),
    )) as Ack<{ message: ChatMessage }>;
    expect(proporAck.ok).toBe(true);
    if (!proporAck.ok) throw new Error("propor failed");
    const messageId = proporAck.result.message._id;

    await buildConjuracaoArbitrarHandler(h.deps)({ messageId, complexidade: "regular" }, GM_CTX);
    await buildConjuracaoRolarHandler(h.deps)({ messageId }, playerCtx("player-1"));

    const resolverAck = await buildConjuracaoResolverHandler(h.deps)({ messageId }, GM_CTX);
    expect((resolverAck as Ack<unknown>).ok).toBe(true);

    // The owner and the GM must see the Estresse patch...
    expect(actorDocsSeenBy(h.ns.socketFor("player-1")).map((a) => a["_id"])).toContain(actorId);
    expect(actorDocsSeenBy(h.ns.socketFor("gm-user")).map((a) => a["_id"])).toContain(actorId);

    // ...and player-2, who is not in the ownership map, must not learn the
    // actor exists, let alone its `system`.
    expect(actorDocsSeenBy(h.ns.socketFor("player-2"))).toHaveLength(0);
  });

  it("the delta replay of that same op stays available for the owner (buffer untouched)", async () => {
    const actorId = createOrador(h, "player-1");

    const proporAck = (await buildConjuracaoProporHandler(h.deps)(
      { conjuradorActorId: actorId, frase: fraseFixture() },
      playerCtx("player-1"),
    )) as Ack<{ message: ChatMessage }>;
    if (!proporAck.ok) throw new Error("propor failed");
    const messageId = proporAck.result.message._id;
    const seqBefore = h.seqStore.peek();

    await buildConjuracaoArbitrarHandler(h.deps)({ messageId, complexidade: "regular" }, GM_CTX);
    await buildConjuracaoRolarHandler(h.deps)({ messageId }, playerCtx("player-1"));
    await buildConjuracaoResolverHandler(h.deps)({ messageId }, GM_CTX);

    // Gating the LIVE emit must not remove the op from the shared buffer —
    // `filterOpsForRole` is what redacts the replay, per viewer.
    const replay = h.opBuffer.opsAfter(seqBefore, h.seqStore.peek()) ?? [];
    const actorOps = replay.filter((op) => {
      const p = op.payload as { documentType?: string };
      return op.type === "doc:update" && p.documentType === "Actor";
    });
    expect(actorOps.length).toBeGreaterThanOrEqual(1);
  });
});
