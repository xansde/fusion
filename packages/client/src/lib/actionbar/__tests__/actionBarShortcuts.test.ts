/**
 * actionBarShortcuts.test.ts — the keys of the action bar (BAR-F1-05; spec 53 REQ-BAR-048..051,
 * Q-BAR-07, CA-BAR-07).
 *
 * The twelve keys 1–9, 0, − and = run the twelve favourites, in order; Esc cancels a menu. They go
 * through the registry and its guard, so they never fire from a text field, a dialog or a focused
 * button (REQ-BAR-049) — and that is the catch this file exists to pin down:
 *
 *   A click of the MOUSE leaves the focus on the slot's `<button>`, and the guard suspends the keys
 *   while a button holds the focus. Untreated, the keys die at the first click and stay dead until
 *   the user clicks elsewhere (Q-BAR-07). BAR-F1-04 gives the focus back to the canvas after a
 *   pointer click (`releaseFocusAfterPointer`); BAR-F1-05 owns the RESULT, so the test below does the
 *   whole walk — a slot with the focus, a mouse click, the twelve keys — and demands the right slot
 *   runs for each. The same walk with the KEYBOARD (Tab to the slot, Enter) must keep the keys
 *   suspended: that user is inside the bar, on a button.
 *
 * Over minimal doubles, no DOM (tasks.md §2.10).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { FAVORITE_KEYS } from "../favoriteKeys.js";
import { registerActionBarShortcuts } from "../actionBarShortcuts.js";
import { releaseFocusAfterPointer } from "../slotFocus.js";
import {
  createShortcutRegistry,
  type ShortcutDocument,
  type ShortcutKeyEvent,
  type ShortcutRegistry,
} from "../../shortcuts/shortcutRegistry.js";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function fakeController(
  overrides: Partial<{ canRun: (i: number) => boolean; canCancel: boolean }> = {},
) {
  const state = { canCancel: overrides.canCancel ?? false };
  return {
    state,
    runFavorite: vi.fn(() => Promise.resolve()),
    canRunFavorite: vi.fn(overrides.canRun ?? (() => true)),
    cancel: vi.fn(() => {
      state.canCancel = false;
    }),
    get canCancel() {
      return state.canCancel;
    },
  };
}

type FakeController = ReturnType<typeof fakeController>;

function key(code: string, extra: Partial<ShortcutKeyEvent> = {}) {
  return {
    code,
    key: code,
    target: null as unknown,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  };
}

function docWith(activeElement: unknown = null): ShortcutDocument {
  return { activeElement };
}

let registry: ShortcutRegistry;
let off: (() => void) | undefined;

function bind(controller: FakeController) {
  registry = createShortcutRegistry({ target: null });
  off = registerActionBarShortcuts(controller as never, registry);
  return registry;
}

afterEach(() => {
  off?.();
  off = undefined;
});

// ---------------------------------------------------------------------------
// The twelve keys
// ---------------------------------------------------------------------------

describe("as 12 teclas da linha de Favoritos (REQ-BAR-048)", () => {
  it("a tabela tem 12 teclas físicas: 1–9, 0, − e =, nessa ordem", () => {
    expect(FAVORITE_KEYS.map((k) => k.code)).toEqual([
      "Digit1",
      "Digit2",
      "Digit3",
      "Digit4",
      "Digit5",
      "Digit6",
      "Digit7",
      "Digit8",
      "Digit9",
      "Digit0",
      "Minus",
      "Equal",
    ]);
  });

  it.each(FAVORITE_KEYS.map((k, index) => [k.code, index] as const))(
    "%s executa o favorito %i (runFavorite na ordem dos slots)",
    (code, index) => {
      const controller = fakeController();
      const registry = bind(controller);
      const event = key(code);

      expect(registry.dispatch(event, docWith())).toBe(true);

      expect(controller.runFavorite).toHaveBeenCalledExactlyOnceWith(index);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    },
  );

  it("o selo que o slot desenha e a tecla que o aciona são da mesma tabela (nunca divergem)", () => {
    expect(FAVORITE_KEYS.map((k) => k.label)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "−",
      "=",
    ]);
    expect(FAVORITE_KEYS[10]).toMatchObject({ code: "Minus", shortcut: "-" });
    expect(FAVORITE_KEYS[11]).toMatchObject({ code: "Equal", shortcut: "=" });
  });

  it("outras teclas não fazem nada", () => {
    const controller = fakeController();
    const registry = bind(controller);

    for (const code of [
      "KeyA",
      "Numpad1",
      "Digit11",
      "Space",
      "F9",
      "Enter",
      "ArrowUp",
      "Backspace",
      "Delete",
      "KeyD",
    ]) {
      expect(registry.dispatch(key(code), docWith())).toBe(false);
    }

    expect(controller.runFavorite).not.toHaveBeenCalled();
  });

  it("tecla sem o que executar (slot vazio, sem barra) NÃO é consumida e a tecla segue", () => {
    const controller = fakeController({ canRun: () => false });
    const registry = bind(controller);
    const event = key("Digit3");

    expect(registry.dispatch(event, docWith())).toBe(false);

    expect(controller.runFavorite).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("segurar a tecla executa uma vez só (REQ-BAR-050)", () => {
    const controller = fakeController();
    const registry = bind(controller);

    registry.dispatch(key("Digit1"), docWith());
    registry.dispatch(key("Digit1", { repeat: true }), docWith());
    registry.dispatch(key("Digit1", { repeat: true }), docWith());

    expect(controller.runFavorite).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The guard, through the bar's own bindings (CA-BAR-07)
// ---------------------------------------------------------------------------

describe("a tecla 1 executa o favorito 1; no chat, num diálogo ou num botão, não (CA-BAR-07)", () => {
  const FOCUS: Array<[string, unknown]> = [
    ["o chat (campo de texto)", { tagName: "TEXTAREA" }],
    ["o campo de busca", { tagName: "INPUT", type: "search" }],
    ["um diálogo", { tagName: "DIV", closest: () => ({ tagName: "DIALOG" }) }],
    ["um botão", { tagName: "BUTTON" }],
    ["um editor de texto rico", { tagName: "DIV", isContentEditable: true }],
  ];

  it.each(FOCUS)("com o foco em %s a tecla não executa nada", (_name, element) => {
    const controller = fakeController();
    const registry = bind(controller);

    for (const { code } of FAVORITE_KEYS) {
      registry.dispatch(key(code, { target: element }), docWith(element));
    }

    expect(controller.runFavorite).not.toHaveBeenCalled();
  });

  it("com o foco no corpo da página, executa", () => {
    const controller = fakeController();
    const registry = bind(controller);

    registry.dispatch(key("Digit1", { target: { tagName: "BODY" } }), docWith({ tagName: "BODY" }));

    expect(controller.runFavorite).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("Ctrl+1 (trocar de aba do navegador) não é da barra", () => {
    const controller = fakeController();
    const registry = bind(controller);

    registry.dispatch(key("Digit1", { ctrlKey: true }), docWith());

    expect(controller.runFavorite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Q-BAR-07 — the focus a mouse click leaves on a slot
// ---------------------------------------------------------------------------

describe("depois de clicar num slot com o mouse, as 12 teclas continuam funcionando (Q-BAR-07)", () => {
  /** A page with a slot button focused, as the browser leaves it after a click. */
  function pageWithFocusedSlot() {
    const body = { tagName: "BODY" };
    const canvas = { tagName: "CANVAS", focus: vi.fn(), blur: vi.fn() };
    const slot = { tagName: "BUTTON", blur: vi.fn(), focus: vi.fn() };
    const doc = {
      activeElement: slot as unknown,
      querySelector: (selector: string) => (selector.includes("canvas") ? canvas : null),
    };
    slot.blur.mockImplementation(() => {
      if (doc.activeElement === slot) doc.activeElement = body;
    });
    return { doc, slot, body };
  }

  it("controle: com o botão do slot focado, as teclas estão suspensas (REQ-BAR-049)", () => {
    const controller = fakeController();
    const registry = bind(controller);
    const { doc, slot } = pageWithFocusedSlot();

    for (const { code } of FAVORITE_KEYS) {
      registry.dispatch(key(code, { target: slot }), doc);
    }

    expect(controller.runFavorite).not.toHaveBeenCalled();
  });

  it.each(FAVORITE_KEYS.map((k, index) => [k.code, index] as const))(
    "depois do clique de mouse, %s executa o slot %i",
    (code, index) => {
      const controller = fakeController();
      const registry = bind(controller);
      const { doc, slot } = pageWithFocusedSlot();

      // O clique de mouse num slot: detail = 1.
      releaseFocusAfterPointer({ detail: 1, currentTarget: slot }, doc);
      // Daí a tecla, sem clicar em mais nada. O alvo do evento é o elemento focado agora.
      const event = key(code, { target: doc.activeElement });

      expect(registry.dispatch(event, doc)).toBe(true);

      expect(controller.runFavorite).toHaveBeenCalledExactlyOnceWith(index);
    },
  );

  it("o mesmo caminho com o TECLADO (Tab até o slot, Enter, detail 0) mantém as teclas suspensas (REQ-BAR-049, REQ-BAR-051)", () => {
    const controller = fakeController();
    const registry = bind(controller);
    const { doc, slot } = pageWithFocusedSlot();

    // Enter num botão focado gera um click com detail 0: o foco NÃO sai do botão.
    releaseFocusAfterPointer({ detail: 0, currentTarget: slot }, doc);
    expect(doc.activeElement).toBe(slot);

    for (const { code } of FAVORITE_KEYS) {
      expect(registry.dispatch(key(code, { target: doc.activeElement }), doc)).toBe(false);
    }
    expect(controller.runFavorite).not.toHaveBeenCalled();
  });

  it("clicar, apertar 2, clicar de novo e apertar 3 — a sequência de quem joga com mouse e teclado juntos", () => {
    const controller = fakeController();
    const registry = bind(controller);
    const { doc, slot } = pageWithFocusedSlot();

    releaseFocusAfterPointer({ detail: 1, currentTarget: slot }, doc);
    registry.dispatch(key("Digit2", { target: doc.activeElement }), doc);
    // O segundo clique foca o botão de novo (o navegador o faz antes do click), e a barra o solta.
    doc.activeElement = slot;
    releaseFocusAfterPointer({ detail: 1, currentTarget: slot }, doc);
    registry.dispatch(key("Digit3", { target: doc.activeElement }), doc);

    expect(controller.runFavorite.mock.calls).toEqual([[1], [2]]);
  });
});

// ---------------------------------------------------------------------------
// Esc
// ---------------------------------------------------------------------------

describe("Esc cancela o menu aberto (REQ-BAR-048)", () => {
  it("com algo para fechar: cancela e consome a tecla", () => {
    const controller = fakeController({ canCancel: true });
    const registry = bind(controller);
    const event = key("Escape");

    expect(registry.dispatch(event, docWith())).toBe(true);

    expect(controller.cancel).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("sem nada para fechar, o Esc NÃO é da barra: segue para o canvas (desmarcar o token)", () => {
    const controller = fakeController({ canCancel: false });
    const registry = bind(controller);
    const event = key("Escape");

    expect(registry.dispatch(event, docWith())).toBe(false);

    expect(controller.cancel).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("com o foco num campo de texto, o Esc é do campo (limpar a busca), mesmo com menu aberto", () => {
    const controller = fakeController({ canCancel: true });
    const registry = bind(controller);
    const field = { tagName: "INPUT", type: "text" };

    expect(registry.dispatch(key("Escape", { target: field }), docWith(field))).toBe(false);

    expect(controller.cancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Registering and unregistering
// ---------------------------------------------------------------------------

describe("registerActionBarShortcuts", () => {
  it("registra 13 ações nomeadas: as 12 teclas e o Esc", () => {
    bind(fakeController());

    expect(registry.size()).toBe(13);
  });

  it("devolve o 'desregistrar': depois dele nenhuma tecla é da barra", () => {
    const controller = fakeController({ canCancel: true });
    const registry = bind(controller);

    off?.();
    off = undefined;

    expect(registry.size()).toBe(0);
    expect(registry.dispatch(key("Digit1"), docWith())).toBe(false);
    expect(registry.dispatch(key("Escape"), docWith())).toBe(false);
    expect(controller.runFavorite).not.toHaveBeenCalled();
  });

  it("registrar duas vezes (a barra remontou) e desfazer a primeira não derruba a segunda", () => {
    const controller = fakeController();
    const registry = createShortcutRegistry({ target: null });
    const first = registerActionBarShortcuts(controller as never, registry);
    off = registerActionBarShortcuts(controller as never, registry);

    first();
    expect(registry.size()).toBe(13);

    registry.dispatch(key("Digit1"), docWith());
    expect(controller.runFavorite).toHaveBeenCalledTimes(1);
  });
});
