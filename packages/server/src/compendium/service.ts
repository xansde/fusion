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
  matchesFilters,
  normalizeSearchText,
  buildPackDocUuid,
  parsePackDocUuid,
  COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP,
  isSheetImportableDocumentType,
  OwnershipLevel,
} from "@fusion/shared";
import type {
  PackManifest,
  PackIndex,
  PackIndexEntry,
  CompendiumSearchPayload,
  CompendiumSearchAllPayload,
  CompendiumSearchAllResult,
  CompendiumSearchAllEntry,
  CompendiumSearchAllGroup,
  CompendiumSearchAllPackTally,
  CompendiumImportResult,
  CompendiumImportToActorResult,
  Ownership,
  DocumentTable,
  DocI18n,
  DocMechanics,
} from "@fusion/shared";
import { DocumentStore } from "../documents/store.js";
import { isRolePrivileged, resolveOwnership } from "../documents/ownership.js";
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

/**
 * One pre-normalized row of the cross-pack search index consumed by
 * {@link CompendiumService.searchAllPacks}. Built once, cached for the
 * service's lifetime, and filtered per VIEWER at query time — the row itself
 * is audience-agnostic on purpose (see `_getSearchAllRows`).
 */
interface SearchAllRow {
  packId: string;
  packLabel: string;
  documentType: string;
  entry: PackIndexEntry;
  /** `normalizeSearchText(entry.name)` — precomputed so a keystroke does not
   * re-normalize ~12k names (RNF-CPD-01). */
  nameNorm: string;
  /** `normalizeSearchText(entry.namePt)`, or null when untranslated. */
  namePtNorm: string | null;
}

/**
 * What `importToActor` gives its caller: the wire result (spec 43 §5.7) plus
 * the persisted destination actor, which the handler needs in order to
 * broadcast the `doc:update` and which has no business on the wire twice.
 * `null` when nothing was written.
 */
export interface ImportToActorOutcome extends CompendiumImportToActorResult {
  actor: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// CompendiumService
// ---------------------------------------------------------------------------

export class CompendiumService {
  private readonly packs = new Map<string, LoadedPack>();
  private readonly logger: Logger | null;

  /**
   * Cross-pack reverse index for {@link getI18nBySourceRef}: `"<packName>\0
   * <sourceId>" → { packId, docId }`. `null` = not yet built (built lazily on
   * first call, then cached for the service's lifetime — see
   * `_getSourceRefIndex`).
   */
  private _sourceRefIndex: Map<string, { packId: string; docId: string }> | null = null;

  /**
   * Cross-pack search index for {@link searchAllPacks}: every entry of every
   * loaded pack, with its origin and its normalized names precomputed. `null`
   * = not yet built (built lazily on the first aggregated search, then cached
   * for the service's lifetime — same shape as `_sourceRefIndex`).
   */
  private _searchAllRows: SearchAllRow[] | null = null;

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
  // Audience gate (REQ-CMP-004a/010a, REQ-CPD-070/071/074) — private on
  // purpose: the gate is reached only THROUGH a read, so no caller can ask
  // "does this hidden pack exist?" without also asking for its content.
  // ---------------------------------------------------------------------------

  /**
   * Resolve a pack for a viewer, or `null` when it does not exist FOR THAT
   * VIEWER. Every read path below funnels through this so an invisible pack
   * takes exactly the same code path — and produces exactly the same ack — as
   * a packId that was never published (REQ-CPD-071, REQ-CMP-010a).
   *
   * `null` therefore means "unknown OR hidden from this role" — the two are
   * deliberately the same answer (REQ-SEC-020: refusal must be
   * indistinguishable from non-existence). There is no public predicate that
   * separates them, and adding one would hand a caller the very distinction
   * this method exists to erase.
   *
   * The viewer's role comes FIRST here, as in every public read below
   * (`listPacks`, `getPackIndex`, `searchPack`, `getDocument`,
   * `getI18nBySourceRef`) — one argument order for the whole audience-aware
   * surface, so a new read path cannot silently swap role and packId.
   */
  private _packFor(packId: string, viewerRole: number): LoadedPack | null {
    const loaded = this.packs.get(packId);
    if (!loaded) return null;
    return this._isPackVisible(loaded, viewerRole) ? loaded : null;
  }

  /**
   * The ONE place the pack audience is evaluated (REQ-CPD-074: the decision
   * lives on the server, never only in the UI). A pack whose manifest declares
   * `audience: "gm"` exists only for roles satisfying `isRolePrivileged`
   * (documents/ownership.ts — the single role predicate, never duplicated).
   *
   * `manifest.audience` is ALWAYS resolved by `PackManifestSchema` (it defaults
   * to `"all"` on parse), so a pack.json without the field is visible to
   * everyone — REQ-CMP-004a: an old pack stays valid and stays public.
   */
  private _isPackVisible(loaded: LoadedPack, viewerRole: number): boolean {
    if (loaded.manifest.audience !== "gm") return true;
    return isRolePrivileged(viewerRole);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * List the pack manifests visible to `viewerRole`.
   * REQ-CMP-012: filter by systemId and/or documentType.
   * REQ-CMP-010a / REQ-CPD-071: a `gm` pack is not listed to a non-privileged
   * viewer — it is simply absent, as if it did not exist.
   */
  listPacks(
    viewerRole: number,
    filter?: { systemId?: string; documentType?: string },
  ): PackManifest[] {
    const packs: PackManifest[] = [];
    for (const loaded of this.packs.values()) {
      if (!this._isPackVisible(loaded, viewerRole)) continue;
      const { manifest } = loaded;
      if (filter?.systemId !== undefined && manifest.systemId !== filter.systemId) continue;
      if (filter?.documentType !== undefined && manifest.documentType !== filter.documentType)
        continue;
      packs.push(manifest);
    }
    return packs;
  }

  /**
   * Get the index for a pack, as seen by `viewerRole`.
   * Lazy-builds from documents.json or index.json on first call.
   * REQ-CMP-007, REQ-CMP-049; audience gate per REQ-CMP-010a / REQ-CPD-071.
   */
  getPackIndex(viewerRole: number, packId: string): PackIndex | null {
    const loaded = this._packFor(packId, viewerRole);
    if (!loaded) return null;
    return { packId, entries: this._ensureIndex(loaded) };
  }

  /**
   * Build-once/cache the enriched index of an ALREADY-RESOLVED pack. Callers
   * must have passed the audience gate themselves (`_packFor`) or be
   * cross-pack internals that apply the gate on the way out
   * (`_getSearchAllRows`) — this method deliberately takes a `LoadedPack`, not
   * a packId, so it cannot be reached with a viewer-supplied identifier.
   *
   * Build the base (EN) index, then enrich: (1) the compact per-entry
   * `index.actionCost` (r20-X2) derived from the full documents, then (2)
   * overlay pt-BR names when a translation overlay exists. Enrichment is
   * applied ONCE and cached in `_index`, so subsequent index/search calls
   * reuse the enriched entries.
   */
  private _ensureIndex(loaded: LoadedPack): PackIndexEntry[] {
    if (!loaded._index) {
      const base = this._buildIndex(loaded);
      const withCost = this._applyActionCostToIndex(loaded, base);
      loaded._index = this._applyI18nToIndex(loaded, withCost);
    }
    return loaded._index;
  }

  /**
   * Search/filter a pack's index, as seen by `viewerRole`.
   * REQ-CMP-013, REQ-CMP-014; audience gate per REQ-CMP-010a / REQ-CPD-071 —
   * a `gm` pack yields `null` (unknown pack) instead of entries.
   */
  searchPack(
    viewerRole: number,
    packId: string,
    query: CompendiumSearchPayload,
  ): PackIndexEntry[] | null {
    const packIndex = this.getPackIndex(viewerRole, packId);
    if (!packIndex) return null;
    return searchPackIndex(packIndex.entries, query);
  }

  /**
   * Search EVERY pack visible to `viewerRole` in one call, answering with a
   * result that is already grouped, already counted and already truncated.
   * REQ-CPD-030..032 (spec 43), REQ-CMP-013a/013b (spec 16), RNF-CPD-01.
   *
   * WHY THE SERVER OWNS THIS (DEC-CPD-02): the alternative — the client
   * downloading every pack index and running N searches — is exactly what
   * DEC-CMP-02 (lazy index) forbids: the committed pf2e acervo is ~4.2k
   * documents across 14 packs today and ~12k when the full subset lands, and
   * REQ-CMP-049 already budgets 1.5 s just to index ONE big pack. So the index
   * is built here, once, lazily (`_getSearchAllRows`), and cached for the
   * service's lifetime; a keystroke then costs one pass over pre-normalized
   * strings, which is what makes RNF-CPD-01's 300 ms budget reachable.
   *
   * AUDIENCE (REQ-CPD-071, REQ-CMP-010a): `viewerRole` comes from the
   * authenticated socket, never from the payload, and is applied by the single
   * `_isPackVisible` predicate — a `gm` pack contributes NOTHING here: no
   * entry, no group, no count, and it is not even part of `packsSearched`. A
   * player searching "goblin" therefore cannot tell, from any field of this
   * result, that a bestiary exists.
   *
   * GROUPING (REQ-CPD-031): by `PackManifest.documentType`, because that is
   * the axis the spec names ("agrupado por tipo de documento"), with every row
   * carrying `packId`/`packLabel` so it names its own source, and a per-group
   * `packs` tally so a truncated group can offer opening a specific pack in
   * its own scope (REQ-CPD-032).
   *
   * ORDER: truncation forces a choice the spec does not make, so entries are
   * ranked by how well they matched (exact name → prefix → substring) and then
   * alphabetically — dropping the tail of an alphabetical list would hide
   * "Fireball" behind "Blazing Fireball" for the query "fireball".
   */
  searchAllPacks(viewerRole: number, query: CompendiumSearchAllPayload): CompendiumSearchAllResult {
    const limitPerGroup = query.limitPerGroup ?? COMPENDIUM_SEARCH_ALL_LIMIT_PER_GROUP;
    const textNorm = normalizeSearchText((query.text ?? "").trim());

    // Audience first: the set of packs this viewer can see (REQ-CPD-071).
    const visiblePacks = new Set<string>();
    for (const [packId, loaded] of this.packs) {
      if (this._isPackVisible(loaded, viewerRole)) visiblePacks.add(packId);
    }

    interface Bucket {
      documentType: string;
      matches: Array<{ row: SearchAllRow; rank: number; sortKey: string }>;
      byPack: Map<string, CompendiumSearchAllPackTally>;
    }
    const buckets = new Map<string, Bucket>();
    let totalMatched = 0;

    for (const row of this._getSearchAllRows()) {
      if (!visiblePacks.has(row.packId)) continue;
      if (textNorm && !rowMatchesText(row, textNorm)) continue;
      if (query.filters && !matchesFilters(row.entry, query.filters)) continue;

      let bucket = buckets.get(row.documentType);
      if (!bucket) {
        bucket = { documentType: row.documentType, matches: [], byPack: new Map() };
        buckets.set(row.documentType, bucket);
      }
      bucket.matches.push({
        row,
        rank: matchRank(row, textNorm),
        sortKey: row.namePtNorm ?? row.nameNorm,
      });

      const tally = bucket.byPack.get(row.packId);
      if (tally) {
        tally.matched++;
      } else {
        bucket.byPack.set(row.packId, {
          packId: row.packId,
          label: row.packLabel,
          matched: 1,
        });
      }
      totalMatched++;
    }

    const groups: CompendiumSearchAllGroup[] = [];
    for (const bucket of buckets.values()) {
      bucket.matches.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
        return a.row.entry.uuid < b.row.entry.uuid ? -1 : 1;
      });

      const entries: CompendiumSearchAllEntry[] = bucket.matches
        .slice(0, limitPerGroup)
        .map(({ row }) => ({ ...row.entry, packId: row.packId, packLabel: row.packLabel }));

      const packs: CompendiumSearchAllPackTally[] = [...bucket.byPack.values()].sort((a, b) =>
        a.matched !== b.matched ? b.matched - a.matched : a.packId < b.packId ? -1 : 1,
      );

      groups.push({
        documentType: bucket.documentType,
        total: bucket.matches.length,
        entries,
        truncated: bucket.matches.length > entries.length,
        omitted: bucket.matches.length - entries.length,
        packs,
      });
    }

    groups.sort((a, b) =>
      a.total !== b.total ? b.total - a.total : a.documentType < b.documentType ? -1 : 1,
    );

    return { groups, totalMatched, limitPerGroup, packsSearched: visiblePacks.size };
  }

  /**
   * Get the full document for a Compendium UUID, as seen by `viewerRole`.
   * REQ-CMP-009, REQ-CMP-050.
   *
   * A uuid that names a `gm` pack resolves to `null` for a non-privileged
   * viewer — the SAME answer a made-up uuid gets, so knowing the uuid teaches
   * nothing about whether the document exists (REQ-CPD-071, REQ-SEC-020).
   */
  getDocument(viewerRole: number, uuid: string): Record<string, unknown> | null {
    const parsed = parsePackDocUuid(uuid);
    if (!parsed) return null;

    const loaded = this._packFor(parsed.packId, viewerRole);
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
   * Resolve the pt-BR i18n overlay entry for a document by its ORIGIN
   * identity — `flags.fusion.packName` + `flags.fusion.sourceId` — instead of
   * by Fusion pack UUID (issue #43).
   *
   * WHY THIS EXISTS: `importToWorld` deliberately deletes `uuid`/`i18n`/
   * `mechanics` from the world copy to keep it EN-pure (see the comment at
   * `delete worldDoc["i18n"]` below) — but it does NOT touch `flags.fusion`,
   * so `packName`/`sourceId` survive into the world document (confirmed: 79
   * of 98 embedded actor items in the argiburgo test world carry
   * `flags.fusion.sourceId`, while 0 carry `uuid`). A reader holding a world
   * document therefore cannot call `getDocument(uuid)` — it has no uuid — but
   * it CAN call this method with the origin reference it does have.
   *
   * WHY NOT re-derive the Fusion pack id from `packName` directly: a world
   * doc's `flags.fusion.packName` is the VENDOR pack key (e.g. "equipment"),
   * which is NOT the same string as the Fusion pack id/directory that ended
   * up holding the curated document (e.g. "pf2e.weapons-core") — curation
   * remaps one vendor pack into MULTIPLE Fusion packs (confirmed:
   * `pf2e.weapons-core` and `pf2e.equipment-core` both curate documents whose
   * `flags.fusion.packName === "equipment"`, with disjoint `sourceId`s). So
   * (packName, sourceId) does not name a Fusion pack by itself; resolving it
   * requires a cross-pack search — done here via a lazily-built reverse index
   * (`_getSourceRefIndex`) rather than by re-deriving the importer's
   * `deriveFusionId` hash (tools/importer-pf2e/src/transform.mjs): that
   * formula ALSO differs by system (sf2e namespaces it "sf2e:<packName>"
   * while `flags.fusion.packName` itself is stored unprefixed), so
   * reproducing it here would need the doc's systemId too, on top of
   * duplicating a formula that lives in a tool this package must not depend
   * on. The reverse index sidesteps all of that — it is built directly from
   * what `documents.json` already contains, at a measured cost of ~176ms to
   * scan all 14 committed pf2e packs (4236 docs) once, then cached for the
   * service's lifetime (same lazy-build-and-cache shape as `_buildIndex` and
   * `_getI18nPtBR`).
   *
   * Reuses `_getI18nPtBR`'s already staleness-gated Map: an overlay entry
   * whose `sourceHash` no longer matches the live EN doc is treated exactly
   * like "no translation" here too (falls through to `null` → EN fallback).
   *
   * AUDIENCE GATE (REQ-CMP-010a, REQ-CPD-071): this is a document read like
   * `getDocument`, so it obeys the same pack audience — a ref resolving into a
   * `gm` pack yields `null` for a non-privileged viewer, which is already this
   * method's normal "no translation" answer. Without this gate the overlay
   * would be a side door leaking creature names out of a hidden bestiary.
   *
   * @returns the localized pt-BR fields, or `null` when no pack VISIBLE TO THE
   *   VIEWER has a doc matching that `(packName, sourceId)` pair, or the
   *   overlay entry for it is missing/stale.
   */
  getI18nBySourceRef(
    viewerRole: number,
    ref: { packName: string; sourceId: string },
  ): DocI18n | null {
    const index = this._getSourceRefIndex();
    const hit = index.get(buildSourceRefKey(ref.packName, ref.sourceId));
    if (!hit) return null;

    const loaded = this._packFor(hit.packId, viewerRole);
    if (!loaded) return null; // unknown, or hidden from this role — same answer

    return this._getI18nPtBR(loaded).get(hit.docId) ?? null;
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
        // Read as the importer's own role: privileged by the guard above, so a
        // `gm` pack is legitimately readable here (REQ-CPD-073).
        const doc = this.getDocument(options.role, uuid);
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
        // world derivation/persistence never reads them). This EN-pure
        // decision is DELIBERATE and must not be reverted (issue #43) — the
        // world document is a snapshot, not a live view of the pack overlay.
        //
        // This does NOT make the translation unreachable: `flags.fusion`
        // (packName + sourceId) is preserved below and is exactly what a
        // reader needs to fetch the pt-BR overlay again at READ time, via
        // `getI18nBySourceRef({ packName, sourceId })` (see its docstring
        // above `getDocument`). `uuid` is stripped and cannot be used for
        // that lookup — `getDocument(uuid)`'s overlay attachment only ever
        // applied to the PACK-side copy, never the world copy.
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

  /**
   * Bring pack document(s) into ONE actor's sheet (spec 43 §5.7, DEC-CPD-05).
   * REQ-CPD-061, REQ-CPD-073.
   *
   * THE PREDICATE IS THE DESTINATION, NOT THE CALLER. `importToWorld` above
   * asks `isRolePrivileged` because the world is the Game Master's; a sheet is
   * its owner's, so what is checked here is `OWNER` of the DESTINATION actor
   * (REQ-DOC-027/028) through the same `resolveOwnership` every write path
   * uses — never a second predicate of this module's own. A Game Master passes
   * that check because `resolveOwnership` already answers OWNER for a
   * privileged role, so there is no role branch here at all.
   *
   * THE AUDIENCE GATE STILL APPLIES. The pack document is read with the
   * CALLER's role (`getDocument(role, uuid)`), so a player asking for a uuid
   * inside a `gm` pack gets the very same "not found" a nonexistent uuid gets
   * (REQ-CPD-071) — bringing to one's own sheet is not a side door into the
   * bestiary.
   *
   * ONLY ITEMS. A sheet holds embedded Items; asking to embed an Actor or a
   * Scene fails per-uuid as a validation problem, not a permission one
   * (REQ-CPD-061, `isSheetImportableDocumentType`).
   *
   * TWICE IS TWICE (REQ-CPD-064): nothing here looks at what the actor already
   * carries. Each accepted uuid becomes a NEW embedded item with a fresh `_id`,
   * exactly like `importToWorld` clones a new world document each call.
   *
   * The write is ONE `store.update` of the parent actor at the end, mirroring
   * `handleEmbeddedCreate` in doc-handlers.ts: a partial batch never leaves
   * half the items persisted and half lost — either the whole surviving set is
   * written or nothing is (REQ-CPD-065's server-side half).
   *
   * @returns the destination id, the embedded ids created, and one entry per
   *   uuid that could not be brought (with the reason).
   * @throws {DocumentNotFoundError} when the destination actor does not exist.
   * @throws {PermissionDeniedError} when the caller is not OWNER of it.
   */
  importToActor(
    uuids: string[],
    options: {
      db: Db;
      actorId: string;
      userId: string;
      role: number;
      /** Same role as importToWorld's: derives `system.derived` after the write. */
      systemModule?: SystemModule;
      logger?: Logger;
    },
  ): ImportToActorOutcome {
    const store = new DocumentStore({ db: options.db });

    // Throws DocumentNotFoundError — the handler maps it to NOT_FOUND.
    const actor = store.get("actors", options.actorId);

    const rawOwnership = actor["ownership"];
    const ownership: Ownership =
      rawOwnership && typeof rawOwnership === "object" && !Array.isArray(rawOwnership)
        ? (rawOwnership as Ownership)
        : { default: OwnershipLevel.NONE };

    if (resolveOwnership(ownership, options.userId, options.role) < OwnershipLevel.OWNER) {
      throw new PermissionDeniedError(`No OWNER access to destination actor ${options.actorId}`);
    }

    const created: string[] = [];
    const failed: Array<{ uuid: string; reason: string }> = [];

    const rawItems = actor["items"];
    const existing = Array.isArray(rawItems) ? (rawItems as Record<string, unknown>[]) : [];
    const usedIds = new Set<string>();
    for (const item of existing) {
      const id = item["_id"];
      if (typeof id === "string") usedIds.add(id);
    }

    const addition: Record<string, unknown>[] = [];

    for (const uuid of uuids) {
      try {
        // Read as the CALLER's role: a `gm` pack answers "not found" here.
        const doc = this.getDocument(options.role, uuid);
        if (!doc) {
          failed.push({ uuid, reason: "Document not found in compendium" });
          continue;
        }

        const parsed = parsePackDocUuid(uuid);
        if (!packed(parsed)) {
          failed.push({ uuid, reason: "Invalid UUID" });
          continue;
        }

        const manifest = this.packs.get(parsed.packId)?.manifest;
        if (!manifest) {
          failed.push({ uuid, reason: "Pack not found" });
          continue;
        }

        if (!isSheetImportableDocumentType(manifest.documentType)) {
          failed.push({
            uuid,
            reason: `Document type ${manifest.documentType} cannot be brought to a sheet`,
          });
          continue;
        }

        let embeddedId = createDocumentId();
        while (usedIds.has(embeddedId)) embeddedId = createDocumentId();
        usedIds.add(embeddedId);

        const embedded: Record<string, unknown> = { ...doc, _id: embeddedId };
        // Same EN-pure strip importToWorld does: `uuid`/`i18n`/`mechanics` are
        // pack-side projections, and `flags.fusion.{packName,sourceId}` — kept —
        // is what points the copy back at its origin (issue #43, DEC-CPD-12).
        delete embedded["uuid"];
        delete embedded["i18n"];
        delete embedded["mechanics"];

        addition.push(embedded);
        created.push(embeddedId);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ uuid, reason });
        this.logger?.warn({ err, uuid }, "Failed to bring document to actor sheet");
      }
    }

    if (addition.length === 0) {
      return { actorId: options.actorId, created: [], failed, actor: null };
    }

    let updated = store.update(
      "actors",
      options.actorId,
      { items: [...existing, ...addition] },
      { userId: options.userId },
    );

    if (!updated) {
      return {
        actorId: options.actorId,
        created: [],
        failed: uuids.map((uuid) => ({ uuid, reason: "Failed to update destination actor" })),
        actor: null,
      };
    }

    // New items change AC/saves/spell slots — derive before the caller
    // broadcasts, same reason doc-handlers.ts recomputes after an embedded
    // create. A malformed document must not undo a write already committed.
    if (options.systemModule) {
      try {
        runActorDerivation(updated, options.systemModule);
        const rederived = store.update(
          "actors",
          options.actorId,
          { system: updated["system"] ?? {} },
          { userId: options.userId },
        );
        if (rederived) updated = rederived;
      } catch (deriveErr) {
        options.logger?.warn(
          { err: deriveErr, actorId: options.actorId },
          "Actor derivation failed after sheet import — keeping the items without derived",
        );
      }
    }

    return { actorId: options.actorId, created, failed, actor: updated };
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
  // Private helpers — source-ref resolution (issue #43)
  // ---------------------------------------------------------------------------

  /**
   * Lazily build (once) the cross-pack reverse index consumed by
   * {@link getI18nBySourceRef}: `"<packName>\0<sourceId>" → { packId, docId }`
   * for every document, across every CURRENTLY LOADED pack, that carries
   * `flags.fusion.{packName,sourceId}`. Cached on `_sourceRefIndex` for the
   * service's lifetime (packs are discovered once at startup and never
   * change underneath a running service).
   *
   * No existing per-pack Map is keyed this way: `_i18nPtBR`/`_mechanics` are
   * keyed by the Fusion doc `_id`, which is exactly what this index resolves
   * TO, not what callers have in hand (they have the vendor origin
   * reference). Building this requires one JSON.parse of each pack's
   * documents.json — the SAME file `_buildEnSourceHashes`/`_buildActionCosts`
   * already re-read per pack for their own lazy caches, just summed across
   * every loaded pack instead of one. Measured against the committed pf2e
   * packs (14 packs, 4236 docs total): ~176ms cold. Tolerant of a missing/
   * corrupt documents.json for any one pack — that pack is just skipped
   * (matches the discovery philosophy, REQ-CMP-006).
   */
  private _getSourceRefIndex(): Map<string, { packId: string; docId: string }> {
    if (this._sourceRefIndex) return this._sourceRefIndex;

    const index = new Map<string, { packId: string; docId: string }>();

    for (const [packId, loaded] of this.packs) {
      let docs: unknown[];
      try {
        docs = JSON.parse(readFileSync(loaded.docsPath, "utf8")) as unknown[];
      } catch (err) {
        this.logger?.warn(
          { err, packId },
          "Failed to read documents.json while building the source-ref index",
        );
        continue;
      }

      for (const raw of docs) {
        if (typeof raw !== "object" || raw === null) continue;
        const doc = raw as Record<string, unknown>;
        const docId = doc["_id"];
        if (typeof docId !== "string") continue;

        const flags = doc["flags"];
        if (typeof flags !== "object" || flags === null) continue;
        const fusion = (flags as Record<string, unknown>)["fusion"];
        if (typeof fusion !== "object" || fusion === null) continue;
        const packName = (fusion as Record<string, unknown>)["packName"];
        const sourceId = (fusion as Record<string, unknown>)["sourceId"];
        if (typeof packName !== "string" || typeof sourceId !== "string") continue;

        const key = buildSourceRefKey(packName, sourceId);
        const existing = index.get(key);
        if (existing !== undefined) {
          // Should never happen — REQ-CMP-041 states fusionId derivation is
          // collision-free cross-pack, and (packName, sourceId) is exactly
          // its input. Keep the FIRST match and log loudly so a real
          // regression is visible instead of silently picking a doc at
          // random.
          this.logger?.warn(
            { packName, sourceId, existing, duplicate: { packId, docId } },
            "Duplicate origin reference across packs while building source-ref index — keeping first match",
          );
          continue;
        }
        index.set(key, { packId, docId });
      }
    }

    this._sourceRefIndex = index;
    return index;
  }

  // ---------------------------------------------------------------------------
  // Private helpers — cross-pack search index (REQ-CPD-030, RNF-CPD-01)
  // ---------------------------------------------------------------------------

  /**
   * Lazily build (once) the flat cross-pack row list consumed by
   * {@link searchAllPacks}: every entry of every LOADED pack, carrying its
   * origin (`packId`/`packLabel`), its `documentType`, and both names already
   * normalized for accent/case-insensitive matching (REQ-CMP-013b). Cached on
   * `_searchAllRows` for the service's lifetime — packs are discovered once at
   * startup and never change underneath a running service, the same assumption
   * `_getSourceRefIndex` already makes.
   *
   * WHY IT IS AUDIENCE-AGNOSTIC: the rows cover every pack, and the audience is
   * applied by the CALLER on the way out (`searchAllPacks` intersects with
   * `_isPackVisible` before reading a single row). Keeping one shared index
   * instead of one per role means the expensive part is paid once for the whole
   * table — and the gate stays in the single place that already owns it
   * (`_isPackVisible`), never duplicated into a second per-role cache that
   * could drift.
   *
   * COST: reuses `_ensureIndex`, so it pays exactly the per-pack index build
   * that `compendium:index` would have paid anyway, plus one normalization per
   * name. Warming it is the slow call; every search after it is a pass over
   * strings already in memory.
   */
  private _getSearchAllRows(): SearchAllRow[] {
    if (this._searchAllRows) return this._searchAllRows;

    const rows: SearchAllRow[] = [];
    for (const [packId, loaded] of this.packs) {
      const { label, documentType } = loaded.manifest;
      for (const entry of this._ensureIndex(loaded)) {
        rows.push({
          packId,
          packLabel: label,
          documentType,
          entry,
          nameNorm: normalizeSearchText(entry.name),
          namePtNorm: entry.namePt !== undefined ? normalizeSearchText(entry.namePt) : null,
        });
      }
    }

    this._searchAllRows = rows;
    this.logger?.debug(
      { packs: this.packs.size, entries: rows.length },
      "Built cross-pack compendium search index",
    );
    return rows;
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
 * Does a cross-pack row match the (already normalized) query text? Matches
 * against BOTH names — EN and pt-BR — so typing either language finds the same
 * entry (REQ-CMP-013b, DEC-CPD-06). Mirrors `matchesTextSearch` from
 * @fusion/shared, but over the row's precomputed normalizations instead of
 * re-normalizing ~12k names on every keystroke (RNF-CPD-01).
 */
function rowMatchesText(row: SearchAllRow, textNorm: string): boolean {
  if (!textNorm) return true;
  if (row.nameNorm.includes(textNorm)) return true;
  return row.namePtNorm !== null && row.namePtNorm.includes(textNorm);
}

/**
 * How well a row matched, lowest = best: 0 = one of its names IS the query,
 * 1 = one of them starts with it, 2 = it appears somewhere inside (or there was
 * no query at all). Used only to order a group before truncation — see the
 * ORDER note on `searchAllPacks`.
 */
function matchRank(row: SearchAllRow, textNorm: string): number {
  if (!textNorm) return 2;
  if (row.nameNorm === textNorm || row.namePtNorm === textNorm) return 0;
  if (row.nameNorm.startsWith(textNorm)) return 1;
  if (row.namePtNorm !== null && row.namePtNorm.startsWith(textNorm)) return 1;
  return 2;
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
 * Separator between `packName` and `sourceId` in the source-ref reverse-index
 * key (see `CompendiumService._getSourceRefIndex`). A NUL (U+0000) can never
 * appear in either value (pack slugs / vendor `_id`s), so it cannot collide
 * with a packName/sourceId boundary — same rationale as `I18N_HASH_SEP`.
 */
const SOURCE_REF_SEP = "\u0000";

/**
 * Build the reverse-index key for a document's origin reference
 * (`flags.fusion.packName` + `flags.fusion.sourceId`).
 */
function buildSourceRefKey(packName: string, sourceId: string): string {
  return packName + SOURCE_REF_SEP + sourceId;
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
