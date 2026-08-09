/**
 * Tests for the acervo publisher's path handling.
 *
 * The middleware turns a request URL into a filesystem path, so the traversal
 * guard is the security-relevant part: `/avatar/` must never be able to read
 * outside the package's own `saida/`. Same guard class as
 * packages/server/src/assets/path-guard.ts, kept local to the plugin because
 * the client build must not depend on @fusion/server.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { AVATAR_URL_PREFIX, resolveAcervoDir, resolveAcervoFile } from "../waybuilder-avatar.js";

const ACERVO = resolve("/tmp/acervo");

describe("resolveAcervoFile", () => {
  it("resolves a plain asset path under the acervo", () => {
    expect(resolveAcervoFile(ACERVO, "/avatar/catalogo.json")).toBe(join(ACERVO, "catalogo.json"));
    expect(resolveAcervoFile(ACERVO, "/avatar/atlas/body/L1/male.png")).toBe(
      join(ACERVO, "atlas", "body", "L1", "male.png"),
    );
  });

  it("ignores the query string and hash", () => {
    expect(resolveAcervoFile(ACERVO, "/avatar/catalogo.json?v=2")).toBe(
      join(ACERVO, "catalogo.json"),
    );
    expect(resolveAcervoFile(ACERVO, "/avatar/catalogo.json#x")).toBe(
      join(ACERVO, "catalogo.json"),
    );
  });

  it("returns null for URLs outside the prefix", () => {
    expect(resolveAcervoFile(ACERVO, "/api/world")).toBeNull();
    expect(resolveAcervoFile(ACERVO, "/avatarize/x.png")).toBeNull();
    expect(resolveAcervoFile(ACERVO, "/")).toBeNull();
  });

  it("refuses traversal, encoded traversal and absolute escapes", () => {
    expect(resolveAcervoFile(ACERVO, "/avatar/../../.env")).toBeNull();
    expect(resolveAcervoFile(ACERVO, "/avatar/atlas/../../../etc/passwd")).toBeNull();
    expect(resolveAcervoFile(ACERVO, "/avatar/%2e%2e%2f%2e%2e%2f.env")).toBeNull();
    // the acervo dir itself is not a file inside the acervo
    expect(resolveAcervoFile(ACERVO, AVATAR_URL_PREFIX)).toBeNull();
  });

  it("refuses malformed percent-encoding and NUL bytes", () => {
    expect(resolveAcervoFile(ACERVO, "/avatar/%zz.png")).toBeNull();
    expect(resolveAcervoFile(ACERVO, "/avatar/a%00.png")).toBeNull();
  });

  it("does not let a sibling directory pass as a prefix match", () => {
    // resolve() of "../acervo-outro/x" lands next to the acervo, not inside it:
    // the guard compares against `acervoDir + sep`, so this must be refused.
    expect(resolveAcervoFile(ACERVO, "/avatar/../acervo-outro/x.png")).toBeNull();
  });
});

describe("resolveAcervoDir", () => {
  it("points at the installed package's saida/ with a real catalog in it", () => {
    const dir = resolveAcervoDir();
    expect(dir.endsWith(`${sep}saida`)).toBe(true);
    expect(existsSync(join(dir, "catalogo.json"))).toBe(true);
    expect(existsSync(join(dir, "atlas", "body", "L1", "male.png"))).toBe(true);
    expect(existsSync(join(dir, "paletas", "body", "body_ulpc.json"))).toBe(true);
  });
});
