/**
 * mark-handler.test.ts — TokenMark (BHR-F3-06, REQ-BHR-086..090).
 *
 * The Prey is persisted on the actor that marked (`flags.fusion.tokenMarks`),
 * set/cleared by `mark:set`/`mark:clear`, and read back by the roll resolver
 * through the `TokenMarkSource` (`getMarksOn`). The rule, written here and not
 * borrowed from the pack: a player marks only on an actor they OWN and only a
 * token that is in their live target selection; a new Hunt Prey replaces the
 * previous one; the mark outlives the turn (the target does not).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Namespace } from "socket.io";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { DocumentStore } from "../../documents/store.js";
import { SeqStore } from "../../net/seq-store.js";
import { OpBuffer } from "../../net/op-buffer.js";
import { UserRole } from "../../documents/ownership.js";
import { RollService } from "../../chat/roll-service.js";
import { InitiativeFormulaRegistry } from "../initiative-registry.js";
import { CombatEventBus } from "../combat-event-bus.js";
import { TargetingStore } from "../targeting-store.js";
import { buildCombatTargetHandler, registerTargetingCleanup } from "../target-handler.js";
import {
  buildCombatCreateHandler,
  buildCombatAddCombatantHandler,
  buildCombatStartHandler,
  buildCombatNextHandler,
} from "../combat-handlers.js";
import type { CombatHandlerDeps } from "../combat-handlers.js";
import {
  buildMarkSetHandler,
  buildMarkClearHandler,
  createTokenMarkSource,
} from "../mark-handler.js";
import type { MarkHandlerDeps } from "../mark-handler.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, CombatDocument, TokenMark } from "@fusion/shared";
import { readTokenMarks } from "@fusion/shared";

const WORLD_ID = "mark-handler-world";
const GM_CTX: HandlerContext = { userId: "gm-user", role: UserRole.GAMEMASTER, worldId: WORLD_ID };
const playerCtx = (userId: string): HandlerContext => ({
  userId,
  role: UserRole.PLAYER,
  worldId: WORLD_ID,
});

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  targetingStore: TargetingStore;
  eventBus: CombatEventBus;
  markDeps: MarkHandlerDeps;
  combatDeps: CombatHandlerDeps;
  emitted: unknown[];
}

function buildHarness(): Harness {
  const dataDir = join(
    tmpdir(),
    `fusion-mark-handler-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const emitted: unknown[] = [];
  const ns = {
    emit: (_event: string, payload: unknown) => emitted.push(payload),
    sockets: new Map(),
  } as unknown as Namespace;
  const targetingStore = new TargetingStore();
  const eventBus = new CombatEventBus();
  const opBuffer = new OpBuffer();
  const formulaRegistry = new InitiativeFormulaRegistry(
    new RollService({ db: fusionDb.raw }),
    WORLD_ID,
  );
  return {
    dataDir,
    fusionDb,
    store,
    targetingStore,
    eventBus,
    emitted,
    markDeps: { store, seqStore, opBuffer, ns, targetingStore },
    combatDeps: {
      store,
      seqStore,
      opBuffer,
      ns,
      formulaRegistry,
      eventBus,
      db: fusionDb.raw,
      worldId: WORLD_ID,
    },
  };
}

function createActor(h: Harness, name: string, ownerId?: string): string {
  const ownership: Record<string, number> = { default: 0 };
  if (ownerId) ownership[ownerId] = 3;
  return h.store.create(
    "actors",
    { name, type: "character", ownership },
    { userId: GM_CTX.userId },
  )["_id"] as string;
}

function createScene(
  h: Harness,
  tokens: Array<{ _id: string; name: string; actorId: string; hidden?: boolean }>,
): string {
  return h.store.create("scenes", { name: "Cena", tokens }, { userId: GM_CTX.userId })[
    "_id"
  ] as string;
}

const marksOf = (h: Harness, actorId: string): TokenMark[] =>
  readTokenMarks(h.store.get("actors", actorId));

describe("TokenMark — mark:set / mark:clear (BHR-F3-06)", () => {
  let h: Harness;
  let ranger: string;
  let stranger: string;
  let ogre: string;
  let wolf: string;
  let sceneId: string;
  let set: ReturnType<typeof buildMarkSetHandler>;
  let clear: ReturnType<typeof buildMarkClearHandler>;
  let target: ReturnType<typeof buildCombatTargetHandler>;

  beforeEach(() => {
    h = buildHarness();
    ranger = createActor(h, "Ranger", "player-p");
    stranger = createActor(h, "Alheio", "player-q");
    ogre = createActor(h, "Ogro");
    wolf = createActor(h, "Lobo");
    sceneId = createScene(h, [
      { _id: "tok-ogre", name: "Ogro", actorId: ogre },
      { _id: "tok-wolf", name: "Lobo", actorId: wolf },
    ]);
    set = buildMarkSetHandler(h.markDeps);
    clear = buildMarkClearHandler(h.markDeps);
    target = buildCombatTargetHandler({ ...h.markDeps });
  });

  afterEach(() => {
    h.fusionDb.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });

  const huntPrey = (tokenId: string) => ({
    sourceActorId: ranger,
    mark: { slug: "hunted-prey", targetTokenId: tokenId },
  });

  it("player marks a token in their own target selection: persisted on the marking actor, server fills the rest", async () => {
    await target({ tokenId: "tok-ogre", targeted: true }, playerCtx("player-p"));
    const ack = await set(huntPrey("tok-ogre"), playerCtx("player-p"));
    expect(ack.ok, JSON.stringify(ack)).toBe(true);

    const marks = marksOf(h, ranger);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      slug: "hunted-prey",
      targetTokenId: "tok-ogre",
      targetActorId: ogre,
      sceneId,
      exclusive: true,
    });
    expect(typeof marks[0]?.createdAt).toBe("number");
    expect(h.emitted.length).toBeGreaterThan(0);
  });

  it("player cannot mark a token outside their target selection (PERMISSION_DENIED)", async () => {
    const ack = await set(huntPrey("tok-ogre"), playerCtx("player-p"));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(marksOf(h, ranger)).toEqual([]);
  });

  it("player cannot mark on an actor they do not own, even with the token targeted", async () => {
    await target({ tokenId: "tok-ogre", targeted: true }, playerCtx("player-p"));
    const ack = await set(
      { sourceActorId: stranger, mark: { slug: "hunted-prey", targetTokenId: "tok-ogre" } },
      playerCtx("player-p"),
    );
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(marksOf(h, stranger)).toEqual([]);
  });

  it("the GM marks on any actor without needing a target selection", async () => {
    const ack = await set(huntPrey("tok-wolf"), GM_CTX);
    expect(ack.ok).toBe(true);
    expect(marksOf(h, ranger).map((m) => m.targetTokenId)).toEqual(["tok-wolf"]);
  });

  it("refuses a token that does not exist (VALIDATION_FAILED), a missing actor (NOT_FOUND) and a malformed payload", async () => {
    expect(await set(huntPrey("ghost"), GM_CTX)).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(
      await set(
        { sourceActorId: "nope", mark: { slug: "hunted-prey", targetTokenId: "tok-ogre" } },
        GM_CTX,
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await set({ sourceActorId: ranger }, GM_CTX)).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  it("a second Hunt Prey replaces the first (exclusive); the client cannot opt out of it", async () => {
    await set(huntPrey("tok-ogre"), GM_CTX);
    await set(
      {
        sourceActorId: ranger,
        mark: { slug: "hunted-prey", targetTokenId: "tok-wolf", exclusive: false },
      },
      GM_CTX,
    );
    const marks = marksOf(h, ranger);
    expect(marks.map((m) => m.targetTokenId)).toEqual(["tok-wolf"]);
    expect(marks[0]?.exclusive).toBe(true);
  });

  it("a non-exclusive slug accumulates across tokens; the same slug+token is not duplicated", async () => {
    const monsterHunter = (tokenId: string) => ({
      sourceActorId: ranger,
      mark: { slug: "monster-hunter", targetTokenId: tokenId },
    });
    await set(monsterHunter("tok-ogre"), GM_CTX);
    await set(monsterHunter("tok-wolf"), GM_CTX);
    await set(monsterHunter("tok-wolf"), GM_CTX);
    expect(
      marksOf(h, ranger)
        .map((m) => m.targetTokenId)
        .sort(),
    ).toEqual(["tok-ogre", "tok-wolf"]);
    // A Hunt Prey does not disturb another slug.
    await set(huntPrey("tok-ogre"), GM_CTX);
    expect(marksOf(h, ranger)).toHaveLength(3);
  });

  it("mark:clear: the owner clears; a stranger is refused; the GM clears anything", async () => {
    await set(huntPrey("tok-ogre"), GM_CTX);
    const denied = await clear(
      { sourceActorId: ranger, slug: "hunted-prey" },
      playerCtx("player-q"),
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(marksOf(h, ranger)).toHaveLength(1);

    // The owner needs NO live target to remove a mark.
    const ok = await clear({ sourceActorId: ranger, slug: "hunted-prey" }, playerCtx("player-p"));
    expect(ok.ok).toBe(true);
    expect(marksOf(h, ranger)).toEqual([]);

    await set(huntPrey("tok-wolf"), GM_CTX);
    const gmClear = await clear(
      { sourceActorId: ranger, slug: "hunted-prey", targetTokenId: "tok-wolf" },
      GM_CTX,
    );
    expect(gmClear.ok).toBe(true);
    expect(marksOf(h, ranger)).toEqual([]);
  });

  it("the mark survives turnEnd while the live target is cleared (REQ-CBT-055 vs DC-03)", async () => {
    registerTargetingCleanup({ ...h.markDeps }, h.eventBus);
    await target({ tokenId: "tok-ogre", targeted: true }, playerCtx("player-p"));
    expect((await set(huntPrey("tok-ogre"), playerCtx("player-p"))).ok).toBe(true);

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);
    const createAck = (await create({ sceneId }, GM_CTX)) as Ack<{ combat: CombatDocument }>;
    if (!createAck.ok) throw new Error("combat:create failed");
    const combatId = createAck.result.combat._id;
    await add({ combatId, tokenId: "tok-pc", actorId: ranger, initiative: 20 }, GM_CTX);
    await add({ combatId, tokenId: "tok-other", actorId: wolf, initiative: 10 }, GM_CTX);
    await begin({ combatId }, GM_CTX);
    await next({ combatId }, GM_CTX); // ends the ranger's turn

    expect([...h.targetingStore.getTargetsForUser("player-p")]).toEqual([]);
    expect(marksOf(h, ranger).map((m) => m.targetTokenId)).toEqual(["tok-ogre"]);
  });

  it("getMarksOn / TokenMarkSource: the roll resolver reads the ROLLER's marks on that token only", async () => {
    await set(huntPrey("tok-ogre"), GM_CTX);
    await set(
      { sourceActorId: stranger, mark: { slug: "monster-hunter", targetTokenId: "tok-ogre" } },
      GM_CTX,
    );
    const source = createTokenMarkSource(h.store);
    const q = (rollerActorId: string, targetTokenId: string) => ({
      rollerActorId,
      targetTokenId,
      targetActorId: null,
    });
    expect(source.marksOn(q(ranger, "tok-ogre"))).toEqual(["hunted-prey"]);
    expect(source.marksOn(q(stranger, "tok-ogre"))).toEqual(["monster-hunter"]);
    expect(source.marksOn(q(ranger, "tok-wolf"))).toEqual([]);
    expect(source.marksOn(q("nobody", "tok-ogre"))).toEqual([]);
  });
});

describe("TokenMark — o companheiro ativo herda a Presa do dono (BHR-F4-11, REQ-PET-122, DC-08)", () => {
  let h: Harness;
  let ranger: string;
  let stranger: string;
  let ogre: string;

  beforeEach(() => {
    h = buildHarness();
    ranger = createActor(h, "Ranger", "player-p");
    stranger = createActor(h, "Alheio", "player-q");
    ogre = createActor(h, "Ogro");
    createScene(h, [{ _id: "tok-ogre", name: "Ogro", actorId: ogre }]);
  });

  afterEach(() => {
    h.fusionDb.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });

  const companionOf = (master: string, name: string, companion?: Record<string, unknown>) =>
    h.store.create(
      "actors",
      {
        name,
        type: "familiar",
        system: {
          companionKind: "animalCompanion",
          masterActorId: master,
          ...(companion === undefined ? {} : { companion }),
        },
      },
      { userId: GM_CTX.userId },
    )["_id"] as string;

  const q = (rollerActorId: string) => ({
    rollerActorId,
    targetTokenId: "tok-ogre",
    targetActorId: null,
  });

  async function markBoth(): Promise<void> {
    const set = buildMarkSetHandler(h.markDeps);
    await set(
      { sourceActorId: ranger, mark: { slug: "hunted-prey", targetTokenId: "tok-ogre" } },
      GM_CTX,
    );
    await set(
      { sourceActorId: ranger, mark: { slug: "monster-hunter", targetTokenId: "tok-ogre" } },
      GM_CTX,
    );
  }

  it("o companheiro ativo (sem o campo, ou active: true) rola contra a presa do dono", async () => {
    await markBoth();
    const legacy = companionOf(ranger, "Urso");
    const explicit = companionOf(ranger, "Lobo", { active: true });
    const source = createTokenMarkSource(h.store);
    // Only the Prey and its Outwit travel: Monster Hunter is the Ranger's own mark.
    expect(source.marksOn(q(legacy))).toEqual(["hunted-prey"]);
    expect(source.marksOn(q(explicit))).toEqual(["hunted-prey"]);
    // The owner still has both.
    expect([...source.marksOn(q(ranger))].sort()).toEqual(["hunted-prey", "monster-hunter"]);
  });

  it("o companheiro inativo não herda", async () => {
    await markBoth();
    const inactive = companionOf(ranger, "Lobo", { active: false });
    expect(createTokenMarkSource(h.store).marksOn(q(inactive))).toEqual([]);
  });

  it("o companheiro de outro dono não herda", async () => {
    await markBoth();
    const theirs = companionOf(stranger, "Cervo", { active: true });
    expect(createTokenMarkSource(h.store).marksOn(q(theirs))).toEqual([]);
  });

  it("só o companheiro animal herda: familiar comum ou ator solto não", async () => {
    await markBoth();
    const familiar = h.store.create(
      "actors",
      {
        name: "Gato",
        type: "familiar",
        system: { companionKind: "familiar", masterActorId: ranger },
      },
      { userId: GM_CTX.userId },
    )["_id"] as string;
    expect(createTokenMarkSource(h.store).marksOn(q(familiar))).toEqual([]);
  });
});
