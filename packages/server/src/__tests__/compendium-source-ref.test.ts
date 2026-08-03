/**
 * Tests for CompendiumService.getI18nBySourceRef (issue #43).
 *
 * Context: `importToWorld` deliberately strips `uuid`/`i18n`/`mechanics` from
 * the world copy of an imported document to keep it EN-pure (see the
 * docstring on `delete worldDoc["i18n"]` in service.ts). That decision is
 * correct and must not be reverted — but it left a real gap: nothing read
 * the overlay back for a world document, because `flags.fusion.packName` is
 * the VENDOR pack key (e.g. "equipment"), not the Fusion pack id/directory
 * (e.g. "pf2e.weapons-core") that `getDocument(uuid)` needs — and curation
 * remaps a single vendor pack into MULTIPLE Fusion packs (confirmed:
 * `pf2e.weapons-core` and `pf2e.equipment-core` both curate from vendor
 * "equipment", with disjoint sourceIds — see the real-data suite below).
 *
 * Coverage:
 *   - resolves the pt-BR overlay by (packName, sourceId), disambiguating two
 *     packs that share the same vendor packName (the remap scenario)
 *   - returns null for an unknown sourceId
 *   - returns null when packName doesn't match (packName+sourceId are a
 *     JOINT key, not sourceId alone)
 *   - a stale overlay entry (sourceHash mismatch) is rejected exactly like
 *     `getDocument`'s existing staleness gate (EN fallback via null)
 *   - a doc with no i18n overlay at all resolves to null without throwing
 *   - REAL PACK DATA: resolves systems/pf2e/packs/weapons-core's "Whip" (and
 *     NOT the equipment-core doc) from `flags.fusion.packName === "equipment"`,
 *     confirming the curated-pack remap case described in the issue is real
 *     and handled
 *   - the (not-yet-registered) socket handler builder validates payload and
 *     forwards to the service correctly, verified via direct invocation
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CompendiumService,
  computeI18nSourceHash,
  resolveSystemPacksDir,
} from "../compendium/index.js";
// NOTE: buildCompendiumI18nBySourceRefHandler is imported directly from
// handlers.js (not re-exported via compendium/index.ts yet) — wiring it into
// the barrel + socket-manager.ts's HandlerRegistry is the remaining step
// noted in handlers.ts's file-level docstring, outside this change's file
// ownership (packages/server/src/net/socket-manager.ts).
import { buildCompendiumI18nBySourceRefHandler } from "../compendium/handlers.js";
import type { HandlerContext } from "../net/handler-registry.js";

// ---------------------------------------------------------------------------
// Fixtures — two packs sharing the same vendor packName (curation remap)
// ---------------------------------------------------------------------------

const PACK_A_ID = "pf2e.remap-a-test";
const PACK_A_SLUG = "remap-a-test";
const PACK_B_ID = "pf2e.remap-b-test";
const PACK_B_SLUG = "remap-b-test";

const VENDOR_PACK_NAME = "vendor-shared";

function manifestFor(id: string, documentCount: number): unknown {
  return {
    id,
    label: id,
    documentType: "Item",
    systemId: "pf2e",
    indexFields: ["system.level"],
    license: { license: "ORC", attribution: "Test", reservedNotice: "" },
    source: { repo: null, version: null, importerVersion: "0.1.0" },
    documentCount,
    generatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
  };
}

const DOC_A1 = {
  _id: "docA1",
  name: "Item A1",
  type: "equipment",
  img: null,
  system: { level: 1, description: "<p>A1 desc</p>" },
  flags: {
    fusion: {
      conversion: "full",
      importerVersion: "0.1.0",
      sourceVersion: "v14-dev",
      sourceId: "src-a1",
      packName: VENDOR_PACK_NAME,
      unconvertedRules: [],
      assetSubstitutions: [],
    },
  },
};

const DOC_A_STALE = {
  _id: "docAStale",
  name: "Item A Stale",
  type: "equipment",
  img: null,
  system: { level: 1, description: "<p>A stale desc</p>" },
  flags: {
    fusion: {
      conversion: "full",
      importerVersion: "0.1.0",
      sourceVersion: "v14-dev",
      sourceId: "src-a-stale",
      packName: VENDOR_PACK_NAME,
      unconvertedRules: [],
      assetSubstitutions: [],
    },
  },
};

const DOC_A_NO_OVERLAY = {
  _id: "docANoOverlay",
  name: "Item A No Overlay",
  type: "equipment",
  img: null,
  system: { level: 1, description: "<p>A no-overlay desc</p>" },
  flags: {
    fusion: {
      conversion: "full",
      importerVersion: "0.1.0",
      sourceVersion: "v14-dev",
      sourceId: "src-a-no-overlay",
      packName: VENDOR_PACK_NAME,
      unconvertedRules: [],
      assetSubstitutions: [],
    },
  },
};

const DOC_B1 = {
  _id: "docB1",
  name: "Item B1",
  type: "equipment",
  img: null,
  system: { level: 1, description: "<p>B1 desc</p>" },
  flags: {
    fusion: {
      conversion: "full",
      importerVersion: "0.1.0",
      sourceVersion: "v14-dev",
      // Same vendor packName as Pack A's docs, DIFFERENT sourceId — this is
      // the curation-remap scenario (e.g. weapons-core + equipment-core both
      // sourced from vendor "equipment").
      sourceId: "src-b1",
      packName: VENDOR_PACK_NAME,
      unconvertedRules: [],
      assetSubstitutions: [],
    },
  },
};

const PACK_A_DOCS = [DOC_A1, DOC_A_STALE, DOC_A_NO_OVERLAY];
const PACK_B_DOCS = [DOC_B1];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-source-ref-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Sets up TWO pack directories under one packsRoot, both carrying
 * `flags.fusion.packName === VENDOR_PACK_NAME` on their docs — the exact
 * ambiguity `getI18nBySourceRef` must resolve. Pack A additionally has a
 * stale overlay entry (docAStale) and an overlay-less doc (docANoOverlay).
 */
function setupRemapPacks(): { packsRoot: string } {
  const packsRoot = makeTempDir();

  const packADir = join(packsRoot, PACK_A_SLUG);
  mkdirSync(packADir, { recursive: true });
  writeFileSync(join(packADir, "pack.json"), JSON.stringify(manifestFor(PACK_A_ID, 3)));
  writeFileSync(join(packADir, "documents.json"), JSON.stringify(PACK_A_DOCS));
  writeFileSync(
    join(packADir, "i18n.pt-BR.json"),
    JSON.stringify({
      schemaVersion: 1,
      packId: PACK_A_ID,
      locale: "pt-BR",
      generatedAt: "2026-01-01T00:00:00.000Z",
      attribution: "test",
      entries: {
        [DOC_A1._id]: {
          name: "Item A1 PT",
          description: "<p>A1 desc PT</p>",
          sourceHash: computeI18nSourceHash(DOC_A1 as Record<string, unknown>),
        },
        [DOC_A_STALE._id]: {
          name: "Tradução Obsoleta",
          description: "<p>obsoleta</p>",
          sourceHash: "0000000000000000000000000000000000000000", // deliberately wrong
        },
        // DOC_A_NO_OVERLAY has no entry here on purpose.
      },
    }),
  );

  const packBDir = join(packsRoot, PACK_B_SLUG);
  mkdirSync(packBDir, { recursive: true });
  writeFileSync(join(packBDir, "pack.json"), JSON.stringify(manifestFor(PACK_B_ID, 1)));
  writeFileSync(join(packBDir, "documents.json"), JSON.stringify(PACK_B_DOCS));
  writeFileSync(
    join(packBDir, "i18n.pt-BR.json"),
    JSON.stringify({
      schemaVersion: 1,
      packId: PACK_B_ID,
      locale: "pt-BR",
      generatedAt: "2026-01-01T00:00:00.000Z",
      attribution: "test",
      entries: {
        [DOC_B1._id]: {
          name: "Item B1 PT",
          description: "<p>B1 desc PT</p>",
          sourceHash: computeI18nSourceHash(DOC_B1 as Record<string, unknown>),
        },
      },
    }),
  );

  return { packsRoot };
}

// ---------------------------------------------------------------------------
// Synthetic fixture tests
// ---------------------------------------------------------------------------

describe("CompendiumService.getI18nBySourceRef", () => {
  it("resolves by (packName, sourceId), disambiguating packs sharing the same vendor packName", () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const a1 = svc.getI18nBySourceRef({ packName: VENDOR_PACK_NAME, sourceId: "src-a1" });
    expect(a1).not.toBeNull();
    expect(a1?.name).toBe("Item A1 PT");
    expect(a1?.description).toBe("<p>A1 desc PT</p>");

    const b1 = svc.getI18nBySourceRef({ packName: VENDOR_PACK_NAME, sourceId: "src-b1" });
    expect(b1).not.toBeNull();
    expect(b1?.name).toBe("Item B1 PT");
    expect(b1?.description).toBe("<p>B1 desc PT</p>");

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("returns null for an unknown sourceId", () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const result = svc.getI18nBySourceRef({
      packName: VENDOR_PACK_NAME,
      sourceId: "does-not-exist",
    });
    expect(result).toBeNull();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("returns null when packName doesn't match (joint key, not sourceId alone)", () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    // "src-a1" exists, but under a DIFFERENT packName — must not match.
    const result = svc.getI18nBySourceRef({
      packName: "some-other-vendor-pack",
      sourceId: "src-a1",
    });
    expect(result).toBeNull();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("rejects a stale overlay entry (sourceHash mismatch) — same staleness gate as getDocument", () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    // The doc EXISTS and the origin ref resolves — but its overlay entry's
    // sourceHash no longer matches the live EN doc, so it must be dropped.
    const result = svc.getI18nBySourceRef({ packName: VENDOR_PACK_NAME, sourceId: "src-a-stale" });
    expect(result).toBeNull();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("returns null for a doc that resolves but has no overlay entry at all", () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const result = svc.getI18nBySourceRef({
      packName: VENDOR_PACK_NAME,
      sourceId: "src-a-no-overlay",
    });
    expect(result).toBeNull();

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("returns null gracefully when no pack has ANY i18n overlay at all", () => {
    const packsRoot = makeTempDir();
    const packDir = join(packsRoot, PACK_A_SLUG);
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify(manifestFor(PACK_A_ID, 1)));
    writeFileSync(join(packDir, "documents.json"), JSON.stringify([DOC_A1]));
    // No i18n.pt-BR.json at all.

    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const result = svc.getI18nBySourceRef({ packName: VENDOR_PACK_NAME, sourceId: "src-a1" });
    expect(result).toBeNull();

    rmSync(packsRoot, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Real pack data — the curation-remap scenario really exists
// (pf2e.weapons-core + pf2e.equipment-core both curate from vendor
// "equipment", per tools/importer-pf2e/src/build-mvp-subset.mjs).
// ---------------------------------------------------------------------------

describe("CompendiumService.getI18nBySourceRef — real committed pf2e packs", () => {
  it("resolves weapons-core's Whip (not equipment-core) from vendor packName 'equipment'", () => {
    const packsRoot = resolveSystemPacksDir("pf2e");
    expect(packsRoot).not.toBeNull();

    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot!, "pf2e");

    // systems/pf2e/packs/weapons-core/documents.json: doc "Whip" carries
    // flags.fusion = { packName: "equipment", sourceId: "f1gwoTkf3Nn0v3PN" };
    // its i18n.pt-BR.json entry translates the name to "Chicote".
    const whip = svc.getI18nBySourceRef({ packName: "equipment", sourceId: "f1gwoTkf3Nn0v3PN" });
    expect(whip).not.toBeNull();
    expect(whip?.name).toBe("Chicote");
  });

  it("resolves equipment-core's Antivenom Potion (not weapons-core) from the SAME vendor packName", () => {
    const packsRoot = resolveSystemPacksDir("pf2e");
    expect(packsRoot).not.toBeNull();

    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot!, "pf2e");

    // systems/pf2e/packs/equipment-core/documents.json: doc "Antivenom Potion"
    // ALSO carries flags.fusion.packName === "equipment" (same vendor pack as
    // Whip above) but a disjoint sourceId — this is the exact ambiguity the
    // reverse index must resolve without guessing.
    const antivenom = svc.getI18nBySourceRef({
      packName: "equipment",
      sourceId: "N3jcmW5XzEJZQVtJ",
    });
    expect(antivenom).not.toBeNull();
    expect(antivenom?.name).toBe("Poção Antiveneno");
  });

  it("returns null for a sourceId that doesn't exist under a real vendor packName", () => {
    const packsRoot = resolveSystemPacksDir("pf2e");
    expect(packsRoot).not.toBeNull();

    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot!, "pf2e");

    const result = svc.getI18nBySourceRef({ packName: "equipment", sourceId: "totally-made-up" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler — direct invocation (NOT registered in socket-manager.ts yet, see
// handlers.ts file-level docstring)
// ---------------------------------------------------------------------------

describe("buildCompendiumI18nBySourceRefHandler", () => {
  const ctx: HandlerContext = { userId: "u1", role: 1, worldId: "w1" };

  it("returns the resolved i18n via the service", async () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const handler = buildCompendiumI18nBySourceRefHandler({
      compendium: svc,
      db: undefined as never,
      ns: undefined as never,
    });

    const ack = await handler({ packName: VENDOR_PACK_NAME, sourceId: "src-a1" }, ctx);
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      const result = ack.result as { i18n: { name: string } | null };
      expect(result.i18n?.name).toBe("Item A1 PT");
    }

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("returns ok:true with i18n:null for an unresolved reference (not an error)", async () => {
    const { packsRoot } = setupRemapPacks();
    const svc = new CompendiumService();
    svc.discoverPacks(packsRoot, "pf2e");

    const handler = buildCompendiumI18nBySourceRefHandler({
      compendium: svc,
      db: undefined as never,
      ns: undefined as never,
    });

    const ack = await handler({ packName: VENDOR_PACK_NAME, sourceId: "unknown" }, ctx);
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      const result = ack.result as { i18n: unknown };
      expect(result.i18n).toBeNull();
    }

    rmSync(packsRoot, { recursive: true, force: true });
  });

  it("returns VALIDATION_FAILED for a malformed payload", async () => {
    const svc = new CompendiumService();
    const handler = buildCompendiumI18nBySourceRefHandler({
      compendium: svc,
      db: undefined as never,
      ns: undefined as never,
    });

    const ack = await handler({ packName: "only-packname" }, ctx);
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.code).toBe("VALIDATION_FAILED");
    }
  });
});
