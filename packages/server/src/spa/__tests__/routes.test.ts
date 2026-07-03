/**
 * Tests for SPA static serving (packages/server/src/spa/routes.ts).
 *
 * Regression coverage for the M6/B0-B1 bug: Vite's dynamic-import preload
 * helper (`__vite__mapDeps`) resolves lazy-loaded chunk deps (every game
 * system's character sheet — CharacterSheet/NpcSheet/OradorSheet/
 * AntagonistaSheet/Compositor) independently of index.html's own markup, as
 * `"/" + assetsDir + "/" + filename`. A serve-time HTML rewrite of
 * index.html alone cannot fix that — only building the client with
 * `build.assetsDir: "assets-client"` (packages/client/vite.config.ts) makes
 * every self-reference in the bundle correct, so this suite asserts against
 * the REAL built dist/ (no fixture), skipping gracefully if it is absent
 * (e.g. a server-only checkout that never ran `pnpm --filter client build`).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join as joinPath } from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerSpaRoutes, resolveClientDistDir } from "../routes.js";

const distDir = resolveClientDistDir();
const hasDist = distDir !== null && existsSync(joinPath(distDir, "index.html"));

describe.runIf(hasDist)("SPA routes — built dist/ integrity", () => {
  it("index.html references only /assets-client/, never bare /assets/", () => {
    const html = readFileSync(joinPath(distDir as string, "index.html"), "utf8");
    expect(html).not.toMatch(/(src|href)="\/assets\//);
  });

  it('no JS chunk under assets-client/ embeds a bare "/assets/" + hashed-filename reference that would hit the world\'s upload route', () => {
    const assetsClientDir = joinPath(distDir as string, "assets-client");
    const jsFiles = readdirSync(assetsClientDir).filter((f) => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);

    // The one known, unrelated exception: @3d-dice/dice-box's own default
    // assetPath ("/assets/dice-box") is a *different* asset space (3D dice
    // models), not a Vite-bundled chunk dependency — it does not go through
    // __vite__mapDeps and is out of scope for this regression guard.
    const offendingRefs: string[] = [];
    for (const file of jsFiles) {
      const content = readFileSync(joinPath(assetsClientDir, file), "utf8");
      const matches = content.match(/"\/assets\/(?!dice-box)[^"]*"/g);
      if (matches) offendingRefs.push(...matches.map((m) => `${file}: ${m}`));
    }
    expect(offendingRefs).toEqual([]);
  });

  it("mapDeps-style chunk dependencies (CSS for lazy-loaded sheets) resolve under assets-client/", () => {
    // NOTE (M6/B2): this asserts that AT LEAST ONE mapDeps array references a
    // CSS chunk under assets-client/ (proving the assetsDir fix from the doc
    // comment above actually applies to CSS, not just JS) — it does NOT
    // assert that EVERY chunk containing "__vite__mapDeps" has a CSS entry.
    // That stronger claim is not a real Vite invariant: a chunk's own
    // mapDeps array only lists ITS dynamic-import dependencies, and plenty
    // of legitimate chunks (e.g. @3d-dice/dice-box's internal renderer
    // split, or this app's own /setup vs main-app entry split introduced in
    // M6/B2) dynamically import other JS chunks with no CSS of their own.
    const assetsClientDir = joinPath(distDir as string, "assets-client");
    const jsFiles = readdirSync(assetsClientDir).filter((f) => f.endsWith(".js"));
    let foundMapDepsWithCss = false;
    for (const file of jsFiles) {
      const content = readFileSync(joinPath(assetsClientDir, file), "utf8");
      if (
        content.includes("__vite__mapDeps") &&
        /assets-client\/[A-Za-z0-9._-]+\.css/.test(content)
      ) {
        foundMapDepsWithCss = true;
        break;
      }
    }
    expect(foundMapDepsWithCss).toBe(true);
  });
});

describe.runIf(hasDist)("SPA routes — served over HTTP", () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify();
    registerSpaRoutes(fastify, { distDir: distDir ?? undefined });
    await fastify.ready();
  });

  it("GET / serves index.html referencing /assets-client/ paths", async () => {
    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/\/assets-client\//);
    expect(res.body).not.toMatch(/(src|href)="\/assets\//);
  });

  it("GET /assets-client/<hashed-css> returns 200 for every CSS chunk referenced by the bundle's mapDeps", async () => {
    const assetsClientDir = joinPath(distDir as string, "assets-client");
    const jsFiles = readdirSync(assetsClientDir).filter((f) => f.endsWith(".js"));
    const cssDeps = new Set<string>();
    for (const file of jsFiles) {
      const content = readFileSync(joinPath(assetsClientDir, file), "utf8");
      const deps = content.match(/assets-client\/([A-Za-z0-9._-]+\.css)/g) ?? [];
      for (const d of deps) cssDeps.add(d.replace("assets-client/", ""));
    }
    expect(cssDeps.size).toBeGreaterThan(0);

    for (const cssFile of cssDeps) {
      const res = await fastify.inject({ method: "GET", url: `/assets-client/${cssFile}` });
      expect(res.statusCode, `expected 200 for /assets-client/${cssFile}`).toBe(200);
    }
  });

  it("GET /assets/<anything> is NOT claimed by the SPA routes (stays free for the world's upload route)", async () => {
    const res = await fastify.inject({ method: "GET", url: "/assets/some-uploaded-file.png" });
    // The SPA catch-all explicitly refuses to answer /assets/* (see routes.ts);
    // in this isolated fastify instance (no world asset route registered) that
    // surfaces as Fastify's own 404, which is exactly the point: the SPA layer
    // must never intercept this prefix.
    expect(res.statusCode).toBe(404);
  });
});

describe("SPA routes — dist/ availability", () => {
  it("documents whether this checkout has a client build (informational, always passes)", () => {
    // Not a hard requirement for server-only checkouts/CI shards — the
    // describe.runIf blocks above already skip cleanly when dist is absent.
    expect(typeof hasDist).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// isSetupIncomplete — REQ-DST-011 redirect (M6/B2)
// ---------------------------------------------------------------------------

describe.runIf(hasDist)("SPA routes — isSetupIncomplete redirect (REQ-DST-011)", () => {
  it("GET / redirects to /setup when isSetupIncomplete() returns true", async () => {
    const fastify = Fastify();
    registerSpaRoutes(fastify, { distDir: distDir ?? undefined, isSetupIncomplete: () => true });
    await fastify.ready();

    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/setup");

    await fastify.close();
  });

  it("GET / serves the shell normally when isSetupIncomplete() returns false", async () => {
    const fastify = Fastify();
    registerSpaRoutes(fastify, { distDir: distDir ?? undefined, isSetupIncomplete: () => false });
    await fastify.ready();

    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");

    await fastify.close();
  });

  it("GET / serves the shell normally when isSetupIncomplete is omitted (back-compat default)", async () => {
    const fastify = Fastify();
    registerSpaRoutes(fastify, { distDir: distDir ?? undefined });
    await fastify.ready();

    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);

    await fastify.close();
  });

  it("GET /setup itself is served by the catch-all (never redirected, even when incomplete)", async () => {
    const fastify = Fastify();
    registerSpaRoutes(fastify, { distDir: distDir ?? undefined, isSetupIncomplete: () => true });
    await fastify.ready();

    const res = await fastify.inject({ method: "GET", url: "/setup" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");

    await fastify.close();
  });
});
