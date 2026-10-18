import { describe, expect, it } from "vitest";
import { AVATAR_BAIXO, AVATAR_LARGURA, posicaoDoCanto } from "../posicao.js";

describe("posicaoDoCanto", () => {
  it("sits low in the corner when the action bar ends before the avatar starts", () => {
    const p = posicaoDoCanto({ viewportWidth: 1920, drawerOpen: false });
    expect(p.visivel).toBe(true);
    expect(p.bottom).toBe(AVATAR_BAIXO);
    expect(p.right).toBe(44 + 12);
  });

  it("steps left of the open drawer", () => {
    const p = posicaoDoCanto({ viewportWidth: 1920, drawerOpen: true });
    expect(p.right).toBe(344 + 12);
  });

  it("rises above the action bar when they would collide", () => {
    const p = posicaoDoCanto({ viewportWidth: 1280, drawerOpen: true });
    expect(p.bottom).toBeGreaterThan(AVATAR_BAIXO);
  });

  it("hides when the free area cannot hold the avatar", () => {
    const p = posicaoDoCanto({ viewportWidth: AVATAR_LARGURA, drawerOpen: true });
    expect(p.visivel).toBe(false);
  });
});
