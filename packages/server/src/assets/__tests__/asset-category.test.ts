import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { migration001 } from "../../db/migrations/001_initial_schema.js";
import { migration004 } from "../../db/migrations/004_region_maps.js";
import { migration009 } from "../../db/migrations/009_assets.js";
import { migration011 } from "../../db/migrations/011_asset_category.js";
import { classifyAssets } from "../asset-category.js";
import { recordAsset, getAssetRecord, setAssetCategory, listAssetRecords } from "../asset-store.js";

function insertDoc(db: Db, table: string, id: string, data: unknown): void {
  const now = Date.now();
  if (table === "scenes") {
    db.prepare(
      `INSERT INTO scenes (id, data, name, active, navigation, sort, created_at, updated_at) VALUES (?, ?, 'n', 0, 1, 0, ?, ?)`,
    ).run(id, JSON.stringify(data), now, now);
  } else {
    db.prepare(
      `INSERT INTO ${table} (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, 'n', 't', 0, ?, ?)`,
    ).run(id, JSON.stringify(data), now, now);
  }
}

const rec = (name: string, extra: { category?: "items" } = {}) => ({
  name,
  digest: "d",
  bytes: 1,
  mimeType: "image/png",
  uploadedBy: null,
  ...extra,
});

describe("asset category", () => {
  let db: Db;
  beforeEach(() => {
    db = new Database(":memory:");
    migration001.up(db);
    migration004.up(db);
    migration009.up(db);
    migration011.up(db);
  });
  afterEach(() => db.close());

  const entry = (name: string, mimeType: string) => ({ name, mimeType });

  it("migration 011 adds a nullable column: existing rows keep working with category null", () => {
    recordAsset(db, rec("a-11111111.png"));
    expect(getAssetRecord(db, "a-11111111.png")?.category).toBeNull();
  });

  it("classifies audio by mime type and the icon area as icons", () => {
    const out = classifyAssets(db, [
      entry("tema-aaaaaaaa.mp3", "audio/mpeg"),
      entry("actionbar-icons/espada-bbbbbbbb.png", "image/png"),
    ]);
    expect(out.get("tema-aaaaaaaa.mp3")).toBe("audio");
    expect(out.get("actionbar-icons/espada-bbbbbbbb.png")).toBe("icons");
  });

  it("classifies by where documents use the file", () => {
    insertDoc(db, "scenes", "s1", {
      background: "/assets/mapa-11111111.png",
      tokens: [{ texture: "/assets/orc-22222222.png" }],
    });
    insertDoc(db, "actors", "a1", { img: "/assets/elfa-33333333.png" });
    insertDoc(db, "items", "i1", { img: "/assets/espada-44444444.png" });
    const names = [
      "mapa-11111111.png",
      "orc-22222222.png",
      "elfa-33333333.png",
      "espada-44444444.png",
      "solto-55555555.png",
    ];
    const out = classifyAssets(
      db,
      names.map((n) => entry(n, "image/png")),
    );
    expect(out.get("mapa-11111111.png")).toBe("maps");
    expect(out.get("orc-22222222.png")).toBe("tokens");
    expect(out.get("elfa-33333333.png")).toBe("tokens");
    expect(out.get("espada-44444444.png")).toBe("items");
    expect(out.get("solto-55555555.png")).toBe("other");
  });

  it("does not let free text in a document reclassify a file", () => {
    insertDoc(db, "actors", "a1", { img: "x", system: { bio: "/assets/segredo-11111111.png" } });
    const out = classifyAssets(db, [entry("segredo-11111111.png", "image/png")]);
    expect(out.get("segredo-11111111.png")).toBe("other");
  });

  it("decodes percent-encoded references", () => {
    insertDoc(db, "scenes", "s1", { background: "/assets/mapa%20grande-11111111.png" });
    const out = classifyAssets(db, [entry("mapa grande-11111111.png", "image/png")]);
    expect(out.get("mapa grande-11111111.png")).toBe("maps");
  });

  it("a stored category beats every derived rule", () => {
    insertDoc(db, "scenes", "s1", { background: "/assets/mapa-11111111.png" });
    recordAsset(db, rec("mapa-11111111.png"));
    expect(setAssetCategory(db, "mapa-11111111.png", "handouts")).toBe(true);
    const out = classifyAssets(db, [entry("mapa-11111111.png", "image/png")]);
    expect(out.get("mapa-11111111.png")).toBe("handouts");
  });

  it("setAssetCategory is false for an unregistered name and null clears back to derived", () => {
    expect(setAssetCategory(db, "nada-00000000.png", "maps")).toBe(false);
    recordAsset(db, rec("a-11111111.png"));
    setAssetCategory(db, "a-11111111.png", "items");
    setAssetCategory(db, "a-11111111.png", null);
    expect(listAssetRecords(db)[0]?.category).toBeNull();
  });

  it("recordAsset keeps an existing category when the same file is registered again", () => {
    recordAsset(db, rec("a-11111111.png", { category: "items" }));
    recordAsset(db, rec("a-11111111.png"));
    expect(getAssetRecord(db, "a-11111111.png")?.category).toBe("items");
  });
});
