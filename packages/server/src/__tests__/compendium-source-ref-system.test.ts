/**
 * #264 (I5) — `(packName, sourceId)` is not a cross-system identity: 36 vendor
 * documents share the SAME pair between pf2e and sf2e with DIFFERENT content
 * (Ratfolk x Ysoki). The origin reference may now carry the origin `systemId`
 * (optional, additive); a world document gets it stamped on import
 * (`flags.fusion.systemId`), so a reader can ask for the right overlay.
 *
 * Without `systemId` the old, deterministic rule stands (pf2e wins).
 *
 * Spec: 16-compendiums-e-importacao.md (REQ-CMP-059, REQ-CMP-055).
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CompendiumService, computeI18nSourceHash } from "../compendium/index.js";
import { CompendiumI18nBySourceRefPayloadSchema } from "@fusion/shared";
import { openDatabase, applyMigrations } from "../db/index.js";
import { Role } from "../auth/user-store.js";
import { UserRole } from "../documents/ownership.js";

const VENDOR_PACK = "ancestries";
const SOURCE_ID = "P6PcVnCkh4XMdefw";

function makeDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-srcref-system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePack(root: string, systemId: "pf2e" | "sf2e", docName: string, ptName: string): void {
  const slug = `${systemId}-ancestries-test`;
  const packId = `${systemId}.ancestries-test`;
  const doc = {
    _id: `${systemId}Anc00001`,
    name: docName,
    type: "ancestry",
    img: null,
    system: { description: `<p>${docName}</p>` },
    flags: { fusion: { sourceId: SOURCE_ID, packName: VENDOR_PACK } },
  };
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pack.json"),
    JSON.stringify({
      id: packId,
      label: packId,
      documentType: "Item",
      systemId,
      indexFields: [],
      license: { license: "ORC", attribution: "Test", reservedNotice: "" },
      source: { repo: null, version: null, importerVersion: "0.1.0" },
      documentCount: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    }),
  );
  writeFileSync(join(dir, "documents.json"), JSON.stringify([doc]));
  writeFileSync(
    join(dir, "i18n.pt-BR.json"),
    JSON.stringify({
      schemaVersion: 1,
      packId,
      locale: "pt-BR",
      generatedAt: "2026-01-01T00:00:00.000Z",
      attribution: "test",
      entries: {
        [doc._id]: {
          name: ptName,
          sourceHash: computeI18nSourceHash(doc as Record<string, unknown>),
        },
      },
    }),
  );
}

function compositeService(): { svc: CompendiumService; root: string } {
  const root = makeDir();
  writePack(root, "pf2e", "Ratfolk", "Ratoide");
  writePack(root, "sf2e", "Ysoki", "Ysoki PT");
  const svc = new CompendiumService();
  svc.discoverPacks(root, undefined);
  return { svc, root };
}

describe("origin reference with systemId (#264)", () => {
  it("no systemId: pf2e keeps winning the collision (old deterministic rule)", () => {
    const { svc, root } = compositeService();
    const hit = svc.getI18nBySourceRef(UserRole.GAMEMASTER, {
      packName: VENDOR_PACK,
      sourceId: SOURCE_ID,
    });
    expect(hit?.name).toBe("Ratoide");
    rmSync(root, { recursive: true, force: true });
  });

  it("systemId sf2e resolves Ysoki's own overlay, systemId pf2e resolves Ratfolk's", () => {
    const { svc, root } = compositeService();
    const ref = { packName: VENDOR_PACK, sourceId: SOURCE_ID };
    expect(svc.getI18nBySourceRef(UserRole.GAMEMASTER, { ...ref, systemId: "sf2e" })?.name).toBe(
      "Ysoki PT",
    );
    expect(svc.getI18nBySourceRef(UserRole.GAMEMASTER, { ...ref, systemId: "pf2e" })?.name).toBe(
      "Ratoide",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("getDocumentBySourceRef honours systemId too", () => {
    const { svc, root } = compositeService();
    const doc = svc.getDocumentBySourceRef(UserRole.GAMEMASTER, {
      packName: VENDOR_PACK,
      sourceId: SOURCE_ID,
      systemId: "sf2e",
    });
    expect(doc?.["name"]).toBe("Ysoki");
    rmSync(root, { recursive: true, force: true });
  });

  it("an unknown systemId falls back to the default resolution instead of failing", () => {
    const { svc, root } = compositeService();
    const hit = svc.getI18nBySourceRef(UserRole.GAMEMASTER, {
      packName: VENDOR_PACK,
      sourceId: SOURCE_ID,
      systemId: "starfinder-1e",
    });
    expect(hit?.name).toBe("Ratoide");
    rmSync(root, { recursive: true, force: true });
  });

  it("the payload schema accepts an optional systemId", () => {
    expect(
      CompendiumI18nBySourceRefPayloadSchema.safeParse({ packName: "a", sourceId: "b" }).success,
    ).toBe(true);
    expect(
      CompendiumI18nBySourceRefPayloadSchema.safeParse({
        packName: "a",
        sourceId: "b",
        systemId: "sf2e",
      }).success,
    ).toBe(true);
  });

  it("importToWorld stamps the origin systemId on flags.fusion, so the world doc can be resolved later", () => {
    const { svc, root } = compositeService();
    const dataDir = makeDir();
    const dbPath = join(dataDir, "world.db");
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    try {
      const result = svc.importToWorld(["Compendium.sf2e.ancestries-test.Item.sf2eAnc00001"], {
        db: fusionDb.raw,
        worldId: "w",
        userId: "gm",
        role: Role.GAMEMASTER,
      });
      expect(result.created).toHaveLength(1);
      const row = fusionDb.raw
        .prepare("SELECT data FROM items WHERE id = ?")
        .get(result.created[0]) as { data: string };
      const flags = (JSON.parse(row.data) as { flags: { fusion: Record<string, unknown> } }).flags;
      expect(flags.fusion["systemId"]).toBe("sf2e");
      expect(flags.fusion["sourceId"]).toBe(SOURCE_ID);
    } finally {
      fusionDb.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
