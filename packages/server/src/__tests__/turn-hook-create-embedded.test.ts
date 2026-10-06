/**
 * TurnHookContext.createEmbedded — the real document-write service (BHR-F3-09 / I-1 of the wave 7 review).
 *
 * A system hook that embeds an item on an actor (the Monster Hunter effect on a critical Recall
 * Knowledge) writes through the same persistence + broadcast path as every other hook write
 * (REQ-SYS-140): the item is appended to `items`, gets a server-side `_id`, and the clients are told.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { DocumentStore } from "../documents/store.js";
import { SeqStore } from "../net/seq-store.js";
import { OpBuffer } from "../net/op-buffer.js";
import { createDocumentWriteTurnHookContextServices } from "../combat/turn-hook-runner.js";
import { pf2eSystem } from "@fusion/system-pf2e";

describe("createEmbedded (real hook service)", () => {
  let dataDir: string;
  let fusionDb: FusionDatabase;
  let store: DocumentStore;
  const emitted: unknown[] = [];

  beforeEach(() => {
    dataDir = join(
      tmpdir(),
      `fusion-hook-create-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, "world.db");
    fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
    emitted.length = 0;
  });

  afterEach(() => {
    fusionDb.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function services(withSystem = false) {
    const socket = {
      data: { role: 4, userId: "gm" },
      emit: (_e: string, env: unknown) => emitted.push(env),
    };
    return createDocumentWriteTurnHookContextServices({
      store,
      db: fusionDb.raw,
      ns: { sockets: new Map([["s1", socket]]) } as never,
      seqStore: new SeqStore(fusionDb.raw),
      opBuffer: new OpBuffer(),
      worldId: "w",
      ...(withSystem ? { systemModule: pf2eSystem } : {}),
    });
  }

  it("appends the items with fresh server ids, keeps the existing ones and broadcasts the actor", async () => {
    store.create("actors", {
      _id: "hunterActor00001",
      name: "Caçador",
      type: "character",
      items: [{ _id: "existingItem0001", name: "Arco", type: "weapon" }],
    });

    await services().createEmbedded("hunterActor00001", [
      { _id: "forgedId", name: "Efeito", type: "effect", system: { slug: "x" } },
    ]);

    const items = store.get("actors", "hunterActor00001")["items"] as Record<string, unknown>[];
    expect(items.map((i) => i["name"])).toEqual(["Arco", "Efeito"]);
    expect(items[0]?.["_id"]).toBe("existingItem0001");
    const created = items[1];
    expect(typeof created?.["_id"]).toBe("string");
    expect(created?.["_id"]).not.toBe("forgedId");
    expect(emitted).toHaveLength(1);
  });

  it("does nothing, and says nothing, for an empty list", async () => {
    store.create("actors", { _id: "hunterActor00002", name: "Caçador", type: "character" });
    await services().createEmbedded("hunterActor00002", []);
    expect(emitted).toHaveLength(0);
  });

  /**
   * L2 round 2, D2: an effect a hook embeds changes what the sheet may show (Monster Hunter's +1 against the prey is
   * published in `system.derived.situationalModifiers`). The stored `derived` the clients read must be recomputed in
   * the same write, or the sheet keeps the number without the bonus the roll will add.
   */
  const hunterEffect = {
    name: "Caçador de Monstros",
    type: "effect",
    system: {
      slug: "effect-monster-hunter",
      duration: { value: -1, unit: "unlimited", sustained: false, expiry: null },
      level: 1,
      rules: [
        {
          kind: "flat-modifier",
          slug: "monster-hunter",
          selector: "attack-roll",
          value: 1,
          mode: "add",
          type: "circumstance",
          predicate: ["target:mark:hunted-prey"],
        },
      ],
    },
  };
  const hunter = (id: string) => ({
    _id: id,
    name: "Caçador",
    type: "character",
    system: {
      level: { value: 3 },
      abilities: {
        str: { value: 18 },
        dex: { value: 10 },
        con: { value: 14 },
        int: { value: 12 },
        wis: { value: 14 },
        cha: { value: 10 },
      },
      proficiencies: { weapons: { simple: 1, martial: 1 }, armor: { unarmored: 1 } },
      details: { level: 3 },
    },
  });
  const published = (id: string): string[] => {
    const derived = (store.get("actors", id)["system"] as { derived?: Record<string, unknown> })
      .derived;
    return ((derived?.["situationalModifiers"] as { slug: string }[] | undefined) ?? []).map(
      (m) => m.slug,
    );
  };

  it("re-derives the actor when a hook embeds an effect (the +1 reaches the stored derived)", async () => {
    store.create("actors", hunter("hunterActor00003"));
    await services(true).createEmbedded("hunterActor00003", [hunterEffect]);
    expect(published("hunterActor00003")).toContain("monster-hunter");
  });

  it("re-derives the actor when a hook removes the effect (the +1 leaves the stored derived)", async () => {
    store.create("actors", hunter("hunterActor00004"));
    await services(true).createEmbedded("hunterActor00004", [hunterEffect]);
    const effectId = (store.get("actors", "hunterActor00004")["items"] as { _id: string }[])[0]!
      ._id;
    await services(true).deleteEmbedded("hunterActor00004", [effectId]);
    expect(published("hunterActor00004")).not.toContain("monster-hunter");
  });
});
