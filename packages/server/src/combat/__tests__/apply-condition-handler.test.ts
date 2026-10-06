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

  return { dataDir, fusionDb, store, targetingStore, targetDeps, service, handler };
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
  tokens: Array<{ _id: string; name: string; actorId: string }>,
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
