/**
 * contactCategories.test.ts — the user's own categories of contacts (spec 39 §5.6, G064).
 *
 * Covers REQ-CTT-050 (create, rename, delete), REQ-CTT-051 (one category per contact,
 * moving removes from the previous one), REQ-CTT-052 (deleting a category sends its
 * contacts back to "Sem categoria" and deletes no actor), REQ-CTT-053 ("Sem categoria"
 * is not a stored category, so it cannot be renamed or deleted), REQ-CTT-054 (manual
 * order that survives a reload) and REQ-CTT-055/056 (client-only, per world + user,
 * invisible to anybody else).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  CONTACT_CATEGORIES_KEY_PREFIX,
  assignContactToCategory,
  categoryOfContact,
  clearContactCategories,
  contactCategoriesKey,
  createCategory,
  deleteCategory,
  emptyContactCategories,
  hasCategory,
  loadContactCategories,
  moveCategory,
  normalizeCategoryName,
  renameCategory,
  saveContactCategories,
} from "../categories.js";

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as lib/windows/__tests__/window-manager.test.ts)
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    snapshot: () => ({ ...store }),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

const WORLD = "world-abc";
const ALEX = "user-alex";
const TOBIAS = "user-tobias";

const FERREIRO = "act-ferreiro01";
const TAVERNEIRA = "act-taverneira";

beforeEach(() => {
  localStorageMock.clear();
});

// ---------------------------------------------------------------------------
// Creating, renaming, deleting — REQ-CTT-050
// ---------------------------------------------------------------------------

describe("the user curates his own categories (REQ-CTT-050)", () => {
  it("REQ-CTT-050: creates categories and keeps them in the order they were created", () => {
    const state = createCategory(createCategory(emptyContactCategories(), "Aliados"), "Vilões");

    expect(state.order).toEqual(["Aliados", "Vilões"]);
    expect(hasCategory(state, "aliados")).toBe(true);
  });

  it("REQ-CTT-050: refuses an empty name and a name that already exists", () => {
    const one = createCategory(emptyContactCategories(), "Aliados");

    expect(createCategory(one, "   ").order).toEqual(["Aliados"]);
    // Accents and case are the same name to a human, so they are here too.
    expect(createCategory(one, "aliados").order).toEqual(["Aliados"]);
    expect(createCategory(one, "Vilões").order).toEqual(["Aliados", "Vilões"]);
  });

  it("REQ-CTT-050: renaming keeps the position and carries the contacts along", () => {
    let state = createCategory(createCategory(emptyContactCategories(), "Aliados"), "Vilões");
    state = assignContactToCategory(state, FERREIRO, "Aliados");

    const renamed = renameCategory(state, "Aliados", "Amigos de Otari");

    expect(renamed.order).toEqual(["Amigos de Otari", "Vilões"]);
    expect(categoryOfContact(renamed, FERREIRO)).toBe("Amigos de Otari");
  });

  it("REQ-CTT-050: renaming onto an existing name is refused", () => {
    const state = createCategory(createCategory(emptyContactCategories(), "Aliados"), "Vilões");

    expect(renameCategory(state, "Aliados", "Vilões")).toBe(state);
    expect(renameCategory(state, "Aliados", "  ")).toBe(state);
  });

  it("normalizes the typed name, so trailing spaces never create a twin", () => {
    expect(normalizeCategoryName("  Amigos   de Otari ")).toBe("Amigos de Otari");
  });
});

// ---------------------------------------------------------------------------
// One category per contact — REQ-CTT-051
// ---------------------------------------------------------------------------

describe("a contact sits in exactly one category (REQ-CTT-051)", () => {
  it("REQ-CTT-051: moving a contact to another category removes it from the previous one", () => {
    let state = createCategory(createCategory(emptyContactCategories(), "Aliados"), "Vilões");
    state = assignContactToCategory(state, FERREIRO, "Aliados");
    state = assignContactToCategory(state, FERREIRO, "Vilões");

    expect(categoryOfContact(state, FERREIRO)).toBe("Vilões");
    // The association is a single value: there is nowhere for a second one to live.
    expect(Object.values(state.assignments).filter((name) => name === "Aliados")).toEqual([]);
  });

  it("REQ-CTT-051: assigning null takes the contact back to Sem categoria", () => {
    let state = createCategory(emptyContactCategories(), "Aliados");
    state = assignContactToCategory(state, FERREIRO, "Aliados");
    state = assignContactToCategory(state, FERREIRO, null);

    expect(categoryOfContact(state, FERREIRO)).toBeNull();
  });

  it("REQ-CTT-051: naming a category that does not exist files the contact nowhere", () => {
    const state = assignContactToCategory(emptyContactCategories(), FERREIRO, "Fantasma");

    expect(state.order).toEqual([]);
    expect(categoryOfContact(state, FERREIRO)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deleting a category — REQ-CTT-052 / REQ-CTT-053
// ---------------------------------------------------------------------------

describe("deleting a category is not deleting anybody (REQ-CTT-052)", () => {
  it("REQ-CTT-052: its contacts go back to Sem categoria and no contact is lost", () => {
    let state = createCategory(createCategory(emptyContactCategories(), "Aliados"), "Vilões");
    state = assignContactToCategory(state, FERREIRO, "Aliados");
    state = assignContactToCategory(state, TAVERNEIRA, "Aliados");
    const other = assignContactToCategory(state, "act-bandido001", "Vilões");

    const after = deleteCategory(other, "Aliados");

    expect(after.order).toEqual(["Vilões"]);
    expect(categoryOfContact(after, FERREIRO)).toBeNull();
    expect(categoryOfContact(after, TAVERNEIRA)).toBeNull();
    // The other block is untouched — deleting one label is not a purge.
    expect(categoryOfContact(after, "act-bandido001")).toBe("Vilões");
  });

  it("REQ-CTT-052: this module never reads or names an actor document at all", () => {
    // The value is contact ids and labels: there is no actor here to delete, which
    // is what makes "excluir categoria não exclui ator algum" structural.
    let state = createCategory(emptyContactCategories(), "Aliados");
    state = assignContactToCategory(state, FERREIRO, "Aliados");

    const after = deleteCategory(state, "Aliados");

    expect(Object.keys(after.assignments)).toEqual([]);
    expect(JSON.stringify(after)).not.toContain("Actor");
  });

  it("REQ-CTT-053: Sem categoria is the null bucket, so it cannot be created, renamed or deleted", () => {
    const state = createCategory(emptyContactCategories(), "Aliados");

    // There is no name to hand these functions: the bucket is the absence of one.
    expect(categoryOfContact(state, FERREIRO)).toBeNull();
    expect(deleteCategory(state, "").order).toEqual(["Aliados"]);
    expect(renameCategory(state, "", "Qualquer").order).toEqual(["Aliados"]);
  });
});

// ---------------------------------------------------------------------------
// Manual order — REQ-CTT-054
// ---------------------------------------------------------------------------

describe("the order is the user's, and it persists (REQ-CTT-054)", () => {
  it("REQ-CTT-054: moving a category to the top reorders only it", () => {
    let state = emptyContactCategories();
    for (const name of ["Aliados", "Vilões", "Comércio"]) state = createCategory(state, name);

    expect(moveCategory(state, "Comércio", 0).order).toEqual(["Comércio", "Aliados", "Vilões"]);
    expect(moveCategory(state, "Aliados", 2).order).toEqual(["Vilões", "Comércio", "Aliados"]);
  });

  it("REQ-CTT-054: an out-of-range index is clamped, so move-up on the first is a no-op", () => {
    let state = emptyContactCategories();
    for (const name of ["Aliados", "Vilões"]) state = createCategory(state, name);

    expect(moveCategory(state, "Aliados", -3).order).toEqual(["Aliados", "Vilões"]);
    expect(moveCategory(state, "Vilões", 9).order).toEqual(["Aliados", "Vilões"]);
    expect(moveCategory(state, "Inexistente", 0)).toBe(state);
  });

  it("REQ-CTT-054: the order and the associations survive a reload", () => {
    let state = emptyContactCategories();
    for (const name of ["Aliados", "Vilões"]) state = createCategory(state, name);
    state = assignContactToCategory(state, FERREIRO, "Vilões");
    state = moveCategory(state, "Vilões", 0);

    saveContactCategories(WORLD, ALEX, state);
    const reloaded = loadContactCategories(WORLD, ALEX);

    expect(reloaded.order).toEqual(["Vilões", "Aliados"]);
    expect(categoryOfContact(reloaded, FERREIRO)).toBe("Vilões");
  });
});

// ---------------------------------------------------------------------------
// Where it lives — REQ-CTT-055 / REQ-CTT-056
// ---------------------------------------------------------------------------

describe("categories live on the device, per world and user (REQ-CTT-055)", () => {
  it("REQ-CTT-055: the key carries both the world and the user, under the fusion prefix", () => {
    expect(contactCategoriesKey(WORLD, ALEX)).toBe(
      `${CONTACT_CATEGORIES_KEY_PREFIX}:${WORLD}:${ALEX}`,
    );
    expect(CONTACT_CATEGORIES_KEY_PREFIX.startsWith("fusion:")).toBe(true);
  });

  it("REQ-CTT-056: one user's curation is invisible to another on the same device", () => {
    let mine = createCategory(emptyContactCategories(), "Aliados");
    mine = assignContactToCategory(mine, FERREIRO, "Aliados");
    saveContactCategories(WORLD, ALEX, mine);

    const his = loadContactCategories(WORLD, TOBIAS);

    expect(his.order).toEqual([]);
    expect(categoryOfContact(his, FERREIRO)).toBeNull();
  });

  it("REQ-CTT-055: another world of the same user starts empty as well", () => {
    saveContactCategories(WORLD, ALEX, createCategory(emptyContactCategories(), "Aliados"));

    expect(loadContactCategories("world-outro", ALEX).order).toEqual([]);
  });

  it("REQ-CTT-055: nothing but localStorage is written — no request, no document", () => {
    const state = assignContactToCategory(
      createCategory(emptyContactCategories(), "Aliados"),
      FERREIRO,
      "Aliados",
    );
    saveContactCategories(WORLD, ALEX, state);

    const keys = Object.keys(localStorageMock.snapshot());
    expect(keys).toEqual([contactCategoriesKey(WORLD, ALEX)]);
  });

  it("survives a corrupt entry and drops an association whose category is gone", () => {
    localStorageMock.setItem(contactCategoriesKey(WORLD, ALEX), "{not json");
    expect(loadContactCategories(WORLD, ALEX).order).toEqual([]);

    localStorageMock.setItem(
      contactCategoriesKey(WORLD, ALEX),
      JSON.stringify({ order: ["Aliados"], assignments: { [FERREIRO]: "Sumida" } }),
    );
    const loaded = loadContactCategories(WORLD, ALEX);
    expect(loaded.order).toEqual(["Aliados"]);
    expect(categoryOfContact(loaded, FERREIRO)).toBeNull();
  });

  it("clearing removes this user's entry and only his", () => {
    saveContactCategories(WORLD, ALEX, createCategory(emptyContactCategories(), "Aliados"));
    saveContactCategories(WORLD, TOBIAS, createCategory(emptyContactCategories(), "Rivais"));

    clearContactCategories(WORLD, ALEX);

    expect(loadContactCategories(WORLD, ALEX).order).toEqual([]);
    expect(loadContactCategories(WORLD, TOBIAS).order).toEqual(["Rivais"]);
  });
});
