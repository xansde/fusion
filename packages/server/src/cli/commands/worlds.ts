/**
 * CLI commands: fusion world list | create | backup
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { WorldListArgs, WorldCreateArgs, WorldBackupArgs } from "../args.js";
import { WorldManager } from "../../worlds/index.js";
import { SystemRegistry } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDataDir(dataDirArg: string | undefined): string {
  return dataDirArg ?? process.env["FUSION_DATA_DIR"] ?? join(homedir(), ".fusion");
}

/**
 * Simple table renderer.
 * Computes column widths from headers + rows, then prints padded rows.
 */
function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => {
      const cell = row[i] ?? "";
      return Math.max(max, cell.length);
    }, 0);
    return Math.max(h.length, maxRow);
  });

  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");

  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(colWidths[i] ?? 0))
      .join("  ")
      .trimEnd();

  process.stdout.write(formatRow(headers) + "\n");
  process.stdout.write(separator + "\n");
  for (const row of rows) {
    process.stdout.write(formatRow(row) + "\n");
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function runWorldList(args: WorldListArgs): void {
  const dataDir = resolveDataDir(args.dataDir);
  const manager = new WorldManager({ dataDir });

  let worlds;
  try {
    worlds = manager.list();
  } catch (err) {
    process.stderr.write(`fusion world list: error reading worlds: ${String(err)}\n`);
    process.exit(1);
  }

  if (worlds.length === 0) {
    process.stdout.write("No worlds found.\n");
    process.stdout.write(`Data directory: ${dataDir}\n`);
    return;
  }

  const headers = ["SLUG", "TITLE", "SYSTEM", "SCHEMA"];
  const rows = worlds.map((w) => [w.id, w.title, w.system, String(w.schemaVersion)]);
  printTable(headers, rows);
  process.stdout.write(`\n${String(worlds.length)} world(s) — data directory: ${dataDir}\n`);
}

export async function runWorldCreate(args: WorldCreateArgs): Promise<void> {
  const dataDir = resolveDataDir(args.dataDir);

  // Build a registry with the stub system registered so validation works.
  const registry = new SystemRegistry();
  try {
    const { stubSystem } = await import("@fusion/system-stub");
    registry.register(stubSystem);
  } catch {
    // stub not available — registry stays empty; validation still runs against
    // whatever systems are present (none in this case)
  }

  const manager = new WorldManager({ dataDir, validSystemIds: registry });

  let manifest;
  try {
    manifest = manager.create({
      slug: args.slug,
      system: args.system,
      title: args.title ?? args.slug,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion world create: ${msg}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `World created successfully.\n` +
      `  slug:    ${manifest.id}\n` +
      `  title:   ${manifest.title}\n` +
      `  system:  ${manifest.system}\n` +
      `  dataDir: ${dataDir}\n`,
  );
}

export async function runWorldBackup(args: WorldBackupArgs): Promise<void> {
  const dataDir = resolveDataDir(args.dataDir);
  const manager = new WorldManager({ dataDir });

  let entry;
  try {
    entry = await manager.backup(args.slug, "manual");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion world backup: ${msg}\n`);
    process.exit(1);
  }

  const sizeMb = (entry.sizeBytes / 1024 / 1024).toFixed(2);
  process.stdout.write(
    `Backup created successfully.\n` +
      `  file:    ${entry.filename}\n` +
      `  size:    ${sizeMb} MB\n` +
      `  path:    ${entry.path}\n`,
  );
}
