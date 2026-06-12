#!/usr/bin/env node
/**
 * fusion CLI entry point.
 *
 * Dispatches to subcommands:
 *   fusion serve
 *   fusion world list
 *   fusion world create <slug>
 *   fusion world backup <slug>
 *
 * Exit codes:
 *   0  — success
 *   1  — error (message printed to stderr)
 */

import { parseArgs, ParseArgsError } from "./args.js";
import { printHelp } from "./help.js";
import { runServe } from "./commands/serve.js";
import { runWorldList, runWorldCreate, runWorldBackup } from "./commands/worlds.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // argv: [node, script, ...user args]
  const userArgs = process.argv.slice(2);

  let parsed;
  try {
    parsed = parseArgs(userArgs);
  } catch (err) {
    if (err instanceof ParseArgsError) {
      process.stderr.write(`fusion: ${err.message}\n\nRun 'fusion --help' for usage.\n`);
      process.exit(1);
    }
    throw err;
  }

  switch (parsed.command) {
    case "help":
      printHelp(parsed.topic);
      break;

    case "serve":
      await runServe(parsed);
      break;

    case "world:list":
      runWorldList(parsed);
      break;

    case "world:create":
      await runWorldCreate(parsed);
      break;

    case "world:backup":
      await runWorldBackup(parsed);
      break;

    default: {
      // Exhaustiveness check — TypeScript ensures all cases are handled.
      const _never: never = parsed;
      process.stderr.write(`fusion: unhandled command (this is a bug)\n`);
      void _never;
      process.exit(1);
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`fusion: unexpected error: ${String(err)}\n`);
  process.exit(1);
});
