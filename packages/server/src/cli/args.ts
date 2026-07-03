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
  /** When provided, open this world on boot and expose its socket namespace. */
  world?: string;
  /**
   * When true, start a Cloudflare quick tunnel (REQ-DST-034) so the server is
   * reachable over the internet at a public `*.trycloudflare.com` URL, in
   * addition to LAN. See packages/server/src/tunnel/.
   */
  tunnel?: boolean;
  /**
   * When true, suppress the first-run auto-open-browser behaviour (M6 UX
   * fix — "double-click the exe, answer a short wizard in the browser").
   * See decideAutoOpen() in commands/serve.ts for the full gate.
   */
  noOpen?: boolean;
  /**
   * True when `fusion serve` was reached because NO command was given at all
   * (bare `fusion`/double-clicked exe) rather than an explicit `fusion
   * serve`. Never set by the user — synthesized by parseArgs so runServe can
   * log a clarifying line ("No command given — starting server ..."). Not a
   * real CLI flag.
   */
  implicitServe?: boolean;
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
  /** Explicit GM password (printed to stdout once if not set). */
  gmPassword?: string;
};

export type WorldBackupArgs = {
  command: "world:backup";
  slug: string;
  dataDir?: string;
};

export type UserAddArgs = {
  command: "user:add";
  world: string;
  name: string;
  role: string;
  dataDir?: string;
  password?: string;
};

export type HelpArgs = {
  command: "help";
  topic?: string;
};

export type ParsedArgs =
  | ServeArgs
  | WorldListArgs
  | WorldCreateArgs
  | WorldBackupArgs
  | UserAddArgs
  | HelpArgs;

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

  // No command at all (bare `fusion` — notably a double-clicked SEA exe on
  // Windows, which passes zero argv) defaults to `serve` instead of printing
  // help and exiting: the target UX (docs/design/m6-distribuicao.md
  // guiding principle) is "GM double-clicks the exe, answers a short wizard
  // in the browser" — silently exiting after a help dump defeats that. This
  // must NOT swallow `--help`/`-h`/`--version`/`-v` passed with no other
  // args, so those are checked first.
  if (args.length === 0) {
    return { command: "serve", implicitServe: true };
  }

  // Check for top-level help / version — ONLY when the flag is the very
  // first token (args[0]). Using consumeFlag() here (which scans the whole
  // array via indexOf) would also match `--help`/`-h` that belongs to a
  // subcommand, e.g. `world create --help` or `serve --help`: it would
  // consume the flag before the "world"/"serve" branch below ever runs,
  // collapsing every subcommand's `--help` into the generic root usage
  // (bug found in manual validation round 2 — every subcommand's own
  // `--help` handling further down was unreachable as a result). Checking
  // args[0] directly keeps `fusion --help`/`fusion -h` working while letting
  // each subcommand branch own its own `--help`/`-h` detection wherever it
  // appears in its own argument list.
  if (args[0] === "--help" || args[0] === "-h") {
    args.shift();
    return { command: "help" };
  }
  if (args[0] === "--version" || args[0] === "-v") {
    args.shift();
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
    const world = consumeOption(args, "--world");
    const tunnel = consumeFlag(args, "--tunnel");
    const noOpen = consumeFlag(args, "--no-open");

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
    if (world !== undefined) result.world = world;
    if (tunnel) result.tunnel = true;
    if (noOpen) result.noOpen = true;
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
      // Check --help/-h BEFORE requiring the positional <slug>: a bare
      // `fusion world create --help` (no slug yet — the user is asking
      // what the command needs) must show this command's usage, not throw
      // a "missing slug" parse error.
      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "world create" };
      }

      const slug = args.shift();
      if (slug === undefined || slug.startsWith("--")) {
        throw new ParseArgsError(
          "world create requires a slug argument: fusion world create <slug> --system <id>",
        );
      }

      const system = consumeOption(args, "--system");
      const title = consumeOption(args, "--title");
      const dataDir = consumeOption(args, "--data-dir");
      const gmPassword = consumeOption(args, "--gm-password");

      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "world create" };
      }

      if (system === undefined) {
        throw new ParseArgsError("world create requires --system <id>");
      }

      const result: WorldCreateArgs = { command: "world:create", slug, system };
      if (title !== undefined) result.title = title;
      if (dataDir !== undefined) result.dataDir = dataDir;
      if (gmPassword !== undefined) result.gmPassword = gmPassword;
      return result;
    }

    // -- world backup <slug> --
    if (worldCmd === "backup") {
      // Same reasoning as `world create` above: --help must work even
      // without the positional <slug> present yet.
      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "world backup" };
      }
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
  // fusion user …
  // -------------------------------------------------------------------------
  if (subcommand === "user") {
    const userCmd = args.shift();

    // -- user add <world> <name> --
    if (userCmd === "add") {
      // Same reasoning as `world create`/`world backup`: --help must work
      // even without the positional <world>/<name> present yet.
      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "user add" };
      }
      const world = args.shift();
      if (world === undefined || world.startsWith("--")) {
        throw new ParseArgsError(
          "user add requires a world argument: fusion user add <world> <name> --role <role>",
        );
      }
      const name = args.shift();
      if (name === undefined || name.startsWith("--")) {
        throw new ParseArgsError(
          "user add requires a name argument: fusion user add <world> <name> --role <role>",
        );
      }

      const role = consumeOption(args, "--role");
      const dataDir = consumeOption(args, "--data-dir");
      const password = consumeOption(args, "--password");

      if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
        return { command: "help", topic: "user add" };
      }

      if (role === undefined) {
        throw new ParseArgsError("user add requires --role <PLAYER|TRUSTED|ASSISTANT|GAMEMASTER>");
      }

      const result: UserAddArgs = { command: "user:add", world, name, role };
      if (dataDir !== undefined) result.dataDir = dataDir;
      if (password !== undefined) result.password = password;
      return result;
    }

    if (userCmd === undefined || consumeFlag(args, "--help") || userCmd === "--help") {
      return { command: "help", topic: "user" };
    }

    throw new ParseArgsError(`Unknown user subcommand: "${userCmd}". Try: fusion user add`);
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
