import { describe, expect, it } from "vitest";
import {
  caminhoDeArteValido,
  podeRestaurar,
  precisaConfirmarSubstituicao,
} from "../imagemDoAtor.js";

describe("caminhoDeArteValido", () => {
  it("accepts what the avatar upload returns", () => {
    expect(caminhoDeArteValido("/assets/avatar-token-79449d7e.png")).toBe(true);
  });

  it("refuses everything that would blank or break the actor's art", () => {
    for (const ruim of [
      "",
      " ",
      "/assets/",
      "/assets/undefined",
      "/assets/x.png?g=1",
      "avatar-token-1.png",
      null,
      undefined,
      42,
    ]) {
      expect(caminhoDeArteValido(ruim)).toBe(false);
    }
  });
});

describe("precisaConfirmarSubstituicao", () => {
  it("asks before replacing art the player brought from elsewhere", () => {
    expect(
      precisaConfirmarSubstituicao("/assets/heroictoken_2026-10-04_16-56-12-785db055.png"),
    ).toBe(true);
  });

  it("does not ask when there is nothing real to lose, or it is already avatar art", () => {
    expect(precisaConfirmarSubstituicao("")).toBe(false);
    expect(precisaConfirmarSubstituicao(null)).toBe(false);
    expect(precisaConfirmarSubstituicao("icons/svg/mystery-man.svg")).toBe(false);
    expect(precisaConfirmarSubstituicao("/assets/avatar-token-79449d7e.png")).toBe(false);
    expect(precisaConfirmarSubstituicao("/assets/avatar-retrato-0123456789abcdef.png")).toBe(false);
  });
});

describe("podeRestaurar", () => {
  it("offers the remembered image only when it is a different, real one", () => {
    expect(podeRestaurar("/assets/a.png", "/assets/b.png")).toBe(true);
    expect(podeRestaurar("", "/assets/b.png")).toBe(true);
    expect(podeRestaurar("/assets/b.png", "/assets/b.png")).toBe(false);
    expect(podeRestaurar("/assets/a.png", null)).toBe(false);
    expect(podeRestaurar("/assets/a.png", " ")).toBe(false);
  });
});
