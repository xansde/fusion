import { describe, expect, it } from "vitest";
import { caixaDaFigura, planoDaMiniatura } from "../miniatura.js";

/** An RGBA buffer `w`x`h` with the given opaque rectangle. */
function pixels(w: number, h: number, rect: { x: number; y: number; w: number; h: number } | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (rect !== null) {
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) data[(y * w + x) * 4 + 3] = 255;
  }
  return data;
}

describe("caixaDaFigura", () => {
  it("finds the bounding box of the opaque pixels", () => {
    const box = caixaDaFigura(pixels(64, 64, { x: 20, y: 8, w: 24, h: 50 }), 64, 64);
    expect(box).toEqual({ x: 20, y: 8, w: 24, h: 50 });
  });

  it("is null for an empty frame", () => {
    expect(caixaDaFigura(pixels(64, 64, null), 64, 64)).toBeNull();
  });
});

describe("planoDaMiniatura", () => {
  const caixa = { x: 20, y: 8, w: 24, h: 50 };

  it("token: a square around the whole figure, integer scale, centred in the target", () => {
    const p = planoDaMiniatura(caixa, { modo: "token", alvo: 256, quadro: 64 });
    // 50 tall + 2px padding each side = 54 -> floor(256/54) = 4
    expect(p.escala).toBe(4);
    expect(p.lado).toBe(54);
    expect(p.dx).toBe((256 - 54 * 4) / 2);
    expect(p.dy).toBe((256 - 54 * 4) / 2);
    // The source square is centred on the figure and stays inside the frame.
    expect(p.sx).toBeGreaterThanOrEqual(0);
    expect(p.sy).toBeGreaterThanOrEqual(0);
    expect(p.sx + p.lado).toBeLessThanOrEqual(64);
    expect(p.sy + p.lado).toBeLessThanOrEqual(64);
  });

  it("retrato: only the upper part of the figure (bust)", () => {
    const token = planoDaMiniatura(caixa, { modo: "token", alvo: 256, quadro: 64 });
    const retrato = planoDaMiniatura(caixa, { modo: "retrato", alvo: 256, quadro: 64 });
    expect(retrato.lado).toBeLessThan(token.lado);
    expect(retrato.escala).toBeGreaterThan(token.escala);
    // The bust starts at the top of the figure.
    expect(retrato.sy).toBeLessThanOrEqual(caixa.y);
  });

  it("never picks a scale below 1", () => {
    const p = planoDaMiniatura({ x: 0, y: 0, w: 64, h: 64 }, { modo: "token", alvo: 32, quadro: 64 });
    expect(p.escala).toBe(1);
  });
});
