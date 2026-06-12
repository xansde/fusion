/**
 * SeqStore — monotonic sequence counter per world, persisted in world.db.
 *
 * The sequence number is stored in the `settings` table under the key
 * `_meta:worldSeq`. It survives server restarts (REQ-NET-012).
 *
 * Thread-safety: SQLite is serialized in better-sqlite3 by default.
 * All reads/writes are synchronous, so no concurrent mutation is possible.
 */

import type { Database as Db } from "better-sqlite3";

const SEQ_KEY = "_meta:worldSeq";

export class SeqStore {
  private current: number;

  constructor(private readonly db: Db) {
    this.current = this._loadFromDb();
  }

  /**
   * Atomically increment and return the next sequence number.
   * The new value is immediately persisted to the database.
   */
  next(): number {
    this.current += 1;
    this._persist(this.current);
    return this.current;
  }

  /** Return the current (last used) sequence number without incrementing. */
  peek(): number {
    return this.current;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private _loadFromDb(): number {
    const row = this.db.prepare(`SELECT data FROM settings WHERE id = ?`).get(SEQ_KEY) as
      | { data: string }
      | undefined;

    if (!row) return 0;

    try {
      const parsed = JSON.parse(row.data) as { seq?: unknown };
      return typeof parsed.seq === "number" ? parsed.seq : 0;
    } catch {
      return 0;
    }
  }

  private _persist(seq: number): void {
    const now = Date.now();
    const data = JSON.stringify({ seq });

    // Upsert: INSERT OR REPLACE works on `id` primary key
    this.db
      .prepare(
        `INSERT OR REPLACE INTO settings (id, data, created_at, updated_at)
         VALUES (?, ?, coalesce((SELECT created_at FROM settings WHERE id = ?), ?), ?)`,
      )
      .run(SEQ_KEY, data, SEQ_KEY, now, now);
  }
}
