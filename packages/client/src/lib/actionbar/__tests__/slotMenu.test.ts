/**
 * slotMenu.test.ts — the right-click menu of a slot (BAR-F1-04, BAR-F3-01; spec 53 REQ-BAR-045,
 * REQ-BAR-063, REQ-BAR-066).
 *
 * "Abrir na ficha" (BAR-F1-04) and the minimal pin and unpin (BAR-F3-01): "Fixar nos Favoritos" on an
 * entry that is not in the row, "Desafixar" on one that is — in the Favorites row, in a tab, and on
 * an orphan. The full menu (variants, "Ver detalhes") and drag and drop were cut (D-BA16). Each
 * later item is APPENDED after the ones before it, so a task that adds one edits the end of the
 * list and the end of `runSlotMenuItem` and nothing else.
 */

import { describe, expect, it, vi } from "vitest";

import "../../i18n/index.js";
import { flattenMenu } from "../../ui/menu.js";
import { orphanEntry } from "../orphan.js";
import {
  OPEN_SHEET_ITEM,
  PIN_ITEM,
  UNPIN_ITEM,
  runSlotMenuItem,
  slotMenuItems,
} from "../slotMenu.js";
import { memoryFavorites as favoritesOver } from "./memoryFavorites.js";
import { makeEntry } from "./stubProvider.js";

const emptyRow = (): Array<string | null> => new Array<string | null>(12).fill(null);
const fullRow = (): string[] =>
  Array.from({ length: 12 }, (_, index) => `action:n${String(index)}`);

describe("slotMenuItems", () => {
  it("oferece Abrir na ficha", () => {
    const items = flattenMenu(slotMenuItems(makeEntry("strike:a")));

    expect(items.map((item) => item.id)).toEqual([OPEN_SHEET_ITEM]);
    expect(items[0]?.label).toBe("Abrir na ficha");
  });

  it("o item nunca vem desabilitado: abrir a ficha vale para qualquer entrada, esmaecida ou não", () => {
    const faded = makeEntry("action:a", { state: "unavailable", reason: "x" });

    for (const item of flattenMenu(slotMenuItems(faded))) expect(item.disabled).not.toBe(true);
  });
});

describe("slotMenuItems — Fixar e Desafixar (BAR-F3-01)", () => {
  it("uma entrada de aba que não está nos Favoritos oferece 'Fixar nos Favoritos', depois de Abrir na ficha", () => {
    const source = favoritesOver(emptyRow());

    const items = flattenMenu(slotMenuItems(makeEntry("strike:a"), { favorites: source }));

    expect(items.map((item) => item.id)).toEqual([OPEN_SHEET_ITEM, PIN_ITEM]);
    expect(items[1]?.label).toBe("Fixar nos Favoritos");
    expect(items[1]?.disabled).not.toBe(true);
  });

  it("uma entrada que já está nos Favoritos oferece 'Desafixar' (na linha de Favoritos e na aba, é o mesmo menu)", () => {
    const source = favoritesOver(["strike:a", ...emptyRow().slice(1)]);

    const items = flattenMenu(slotMenuItems(makeEntry("strike:a"), { favorites: source }));

    expect(items.map((item) => item.id)).toEqual([OPEN_SHEET_ITEM, UNPIN_ITEM]);
    expect(items[1]?.label).toBe("Desafixar");
  });

  it("um favorito órfão oferece Desafixar — é a única saída dele (REQ-BAR-066)", () => {
    const source = favoritesOver(["item:vendido", ...emptyRow().slice(1)]);

    const items = flattenMenu(slotMenuItems(orphanEntry("item:vendido"), { favorites: source }));

    expect(items.map((item) => item.id)).toContain(UNPIN_ITEM);
    expect(items.map((item) => item.id)).not.toContain(PIN_ITEM);
  });

  it("12 de 12: 'Fixar' fica na tela, esmaecido, com o motivo — e Desafixar de quem está na linha segue livre", () => {
    const source = favoritesOver(fullRow());

    const notPinned = flattenMenu(slotMenuItems(makeEntry("strike:novo"), { favorites: source }));
    const pinned = flattenMenu(slotMenuItems(makeEntry("action:n3"), { favorites: source }));

    const pin = notPinned.find((item) => item.id === PIN_ITEM);
    expect(pin?.disabled).toBe(true);
    expect(pin?.reason).toBe("Favoritos cheios (12 de 12). Desafixe um para abrir lugar.");
    expect(pinned.find((item) => item.id === UNPIN_ITEM)?.disabled).not.toBe(true);
  });

  it("sem a fonte de favoritos o menu é só Abrir na ficha (quem monta o menu pode não ter favoritos)", () => {
    expect(flattenMenu(slotMenuItems(makeEntry("strike:a"))).map((item) => item.id)).toEqual([
      OPEN_SHEET_ITEM,
    ]);
  });

  it("os ids dos itens são únicos no menu", () => {
    const source = favoritesOver(emptyRow());
    const ids = flattenMenu(slotMenuItems(makeEntry("strike:a"), { favorites: source })).map(
      (item) => item.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("runSlotMenuItem", () => {
  it("Abrir na ficha abre a ficha do ator da barra", () => {
    const openActorSheet = vi.fn();

    runSlotMenuItem(OPEN_SHEET_ITEM, { actorId: "actor-1", services: { openActorSheet } });

    expect(openActorSheet).toHaveBeenCalledExactlyOnceWith("actor-1");
  });

  it("um item que este menu não oferece não faz nada", () => {
    const openActorSheet = vi.fn();

    runSlotMenuItem("map:1", { actorId: "actor-1", services: { openActorSheet } });
    runSlotMenuItem("", { actorId: "actor-1", services: { openActorSheet } });

    expect(openActorSheet).not.toHaveBeenCalled();
  });
});

describe("runSlotMenuItem — Fixar e Desafixar (BAR-F3-01)", () => {
  const services = () => ({ openActorSheet: vi.fn(), notify: vi.fn() });

  it("Fixar fixa a entrada do slot na fonte de favoritos, sem avisar nada", () => {
    const source = favoritesOver(emptyRow());
    const s = services();

    runSlotMenuItem(PIN_ITEM, {
      actorId: "actor-1",
      services: s,
      entry: makeEntry("spell:m:heal"),
      favorites: source,
    });

    expect(source.calls.pin).toEqual(["spell:m:heal"]);
    expect(source.isPinned("spell:m:heal")).toBe(true);
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.openActorSheet).not.toHaveBeenCalled();
  });

  it("Fixar com os 12 cheios é recusado com o aviso da faixa, e a linha não muda", () => {
    const source = favoritesOver(fullRow());
    const s = services();

    runSlotMenuItem(PIN_ITEM, {
      actorId: "actor-1",
      services: s,
      entry: makeEntry("strike:novo"),
      favorites: source,
    });

    expect(s.notify).toHaveBeenCalledExactlyOnceWith(
      "Favoritos cheios (12 de 12). Desafixe um para abrir lugar.",
    );
    expect(source.isPinned("strike:novo")).toBe(false);
  });

  it("Desafixar esvazia o slot da entrada, inclusive o de um órfão", () => {
    const source = favoritesOver(["strike:a", "item:vendido", ...emptyRow().slice(2)]);
    const s = services();

    runSlotMenuItem(UNPIN_ITEM, {
      actorId: "actor-1",
      services: s,
      entry: orphanEntry("item:vendido"),
      favorites: source,
    });

    expect(source.calls.unpin).toEqual(["item:vendido"]);
    expect(source.slots().slice(0, 2)).toEqual(["strike:a", null]);
  });

  it("sem entrada ou sem fonte, Fixar e Desafixar não fazem nada nem quebram", () => {
    const source = favoritesOver(emptyRow());
    const s = services();

    runSlotMenuItem(PIN_ITEM, { actorId: "a", services: s, favorites: source });
    runSlotMenuItem(UNPIN_ITEM, { actorId: "a", services: s, entry: makeEntry("strike:a") });
    runSlotMenuItem(PIN_ITEM, { actorId: "a", services: s });

    expect(source.calls.pin).toEqual([]);
    expect(source.calls.unpin).toEqual([]);
    expect(s.notify).not.toHaveBeenCalled();
  });
});
