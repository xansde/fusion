/**
 * `GET /avatar/*` — the acervo route (spec 33, REQ-AVT-041/042).
 *
 * Uses Fastify's `inject`, so no port is bound.
 *
 * The two behaviours worth pinning:
 *
 *  1. **404, not index.html.** Without a dedicated route the SPA catch-all
 *     answers `/avatar/catalogo.json` with the app shell, and the client's
 *     `JSON.parse` fails with a syntax error instead of the honest "acervo
 *     indisponível" it knows how to render. A release ships the acervo as a
 *     SIDECAR (it is 58 MB, see the route's module doc), so "no acervo here" is
 *     a normal state that has to answer correctly.
 *  2. **No traversal.** `/avatar/` maps straight onto a filesystem path.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { resolveAvatarAcervoDir } from "../avatar/routes.js";

const tempDirs: string[] = [];

function makeTestConfig() {
  return loadConfig({
    dataDirOverride: process.env["TMPDIR"] ?? process.env["TMP"] ?? "/tmp",
    cliOverrides: { port: 0, logLevel: "silent" },
  });
}

/**
 * A client-dist fixture, optionally with an acervo inside it.
 *
 * The secret file lives in the PARENT of dist, not inside it: everything under
 * dist is legitimately served by the SPA route, so a secret in there would prove
 * nothing about the acervo's own guard.
 */
function makeDistFixture(comAcervo: boolean): { dist: string; segredo: string } {
  const raiz = mkdtempSync(join(tmpdir(), "fusion-avatar-"));
  tempDirs.push(raiz);
  const dir = join(raiz, "dist");
  mkdirSync(join(dir, "assets-client"), { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><html><body><script src=x></script></body></html>",
  );
  writeFileSync(join(raiz, "segredo.txt"), "NAO-DEVE-SAIR-PELO-AVATAR");
  if (comAcervo) {
    mkdirSync(join(dir, "avatar", "atlas", "body", "L1"), { recursive: true });
    writeFileSync(join(dir, "avatar", "catalogo.json"), JSON.stringify({ pin: "abc", itens: [] }));
    writeFileSync(join(dir, "avatar", "atlas", "body", "L1", "male.png"), "fake-png-bytes");
  }
  return { dist: dir, segredo: join(raiz, "segredo.txt") };
}

describe("GET /avatar/*", () => {
  const abertos: BootResult[] = [];

  afterEach(async () => {
    for (const r of abertos.splice(0)) await r.shutdown();
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    delete process.env["FUSION_AVATAR_DIR"];
  });

  async function subir(distDir: string): Promise<BootResult> {
    const result = await boot({
      config: makeTestConfig(),
      logger: createLogger("silent"),
      skipSignalHandlers: true,
      spaContext: { distDir },
    });
    abertos.push(result);
    return result;
  }

  it("serves the catalog and an atlas out of the client build", async () => {
    const { dist } = makeDistFixture(true);
    const result = await subir(dist);

    const catalogo = await result.fastify.inject({ method: "GET", url: "/avatar/catalogo.json" });
    expect(catalogo.statusCode).toBe(200);
    expect(catalogo.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(catalogo.body)).toMatchObject({ pin: "abc" });

    const atlas = await result.fastify.inject({
      method: "GET",
      url: "/avatar/atlas/body/L1/male.png",
    });
    expect(atlas.statusCode).toBe(200);
    expect(atlas.headers["content-type"]).toBe("image/png");
    expect(atlas.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers 404 — never the app shell — when the acervo is absent", async () => {
    const { dist } = makeDistFixture(false);
    // A monorepo checkout ALWAYS has the acervo installed as a client dependency
    // (that is resolution step 4), so "absent" has to be forced. An override
    // pointing nowhere is exactly the packaged case: no sidecar, no acervo.
    process.env["FUSION_AVATAR_DIR"] = join(tmpdir(), "fusion-acervo-que-nao-existe");
    const result = await subir(dist);

    const resposta = await result.fastify.inject({ method: "GET", url: "/avatar/catalogo.json" });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.body).not.toContain("<!doctype html");
    expect(JSON.parse(resposta.body)).toMatchObject({ ok: false, code: "AVATAR_ACERVO_MISSING" });
  });

  it("answers 404 for a file the acervo does not have", async () => {
    const result = await subir(makeDistFixture(true).dist);
    const resposta = await result.fastify.inject({ method: "GET", url: "/avatar/atlas/nada.png" });
    expect(resposta.statusCode).toBe(404);
    expect(JSON.parse(resposta.body)).toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses traversal out of the acervo", async () => {
    const result = await subir(makeDistFixture(true).dist);

    // What this actually establishes: no form of traversal returns the file
    // sitting one level above the acervo.
    //
    // Measured, not assumed: Fastify normalises dot segments — percent-encoded
    // ones too — BEFORE routing, so none of these ever reach the handler with a
    // `..` in the wildcard; they get re-routed and end up on the SPA shell. The
    // handler's guardPath is therefore defence in depth (and is what the
    // client-side plugin test exercises directly, where there is no framework in
    // front of it). Either way the assertion below is the one that matters.
    const traversals = [
      "/avatar/../segredo.txt",
      "/avatar/atlas/../../segredo.txt",
      "/avatar/%2e%2e/segredo.txt",
      "/avatar/atlas/%2e%2e/%2e%2e/segredo.txt",
      "/avatar/%2e%2e%2fsegredo.txt",
      "/avatar/..%2fsegredo.txt",
    ];
    for (const url of traversals) {
      const resposta = await result.fastify.inject({ method: "GET", url });
      expect(resposta.body, url).not.toContain("NAO-DEVE-SAIR-PELO-AVATAR");
    }
  });

  it("honours FUSION_AVATAR_DIR over the client build", async () => {
    const externo = mkdtempSync(join(tmpdir(), "fusion-avatar-sidecar-"));
    tempDirs.push(externo);
    writeFileSync(join(externo, "catalogo.json"), JSON.stringify({ pin: "sidecar" }));
    process.env["FUSION_AVATAR_DIR"] = externo;

    const result = await subir(makeDistFixture(true).dist);
    const resposta = await result.fastify.inject({ method: "GET", url: "/avatar/catalogo.json" });
    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body)).toMatchObject({ pin: "sidecar" });
  });
});

describe("resolveAvatarAcervoDir", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    delete process.env["FUSION_AVATAR_DIR"];
  });

  it("prefers the client build's avatar/ directory", () => {
    const { dist } = makeDistFixture(true);
    expect(resolveAvatarAcervoDir({ clientDistDir: dist })).toBe(join(dist, "avatar"));
  });

  it("finds the sidecar next to the executable", () => {
    // The release emits dist-release/avatar/ beside the artifact; this is how a
    // packaged server finds it, since the acervo is not in the SEA blob.
    const exeDir = mkdtempSync(join(tmpdir(), "fusion-avatar-exe-"));
    tempDirs.push(exeDir);
    mkdirSync(join(exeDir, "avatar"), { recursive: true });
    expect(
      resolveAvatarAcervoDir({ clientDistDir: null, execPath: join(exeDir, "fusion-server.exe") }),
    ).toBe(join(exeDir, "avatar"));
  });

  it("ignores an override that does not exist instead of returning a broken path", () => {
    expect(
      resolveAvatarAcervoDir({
        clientDistDir: null,
        override: join(tmpdir(), "nao-existe-avatar-xyz"),
      }),
    ).toBeNull();
  });

  it("falls back to the installed waybuilder-avatar package in a source checkout", () => {
    // No client build, no sidecar: a `fusion serve` from source still has the
    // acervo, because it is an installed dependency of the client package.
    const semNada = mkdtempSync(join(tmpdir(), "fusion-avatar-vazio-"));
    tempDirs.push(semNada);
    const resolvido = resolveAvatarAcervoDir({
      clientDistDir: null,
      execPath: join(semNada, "node.exe"),
    });
    expect(resolvido).not.toBeNull();
    expect(resolvido?.endsWith("saida")).toBe(true);
  });
});
