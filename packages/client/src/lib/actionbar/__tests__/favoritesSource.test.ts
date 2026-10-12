/**
 * favoritesSource.test.ts — the in-memory favourites of the first delivery (BAR-F1-04, SCAFFOLDING;
 * spec 53 REQ-BAR-061..066, DEC-BAR-07/08; tasks.md §2.8).
 *
 * Until BAR-F3-01 stores the favourites in the actor, the default tab of the bar still has to be
 * playable. So the source seeds itself from the provider's first entries — strikes, then spells and
 * cantrips, then actions, up to four of each (Q-BAR-02) — and stays in memory. It already has the
 * final interface (`slots / isPinned / pin / unpin / move`), so the bar does not change when the
 * persisted source takes its place.
 */

import { describe, expect, it } from "vitest";

import { FAVORITE_SLOT_COUNT, createFavoritesSource } from "../favoritesSource.js";
import type { ActionBarEntry } from "../types.js";
import { makeEntry } from "./stubProvider.js";

const strikes = ["a", "b", "c", "d", "e"].map((n) => makeEntry(`strike:${n}`, { tab: "strikes" }));
const spells = ["a", "b"].map((n) => makeEntry(`spell:m:${n}`, { tab: "spells" }));
const actions = ["a", "b", "c", "d", "e", "f"].map((n) =>
  makeEntry(`action:${n}`, { tab: "actions" }),
);
const items = [makeEntry("item:potion", { tab: "items" })];
const checks = [makeEntry("check:perception", { tab: "checks" })];

function source(entries: ActionBarEntry[]) {
  return createFavoritesSource("actor-1", () => entries);
}

describe("a semente da primeira abertura", () => {
  it("são 12 posições, sempre", () => {
    expect(FAVORITE_SLOT_COUNT).toBe(12);
    expect(source([]).slots()).toHaveLength(12);
    expect(source([...strikes, ...spells, ...actions]).slots()).toHaveLength(12);
  });

  it("golpes, depois magias e truques, depois ações, até quatro de cada (Q-BAR-02)", () => {
    const slots = source([...actions, ...spells, ...strikes, ...items, ...checks]).slots();

    expect(slots).toEqual([
      "strike:a",
      "strike:b",
      "strike:c",
      "strike:d",
      "spell:m:a",
      "spell:m:b",
      "action:a",
      "action:b",
      "action:c",
      "action:d",
      null,
      null,
    ]);
  });

  it("D-BA08: nada de itens nem testes entra sozinho", () => {
    const slots = source([...items, ...checks]).slots();

    expect(slots.every((slot) => slot === null)).toBe(true);
  });

  it("sem entradas, a linha é de 12 vazios", () => {
    expect(source([]).slots()).toEqual(new Array<null>(12).fill(null));
  });

  it("é recalculada com o que o provedor entrega agora (a ficha pode carregar depois da barra)", () => {
    let current: ActionBarEntry[] = [];
    const favorites = createFavoritesSource("actor-1", () => current);
    expect(favorites.slots().every((slot) => slot === null)).toBe(true);

    current = [...strikes];

    expect(favorites.slots()[0]).toBe("strike:a");
  });
});

describe("pin / unpin / isPinned", () => {
  it("fixa no primeiro slot vazio", () => {
    const favorites = source([...strikes.slice(0, 2)]);

    expect(favorites.pin("item:potion")).toBe(true);

    expect(favorites.slots()[2]).toBe("item:potion");
    expect(favorites.isPinned("item:potion")).toBe(true);
  });

  it("fixar o que já está fixado não duplica nem muda de lugar", () => {
    const favorites = source([...strikes.slice(0, 2)]);

    expect(favorites.pin("strike:b")).toBe(true);

    expect(favorites.slots().filter((slot) => slot === "strike:b")).toHaveLength(1);
    expect(favorites.slots()[1]).toBe("strike:b");
  });

  it("12 de 12: não cabe mais e devolve false", () => {
    const favorites = source([]);
    for (let i = 0; i < 12; i += 1) expect(favorites.pin(`action:n${String(i)}`)).toBe(true);

    expect(favorites.pin("action:extra")).toBe(false);
    expect(favorites.isPinned("action:extra")).toBe(false);
  });

  it("desafixar deixa o buraco no lugar, sem puxar os outros", () => {
    const favorites = source([...strikes.slice(0, 3)]);

    favorites.unpin("strike:b");

    expect(favorites.slots().slice(0, 3)).toEqual(["strike:a", null, "strike:c"]);
    expect(favorites.isPinned("strike:b")).toBe(false);
  });

  it("a mudança do usuário vale daí em diante, mesmo que o provedor passe a entregar outra coisa", () => {
    let current = [...strikes.slice(0, 2)];
    const favorites = createFavoritesSource("actor-1", () => current);
    favorites.pin("item:potion");

    current = [...actions];

    expect(favorites.slots().slice(0, 3)).toEqual(["strike:a", "strike:b", "item:potion"]);
  });
});

describe("move", () => {
  it("move para um slot vazio", () => {
    const favorites = source([...strikes.slice(0, 2)]);

    favorites.move(0, 5);

    expect(favorites.slots()[0]).toBeNull();
    expect(favorites.slots()[5]).toBe("strike:a");
  });

  it("soltar em slot ocupado troca os dois", () => {
    const favorites = source([...strikes.slice(0, 2)]);

    favorites.move(0, 1);

    expect(favorites.slots().slice(0, 2)).toEqual(["strike:b", "strike:a"]);
  });

  it("posição fora da linha, ou a mesma, não faz nada", () => {
    const favorites = source([...strikes.slice(0, 2)]);
    const before = [...favorites.slots()];

    favorites.move(-1, 3);
    favorites.move(0, 12);
    favorites.move(1, 1);
    favorites.move(0.5, 2);

    expect(favorites.slots()).toEqual(before);
  });
});

describe("independência", () => {
  it("duas fontes (dois atores) não dividem estado", () => {
    const a = createFavoritesSource("actor-a", () => [...strikes]);
    const b = createFavoritesSource("actor-b", () => [...strikes]);

    a.unpin("strike:a");

    expect(b.isPinned("strike:a")).toBe(true);
  });

  it("slots() devolve uma cópia: quem a altera não mexe na fonte", () => {
    const favorites = source([...strikes.slice(0, 1)]);

    (favorites.slots() as (string | null)[])[0] = "strike:hack";

    expect(favorites.slots()[0]).toBe("strike:a");
  });
});
