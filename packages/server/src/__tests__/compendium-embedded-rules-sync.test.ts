/**
 * REQ-CMP-056 — sync of pack rules into already-created characters.
 *
 * An embedded item is a snapshot of the pack document taken when it entered the
 * sheet, so a rule the pack gained later (Titan Wrestler's size limit, wave 10)
 * never reached characters created before it. The boot-time sync brings ONLY
 * the rule/mechanics fields across and never touches what the player chose.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CompendiumService } from "../compendium/index.js";
import { syncEmbeddedPackRules } from "../compendium/embedded-rules-sync.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import { DocumentStore } from "../documents/store.js";

const PACK_SLUG = "feats-sync-test";
const MANIFEST = {
  id: `pf2e.${PACK_SLUG}`,
  label: "Feats sync test",
  documentType: "Item",
  systemId: "pf2e",
  indexFields: [],
  license: { license: "ORC", attribution: "Test", reservedNotice: "" },
  source: { repo: null, version: null, importerVersion: "0.1.0" },
  documentCount: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

const SIZE_LIMIT_RULE = {
  kind: "fusion-maneuver-size-limit",
  maneuvers: ["trip", "shove"],
  maxSizeDelta: 2,
  legendaryMaxSizeDelta: 3,
};
const CHOICE_RULE = { kind: "choice-set", flag: "damageType", choices: ["fire", "cold"] };

const FUSION_ORIGIN = { packName: "feats", sourceId: "TITAN01" };

function packDoc(rules: unknown[]): Record<string, unknown> {
  return {
    _id: "doc-titan",
    name: "Titan Wrestler",
    type: "feat",
    img: "icons/placeholder/feat.svg",
    system: { description: "pack text", rules },
    flags: { fusion: { ...FUSION_ORIGIN } },
  };
}

const dirs: string[] = [];
function tmp(): string {
  const dir = join(
    tmpdir(),
    `fusion-rules-sync-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function loadService(packsRoot: string): CompendiumService {
  const svc = new CompendiumService();
  svc.discoverPacks(packsRoot, "pf2e");
  return svc;
}

function writePack(packsRoot: string, docs: unknown[]): void {
  const packDir = join(packsRoot, PACK_SLUG);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(docs));
}

function setup(packDocs: unknown[]) {
  const packsRoot = tmp();
  writePack(packsRoot, packDocs);
  const svc = loadService(packsRoot);

  const dbPath = join(tmp(), "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const db = fusionDb.raw;
  return { packsRoot, svc, db, store: new DocumentStore({ db }) };
}
type Ctx = ReturnType<typeof setup>;

function embedded(over: Record<string, unknown>): Record<string, unknown> {
  return { _id: "emb1", name: "x", type: "feat", img: "i.svg", system: { rules: [] }, ...over };
}

function createActor(store: DocumentStore, items: Record<string, unknown>[]): string {
  const actor = store.create("actors", { name: "Hero", type: "character", items });
  return actor["_id"] as string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readItems(db: Ctx["db"], id: string): Record<string, any>[] {
  const row = db.prepare("SELECT data FROM actors WHERE id = ?").get(id) as { data: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (JSON.parse(row.data) as { items: Record<string, any>[] }).items;
}

function run(ctx: Ctx, svc: CompendiumService = ctx.svc) {
  return syncEmbeddedPackRules({ db: ctx.db, compendiumService: svc });
}

describe("syncEmbeddedPackRules (REQ-CMP-056)", () => {
  it("old Titan Wrestler snapshot without the rule gains the size limit", () => {
    const ctx = setup([packDoc([SIZE_LIMIT_RULE])]);
    const id = createActor(ctx.store, [
      embedded({
        name: "Lutador de Titas",
        system: { description: "old", rules: [] },
        flags: { fusion: { ...FUSION_ORIGIN } },
      }),
    ]);

    const out = run(ctx);

    const item = readItems(ctx.db, id)[0]!;
    expect(item["system"].rules).toEqual([SIZE_LIMIT_RULE]);
    expect(out.actorsUpdated).toBe(1);
    expect(out.itemsUpdated).toBe(1);
    // fields that are not rules stay as the character has them
    expect(item["name"]).toBe("Lutador de Titas");
    expect(item["system"].description).toBe("old");
  });

  it("player picks and personal fields survive the sync", () => {
    const ctx = setup([packDoc([CHOICE_RULE, SIZE_LIMIT_RULE])]);
    const id = createActor(ctx.store, [
      embedded({
        name: "Meu nome",
        system: { rules: [CHOICE_RULE], quantity: 3, equipped: true, notes: "minhas notas" },
        flags: {
          system: { rulesSelections: { damageType: "cold" } },
          fusion: { ...FUSION_ORIGIN },
        },
      }),
    ]);

    run(ctx);

    const item = readItems(ctx.db, id)[0]!;
    expect(item["system"].rules).toEqual([CHOICE_RULE, SIZE_LIMIT_RULE]);
    expect(item["flags"].system.rulesSelections).toEqual({ damageType: "cold" });
    expect(item["name"]).toBe("Meu nome");
    expect(item["system"].quantity).toBe(3);
    expect(item["system"].equipped).toBe(true);
    expect(item["system"].notes).toBe("minhas notas");
  });

  it("second run writes nothing", () => {
    const ctx = setup([packDoc([SIZE_LIMIT_RULE])]);
    createActor(ctx.store, [embedded({ flags: { fusion: { ...FUSION_ORIGIN } } })]);

    run(ctx);
    const before = ctx.db.prepare("SELECT id, data FROM actors").all();
    const second = run(ctx);
    const after = ctx.db.prepare("SELECT id, data FROM actors").all();

    expect(second).toMatchObject({ actorsUpdated: 0, itemsUpdated: 0 });
    expect(after).toEqual(before);
  });

  it("homebrew item, sourceless item, unknown source and type mismatch are untouched", () => {
    const ctx = setup([packDoc([SIZE_LIMIT_RULE])]);
    const homebrew = embedded({ _id: "a", name: "Homebrew", system: { rules: [CHOICE_RULE] } });
    const orphan = embedded({
      _id: "b",
      flags: { fusion: { packName: "feats", sourceId: "GONE" } },
    });
    const wrongType = embedded({
      _id: "c",
      type: "equipment",
      flags: { fusion: { ...FUSION_ORIGIN } },
    });
    const id = createActor(ctx.store, [homebrew, orphan, wrongType]);
    const before = readItems(ctx.db, id);

    const out = run(ctx);

    expect(out.itemsUpdated).toBe(0);
    expect(readItems(ctx.db, id)).toEqual(before);
  });

  it("a later pack change reaches an item already synced once", () => {
    const ctx = setup([packDoc([SIZE_LIMIT_RULE])]);
    const id = createActor(ctx.store, [embedded({ flags: { fusion: { ...FUSION_ORIGIN } } })]);
    run(ctx);

    const changed = { ...SIZE_LIMIT_RULE, maxSizeDelta: 1 };
    writePack(ctx.packsRoot, [packDoc([changed])]);

    const out = run(ctx, loadService(ctx.packsRoot));

    expect(out.itemsUpdated).toBe(1);
    expect(readItems(ctx.db, id)[0]!["system"].rules).toEqual([changed]);
  });
});
