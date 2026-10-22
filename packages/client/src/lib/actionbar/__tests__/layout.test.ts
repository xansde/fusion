/**
 * layout.test.ts — where the action bar sits and when it folds itself (BAR-F1-04; spec 53
 * REQ-BAR-022, REQ-BAR-025; tasks.md §2.7).
 *
 * The bar is centred in the FREE area — the strip between the left edge and the side drawer —
 * not in the viewport, and it folds to its status strip when that area drops under ~1000 px. The
 * drawer is 44 px (rail only) when closed and 344 px (rail + panel) when open, except under
 * 900 px where an open drawer takes everything left of the rail (REQ-GAV-040).
 */

import { describe, expect, it } from "vitest";

import {
  ACTION_BAR_BOTTOM_OFFSET,
  ACTION_BAR_COLLAPSE_BELOW,
  ACTION_BAR_MAX_WIDTH,
  ACTION_BAR_FLOAT_GAP,
  ACTION_BAR_STACK_GAP,
  clearanceAboveBar,
  computeBarLayout,
  menuOriginAboveBar,
  tooltipOffsetAboveBar,
} from "../layout.js";
import { drawerWidth } from "../../sidebar/drawerLayout.svelte.js";

describe("computeBarLayout — centrada na área livre (REQ-BAR-022)", () => {
  it("gaveta fechada: a área livre é a tela menos o trilho de 44 px", () => {
    const layout = computeBarLayout({ viewportWidth: 1400, drawerOpen: false });

    expect(layout.drawerWidth).toBe(44);
    expect(layout.freeWidth).toBe(1356);
    expect(layout.centerX).toBe(678);
  });

  it("gaveta aberta: a área livre perde 344 px e o centro anda junto", () => {
    const layout = computeBarLayout({ viewportWidth: 1400, drawerOpen: true });

    expect(layout.drawerWidth).toBe(344);
    expect(layout.freeWidth).toBe(1056);
    expect(layout.centerX).toBe(528);
  });

  it("o centro é o da área livre, não o da tela (a barra não fica sob a gaveta)", () => {
    const open = computeBarLayout({ viewportWidth: 1600, drawerOpen: true });

    expect(open.centerX).not.toBe(1600 / 2);
    expect(open.centerX).toBe((1600 - 344) / 2);
  });

  it("a largura é a do protótipo: 780 px, ou a área livre menos 24 px quando ela é menor", () => {
    expect(ACTION_BAR_MAX_WIDTH).toBe(780);
    expect(computeBarLayout({ viewportWidth: 1920, drawerOpen: false }).width).toBe(780);
    // 1000 px de tela com a gaveta aberta: 1000 − 344 = 656 de área livre.
    expect(computeBarLayout({ viewportWidth: 1000, drawerOpen: true }).width).toBe(656 - 24);
  });

  it("a largura nunca fica negativa, nem com a gaveta engolindo a tela", () => {
    const layout = computeBarLayout({ viewportWidth: 20, drawerOpen: true });

    expect(layout.width).toBeGreaterThanOrEqual(0);
    expect(layout.freeWidth).toBeGreaterThanOrEqual(0);
  });
});

describe("computeBarLayout — recolhe sozinha abaixo de ~1000 px de área livre (REQ-BAR-025)", () => {
  it("o limiar é 1000 px de ÁREA LIVRE", () => {
    expect(ACTION_BAR_COLLAPSE_BELOW).toBe(1000);
  });

  it("999 px de área livre recolhe; 1000 px não", () => {
    // Gaveta fechada: livre = tela − 44.
    expect(computeBarLayout({ viewportWidth: 1043, drawerOpen: false }).narrow).toBe(true);
    expect(computeBarLayout({ viewportWidth: 1044, drawerOpen: false }).narrow).toBe(false);
  });

  it("a mesma tela recolhe com a gaveta aberta e não recolhe com ela fechada", () => {
    expect(computeBarLayout({ viewportWidth: 1200, drawerOpen: false }).narrow).toBe(false);
    expect(computeBarLayout({ viewportWidth: 1200, drawerOpen: true }).narrow).toBe(true);
  });

  it("abaixo de 900 px a gaveta aberta toma a tela inteira: não sobra área livre e a barra recolhe", () => {
    const layout = computeBarLayout({ viewportWidth: 800, drawerOpen: true });

    expect(layout.drawerWidth).toBe(800);
    expect(layout.freeWidth).toBe(0);
    expect(layout.narrow).toBe(true);
  });

  it("o estreito vale para a tela fracionária também (899,9 px é abaixo de 900)", () => {
    expect(computeBarLayout({ viewportWidth: 899.9, drawerOpen: true }).freeWidth).toBe(0);
    expect(computeBarLayout({ viewportWidth: 900, drawerOpen: true }).freeWidth).toBe(556);
  });
});

describe("a posição vertical", () => {
  it("fica a 14 px do rodapé, como no protótipo", () => {
    expect(ACTION_BAR_BOTTOM_OFFSET).toBe(14);
  });
});

describe("clearanceAboveBar — o aviso de cena fica acima da barra (REQ-BAR-022)", () => {
  it("sem barra desenhada o aviso não sobe: zero", () => {
    expect(clearanceAboveBar(0)).toBe(0);
    expect(clearanceAboveBar(-5)).toBe(0);
    expect(clearanceAboveBar(Number.NaN)).toBe(0);
  });

  it("com barra: a altura dela, mais a distância dela ao rodapé, mais um respiro", () => {
    expect(ACTION_BAR_STACK_GAP).toBe(8);
    expect(clearanceAboveBar(200)).toBe(200 + ACTION_BAR_BOTTOM_OFFSET + ACTION_BAR_STACK_GAP);
  });

  it("altura fracionária arredonda para cima (nunca encosta)", () => {
    expect(clearanceAboveBar(120.2)).toBe(121 + ACTION_BAR_BOTTOM_OFFSET + ACTION_BAR_STACK_GAP);
  });

  it("a barra recolhida (só a faixa) pede menos que a aberta", () => {
    expect(clearanceAboveBar(64)).toBeLessThan(clearanceAboveBar(190));
  });
});

describe("tooltip e menu abrem ACIMA da barra inteira (protótipo T1)", () => {
  it("o respiro é de 6 px", () => {
    expect(ACTION_BAR_FLOAT_GAP).toBe(6);
  });

  it("o tooltip sobe do slot até a borda de cima da barra, mais o respiro: não cobre a faixa de estado", () => {
    // O slot de Favoritos está 118 px abaixo da borda de cima da barra (faixa + abas).
    expect(tooltipOffsetAboveBar(818, 700)).toBe(118 + ACTION_BAR_FLOAT_GAP);
    // Mais fundo na barra, mais alto o tooltip.
    expect(tooltipOffsetAboveBar(840, 700)).toBeGreaterThan(tooltipOffsetAboveBar(818, 700));
  });

  it("nunca menos que o respiro, nem com medidas absurdas", () => {
    expect(tooltipOffsetAboveBar(700, 700)).toBe(ACTION_BAR_FLOAT_GAP);
    expect(tooltipOffsetAboveBar(650, 700)).toBe(ACTION_BAR_FLOAT_GAP);
  });

  it("arredonda para o pixel (nunca encosta por fração)", () => {
    expect(tooltipOffsetAboveBar(818.4, 700)).toBe(118 + ACTION_BAR_FLOAT_GAP);
    expect(tooltipOffsetAboveBar(818.6, 700)).toBe(119 + ACTION_BAR_FLOAT_GAP);
  });

  it("o menu abre para cima a partir de um ponto logo acima da borda da barra", () => {
    expect(menuOriginAboveBar(700)).toBe(700 - ACTION_BAR_FLOAT_GAP);
  });
});

describe("drawerWidth — a largura que a gaveta cobre (REQ-GAV-012, REQ-GAV-040)", () => {
  it("fechada: só o trilho", () => {
    expect(drawerWidth(false, 1280)).toBe(44);
    expect(drawerWidth(false, 600)).toBe(44);
  });

  it("aberta numa tela larga: trilho de 44 px mais painel de 300 px", () => {
    expect(drawerWidth(true, 1280)).toBe(344);
    expect(drawerWidth(true, 900)).toBe(344);
  });

  it("aberta abaixo de 900 px: toma a tela inteira", () => {
    expect(drawerWidth(true, 899.98)).toBe(899.98);
    expect(drawerWidth(true, 480)).toBe(480);
  });
});
