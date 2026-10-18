/**
 * TurnHookContext.roll / updateActor / readSetting — the real hook services behind the PF2e turn automation.
 *
 * `roll` rolls on the server and posts the dice card; `updateActor` writes a scoped diff and refuses identity,
 * ownership and embedded keys; `readSetting` reads the system's world-scope setting from the stored Setting documents.
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
import { RollService } from "../chat/roll-service.js";
import { createDocumentWriteTurnHookContextServices } from "../combat/turn-hook-runner.js";
import { pf2eSystem } from "@fusion/system-pf2e";

describe("turn hook services: roll / updateActor / readSetting", () => {
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

  function services(withRoll = true) {
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
      ...(withRoll ? { rollService: new RollService({ db: fusionDb.raw, rng: { next: () => 10 } }) } : {}),
    });
  }

  it("roll: rolls on the server (d20 with engine 10 = face 11), returns the data and posts a roll card", async () => {
    const result = await services().roll("1d20", { flavor: "Teste simples", rollMode: "public" });
    expect(result.total).toBe(11);
    expect(result.flavor).toBe("Teste simples");
    const card = emitted.find((e) => e.type === "doc:create");
    expect(card).toBeDefined();
    const row = fusionDb.raw
      .prepare("SELECT data FROM chat_messages ORDER BY rowid DESC LIMIT 1")
      .get() as { data: string };
    expect(JSON.parse(row.data)).toMatchObject({ type: "roll", speaker: { userId: "system" } });
  });

  it("roll: rejects when no RollService was injected", async () => {
    await expect(services(false).roll("1d20", { flavor: "x" })).rejects.toThrow(/roll/);
  });

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

  it("readSetting: undefined until the GM stores it, then the stored value (key namespaced by the system id)", () => {
    const s = services();
    expect(s.readSetting?.("automation.turn")).toBeUndefined();
    store.create("settings", {
      _id: "settingTurnAuto1",
      key: `${pf2eSystem.manifest.id}:automation.turn`,
      value: false,
    });
    expect(s.readSetting?.("automation.turn")).toBe(false);
  });
});
