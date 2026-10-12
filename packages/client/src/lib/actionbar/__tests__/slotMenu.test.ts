/**
 * slotMenu.test.ts — the right-click menu of a slot (BAR-F1-04, BAR-F3-01, BAR-F3-05; spec 53
 * REQ-BAR-045, REQ-BAR-063, REQ-BAR-066, REQ-BAR-074).
 *
 * "Abrir na ficha" (BAR-F1-04), the minimal pin and unpin (BAR-F3-01): "Fixar nos Favoritos" on an
 * entry that is not in the row, "Desafixar" on one that is — in the Favorites row, in a tab, and on
 * an orphan — and, at the end after a separator, the custom icon's "Trocar ícone…" and "Restaurar
 * ícone padrão" (BAR-F3-05). The full menu (variants, "Ver detalhes") and drag and drop were cut
 * (D-BA16). Each later item is APPENDED after the ones before it, so a task that adds one edits the
 * end of the list and the end of `runSlotMenuItem` and nothing else. The last block proves the two
 * tasks' items together, in that order.
 */

import { describe, expect, it, vi } from "vitest";

import "../../i18n/index.js";
import { flattenMenu } from "../../ui/menu.js";
import { ACTION_BAR_ICON_CAP } from "@fusion/shared";
import { orphanEntry } from "../orphan.js";
import {
  CHANGE_ICON_ITEM,
  OPEN_SHEET_ITEM,
  PIN_ITEM,
  RESTORE_ICON_ITEM,
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

// ---------------------------------------------------------------------------
// BAR-F3-05 — "Trocar ícone…" and "Restaurar ícone padrão", at the END of the menu
// ---------------------------------------------------------------------------

describe("slotMenuItems — o ícone customizado (BAR-F3-05, REQ-BAR-074)", () => {
  const ICON = "/assets/actionbar-icons/hanabi-1a2b3c4d.png";

  it("quem pode trocar vê Trocar ícone… no fim, depois de um separador; Abrir na ficha segue primeiro", () => {
    const entries = slotMenuItems(makeEntry("strike:a"), {
      icon: {
        canEdit: true,
        current: null,
        count: 0,
      },
    });
    const items = flattenMenu(entries);

    expect(items.map((item) => item.id)).toEqual([OPEN_SHEET_ITEM, CHANGE_ICON_ITEM]);
    expect(items[1]?.label).toBe("Trocar ícone…");
    expect(entries.some((entry) => "kind" in entry && entry.kind === "separator")).toBe(true);
  });

  it("com imagem, Restaurar ícone padrão vem logo depois", () => {
    const items = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), { icon: { canEdit: true, current: ICON, count: 1 } }),
    );

    expect(items.map((item) => item.id)).toEqual([
      OPEN_SHEET_ITEM,
      CHANGE_ICON_ITEM,
      RESTORE_ICON_ITEM,
    ]);
    expect(items[2]?.label).toBe("Restaurar ícone padrão");
  });

  it("quem não pode escrever no ator não vê os itens do ícone (nem o separador)", () => {
    const entries = slotMenuItems(makeEntry("strike:a"), {
      icon: {
        canEdit: false,
        current: ICON,
        count: 1,
      },
    });

    expect(flattenMenu(entries).map((item) => item.id)).toEqual([OPEN_SHEET_ITEM]);
    expect(entries).toHaveLength(1);
  });

  it("no teto (64), um ícone NOVO vem desabilitado com o motivo; trocar um que já existe segue valendo", () => {
    const atCap = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), {
        icon: {
          canEdit: true,
          current: null,
          count: ACTION_BAR_ICON_CAP,
        },
      }),
    ).find((item) => item.id === CHANGE_ICON_ITEM);
    expect(atCap?.disabled).toBe(true);
    expect(atCap?.reason).toContain(String(ACTION_BAR_ICON_CAP));

    const replace = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), {
        icon: {
          canEdit: true,
          current: ICON,
          count: ACTION_BAR_ICON_CAP,
        },
      }),
    ).find((item) => item.id === CHANGE_ICON_ITEM);
    expect(replace?.disabled).not.toBe(true);
  });

  it("sem o estado do ícone o menu é o de antes", () => {
    expect(flattenMenu(slotMenuItems(makeEntry("strike:a"))).map((item) => item.id)).toEqual([
      OPEN_SHEET_ITEM,
    ]);
  });
});

describe("runSlotMenuItem — o ícone customizado (BAR-F3-05)", () => {
  it("Trocar ícone… e Restaurar ícone padrão chamam as ações do ícone da entrada", () => {
    const openActorSheet = vi.fn();
    const pick = vi.fn();
    const restore = vi.fn();
    const context = { actorId: "actor-1", services: { openActorSheet }, icon: { pick, restore } };

    runSlotMenuItem(CHANGE_ICON_ITEM, context);
    expect(pick).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();

    runSlotMenuItem(RESTORE_ICON_ITEM, context);
    expect(restore).toHaveBeenCalledOnce();
    expect(openActorSheet).not.toHaveBeenCalled();
  });

  it("sem as ações do ícone, os itens do ícone não fazem nada (e Abrir na ficha segue igual)", () => {
    const openActorSheet = vi.fn();

    runSlotMenuItem(CHANGE_ICON_ITEM, { actorId: "actor-1", services: { openActorSheet } });
    runSlotMenuItem(RESTORE_ICON_ITEM, { actorId: "actor-1", services: { openActorSheet } });
    runSlotMenuItem(OPEN_SHEET_ITEM, { actorId: "actor-1", services: { openActorSheet } });

    expect(openActorSheet).toHaveBeenCalledExactlyOnceWith("actor-1");
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

// ---------------------------------------------------------------------------
// The two tasks together (BAR-F3-01 + BAR-F3-05): one menu, the items in the order each task appended them
// ---------------------------------------------------------------------------

describe("slotMenuItems — Favoritos e ícone no mesmo menu", () => {
  const ICON = "/assets/actionbar-icons/hanabi-1a2b3c4d.png";

  it("Abrir na ficha, Fixar, e só no fim — depois de um separador — Trocar ícone…", () => {
    const entries = slotMenuItems(makeEntry("strike:a"), {
      favorites: favoritesOver(emptyRow()),
      icon: { canEdit: true, current: null, count: 0 },
    });

    expect(flattenMenu(entries).map((item) => item.id)).toEqual([
      OPEN_SHEET_ITEM,
      PIN_ITEM,
      CHANGE_ICON_ITEM,
    ]);
    // The separator sits between the pin item and the icon item, not before the pin.
    const kinds = entries.map((entry) => ("kind" in entry ? entry.kind : "item"));
    expect(kinds).toEqual(["item", "item", "separator", "item"]);
  });

  it("uma entrada fixada e com imagem: Abrir na ficha, Desafixar, Trocar ícone…, Restaurar ícone padrão", () => {
    const items = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), {
        favorites: favoritesOver(["strike:a", ...emptyRow().slice(1)]),
        icon: { canEdit: true, current: ICON, count: 1 },
      }),
    );

    expect(items.map((item) => item.id)).toEqual([
      OPEN_SHEET_ITEM,
      UNPIN_ITEM,
      CHANGE_ICON_ITEM,
      RESTORE_ICON_ITEM,
    ]);
  });

  it("quem não pode escrever no ator vê os Favoritos mas não os itens do ícone", () => {
    const entries = slotMenuItems(makeEntry("strike:a"), {
      favorites: favoritesOver(emptyRow()),
      icon: { canEdit: false, current: ICON, count: 1 },
    });

    expect(flattenMenu(entries).map((item) => item.id)).toEqual([OPEN_SHEET_ITEM, PIN_ITEM]);
    expect(entries).toHaveLength(2);
  });

  it("o órfão oferece Desafixar e nenhum item de ícone (sem imagem nem sentido para trocar)", () => {
    const items = flattenMenu(
      slotMenuItems(orphanEntry("item:vendido"), {
        favorites: favoritesOver(["item:vendido", ...emptyRow().slice(1)]),
      }),
    );

    expect(items.map((item) => item.id)).toEqual([OPEN_SHEET_ITEM, UNPIN_ITEM]);
  });

  it("os ids dos itens são únicos com tudo ligado", () => {
    const ids = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), {
        favorites: favoritesOver(emptyRow()),
        icon: { canEdit: true, current: ICON, count: 1 },
      }),
    ).map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("runSlotMenuItem — Favoritos e ícone no mesmo contexto", () => {
  it("cada item faz o seu e só o seu: Fixar não toca no ícone, Trocar ícone… não toca na linha", () => {
    const source = favoritesOver(emptyRow());
    const openActorSheet = vi.fn();
    const notify = vi.fn();
    const pick = vi.fn();
    const restore = vi.fn();
    const context = {
      actorId: "actor-1",
      services: { openActorSheet, notify },
      entry: makeEntry("strike:a"),
      favorites: source,
      icon: { pick, restore },
    };

    runSlotMenuItem(PIN_ITEM, context);
    expect(source.calls.pin).toEqual(["strike:a"]);
    expect(pick).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();

    runSlotMenuItem(CHANGE_ICON_ITEM, context);
    expect(pick).toHaveBeenCalledOnce();
    expect(source.calls.pin).toEqual(["strike:a"]);
    expect(source.calls.unpin).toEqual([]);

    runSlotMenuItem(RESTORE_ICON_ITEM, context);
    expect(restore).toHaveBeenCalledOnce();

    runSlotMenuItem(UNPIN_ITEM, context);
    expect(source.calls.unpin).toEqual(["strike:a"]);
    expect(openActorSheet).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
