import { describe, expect, it } from "vitest";
import {
  AVATAR_BAIXO,
  AVATAR_FOLGA,
  AVATAR_TOPO,
  AVATAR_ESQUERDA,
  ALTURA_BARRA_ACOES,
  posicaoDoAvatar,
  type EntradaPosicao,
} from "../posicao.js";
import { ACTION_BAR_BOTTOM_OFFSET } from "../../actionbar/layout.js";

function entrada(extra: Partial<EntradaPosicao> = {}): EntradaPosicao {
  return {
    viewportWidth: 1920,
    viewportHeight: 1080,
    drawerOpen: false,
    tamanho: 192,
    canto: "inferior-direito",
    livre: null,
    ...extra,
  };
}

describe("posicaoDoAvatar — corners", () => {
  it("bottom-right: low in the corner, left of the closed drawer, when the bar ends before it", () => {
    const p = posicaoDoAvatar(entrada());
    expect(p.visivel).toBe(true);
    expect(p.left).toBe(1920 - 44 - AVATAR_FOLGA - 192);
    expect(p.top).toBe(1080 - AVATAR_BAIXO - 192);
  });

  it("steps left of the open drawer", () => {
    const p = posicaoDoAvatar(entrada({ drawerOpen: true }));
    expect(p.left).toBe(1920 - 344 - AVATAR_FOLGA - 192);
  });

  it("rises above the action bar when they would collide", () => {
    const p = posicaoDoAvatar(entrada({ viewportWidth: 1280, drawerOpen: true }));
    expect(p.top).toBe(1080 - (ACTION_BAR_BOTTOM_OFFSET + ALTURA_BARRA_ACOES + AVATAR_FOLGA) - 192);
  });

  it("bottom-left stays clear of the scene tools and of the bar", () => {
    const p = posicaoDoAvatar(entrada({ canto: "inferior-esquerdo" }));
    expect(p.left).toBe(AVATAR_ESQUERDA);
    expect(p.top).toBe(1080 - AVATAR_BAIXO - 192);
  });

  it("top corners sit under the header", () => {
    const d = posicaoDoAvatar(entrada({ canto: "superior-direito" }));
    expect(d.top).toBe(AVATAR_TOPO);
    expect(d.left).toBe(1920 - 44 - AVATAR_FOLGA - 192);
    const e = posicaoDoAvatar(entrada({ canto: "superior-esquerdo" }));
    expect(e.top).toBe(AVATAR_TOPO);
    expect(e.left).toBe(AVATAR_ESQUERDA);
  });

  it("the size changes the box it places", () => {
    const p = posicaoDoAvatar(entrada({ tamanho: 64 }));
    expect(p.left).toBe(1920 - 44 - AVATAR_FOLGA - 64);
    expect(p.top).toBe(1080 - AVATAR_BAIXO - 64);
  });
});

describe("posicaoDoAvatar — dragged position", () => {
  it("keeps a free position, stored as a fraction of the viewport", () => {
    const p = posicaoDoAvatar(entrada({ livre: { x: 0.25, y: 0.3 } }));
    expect(p.left).toBe(480);
    expect(p.top).toBe(324);
  });

  it("never leaves the viewport nor goes under the drawer or the header", () => {
    const fora = posicaoDoAvatar(entrada({ livre: { x: 2, y: 2 }, drawerOpen: true }));
    expect(fora.left).toBe(1920 - 344 - 192);
    expect(fora.top + 192).toBeLessThanOrEqual(1080);
    const antes = posicaoDoAvatar(entrada({ livre: { x: -1, y: -1 } }));
    expect(antes.left).toBe(0);
    expect(antes.top).toBe(AVATAR_TOPO);
  });

  it("is lifted above the action bar when dropped over it", () => {
    // Middle of the screen, at the very bottom: right on top of the bar.
    const p = posicaoDoAvatar(entrada({ livre: { x: 0.45, y: 0.95 } }));
    expect(p.top + 192).toBeLessThanOrEqual(1080 - (ACTION_BAR_BOTTOM_OFFSET + ALTURA_BARRA_ACOES));
  });
});

describe("posicaoDoAvatar — the bar as measured on screen", () => {
  it("uses the real bar rectangle when given (it is taller than the estimate with its tab row)", () => {
    const barra = { left: 160, right: 940, top: 708 };
    const p = posicaoDoAvatar(entrada({ livre: { x: 0.3, y: 0.9 }, barra }));
    expect(p.top + 192).toBeLessThanOrEqual(708 - AVATAR_FOLGA);
    const canto = posicaoDoAvatar(entrada({ canto: "inferior-esquerdo", barra }));
    expect(canto.top + 192).toBeLessThanOrEqual(708 - AVATAR_FOLGA);
  });

  it("with no bar on screen (null), nothing is lifted", () => {
    const p = posicaoDoAvatar(entrada({ viewportWidth: 1280, drawerOpen: true, barra: null }));
    expect(p.top).toBe(1080 - AVATAR_BAIXO - 192);
  });

  it("a box beside the bar is not lifted", () => {
    const barra = { left: 160, right: 940, top: 708 };
    const p = posicaoDoAvatar(entrada({ barra }));
    expect(p.top).toBe(1080 - AVATAR_BAIXO - 192);
  });
});

describe("posicaoDoAvatar — visibility", () => {
  it("hides when the viewer turned it off", () => {
    expect(posicaoDoAvatar(entrada({ oculto: true })).visivel).toBe(false);
  });

  it("hides when the free area cannot hold the avatar", () => {
    expect(posicaoDoAvatar(entrada({ viewportWidth: 192, drawerOpen: true })).visivel).toBe(false);
  });
});
