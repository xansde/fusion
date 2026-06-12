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
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";

const argv1: string | undefined = process.argv[1];
const isMain = argv1 !== undefined && fileURLToPath(import.meta.url) === argv1;

if (isMain) {
  await runMain();
}

async function runMain(): Promise<void> {
  const { loadConfig } = await import("./config.js");
  const { createLogger } = await import("./logger.js");
  const { boot } = await import("./boot.js");

  // Phase 1 — config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error("Failed to load configuration:", err);
    process.exit(1);
  }

  // Phase 2 — logger
  const logger = createLogger(config.logLevel);

  logger.info(
    { phase: "config", port: config.port, dataDir: config.dataDir },
    "Boot phase: config — loaded",
  );

  // Phases 3 + 4
  try {
    await boot({ config, logger });
  } catch (err) {
    logger.fatal({ err }, "Boot failed");
    process.exit(1);
  }
}
