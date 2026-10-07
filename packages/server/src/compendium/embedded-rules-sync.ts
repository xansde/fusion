/**
 * REQ-CMP-056 — bring rules the pack gained AFTER a character was created into
 * that character's embedded items.
 *
 * An item enters a sheet as a snapshot of the pack document (REQ-CMP-021,
 * `importToActor`), keeping `flags.fusion.{packName,sourceId}` as its origin.
 * A rule the pack gains later (Titan Wrestler's size limit, wave 10) therefore
 * never reaches characters created before it. This runs once per boot, right
 * after the packs are discovered, and for each embedded item whose origin
 * resolves to a pack document it copies ONLY the rule/mechanics fields:
 *
 *   - `system.rules`
 *   - `flags.fusion.{unconvertedRules, disabledRules, curatedRules, conversion}`
 *
 * Everything the character owns stays: name, quantity, equipped, notes, runes,
 * and the player's picks (`flags.system.rulesSelections`, a separate key from
 * `system.rules`).
 *
 * WHY NOT A NUMBERED MIGRATION (db/migrations/): migrations run before the
 * server boots and have no access to the compendium, and the pack changes
 * independently of the schema version. The sync is idempotent instead:
 * `flags.fusion.rulesSync` records the hash of the pack payload last applied, an
 * item whose marker equals the pack's current hash is skipped without
 * comparing, and an item whose rules already equal the pack's is skipped
 * without writing. A second run over the same data writes nothing.
 *
 * Skipped without touching: no `packName`/`sourceId`, origin not found in any
 * loaded pack (homebrew, removed from the pack), or a pack document of a
 * different `type` than the embedded item (identity collision, never a sync).
 */

import { createHash } from "node:crypto";
import type { Database as Db } from "better-sqlite3";
import type { Logger } from "pino";
import type { SystemModule } from "@fusion/system-api";
import { DocumentStore } from "../documents/store.js";
import { recomputeDerivedIfNeeded } from "../documents/derive.js";
import type { CompendiumService } from "./service.js";

/** `flags.fusion` keys that describe the pack's rule state and are copied over. */
const FUSION_RULE_KEYS = [
  "unconvertedRules",
  "disabledRules",
  "curatedRules",
  "conversion",
] as const;

/** Marker: hash of the pack payload last applied to the item. */
export const RULES_SYNC_FLAG = "rulesSync";

export interface EmbeddedRulesSyncOptions {
  db: Db;
  compendiumService: CompendiumService;
  /** When given, every actor that changed is re-derived after the write. */
  systemModule?: SystemModule;
  logger?: Logger;
}

export interface EmbeddedRulesSyncResult {
  actorsScanned: number;
  actorsUpdated: number;
  itemsUpdated: number;
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

/** JSON with sorted keys, so equal payloads hash equal whatever the key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const rec = asRec(v);
  if (rec) {
    return `{${Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function hashOf(payload: Rec): string {
  return createHash("sha1").update(canonical(payload)).digest("hex").slice(0, 16);
}

/** The rule-bearing slice of a document: what the sync reads from the pack and compares. */
function rulesPayload(doc: Rec): Rec {
  const fusion = asRec(asRec(doc["flags"])?.["fusion"]);
  const rules = asRec(doc["system"])?.["rules"];
  const payload: Rec = { rules: Array.isArray(rules) ? rules : [] };
  for (const key of FUSION_RULE_KEYS) {
    if (fusion?.[key] !== undefined) payload[key] = fusion[key];
  }
  return payload;
}

/** Apply the pack's payload onto an embedded item (mutates). */
function applyPayload(item: Rec, payload: Rec, hash: string): void {
  const system = asRec(item["system"]) ?? {};
  system["rules"] = structuredClone(payload["rules"]);
  item["system"] = system;

  const flags = asRec(item["flags"]) ?? {};
  const fusion = asRec(flags["fusion"]) ?? {};
  for (const key of FUSION_RULE_KEYS) {
    if (payload[key] === undefined) Reflect.deleteProperty(fusion, key);
    else fusion[key] = structuredClone(payload[key]);
  }
  fusion[RULES_SYNC_FLAG] = hash;
  flags["fusion"] = fusion;
  item["flags"] = flags;
}

/** Sync one embedded item; `true` when it changed. */
function syncItem(item: Rec, svc: CompendiumService): boolean {
  const fusion = asRec(asRec(item["flags"])?.["fusion"]);
  const packName = fusion?.["packName"];
  const sourceId = fusion?.["sourceId"];
  if (typeof packName !== "string" || typeof sourceId !== "string") return false;

  const packDoc = svc.getSourceDocumentForSync({ packName, sourceId });
  if (!packDoc || packDoc["type"] !== item["type"]) return false;

  const packPayload = rulesPayload(packDoc);
  const hash = hashOf(packPayload);
  if (fusion?.[RULES_SYNC_FLAG] === hash) return false;
  if (hashOf(rulesPayload(item)) === hash) return false;

  applyPayload(item, packPayload, hash);
  return true;
}

export function syncEmbeddedPackRules(options: EmbeddedRulesSyncOptions): EmbeddedRulesSyncResult {
  const { db, compendiumService, logger } = options;
  const store = new DocumentStore({ db, ...(logger ? { logger } : {}) });
  const result: EmbeddedRulesSyncResult = { actorsScanned: 0, actorsUpdated: 0, itemsUpdated: 0 };

  const rows = db.prepare("SELECT id, data FROM actors").all() as { id: string; data: string }[];
  for (const row of rows) {
    result.actorsScanned++;
    let actor: Rec;
    try {
      actor = JSON.parse(row.data) as Rec;
    } catch {
      continue;
    }
    const items = Array.isArray(actor["items"]) ? (actor["items"] as unknown[]) : [];
    let changed = 0;
    for (const raw of items) {
      const item = asRec(raw);
      if (item && syncItem(item, compendiumService)) changed++;
    }
    if (changed === 0) continue;

    try {
      const updated = store.update("actors", row.id, { items }, { userId: null });
      if (!updated) continue;
      result.actorsUpdated++;
      result.itemsUpdated += changed;
      const deps: { store: DocumentStore; systemModule?: SystemModule; logger?: Logger } = {
        store,
      };
      if (options.systemModule) deps.systemModule = options.systemModule;
      if (logger) deps.logger = logger;
      recomputeDerivedIfNeeded(deps, "Actor", updated);
    } catch (err) {
      logger?.warn({ err, actorId: row.id }, "Embedded rules sync failed for actor — left as is");
    }
  }

  if (result.itemsUpdated > 0) {
    logger?.info(result, "Embedded pack rules synced into existing actors (REQ-CMP-056)");
  }
  return result;
}
