/**
 * apply-condition-handler.test.ts — `actor:applyCondition` (ALQ-F1-09).
 *
 * Direct handler-level harness (no socket transport) — same lightweight style
 * as target-selection.test.ts: this suite exercises the CORE's own
 * permission/target-resolution logic (REQ-SYS-142's applyCondition clause,
 * REQ-CBT-056), never a pf2e rule, via a FAKE ActorMechanics (so it can never
 * be circular against a pack — the r22 "#48" lesson; the real pf2e rule is
 * already covered, non-circularly, by
 * systems/pf2e/src/__tests__/resolve-condition-application.test.ts, ALQ-F1-07).
 *
 * Covers this task's own TDD acceptance (plan tasks.md, ALQ-F1-09):
 *   - player applies `frightened 1` on a MARKED goblin -> item created with value 1.
 *   - player applies on an UNMARKED goblin -> FORBIDDEN, nothing written.
 *   - `remove` of an absent condition -> ok, no-op (no item created/removed).
 * Plus direct coverage of the permission contract the task's own "Entrega"
 * bullet promises: GM targets any actor (untargeted, unowned), a player's own
 * `selfActorId` (no live selection needed), a non-owned `selfActorId` is
 * FORBIDDEN, no target specified is VALIDATION_FAILED, and no registered
 * mechanics is NOT_SUPPORTED.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142. Spec: 17-sistema-pf2e.md
 * REQ-PF2-215. Spec: 10-combate-e-iniciativa.md REQ-CBT-056. Plan:
 * docs/design/alquimista/tasks.md §2.4, task ALQ-F1-09.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { TargetingStore } from "../targeting-store.js";
import { buildCombatTargetHandler } from "../target-handler.js";
import type { TargetHandlerDeps } from "../target-handler.js";
import { createActorMechanicsService } from "../actor-mechanics-service.js";
import type { ActorMechanicsService } from "../actor-mechanics-service.js";
import { buildApplyConditionHandler } from "../apply-condition-handler.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import { defineSystem } from "@fusion/system-api";
import type { SystemModule, ActorMechanics, ActorMechanicsPatch } from "@fusion/system-api";

const WORLD_ID = "apply-condition-world";

const VALID_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

// ---------------------------------------------------------------------------
// Fake ActorMechanics — a minimal, deliberately NOT-pf2e "create/delete a
// condition item" rule. This suite asserts the CORE's permission/target
// resolution (REQ-SYS-142/REQ-CBT-056), never IWR/stacking/dying-pulls-
// unconscious (ALQ-F1-07's own, already-tested scope), so it can never be
// circular against a pack.
// ---------------------------------------------------------------------------

function makeFakeActorMechanics(): ActorMechanics {
  return {
    applyDamage(): ActorMechanicsPatch {
      throw new Error("applyDamage is not exercised by this suite (ALQ-F1-09)");
    },
    applyCondition(actor, req): ActorMechanicsPatch {
      const items = Array.isArray(actor["items"])
        ? (actor["items"] as Record<string, unknown>[])
        : [];
      const existing = items.find((item) => {
        const system = item["system"];
        return (
          item["type"] === "condition" &&
          system !== null &&
          typeof system === "object" &&
          (system as Record<string, unknown>)["slug"] === req.slug
        );
      });
      const embeddedCreate: Record<string, unknown>[] = [];
      const embeddedDelete: string[] = [];

      if (req.mode === "remove") {
        // Absent -> no-op (this task's own TDD case): nothing to create or
        // delete when `existing` is undefined.
        if (existing && typeof existing["_id"] === "string") {
          embeddedDelete.push(existing["_id"]);
        }
      } else {
        // add/set/increase/decrease all collapse, for this fake, to "replace
        // with an item carrying req.value" — stacking/immunity rules are
        // ALQ-F1-07's pf2e-specific scope, not this core suite's.
        if (existing && typeof existing["_id"] === "string") {
          embeddedDelete.push(existing["_id"]);
        }
        embeddedCreate.push({
          _id: `fake-cond-${req.slug}`,
          type: "condition",
          name: req.slug,
          system: {
            slug: req.slug,
            ...(req.value !== null && req.value !== undefined ? { value: req.value } : {}),
          },
        });
      }

      return {
        diff: {},
        embeddedCreate,
        embeddedDelete,
        breakdown: [],
        flags: { droppedToZero: false, dead: req.slug === "dead", dyingChanged: false },
      };
    },
  };
}

function makeSystemModule(): SystemModule {
  return defineSystem({ ...VALID_MANIFEST }, (r) => {
    r.registerActorMechanics(makeFakeActorMechanics());
  });
}

// ---------------------------------------------------------------------------
// Harness — direct handler-function calls, no socket transport (same style
// as target-selection.test.ts).
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-apply-condition-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal fake Namespace — the condition path never emits through it, but
 * ActorMechanicsServiceDeps requires one (shared shape with applyDamage). */
function fakeNs(): Namespace {
  return { emit: () => {}, sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  targetingStore: TargetingStore;
  targetDeps: TargetHandlerDeps;
  ns: Namespace;
  service: ActorMechanicsService;
  handler: ReturnType<typeof buildApplyConditionHandler>;
}

function buildHarness(withMechanics = true): Harness {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const ns = fakeNs();
  const targetingStore = new TargetingStore();
  const targetDeps: TargetHandlerDeps = { store, seqStore, ns, targetingStore };

  const service = createActorMechanicsService({
    store,
    db: fusionDb.raw,
    ns,
    seqStore,
    opBuffer: new OpBuffer(),
    targetingStore,
    worldId: WORLD_ID,
    systemModule: withMechanics ? makeSystemModule() : undefined,
  });
  const handler = buildApplyConditionHandler({ service });

  return { dataDir, fusionDb, store, targetingStore, targetDeps, ns, service, handler };
}

function teardown(h: Harness): void {
  h.fusionDb.close();
  rmSync(h.dataDir, { recursive: true, force: true });
}

const GM_CTX: HandlerContext = { userId: "gm-user", role: UserRole.GAMEMASTER, worldId: WORLD_ID };
function playerCtx(userId: string): HandlerContext {
  return { userId, role: UserRole.PLAYER, worldId: WORLD_ID };
}

function createSceneWithTokens(
  h: Harness,
  tokens: Array<{ _id: string; name: string; actorId: string; hidden?: boolean }>,
): string {
  const scene = h.store.create("scenes", { name: "Unit Scene", tokens }, { userId: GM_CTX.userId });
  return scene["_id"] as string;
}

function createActor(h: Harness, name: string, ownerId?: string): string {
  const ownership: Record<string, number> = { default: 0 };
  if (ownerId) ownership[ownerId] = 3; // OWNER
  const actor = h.store.create(
    "actors",
    { name, type: "character", ownership },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

function readConditionValue(h: Harness, actorId: string, slug: string): number | undefined {
  const actor = h.store.get("actors", actorId);
  const items = Array.isArray(actor["items"]) ? (actor["items"] as Record<string, unknown>[]) : [];
  const item = items.find((i) => {
    const system = i["system"];
    return (
      i["type"] === "condition" &&
      system !== null &&
      typeof system === "object" &&
      (system as Record<string, unknown>)["slug"] === slug
    );
  });
  const value = (item?.["system"] as Record<string, unknown> | undefined)?.["value"];
  return typeof value === "number" ? value : undefined;
}

function hasCondition(h: Harness, actorId: string, slug: string): boolean {
  const actor = h.store.get("actors", actorId);
  const items = Array.isArray(actor["items"]) ? (actor["items"] as Record<string, unknown>[]) : [];
  return items.some((i) => {
    const system = i["system"];
    return (
      i["type"] === "condition" &&
      system !== null &&
      typeof system === "object" &&
      (system as Record<string, unknown>)["slug"] === slug
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("actor:applyCondition — ActorMechanicsService (ALQ-F1-09, REQ-SYS-142/REQ-PF2-215/REQ-CBT-056)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  it("player aplica frightened 1 em goblin MARCADO -> item criado com value 1", async () => {
    const goblin = createActor(h, "Goblin");
    createSceneWithTokens(h, [{ _id: "tok-goblin", name: "Goblin", actorId: goblin }]);

    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-goblin", targeted: true }, playerCtx("player-p"));

    const ack = await h.handler(
      { targetTokenIds: ["tok-goblin"], slug: "frightened", mode: "add", value: 1 },
      playerCtx("player-p"),
    );
    expect(ack.ok, JSON.stringify(ack)).toBe(true);
    expect(readConditionValue(h, goblin, "frightened")).toBe(1);
  });

  it("goblin NÃO marcado -> FORBIDDEN, nada escrito", async () => {
    const goblin = createActor(h, "Goblin");
    createSceneWithTokens(h, [{ _id: "tok-goblin", name: "Goblin", actorId: goblin }]);

    const ack = await h.handler(
      { targetTokenIds: ["tok-goblin"], slug: "frightened", mode: "add", value: 1 },
      playerCtx("player-p"),
    );
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
    expect(hasCondition(h, goblin, "frightened")).toBe(false);
  });

  it("remove de condição ausente -> ok, no-op", async () => {
    const goblin = createActor(h, "Goblin");
    createSceneWithTokens(h, [{ _id: "tok-goblin", name: "Goblin", actorId: goblin }]);

    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-goblin", targeted: true }, playerCtx("player-p"));

    const ack = await h.handler(
      { targetTokenIds: ["tok-goblin"], slug: "sickened", mode: "remove" },
      playerCtx("player-p"),
    );
    expect(ack.ok, JSON.stringify(ack)).toBe(true);
    expect(hasCondition(h, goblin, "sickened")).toBe(false);
  });

  it("GM aplica em QUALQUER ator — sem precisar de alvo marcado nem de ownership", async () => {
    const goblin = createActor(h, "Goblin"); // not owned by the GM's user, not targeted
    createSceneWithTokens(h, [{ _id: "tok-goblin", name: "Goblin", actorId: goblin }]);

    const ack = await h.handler(
      { targetTokenIds: ["tok-goblin"], slug: "clumsy", mode: "add", value: 2 },
      GM_CTX,
    );
    expect(ack.ok, JSON.stringify(ack)).toBe(true);
    expect(readConditionValue(h, goblin, "clumsy")).toBe(2);
  });

  it("player aplica em si mesmo via selfActorId — não precisa de seleção viva", async () => {
    const pc = createActor(h, "PC do jogador", "player-p");

    const ack = await h.handler(
      { targetTokenIds: [], selfActorId: pc, slug: "quickened", mode: "add" },
      playerCtx("player-p"),
    );
    expect(ack.ok, JSON.stringify(ack)).toBe(true);
    expect(hasCondition(h, pc, "quickened")).toBe(true);
  });

  it("player tenta selfActorId de um ator que NÃO possui -> FORBIDDEN", async () => {
    const npc = createActor(h, "NPC de outra pessoa"); // no ownership grant

    const ack = await h.handler(
      { targetTokenIds: [], selfActorId: npc, slug: "quickened", mode: "add" },
      playerCtx("player-p"),
    );
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
    expect(hasCondition(h, npc, "quickened")).toBe(false);
  });

  // BHR-F6-02 (REQ-BHR-202): with `source.messageId`, a player's targets are
  // bounded by that message's frozen targetSnapshot, not by the live selection.
  describe("source.messageId — alvos limitados à targetSnapshot da mensagem", () => {
    function setup(): { pc: string; goblin: string; orc: string; messageId: string } {
      const pc = createActor(h, "PC do jogador", "player-p");
      const goblin = createActor(h, "Goblin");
      const orc = createActor(h, "Orc");
      const sceneId = createSceneWithTokens(h, [
        { _id: "tok-goblin", name: "Goblin", actorId: goblin },
        { _id: "tok-orc", name: "Orc", actorId: orc },
      ]);
      const msg = h.store.create(
        "chat_messages",
        {
          author: "player-p",
          timestamp: Date.now(),
          speaker: { actorId: pc },
          flags: {
            fusion: {
              targetSnapshot: [{ tokenId: "tok-goblin", actorId: goblin, sceneId }],
            },
          },
        },
        { userId: "player-p" },
      );
      return { pc, goblin, orc, messageId: msg["_id"] as string };
    }

    it("player aplica no alvo da foto SEM seleção viva -> ok", async () => {
      const { goblin, messageId } = setup();
      const ack = await h.handler(
        {
          targetTokenIds: ["tok-goblin"],
          slug: "prone",
          mode: "add",
          source: { messageId },
        },
        playerCtx("player-p"),
      );
      expect(ack.ok, JSON.stringify(ack)).toBe(true);
      expect(hasCondition(h, goblin, "prone")).toBe(true);
    });

    it("player em alvo FORA da foto, mesmo marcado ao vivo -> FORBIDDEN", async () => {
      const { orc, messageId } = setup();
      const target = buildCombatTargetHandler(h.targetDeps);
      await target({ tokenId: "tok-orc", targeted: true }, playerCtx("player-p"));
      const ack = await h.handler(
        { targetTokenIds: ["tok-orc"], slug: "prone", mode: "add", source: { messageId } },
        playerCtx("player-p"),
      );
      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
      expect(hasCondition(h, orc, "prone")).toBe(false);
    });

    it("outro jogador (não dono do autor da mensagem) -> FORBIDDEN", async () => {
      const { goblin, messageId } = setup();
      const ack = await h.handler(
        { targetTokenIds: ["tok-goblin"], slug: "prone", mode: "add", source: { messageId } },
        playerCtx("player-q"),
      );
      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
      expect(hasCondition(h, goblin, "prone")).toBe(false);
    });

    it("messageId inexistente -> FORBIDDEN", async () => {
      const { goblin } = setup();
      const ack = await h.handler(
        {
          targetTokenIds: ["tok-goblin"],
          slug: "prone",
          mode: "add",
          source: { messageId: "nao-existe" },
        },
        playerCtx("player-p"),
      );
      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
      expect(hasCondition(h, goblin, "prone")).toBe(false);
    });

    // BHR-F7-05 D1: a maneuver card (Derrubar) is an announcement with NO
    // snapshot; the graded skill check nests under it (flags.fusion.parentMessageId)
    // and carries the frozen snapshot. The card's button names the card.
    describe("card de manobra: a foto está na rolagem aninhada", () => {
      function setupCard(
        childAuthor: string,
        childSpeakerActor?: string,
        hidden = false,
      ): {
        ogre: string;
        cardId: string;
      } {
        const pc = createActor(h, "PC do jogador", "player-p");
        const ogre = createActor(h, "Ogro");
        const sceneId = createSceneWithTokens(h, [
          { _id: "tok-ogre", name: "Ogro", actorId: ogre, hidden },
        ]);
        const card = h.store.create(
          "chat_messages",
          {
            author: "player-p",
            timestamp: Date.now(),
            speaker: { actorId: pc, userId: "player-p" },
          },
          { userId: "player-p" },
        );
        const cardId = card["_id"] as string;
        h.store.create(
          "chat_messages",
          {
            author: childAuthor,
            timestamp: Date.now(),
            speaker: { actorId: childSpeakerActor ?? pc, userId: childAuthor },
            flags: {
              fusion: {
                parentMessageId: cardId,
                targetSnapshot: [{ tokenId: "tok-ogre", actorId: ogre, sceneId }],
              },
            },
          },
          { userId: childAuthor },
        );
        return { ogre, cardId };
      }

      it("dono aplica no alvo da foto da rolagem aninhada -> ok", async () => {
        const { ogre, cardId } = setupCard("player-p");
        const ack = await h.handler(
          {
            targetTokenIds: ["tok-ogre"],
            slug: "prone",
            mode: "add",
            source: { messageId: cardId },
          },
          playerCtx("player-p"),
        );
        expect(ack.ok, JSON.stringify(ack)).toBe(true);
        expect(hasCondition(h, ogre, "prone")).toBe(true);
      });

      it("rolagem aninhada de OUTRO falante não vale como foto -> FORBIDDEN", async () => {
        const other = createActor(h, "Outro PC", "player-q");
        const { ogre, cardId } = setupCard("player-q", other);
        const ack = await h.handler(
          {
            targetTokenIds: ["tok-ogre"],
            slug: "prone",
            mode: "add",
            source: { messageId: cardId },
          },
          playerCtx("player-p"),
        );
        expect(ack.ok).toBe(false);
        if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
        expect(hasCondition(h, ogre, "prone")).toBe(false);
      });

      // BHR-F7-05 revisão M1: a foto aninhada só vale se o AUTOR da rolagem também for o do card. O Mestre que rola
      // "dano" no card do jogador fala como o PC, mas a mira dele não é a do jogador.
      it("rolagem aninhada do Mestre falando como o PC NÃO vale como foto -> FORBIDDEN", async () => {
        const { ogre, cardId } = setupCard("gm-user");
        const ack = await h.handler(
          {
            targetTokenIds: ["tok-ogre"],
            slug: "prone",
            mode: "add",
            source: { messageId: cardId },
          },
          playerCtx("player-p"),
        );
        expect(ack.ok).toBe(false);
        if (!ack.ok) expect(ack.code).toBe("FORBIDDEN");
        expect(hasCondition(h, ogre, "prone")).toBe(false);
      });

      // BHR-F7-05 revisão I2: a busca da rolagem aninhada é uma consulta direcionada, nunca a tabela inteira.
      it("não lê o chat inteiro para achar as rolagens aninhadas", async () => {
        const { cardId } = setupCard("player-p");
        const getAll = vi.spyOn(h.store, "getAll");
        const ack = await h.handler(
          {
            targetTokenIds: ["tok-ogre"],
            slug: "prone",
            mode: "add",
            source: { messageId: cardId },
          },
          playerCtx("player-p"),
        );
        expect(ack.ok, JSON.stringify(ack)).toBe(true);
        expect(getAll.mock.calls.filter(([t]) => t === "chat_messages")).toHaveLength(0);
      });

      // BHR-F7-05 revisão I1/N1: o servidor grava no card de origem quais alvos já receberam a condição e propaga
      // a atualização da mensagem; o botão de qualquer visão lê isso.
      describe("registro no card de origem (appliedConditions)", () => {
        function addSocket(
          userId: string,
          role: number,
        ): { emitted: Array<Record<string, unknown>> } {
          const emitted: Array<Record<string, unknown>> = [];
          (h.ns.sockets as unknown as Map<string, unknown>).set(userId, {
            data: { userId, role },
            emit: (_event: string, envelope: Record<string, unknown>) => emitted.push(envelope),
          });
          return { emitted };
        }
        const applied = (msg: Record<string, unknown>): unknown =>
          (
            (msg["flags"] as Record<string, Record<string, unknown>> | undefined)?.["fusion"] as
              | Record<string, unknown>
              | undefined
          )?.["appliedConditions"];

        it("grava o token aplicado em appliedConditions e persiste", async () => {
          const { cardId } = setupCard("player-p");
          const ack = await h.handler(
            {
              targetTokenIds: ["tok-ogre"],
              slug: "prone",
              mode: "add",
              source: { messageId: cardId },
            },
            playerCtx("player-p"),
          );
          expect(ack.ok, JSON.stringify(ack)).toBe(true);
          expect(applied(h.store.get("chat_messages", cardId))).toEqual({
            "add:prone": ["tok-ogre"],
          });
        });

        it("o Mestre aplicando também grava, e reaplicar não duplica", async () => {
          const { cardId } = setupCard("player-p");
          const payload = {
            targetTokenIds: ["tok-ogre"],
            slug: "prone",
            mode: "add" as const,
            source: { messageId: cardId },
          };
          await h.handler(payload, GM_CTX);
          await h.handler(payload, GM_CTX);
          expect(applied(h.store.get("chat_messages", cardId))).toEqual({
            "add:prone": ["tok-ogre"],
          });
        });

        it("sem source.messageId nada é gravado em nenhuma mensagem", async () => {
          const { cardId } = setupCard("player-p");
          await h.handler({ targetTokenIds: ["tok-ogre"], slug: "prone", mode: "add" }, GM_CTX);
          expect(applied(h.store.get("chat_messages", cardId))).toBeUndefined();
        });

        it("recusa não grava nada", async () => {
          const { cardId } = setupCard("gm-user");
          await h.handler(
            {
              targetTokenIds: ["tok-ogre"],
              slug: "prone",
              mode: "add",
              source: { messageId: cardId },
            },
            playerCtx("player-p"),
          );
          expect(applied(h.store.get("chat_messages", cardId))).toBeUndefined();
        });

        it("propaga doc:update do card aos sockets; token oculto só chega ao Mestre", async () => {
          const { cardId } = setupCard("player-p", undefined, true);
          const gm = addSocket("gm-user", UserRole.GAMEMASTER);
          const player = addSocket("player-p", UserRole.PLAYER);
          const ack = await h.handler(
            {
              targetTokenIds: ["tok-ogre"],
              slug: "prone",
              mode: "add",
              source: { messageId: cardId },
            },
            GM_CTX,
          );
          expect(ack.ok, JSON.stringify(ack)).toBe(true);
          const docOf = (e: Array<Record<string, unknown>>): Record<string, unknown> => {
            // O doc:update do ator alvo (D3) também passa por aqui: o do card é o que leva o `cardId`.
            const env = e.find(
              (x) =>
                x["type"] === "doc:update" &&
                (x["payload"] as { documents?: Array<Record<string, unknown>> }).documents?.[0]?.[
                  "_id"
                ] === cardId,
            );
            const docs = (env?.["payload"] as { documents: Array<Record<string, unknown>> })
              .documents;
            return docs[0]!;
          };
          expect(docOf(gm.emitted)["_id"]).toBe(cardId);
          expect(applied(docOf(gm.emitted))).toEqual({ "add:prone": ["tok-ogre"] });
          expect(applied(docOf(player.emitted))).toEqual({ "add:prone": [] });
        });

        // BHR-F7-06 D3: o servidor gravava a condição no ator e NÃO avisava ninguém. Os espelhos (Mestre e jogador)
        // ficavam com o ator antigo, e o botão "Caído aplicado" lia esse estado velho até recarregar a página.
        it("propaga doc:update do ATOR alvo com a condição, para o Mestre e para o jogador", async () => {
          const { ogre, cardId } = setupCard("player-p");
          const gm = addSocket("gm-user", UserRole.GAMEMASTER);
          const player = addSocket("player-p", UserRole.PLAYER);
          const ack = await h.handler(
            {
              targetTokenIds: ["tok-ogre"],
              slug: "prone",
              mode: "add",
              source: { messageId: cardId },
            },
            GM_CTX,
          );
          expect(ack.ok, JSON.stringify(ack)).toBe(true);
          const actorDoc = (
            e: Array<Record<string, unknown>>,
          ): Record<string, unknown> | undefined => {
            for (const env of e) {
              const payload = env["payload"] as
                | { documentType?: string; documents?: Array<Record<string, unknown>> }
                | undefined;
              if (env["type"] !== "doc:update" || payload?.documentType !== "Actor") continue;
              const found = payload.documents?.find((d) => d["_id"] === ogre);
              if (found) return found;
            }
            return undefined;
          };
          for (const who of [gm, player]) {
            const doc = actorDoc(who.emitted);
            expect(doc, "o ator alvo chegou no doc:update").toBeDefined();
            const items = (doc?.["items"] ?? []) as Array<Record<string, unknown>>;
            expect(
              items.some(
                (i) =>
                  i["type"] === "condition" &&
                  (i["system"] as { slug?: string } | undefined)?.slug === "prone",
              ),
            ).toBe(true);
          }
        });
      });
    });

    it("GM aplica em qualquer ator mesmo fora da foto", async () => {
      const { orc, messageId } = setup();
      const ack = await h.handler(
        { targetTokenIds: ["tok-orc"], slug: "prone", mode: "add", source: { messageId } },
        GM_CTX,
      );
      expect(ack.ok, JSON.stringify(ack)).toBe(true);
      expect(hasCondition(h, orc, "prone")).toBe(true);
    });
  });

  it("sem alvo (targetTokenIds vazio e sem selfActorId) -> VALIDATION_FAILED", async () => {
    const ack = await h.handler(
      { targetTokenIds: [], slug: "frightened", mode: "add", value: 1 },
      GM_CTX,
    );
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("VALIDATION_FAILED");
  });

  it("sem mecânica registrada (systemModule sem actorMechanics) -> NOT_SUPPORTED sem escrever nada", async () => {
    const bare = buildHarness(false);
    try {
      const goblin = createActor(bare, "Goblin");
      createSceneWithTokens(bare, [{ _id: "tok-goblin", name: "Goblin", actorId: goblin }]);

      const ack = await bare.handler(
        { targetTokenIds: ["tok-goblin"], slug: "frightened", mode: "add", value: 1 },
        GM_CTX,
      );
      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.code).toBe("NOT_SUPPORTED");
      expect(hasCondition(bare, goblin, "frightened")).toBe(false);
    } finally {
      teardown(bare);
    }
  });
});
