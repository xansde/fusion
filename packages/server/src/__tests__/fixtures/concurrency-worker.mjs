/**
 * Concurrency-test worker (papel A) for documents-concurrency.test.ts.
 *
 * A separate OS PROCESS is required to create genuine SQLite lock contention:
 * better-sqlite3 calls are synchronous and block the whole JS thread, so a
 * SECOND connection contending for the same lock from *inside the same
 * process* would starve the first connection's ability to ever release it
 * (its release also runs JS on that same blocked thread). Two real processes
 * sidestep that entirely — this script runs standalone via `node`, imports
 * the ALREADY-BUILT dist (no ts-node/tsx in this package), opens its own
 * connection to the given world.db, holds a real BEGIN IMMEDIATE transaction
 * for a while, then performs one write and commits.
 *
 * Protocol (stdin/stdout not used — this runs under child_process.fork, so
 * IPC is available via process.send/process.on("message")):
 *   argv[2]: JSON-encoded WorkerConfig (see documents-concurrency.test.ts)
 *   sends {type: "txn-started"} once BEGIN IMMEDIATE has returned (lock held)
 *   sends {type: "done"} right before a clean exit(0)
 *   sends {type: "error", message} and exit(1) on failure
 */
import { openDatabase } from "../../../dist/db/connection.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = JSON.parse(process.argv[2]);
  const { dbPath, table, docId, action, holdMs, field, value, insertDoc } = config;

  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  const db = fusionDb.raw;

  // Raw BEGIN IMMEDIATE (not the FusionDatabase.transaction() helper, which
  // requires a single synchronous callback): we need the transaction to stay
  // open across a real async sleep, so BEGIN/COMMIT are issued by hand.
  db.exec("BEGIN IMMEDIATE");
  process.send?.({ type: "txn-started" });

  await sleep(holdMs);

  const now = Date.now();
  if (action === "update") {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(docId);
    const doc = JSON.parse(row.data);
    doc[field] = value;
    db.prepare(`UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(doc),
      now,
      docId,
    );
  } else if (action === "insert") {
    // Matches migration 001's actors table shape exactly (id, data, name,
    // type, folder_id, sort, created_at, updated_at) — this worker is only
    // ever pointed at the "actors" table by the test.
    db.prepare(
      `INSERT INTO actors (id, data, name, type, folder_id, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      docId,
      JSON.stringify(insertDoc),
      insertDoc.name ?? "",
      insertDoc.type ?? "base",
      null,
      0,
      now,
      now,
    );
  } else if (action === "delete") {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(docId);
  } else {
    throw new Error(`unknown action: ${String(action)}`);
  }

  db.exec("COMMIT");
  process.send?.({ type: "done" });
  process.exit(0);
}

main().catch((err) => {
  process.send?.({ type: "error", message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
