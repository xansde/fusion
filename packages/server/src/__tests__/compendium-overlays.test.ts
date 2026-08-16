/**
 * Tests for the T1 translation + mechanics overlays on CompendiumService.
 *
 * Spec: T1 — overlay de tradução pt-BR (i18n.pt-BR.json) + overlay de
 * mecânicas (mechanics.json), por pack, no diretório do pack.
 *
 * Coverage:
 *   i18n overlay:
 *     - getDocument attaches doc.i18n.ptBR when a valid overlay entry exists
 *     - getPackIndex attaches entry.i18n.ptBR + entry.namePt (bilingual search)
 *     - stale entry (sourceHash mismatch) is DROPPED → EN fallback
 *     - missing overlay → NO i18n/namePt keys (byte-identical to pre-T1 shape)
 *     - corrupt overlay → tolerated (ignored), EN fallback
 *   mechanics overlay:
 *     - getDocument attaches doc.mechanics (grants/unlocks) when present
 *     - missing overlay → NO mechanics key
 *   import:
 *     - overlay fields (i18n/mechanics) are stripped from the imported world doc
 *
 * NOTE: fixtures are minimal/synthetic — no real translations. sourceHash for
 * the i18n fixture is computed with computeI18nSourceHash so it matches the
 * live EN document (the staleness gate would otherwise drop it).
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CompendiumService, computeI18nSourceHash } from "../compendium/index.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import { Role } from "../auth/user-store.js";
import { UserRole } from "../documents/ownership.js";

/**
 * Viewer role used by the service-level calls below. These synthetic packs
 * declare no `audience`, so `PackManifestSchema` resolves them to `"all"` and
 * every role sees them (REQ-CMP-004a); the pack-audience gate itself is proved
 * in compendium-audience.test.ts.
 */
const GM_VIEWER = UserRole.GAMEMASTER;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PACK_ID = "pf2e.overlay-test";
const PACK_SLUG = "overlay-test";

const MANIFEST = {
  id: PACK_ID,
  label: "Overlay Test",
  documentType: "Item",
  systemId: "pf2e",
  indexFields: ["system.level", "system.traits.value"],
  license: { license: "ORC", attribution: "Test", reservedNotice: "" },
  source: { repo: null, version: null, importerVersion: "0.1.0" },
  documentCount: 2,
  generatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

// system.level is a flat number, system.description a flat HTML string — the
// real feats-core shape (verified against systems/pf2e/packs/feats-core).
const DOC_BASIC = {
  _id: "feat0001",
  name: "Basic Concoction",
  type: "feat",
  img: "icons/placeholder/feat.svg",
  system: {
    level: 4,
    traits: { value: ["archetype"] },
    description: "<p>You gain a 1st- or 2nd-level alchemist feat.</p>",
  },
};

const DOC_PLAIN = {
  _id: "feat0002",
  name: "Adopted Ancestry",
  type: "feat",
  img: "icons/placeholder/feat.svg",
  system: {
    level: 1,
    traits: { value: ["general"] },
    description: "<p>Choose a common ancestry.</p>",
  },
};

const DOCUMENTS = [DOC_BASIC, DOC_PLAIN];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-overlay-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a pack directory with pack.json + documents.json, plus optional
 * i18n.pt-BR.json / mechanics.json overlays. Returns the packs ROOT.
 */
function setupPack(opts?: { i18n?: unknown; mechanics?: unknown }): { packsRoot: string } {
  const packsRoot = makeTempDir();
  const packDir = join(packsRoot, PACK_SLUG);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(DOCUMENTS));
  if (opts?.i18n !== undefined) {
    writeFileSync(join(packDir, "i18n.pt-BR.json"), JSON.stringify(opts.i18n));
  }
  if (opts?.mechanics !== undefined) {
    writeFileSync(join(packDir, "mechanics.json"), JSON.stringify(opts.mechanics));
  }
  return { packsRoot };
}

/** Build a valid i18n overlay whose entry hash matches DOC_BASIC's live EN. */
function validI18nOverlay(): unknown {
  return {
    schemaVersion: 1,
    packId: PACK_ID,
    locale: "pt-BR",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: "test",
    attribution: "Derived fan-content translation of the ORC/OGL EN text.",
    entries: {
      [DOC_BASIC._id]: {
        name: "Concocção Básica",
        description: "<p>Você ganha um talento de alquimista de 1º ou 2º nível.</p>",
        sourceHash: computeI18nSourceHash(DOC_BASIC as Record<string, unknown>),
      },
    },
  };
}

function mechanicsOverlay(): unknown {
  return {
    schemaVersion: 1,
    packId: PACK_ID,
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: "test",
    entries: {
      [DOC_BASIC._id]: {
        sourceHash: "irrelevant-for-runtime",
        grants: [
          {
            kind: "feat-choice",
            category: "class",
            count: 1,
            filters: { traits: ["alchemist"], maxLevel: 2 },
            labelKey: "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction",
            source: "rule-element",
            confidence: 1.0,
          },
        ],
        unlocks: [],
      },
    },
  };
}

const UUID_BASIC = `Compendium.${PACK_ID}.Item.${DOC_BASIC._id}`;
const UUID_PLAIN = `Compendium.${PACK_ID}.Item.${DOC_PLAIN._id}`;

// ---------------------------------------------------------------------------
// i18n overlay
// ---------------------------------------------------------------------------

describe("CompendiumService — i18n overlay", () => {
  it("getDocument attaches doc.i18n.ptBR when a valid overlay entry exists", () => {
    const { packsRoot } = setupPack({ i18n: validI18nOverlay() });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    expect(doc).not.toBeNull();
    // EN source untouched
    expect(doc!["name"]).toBe("Basic Concoction");
    expect((doc!["system"] as Record<string, unknown>)["description"]).toBe(
      "<p>You gain a 1st- or 2nd-level alchemist feat.</p>",
    );
    // pt-BR overlay attached
    const i18n = doc!["i18n"] as { ptBR?: { name?: string; description?: string } };
    expect(i18n.ptBR?.name).toBe("Concocção Básica");
    expect(i18n.ptBR?.description).toBe(
      "<p>Você ganha um talento de alquimista de 1º ou 2º nível.</p>",
    );

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("getPackIndex attaches entry.i18n.ptBR + entry.namePt for translated docs", () => {
    const { packsRoot } = setupPack({ i18n: validI18nOverlay() });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const idx = svc.getPackIndex(GM_VIEWER, PACK_ID);
    expect(idx).not.toBeNull();
    const basic = idx!.entries.find((e) => e._id === DOC_BASIC._id);
    const plain = idx!.entries.find((e) => e._id === DOC_PLAIN._id);

    // Translated entry has i18n + denormalized namePt
    expect(basic?.namePt).toBe("Concocção Básica");
    expect(basic?.i18n?.ptBR?.name).toBe("Concocção Básica");
    // Untranslated entry has NO overlay keys
    expect(plain?.namePt).toBeUndefined();
    expect(plain?.i18n).toBeUndefined();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("bilingual search matches the pt-BR namePt via searchPack", () => {
    const { packsRoot } = setupPack({ i18n: validI18nOverlay() });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    // Search by the pt-BR name (accent-insensitive: "concoccao" hits "Concocção")
    const ptHits = svc.searchPack(GM_VIEWER, PACK_ID, { packId: PACK_ID, text: "concoccao" });
    expect(ptHits!.map((e) => e._id)).toEqual([DOC_BASIC._id]);

    // Search by the EN name still works
    const enHits = svc.searchPack(GM_VIEWER, PACK_ID, { packId: PACK_ID, text: "basic" });
    expect(enHits!.map((e) => e._id)).toEqual([DOC_BASIC._id]);

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("drops a stale overlay entry (sourceHash mismatch) → EN fallback", () => {
    const overlay = {
      schemaVersion: 1,
      packId: PACK_ID,
      locale: "pt-BR",
      generatedAt: "2026-01-01T00:00:00.000Z",
      attribution: "test",
      entries: {
        [DOC_BASIC._id]: {
          name: "Tradução Obsoleta",
          description: "<p>obsoleta</p>",
          sourceHash: "0000000000000000000000000000000000000000", // wrong
        },
      },
    };
    const { packsRoot } = setupPack({ i18n: overlay });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    // getDocument: no i18n attached (stale dropped)
    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    expect(doc!["i18n"]).toBeUndefined();

    // index: no namePt / i18n either
    const idx = svc.getPackIndex(GM_VIEWER, PACK_ID);
    const basic = idx!.entries.find((e) => e._id === DOC_BASIC._id);
    expect(basic?.namePt).toBeUndefined();
    expect(basic?.i18n).toBeUndefined();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("supports a name-only overlay entry (no description)", () => {
    const overlay = {
      schemaVersion: 1,
      packId: PACK_ID,
      locale: "pt-BR",
      generatedAt: "2026-01-01T00:00:00.000Z",
      attribution: "test",
      entries: {
        [DOC_BASIC._id]: {
          name: "Concocção Básica",
          sourceHash: computeI18nSourceHash(DOC_BASIC as Record<string, unknown>),
        },
      },
    };
    const { packsRoot } = setupPack({ i18n: overlay });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    const i18n = doc!["i18n"] as { ptBR?: { name?: string; description?: string } };
    expect(i18n.ptBR?.name).toBe("Concocção Básica");
    expect(i18n.ptBR?.description).toBeUndefined();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("tolerates a corrupt i18n overlay (ignored, EN fallback)", () => {
    const { packsRoot } = setupPack({ i18n: { not: "a valid overlay" } });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    expect(doc).not.toBeNull();
    expect(doc!["i18n"]).toBeUndefined();
    expect(doc!["name"]).toBe("Basic Concoction");

    rmSync(packsRoot, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// No overlay → byte-identical to pre-T1 behaviour
// ---------------------------------------------------------------------------

describe("CompendiumService — no overlay (backward compatibility)", () => {
  it("getDocument serves the doc with NO i18n/mechanics keys when no overlays exist", () => {
    const { packsRoot } = setupPack();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    expect(doc).not.toBeNull();
    expect(doc!["i18n"]).toBeUndefined();
    expect(doc!["mechanics"]).toBeUndefined();
    // The served doc must deep-equal the source document (plus nothing).
    expect(doc).toEqual(DOC_BASIC);

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("getPackIndex entries have NO i18n/namePt keys when no overlay exists", () => {
    const { packsRoot } = setupPack();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const idx = svc.getPackIndex(GM_VIEWER, PACK_ID);
    for (const entry of idx!.entries) {
      expect(entry.i18n).toBeUndefined();
      expect(entry.namePt).toBeUndefined();
      expect("i18n" in entry).toBe(false);
      expect("namePt" in entry).toBe(false);
    }

    rmSync(packsRoot, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// mechanics overlay
// ---------------------------------------------------------------------------

describe("CompendiumService — mechanics overlay", () => {
  it("getDocument attaches doc.mechanics (grants/unlocks) when present", () => {
    const { packsRoot } = setupPack({ mechanics: mechanicsOverlay() });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    const mechanics = doc!["mechanics"] as {
      grants: Array<Record<string, unknown>>;
      unlocks: unknown[];
    };
    expect(mechanics.grants).toHaveLength(1);
    expect(mechanics.grants[0]["category"]).toBe("class");
    expect(mechanics.grants[0]["filters"]).toEqual({ traits: ["alchemist"], maxLevel: 2 });
    expect(mechanics.grants[0]["labelKey"]).toBe(
      "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction",
    );
    expect(mechanics.unlocks).toHaveLength(0);

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("getDocument has NO mechanics key for docs absent from the overlay", () => {
    const { packsRoot } = setupPack({ mechanics: mechanicsOverlay() });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_PLAIN);
    expect(doc!["mechanics"]).toBeUndefined();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("attaches a fixed-item grant (Conflux Spell, r15 A2) — the discriminated union validates it", () => {
    const overlay = {
      schemaVersion: 1,
      packId: PACK_ID,
      generatedAt: "2026-01-01T00:00:00.000Z",
      generator: "test",
      entries: {
        [DOC_BASIC._id]: {
          sourceHash: "irrelevant-for-runtime",
          grants: [
            {
              kind: "fixed-item",
              vendor: "spells-srd",
              name: "Shooting Star",
              uuid: "Compendium.pf2e.spells-srd.Item.Shooting Star",
              source: "curated",
              confidence: 1.0,
            },
          ],
          unlocks: [],
        },
      },
    };
    const { packsRoot } = setupPack({ mechanics: overlay });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    const mechanics = doc!["mechanics"] as { grants: Array<Record<string, unknown>> };
    expect(mechanics.grants).toHaveLength(1);
    expect(mechanics.grants[0]["kind"]).toBe("fixed-item");
    expect(mechanics.grants[0]["name"]).toBe("Shooting Star");
    expect(mechanics.grants[0]["vendor"]).toBe("spells-srd");

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("tolerates a corrupt mechanics overlay (ignored)", () => {
    const { packsRoot } = setupPack({ mechanics: { entries: "nope" } });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const doc = svc.getDocument(GM_VIEWER, UUID_BASIC);
    expect(doc).not.toBeNull();
    expect(doc!["mechanics"]).toBeUndefined();

    rmSync(packsRoot, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// import — overlay fields must NOT leak into the imported world document
// ---------------------------------------------------------------------------

describe("CompendiumService — import strips overlay projections", () => {
  it("imported world doc has no i18n/mechanics keys even when overlays exist", () => {
    const { packsRoot } = setupPack({
      i18n: validI18nOverlay(),
      mechanics: mechanicsOverlay(),
    });
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const dataDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);

    const result = svc.importToWorld([UUID_BASIC], {
      db: fusionDb.raw,
      worldId: "overlay-world",
      userId: "gm-user",
      role: Role.GAMEMASTER,
    });
    expect(result.created).toHaveLength(1);

    const row = fusionDb.raw
      .prepare("SELECT data FROM items WHERE id = ?")
      .get(result.created[0]) as { data: string } | undefined;
    expect(row).toBeDefined();
    const worldDoc = JSON.parse(row!.data) as Record<string, unknown>;

    // EN payload preserved
    expect(worldDoc["name"]).toBe("Basic Concoction");
    // Overlay projections stripped
    expect(worldDoc["i18n"]).toBeUndefined();
    expect(worldDoc["mechanics"]).toBeUndefined();
    // uuid (pack-only) also stripped, as before T1
    expect(worldDoc["uuid"]).toBeUndefined();

    fusionDb.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  });
});
