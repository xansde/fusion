/**
 * Tests for the avatar painter's resource handling.
 *
 * The bug these pin down: a dressed character has one atlas PER LAYER (19 for a
 * sixteen-slot outfit), while the decoded-atlas LRU keeps 8. The painter used to
 * look the atlas up on every frame, so on every frame most layers were "not
 * loaded yet", got re-requested, evicted the others, and drew next frame instead
 * — the figure blinked layer by layer forever, and the still render behind
 * "Usar como token" gave up after 120 tries with layers missing.
 *
 * The browser bits (Image, canvas) are replaced by recording fakes: what is
 * asserted is how many layers reach the target canvas on each call, which is
 * exactly what the player sees.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { montarCamadas } from "waybuilder-avatar";
import type { Catalogo, Selecao } from "waybuilder-avatar";
import { framesDaCamada } from "../desenhar.js";

const require = createRequire(import.meta.url);
const dirAcervo = dirname(require.resolve("waybuilder-avatar/catalogo.json"));
const catalogo = JSON.parse(readFileSync(join(dirAcervo, "catalogo.json"), "utf8")) as Catalogo;

/** A realistic, heavily dressed character: one piece in each of sixteen slots. */
function selecaoPesada(corpo: string): Selecao {
  const slots = [
    "shadow",
    "body",
    "head",
    "eyes",
    "hair",
    "clothes",
    "legs",
    "shoes",
    "hat",
    "weapon",
    "cape",
    "belt",
    "shield",
    "gloves",
    "beard",
    "necklace",
  ];
  const selecao: Selecao = {};
  for (const slot of slots) {
    const item = catalogo.itens.find((i) => i.slot === slot && !(i.sem_arte ?? []).includes(corpo));
    if (item !== undefined) selecao[slot] = { id: item.id };
  }
  return selecao;
}

// ---------------------------------------------------------------------------
// Browser fakes
// ---------------------------------------------------------------------------

interface CtxFalso {
  canvas: { width: number; height: number };
  imageSmoothingEnabled: boolean;
  desenhos: number;
  clearRect: () => void;
  drawImage: () => void;
  getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
  putImageData: () => void;
}

function ctxFalso(canvas: { width: number; height: number }): CtxFalso {
  const ctx: CtxFalso = {
    canvas,
    imageSmoothingEnabled: true,
    desenhos: 0,
    clearRect: () => {
      ctx.desenhos = 0;
    },
    drawImage: () => {
      ctx.desenhos++;
    },
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
  };
  return ctx;
}

let imagensPedidas = 0;

beforeEach(() => {
  imagensPedidas = 0;
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        imagensPedidas++;
        // Decoding is asynchronous in a browser too.
        setTimeout(() => this.onload?.(), 0);
      }
    },
  );
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ctxFalso(canvas) };
      return canvas;
    },
  });
  vi.stubGlobal("fetch", async (url: string) => {
    const relativo = url.replace(/^\/avatar\//, "");
    try {
      const texto = readFileSync(join(dirAcervo, relativo), "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(texto) as unknown };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
});

afterEach(async () => {
  const { liberarPixelsDoAvatar } = await import("../desenhar.js");
  liberarPixelsDoAvatar();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("framesDaCamada", () => {
  it("lists each frame the cycle visits once, clamped to what the layer has", () => {
    expect(framesDaCamada([0, 0, 1, 1], 2)).toEqual([0, 1]);
    expect(framesDaCamada([1, 2, 3, 4, 5, 6, 7, 8], 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // A substituted animation has a single frame and must stay on it.
    expect(framesDaCamada([1, 2, 3], 1)).toEqual([0]);
    expect(framesDaCamada([0, 5], 3)).toEqual([0, 2]);
  });
});

describe("desenharAvatar with more atlases than the decoded-atlas cache holds", () => {
  const corpo = "male";
  const selecao = selecaoPesada(corpo);
  const camadas = montarCamadas(catalogo, selecao, corpo, "idle").camadas;

  it("the fixture really exceeds the cache (otherwise the test proves nothing)", () => {
    expect(new Set(camadas.map((c) => c.arq)).size).toBeGreaterThan(8);
  });

  it("draws every layer on every frame of the loop, with no layer blinking out", async () => {
    const { desenharAvatar, prepararAvatar } = await import("../desenhar.js");
    const pronto = await prepararAvatar(catalogo, selecao, corpo, "idle");
    const pedidasAoPreparar = imagensPedidas;
    const alvo = ctxFalso({ width: 192, height: 192 });

    for (let t = 0; t < 2000; t += 16) {
      const faltando = desenharAvatar(alvo as unknown as CanvasRenderingContext2D, pronto, t, 3);
      expect(faltando).toBe(0);
      expect(alvo.desenhos).toBe(camadas.length);
    }
    // And the loop itself never goes back to the network/decoder.
    expect(imagensPedidas).toBe(pedidasAoPreparar);
  });

  it("a still sprite is whole on its first paint", async () => {
    const { desenharAvatar, prepararAvatar } = await import("../desenhar.js");
    const pronto = await prepararAvatar(catalogo, selecao, corpo, "idle", { parado: true });
    const alvo = ctxFalso({ width: 128, height: 128 });
    expect(desenharAvatar(alvo as unknown as CanvasRenderingContext2D, pronto, 0, 2)).toBe(0);
    expect(alvo.desenhos).toBe(camadas.length);
  });

  it("an avatar prepared earlier still draws whole after other avatars churned the caches", async () => {
    const { desenharAvatar, prepararAvatar } = await import("../desenhar.js");
    const pronto = await prepararAvatar(catalogo, selecao, corpo, "idle");
    // The creator grid: dozens of other compositions warming other atlases.
    for (const item of catalogo.itens.filter((i) => i.slot === "hair").slice(0, 20)) {
      await prepararAvatar(catalogo, { ...selecao, hair: { id: item.id } }, corpo, "idle", {
        parado: true,
      });
    }
    const alvo = ctxFalso({ width: 192, height: 192 });
    expect(desenharAvatar(alvo as unknown as CanvasRenderingContext2D, pronto, 500, 3)).toBe(0);
    expect(alvo.desenhos).toBe(camadas.length);
  });
});

describe("chaveDoAvatar", () => {
  it("is equal for equal content regardless of object identity or key order", async () => {
    const { chaveDoAvatar } = await import("../desenhar.js");
    const a = chaveDoAvatar(
      { body: { id: "b" }, hair: { id: "h", cores: { cor: "x", y: "z" } } },
      "male",
      "idle",
      false,
    );
    const b = chaveDoAvatar(
      { hair: { id: "h", cores: { y: "z", cor: "x" } }, body: { id: "b" } },
      "male",
      "idle",
      false,
    );
    expect(a).toBe(b);
  });

  it("changes with any piece, colour, body, animation or still-ness", async () => {
    const { chaveDoAvatar } = await import("../desenhar.js");
    const base = chaveDoAvatar({ body: { id: "b" } }, "male", "idle", false);
    expect(chaveDoAvatar({ body: { id: "c" } }, "male", "idle", false)).not.toBe(base);
    expect(
      chaveDoAvatar({ body: { id: "b", cores: { cor: "x" } } }, "male", "idle", false),
    ).not.toBe(base);
    expect(chaveDoAvatar({ body: { id: "b" } }, "female", "idle", false)).not.toBe(base);
    expect(chaveDoAvatar({ body: { id: "b" } }, "male", "walk", false)).not.toBe(base);
    expect(chaveDoAvatar({ body: { id: "b" } }, "male", "idle", true)).not.toBe(base);
  });
});
