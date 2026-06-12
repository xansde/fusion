/**
 * @fusion/server — entry point.
 *
 * Exports the public API for programmatic use and, when executed directly,
 * runs the full boot sequence.
 *
 * REQ-ARQ-004: server must NOT import from @fusion/client.
 * REQ-ARQ-007: single Node.js process, Fastify for HTTP.
 */

export { loadConfig } from "./config.js";
export type { ServerConfig, LoadConfigOptions } from "./config.js";
export { createLogger } from "./logger.js";
export { boot } from "./boot.js";
export type { BootResult, BootOptions } from "./boot.js";

// ---------------------------------------------------------------------------
// Main entry point — only runs when this file is executed directly.
// Delegates to the CLI dispatcher (src/cli/index.ts) which handles all
// subcommands including 'serve'.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";

const argv1: string | undefined = process.argv[1];
const isMain = argv1 !== undefined && fileURLToPath(import.meta.url) === argv1;

if (isMain) {
  // Redirect to the CLI entry point so `node dist/index.js` behaves identically
  // to `fusion serve` (backwards-compatible with existing tooling).
  // We inject "serve" as the default subcommand when no args are provided,
  // and otherwise let the CLI dispatcher handle whatever the user typed.
  if (process.argv.slice(2).length === 0) {
    process.argv.splice(2, 0, "serve");
  }
  await import("./cli/index.js");
}
