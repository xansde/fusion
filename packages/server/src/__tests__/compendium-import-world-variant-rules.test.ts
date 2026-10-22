/**
 * #274 — `importToWorld` derives imported Actors with the WORLD's variant-rule
 * Settings (DEC-MCL-09), not only with the actor's legacy `system.build` field.
 *
 * Before the fix, this call site passed no `worldVariantRules` to
 * `runActorDerivation`, so an Actor brought from the compendium derived as if
 * every variant were off (the same defect #273 fixed for doc:create/update,
 * sync and combat). The fake system echoes what the derivation SAW.
 *
 * Spec: 06-sistemas-e-derivacao (REQ-SYS-024), 16-compendiums-e-importacao.md (REQ-CMP-021),
 * 30-multiclasse-por-niveis.md (DEC-MCL-09), REQ-CFG-033/034.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

import { defineSystem, type SystemModule } from "@fusion/system-api";
import { CompendiumService } from "../compendium/index.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import { Role } from "../auth/user-store.js";
import { DocumentStore } from "../documents/store.js";

const SYSTEM_ID = "fake-variant-system";
const PACK_ID = `${SYSTEM_ID}.variant-import`;
const ACTOR_ID = "actor0001";
const UUID = `Compendium.${PACK_ID}.Actor.${ACTOR_ID}`;

function makeDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-import-variant-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildFakeSystem(): SystemModule {
  return defineSystem(
    {
      id: SYSTEM_ID,
      title: "Fake Variant System",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: { Actor: ["hero"] },
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.derive({
        id: "fake.echo-class-levels",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "derived",
        reads: [],
        writes: ["system.derived.classLevelsSeen"],
        run: (doc) => {
          const d = doc as {
            system: {
              build?: { variantRules?: { classLevels?: boolean } };
              derived?: Record<string, unknown>;
            };
          };
          d.system.derived ??= {};
          d.system.derived["classLevelsSeen"] = d.system.build?.variantRules?.classLevels ?? false;
        },
      });
    },
  );
}

function setupPack(): string {
  const packsRoot = makeDir();
  const packDir = join(packsRoot, "variant-import");
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, "pack.json"),
    JSON.stringify({
      id: PACK_ID,
      label: "Variant import",
      documentType: "Actor",
      systemId: SYSTEM_ID,
      indexFields: [],
      license: { license: "ORC", attribution: "Test", reservedNotice: "" },
      source: { repo: null, version: null, importerVersion: "0.1.0" },
      documentCount: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    }),
  );
  writeFileSync(
    join(packDir, "documents.json"),
    JSON.stringify([
      { _id: ACTOR_ID, name: "Hero", type: "hero", img: "icons/placeholder/npc.svg", system: {} },
    ]),
  );
  return packsRoot;
}

function importHero(withWorldSetting: boolean | undefined): unknown {
  const packsRoot = setupPack();
  const dataDir = makeDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const db = fusionDb.raw;
  try {
    if (withWorldSetting !== undefined) {
      new DocumentStore({ db }).createBatch("settings", [
        {
          _id: "setting000000001",
          key: `${SYSTEM_ID}:variantRules.classLevels`,
          value: withWorldSetting,
        },
      ]);
    }
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, SYSTEM_ID);
    const result = svc.importToWorld([UUID], {
      db,
      worldId: "import-variant-world",
      userId: "gm-user",
      role: Role.GAMEMASTER,
      systemModule: buildFakeSystem(),
    });
    expect(result.created).toHaveLength(1);
    const row = db.prepare("SELECT data FROM actors WHERE id = ?").get(result.created[0]) as {
      data: string;
    };
    const doc = JSON.parse(row.data) as { system: { derived: Record<string, unknown> } };
    return doc.system.derived["classLevelsSeen"];
  } finally {
    fusionDb.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
}

describe("CompendiumService.importToWorld — world variant-rule overlay (#274, DEC-MCL-09)", () => {
  it("derives the imported Actor with the world's classLevels=true", () => {
    expect(importHero(true)).toBe(true);
  });

  it("an explicit world false still derives as off", () => {
    expect(importHero(false)).toBe(false);
  });

  it("no Setting stored: falls back to the actor's own field (off here), as before", () => {
    expect(importHero(undefined)).toBe(false);
  });
});
