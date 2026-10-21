/**
 * slotFocus.test.ts — the focus a click leaves on a slot (BAR-F1-04; spec 53 Q-BAR-07,
 * REQ-BAR-049).
 *
 * A mouse click on a `<button>` leaves the focus on it, and the shortcut guard (BAR-F1-05)
 * suspends the number keys while a button holds the focus — so, untreated, 1–0, − and = die at
 * the first click and stay dead until the user clicks somewhere else. `releaseFocusAfterPointer`
 * is what keeps them alive: after a pointer click the focus leaves the button and goes back to the
 * canvas. A keyboard activation (Enter or Space on a focused slot) leaves the focus where it is,
 * on purpose: that user is walking the bar with Tab.
 *
 * No DOM here (tasks.md §2.10): the event and the document are minimal objects, the way
 * `isEscapeForSomethingElse` is tested in `token-interaction.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

import { releaseFocusAfterPointer } from "../slotFocus.js";

interface FakeElement {
  blur: () => void;
  focus: (options?: unknown) => void;
}

/** A document whose `activeElement` follows `blur()` and `focus()` the way a browser's does. */
function fakeDocument() {
  const body = {} as FakeElement;
  const canvas = {} as FakeElement;
  const button = {} as FakeElement;
  const doc: {
    activeElement: unknown;
    querySelector: (selector: string) => unknown;
  } = {
    activeElement: button,
    querySelector: (selector: string) => (selector.includes("canvas") ? canvas : null),
  };
  button.blur = vi.fn(() => {
    if (doc.activeElement === button) doc.activeElement = body;
  });
  button.focus = vi.fn(() => {
    doc.activeElement = button;
  });
  canvas.blur = vi.fn();
  canvas.focus = vi.fn(() => {
    doc.activeElement = canvas;
  });
  return { doc, button, canvas, body };
}

describe("releaseFocusAfterPointer — o clique de mouse devolve o foco ao canvas (Q-BAR-07)", () => {
  it("clique de mouse (detail 1): tira o foco do botão e entrega ao canvas", () => {
    const { doc, button, canvas } = fakeDocument();

    releaseFocusAfterPointer({ detail: 1, currentTarget: button }, doc);

    expect(button.blur).toHaveBeenCalledTimes(1);
    expect(canvas.focus).toHaveBeenCalledTimes(1);
    expect(doc.activeElement).toBe(canvas);
  });

  it("clique duplo e triplo (detail 2 e 3) também contam como mouse", () => {
    for (const detail of [2, 3]) {
      const { doc, button } = fakeDocument();

      releaseFocusAfterPointer({ detail, currentTarget: button }, doc);

      expect(button.blur).toHaveBeenCalledTimes(1);
      expect(doc.activeElement).not.toBe(button);
    }
  });

  it("ativação por teclado (Enter ou Espaço, detail 0): o foco fica no botão", () => {
    const { doc, button, canvas } = fakeDocument();

    releaseFocusAfterPointer({ detail: 0, currentTarget: button }, doc);

    expect(button.blur).not.toHaveBeenCalled();
    expect(canvas.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(button);
  });

  it("sem canvas na página: ainda assim o botão perde o foco (o corpo da página é o destino)", () => {
    const { doc, button, body } = fakeDocument();
    doc.querySelector = () => null;

    releaseFocusAfterPointer({ detail: 1, currentTarget: button }, doc);

    expect(button.blur).toHaveBeenCalledTimes(1);
    expect(doc.activeElement).toBe(body);
  });

  it("sem document (ambiente sem DOM): só tira o foco do botão e não lança", () => {
    const { button } = fakeDocument();

    expect(() => releaseFocusAfterPointer({ detail: 1, currentTarget: button })).not.toThrow();
    expect(button.blur).toHaveBeenCalledTimes(1);
  });

  it("alvo que não sabe desfocar não derruba o clique", () => {
    expect(() =>
      releaseFocusAfterPointer({ detail: 1, currentTarget: { tagName: "BUTTON" } }),
    ).not.toThrow();
    expect(() => releaseFocusAfterPointer({ detail: 1, currentTarget: null })).not.toThrow();
  });

  it("procura o canvas do jogo, não um canvas qualquer da página", () => {
    const { doc, button } = fakeDocument();
    const seen: string[] = [];
    doc.querySelector = (selector: string) => {
      seen.push(selector);
      return null;
    };

    releaseFocusAfterPointer({ detail: 1, currentTarget: button }, doc);

    expect(seen).toEqual([".canvas-host canvas"]);
  });
});
