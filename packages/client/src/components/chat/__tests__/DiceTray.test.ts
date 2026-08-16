/**
 * DiceTray.test.ts — the favourites row: three of them, a fourth button, and honesty.
 *
 * Rendered with `render()` from `svelte/server`: the client project runs Vitest in a node
 * environment with no jsdom and no testing-library, so the assertions are made on the
 * server-rendered markup. Everything this task owns there is structural.
 *
 * Covers REQ-ACH-050, REQ-ACH-051, REQ-ACH-052, REQ-ACH-054 and RNF-ACH-04 — and the
 * Q-ACH-04 decision: an invalid favourite is disabled WITH the reason, never a button that
 * fails on click.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import DiceTray from "../DiceTray.svelte";
import { DEFAULT_FAVORITE_DICE, favoriteDiceKey } from "../../../lib/chat/favoriteDice.js";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

import type { FavoriteDie } from "../../../lib/chat/favoriteDice.js";

const WORLD = "world-abc";
const USER = "user-1";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
      key: (i: number): string | null => [...store.keys()][i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
  return store;
}

let raw: Map<string, string>;

beforeEach(() => {
  raw = installStorage();
});

function seed(favorites: readonly FavoriteDie[]): void {
  raw.set(favoriteDiceKey(WORLD, USER), JSON.stringify(favorites));
}

function renderTray(): string {
  const { body } = render(DiceTray, {
    props: { worldId: WORLD, userId: USER, onRoll: (): void => undefined },
  });
  return body;
}

/** Server-rendered attributes escape quotes; compare against what the markup really holds. */
function escaped(text: string): string {
  return text.replace(/"/g, "&quot;");
}

/** Pictographs — the exact class of character the drawer bans (REQ-NPC-094). */
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe("a fileira: três favoritos e um quarto botão (REQ-ACH-050)", () => {
  it("draws three favourites plus the button that opens the builder", () => {
    const body = renderTray();
    expect(body.match(/class="[^"]*dice-tray__favorite/g)).toHaveLength(3);
    expect(body).toContain('data-action="open-roll-builder"');
    expect(body.match(/<button/g)).toHaveLength(4);
  });

  it("shows the defaults on a device that never saved anything (REQ-ACH-053)", () => {
    const body = renderTray();
    for (const favorite of DEFAULT_FAVORITE_DICE) {
      expect(body).toContain(`data-formula="${favorite.formula}"`);
    }
  });

  it("draws each favourite's own label and formula (REQ-ACH-051)", () => {
    seed([
      { label: "Ataque", formula: "1d20+7", mode: null },
      { label: "Dano", formula: "1d8+4", mode: null },
      { label: "Iniciativa", formula: "1d20+2", mode: null },
    ]);
    const body = renderTray();
    expect(body).toContain("Ataque");
    expect(body).toContain('data-formula="1d20+7"');
    expect(body).toContain("Iniciativa");
  });

  it("uses drawn icons and no emoji (REQ-NPC-094)", () => {
    seed([
      { label: "Furtiva", formula: "1d20+9", mode: "gmroll" },
      ...DEFAULT_FAVORITE_DICE.slice(1),
    ]);
    const body = renderTray();
    expect(body).toContain("<svg");
    expect(PICTOGRAPH.test(body)).toBe(false);
  });

  it("is made of real buttons, so Tab and Enter already work (RNF-ACH-04)", () => {
    const body = renderTray();
    expect(body.match(/type="button"/g)).toHaveLength(4);
    expect(body).toContain('role="group"');
    expect(body).toContain(t("FUSION.Chat.Favorites.RowLabel"));
  });
});

describe("modo do favorito: segue o seletor ou travado (REQ-ACH-052)", () => {
  it("says 'follows the selector' when nothing is locked", () => {
    const body = renderTray();
    expect(body).not.toContain("data-locked-mode=");
    expect(body).toContain(t("FUSION.Chat.Favorites.FollowsSelector"));
  });

  it("marks a locked favourite with its own mode icon (REQ-ACH-044)", () => {
    seed([
      { label: "Furtiva", formula: "1d20+9", mode: "gmroll" },
      { label: "Dano", formula: "1d8", mode: null },
      { label: "Percepção", formula: "1d20", mode: null },
    ]);
    const body = renderTray();
    expect(body).toContain('data-locked-mode="gmroll"');
    expect(body.match(/data-locked-mode=/g)).toHaveLength(1);
    expect(body).toContain(
      t("FUSION.Chat.Favorites.LockedMode", { mode: t("FUSION.Chat.RollMode.Gm.Label") }),
    );
  });

  it("never offers a roll mode control of its own — the selector is the one place", () => {
    const body = renderTray();
    expect(body).not.toContain('role="radiogroup"');
    expect(body).not.toContain(t("FUSION.Chat.RollMode.GroupLabel"));
  });
});

describe("fórmula inválida: desabilita com o motivo (REQ-ACH-054, Q-ACH-04)", () => {
  it("disables a favourite that references an attribute and says which token", () => {
    seed([
      { label: "Ataque", formula: "1d20 + Força", mode: null },
      { label: "Dano", formula: "1d8", mode: null },
      { label: "Percepção", formula: "1d20", mode: null },
    ]);
    const body = renderTray();

    expect(body.match(/ disabled/g)).toHaveLength(1);
    expect(body).toContain(
      escaped(t("FUSION.Chat.Favorites.Invalid.Attribute", { token: "Força", detail: "" })),
    );
    // The reason is reachable by pointer (title) AND by focus (accessible name).
    expect(body).toMatch(/title="[^"]*Força/);
    expect(body).toMatch(/aria-label="[^"]*Força/);
  });

  it("disables an empty favourite with its own reason, not the syntax one", () => {
    seed([
      { label: "Vazio", formula: "", mode: null },
      { label: "Dano", formula: "1d8", mode: null },
      { label: "Percepção", formula: "1d20", mode: null },
    ]);
    // An empty formula falls back to the slot's default on load, so the row never shows a
    // dead button for a favourite the user never filled in — it shows the default die.
    const body = renderTray();
    expect(body).toContain(`data-formula="${DEFAULT_FAVORITE_DICE[0]?.formula ?? ""}"`);
    expect(body).not.toMatch(/ disabled/);
  });

  it("keeps a favourite with valid dice notation enabled", () => {
    seed([
      { label: "Explosivo", formula: "4d6!kh3", mode: null },
      { label: "Dano", formula: "2d6+3", mode: null },
      { label: "Percentil", formula: "1d100", mode: null },
    ]);
    const body = renderTray();
    expect(body).not.toMatch(/ disabled/);
    expect(body).toContain(t("FUSION.Chat.Favorites.Fire", { formula: "4d6!kh3" }));
  });
});
