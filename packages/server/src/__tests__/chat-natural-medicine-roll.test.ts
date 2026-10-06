/**
 * Natural Medicine on the SERVER's roll path (BHR-F1-08 achado 1, wave 5 review I-7, REQ-BHR-027).
 *
 * PF2e remaster, written here by hand: with Natural Medicine a character may Treat Wounds with Nature, and fresh
 * ingredients (in the wilderness) give a +2 circumstance bonus to that check. Level 3, Wisdom +4, trained in Nature:
 * Nature = 3 + 2 + 4 = +9, so Treat Wounds with fresh ingredients rolls +11. The sheet sends the plain +9 formula and
 * the roll's description (`selectors: ["nature"]`, `options: ["action:treat-wounds"]`); the SERVER adds the +2.
 * It runs on the COMPOSITE system (`pf2e-sf2e`, the mixed world the table plays in): it used to have no resolver.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pf2eSf2eSystem } from "@fusion/system-pf2e-sf2e";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { DocumentStore } from "../documents/index.js";
import { Role } from "../auth/user-store.js";
import { conditionalRollFormula, prepareRollResolution } from "../chat/roll-resolution.js";

type Json = Record<string, unknown>;

const PACK = new URL(
  "../../../../external/fusion-systems-2e/systems/pf2e/packs/feats-core/documents.json",
  import.meta.url,
);
const NATURAL_MEDICINE_ID = "N6YWCOq6zL8w5gcR";
const ACTOR_ID = "naturalMedActor1";

function naturalMedicine(freshIngredients: boolean): Json {
  const packDoc = (JSON.parse(readFileSync(PACK, "utf8")) as Json[]).find(
    (d) => d["_id"] === NATURAL_MEDICINE_ID,
  );
  const feat = structuredClone(packDoc as Json);
  feat["_id"] = "embNaturalMed1";
  if (freshIngredients) {
    const flags = (feat["flags"] ?? {}) as Json;
    feat["flags"] = flags;
    const fusion = (flags["fusion"] ?? {}) as Json;
    flags["fusion"] = fusion;
    fusion["toggles"] = { "fresh-ingredients": true };
  }
  return feat;
}

function actorDoc(freshIngredients: boolean): Json {
  return {
    _id: ACTOR_ID,
    name: "Bhrotto de teste",
    type: "character",
    ownership: { default: 0 },
    system: {
      systemVersion: "0.1.0",
      level: { value: 3 },
      abilities: {
        str: { value: 12, mod: 0 },
        dex: { value: 12, mod: 0 },
        con: { value: 12, mod: 0 },
        int: { value: 10, mod: 0 },
        wis: { value: 18, mod: 0 },
        cha: { value: 10, mod: 0 },
      },
      attributes: {
        hp: { value: 30, max: 30, temp: 0 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
      },
      saves: { fortitude: { rank: 1 }, reflex: { rank: 1 }, will: { rank: 1 } },
      perception: { rank: 1, senses: [] },
      skills: { nature: { rank: 1 }, medicine: { rank: 0 } },
      proficiencies: {
        classDC: { rank: 0 },
        weapons: { unarmed: 1, simple: 1, martial: 1, advanced: 0 },
        armor: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "wis", level: 3 },
      traits: { rarity: "common", value: [], size: "med" },
    },
    items: [naturalMedicine(freshIngredients)],
  };
}

describe("Natural Medicine on the server roll path (I-7)", () => {
  let dir = "";
  let db: FusionDatabase;
  let store: DocumentStore;

  beforeAll(() => {
    dir = join(
      tmpdir(),
      `fusion-nm-roll-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
    );
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "fusion.db");
    db = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(db.raw, dbPath);
    store = new DocumentStore({ db: db.raw, coreVersion: "0.1.0" });
  });
  afterAll(() => {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(fresh: boolean): void {
    const now = Date.now();
    const doc = actorDoc(fresh);
    db.raw.prepare("DELETE FROM actors WHERE id = ?").run(ACTOR_ID);
    db.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(ACTOR_ID, JSON.stringify(doc), "Bhrotto de teste", "character", now, now);
  }

  const treatWounds = (options: string[] = ["action:treat-wounds"]) =>
    prepareRollResolution(
      { store, systemModule: pf2eSf2eSystem },
      { actorId: ACTOR_ID, selectors: ["nature"], options },
      { userId: "gm", role: Role.GAMEMASTER },
      [],
    );

  it("fresh ingredients ON: the server adds the +2 circumstance, so the roll is +9 +2 = +11", () => {
    seed(true);
    const prepared = treatWounds();
    expect(prepared?.total).toBe(2);
    expect(conditionalRollFormula("1d20+9 # Tratar Ferimentos", prepared).formula).toBe(
      "1d20+9 + 2",
    );
  });

  it("fresh ingredients OFF: nothing is added", () => {
    seed(false);
    expect(treatWounds()?.total).toBe(0);
  });

  it("ON but not Treat Wounds: nothing is added", () => {
    seed(true);
    expect(treatWounds([])?.total).toBe(0);
  });
});
