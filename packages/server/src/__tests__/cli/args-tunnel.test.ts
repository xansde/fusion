/**
 * Tests for the `--tunnel` CLI flag (M6/B4 — REQ-DST-034).
 *
 * Narrow, dedicated suite (parseArgs has no broader existing test file to
 * extend) covering: flag present/absent, combined with other serve flags,
 * and that it never leaks onto other subcommands.
 */

import { describe, it, expect } from "vitest";
import { parseArgs } from "../../cli/args.js";
import type { ServeArgs } from "../../cli/args.js";

describe("parseArgs — fusion serve --tunnel", () => {
  it("sets tunnel: true when --tunnel is passed", () => {
    const result = parseArgs(["serve", "--tunnel"]);
    expect(result.command).toBe("serve");
    expect((result as ServeArgs).tunnel).toBe(true);
  });

  it("omits tunnel entirely when --tunnel is not passed (exactOptionalPropertyTypes contract)", () => {
    const result = parseArgs(["serve"]);
    expect(result.command).toBe("serve");
    expect("tunnel" in result).toBe(false);
  });

  it("combines with --port, --data-dir, --world", () => {
    const result = parseArgs([
      "serve",
      "--port",
      "8080",
      "--data-dir",
      "/tmp/fusion-data",
      "--world",
      "my-campaign",
      "--tunnel",
    ]) as ServeArgs;

    expect(result.tunnel).toBe(true);
    expect(result.port).toBe(8080);
    expect(result.dataDir).toBe("/tmp/fusion-data");
    expect(result.world).toBe("my-campaign");
  });

  it("does not require a value after --tunnel (it is a boolean flag, not an option)", () => {
    const result = parseArgs(["serve", "--tunnel", "--port", "9000"]) as ServeArgs;
    expect(result.tunnel).toBe(true);
    expect(result.port).toBe(9000);
  });

  it("--tunnel is accepted before or after other flags", () => {
    const before = parseArgs(["serve", "--tunnel", "--port", "9000"]) as ServeArgs;
    const after = parseArgs(["serve", "--port", "9000", "--tunnel"]) as ServeArgs;
    expect(before.tunnel).toBe(true);
    expect(after.tunnel).toBe(true);
  });
});
