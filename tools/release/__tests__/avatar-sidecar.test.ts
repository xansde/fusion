/**
 * Tests for tools/release/avatar-sidecar.mjs — the avatar acervo shipped NEXT TO
 * the executable instead of inside it (decisoes 2026-10-21, item 10; spec 35 §6.1).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AVATAR_SIDECAR_DIRNAME,
  AVATAR_SIDECAR_STALE_NAMES,
  emitAvatarSidecar,
  renderAvatarLicenses,
} from "../avatar-sidecar.mjs";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-avatar-sidecar-test-"));
  cleanupDirs.push(dir);
  return dir;
}

const CREDITOS = {
  fonte: "Liberated Pixel Cup -- Universal LPC Spritesheet",
  pin: "0f898bb675a1abe16ce430e82e3bf9daed278690",
  url: "https://example.test/lpc",
  autores: ["Alice", "Bob"],
  licencas: { "CC-BY-SA 3.0": 313, CC0: 59 },
  linhas_do_credits_csv: 13497,
};

function makeAcervo(root: string): string {
  const acervo = join(root, "saida");
  mkdirSync(join(acervo, "atlas"), { recursive: true });
  writeFileSync(join(acervo, "catalogo.json"), "{}");
  writeFileSync(join(acervo, "atlas", "body.png"), "png");
  writeFileSync(join(acervo, "creditos.json"), JSON.stringify(CREDITOS));
  return acervo;
}

describe("renderAvatarLicenses", () => {
  it("names the source, the pin, the share-alike rule and every license with its count", () => {
    const text = renderAvatarLicenses(CREDITOS);
    expect(text).toContain("Liberated Pixel Cup");
    expect(text).toContain(CREDITOS.pin);
    expect(text).toContain("CC-BY-SA 3.0");
    expect(text).toContain("313");
    expect(text).toMatch(/share-alike|mesma licen/i);
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
  });

  it("explains how to install the acervo next to the executable", () => {
    expect(renderAvatarLicenses(CREDITOS)).toContain(`${AVATAR_SIDECAR_DIRNAME}/`);
  });

  it("refuses a creditos.json without the fields it needs", () => {
    expect(() => renderAvatarLicenses({})).toThrow(/creditos/i);
  });
});

describe("emitAvatarSidecar (REQ-AVT-069, REQ-LEG-026)", () => {
  it("copies the acervo to <out>/avatar, with LICENSES.txt and the NOTICE beside it", () => {
    const root = makeTempDir();
    const acervo = makeAcervo(root);
    const outDir = join(root, "dist-release");
    mkdirSync(outDir);
    const notice = join(root, "NOTICE");
    writeFileSync(notice, "NOTICE TEXT");

    const result = emitAvatarSidecar({ acervoDir: acervo, outDir, noticePath: notice });

    expect(result.sidecarDir).toBe(join(outDir, "avatar"));
    expect(existsSync(join(outDir, "avatar", "catalogo.json"))).toBe(true);
    expect(existsSync(join(outDir, "avatar", "atlas", "body.png"))).toBe(true);
    expect(readFileSync(join(outDir, "avatar", "creditos.json"), "utf8")).toContain("Alice");
    expect(readFileSync(join(outDir, "avatar", "LICENSES.txt"), "utf8")).toContain("CC-BY-SA 3.0");
    expect(readFileSync(join(outDir, "avatar", "NOTICE"), "utf8")).toBe("NOTICE TEXT");
    expect(readFileSync(join(outDir, "NOTICE"), "utf8")).toBe("NOTICE TEXT");
  });

  it("replaces a previous sidecar instead of merging into it", () => {
    const root = makeTempDir();
    const acervo = makeAcervo(root);
    const outDir = join(root, "dist-release");
    mkdirSync(join(outDir, "avatar"), { recursive: true });
    writeFileSync(join(outDir, "avatar", "stale.txt"), "old");
    const notice = join(root, "NOTICE");
    writeFileSync(notice, "n");

    emitAvatarSidecar({ acervoDir: acervo, outDir, noticePath: notice });

    expect(existsSync(join(outDir, "avatar", "stale.txt"))).toBe(false);
    expect(existsSync(join(outDir, "avatar", "catalogo.json"))).toBe(true);
  });

  it("fails loudly when the acervo has no creditos.json", () => {
    const root = makeTempDir();
    const acervo = join(root, "saida");
    mkdirSync(acervo);
    writeFileSync(join(acervo, "catalogo.json"), "{}");
    const notice = join(root, "NOTICE");
    writeFileSync(notice, "n");
    expect(() =>
      emitAvatarSidecar({ acervoDir: acervo, outDir: join(root, "out"), noticePath: notice }),
    ).toThrow(/creditos\.json/);
  });

  it("fails loudly when the NOTICE is missing", () => {
    const root = makeTempDir();
    const acervo = makeAcervo(root);
    expect(() =>
      emitAvatarSidecar({
        acervoDir: acervo,
        outDir: join(root, "out"),
        noticePath: join(root, "NOPE"),
      }),
    ).toThrow(/NOTICE/);
  });

  it("lists the exact names phase 0 must clean (never a glob)", () => {
    expect(AVATAR_SIDECAR_STALE_NAMES).toEqual(["avatar", "NOTICE"]);
  });
});
