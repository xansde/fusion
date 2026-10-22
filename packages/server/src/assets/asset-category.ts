/**
 * Derives the FilePicker tab ("category") of an asset.
 *
 * Precedence, first hit wins:
 *   1. the category stored on the registry row (GM move / upload tab) — an explicit decision;
 *   2. the reserved icon area (`actionbar-icons/…`) -> icons;
 *   3. audio mime type -> audio;
 *   4. where documents use the file: scene/region background -> maps, actor img or scene token
 *      texture -> tokens, item img -> items;
 *   5. everything else -> other.
 * "handouts" has no derivation: nothing in a document says "show this to the players", so it
 * exists only by an explicit category (the "Mostrar aos jogadores" upload or a GM move).
 *
 * The usage scan reads ONLY these named fields (never a free-text scan), so a name typed in a
 * biography cannot reclassify a file. It runs only when some entry still needs a derived answer.
 */

import type { Database } from "better-sqlite3";
import type { AssetCategory } from "@fusion/shared";
import { isIconAssetName, getAssetRecord } from "./asset-store.js";
import { assetRefToStorageName } from "./reconcile.js";

export interface ClassifiableAsset {
  name: string;
  mimeType: string;
}

type UsageCategory = "maps" | "tokens" | "items";
const USAGE_ORDER: readonly UsageCategory[] = ["maps", "tokens", "items"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function note(usage: Map<string, Set<UsageCategory>>, value: unknown, cat: UsageCategory): void {
  if (typeof value !== "string" || !value.startsWith("/assets/")) return;
  const name = assetRefToStorageName(value.split("?")[0] ?? value);
  let set = usage.get(name);
  if (!set) usage.set(name, (set = new Set()));
  set.add(cat);
}

function forEachDoc(db: Database, table: string, fn: (doc: Record<string, unknown>) => void): void {
  let rows: Array<{ data: unknown }>;
  try {
    rows = db.prepare(`SELECT data FROM ${table}`).all() as Array<{ data: unknown }>;
  } catch {
    return; // table absent on an older/partial schema
  }
  for (const row of rows) {
    try {
      const doc: unknown = JSON.parse(String(row.data));
      if (isRecord(doc)) fn(doc);
    } catch {
      /* unreadable document: contributes nothing */
    }
  }
}

function collectUsage(db: Database): Map<string, Set<UsageCategory>> {
  const usage = new Map<string, Set<UsageCategory>>();
  forEachDoc(db, "scenes", (doc) => {
    note(usage, doc["background"], "maps");
    note(usage, doc["thumb"], "maps");
    const tokens = doc["tokens"];
    if (Array.isArray(tokens)) {
      for (const t of tokens as unknown[]) if (isRecord(t)) note(usage, t["texture"], "tokens");
    }
  });
  forEachDoc(db, "region_maps", (doc) => {
    note(usage, doc["image"], "maps");
  });
  forEachDoc(db, "actors", (doc) => {
    note(usage, doc["img"], "tokens");
  });
  forEachDoc(db, "items", (doc) => {
    note(usage, doc["img"], "items");
  });
  return usage;
}

/** The effective category of every given asset (stored first, derived otherwise). */
export function classifyAssets(
  db: Database | undefined,
  assets: readonly ClassifiableAsset[],
): Map<string, AssetCategory> {
  const out = new Map<string, AssetCategory>();
  const pending: ClassifiableAsset[] = [];

  for (const a of assets) {
    const stored = db ? (getAssetRecord(db, a.name)?.category ?? null) : null;
    if (stored !== null) out.set(a.name, stored);
    else if (isIconAssetName(a.name)) out.set(a.name, "icons");
    else if (a.mimeType.startsWith("audio/")) out.set(a.name, "audio");
    else pending.push(a);
  }

  const usage = pending.length > 0 && db ? collectUsage(db) : new Map<string, Set<UsageCategory>>();
  for (const a of pending) {
    const used = usage.get(a.name);
    out.set(a.name, USAGE_ORDER.find((c) => used?.has(c)) ?? "other");
  }
  return out;
}
