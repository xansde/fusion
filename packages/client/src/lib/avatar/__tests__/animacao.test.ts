/**
 * Tests for the avatar's frame timing.
 *
 * The cycle is not `0..n` and that is the whole point: `walk` starts at frame 1
 * because frame 0 is the standing pose, and `idle` holds each pose for two ticks.
 * Getting this wrong produces a hitch once per lap — visible, and the kind of
 * thing nobody can debug by staring at a sprite.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Catalogo } from "waybuilder-avatar";
import {
  ANIMACAO_COMBATE,
  ANIMACAO_PADRAO,
  animacaoDisponivel,
  cicloDe,
  fpsDe,
  frameEm,
  ladoDoQuadro,
} from "../animacao.js";

function lerCatalogo(): Catalogo {
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve("waybuilder-avatar/catalogo.json"));
  return JSON.parse(readFileSync(join(dir, "catalogo.json"), "utf8")) as Catalogo;
}

const catalogo = lerCatalogo();

/** A catalog cut without the optional timing fields (an older acervo). */
const antigo = {
  ...catalogo,
  recorte: { ...catalogo.recorte, ciclos: undefined, fps: undefined },
} as unknown as Catalogo;

describe("cicloDe", () => {
  it("reads the acervo's own cycles", () => {
    expect(cicloDe(catalogo, "idle")).toEqual([0, 0, 1, 1]);
    expect(cicloDe(catalogo, "walk")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("holds a still frame for an unknown animation or an older acervo", () => {
    // Inventing 0..n would animate a strip in an order nobody authored.
    expect(cicloDe(catalogo, "dance")).toEqual([0]);
    expect(cicloDe(antigo, "walk")).toEqual([0]);
  });
});

describe("fpsDe / ladoDoQuadro", () => {
  it("takes the catalog's values", () => {
    expect(fpsDe(catalogo)).toBe(8);
    expect(ladoDoQuadro(catalogo)).toBe(64);
  });

  it("falls back to the generator's own defaults", () => {
    expect(fpsDe(antigo)).toBe(8);
    expect(ladoDoQuadro(antigo)).toBe(64);
  });
});

describe("frameEm", () => {
  const idle = [0, 0, 1, 1];

  it("walks the cycle at the given fps and loops", () => {
    // 8 fps → one step every 125 ms
    expect(frameEm(0, idle, 8)).toBe(0);
    expect(frameEm(124, idle, 8)).toBe(0);
    expect(frameEm(250, idle, 8)).toBe(1);
    expect(frameEm(375, idle, 8)).toBe(1);
    expect(frameEm(500, idle, 8)).toBe(0); // lap
    expect(frameEm(500 + 250, idle, 8)).toBe(1);
  });

  it("emits the cycle's frames, not the tick index", () => {
    const walk = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(frameEm(0, walk, 8)).toBe(1); // never frame 0 — that is standing still
    expect(frameEm(875, walk, 8)).toBe(8);
    expect(frameEm(1000, walk, 8)).toBe(1);
  });

  it("pins a substituted piece to its only frame", () => {
    // A piece drawn with `frames: 1` must not follow the cycle into the art of
    // whatever sits next to it in the strip.
    const walk = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(frameEm(875, walk, 8, 1)).toBe(0);
    expect(frameEm(875, walk, 8, 3)).toBe(2); // clamped, not wrapped
  });

  it("survives degenerate inputs", () => {
    expect(frameEm(-500, idle, 8)).toBe(0);
    expect(frameEm(1000, [], 8)).toBe(0);
    expect(frameEm(1000, idle, 0)).toBe(0);
  });
});

describe("animacaoDisponivel", () => {
  it("prefers the first animation the acervo actually has", () => {
    expect(animacaoDisponivel(catalogo, ANIMACAO_COMBATE, ANIMACAO_PADRAO)).toBe("combat_idle");
    expect(animacaoDisponivel(catalogo, "breakdance", ANIMACAO_PADRAO)).toBe("idle");
  });

  it("falls back to whatever exists when nothing preferred does", () => {
    const cortado = { ...catalogo, recorte: { ...catalogo.recorte, animacoes: ["sit"] } };
    expect(animacaoDisponivel(cortado, ANIMACAO_COMBATE, ANIMACAO_PADRAO)).toBe("sit");
  });
});
