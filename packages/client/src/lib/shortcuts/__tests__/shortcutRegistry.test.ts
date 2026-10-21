/**
 * shortcutRegistry.test.ts — the central registry of shortcuts and its guard (BAR-F1-05; spec 53
 * REQ-BAR-048..051; spec 23 REQ-A11-020, REQ-A11-023).
 *
 * The bar's number keys are the first shortcuts that live in a registry instead of a hard-coded
 * `window` listener, and the guard is what makes them safe: a key typed into the chat must never
 * roll a die (the risk "rolagem pública indesejada", plan §9). So the heart of this file is a MATRIX
 * of key × focused element (REQ-BAR-051): a key fires with the page body focused, and does NOT fire
 * with focus in a text field, a textarea, a select, a contenteditable, a dialog, a button, a link —
 * nor with Ctrl, Alt or Meta held, nor while an IME is composing; a held key runs its action once.
 *
 * Everything runs over minimal objects (`{ tagName: "BUTTON" }`, `{ activeElement, querySelector }`),
 * the way `token-interaction.test.ts` tests `isEditableTarget` (tasks.md §2.10): the client's Vitest
 * has no DOM.
 *
 * What does NOT change (the card's explicit constraint): the guard asks `isEditableTarget` about text
 * fields and leaves it exactly as it is, because the token's keyboard alternatives (Backspace, the
 * arrows, KeyD) depend on `isEditableTarget` ignoring a focused button or checkbox — widening it
 * would regress the canvas shortcuts (REQ-A11-036, P2 of #194).
 */

import { describe, expect, it, vi } from "vitest";

import { isEditableTarget } from "../../canvas/tokens/token-interaction.js";
import {
  createShortcutRegistry,
  shouldSuspendShortcut,
  type ShortcutDocument,
  type ShortcutKeyEvent,
} from "../shortcutRegistry.js";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface FakeEvent extends ShortcutKeyEvent {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

function key(code: string, extra: Partial<ShortcutKeyEvent> = {}): FakeEvent {
  return {
    code,
    key: code,
    target: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  } as FakeEvent;
}

/** A document whose `activeElement` is whatever the test says. */
function docWith(activeElement: unknown = null): ShortcutDocument {
  return { activeElement };
}

/** An element nested in a dialog: only `closest` knows. */
function insideDialog(tagName = "DIV") {
  return {
    tagName,
    closest: (selector: string) =>
      selector.includes("dialog") || selector.includes("[role") ? { tagName: "DIALOG" } : null,
  };
}

// ---------------------------------------------------------------------------
// The guard: key × focused element (REQ-BAR-049, REQ-BAR-051)
// ---------------------------------------------------------------------------

describe("shouldSuspendShortcut — onde a tecla NÃO dispara (REQ-BAR-049)", () => {
  const SUSPENDS: Array<[string, unknown]> = [
    ["campo de texto", { tagName: "INPUT", type: "text" }],
    ["campo sem type (texto por padrão)", { tagName: "INPUT" }],
    ["campo de busca", { tagName: "INPUT", type: "search" }],
    ["campo de senha", { tagName: "INPUT", type: "password" }],
    ["campo numérico", { tagName: "INPUT", type: "number" }],
    ["textarea", { tagName: "TEXTAREA" }],
    ["select", { tagName: "SELECT" }],
    ["contenteditable", { tagName: "DIV", isContentEditable: true }],
    ["botão", { tagName: "BUTTON" }],
    ["link", { tagName: "A" }],
    ["checkbox (segue a regra do botão)", { tagName: "INPUT", type: "checkbox" }],
    ["radio", { tagName: "INPUT", type: "radio" }],
    ["range", { tagName: "INPUT", type: "range" }],
    ["resumo de <details>", { tagName: "SUMMARY" }],
    [
      "controle ARIA: role=button",
      { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "button" : null) },
    ],
    [
      "controle ARIA: role=menuitem",
      { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "menuitem" : null) },
    ],
    [
      "controle ARIA: role=textbox",
      { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "textbox" : null) },
    ],
    ["dentro de um diálogo", insideDialog()],
    ["botão dentro de um diálogo", insideDialog("BUTTON")],
  ];

  it.each(SUSPENDS)("suspende com o foco em: %s", (_name, element) => {
    // O foco está no elemento, e o evento nasce dele.
    expect(shouldSuspendShortcut(key("Digit1", { target: element }), docWith(element))).toBe(true);
    // Só o evento, ou só o `activeElement`, já bastam.
    expect(shouldSuspendShortcut(key("Digit1", { target: element }), docWith(null))).toBe(true);
    expect(shouldSuspendShortcut(key("Digit1"), docWith(element))).toBe(true);
  });

  const PASSES: Array<[string, unknown]> = [
    ["nada focado (alvo nulo)", null],
    ["o corpo da página", { tagName: "BODY" }],
    ["o canvas", { tagName: "CANVAS" }],
    ["um div qualquer", { tagName: "DIV" }],
    [
      "uma área rolável sem papel interativo",
      { tagName: "DIV", getAttribute: () => null, closest: () => null },
    ],
  ];

  it.each(PASSES)("NÃO suspende com o foco em: %s", (_name, element) => {
    expect(shouldSuspendShortcut(key("Digit1", { target: element }), docWith(element))).toBe(false);
  });

  const INTERACTIVE_ROLES = [
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "switch",
    "checkbox",
    "radio",
    "slider",
    "spinbutton",
    "textbox",
    "searchbox",
    "combobox",
    "option",
  ];

  function withRole(role: string) {
    return { tagName: "DIV", getAttribute: (name: string) => (name === "role" ? role : null) };
  }

  it.each(INTERACTIVE_ROLES)("suspende com o foco num controle ARIA de role=%s", (role) => {
    const element = withRole(role);

    expect(shouldSuspendShortcut(key("Digit1", { target: element }), docWith(element))).toBe(true);
  });

  it("o papel é lido sem diferenciar maiúsculas", () => {
    const element = withRole("Option");

    expect(shouldSuspendShortcut(key("Digit1", { target: element }), docWith(element))).toBe(true);
  });

  it.each(["presentation", "none", "region", "group", "tablist", "listbox"])(
    "NÃO suspende com o foco num elemento de role=%s (não é um controle)",
    (role) => {
      const element = withRole(role);

      expect(shouldSuspendShortcut(key("Digit1", { target: element }), docWith(element))).toBe(
        false,
      );
    },
  );

  it("a busca de diálogo cobre <dialog>, [role=dialog] e [role=alertdialog]", () => {
    const asked: string[] = [];
    const element = {
      tagName: "DIV",
      closest: (selector: string) => {
        asked.push(selector);
        return null;
      },
    };

    shouldSuspendShortcut(key("Digit1", { target: element }), docWith(element));

    // Parte por parte: o `dialog` nativo é uma parte própria, e não só a substring de `[role="dialog"]`.
    const parts = asked
      .join(",")
      .split(",")
      .map((part) => part.trim());
    expect(parts).toContain("dialog");
    expect(parts).toContain('[role="dialog"]');
    expect(parts).toContain('[role="alertdialog"]');
  });

  it("sem document (ambiente sem DOM), decide só pelo evento", () => {
    expect(shouldSuspendShortcut(key("Digit1", { target: { tagName: "TEXTAREA" } }))).toBe(true);
    expect(shouldSuspendShortcut(key("Digit1"))).toBe(false);
  });
});

describe("shouldSuspendShortcut — as teclas que nunca são da barra", () => {
  it("Ctrl, Alt e Meta seguram o atalho (são do navegador ou do sistema)", () => {
    for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
      expect(shouldSuspendShortcut(key("Digit1", { [modifier]: true }), docWith())).toBe(true);
    }
  });

  it("Shift sozinho não: Shift+1 ainda é a tecla 1", () => {
    expect(shouldSuspendShortcut(key("Digit1", { shiftKey: true }), docWith())).toBe(false);
  });

  it("durante composição de IME a tecla é do IME", () => {
    expect(shouldSuspendShortcut(key("Digit1", { isComposing: true }), docWith())).toBe(true);
  });

  it("uma tecla que outro tratador já consumiu não dispara de novo", () => {
    expect(shouldSuspendShortcut(key("Digit1", { defaultPrevented: true }), docWith())).toBe(true);
  });
});

describe("o guard é do registro: isEditableTarget NÃO mudou (REQ-A11-036, P2 do #194)", () => {
  it("botão, checkbox, radio e range seguem NÃO sendo 'campo onde se digita' para o canvas", () => {
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "radio" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "range" })).toBe(false);
  });

  it("e campo de texto, textarea, select e contenteditable seguem sendo", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ isContentEditable: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe("registerShortcut / dispatchShortcut — ações nomeadas com teclas fixas (REQ-BAR-050)", () => {
  it("dispara a ação registrada para a tecla e consome o evento", () => {
    const registry = createShortcutRegistry();
    const run = vi.fn(() => true);
    registry.register({ id: "test.one", codes: ["Digit1"], run });
    const event = key("Digit1");

    expect(registry.dispatch(event, docWith())).toBe(true);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("a tecla é a FÍSICA (code), qualquer que seja o que o layout escreve nela", () => {
    const registry = createShortcutRegistry();
    const run = vi.fn(() => true);
    registry.register({ id: "test.one", codes: ["Digit1"], run });

    // Num AZERTY a tecla Digit1 escreve "&": o atalho é pela posição.
    expect(registry.dispatch(key("Digit1", { key: "&" }), docWith())).toBe(true);
    // E o caractere "1" vindo de outra tecla física não conta.
    expect(registry.dispatch(key("Numpad1", { key: "1" }), docWith())).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("tecla sem ação registrada: não faz nada e não consome", () => {
    const registry = createShortcutRegistry();
    registry.register({ id: "test.one", codes: ["Digit1"], run: () => true });
    const event = key("KeyA");

    expect(registry.dispatch(event, docWith())).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("a ação que diz 'não era comigo' (false) deixa a tecla seguir", () => {
    const registry = createShortcutRegistry();
    registry.register({ id: "test.one", codes: ["Digit1"], run: () => false });
    const event = key("Digit1");

    expect(registry.dispatch(event, docWith())).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("com o foco num campo de texto, a ação nem é chamada e a tecla vai para o campo", () => {
    const registry = createShortcutRegistry();
    const run = vi.fn(() => true);
    registry.register({ id: "test.one", codes: ["Digit1"], run });
    const input = { tagName: "INPUT", type: "text" };
    const event = key("Digit1", { target: input });

    expect(registry.dispatch(event, docWith(input))).toBe(false);

    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("tecla segurada (repeat) não repete a execução", () => {
    const registry = createShortcutRegistry();
    const run = vi.fn(() => true);
    registry.register({ id: "test.one", codes: ["Digit1"], run });

    registry.dispatch(key("Digit1"), docWith());
    registry.dispatch(key("Digit1", { repeat: true }), docWith());
    registry.dispatch(key("Digit1", { repeat: true }), docWith());

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("duas ações na mesma tecla: vale a primeira que trata; a seguinte só se a primeira recusar", () => {
    const registry = createShortcutRegistry();
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    registry.register({ id: "test.first", codes: ["Escape"], run: first });
    registry.register({ id: "test.second", codes: ["Escape"], run: second });
    registry.register({ id: "test.third", codes: ["Escape"], run: third });

    registry.dispatch(key("Escape"), docWith());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
  });

  it("uma ação pode ter várias teclas", () => {
    const registry = createShortcutRegistry();
    const run = vi.fn(() => true);
    registry.register({ id: "test.many", codes: ["Digit1", "Digit2"], run });

    registry.dispatch(key("Digit1"), docWith());
    registry.dispatch(key("Digit2"), docWith());

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("desregistrar tira a ação (e só ela)", () => {
    const registry = createShortcutRegistry();
    const kept = vi.fn(() => true);
    const dropped = vi.fn(() => true);
    registry.register({ id: "test.kept", codes: ["Digit1"], run: kept });
    const off = registry.register({ id: "test.dropped", codes: ["Digit2"], run: dropped });

    off();
    registry.dispatch(key("Digit1"), docWith());
    registry.dispatch(key("Digit2"), docWith());

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("desregistrar duas vezes é inofensivo", () => {
    const registry = createShortcutRegistry();
    const off = registry.register({ id: "test.one", codes: ["Digit1"], run: () => true });

    off();

    expect(() => {
      off();
    }).not.toThrow();
    expect(registry.size()).toBe(0);
  });

  it("uma ação que lança não derruba as outras nem a tecla seguinte", () => {
    const registry = createShortcutRegistry();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const survivor = vi.fn(() => true);
    registry.register({
      id: "test.boom",
      codes: ["Digit1"],
      run: () => {
        throw new Error("quebrou");
      },
    });
    registry.register({ id: "test.survivor", codes: ["Digit1"], run: survivor });

    expect(() => registry.dispatch(key("Digit1"), docWith())).not.toThrow();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("sem document na chamada, o registro usa o da página; sem página, só o evento", () => {
    const registry = createShortcutRegistry();
    const run = vi.fn(() => true);
    registry.register({ id: "test.one", codes: ["Digit1"], run });

    expect(registry.dispatch(key("Digit1"))).toBe(true);
    expect(registry.dispatch(key("Digit1", { target: { tagName: "BUTTON" } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The DOM listener
// ---------------------------------------------------------------------------

describe("o ouvinte do window", () => {
  function fakeTarget() {
    const listeners: Array<{ type: string; handler: (event: KeyboardEvent) => void }> = [];
    return {
      listeners,
      addEventListener: (type: string, handler: (event: KeyboardEvent) => void) => {
        listeners.push({ type, handler });
      },
      removeEventListener: (type: string, handler: (event: KeyboardEvent) => void) => {
        const index = listeners.findIndex((l) => l.type === type && l.handler === handler);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }

  it("nasce com o primeiro registro e morre com o último (nada fica escutando à toa)", () => {
    const target = fakeTarget();
    const registry = createShortcutRegistry({ target });
    expect(target.listeners).toHaveLength(0);

    const offA = registry.register({ id: "a", codes: ["Digit1"], run: () => true });
    const offB = registry.register({ id: "b", codes: ["Digit2"], run: () => true });
    expect(target.listeners).toHaveLength(1);
    expect(target.listeners[0]?.type).toBe("keydown");

    offA();
    expect(target.listeners).toHaveLength(1);
    offB();
    expect(target.listeners).toHaveLength(0);
  });

  it("um único ouvinte para todas as ações", () => {
    const target = fakeTarget();
    const registry = createShortcutRegistry({ target });
    for (let i = 0; i < 13; i += 1)
      registry.register({ id: `x${String(i)}`, codes: ["Digit1"], run: () => false });

    expect(target.listeners).toHaveLength(1);
  });

  it("o ouvinte entrega o evento ao despachante", () => {
    const target = fakeTarget();
    const registry = createShortcutRegistry({ target, document: docWith() });
    const run = vi.fn(() => true);
    registry.register({ id: "a", codes: ["Digit1"], run });

    target.listeners[0]?.handler(key("Digit1") as unknown as KeyboardEvent);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("sem window (ambiente sem DOM) registrar funciona e simplesmente não escuta", () => {
    const registry = createShortcutRegistry({ target: null });

    expect(() => registry.register({ id: "a", codes: ["Digit1"], run: () => true })).not.toThrow();
  });
});
