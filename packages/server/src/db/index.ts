/**
 * Database module public API.
 *
 * Re-exports connection helpers and registers all migrations on import.
 */

export {
  openDatabase,
  runIntegrityCheck,
  getWalFileSize,
  DatabaseCorruptionError,
  DatabaseStateError,
} from "./connection.js";

export {
  applyMigrations,
  checkSchema,
  getSchemaVersion,
  registerMigrations,
  MigrationError,
  SchemaMismatchError,
} from "./migrations.js";

export type { FusionDatabase, OpenDatabaseOptions } from "./connection.js";
export type {
  FusionMigration,
  ApplyMigrationsOptions,
  SchemaProblem,
  SchemaReport,
} from "./migrations.js";

// ---------------------------------------------------------------------------
// Register all bundled migrations
// ---------------------------------------------------------------------------
import { registerMigrations } from "./migrations.js";
import { migration001 } from "./migrations/001_initial_schema.js";
import { migration002 } from "./migrations/002_users_sessions.js";
import { migration003 } from "./migrations/003_fog_exploration.js";
import { migration004 } from "./migrations/004_region_maps.js";
import { migration005 } from "./migrations/005_roll_audit_log.js";
import { migration006 } from "./migrations/006_constraints.js";
import { migration007 } from "./migrations/007_indexes.js";
import { migration008 } from "./migrations/008_scene_active.js";
import { migration009 } from "./migrations/009_assets.js";
import { migration010 } from "./migrations/010_dec_mc_01_ancient_elf.js";

registerMigrations([
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
]);
