/**
 * Tests for the M6 UX fix: `fusion` with no command at all defaults to
 * `serve` instead of printing help and exiting (see args.ts's implicitServe
 * handling in parseArgs). Covers the four conditions the fix must not
 * disturb: bare invocation, --help/-h, --version/-v, and the new --no-open
 * flag on the `serve` subcommand.
 */

import { describe, it, expect } from "vitest";
import { parseArgs } from "../../cli/args.js";
import type { ServeArgs } from "../../cli/args.js";

describe("parseArgs — no command given defaults to serve", () => {
  it("returns a serve command with implicitServe: true when argv is empty", () => {
    const result = parseArgs([]) as ServeArgs;
    expect(result.command).toBe("serve");
    expect(result.implicitServe).toBe(true);
  });

  it("does not set port/dataDir/logLevel/world/tunnel when implicit", () => {
    const result = parseArgs([]) as ServeArgs;
    expect("port" in result).toBe(false);
    expect("dataDir" in result).toBe(false);
    expect("logLevel" in result).toBe(false);
    expect("world" in result).toBe(false);
    expect("tunnel" in result).toBe(false);
    expect("noOpen" in result).toBe(false);
  });

  it("an explicit `fusion serve` does NOT set implicitServe", () => {
    const result = parseArgs(["serve"]) as ServeArgs;
    expect(result.command).toBe("serve");
    expect("implicitServe" in result).toBe(false);
  });
});

describe("parseArgs — --help/-h and --version/-v still work with no other args", () => {
  it("--help alone returns help (root)", () => {
    const result = parseArgs(["--help"]);
    expect(result).toEqual({ command: "help" });
  });

  it("-h alone returns help (root)", () => {
    const result = parseArgs(["-h"]);
    expect(result).toEqual({ command: "help" });
  });

  it("--version alone returns help with topic version", () => {
    const result = parseArgs(["--version"]);
    expect(result).toEqual({ command: "help", topic: "version" });
  });

  it("-v alone returns help with topic version", () => {
    const result = parseArgs(["-v"]);
    expect(result).toEqual({ command: "help", topic: "version" });
  });
});

describe("parseArgs — fusion serve --no-open", () => {
  it("sets noOpen: true when --no-open is passed", () => {
    const result = parseArgs(["serve", "--no-open"]) as ServeArgs;
    expect(result.command).toBe("serve");
    expect(result.noOpen).toBe(true);
  });

  it("omits noOpen entirely when --no-open is not passed (exactOptionalPropertyTypes contract)", () => {
    const result = parseArgs(["serve"]) as ServeArgs;
    expect("noOpen" in result).toBe(false);
  });

  it("combines with --port, --world, --tunnel", () => {
    const result = parseArgs([
      "serve",
      "--port",
      "8080",
      "--world",
      "my-campaign",
      "--tunnel",
      "--no-open",
    ]) as ServeArgs;

    expect(result.noOpen).toBe(true);
    expect(result.port).toBe(8080);
    expect(result.world).toBe("my-campaign");
    expect(result.tunnel).toBe(true);
  });

  it("does not require a value after --no-open (it is a boolean flag)", () => {
    const result = parseArgs(["serve", "--no-open", "--port", "9000"]) as ServeArgs;
    expect(result.noOpen).toBe(true);
    expect(result.port).toBe(9000);
  });
});
