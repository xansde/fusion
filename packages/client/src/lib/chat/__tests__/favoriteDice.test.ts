/**
 * favoriteDice.test.ts — favourite dice: what they are, where they live, what they refuse.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-05 and REQ-ACH-050..057. Three things are
 * proven here, and they are the three that would hurt if they broke:
 *
 *  - the model is label + formula + mode, and mode is either "follows the selector" or
 *    locked on one of the four (REQ-ACH-051, REQ-ACH-052);
 *  - the storage key carries the world's IDENTITY and the user's id, so two users in one
 *    browser never see each other's favourites and moving the world to another address
 *    keeps them (REQ-ACH-053);
 *  - the MVP formula is pure — dice and numbers — and an attribute reference fails with a
 *    legible reason instead of being sent to the server (REQ-ACH-054).
 *
 * `localStorage` is faked the same way `window-manager.test.ts` fakes it: this project
 * runs Vitest in a node environment, with no DOM.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FAVORITE_DICE,
  FAVORITE_DICE_KEY_PREFIX,
  FAVORITE_SLOT_COUNT,
  MAX_FAVORITE_LABEL_LENGTH,
  checkFavoriteFormula,
  clearFavoriteDice,
  favoriteDiceKey,
  favoriteProblemI18nKey,
  favoriteRollContent,
  loadFavoriteDice,
  normalizeFavorite,
  saveFavoriteDice,
  subscribeFavoriteDice,
} from "../favoriteDice.js";

import type { FavoriteDie } from "../favoriteDice.js";

// ---------------------------------------------------------------------------
// localStorage double
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Model — REQ-ACH-051, REQ-ACH-052, REQ-ACH-057
// ---------------------------------------------------------------------------

describe("favorito é rótulo + fórmula + modo (REQ-ACH-051, REQ-ACH-052)", () => {
  it("keeps exactly three slots in the row (REQ-ACH-050)", () => {
    expect(FAVORITE_SLOT_COUNT).toBe(3);
    expect(DEFAULT_FAVORITE_DICE).toHaveLength(3);
  });

  it("defaults every favourite to 'follows the selector' (REQ-ACH-052)", () => {
    for (const fav of DEFAULT_FAVORITE_DICE) {
      expect(fav.mode).toBeNull();
    }
  });

  it("accepts a mode locked on one of the four roll modes (REQ-ACH-052)", () => {
    const locked = normalizeFavorite({ label: "Furtiva", formula: "1d20", mode: "gmroll" });
    expect(locked.mode).toBe("gmroll");
  });

  it("rejects a mode that is not a roll mode, falling back to the selector (REQ-ACH-052)", () => {
    const bogus = normalizeFavorite({
      label: "x",
      formula: "1d20",
      mode: "shout" as unknown as FavoriteDie["mode"],
    });
    expect(bogus.mode).toBeNull();
  });

  it("trims the label and caps its length so the row stays readable", () => {
    const long = normalizeFavorite({
      label: `  ${"a".repeat(MAX_FAVORITE_LABEL_LENGTH + 20)}  `,
      formula: " 1d20 ",
      mode: null,
    });
    expect(long.label).toHaveLength(MAX_FAVORITE_LABEL_LENGTH);
    expect(long.formula).toBe("1d20");
  });

  it("falls back to the formula when the label is blank (REQ-ACH-051)", () => {
    expect(normalizeFavorite({ label: "   ", formula: "2d6+3", mode: null }).label).toBe("2d6+3");
  });

  it("fires the roll as a plain /roll line — no Document, no macro (REQ-ACH-057)", () => {
    expect(favoriteRollContent({ label: "Ataque", formula: "1d20+7", mode: null })).toBe(
      "/roll 1d20+7",
    );
    // A macro would be a world Document with permissions; a favourite is a string that
    // becomes a chat line. Nothing here reaches a script or a hotbar.
    expect(favoriteRollContent({ label: "x", formula: "  1d6  ", mode: "selfroll" })).toBe(
      "/roll 1d6",
    );
  });
});

// ---------------------------------------------------------------------------
// Formula purity — REQ-ACH-054
// ---------------------------------------------------------------------------

describe("no MVP a fórmula é pura: dados e números (REQ-ACH-054)", () => {
  it("accepts dice-and-number formulas, including modifiers and notation", () => {
    for (const formula of ["1d20", "2d6+3", "4d6kh3", "1d20!", "2d20kh1+5", "1d100-10"]) {
      expect(checkFavoriteFormula(formula).valid).toBe(true);
    }
  });

  it("refuses `@attr` with a legible reason instead of shipping it to the server", () => {
    const check = checkFavoriteFormula("1d20 + @abilities.str.mod");
    expect(check.valid).toBe(false);
    expect(check.problem).toBe("attribute");
    expect(check.token).toBe("@abilities.str.mod");
    expect(favoriteProblemI18nKey("attribute")).toBe("FUSION.Chat.Favorites.Invalid.Attribute");
  });

  it("refuses a named attribute — the [V2] case of REQ-ACH-056 — naming the offender", () => {
    const check = checkFavoriteFormula("1d20 + Força + percepção");
    expect(check.valid).toBe(false);
    expect(check.problem).toBe("attribute");
    expect(check.token).toBe("Força");
  });

  it("does not mistake dice notation or a flavour label for an attribute", () => {
    expect(checkFavoriteFormula("1dF").valid).toBe(true);
    expect(checkFavoriteFormula("floor((2d6+4)/2)").valid).toBe(true);
    expect(checkFavoriteFormula("2d6[fogo] + 1d8").valid).toBe(true);
    expect(checkFavoriteFormula("1d20+5 # Ataque corpo a corpo").valid).toBe(true);
  });

  it("separates an empty formula from a broken one, so the message can differ", () => {
    expect(checkFavoriteFormula("   ").problem).toBe("empty");
    expect(favoriteProblemI18nKey("empty")).toBe("FUSION.Chat.Favorites.Invalid.Empty");

    const broken = checkFavoriteFormula("1d20 +");
    expect(broken.valid).toBe(false);
    expect(broken.problem).toBe("syntax");
    expect(broken.detail).toBeTruthy();
    expect(favoriteProblemI18nKey("syntax")).toBe("FUSION.Chat.Favorites.Invalid.Syntax");
  });
});

// ---------------------------------------------------------------------------
// Storage — REQ-ACH-053
// ---------------------------------------------------------------------------

describe("favoritos ficam no aparelho, por mundo + usuário (REQ-ACH-053)", () => {
  const list: FavoriteDie[] = [
    { label: "Ataque", formula: "1d20+7", mode: null },
    { label: "Dano", formula: "1d8+4", mode: null },
    { label: "Furtiva", formula: "1d20+9", mode: "gmroll" },
  ];

  it("keys on the world's identity and the user's id, never on the address", () => {
    expect(favoriteDiceKey("world-abc", "user-1")).toBe(
      `${FAVORITE_DICE_KEY_PREFIX}:world-abc:user-1`,
    );
    // No host, no port, no protocol anywhere in the key: swapping LAN for a tunnel
    // changes the address and must not change the key.
    expect(favoriteDiceKey("world-abc", "user-1")).not.toMatch(/localhost|:\d{2,5}\b|http/);
  });

  it("two users in the same browser do not inherit each other's favourites", () => {
    saveFavoriteDice("world-abc", "gm-1", list);
    const player = loadFavoriteDice("world-abc", "player-2");

    expect(player).toEqual(DEFAULT_FAVORITE_DICE);
    expect(player[0]?.label).not.toBe("Ataque");
    expect(loadFavoriteDice("world-abc", "gm-1")[0]?.label).toBe("Ataque");
  });

  it("keeps the favourites when the world moves to another address (REQ-ACH-053)", () => {
    saveFavoriteDice("world-abc", "gm-1", list);
    // The "address" changed — the key never contained it, so nothing moved.
    expect(loadFavoriteDice("world-abc", "gm-1")).toEqual(list);
    expect([...raw.keys()]).toEqual([`${FAVORITE_DICE_KEY_PREFIX}:world-abc:gm-1`]);
  });

  it("does not carry favourites from one world into another", () => {
    saveFavoriteDice("world-abc", "gm-1", list);
    expect(loadFavoriteDice("world-xyz", "gm-1")).toEqual(DEFAULT_FAVORITE_DICE);
  });

  it("never writes without both ids — an anonymous entry would leak to the next session", () => {
    saveFavoriteDice("", "gm-1", list);
    saveFavoriteDice("world-abc", "", list);
    expect(raw.size).toBe(0);
    expect(loadFavoriteDice("", "")).toEqual(DEFAULT_FAVORITE_DICE);
  });

  it("survives corrupt storage by falling back to the defaults", () => {
    raw.set(favoriteDiceKey("world-abc", "gm-1"), "{not json");
    expect(loadFavoriteDice("world-abc", "gm-1")).toEqual(DEFAULT_FAVORITE_DICE);

    raw.set(favoriteDiceKey("world-abc", "gm-1"), JSON.stringify([{ formula: 42 }]));
    const repaired = loadFavoriteDice("world-abc", "gm-1");
    expect(repaired).toHaveLength(FAVORITE_SLOT_COUNT);
    expect(repaired[0]).toEqual(DEFAULT_FAVORITE_DICE[0]);
  });

  it("always returns exactly three slots, padding a short saved list", () => {
    saveFavoriteDice("world-abc", "gm-1", [{ label: "Só um", formula: "1d4", mode: null }]);
    const loaded = loadFavoriteDice("world-abc", "gm-1");
    expect(loaded).toHaveLength(FAVORITE_SLOT_COUNT);
    expect(loaded[0]?.label).toBe("Só um");
    expect(loaded[2]).toEqual(DEFAULT_FAVORITE_DICE[2]);
  });

  it("stores nothing on the server — the value is a local string and no Document (REQ-ACH-057)", () => {
    saveFavoriteDice("world-abc", "gm-1", list);
    const stored: unknown = JSON.parse(raw.get(favoriteDiceKey("world-abc", "gm-1")) ?? "null");
    expect(Array.isArray(stored)).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/_id|ownership|_stats|permission/);
  });

  it("clears only the entry of that user in that world", () => {
    saveFavoriteDice("world-abc", "gm-1", list);
    saveFavoriteDice("world-abc", "player-2", list);
    clearFavoriteDice("world-abc", "gm-1");

    expect(loadFavoriteDice("world-abc", "gm-1")).toEqual(DEFAULT_FAVORITE_DICE);
    expect(loadFavoriteDice("world-abc", "player-2")).toEqual(list);
  });

  it("tells the row when the editor saved, so the tray does not go stale (REQ-ACH-055)", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeFavoriteDice(seen);

    saveFavoriteDice("world-abc", "gm-1", list);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("world-abc", "gm-1");

    unsubscribe();
    saveFavoriteDice("world-abc", "gm-1", list);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
