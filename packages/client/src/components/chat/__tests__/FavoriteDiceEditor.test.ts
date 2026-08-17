/**
 * FavoriteDiceEditor.test.ts — where the three favourites are changed.
 *
 * Spec 38 (`specs/38-aba-chat.md`), REQ-ACH-055: the editor opens in a floating window
 * from the panel's "⋯" (REQ-ACH-015) and lets label, formula and mode of each of the three
 * be changed. It is the only place a favourite gets LOCKED on a mode (REQ-ACH-052), and it
 * is the place an invalid formula gets fixed (REQ-ACH-054, Q-ACH-04).
 *
 * Rendered with `render()` from `svelte/server` — node environment, no jsdom.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import FavoriteDiceEditor from "../FavoriteDiceEditor.svelte";
import {
  FAVORITE_DICE_EDITOR_WINDOW_KEY,
  openFavoriteDiceEditorWindow,
} from "../../../lib/chat/rollBuilderWindow.js";
import { windowManager } from "../../../lib/windows/window-manager.js";
import { favoriteDiceKey } from "../../../lib/chat/favoriteDice.js";
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
  windowManager.closeAll();
});

function seed(favorites: readonly FavoriteDie[]): void {
  raw.set(favoriteDiceKey(WORLD, USER), JSON.stringify(favorites));
}

function renderEditor(): string {
  const { body } = render(FavoriteDiceEditor, { props: { worldId: WORLD, userId: USER } });
  return body;
}

describe("o editor de favoritos (REQ-ACH-055)", () => {
  it("edits label, formula and mode of each of the three", () => {
    const body = renderEditor();
    expect(body.match(/data-slot="\d"/g)).toHaveLength(3);
    expect(body.match(new RegExp(t("FUSION.Chat.Favorites.Editor.Label"), "g"))).toHaveLength(3);
    expect(body.match(new RegExp(t("FUSION.Chat.Favorites.Editor.Formula"), "g"))).toHaveLength(3);
    expect(body.match(new RegExp(t("FUSION.Chat.Favorites.Editor.Mode"), "g"))).toHaveLength(3);
  });

  it("shows the saved values of this user in this world (REQ-ACH-053)", () => {
    seed([
      { label: "Ataque", formula: "1d20+7", mode: "gmroll" },
      { label: "Dano", formula: "1d8+4", mode: null },
      { label: "Percepção", formula: "1d20+2", mode: null },
    ]);
    const body = renderEditor();
    expect(body).toContain('value="1d20+7"');
    expect(body).toContain('value="Ataque"');
  });

  it("offers 'follows the selector' plus the four locked modes (REQ-ACH-052)", () => {
    const body = renderEditor();
    expect(body).toContain(t("FUSION.Chat.Favorites.Editor.ModeFollows"));
    for (const mode of ["Public", "Gm", "Blind", "Self"]) {
      expect(body).toContain(t(`FUSION.Chat.RollMode.${mode}.Label`));
    }
    // Five options per slot: "follows" + the four modes.
    expect(body.match(/<option/g)).toHaveLength(15);
  });

  it("puts the reason next to the field when the formula is not MVP-pure (REQ-ACH-054)", () => {
    seed([
      { label: "Ataque", formula: "1d20 + Força", mode: null },
      { label: "Dano", formula: "1d8", mode: null },
      { label: "Percepção", formula: "1d20", mode: null },
    ]);
    const body = renderEditor();
    expect(body).toContain('role="alert"');
    expect(body).toContain(
      t("FUSION.Chat.Favorites.Invalid.Attribute", { token: "Força", detail: "" }),
    );
    expect(body).toContain('aria-invalid="true"');
  });

  it("opens as one floating window, reused on the next '⋯' (REQ-ACH-055, REQ-UIF-014)", () => {
    const first = openFavoriteDiceEditorWindow({ worldId: WORLD, userId: USER });
    const second = openFavoriteDiceEditorWindow({ worldId: WORLD, userId: USER });

    expect(second.id).toBe(first.id);
    expect(windowManager.windows.size).toBe(1);
    expect(windowManager.windows.get(first.id)?.singletonKey).toBe(FAVORITE_DICE_EDITOR_WINDOW_KEY);
    expect(windowManager.windows.get(first.id)?.component).toBe(FavoriteDiceEditor);
  });

  it("is offered to every role — a favourite has no permission to check (REQ-ACH-057)", () => {
    // Nothing in the editor's props or markup asks who you are: there is no role gate to
    // pass, because a favourite is a local string and not a Document.
    const body = renderEditor();
    expect(body).not.toMatch(/gm-only|role="gm"|isGm/);
  });

  it("puts the invalid-formula reason after the mode field in the DOM, so it never pushes the mode select out of the row (REQ-ACH-054, REQ-ACH-055)", () => {
    seed([
      { label: "Ataque", formula: "1d20 + Força", mode: null },
      { label: "Dano", formula: "1d8", mode: null },
      { label: "Percepção", formula: "1d20", mode: null },
    ]);
    const body = renderEditor();
    const modeFieldIndex = body.indexOf("favorite-editor__field--mode");
    const problemIndex = body.indexOf("favorite-editor__problem");
    expect(modeFieldIndex).toBeGreaterThan(-1);
    expect(problemIndex).toBeGreaterThan(modeFieldIndex);
  });
});
