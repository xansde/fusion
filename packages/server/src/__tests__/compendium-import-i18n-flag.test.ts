/**
 * Tests for A041 (ajustes r1, Fase 4 — Aba Compêndio): the pt-BR name of an
 * imported Actor/Item does not disappear when `importToWorld` strips the
 * `i18n` overlay projection — it is snapshotted into
 * `flags.fusion.i18n["pt-BR"]` instead, so display surfaces can resolve a
 * translated label without a live view of the pack overlay.
 *
 * Spec: REQ-CMP-055 (16-compendiums-e-importacao.md, decision recorded
 * 2026-08-17 by A041 — see also DEC-CPD-13 in 43-aba-compendio.md).
 *
 * The imported world document's `name` MUST stay EN-pure (issue #43,
 * unchanged) — this only proves the SECOND, additive path.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CompendiumService, computeI18nSourceHash } from "../compendium/index.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import { Role } from "../auth/user-store.js";

const PACK_ID = "pf2e.i18n-flag-test";
const PACK_SLUG = "i18n-flag-test";

const MANIFEST = {
  id: PACK_ID,
  label: "I18n Flag Test",
  documentType: "Actor",
  systemId: "pf2e",
  indexFields: ["system.level"],
  license: { license: "ORC", attribution: "Test", reservedNotice: "" },
  source: { repo: null, version: null, importerVersion: "0.1.0" },
  documentCount: 2,
  generatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

/** Carries a `flags.fusion` block, as a real curated pack document would. */
const DOC_WITH_OVERLAY = {
  _id: "actor0001",
  name: "Eagle",
  type: "npc",
  img: "icons/placeholder/npc.svg",
  system: { level: { value: 1 } },
  flags: { fusion: { packName: "bestiary", sourceId: "eagle-001" } },
};

/** No `flags` at all — proves the snapshot still works when there is nothing
 * to merge into (mirrors the synthetic fixtures elsewhere in the suite). */
const DOC_NO_OVERLAY = {
  _id: "actor0002",
  name: "Owl",
  type: "npc",
  img: "icons/placeholder/npc.svg",
  system: { level: { value: 1 } },
};

const DOCUMENTS = [DOC_WITH_OVERLAY, DOC_NO_OVERLAY];

function makeDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-i18n-flag-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupPack(opts?: { i18n?: unknown }): { packsRoot: string } {
  const packsRoot = makeDir();
  const packDir = join(packsRoot, PACK_SLUG);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(DOCUMENTS));
  if (opts?.i18n !== undefined) {
    writeFileSync(join(packDir, "i18n.pt-BR.json"), JSON.stringify(opts.i18n));
  }
  return { packsRoot };
}

function validI18nOverlay(): unknown {
  return {
    schemaVersion: 1,
    packId: PACK_ID,
    locale: "pt-BR",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: "test",
    attribution: "Derived fan-content translation of the ORC/OGL EN text.",
    entries: {
      [DOC_WITH_OVERLAY._id]: {
        name: "Águia",
        sourceHash: computeI18nSourceHash(DOC_WITH_OVERLAY as Record<string, unknown>),
      },
    },
  };
}

const UUID_WITH_OVERLAY = `Compendium.${PACK_ID}.Actor.${DOC_WITH_OVERLAY._id}`;
const UUID_NO_OVERLAY = `Compendium.${PACK_ID}.Actor.${DOC_NO_OVERLAY._id}`;

function bootDb(): { db: ReturnType<typeof openDatabase>["raw"]; dataDir: string } {
  const dataDir = makeDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  return { db: fusionDb.raw, dataDir };
}

describe("CompendiumService.importToWorld — pt-BR name snapshot (REQ-CMP-055, A041)", () => {
  it("REQ-CMP-055: imported doc keeps EN name and carries the pt-BR label in flags.fusion.i18n['pt-BR'].name, merged alongside existing flags.fusion", () => {
    const { packsRoot } = setupPack({ i18n: validI18nOverlay() });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const { db, dataDir } = bootDb();
    const result = svc.importToWorld([UUID_WITH_OVERLAY], {
      db,
      worldId: "i18n-flag-world",
      userId: "gm-user",
      role: Role.GAMEMASTER,
    });
    expect(result.created).toHaveLength(1);

    const row = db.prepare("SELECT data FROM actors WHERE id = ?").get(result.created[0]) as
      | { data: string }
      | undefined;
    expect(row).toBeDefined();
    const worldDoc = JSON.parse(row!.data) as Record<string, unknown>;

    // name stays EN-pure — issue #43 is not reverted (REQ-CMP-055 is additive).
    expect(worldDoc["name"]).toBe("Eagle");
    // the top-level overlay projection is still stripped, as before A041.
    expect(worldDoc["i18n"]).toBeUndefined();

    const flags = worldDoc["flags"] as Record<string, unknown>;
    const fusion = flags["fusion"] as Record<string, unknown>;
    // pre-existing flags.fusion.* (conversion metadata) survives the merge.
    expect(fusion["packName"]).toBe("bestiary");
    expect(fusion["sourceId"]).toBe("eagle-001");
    const i18n = fusion["i18n"] as Record<string, unknown>;
    const ptBR = i18n["pt-BR"] as Record<string, unknown>;
    expect(ptBR["name"]).toBe("Águia");

    db.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("REQ-CMP-055: a doc with no pt-BR overlay carries no flags.fusion.i18n at all", () => {
    const { packsRoot } = setupPack({ i18n: validI18nOverlay() }); // overlay exists for the OTHER doc only
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const { db, dataDir } = bootDb();
    const result = svc.importToWorld([UUID_NO_OVERLAY], {
      db,
      worldId: "i18n-flag-world-2",
      userId: "gm-user",
      role: Role.GAMEMASTER,
    });
    expect(result.created).toHaveLength(1);

    const row = db.prepare("SELECT data FROM actors WHERE id = ?").get(result.created[0]) as
      | { data: string }
      | undefined;
    expect(row).toBeDefined();
    const worldDoc = JSON.parse(row!.data) as Record<string, unknown>;

    expect(worldDoc["name"]).toBe("Owl");
    // DOC_NO_OVERLAY has no `flags` at all in the source fixture, and no
    // overlay entry exists for it either — nothing to snapshot, so no
    // flags.fusion.i18n key is invented.
    const flags = worldDoc["flags"] as Record<string, unknown> | undefined;
    if (flags !== undefined) {
      const fusion = flags["fusion"] as Record<string, unknown> | undefined;
      expect(fusion?.["i18n"]).toBeUndefined();
    }

    db.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  });
});
