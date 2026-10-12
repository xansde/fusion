/**
 * slotMenu.test.ts — the right-click menu of a slot (BAR-F1-04; spec 53 REQ-BAR-045).
 *
 * Only "Abrir na ficha" for now; the variants, Fixar/Desafixar and "Ver detalhes" arrive with later
 * tasks and change this file and this test only.
 */

import { describe, expect, it, vi } from "vitest";

import "../../i18n/index.js";
import { flattenMenu } from "../../ui/menu.js";
import { OPEN_SHEET_ITEM, runSlotMenuItem, slotMenuItems } from "../slotMenu.js";
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
