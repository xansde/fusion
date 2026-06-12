/**
 * Minimal CLI argument parser for the fusion command.
 *
 * Handles:
 *   fusion serve  [--port N] [--data-dir PATH] [--log-level LEVEL]
 *   fusion world list
 *   fusion world create <slug> --system <id> [--title <t>]
 *   fusion world backup <slug>
 *
 * No external dependencies — keeps the package lean.
 */

// ---------------------------------------------------------------------------
// Parsed argument shapes
// With exactOptionalPropertyTypes, optional keys must be declared with '?'
// (never as 'T | undefined') so they can be omitted entirely from the object.
// ---------------------------------------------------------------------------

export type ServeArgs = {
  command: "serve";
  port?: number;
  dataDir?: string;
  logLevel?: string;
};

export type WorldListArgs = {
  command: "world:list";
  dataDir?: string;
};

export type WorldCreateArgs = {
  command: "world:create";
  slug: string;
  system: string;
  title?: string;
  dataDir?: string;
};

export type WorldBackupArgs = {
  command: "world:backup";
  slug: string;
  dataDir?: string;
};

export type HelpArgs = {
  command: "help";
  topic?: string;
};

export type ParsedArgs = ServeArgs | WorldListArgs | WorldCreateArgs | WorldBackupArgs | HelpArgs;

// ---------------------------------------------------------------------------
// Parse error
// ---------------------------------------------------------------------------

export class ParseArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseArgsError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Consume a named option value from argv (mutates the array).
 * Returns the value string or undefined if the flag is absent.
 */
function consumeOption(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ParseArgsError(`Option ${flag} requires a value`);
  }
  argv.splice(idx, 2);
  return value;
}

/**
 * Consume a boolean flag from argv (mutates the array).
 */
function consumeFlag(argv: string[], flag: string): boolean {
  const idx = argv.indexOf(flag);
  if (idx === -1) return false;
  argv.splice(idx, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): ParsedArgs {
  // Work on a mutable copy
  const args = [...argv];

  // Check for top-level help / version
  if (args.length === 0 || consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    return { command: "help" };
  }
  if (consumeFlag(args, "--version") || consumeFlag(args, "-v")) {
    return { command: "help", topic: "version" };
  }

  const subcommand = args.shift();

  // -------------------------------------------------------------------------
  // fusion serve
  // -------------------------------------------------------------------------
  if (subcommand === "serve") {
    const portStr = consumeOption(args, "--port");
    const dataDir = consumeOption(args, "--data-dir");
    const logLevel = consumeOption(args, "--log-level");

    if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
      return { command: "help", topic: "serve" };
    }

    let port: number | undefined;
    if (portStr !== undefined) {
      port = parseInt(portStr, 10);
      if (!Number.isFinite(port) || port < 0 || port > 65535) {
        throw new ParseArgsError(
          `Invalid port: "${portStr}". Must be a number between 0 and 65535.`,
        );
      }
    }

    // Build the result only with defined optional fields (exactOptionalPropertyTypes)
    const result: ServeArgs = { command: "serve" };
    if (port !== undefined) result.port = port;
    if (dataDir !== undefined) result.dataDir = dataDir;
    if (logLevel !== undefined) result.logLevel = logLevel;
    return result;
  }

  // -------------------------------------------------------------------------
  // fusion world …
  // -------------------------------------------------------------------------
  if (subcommand === "world") {
    const worldCmd = args.shift();

    // -- world list --
    if (worldCmd === "list") {
      const dataDir = consumeOption(args, "--data-dir");
      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "world list" };
      }
      const result: WorldListArgs = { command: "world:list" };
      if (dataDir !== undefined) result.dataDir = dataDir;
      return result;
    }

    // -- world create <slug> --
    if (worldCmd === "create") {
      const slug = args.shift();
      if (slug === undefined || slug.startsWith("--")) {
        throw new ParseArgsError(
          "world create requires a slug argument: fusion world create <slug> --system <id>",
        );
      }

      const system = consumeOption(args, "--system");
      const title = consumeOption(args, "--title");
      const dataDir = consumeOption(args, "--data-dir");

      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "world create" };
      }

      if (system === undefined) {
        throw new ParseArgsError("world create requires --system <id>");
      }

      const result: WorldCreateArgs = { command: "world:create", slug, system };
      if (title !== undefined) result.title = title;
      if (dataDir !== undefined) result.dataDir = dataDir;
      return result;
    }

    // -- world backup <slug> --
    if (worldCmd === "backup") {
      const slug = args.shift();
      if (slug === undefined || slug.startsWith("--")) {
        throw new ParseArgsError(
          "world backup requires a slug argument: fusion world backup <slug>",
        );
      }
      const dataDir = consumeOption(args, "--data-dir");
      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "world backup" };
      }
      const result: WorldBackupArgs = { command: "world:backup", slug };
      if (dataDir !== undefined) result.dataDir = dataDir;
      return result;
    }

    if (worldCmd === undefined || consumeFlag(args, "--help") || worldCmd === "--help") {
      return { command: "help", topic: "world" };
    }

    throw new ParseArgsError(
      `Unknown world subcommand: "${worldCmd}". Try: fusion world list|create|backup`,
    );
  }

  // -------------------------------------------------------------------------
  // fusion help
  // -------------------------------------------------------------------------
  if (subcommand === "help") {
    const result: HelpArgs = { command: "help" };
    if (args[0] !== undefined) result.topic = args[0];
    return result;
  }

  throw new ParseArgsError(`Unknown command: "${subcommand ?? ""}". Try: fusion serve|world|help`);
}
