/**
 * DocumentStore — CRUD operations over the 12 primary document tables.
 *
 * Design:
 *   - Each operation runs inside a SQLite transaction (REQ-PER-017).
 *   - _id is generated server-side via nanoid16 when absent (REQ-DOC-001, 002).
 *   - _stats is written server-side; any _stats supplied in input is stripped (REQ-DOC-008, D9).
 *   - update uses deep-merge semantics (REQ-DOC-037); no-op updates return null (REQ-DOC-038).
 *   - Validation via Zod schemas registered in types.ts (REQ-DOC-014).
 *   - Embedded collections are stored as JSON within the parent data column (DEC-PER-02).
 *
 * Tables and their "extracted" columns (colunas extraídas) mirror migration 001:
 *   actors          → name, type, folder_id, sort
 *   items           → name, type, folder_id, sort
 *   scenes          → name, active, navigation, folder_id, sort
 *   journal_entries → name, folder_id, sort
 *   macros          → name, type, folder_id, sort
 *   roll_tables     → name, folder_id, sort
 *   playlists       → name, folder_id, sort
 *   chat_messages   → timestamp, author_id
 *   combats         → scene_id, active
 *   users           → name, role
 *   folders         → name, type, parent_id, sort
 *   settings        → (id = key, no extra columns)
 */

import type { Database as Db } from "better-sqlite3";
import {
  createDocumentId,
  isValidDocumentId,
  defaultStats,
  DOCUMENT_TABLES,
  FUSION_VERSION,
} from "@fusion/shared";
import type { DocumentTable, DocumentStats } from "@fusion/shared";
import { getDocumentSchema } from "./types.js";
import { deepMerge, computeDiff } from "./merge.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DocumentNotFoundError extends Error {
  constructor(table: DocumentTable, id: string) {
    super(`Document not found: ${table}/${id}`);
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentIdCollisionError extends Error {
  constructor(table: DocumentTable, id: string) {
    super(`Document id collision: ${table}/${id} already exists`);
    this.name = "DocumentIdCollisionError";
  }
}

export class DocumentValidationError extends Error {
  constructor(
    table: DocumentTable,
    public readonly issues: Array<{ path: (string | number)[]; message: string }>,
  ) {
    const summary = issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    super(`Validation failed for ${table}: ${summary}`);
    this.name = "DocumentValidationError";
  }
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export interface QueryOptions {
  /** Filter by folder id (matches folder_id extracted column). */
  folderId?: string | null;
  /** Filter by document type (matches type extracted column). */
  type?: string;
  /** Filter by name (SQL LIKE pattern, e.g. "%goblin%"). */
  nameLike?: string;
  /** Order results by this column. */
  orderBy?: "sort" | "name" | "updated_at";
  /** Maximum number of results. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Author context (for _stats)
// ---------------------------------------------------------------------------

export interface AuthorContext {
  userId: string | null;
  coreVersion?: string;
  systemId?: string | null;
  systemVersion?: string | null;
}

// ---------------------------------------------------------------------------
// Composed transactions
// ---------------------------------------------------------------------------

/**
 * Scoped write handle passed to `DocumentStore.transaction()`. `update`/
 * `delete` here write on the ALREADY-OPEN transaction, unlike the store's
 * public `update`/`delete`, which each open their own.
 */
export interface DocumentStoreTransaction {
  update(
    table: DocumentTable,
    id: string,
    patch: Record<string, unknown>,
    author?: AuthorContext,
  ): Record<string, unknown> | null;
  delete(table: DocumentTable, id: string): string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip _stats from input data.
 * Any _stats provided by the client is silently ignored (REQ-DOC-008, D9).
 */
function stripStats(data: Record<string, unknown>): Record<string, unknown> {
  const { _stats, ...rest } = data;
  void _stats; // intentionally unused
  return rest;
}

/**
 * Build _stats for a newly created document.
 */
function buildCreateStats(author: AuthorContext): DocumentStats {
  const stats = defaultStats(author.coreVersion ?? FUSION_VERSION);
  return {
    ...stats,
    createdBy: author.userId,
    lastModifiedBy: author.userId,
    systemId: author.systemId ?? null,
    systemVersion: author.systemVersion ?? null,
  };
}

/**
 * Build _stats for an updated document (preserve createdTime/createdBy).
 * Increments the monotonic `version` counter for STALE_WRITE detection.
 */
function buildUpdateStats(existing: DocumentStats, author: AuthorContext): DocumentStats {
  return {
    ...existing,
    modifiedTime: Date.now(),
    version: existing.version + 1,
    lastModifiedBy: author.userId,
    systemId: author.systemId ?? existing.systemId,
    systemVersion: author.systemVersion ?? existing.systemVersion,
  };
}

/**
 * Validate a document against its registered Zod schema.
 * Throws DocumentValidationError on failure.
 */
function validateDocument(
  table: DocumentTable,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const schema = getDocumentSchema(table);
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DocumentValidationError(
      table,
      result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  return result.data as Record<string, unknown>;
}

/**
 * Extract the "indexed" columns from a document for the given table.
 * These are written to dedicated columns alongside the JSON data blob.
 */
function extractColumns(
  table: DocumentTable,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const cols: Record<string, unknown> = {};

  switch (table) {
    case "actors":
    case "items":
      cols["name"] = doc["name"] ?? "";
      cols["type"] = doc["type"] ?? "base";
      cols["folder_id"] = doc["folder"] ?? null;
      cols["sort"] = doc["sort"] ?? 0;
      break;

    case "scenes":
      cols["name"] = doc["name"] ?? "";
      // No `active` column since migration 008: the active scene lives in
      // settings['_meta:activeScene'], and the field inside the document is a
      // mirror the world:activeScene handler maintains (T010).
      cols["navigation"] = doc["navigation"] !== false ? 1 : 0;
      cols["folder_id"] = doc["folder"] ?? null;
      cols["sort"] = doc["sort"] ?? 0;
      break;

    case "journal_entries":
    case "roll_tables":
    case "playlists":
      cols["name"] = doc["name"] ?? "";
      cols["folder_id"] = doc["folder"] ?? null;
      cols["sort"] = doc["sort"] ?? 0;
      break;

    case "macros":
      cols["name"] = doc["name"] ?? "";
      cols["type"] = doc["type"] ?? "script";
      cols["folder_id"] = doc["folder"] ?? null;
      cols["sort"] = doc["sort"] ?? 0;
      break;

    case "chat_messages":
      cols["timestamp"] = doc["timestamp"] ?? Date.now();
      cols["author_id"] = doc["author"] ?? "";
      break;

    case "combats":
      cols["scene_id"] = doc["sceneId"] ?? null;
      cols["active"] = doc["active"] ? 1 : 0;
      break;

    case "users":
      cols["name"] = doc["name"] ?? "";
      cols["role"] = doc["role"] ?? 1;
      break;

    case "folders":
      cols["name"] = doc["name"] ?? "";
      cols["type"] = doc["type"] ?? "";
      cols["parent_id"] = doc["parentId"] ?? null;
      cols["sort"] = doc["sort"] ?? 0;
      break;

    case "settings":
      // settings uses id = key; no extra extracted columns
      break;

    default: {
      // Exhaustiveness check
      const _never: never = table;
      void _never;
      break;
    }
  }

  return cols;
}

/**
 * Build an INSERT SQL statement and bind params for the given table.
 */
function buildInsertSql(
  table: DocumentTable,
  id: string,
  dataJson: string,
  cols: Record<string, unknown>,
  now: number,
): { sql: string; params: unknown[] } {
  const colNames = ["id", "data", ...Object.keys(cols), "created_at", "updated_at"];
  const placeholders = colNames.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${colNames.join(", ")}) VALUES (${placeholders})`;
  const params = [id, dataJson, ...Object.values(cols), now, now];
  return { sql, params };
}

/**
 * Build an UPDATE SQL statement for the given table.
 */
function buildUpdateSql(
  table: DocumentTable,
  id: string,
  dataJson: string,
  cols: Record<string, unknown>,
  now: number,
): { sql: string; params: unknown[] } {
  const setClauses = ["data = ?", ...Object.keys(cols).map((c) => `${c} = ?`), "updated_at = ?"];
  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = ?`;
  const params = [dataJson, ...Object.values(cols), now, id];
  return { sql, params };
}

// ---------------------------------------------------------------------------
// DocumentStore
// ---------------------------------------------------------------------------

export interface DocumentStoreOptions {
  /** A raw better-sqlite3 Database instance (already open with PRAGMAs applied). */
  db: Db;
  /** Default author context for _stats when not provided per-operation. */
  defaultAuthor?: AuthorContext;
  /** Engine version to embed in _stats. */
  coreVersion?: string;
}

/**
 * DocumentStore provides typed CRUD over the 12 primary document tables.
 *
 * All writes run inside transactions. _stats is always written by the store,
 * never accepted from input data (REQ-DOC-008, D9).
 */
export class DocumentStore {
  private readonly db: Db;
  private readonly coreVersion: string;
  private readonly defaultAuthor: AuthorContext;

  constructor(options: DocumentStoreOptions) {
    this.db = options.db;
    this.coreVersion = options.coreVersion ?? FUSION_VERSION;
    this.defaultAuthor = options.defaultAuthor ?? { userId: null };
  }

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------

  /**
   * Create a new document.
   *
   * - If data._id is absent, a nanoid16 is generated (REQ-DOC-001).
   * - If data._id is present, it must be valid and unique (REQ-DOC-002).
   * - _stats is set by the server (REQ-DOC-008, D9).
   * - data is validated via the registered Zod schema (REQ-DOC-014).
   *
   * Returns the full validated + persisted document.
   */
  create(
    table: DocumentTable,
    input: Record<string, unknown>,
    author?: AuthorContext,
  ): Record<string, unknown> {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    const auth = author ?? this.defaultAuthor;

    // The id-collision check, validation and insert all run inside a single
    // IMMEDIATE transaction (T012): checking-then-writing outside a
    // transaction is a TOCTOU race under concurrent writers (reproduced with
    // two better-sqlite3 connections against the same world.db in WAL mode).
    // IMMEDIATE takes the write lock up front instead of on first write
    // (better-sqlite3's default is DEFERRED), so a second writer blocks and
    // retries (busy_timeout) instead of racing past the check.
    //
    // NOTE: .immediate() only takes effect when no transaction is already
    // open on this connection — better-sqlite3 falls back to a SAVEPOINT and
    // silently ignores the requested mode otherwise. No store method is
    // currently called from inside another transaction; keep it that way.
    return this.db.transaction(() => this._createInTxn(table, input, auth)).immediate();
  }

  // --------------------------------------------------------------------------
  // GET
  // --------------------------------------------------------------------------

  /**
   * Retrieve a single document by id.
   * Throws DocumentNotFoundError when not found.
   */
  get(table: DocumentTable, id: string): Record<string, unknown> {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;

    if (!row) throw new DocumentNotFoundError(table, id);
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  /**
   * Retrieve all documents from a table (optionally filtered).
   * REQ-PER-023.
   */
  getAll(table: DocumentTable, query?: QueryOptions): Record<string, unknown>[] {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    return this._query(table, query);
  }

  /**
   * Query documents with filters.
   * REQ-PER-023: filter by folder_id, type, name (LIKE).
   */
  query(table: DocumentTable, options: QueryOptions): Record<string, unknown>[] {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    return this._query(table, options);
  }

  private _query(table: DocumentTable, options?: QueryOptions): Record<string, unknown>[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.folderId !== undefined) {
      if (options.folderId === null) {
        conditions.push("folder_id IS NULL");
      } else {
        conditions.push("folder_id = ?");
        params.push(options.folderId);
      }
    }

    if (options?.type !== undefined) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    if (options?.nameLike !== undefined) {
      conditions.push("name LIKE ?");
      params.push(options.nameLike);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderCol = options?.orderBy ?? "sort";
    // Validate orderBy to prevent injection
    const safeOrder = ["sort", "name", "updated_at"].includes(orderCol) ? orderCol : "sort";

    // Not all tables have all columns — use conditional ORDER BY
    const hasOrderCol = this._tableHasColumn(table, safeOrder);
    const orderClause = hasOrderCol ? `ORDER BY ${safeOrder}` : "";

    // LIMIT is bound as a parameter (T014) rather than interpolated into the
    // SQL string — SQLite accepts a bound parameter in LIMIT the same as
    // anywhere else, so there is no reason to format it by hand.
    const limitClause = options?.limit != null ? "LIMIT ?" : "";
    const sql = `SELECT data FROM ${table} ${where} ${orderClause} ${limitClause}`.trim();
    const allParams = options?.limit != null ? [...params, options.limit] : params;

    const rows = this.db.prepare(sql).all(...allParams) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Record<string, unknown>);
  }

  /** PRAGMA table_info(<table>) results, cached per table on first use (T015). */
  private readonly columnCache = new Map<string, Set<string>>();

  /**
   * Check whether a table has a given column.
   *
   * Derived from PRAGMA table_info instead of a hand-maintained list (T015):
   * a migration that adds or drops a column used to also need a matching
   * edit here, and the two silently drifted apart (confirmed against a
   * migrated database — the `users` table gained password_hash/color/avatar/
   * active/preferences across migrations 002/006, none of which were ever
   * added to the old list). Cached per table since the connection lives for
   * the whole process and the schema does not change underneath it after
   * boot. A table PRAGMA finds nothing for (e.g. a typo) simply yields an
   * empty set rather than throwing.
   */
  private _tableHasColumn(table: DocumentTable, col: string): boolean {
    let cols = this.columnCache.get(table);
    if (!cols) {
      const rows = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
      cols = new Set(rows.map((r) => r.name));
      this.columnCache.set(table, cols);
    }
    return cols.has(col);
  }

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------

  /**
   * Apply a partial patch to an existing document.
   *
   * Merge semantics (REQ-DOC-037):
   *   - Plain objects: deep merge
   *   - Arrays: full replacement
   *   - null values in nested objects: key deletion
   *
   * _stats in the patch is ignored (REQ-DOC-008, D9).
   * No-op patches (no real change) return null (REQ-DOC-038).
   *
   * Returns the updated full document, or null if no change was detected.
   */
  update(
    table: DocumentTable,
    id: string,
    patch: Record<string, unknown>,
    author?: AuthorContext,
  ): Record<string, unknown> | null {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    const auth = author ?? this.defaultAuthor;

    // Load, merge, diff and write all run inside a single IMMEDIATE
    // transaction (T012) — see create()'s comment for why. Reading `existing`
    // outside the transaction (the previous shape) let a concurrent writer's
    // change land between the read and the write and get silently overwritten
    // (lost update) — reproduced with two connections against the same
    // world.db.
    return this.db.transaction(() => this._updateInTxn(table, id, patch, auth)).immediate();
  }

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  /**
   * Delete a document by id.
   * Throws DocumentNotFoundError when not found.
   *
   * Returns the id of the deleted document.
   */
  delete(table: DocumentTable, id: string): string {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    // Existence check and delete run inside a single IMMEDIATE transaction
    // (T012) — see create()'s comment for why.
    return this.db
      .transaction(() => {
        const exists = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
        if (!exists) throw new DocumentNotFoundError(table, id);
        this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return id;
      })
      .immediate();
  }

  // --------------------------------------------------------------------------
  // COMPOSED transactions
  // --------------------------------------------------------------------------

  /**
   * Run a sequence of writes — across one or several tables — inside a
   * single IMMEDIATE transaction, for composed operations whose steps must
   * commit or roll back together. `folder:delete` is the motivating case
   * (REQ-NPC-022): subfolders lift, documents release, and only then does the
   * folder row go — three writes that used to run as three separate
   * transactions, so a `DocumentValidationError` on the second step (e.g. a
   * legacy row a prior pack/migration wrote that no longer matches the
   * current schema) left the first step's writes committed with no broadcast
   * to tell any client — server and clients diverging in silence until the
   * next resync.
   *
   * `fn`'s handle writes on THIS already-open transaction (unlike the public
   * `update`/`delete`, which each open their own — see the NOTE on
   * `create()` about why no store method used to be called from inside
   * another transaction; reads such as `get`/`getAll`/`query` remain safe to
   * call from inside `fn` since they never open a transaction of their own).
   * Any throw inside `fn` — including `DocumentValidationError` and
   * `DocumentNotFoundError` — rolls back every write made so far in this
   * call, and propagates to the caller.
   */
  transaction<T>(fn: (txn: DocumentStoreTransaction) => T): T {
    const txn: DocumentStoreTransaction = {
      update: (table, id, patch, author) =>
        this._updateInTxn(table, id, patch, author ?? this.defaultAuthor),
      delete: (table, id) => {
        if (!DOCUMENT_TABLES.has(table)) {
          throw new Error(`Unknown document table: "${table}"`);
        }
        const exists = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
        if (!exists) throw new DocumentNotFoundError(table, id);
        this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return id;
      },
    };
    return this.db.transaction(() => fn(txn)).immediate();
  }

  // --------------------------------------------------------------------------
  // BATCH operations
  // --------------------------------------------------------------------------

  /**
   * Create multiple documents in a single transaction.
   * On any failure, the entire batch is rolled back (REQ-PER-020).
   */
  createBatch(
    table: DocumentTable,
    inputs: Record<string, unknown>[],
    author?: AuthorContext,
  ): Record<string, unknown>[] {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    const auth = author ?? this.defaultAuthor;
    const results: Record<string, unknown>[] = [];

    // IMMEDIATE (T012): a DEFERRED transaction that reads-then-writes each
    // item under concurrency can hit SQLITE_BUSY_SNAPSHOT, which busy_timeout
    // does NOT retry — the whole batch fails instantly instead of waiting for
    // the lock (reproduced with two connections against the same world.db).
    this.db
      .transaction(() => {
        for (const input of inputs) {
          const result = this._createInTxn(table, input, auth);
          results.push(result);
        }
      })
      .immediate();

    return results;
  }

  /**
   * Update multiple documents in a single transaction.
   * Each update is a patch; all are rolled back on any failure (REQ-PER-020).
   */
  updateBatch(
    table: DocumentTable,
    patches: Array<{ _id: string } & Record<string, unknown>>,
    author?: AuthorContext,
  ): Array<Record<string, unknown> | null> {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    const auth = author ?? this.defaultAuthor;
    const results: Array<Record<string, unknown> | null> = [];

    // IMMEDIATE (T012) — see createBatch's comment for why.
    this.db
      .transaction(() => {
        for (const patch of patches) {
          const { _id, ...rest } = patch;
          const result = this._updateInTxn(table, _id, rest, auth);
          results.push(result);
        }
      })
      .immediate();

    return results;
  }

  /**
   * Delete multiple documents in a single transaction.
   * All deletes are rolled back on any failure (REQ-PER-022).
   */
  deleteBatch(table: DocumentTable, ids: string[]): string[] {
    if (!DOCUMENT_TABLES.has(table)) {
      throw new Error(`Unknown document table: "${table}"`);
    }

    // IMMEDIATE (T012) — see createBatch's comment for why.
    this.db
      .transaction(() => {
        for (const id of ids) {
          const exists = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
          if (!exists) throw new DocumentNotFoundError(table, id);
          this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        }
      })
      .immediate();

    return ids;
  }

  // --------------------------------------------------------------------------
  // Internal helpers for use within transactions
  // --------------------------------------------------------------------------

  /** Create a document within an already-open transaction. */
  private _createInTxn(
    table: DocumentTable,
    input: Record<string, unknown>,
    auth: AuthorContext,
  ): Record<string, unknown> {
    const cleaned = stripStats(input);

    let id: string;
    if (typeof cleaned["_id"] === "string" && cleaned["_id"].length > 0) {
      if (!isValidDocumentId(cleaned["_id"])) {
        throw new DocumentValidationError(table, [
          { path: ["_id"], message: "must be exactly 16 chars from [A-Za-z0-9]" },
        ]);
      }
      id = cleaned["_id"];
    } else {
      id = createDocumentId();
      cleaned["_id"] = id;
    }

    cleaned["_stats"] = buildCreateStats(auth);
    const validated = validateDocument(table, cleaned);

    const existing = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
    if (existing) throw new DocumentIdCollisionError(table, id);

    const cols = extractColumns(table, validated);
    const now = Date.now();
    const dataJson = JSON.stringify(validated);
    const { sql, params } = buildInsertSql(table, id, dataJson, cols, now);
    this.db.prepare(sql).run(...params);

    return validated;
  }

  /** Update a document within an already-open transaction. */
  private _updateInTxn(
    table: DocumentTable,
    id: string,
    patch: Record<string, unknown>,
    auth: AuthorContext,
  ): Record<string, unknown> | null {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;

    if (!row) throw new DocumentNotFoundError(table, id);

    const existing = JSON.parse(row.data) as Record<string, unknown>;
    const { _stats: _is, _id: _ii, ...cleanPatch } = patch;
    void _is;
    void _ii;

    const merged = deepMerge(existing, cleanPatch);
    const existingStats = existing["_stats"] as DocumentStats;
    merged["_id"] = id;
    merged["_stats"] = buildUpdateStats(existingStats, auth);

    const { _stats: _s1, _id: _i1, ...existingData } = existing;
    const { _stats: _s2, _id: _i2, ...mergedData } = merged;
    void _s1;
    void _i1;
    void _s2;
    void _i2;

    const diff = computeDiff(existingData, mergedData);
    if (diff === null) return null;

    const validated = validateDocument(table, merged);
    const cols = extractColumns(table, validated);
    const now = Date.now();
    const dataJson = JSON.stringify(validated);
    const { sql, params } = buildUpdateSql(table, id, dataJson, cols, now);
    this.db.prepare(sql).run(...params);

    return validated;
  }
}
