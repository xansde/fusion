/**
 * CLI commands: fusion user add <world> <name> --role <role>
 *
 * REQ-USR-025: GM can create users (here via CLI, no auth required since
 * this is a local admin operation on the machine running the server).
 */

import { join } from "node:path";
import type { UserAddArgs } from "../args.js";
import { openDatabase, applyMigrations } from "../../db/index.js";
import { UserStore, Role } from "../../auth/user-store.js";
import { hashPassword, generateRandomPassword } from "../../auth/crypto.js";
import { resolveDataDirForLoad } from "../../config.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { createLogger } from "../../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective data directory (explicit --data-dir/FUSION_DATA_DIR,
 * or the per-OS default with legacy ~/.fusion read-fallback — REQ-DST-008)
 * and ensure the REQ-DST-007 tree/Config migration is in place.
 *
 * A logger is passed to ensureDataDirLayout so the legacy-fallback warning
 * AND the data-dir migration log (data-dir.ts, logged at "info") both
 * surface instead of being silently discarded — this CLI path has no
 * long-lived server logger to reuse, so a fresh minimal logger is created
 * just for this call. "info" (not "warn") is required so the one-time
 * migration message is not swallowed.
 */
function resolveDataDir(dataDirArg: string | undefined): string {
  const { dataDir, usedLegacyFallback } = resolveDataDirForLoad(
    dataDirArg !== undefined ? { cliOverrides: { dataDir: dataDirArg } } : {},
  );
  ensureDataDirLayout(dataDir, {
    usedLegacyDataDir: usedLegacyFallback,
    logger: createLogger("info"),
  });
  return dataDir;
}

function parseRole(roleStr: string): Role {
  switch (roleStr.toUpperCase()) {
    case "PLAYER":
      return Role.PLAYER;
    case "TRUSTED":
      return Role.TRUSTED;
    case "ASSISTANT":
      return Role.ASSISTANT;
    case "GAMEMASTER":
      return Role.GAMEMASTER;
    default:
      throw new Error(
        `Invalid role: "${roleStr}". Valid values: PLAYER, TRUSTED, ASSISTANT, GAMEMASTER`,
      );
  }
}

// ---------------------------------------------------------------------------
// user add
// ---------------------------------------------------------------------------

export async function runUserAdd(args: UserAddArgs): Promise<void> {
  const dataDir = resolveDataDir(args.dataDir);
  const dbPath = join(dataDir, "worlds", args.world, "world.db");

  let role: Role;
  try {
    role = parseRole(args.role);
  } catch (err) {
    process.stderr.write(`fusion user add: ${String(err)}\n`);
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  let fusionDb;
  try {
    fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion user add: cannot open world "${args.world}": ${msg}\n`);
    process.exit(1);
    return;
  }

  try {
    const userStore = new UserStore(fusionDb.raw);

    // Check for duplicate
    const existing = userStore.findByName(args.name);
    if (existing) {
      process.stderr.write(
        `fusion user add: user "${args.name}" already exists in world "${args.world}"\n`,
      );
      fusionDb.close();
      process.exit(1);
      return;
    }

    // Resolve password
    let passwordHash: string | null = null;
    let printedPassword: string | null = null;

    if (args.password !== undefined) {
      passwordHash = await hashPassword(args.password);
    } else {
      // Generate a random password and print it once
      const generated = generateRandomPassword();
      passwordHash = await hashPassword(generated);
      printedPassword = generated;
    }

    const user = userStore.create({
      name: args.name,
      role,
      passwordHash,
    });

    process.stdout.write(
      `User created successfully.\n` +
        `  id:      ${user.id}\n` +
        `  name:    ${user.name}\n` +
        `  role:    ${Role[user.role]}\n` +
        `  world:   ${args.world}\n`,
    );

    if (printedPassword !== null) {
      process.stdout.write(
        `\n  *** GENERATED PASSWORD (shown once): ${printedPassword} ***\n` +
          `  Share this password with the player and ask them to change it.\n`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion user add: ${msg}\n`);
    fusionDb.close();
    process.exit(1);
    return;
  }

  fusionDb.close();
}
