/**
 * Tests for per-command `--help`/`-h` resolution (manual validation round 2).
 *
 * Regression coverage for a scoping bug: parseArgs() had a top-level
 * `--help`/`-h` check that used consumeFlag() (indexOf-based, matches
 * anywhere in argv), so it captured `--help` belonging to a subcommand
 * (e.g. `world create --help`) before the subcommand's own — already
 * correct — `--help` handling ever ran. Every subcommand's help collapsed
 * into the generic root usage regardless of the topic. Fixed by only
 * treating `--help`/`-h`/`--version`/`-v` as top-level when they are args[0].
 *
 * These tests assert the actual `topic` returned by parseArgs (not just
 * that *some* usage text was printed) so a regression to the old
 * `{command:"help"}` (no topic) behaviour is caught — a prior test in
 * world-commands.test.ts only checked `stdout.toContain("USAGE")`, which
 * passes for both the generic root usage and any specific usage text and
 * therefore did not catch this bug.
 */

import { describe, it, expect } from "vitest";
import { parseArgs } from "../../cli/args.js";
import { printHelp } from "../../cli/help.js";
import type { HelpArgs } from "../../cli/args.js";

// ---------------------------------------------------------------------------
// parseArgs — topic resolution per subcommand
// ---------------------------------------------------------------------------

describe("parseArgs — per-subcommand --help resolves the correct topic", () => {
  it("fusion --help (bare, no subcommand) has no topic (root usage)", () => {
    const result = parseArgs(["--help"]) as HelpArgs;
    expect(result.command).toBe("help");
    expect(result.topic).toBeUndefined();
  });

  it("fusion -h (bare, no subcommand) has no topic (root usage)", () => {
    const result = parseArgs(["-h"]) as HelpArgs;
    expect(result.command).toBe("help");
    expect(result.topic).toBeUndefined();
  });

  it("fusion serve --help resolves topic 'serve'", () => {
    const result = parseArgs(["serve", "--help"]) as HelpArgs;
    expect(result.command).toBe("help");
    expect(result.topic).toBe("serve");
  });

  it("fusion serve -h resolves topic 'serve'", () => {
    const result = parseArgs(["serve", "-h"]) as HelpArgs;
    expect(result.topic).toBe("serve");
  });

  it("fusion serve --port 8080 --help resolves topic 'serve' (flag not first)", () => {
    const result = parseArgs(["serve", "--port", "8080", "--help"]) as HelpArgs;
    expect(result.topic).toBe("serve");
  });

  it("fusion world --help resolves topic 'world'", () => {
    const result = parseArgs(["world", "--help"]) as HelpArgs;
    expect(result.topic).toBe("world");
  });

  it("fusion world list --help resolves topic 'world list'", () => {
    const result = parseArgs(["world", "list", "--help"]) as HelpArgs;
    expect(result.topic).toBe("world list");
  });

  it("fusion world create --help resolves topic 'world create'", () => {
    const result = parseArgs(["world", "create", "--help"]) as HelpArgs;
    expect(result.topic).toBe("world create");
  });

  it("fusion world create <slug> --system <id> --help resolves topic 'world create' (flag at the end)", () => {
    const result = parseArgs([
      "world",
      "create",
      "my_world",
      "--system",
      "stub",
      "--help",
    ]) as HelpArgs;
    expect(result.topic).toBe("world create");
  });

  it("fusion world backup --help resolves topic 'world backup'", () => {
    const result = parseArgs(["world", "backup", "--help"]) as HelpArgs;
    expect(result.topic).toBe("world backup");
  });

  it("fusion world backup <slug> --help resolves topic 'world backup' (flag after positional)", () => {
    const result = parseArgs(["world", "backup", "my_world", "--help"]) as HelpArgs;
    expect(result.topic).toBe("world backup");
  });

  it("fusion user --help resolves topic 'user'", () => {
    const result = parseArgs(["user", "--help"]) as HelpArgs;
    expect(result.topic).toBe("user");
  });

  it("fusion user add --help resolves topic 'user add' (no positionals needed)", () => {
    const result = parseArgs(["user", "add", "--help"]) as HelpArgs;
    expect(result.topic).toBe("user add");
  });

  it("fusion user add <world> <name> --help resolves topic 'user add' (flag right after positionals)", () => {
    const result = parseArgs(["user", "add", "my_world", "Alice", "--help"]) as HelpArgs;
    expect(result.topic).toBe("user add");
  });

  it("fusion user add <world> <name> --role X --help resolves topic 'user add' (flag at the end)", () => {
    const result = parseArgs([
      "user",
      "add",
      "my_world",
      "Alice",
      "--role",
      "PLAYER",
      "--help",
    ]) as HelpArgs;
    expect(result.topic).toBe("user add");
  });

  it("fusion --version has no subcommand topic", () => {
    const result = parseArgs(["--version"]) as HelpArgs;
    expect(result.command).toBe("help");
    expect(result.topic).toBe("version");
  });
});

// ---------------------------------------------------------------------------
// printHelp — every topic prints its OWN usage text, not the generic root
// ---------------------------------------------------------------------------

describe("printHelp — each topic prints distinct, non-generic usage text", () => {
  function capture(topic: string | undefined): string {
    let out = "";
    const original = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only stdout capture
    (process.stdout as any).write = (chunk: string) => {
      out += chunk;
      return true;
    };
    try {
      printHelp(topic);
    } finally {
      process.stdout.write = original;
    }
    return out;
  }

  it("topic undefined prints root usage (COMMANDS section)", () => {
    const out = capture(undefined);
    expect(out).toContain("COMMANDS");
  });

  it("topic 'serve' prints serve-specific usage, not the root COMMANDS list", () => {
    const out = capture("serve");
    expect(out).toContain("fusion serve — Start the Fusion server");
    expect(out).toContain("--tunnel");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'world create' prints world-create-specific usage with --system and --gm-password", () => {
    const out = capture("world create");
    expect(out).toContain("fusion world create — Create a new world");
    expect(out).toContain("--system <id>");
    expect(out).toContain("--gm-password");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'world backup' prints world-backup-specific usage", () => {
    const out = capture("world backup");
    expect(out).toContain("fusion world backup — Create a manual backup");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'world list' prints world-list-specific usage", () => {
    const out = capture("world list");
    expect(out).toContain("fusion world list — List all worlds");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'world' prints the world subcommand summary", () => {
    const out = capture("world");
    expect(out).toContain("fusion world — World management commands");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'user' prints the user subcommand summary", () => {
    const out = capture("user");
    expect(out).toContain("fusion user — User management commands");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'user add' prints user-add-specific usage with --role and --password", () => {
    const out = capture("user add");
    expect(out).toContain("fusion user add — Add a user to a world");
    expect(out).toContain("--role <role>");
    expect(out).toContain("--password");
    expect(out).not.toContain("fusion <command> [options]");
  });

  it("topic 'version' prints only the version string", () => {
    const out = capture("version");
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
