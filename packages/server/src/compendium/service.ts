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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import {
  PackManifestSchema,
  PackIndexEntrySchema,
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

        this.packs.set(manifest.id, {
          manifest,
          _index: null,
          docsPath,
          indexPath: existsSync(indexPath) ? indexPath : null,
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
      loaded._index = this._buildIndex(loaded);
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
      return doc !== undefined ? (doc as Record<string, unknown>) : null;
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

    const store = new DocumentStore({ db: options.db, coreVersion: "0.1.0" });
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

        // Strip pack-only fields
        delete worldDoc["uuid"];

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
 * Resolution order:
 *   1. Explicit `packsDirOverride` (e.g. FUSION_PACKS_DIR config) — used verbatim.
 *   2. `<monorepoRoot>/systems/<systemId>/packs` discovered from this module's
 *      location via {@link findMonorepoRoot}.
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

  const here = dirname(fileURLToPath(import.meta.url));
  const root = findMonorepoRoot(here);
  if (root === null) return null;

  const packsDir = join(root, "systems", systemId, "packs");
  return existsSync(packsDir) ? packsDir : null;
}
