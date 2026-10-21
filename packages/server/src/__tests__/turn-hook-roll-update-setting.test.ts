/**
 * TurnHookContext.updateActor / getSetting — real hook services.
 *
 * `updateActor` writes a scoped diff and refuses identity,
 * ownership and embedded keys; `getSetting` reads the system's world-scope setting from the stored Setting documents.
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

describe("turn hook services: updateActor / getSetting", () => {
  let dataDir: string;
  let fusionDb: FusionDatabase;
  let store: DocumentStore;
  const emitted: { type: string; payload: Record<string, unknown> }[] = [];

  beforeEach(() => {
    dataDir = join(
      tmpdir(),
      `fusion-hook-roll-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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

  function services() {
    const socket = {
      data: { role: 4, userId: "gm" },
      emit: (_e: string, env: { type: string; payload: Record<string, unknown> }) =>
        emitted.push(env),
    };
    return createDocumentWriteTurnHookContextServices({
      store,
      db: fusionDb.raw,
      ns: { sockets: new Map([["s1", socket]]) } as never,
      seqStore: new SeqStore(fusionDb.raw),
      opBuffer: new OpBuffer(),
      worldId: "w",
      systemModule: pf2eSystem,
    });
  }

  it("updateActor: writes the scoped diff and broadcasts the actor", async () => {
    store.create("actors", { _id: "actorUpd00000001", name: "A", type: "npc", flags: {} });
    await services().updateActor("actorUpd00000001", { flags: { fusion: { x: 1 } } });
    expect(store.get("actors", "actorUpd00000001")["flags"]).toEqual({ fusion: { x: 1 } });
    expect(emitted.some((e) => e.type === "doc:update")).toBe(true);
  });

  it("updateActor: refuses identity, ownership and embedded keys", async () => {
    store.create("actors", { _id: "actorUpd00000002", name: "A", type: "npc" });
    for (const key of ["_id", "ownership", "items", "_stats"]) {
      await expect(
        services().updateActor("actorUpd00000002", { [key]: key === "items" ? [] : {} }),
      ).rejects.toThrow(/refuses/);
    }
  });

  it("getSetting: undefined until the GM stores it, then the stored value (key namespaced by the system id)", () => {
    const s = services();
    expect(s.getSetting?.("conditions.automateTurn")).toBeUndefined();
    store.create("settings", {
      _id: "settingTurnAuto1",
      key: `${pf2eSystem.manifest.id}:conditions.automateTurn`,
      value: false,
    });
    expect(s.getSetting?.("conditions.automateTurn")).toBe(false);
  });
});
