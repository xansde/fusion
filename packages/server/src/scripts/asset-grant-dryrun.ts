/**
 * asset-grant-dryrun — what does the T025 asset gate take away from a real
 * table, BEFORE it is merged?
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 *
 * Today `GET /assets/*` authorises on a valid Bearer token and a role of PLAYER
 * or better, and nothing else: any authenticated player, with any HTTP client,
 * downloads any file in the world's `assets/` directory without naming a
 * document. T025 replaces that with a per-name grant the server signs only for
 * files it can see the user is entitled to.
 *
 * That is strictly a REMOVAL of access, so the only interesting question is
 * whether it removes something a real table is using. This script answers it as
 * a LIST, not as a verdict: for every non-privileged user of a world, it prints
 * the files that stop being reachable, each with the field path it did or did
 * not come from. A human then reads the list and says whether any of those
 * images appear at his table. That human gate is the deliverable — an "ok" from
 * this script would not be one.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS BELIEVABLE
 * ---------------------------------------------------------------------------
 *
 * The "after" set comes from `grantableAssetNames()` (assets/routes.ts) — the
 * function `POST /api/assets/grant` itself calls. This script does not hold a
 * second copy of the allowlist, the visibility rules, the field projection or
 * the name hygiene, because a dry-run that re-implements the gate measures the
 * re-implementation and keeps agreeing with itself while the route drifts.
 *
 * The "who sees what today" cross-check comes from `buildSnapshot()`
 * (net/handlers/sync-handlers.ts) — the same function the join handler calls —
 * for the same reason.
 *
 * The only thing this file computes on its own is the ARITHMETIC (set
 * difference) and the attribution label. Attribution is explicitly a second,
 * non-authoritative pass: a name that the real pipeline emitted but that
 * attribution cannot place is printed as `(unattributed)` rather than dropped,
 * because a disagreement between the two is a finding about the projection, not
 * a formatting problem.
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 *
 * The database is opened `readonly` and the assets directory is only listed.
 * Nothing here writes. Even so, run it against a `VACUUM INTO` copy rather than
 * a live world: a world the GM has open holds a `-wal`, and a copy is the only
 * way to be sure of what you measured.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *
 *   node packages/server/dist/scripts/asset-grant-dryrun.js \
 *     --db <copy-of-world.db> [--assets <dir>] [--json]
 *
 *   --db      required. Path to a COPY of a world's `world.db`.
 *   --assets  optional. Path to that world's `assets/` directory. Without it the
 *             "today" baseline falls back to the set of names referenced by the
 *             world's documents, which UNDERSTATES what the current route
 *             serves (it serves every file on disk, referenced or not).
 *   --json    emit the machine-readable report instead of the human one.
 */

import Database from "better-sqlite3";
import { readdirSync, statSync } from "node:fs";
import { join as joinPath } from "node:path";
import type { Namespace } from "socket.io";
import {
  GRANTABLE_TABLES,
  grantableAssetNames,
  contactKnowledgeSourceFromDb,
} from "../assets/routes.js";
import { ASSET_FIELD_PATHS, projectAssetFields } from "../assets/asset-fields.js";
import { canonicalizeAssetName } from "../assets/asset-name.js";
import { assetRefToStorageName, extractAssetRefs } from "../assets/reconcile.js";
import { DocumentStore } from "../documents/store.js";
import { isRolePrivileged } from "../documents/ownership.js";
import { buildSnapshot } from "../net/handlers/sync-handlers.js";
import type { SyncHandlerDeps } from "../net/handlers/sync-handlers.js";
import { SeqStore } from "../net/seq-store.js";
import { OpBuffer } from "../net/op-buffer.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  name: string;
  role: number;
}

/** One asset name a user can still mint a grant for, and where it came from. */
interface KeptName {
  name: string;
  /** `table/id` + field path, or `(unattributed)` — see the module doc. */
  origins: string[];
}

interface UserReport {
  user: UserRow;
  /** Names `grantableAssetNames` signs for this user, across every row. */
  kept: KeptName[];
  /**
   * Files on disk (or referenced names) this user loses.
   *
   * `undeclaredBy` is the alarm: a JSON path that carries this name in some
   * document while the projection does not declare that path. Non-empty means
   * the loss is a FORGOTTEN BEARER FIELD, not an unused file.
   */
  denied: Array<{ name: string; referencedBy: string[]; undeclaredBy: string[] }>;
  /** Documents the mint refuses outright, by table. */
  invisible: Array<{ table: string; id: string; label: string }>;
  /** Documents whose names failed hygiene — the mint 400s the whole document. */
  refused: Array<{ table: string; id: string; ref: string; refusal: string }>;
  /**
   * Documents `buildSnapshot` delivers to this user but whose asset names the
   * mint declines, and vice versa. A non-empty list on either side is the most
   * important thing this script can print.
   */
  snapshotDisagreement: Array<{ table: string; id: string; detail: string }>;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { db: string; assets: string | null; json: boolean } {
  let db: string | null = null;
  let assets: string | null = null;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") {
      db = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--assets") {
      assets = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--json") {
      json = true;
    }
  }

  if (db === null) {
    throw new Error("--db <path-to-copy-of-world.db> is required.");
  }
  return { db, assets, json };
}

// ---------------------------------------------------------------------------
// Baseline: what GET /assets/* serves today
// ---------------------------------------------------------------------------

/**
 * Every file the current route would hand to any authenticated player.
 *
 * That is literally the contents of the assets directory: today's gate consults
 * no document, so the served set is the directory listing, including files no
 * document mentions. Subdirectories are walked because a stored name may carry
 * one (`maps/segredo.jpg`), and `canonicalizeAssetName` is applied so a name
 * here is comparable byte-for-byte with a name the mint produced.
 */
function filesServedToday(assetsDir: string): Set<string> {
  const out = new Set<string>();

  const walk = (dir: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue; // the route refuses dotfiles
      const full = joinPath(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      const rel = prefix === "" ? entry : `${prefix}/${entry}`;
      if (isDir) walk(full, rel);
      else out.add(canonicalizeAssetName(rel));
    }
  };

  walk(assetsDir, "");
  return out;
}

// ---------------------------------------------------------------------------
// Attribution (labels only — never the authoritative set)
// ---------------------------------------------------------------------------

/**
 * Which declared field path of `doc` produced each asset name, for LABELLING.
 *
 * Runs the same projection/extraction one declared path at a time. It is a
 * second pass on purpose: the authoritative set is whatever
 * `grantableAssetNames` returned, and any name this pass fails to explain is
 * reported as `(unattributed)` instead of being quietly dropped.
 */
function attributeNames(table: string, doc: Record<string, unknown>): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  const paths = ASSET_FIELD_PATHS[table] ?? [];

  for (const path of paths) {
    // Project the whole document, then keep only the key this path lives under,
    // so the extraction still sees exactly the shape `projectAssetFields`
    // produces for it.
    const full = projectAssetFields(table, doc);
    const key = path.includes("[]") ? path.slice(0, path.indexOf("[]")) : path;
    const slice = key in full ? { [key]: full[key] } : {};

    for (const ref of extractAssetRefs(JSON.stringify(slice))) {
      const name = canonicalizeAssetName(assetRefToStorageName(ref));
      const existing = byName.get(name);
      if (existing === undefined) byName.set(name, [path]);
      else if (!existing.includes(path)) existing.push(path);
    }
  }

  return byName;
}

/**
 * Which JSON path of `doc` carries each asset name, according to the GENERIC
 * extractor — the one that reads the whole document and knows no field list.
 *
 * This exists to keep the denial list honest. `attributeNames` above can only
 * explain a name through a path the projection declares, so a file referenced
 * by a field NOBODY declared would be printed as "referenced by no document" —
 * i.e. the report would describe a forgotten bearer field as harmless junk,
 * which is the single most expensive way this script could be wrong. Measured:
 * the archived world `argiburgo` has exactly that shape, in `tiles[].texture`
 * on its ACTIVE scene.
 *
 * The walk records the real JSON path (`tiles[0].texture`), so the reader gets
 * the field to go look at rather than a table name.
 */
function rawAssetPaths(doc: Record<string, unknown>): Map<string, string[]> {
  const byName = new Map<string, string[]>();

  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      for (const ref of extractAssetRefs(node)) {
        const name = canonicalizeAssetName(assetRefToStorageName(ref));
        const existing = byName.get(name) ?? [];
        if (!existing.includes(path)) existing.push(path);
        byName.set(name, existing);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => {
        walk(child, `${path}[${String(i)}]`);
      });
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, path === "" ? key : `${path}.${key}`);
      }
    }
  };

  walk(doc, "");
  return byName;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row !== undefined;
}

/**
 * The document ids `buildSnapshot` delivers to this user today, keyed by table.
 *
 * Uses the production function, with the two dependencies it never touches
 * (`ns`, `getRecentChat`) left unset and `systemModule` omitted — derivation
 * only decorates `system.derived` and cannot add or remove a document, so
 * skipping it changes nothing about visibility while keeping this script free
 * of a system package.
 */
function snapshotDocIdsByTable(db: Database.Database, user: UserRow): Map<string, Set<string>> {
  const deps = {
    store: new DocumentStore({ db }),
    seqStore: new SeqStore(db),
    opBuffer: new OpBuffer(),
    // `buildSnapshot` never reads `ns`; it exists on the interface for the
    // handlers that broadcast. Nothing here emits.
    ns: undefined as unknown as Namespace,
    db,
  } satisfies SyncHandlerDeps;

  const snapshot = buildSnapshot(deps, user.id, user.role);
  const docTypeToTable: Record<string, string> = {
    Scene: "scenes",
    Actor: "actors",
    Item: "items",
    JournalEntry: "journal_entries",
    Macro: "macros",
    RollTable: "roll_tables",
    Playlist: "playlists",
    Folder: "folders",
    Combat: "combats",
  };

  const out = new Map<string, Set<string>>();
  for (const [docType, docs] of Object.entries(snapshot.documents)) {
    const table = docTypeToTable[docType];
    if (table === undefined) continue;
    const ids = new Set<string>();
    for (const doc of docs) {
      const id = (doc as Record<string, unknown>)["_id"];
      if (typeof id === "string") ids.add(id);
    }
    out.set(table, ids);
  }
  return out;
}

function run(
  dbPath: string,
  assetsDir: string | null,
): {
  users: UserRow[];
  reports: UserReport[];
  today: string[];
  todaySource: "disk" | "references";
  referencedNames: Map<string, string[]>;
} {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const users = db
    .prepare("SELECT id, name, role FROM users ORDER BY role DESC, name ASC")
    .all() as UserRow[];

  const tables = [...GRANTABLE_TABLES].filter((t) => tableExists(db, t)).sort();

  // Every (table, id) in the world, read once.
  const rows: Array<{ table: string; id: string; doc: Record<string, unknown> }> = [];
  for (const table of tables) {
    const raw = db.prepare(`SELECT id, data FROM ${table}`).all() as Array<{
      id: string;
      data: unknown;
    }>;
    for (const row of raw) {
      const text =
        typeof row.data === "string"
          ? row.data
          : Buffer.isBuffer(row.data)
            ? row.data.toString("utf8")
            : null;
      if (text === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      rows.push({ table, id: row.id, doc: parsed as Record<string, unknown> });
    }
  }

  // Names any document in the world references at all, ignoring visibility.
  // Used as the fallback baseline and to explain a denial ("this file is the
  // background of the off-air scene X").
  //
  // Built TWICE on purpose, from the two extractors that disagree by design:
  // `attributeNames` sees only declared bearer paths, `rawAssetPaths` sees the
  // whole document. A name the second finds and the first does not is a bearer
  // field missing from the projection, and it has to be shouted rather than
  // filed under "unreferenced".
  const referencedNames = new Map<string, string[]>();
  const undeclaredNames = new Map<string, string[]>();
  for (const { table, id, doc } of rows) {
    const declared = attributeNames(table, doc);
    for (const [name, paths] of declared) {
      const existing = referencedNames.get(name) ?? [];
      for (const path of paths) {
        const where = `${table}/${id}.${path}`;
        if (!existing.includes(where)) existing.push(where);
      }
      referencedNames.set(name, existing);
    }

    for (const [name, paths] of rawAssetPaths(doc)) {
      if (declared.has(name)) continue;
      const existing = undeclaredNames.get(name) ?? [];
      for (const path of paths) {
        const where = `${table}/${id}.${path}`;
        if (!existing.includes(where)) existing.push(where);
      }
      undeclaredNames.set(name, existing);
    }
  }

  const todaySet =
    assetsDir === null ? new Set(referencedNames.keys()) : filesServedToday(assetsDir);
  const todaySource: "disk" | "references" = assetsDir === null ? "references" : "disk";

  const reports: UserReport[] = [];
  for (const user of users) {
    if (isRolePrivileged(user.role)) continue;

    const kept = new Map<string, string[]>();
    const invisible: UserReport["invisible"] = [];
    const refused: UserReport["refused"] = [];
    const snapshotDisagreement: UserReport["snapshotDisagreement"] = [];

    const snapshotIds = snapshotDocIdsByTable(db, user);

    for (const { table, id, doc } of rows) {
      const outcome = grantableAssetNames(
        db,
        table,
        id,
        user.id,
        user.role,
        contactKnowledgeSourceFromDb(db),
      );
      const inSnapshot = snapshotIds.get(table)?.has(id) ?? null;

      if (outcome.status === "not_found") {
        const rawLabel = doc["name"];
        invisible.push({ table, id, label: typeof rawLabel === "string" ? rawLabel : "(unnamed)" });
        if (inSnapshot === true) {
          snapshotDisagreement.push({
            table,
            id,
            detail:
              "buildSnapshot DELIVERS this document to the user, but the mint refuses to sign anything for it",
          });
        }
        continue;
      }

      if (outcome.status === "unknown_table") continue;

      // A name that failed hygiene is skipped, not fatal to the document (the
      // whole-document refusal was a denial of service — see
      // `grantableAssetNames`). It is still reported here, because a real world
      // carrying one means a file that will stop loading.
      for (const bad of outcome.skipped) {
        refused.push({ table, id, ref: bad.ref, refusal: bad.refusal });
      }

      if (outcome.names.length > 0 && inSnapshot === false) {
        snapshotDisagreement.push({
          table,
          id,
          detail: `mint signs ${String(outcome.names.length)} name(s) for a document buildSnapshot does NOT deliver to this user`,
        });
      }

      const attribution = attributeNames(table, doc);
      for (const name of outcome.names) {
        const paths = attribution.get(name) ?? ["(unattributed)"];
        const origins = paths.map((p) => `${table}/${id}.${p}`);
        const existing = kept.get(name) ?? [];
        // One line per distinct field path. A scene with five tokens sharing a
        // texture is ONE origin, not five: the reader is deciding whether a
        // FILE still loads, and repeating the path buries the next name.
        for (const origin of origins) if (!existing.includes(origin)) existing.push(origin);
        kept.set(name, existing);
      }
    }

    const denied = [...todaySet]
      .filter((name) => !kept.has(name))
      .sort()
      .map((name) => ({
        name,
        referencedBy: referencedNames.get(name) ?? [],
        undeclaredBy: undeclaredNames.get(name) ?? [],
      }));

    reports.push({
      user,
      kept: [...kept.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, origins]) => ({ name, origins })),
      denied,
      invisible,
      refused,
      snapshotDisagreement,
    });
  }

  db.close();
  return { users, reports, today: [...todaySet].sort(), todaySource, referencedNames };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printHuman(
  dbPath: string,
  result: ReturnType<typeof run>,
  assetsDir: string | null,
): void {
  const { users, reports, today, todaySource, referencedNames } = result;

  console.log(`\n=== T025 asset-grant dry-run ===`);
  console.log(`db      : ${dbPath} (opened readonly)`);
  console.log(`assets  : ${assetsDir ?? "(not given — baseline falls back to referenced names)"}`);
  console.log(
    `baseline: ${String(today.length)} name(s) served today to every role >= PLAYER, from ${todaySource}`,
  );
  for (const name of today) {
    const refs = referencedNames.get(name);
    console.log(`  - ${name}${refs === undefined ? "   [referenced by NO document]" : ""}`);
  }

  console.log(`\nusers   : ${String(users.length)}`);
  for (const u of users) {
    console.log(
      `  - ${u.name} (${u.id}) role ${String(u.role)}${isRolePrivileged(u.role) ? "  [PRIVILEGED — unaffected, sees everything]" : ""}`,
    );
  }

  if (reports.length === 0) {
    console.log(`\nNo non-privileged user in this world. Nothing to decide.`);
    return;
  }

  for (const report of reports) {
    const { user } = report;
    console.log(`\n--- ${user.name} (role ${String(user.role)}) -------------------------------`);

    console.log(`KEEPS (${String(report.kept.length)}):`);
    if (report.kept.length === 0) console.log(`  (nothing)`);
    for (const k of report.kept) {
      console.log(`  + ${k.name}`);
      for (const origin of k.origins) console.log(`      via ${origin}`);
    }

    console.log(`LOSES (${String(report.denied.length)}):`);
    if (report.denied.length === 0) console.log(`  (nothing)`);
    for (const d of report.denied) {
      console.log(`  - ${d.name}`);
      for (const origin of d.referencedBy) console.log(`      referenced by ${origin}`);
      for (const origin of d.undeclaredBy) {
        console.log(`      !! referenced by ${origin} — a path the PROJECTION DOES NOT DECLARE`);
      }
      if (d.referencedBy.length === 0 && d.undeclaredBy.length === 0) {
        console.log(`      referenced by NO document in this world`);
      }
    }

    if (report.refused.length > 0) {
      console.log(`NAME HYGIENE REFUSALS (mint 400s the whole document):`);
      for (const r of report.refused) {
        console.log(`  ! ${r.table}/${r.id}: ${r.refusal} on ${r.ref}`);
      }
    }

    if (report.snapshotDisagreement.length > 0) {
      console.log(`SNAPSHOT DISAGREEMENT (read this before merging):`);
      for (const s of report.snapshotDisagreement) {
        console.log(`  ? ${s.table}/${s.id}: ${s.detail}`);
      }
    } else {
      console.log(`SNAPSHOT DISAGREEMENT: none`);
    }

    const invisibleByTable = new Map<string, number>();
    for (const inv of report.invisible) {
      invisibleByTable.set(inv.table, (invisibleByTable.get(inv.table) ?? 0) + 1);
    }
    const invisibleSummary =
      [...invisibleByTable.entries()].map(([t, n]) => `${t}=${String(n)}`).join(", ") || "none";
    console.log(`documents the mint refuses outright: ${invisibleSummary}`);
  }

  const anyLoss = reports.some((r) => r.denied.length > 0);
  const undeclared = reports.some((r) => r.denied.some((d) => d.undeclaredBy.length > 0));
  const anyDisagreement = reports.some((r) => r.snapshotDisagreement.length > 0);

  console.log(`\n=== verdict ===`);
  if (undeclared) {
    console.log(
      `A denied file is referenced by a path the projection does not declare (the "!!" lines).`,
    );
    console.log(`That is a FORGOTTEN BEARER FIELD, not an unused file. Settle it before merging.`);
  }
  if (anyDisagreement) {
    console.log(`The mint and buildSnapshot disagree about a document (see the "?" lines).`);
  }
  console.log(
    anyLoss
      ? `Some names stop being reachable. Read the LOSES list above and say, per name, whether that file appears at the table.`
      : `No name stops being reachable for any non-privileged user.`,
  );
}

// ---------------------------------------------------------------------------

function main(): void {
  const { db, assets, json } = parseArgs(process.argv.slice(2));
  const result = run(db, assets);
  if (json) {
    console.log(
      JSON.stringify(
        {
          db,
          assets,
          todaySource: result.todaySource,
          today: result.today,
          users: result.users,
          reports: result.reports,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(db, result, assets);
  }
}

main();
