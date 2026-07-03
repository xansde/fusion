/**
 * Help text for the fusion CLI.
 */

import { FUSION_VERSION } from "@fusion/shared";

const VERSION = FUSION_VERSION;

const USAGE_ROOT = `\
fusion ${VERSION} — Fusion VTT server

USAGE
  fusion <command> [options]

COMMANDS
  serve                  Start the Fusion server
  world list             List all worlds in the data directory
  world create <slug>    Create a new world
  world backup <slug>    Create a manual backup of a world

OPTIONS
  --help, -h             Show help
  --version, -v          Show version

Run 'fusion <command> --help' for command-specific options.
`;

const USAGE_SERVE = `\
fusion serve — Start the Fusion server

USAGE
  fusion serve [options]

OPTIONS
  --port <n>             TCP port to listen on (default: 33000)
  --data-dir <path>      Root data directory (default: Documents/FusionVTT)
  --log-level <level>    Log level: trace|debug|info|warn|error|fatal|silent
                         (default: info)
  --help, -h             Show this help

EXAMPLES
  fusion serve
  fusion serve --port 8080
  fusion serve --data-dir /var/fusion-data --log-level debug
`;

const USAGE_WORLD = `\
fusion world — World management commands

USAGE
  fusion world <subcommand> [options]

SUBCOMMANDS
  list                   List all worlds
  create <slug>          Create a new world
  backup <slug>          Create a manual backup

Run 'fusion world <subcommand> --help' for more details.
`;

const USAGE_WORLD_LIST = `\
fusion world list — List all worlds

USAGE
  fusion world list [options]

OPTIONS
  --data-dir <path>      Root data directory (default: Documents/FusionVTT)
  --help, -h             Show this help

OUTPUT
  A table with columns: slug, title, system, schemaVersion
`;

const USAGE_WORLD_CREATE = `\
fusion world create — Create a new world

USAGE
  fusion world create <slug> --system <id> [options]

ARGUMENTS
  <slug>                 World slug: lowercase letters, digits, underscores (max 64 chars)

OPTIONS
  --system <id>          System ID to use for the world (required)
  --title <text>         Human-readable world title (default: same as slug)
  --data-dir <path>      Root data directory (default: Documents/FusionVTT)
  --help, -h             Show this help

EXAMPLES
  fusion world create my_world --system stub --title "My World"
  fusion world create campaign_2025 --system stub
`;

const USAGE_WORLD_BACKUP = `\
fusion world backup — Create a manual backup

USAGE
  fusion world backup <slug> [options]

ARGUMENTS
  <slug>                 World slug to back up

OPTIONS
  --data-dir <path>      Root data directory (default: Documents/FusionVTT)
  --help, -h             Show this help
`;

export function printHelp(topic: string | undefined): void {
  switch (topic) {
    case "serve":
      process.stdout.write(USAGE_SERVE);
      break;
    case "world":
      process.stdout.write(USAGE_WORLD);
      break;
    case "world list":
      process.stdout.write(USAGE_WORLD_LIST);
      break;
    case "world create":
      process.stdout.write(USAGE_WORLD_CREATE);
      break;
    case "world backup":
      process.stdout.write(USAGE_WORLD_BACKUP);
      break;
    case "version":
      process.stdout.write(`${VERSION}\n`);
      break;
    default:
      process.stdout.write(USAGE_ROOT);
      break;
  }
}
