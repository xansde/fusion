/**
 * CLI commands: fusion user add <world> <name> --role <role>
 *
 * REQ-USR-025: GM can create users (here via CLI, no auth required since
 * this is a local admin operation on the machine running the server).
 */

import { join } from "node:path";
import type { UserAddArgs } from "../args.js";
import { openDatabase, applyMigrations } from "../../db/index.js";
import { Role } from "../../auth/user-store.js";
import { AuthService, AuthError, loadOrCreateSecret } from "../../auth/index.js";
import { generateRandomPassword } from "../../auth/crypto.js";
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
    // C2 (o6b fixer, revisão adversarial): route through AuthService.createUser
    // instead of UserStore.create directly, so a PLAYER/TRUSTED user created
    // via this CLI command gets the same blank `character` Actor
    // (REQ-USR-025/025a/025b/025c) that the HTTP admin route creates — in the
    // same atomic transaction — for the same roles. Without it, a PLAYER
    // created via `fusion user add` had no way to reach the builder
    // (REQ-CFG-051a forbids a "create character" button in Settings → Users,
    // NPCs never creates a `character` type per DEC-NPC-02, and the player's
    // own `doc:create` was removed in C5/C6).
    const secret = loadOrCreateSecret(dataDir);
    const authService = new AuthService(fusionDb.raw, secret, args.world);

    // AuthService.createUser always hashes whatever password it is given and
    // never generates one itself — the CLI keeps generating and printing it
    // once, same as before this fix, just via the shared service now.
    const printedPassword = args.password === undefined ? generateRandomPassword() : null;
    const resolvedPassword = args.password ?? printedPassword ?? undefined;

    const createParams: { name: string; role: Role; password?: string } = {
      name: args.name,
      role,
    };
    if (resolvedPassword !== undefined) createParams.password = resolvedPassword;

    const { user } = await authService.createUser(createParams);

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
    if (err instanceof AuthError && err.code === "NAME_TAKEN") {
      process.stderr.write(
        `fusion user add: user "${args.name}" already exists in world "${args.world}"\n`,
      );
      fusionDb.close();
      process.exit(1);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion user add: ${msg}\n`);
    fusionDb.close();
    process.exit(1);
    return;
  }

  fusionDb.close();
}
