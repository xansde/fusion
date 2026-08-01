/**
 * CompendiumService — loads pack manifests + indexes and serves documents.
 *
 * Spec: 16-compendiums-e-importacao.md
 * REQ-CMP-001..011, REQ-CMP-030, REQ-CMP-049..054
 *
 * Pack discovery:
 *   Packs for the active system are discovered by reading systems/<systemId>/packs/<slug>/.
 *   Each pack directory must contain pack.json + documents.json (+ optional index.json).
 *   The service builds an in-memory index per pack at startup (REQ-CMP-006, 007).
 *
 * This service uses JSON files instead of SQLite per-pack because the importer
 * generates JSON arrays (documents.json + index.json) for the MVP subset.
 *
 * KNOWN DEVIATION (M3-D audit, FIX-4): REQ-CMP-001 states pack.db (SQLite per
 * pack) is a MUST ("DEVE") for the MVP. We intentionally ship JSON in the MVP
 * and defer SQLite to V2. Rationale: the committed MVP subset is small (~105
 * docs across 4 packs) so JSON load is trivial, and the CompendiumService
 * interface is storage-agnostic — migrating to SQLite later does not change any
 * caller. Tracked decision: "JSON no MVP, SQLite no V2" (see BUILD-LOG.md).
 *
 * TODO(V2/REQ-CMP-030): migrate to SQLite pack.db files with atomic swap on update.
 * The backing store is fully encapsulated here; swap _buildIndex + getDocument to
 * use better-sqlite3 prepared statements when larger packs are included.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import {
  PackManifestSchema,
  PackIndexEntrySchema,
  PackI18nOverlaySchema,
  PackMechanicsOverlaySchema,
  searchPackIndex,
  buildPackDocUuid,
  parsePackDocUuid,
} from "@fusion/shared";
import type {
  PackManifest,
  PackIndex,
  PackIndexEntry,
  CompendiumSearchPayload,
  CompendiumImportResult,
  DocumentTable,
  DocI18n,
  DocMechanics,
} from "@fusion/shared";
import { DocumentStore } from "../documents/store.js";
import { isRolePrivileged } from "../documents/ownership.js";
import type { Database as Db } from "better-sqlite3";
import { createDocumentId } from "@fusion/shared";
import type { SystemModule } from "@fusion/system-api";
import { runActorDerivation } from "../net/derive-runner.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LoadedPack {
  manifest: PackManifest;
  /** Lazy-loaded index. Built on first access. */
  _index: PackIndexEntry[] | null;
  /** Path to documents.json for full-document lookups. */
  docsPath: string;
  /** Path to index.json (pre-built index, may not exist). */
  indexPath: string | null;
  /**
   * Path to i18n.pt-BR.json (translation overlay, may not exist). Resolved at
   * discovery; content is loaded lazily (see `_i18nPtBR`). T1.
   */
  i18nPtBRPath: string | null;
  /**
   * Path to mechanics.json (grants/unlocks overlay, may not exist). T1.
   */
  mechanicsPath: string | null;
  /**
   * Lazy-loaded pt-BR overlay: doc `_id` → localized fields, ALREADY validated
   * against the doc's live EN sourceHash (stale entries dropped → EN fallback).
   * `null` = not yet loaded; an empty Map = overlay absent/empty/all-stale.
   */
  _i18nPtBR: Map<string, DocI18n> | null;
  /**
   * Lazy-loaded mechanics overlay: doc `_id` → grants/unlocks. `null` = not yet
   * loaded; an empty Map = overlay absent/empty.
   */
  _mechanics: Map<string, DocMechanics> | null;
}

// ---------------------------------------------------------------------------
// CompendiumService
// ---------------------------------------------------------------------------

export class CompendiumService {
  private readonly packs = new Map<string, LoadedPack>();
  private readonly logger: Logger | null;

  constructor(logger?: Logger) {
    this.logger = logger ?? null;
  }

  /**
   * Discover and register all packs under the given directory.
   * Directory layout: <packsRoot>/<slug>/pack.json + documents.json
   *
   * REQ-CMP-006: tolerant of missing/corrupt packs — logs and continues.
   */
  discoverPacks(packsRoot: string, systemId?: string): void {
    if (!existsSync(packsRoot)) {
      this.logger?.info({ packsRoot }, "Compendium packs root not found — skipping discovery");
      return;
    }

    let slugs: string[];
    try {
      slugs = readdirSync(packsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      this.logger?.warn({ err, packsRoot }, "Failed to read packs root directory");
      return;
    }

    for (const slug of slugs) {
      const packDir = join(packsRoot, slug);
      const manifestPath = join(packDir, "pack.json");
      const docsPath = join(packDir, "documents.json");

      if (!existsSync(manifestPath) || !existsSync(docsPath)) {
        this.logger?.debug(
          { slug, packDir },
          "Pack directory missing pack.json or documents.json — skipping",
        );
        continue;
      }

      try {
        const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
        const manifestResult = PackManifestSchema.safeParse(rawManifest);
        if (!manifestResult.success) {
          this.logger?.warn(
            { slug, issues: manifestResult.error.issues },
            "Invalid pack.json — skipping pack",
          );
          continue;
        }

        const manifest = manifestResult.data;

        // Filter by systemId if provided
        if (systemId !== undefined && manifest.systemId !== systemId) {
          continue;
        }

        const indexPath = join(packDir, "index.json");
        const i18nPtBRPath = join(packDir, "i18n.pt-BR.json");
        const mechanicsPath = join(packDir, "mechanics.json");

        this.packs.set(manifest.id, {
          manifest,
          _index: null,
          docsPath,
          indexPath: existsSync(indexPath) ? indexPath : null,
          i18nPtBRPath: existsSync(i18nPtBRPath) ? i18nPtBRPath : null,
          mechanicsPath: existsSync(mechanicsPath) ? mechanicsPath : null,
          _i18nPtBR: null,
          _mechanics: null,
        });

        this.logger?.info(
          { packId: manifest.id, documentCount: manifest.documentCount },
          "Registered compendium pack",
        );
      } catch (err) {
        this.logger?.warn({ err, slug }, "Failed to load pack — skipping");
      }
    }
  }

  /**
   * Register a single pack from a directory.
   * Useful for test overrides or manual registration.
   */
  registerPackDir(packDir: string): void {
    this.discoverPacks(packDir.replace(/[/\\][^/\\]+$/, ""), undefined);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * List all registered pack manifests.
   * REQ-CMP-012: filter by systemId and/or documentType.
   */
  listPacks(filter?: { systemId?: string; documentType?: string }): PackManifest[] {
    const packs: PackManifest[] = [];
    for (const { manifest } of this.packs.values()) {
      if (filter?.systemId !== undefined && manifest.systemId !== filter.systemId) continue;
      if (filter?.documentType !== undefined && manifest.documentType !== filter.documentType)
        continue;
      packs.push(manifest);
    }
    return packs;
  }

  /**
   * Get the index for a pack.
   * Lazy-builds from documents.json or index.json on first call.
   * REQ-CMP-007, REQ-CMP-049.
   */
  getPackIndex(packId: string): PackIndex | null {
    const loaded = this.packs.get(packId);
    if (!loaded) return null;

    if (!loaded._index) {
      // Build the base (EN) index, then enrich: (1) the compact per-entry
      // `index.actionCost` (r20-X2) derived from the full documents, then
      // (2) overlay pt-BR names when a translation overlay exists. Enrichment
      // is applied ONCE here and cached in `_index`, so subsequent
      // index/search calls reuse the enriched entries.
      const base = this._buildIndex(loaded);
      const withCost = this._applyActionCostToIndex(loaded, base);
      loaded._index = this._applyI18nToIndex(loaded, withCost);
    }

    return { packId, entries: loaded._index };
  }

  /**
   * Search/filter a pack's index.
   * REQ-CMP-013, REQ-CMP-014.
   */
  searchPack(packId: string, query: CompendiumSearchPayload): PackIndexEntry[] | null {
    const packIndex = this.getPackIndex(packId);
    if (!packIndex) return null;
    return searchPackIndex(packIndex.entries, query);
  }

  /**
   * Get the full document for a Compendium UUID.
   * REQ-CMP-009, REQ-CMP-050.
   */
  getDocument(uuid: string): Record<string, unknown> | null {
    const parsed = parsePackDocUuid(uuid);
    if (!parsed) return null;

    const loaded = this.packs.get(parsed.packId);
    if (!loaded) return null;

    try {
      const docs = JSON.parse(readFileSync(loaded.docsPath, "utf8")) as unknown[];
      const doc = docs.find(
        (d) =>
          typeof d === "object" &&
          d !== null &&
          (d as Record<string, unknown>)["_id"] === parsed.docId,
      );
      if (doc === undefined) return null;

      // Attach translation + mechanics overlays WITHOUT mutating the source
      // arrays. `doc` is a freshly-parsed object from this call's JSON.parse,
      // so a shallow spread here is a private copy — safe to add `i18n`/
      // `mechanics` fields. EN `name`/`system.description` remain untouched
      // (fallback + sourceHash stay computable). T1.
      const enriched: Record<string, unknown> = { ...(doc as Record<string, unknown>) };

      const i18nPtBR = this._getI18nPtBR(loaded).get(parsed.docId);
      if (i18nPtBR !== undefined) {
        enriched["i18n"] = { ptBR: i18nPtBR };
      }

      const mechanics = this._getMechanics(loaded).get(parsed.docId);
      if (mechanics !== undefined) {
        enriched["mechanics"] = mechanics;
      }

      return enriched;
    } catch (err) {
      this.logger?.warn({ err, uuid }, "Failed to read document from pack");
      return null;
    }
  }

  /**
   * Import one or more pack documents into the world (actors or items table).
   * REQ-CMP-021..024.
   *
   * - Clones the document data (new _id for world copy).
   * - Preserves system + flags.fusion.*.
   * - Inserts via DocumentStore.
   * - GM-only operation.
   *
   * DERIVATION ON IMPORT (audit issue 3): imported Actor documents (both
   * `character` and `npc` subtypes) are re-derived via `runActorDerivation`
   * BEFORE the batch insert, when a `systemModule` is supplied. This matters
   * even for NPCs — although an NPC's AC/saves/perception TOTALS are
   * authored directly in the statblock (and correctly served verbatim by the
   * "derived" steps' selector-modifier pass, which is a no-op with no active
   * conditions), other systems' initiative formulas read
   * `system.derived.perception.total` (see combat/system-formula-adapter.ts
   * → SystemModule.combat.initiativeFormulas), which previously stayed
   * `undefined` on freshly-imported actors because nothing had ever computed
   * it — silently rolling "1d20 + 0" for a real statblock. Deriving at
   * import time means `system.derived` is correct and PERSISTED from the
   * moment the actor exists in the world, with no dependency on a later
   * doc:update round-trip. A derivation failure for a single malformed
   * document (e.g. a corrupt pack entry) is caught, logged, and does not
   * fail the import — the actor is still created without `derived` (see
   * combat:rollInitiative's own on-read fallback in combat-handlers.ts for
   * the defense-in-depth cinto-de-segurança layer).
   */
  importToWorld(
    uuids: string[],
    options: {
      db: Db;
      worldId: string;
      userId: string;
      role: number;
      folderId?: string;
      /**
       * The world's resolved SystemModule, when available. Used to derive
       * `system.derived` on imported Actor documents before they are
       * persisted (see docstring above). Optional — undefined skips
       * derivation entirely (stub system, or no system package loaded),
       * same fallback behaviour as doc-handlers.ts/sync-handlers.ts.
       */
      systemModule?: SystemModule;
      logger?: Logger;
    },
  ): CompendiumImportResult {
    if (!isRolePrivileged(options.role)) {
      throw new PermissionDeniedError("Only GM/ASSISTANT can import from compendiums");
    }

    const store = new DocumentStore({ db: options.db });
    const created: string[] = [];
    const failed: Array<{ uuid: string; reason: string }> = [];

    for (const uuid of uuids) {
      try {
        const doc = this.getDocument(uuid);
        if (!doc) {
          failed.push({ uuid, reason: "Document not found in compendium" });
          continue;
        }

        const parsed = parsePackDocUuid(uuid);
        if (!packed(parsed)) {
          failed.push({ uuid, reason: "Invalid UUID" });
          continue;
        }

        // Determine target table by documentType
        const manifest = this.packs.get(parsed.packId)?.manifest;
        if (!manifest) {
          failed.push({ uuid, reason: "Pack not found" });
          continue;
        }

        const table = docTypeToTable(manifest.documentType);

        // Build world document (REQ-CMP-021)
        const worldId = createDocumentId();
        const worldDoc: Record<string, unknown> = {
          ...doc,
          _id: worldId, // new world _id
          folder: options.folderId ?? null,
          // Preserve flags.fusion (conversion metadata)
        };

        // Strip pack-only / browser-only fields. `i18n` and `mechanics` are
        // overlay projections attached by getDocument() for the picker UI (T1);
        // the imported world document must stay EN-pure and identical to the
        // pre-T1 import shape, so drop them here (belt-and-suspenders — the
        // world derivation/persistence never reads them).
        delete worldDoc["uuid"];
        delete worldDoc["i18n"];
        delete worldDoc["mechanics"];

        // Derive on import (audit issue 3) — Actor documents only.
        //
        // No deep-clone needed here (unlike doc-handlers.ts/sync-handlers.ts/
        // combat-handlers.ts — see derive-runner.ts docstring, audit issue
        // 5): `worldDoc["system"]` is a freshly-parsed object from this
        // iteration's `getDocument()` JSON.parse call, not shared with any
        // other consumer — mutating it in place (including the cache fields
        // some DeriveSteps write outside `derived`) is safe because the
        // WHOLE worldDoc, exactly as mutated, is what gets persisted below.
        if (manifest.documentType === "Actor" && options.systemModule) {
          try {
            runActorDerivation(worldDoc, options.systemModule);
          } catch (deriveErr) {
            options.logger?.warn(
              { err: deriveErr, uuid },
              "Actor derivation failed during compendium import — importing without derived",
            );
          }
        }

        const results = store.createBatch(table as DocumentTable, [worldDoc], {
          userId: options.userId,
        });

        const first = results[0];
        if (first) {
          const id = first["_id"];
          if (typeof id === "string") {
            created.push(id);
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ uuid, reason });
        this.logger?.warn({ err, uuid }, "Failed to import document from compendium");
      }
    }

    return { created, failed };
  }

  // ---------------------------------------------------------------------------
  // Private helpers — overlays (T1)
  // ---------------------------------------------------------------------------

  /**
   * Lazily load + validate the pt-BR translation overlay for a pack, keyed by
   * doc `_id`. Result is cached on `loaded._i18nPtBR`.
   *
   * STALENESS GATE: each overlay entry carries a `sourceHash` computed by
   * tools/translate-packs over the EN source (name + description). We recompute
   * that hash from the LIVE `documents.json` and DROP any entry whose hash no
   * longer matches — so a doc whose EN text changed without the overlay being
   * regenerated falls back to EN instead of showing an obsolete translation.
   * EN is always the fallback (REQ: overlay never mutates the source).
   *
   * Tolerant of a missing/corrupt/mis-typed overlay: returns an empty Map and
   * logs, matching the discovery philosophy (REQ-CMP-006).
   */
  private _getI18nPtBR(loaded: LoadedPack): Map<string, DocI18n> {
    if (loaded._i18nPtBR) return loaded._i18nPtBR;

    const result = new Map<string, DocI18n>();
    loaded._i18nPtBR = result;

    if (!loaded.i18nPtBRPath) return result;

    let overlay;
    try {
      const raw = JSON.parse(readFileSync(loaded.i18nPtBRPath, "utf8")) as unknown;
      const parsed = PackI18nOverlaySchema.safeParse(raw);
      if (!parsed.success) {
        this.logger?.warn(
          { packId: loaded.manifest.id, issues: parsed.error.issues },
          "Invalid i18n.pt-BR.json — ignoring translation overlay",
        );
        return result;
      }
      overlay = parsed.data;
    } catch (err) {
      this.logger?.warn(
        { err, packId: loaded.manifest.id },
        "Failed to read i18n.pt-BR.json — ignoring translation overlay",
      );
      return result;
    }

    // Build the live EN source-hash map so we can gate stale translations.
    const enHashes = this._buildEnSourceHashes(loaded);

    let stale = 0;
    for (const [docId, entry] of Object.entries(overlay.entries)) {
      const liveHash = enHashes.get(docId);
      if (liveHash === undefined || liveHash !== entry.sourceHash) {
        stale++;
        continue; // EN fallback for stale/absent source
      }
      const localized: DocI18n = { name: entry.name };
      if (entry.description !== undefined) localized.description = entry.description;
      result.set(docId, localized);
    }

    this.logger?.debug(
      { packId: loaded.manifest.id, translated: result.size, stale },
      "Loaded pt-BR translation overlay",
    );
    return result;
  }

  /**
   * Lazily load the mechanics overlay for a pack, keyed by doc `_id`. Result is
   * cached on `loaded._mechanics`. Tolerant of missing/corrupt overlay (empty
   * Map). Unlike the i18n overlay, mechanics entries are served as-is (their
   * `sourceHash` is a regen detail for tools/translate-packs, not a runtime
   * gate — a grant filter does not become "wrong" the way stale prose does).
   */
  private _getMechanics(loaded: LoadedPack): Map<string, DocMechanics> {
    if (loaded._mechanics) return loaded._mechanics;

    const result = new Map<string, DocMechanics>();
    loaded._mechanics = result;

    if (!loaded.mechanicsPath) return result;

    try {
      const raw = JSON.parse(readFileSync(loaded.mechanicsPath, "utf8")) as unknown;
      const parsed = PackMechanicsOverlaySchema.safeParse(raw);
      if (!parsed.success) {
        this.logger?.warn(
          { packId: loaded.manifest.id, issues: parsed.error.issues },
          "Invalid mechanics.json — ignoring mechanics overlay",
        );
        return result;
      }
      for (const [docId, entry] of Object.entries(parsed.data.entries)) {
        result.set(docId, { grants: entry.grants, unlocks: entry.unlocks });
      }
      this.logger?.debug(
        { packId: loaded.manifest.id, entries: result.size },
        "Loaded mechanics overlay",
      );
    } catch (err) {
      this.logger?.warn(
        { err, packId: loaded.manifest.id },
        "Failed to read mechanics.json — ignoring mechanics overlay",
      );
    }
    return result;
  }

  /**
   * Compute the EN source-hash for every doc in a pack, keyed by `_id`. The
   * hash is `sha1(name_EN + "\u0000" + description_EN)` — the SAME formula
   * tools/translate-packs uses to key its overlay entries (T1 contract §3.a).
   * A NUL separator prevents boundary collisions. Missing name/description are
   * treated as empty strings.
   */
  private _buildEnSourceHashes(loaded: LoadedPack): Map<string, string> {
    const hashes = new Map<string, string>();
    let docs: unknown[];
    try {
      docs = JSON.parse(readFileSync(loaded.docsPath, "utf8")) as unknown[];
    } catch (err) {
      this.logger?.warn(
        { err, packId: loaded.manifest.id },
        "Failed to read documents.json for i18n source-hash gate",
      );
      return hashes;
    }
    for (const raw of docs) {
      if (typeof raw !== "object" || raw === null) continue;
      const doc = raw as Record<string, unknown>;
      const id = doc["_id"];
      if (typeof id !== "string") continue;
      hashes.set(id, computeI18nSourceHash(doc));
    }
    return hashes;
  }

  /**
   * Overlay pt-BR localized fields onto the base (EN) index entries. Attaches
   * `entry.i18n.ptBR` and the denormalized `entry.namePt` (for bilingual
   * search) when a validated translation exists. Entries WITHOUT a translation
   * are returned unchanged (no `i18n`/`namePt` keys) so their serialized shape
   * stays byte-identical to the pre-T1 index. T1.
   */
  private _applyI18nToIndex(loaded: LoadedPack, base: PackIndexEntry[]): PackIndexEntry[] {
    const i18nMap = this._getI18nPtBR(loaded);
    if (i18nMap.size === 0) return base;

    return base.map((entry) => {
      const localized = i18nMap.get(entry._id);
      if (localized === undefined) return entry;
      const enriched: PackIndexEntry = {
        ...entry,
        i18n: { ptBR: localized },
        namePt: localized.name,
      };
      return enriched;
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers — action-cost index enrichment (r20-X2)
  // ---------------------------------------------------------------------------

  /**
   * Overlay the compact `index.actionCost` field onto the base index entries.
   * The value is a raw, locale-agnostic action-cost token derived from the FULL
   * document (see {@link computeActionCost}) — spells → `system.time.value`
   * ("2", "reaction", "1 minute", …); feats/actions/familiar abilities →
   * `system.actionType` + `system.actions` ("2", "reaction", "free"). Passive /
   * cost-less docs get NO `actionCost` key at all, so their serialized shape
   * stays byte-identical to the pre-X2 index and the picker rows render no glyph.
   *
   * Why derive from documents.json rather than the pre-built index.json: the
   * committed index.json (and the manifests' `indexFields`) do NOT carry the
   * action-economy fields for spells/feats — spells-core indexes only level/
   * traits/traditions, feats-core only name/level/category/traits, and
   * familiar-abilities-core has `actionType` but not `actions`. Reading the full
   * documents here is the single reliable source, and it mirrors the existing
   * i18n staleness gate ({@link _buildEnSourceHashes}) which already reads
   * documents.json. The client turns the token into ◆/◇/⟳/text via
   * `formatActionCost` (locale stays on the client).
   */
  private _applyActionCostToIndex(loaded: LoadedPack, base: PackIndexEntry[]): PackIndexEntry[] {
    const costs = this._buildActionCosts(loaded);
    if (costs.size === 0) return base;

    return base.map((entry) => {
      const cost = costs.get(entry._id);
      if (cost === undefined) return entry;
      return { ...entry, index: { ...entry.index, actionCost: cost } };
    });
  }

  /**
   * Compute the compact action-cost token for every doc in a pack, keyed by
   * `_id`. Docs with no meaningful cost (passive, or a type without an
   * action-economy/time field) are simply absent from the map. Tolerant of a
   * missing/corrupt documents.json — returns an empty Map and logs.
   */
  private _buildActionCosts(loaded: LoadedPack): Map<string, string> {
    const costs = new Map<string, string>();
    let docs: unknown[];
    try {
      docs = JSON.parse(readFileSync(loaded.docsPath, "utf8")) as unknown[];
    } catch (err) {
      this.logger?.warn(
        { err, packId: loaded.manifest.id },
        "Failed to read documents.json for action-cost index",
      );
      return costs;
    }
    for (const raw of docs) {
      if (typeof raw !== "object" || raw === null) continue;
      const doc = raw as Record<string, unknown>;
      const id = doc["_id"];
      if (typeof id !== "string") continue;
      const cost = computeActionCost(doc);
      if (cost !== undefined) costs.set(id, cost);
    }
    return costs;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the in-memory index for a pack.
   * Tries index.json first, falls back to scanning documents.json.
   * REQ-CMP-007.
   */
  private _buildIndex(loaded: LoadedPack): PackIndexEntry[] {
    // Try pre-built index.json first
    if (loaded.indexPath) {
      try {
        const rawIndex = JSON.parse(readFileSync(loaded.indexPath, "utf8")) as unknown[];
        const entries: PackIndexEntry[] = [];
        for (const raw of rawIndex) {
          const result = PackIndexEntrySchema.safeParse(raw);
          if (result.success) {
            entries.push(result.data);
          }
        }
        if (entries.length > 0) {
          this.logger?.debug(
            { packId: loaded.manifest.id, count: entries.length },
            "Loaded pack index from index.json",
          );
          return entries;
        }
      } catch {
        // Fall through to documents.json scan
      }
    }

    // Build index from documents.json
    return this._buildIndexFromDocuments(loaded);
  }

  /**
   * Build an index by scanning documents.json.
   * Extracts indexFields via simple dot-path access.
   */
  private _buildIndexFromDocuments(loaded: LoadedPack): PackIndexEntry[] {
    const { manifest, docsPath } = loaded;
    let docs: unknown[];

    try {
      docs = JSON.parse(readFileSync(docsPath, "utf8")) as unknown[];
    } catch (err) {
      this.logger?.warn(
        { err, packId: manifest.id },
        "Failed to read documents.json for index build",
      );
      return [];
    }

    const entries: PackIndexEntry[] = [];

    for (const raw of docs) {
      if (typeof raw !== "object" || raw === null) continue;
      const doc = raw as Record<string, unknown>;

      const id = doc["_id"];
      if (typeof id !== "string") continue;

      // Build extra index fields by extracting values from `system`
      const indexExtras: Record<string, unknown> = {};
      for (const field of manifest.indexFields) {
        const value = extractDotPath(doc, field);
        if (value !== undefined) {
          indexExtras[field] = value;
        }
      }

      const uuid = buildPackDocUuid(manifest.id, manifest.documentType, id);

      const entry: PackIndexEntry = {
        _id: id,
        uuid,
        name: typeof doc["name"] === "string" ? doc["name"] : "(unknown)",
        img: typeof doc["img"] === "string" ? doc["img"] : null,
        type: typeof doc["type"] === "string" ? doc["type"] : null,
        index: indexExtras,
      };

      entries.push(entry);
    }

    this.logger?.debug(
      { packId: manifest.id, count: entries.length },
      "Built pack index from documents.json",
    );

    return entries;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function packed<T>(v: T | null): v is T {
  return v !== null;
}

/**
 * Separator between name and description in the i18n source-hash input. A NUL
 * (U+0000) can never appear in the source text, so it cannot collide with a
 * name/description boundary. Kept as an explicit escape (never a raw NUL byte
 * in this file) so the source stays plain text.
 */
const I18N_HASH_SEP = "\u0000";

/**
 * Compute the i18n source-hash for a document — the staleness key for pt-BR
 * translation overlay entries. sha1(name_EN + NUL + description_EN), matching
 * the formula tools/translate-packs uses (T1 contract §3.a). Missing
 * fields are treated as empty strings.
 *
 * IMPORTANT: this must stay byte-for-byte in sync with the generator hash
 * (tools/translate-packs/src/hash.ts) — both derive from the same documented
 * formula, not shared code (module boundaries: shared must not depend on the
 * tool, the tool must not depend on the server).
 */
export function computeI18nSourceHash(doc: Record<string, unknown>): string {
  const name = typeof doc["name"] === "string" ? doc["name"] : "";
  const system = doc["system"];
  const description =
    system !== null && typeof system === "object" && !Array.isArray(system)
      ? (system as Record<string, unknown>)["description"]
      : undefined;
  const descStr = typeof description === "string" ? description : "";
  return createHash("sha1")
    .update(name + I18N_HASH_SEP + descStr)
    .digest("hex");
}

/**
 * Unwrap a possibly-`{ value }`-wrapped scalar. pf2e ships `system.actionType`
 * as a bare string and `system.actions` as a bare number in the committed
 * packs, but other systems (or future data) may nest them under `.value`;
 * accept both shapes so the action-cost derivation is robust.
 */
function unwrapScalar(v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && "value" in v) {
    return (v as Record<string, unknown>)["value"];
  }
  return v;
}

/**
 * Derive the compact action-cost token for a compendium document (r20-X2),
 * consumed by the client's `formatActionCost` to render ◆/◇/⟳/short-text.
 *
 * Precedence:
 *   1. Action-economy fields (feats, actions, familiar abilities):
 *      `system.actionType` = "action" → the `system.actions` count as a string
 *      ("1".."4"); "reaction" → "reaction"; "free" → "free"; "passive" (or an
 *      "action" with no valid count) → undefined (no cost badge).
 *   2. Spells: `system.time.value` (or the flattened `system.castTime`) verbatim
 *      — e.g. "2", "reaction", "1 to 3", "1 minute". The client formats long
 *      textual times as short text instead of glyphs.
 *
 * Returns undefined when no cost can be determined (the entry then carries no
 * `index.actionCost` key at all).
 */
export function computeActionCost(doc: Record<string, unknown>): string | undefined {
  const system = doc["system"];
  if (system === null || typeof system !== "object" || Array.isArray(system)) return undefined;
  const sys = system as Record<string, unknown>;

  const actionType = unwrapScalar(sys["actionType"]);
  if (typeof actionType === "string") {
    switch (actionType) {
      case "action": {
        const actions = unwrapScalar(sys["actions"]);
        if (
          typeof actions === "number" &&
          Number.isInteger(actions) &&
          actions >= 1 &&
          actions <= 4
        ) {
          return String(actions);
        }
        return undefined; // action with no/invalid count → omit
      }
      case "reaction":
        return "reaction";
      case "free":
        return "free";
      default:
        return undefined; // "passive" / unknown → no cost badge
    }
  }

  const time = sys["time"];
  if (time !== null && typeof time === "object" && !Array.isArray(time)) {
    const value = (time as Record<string, unknown>)["value"];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const castTime = sys["castTime"];
  if (typeof castTime === "string" && castTime.trim()) return castTime.trim();

  return undefined;
}

/**
 * Map PackManifest.documentType to the DB table name.
 */
export function docTypeToTable(documentType: string): string {
  switch (documentType) {
    case "Actor":
      return "actors";
    case "Item":
      return "items";
    case "JournalEntry":
      return "journal_entries";
    case "RollTable":
      return "roll_tables";
    case "Macro":
      return "macros";
    case "Scene":
      return "scenes";
    case "Playlist":
      return "playlists";
    default:
      return "items";
  }
}

/**
 * Extract a value from an object by dot-path.
 * E.g., "system.level.value" → obj.system.level.value
 */
export function extractDotPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Permission denied error for compendium imports.
 */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

// ---------------------------------------------------------------------------
// Monorepo packs directory resolution
// ---------------------------------------------------------------------------

/**
 * Locate the monorepo root by walking up from a starting directory until a
 * directory containing `pnpm-workspace.yaml` is found.
 *
 * Works identically whether the server runs from source (tsx →
 * packages/server/src/compendium/) or from the compiled output (node →
 * packages/server/dist/compendium/), because both live at the same relative
 * depth under the workspace root and the marker file is the same.
 *
 * @returns the absolute monorepo root path, or null if not found.
 */
export function findMonorepoRoot(startDir: string): string | null {
  let current = startDir;
  // Bound the walk to avoid an infinite loop on exotic filesystems.
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }
  return null;
}

/**
 * Resolve the packs directory for a game system: `<root>/systems/<systemId>/packs`.
 *
 * Resolution order (B3-FIXES MÉDIA B added step 2 — the other two were the
 * original M3 behaviour):
 *   1. Explicit `packsDirOverride` (e.g. FUSION_PACKS_DIR config) — used verbatim.
 *   2. `<dataDir>/runtime/<version>/system-packs/<systemId>/packs` — the SEA
 *      build's embedded copy, extracted once per version by
 *      `runtime/sea-entry.ts` via `ensureSystemPacksExtracted` (sea-assets.ts)
 *      BEFORE boot() runs, and exposed here through the
 *      `FUSION_SEA_SYSTEM_PACKS_DIR` env var — same pattern
 *      `spa/routes.ts`'s `resolveClientDistDir` uses for `FUSION_SEA_CLIENT_DIST`.
 *      Takes priority over the monorepo walk-up because on a clean machine
 *      running the packaged exe there IS no monorepo checkout next to it —
 *      step 3 always returns null in that case, which is exactly the gap
 *      this step closes (compendium:list was returning [] in the exe).
 *   3. `<monorepoRoot>/systems/<systemId>/packs` discovered from this module's
 *      location via {@link findMonorepoRoot} — dev/test/non-SEA path.
 *
 * Returns null when the directory cannot be located or does not exist; callers
 * should treat that as "no packs available" and continue (REQ-CMP-006).
 *
 * @param systemId         active world system id (e.g. "pf2e").
 * @param packsDirOverride optional explicit packs directory (per-system root,
 *                         i.e. the directory that contains <slug>/pack.json).
 */
export function resolveSystemPacksDir(systemId: string, packsDirOverride?: string): string | null {
  if (packsDirOverride !== undefined && packsDirOverride.length > 0) {
    return existsSync(packsDirOverride) ? packsDirOverride : null;
  }

  const seaSystemPacksRoot = process.env["FUSION_SEA_SYSTEM_PACKS_DIR"];
  if (seaSystemPacksRoot !== undefined && seaSystemPacksRoot.length > 0) {
    const seaPacksDir = join(seaSystemPacksRoot, systemId, "packs");
    if (existsSync(seaPacksDir)) return seaPacksDir;
    // Fall through to the monorepo walk-up rather than returning null
    // outright — e.g. a system with no packs of its own (engine-2e, stub)
    // legitimately has nothing under system-packs/, and a dev running a SEA
    // build from a monorepo checkout should still find packs normally.
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const root = findMonorepoRoot(here);
  if (root === null) return null;

  const packsDir = join(root, "systems", systemId, "packs");
  return existsSync(packsDir) ? packsDir : null;
}
