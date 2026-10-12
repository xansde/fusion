/**
 * slotMenu.test.ts — the right-click menu of a slot (BAR-F1-04; spec 53 REQ-BAR-045).
 *
 * Only "Abrir na ficha" for now; the variants, Fixar/Desafixar and "Ver detalhes" arrive with later
 * tasks and change this file and this test only.
 */

import { describe, expect, it, vi } from "vitest";

import "../../i18n/index.js";
import { flattenMenu } from "../../ui/menu.js";
import { ACTION_BAR_ICON_CAP } from "@fusion/shared";
import {
  CHANGE_ICON_ITEM,
  OPEN_SHEET_ITEM,
  RESTORE_ICON_ITEM,
  runSlotMenuItem,
  slotMenuItems,
} from "../slotMenu.js";
import { makeEntry } from "./stubProvider.js";

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
      canEdit: true,
      current: null,
      count: 0,
    });
    const items = flattenMenu(entries);

    expect(items.map((item) => item.id)).toEqual([OPEN_SHEET_ITEM, CHANGE_ICON_ITEM]);
    expect(items[1]?.label).toBe("Trocar ícone…");
    expect(entries.some((entry) => "kind" in entry && entry.kind === "separator")).toBe(true);
  });

  it("com imagem, Restaurar ícone padrão vem logo depois", () => {
    const items = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), { canEdit: true, current: ICON, count: 1 }),
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
      canEdit: false,
      current: ICON,
      count: 1,
    });

    expect(flattenMenu(entries).map((item) => item.id)).toEqual([OPEN_SHEET_ITEM]);
    expect(entries).toHaveLength(1);
  });

  it("no teto (64), um ícone NOVO vem desabilitado com o motivo; trocar um que já existe segue valendo", () => {
    const atCap = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), {
        canEdit: true,
        current: null,
        count: ACTION_BAR_ICON_CAP,
      }),
    ).find((item) => item.id === CHANGE_ICON_ITEM);
    expect(atCap?.disabled).toBe(true);
    expect(atCap?.reason).toContain(String(ACTION_BAR_ICON_CAP));

    const replace = flattenMenu(
      slotMenuItems(makeEntry("strike:a"), {
        canEdit: true,
        current: ICON,
        count: ACTION_BAR_ICON_CAP,
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
