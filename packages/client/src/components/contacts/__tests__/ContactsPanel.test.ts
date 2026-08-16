/**
 * ContactsPanel.test.ts — the panel of the Contatos tab (spec 39 §5.2/§5.3, G062).
 *
 * Covers what only the drawn panel can show: REQ-CTT-010 (a header that is a search
 * field and nothing else — no tab title, no ✕), REQ-CTT-020 (the card's parts),
 * REQ-CTT-021 (no hit points in the markup, for any role), REQ-CTT-022 (the viewer's
 * own card is marked in words as well as in shape), REQ-CTT-023 (the title line and
 * its visibly different fallback), REQ-CTT-024 (who gets the edit control, and that
 * Enter confirms while Esc cancels), REQ-CTT-025 (the sub-character is inside the
 * owner's card), REQ-CTT-027 (double-click plus a keyboard-reachable sheet button)
 * and REQ-CTT-028 (only a privileged role gets a draggable card).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the assertions read the server-rendered markup (`svelte/server`), the component's
 * own stylesheet, and its source for the handlers a rendered string cannot show.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ContactsPanel from "../ContactsPanel.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALEX = "user-alex-000001";
const TOBIAS = "user-tobias-0001";

const FOFURINHA = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  img: "worlds/x/fofurinha.webp",
  ownership: { default: 0, [ALEX]: 3 },
  flags: { fusion: { title: "A Voz do Bosque" } },
  system: {
    details: { class: "Druida", level: 5 },
    // Present on purpose: REQ-CTT-021 only means something if there was something
    // to leak. 37 and 52 must be readable nowhere in the drawn panel.
    attributes: { hp: { value: 37, max: 52 } },
  },
  items: [
    {
      _id: "it-1",
      type: "condition",
      name: "Amedrontado",
      system: { slug: "frightened", value: 2 },
    },
  ],
};

const GRAO = {
  _id: "act-grao000001",
  name: "Grão",
  type: "familiar",
  ownership: { default: 0, [ALEX]: 3 },
  system: { masterActorId: "act-fofurinha01", companionKind: "familiar" },
};

const TOBIAS_PC = {
  _id: "act-tobias00001",
  name: "Tobias",
  type: "character",
  ownership: { default: 0, [TOBIAS]: 3 },
  system: { details: { class: "Guerreiro", level: 5 } },
};

function seedMirror(): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [FOFURINHA, GRAO, TOBIAS_PC] },
  });
}

function renderPanel(options: { isGm?: boolean; userId?: string } = {}): string {
  return render(ContactsPanel, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: options.userId ?? ALEX,
      isGm: options.isGm ?? false,
      activeSceneId: null,
    },
  }).body;
}

function source(): string {
  return readFileSync(fileURLToPath(new URL("../ContactsPanel.svelte", import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for code. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function styleBlock(): string {
  const match = /<style>([\s\S]*)<\/style>/.exec(code());
  if (!match?.[1]) throw new Error("ContactsPanel.svelte has no <style> block");
  return match[1];
}

/** The markup of one card, by actor id. */
function cardOf(body: string, id: string): string {
  const start = body.indexOf(`data-contact-id="${id}"`);
  if (start === -1) throw new Error(`no card for "${id}"`);
  const from = body.lastIndexOf("<div", start);
  const next = body.indexOf('data-contact-id="', start + 1);
  return body.slice(from, next === -1 ? body.length : body.lastIndexOf("<div", next));
}

/**
 * The markup a leak could hide in: everything except the `class` attributes, which
 * carry Svelte's scoped-style hashes (`svelte-3qi37y`) and would make a plain
 * substring search for a number meaningless. Text nodes AND the attributes a
 * screen reader speaks (aria-label, title, alt) stay in, so a value smuggled into
 * a label is still caught.
 */
function withoutStyleHashes(body: string): string {
  return body.replace(/\sclass="[^"]*"/g, "");
}

function drawnOrder(body: string): string[] {
  return [...body.matchAll(/data-contact-id="([^"]+)"/g)].map((m) => m[1] ?? "");
}

beforeEach(() => {
  seedMirror();
});

// ---------------------------------------------------------------------------
// The header — REQ-CTT-010
// ---------------------------------------------------------------------------

describe("the header is a search bar and nothing else (REQ-CTT-010)", () => {
  it("REQ-CTT-010: a full-width search field, no tab title, no ✕", () => {
    const body = renderPanel();

    expect(body).toContain('type="search"');
    expect(body).toContain("Buscar por nome ou título…");
    // The tab's own name belongs to the rail (REQ-GAV-002), never to the panel.
    expect(body).not.toContain(">Contatos<");
    expect(body).not.toContain("✕");
    expect(code()).not.toContain("✕");
  });

  it("REQ-CTT-010: the field takes the width it is given and claims none of its own", () => {
    const css = styleBlock();
    const rule = css.slice(css.indexOf(".contacts-panel__search-input"));

    expect(rule).toContain("flex: 1 1 auto");
    expect(rule).toContain("min-width: 0");
  });
});

// ---------------------------------------------------------------------------
// The card — REQ-CTT-020 / REQ-CTT-021 / REQ-CTT-022
// ---------------------------------------------------------------------------

describe("what the card draws (REQ-CTT-020)", () => {
  it("REQ-CTT-020: name, title, presence and conditions all reach the markup", () => {
    const card = cardOf(renderPanel(), "act-fofurinha01");

    expect(card).toContain("Fofurinha");
    expect(card).toContain("A Voz do Bosque");
    expect(card).toContain("conectado");
    expect(card).toContain("Amedrontado 2");
  });

  it("REQ-CTT-021: no hit points anywhere, for either role", () => {
    for (const body of [renderPanel(), renderPanel({ isGm: true, userId: "user-gm-1" })]) {
      const drawn = withoutStyleHashes(body);
      // Neither value on its own, nor the fraction or bar they would make.
      expect(drawn).not.toMatch(/\b37\b/);
      expect(drawn).not.toMatch(/\b52\b/);
      expect(drawn).not.toMatch(/\bhp\b/i);
    }
    // And the panel never reaches for them: the view model cannot even carry them.
    expect(code()).not.toMatch(/\bhp\b/i);
    expect(code()).not.toMatch(/attributes/);
  });

  it("REQ-CTT-022: the viewer's own card is marked in words, not only by a colour", () => {
    const body = renderPanel();
    const mine = cardOf(body, "act-fofurinha01");
    const other = cardOf(body, "act-tobias00001");

    expect(mine).toContain('data-mine="true"');
    expect(mine).toContain(">você<");
    expect(other).toContain('data-mine="false"');
    expect(other).not.toContain(">você<");
  });

  it("REQ-CTT-022: the mark has a shape of its own in the stylesheet", () => {
    const css = styleBlock();
    const rule = css.slice(css.indexOf(".contact-card--mine"), css.indexOf(".contact-card--away"));

    expect(rule).toContain("border-left");
  });

  it("REQ-CTT-015: presence is spelled out for every card, and never reorders them", () => {
    const body = renderPanel();

    expect(drawnOrder(body)).toEqual(["act-fofurinha01", "act-tobias00001"]);
    expect(cardOf(body, "act-tobias00001")).toContain("fora");
    expect(cardOf(body, "act-tobias00001")).toContain('data-present="false"');
  });
});

// ---------------------------------------------------------------------------
// The title — REQ-CTT-023 / REQ-CTT-024
// ---------------------------------------------------------------------------

describe("the title line under the name (REQ-CTT-023)", () => {
  it("REQ-CTT-023: a written title and a system fallback are drawn as different things", () => {
    const body = renderPanel();

    expect(cardOf(body, "act-fofurinha01")).toContain('data-title-kind="title"');
    const other = cardOf(body, "act-tobias00001");
    expect(other).toContain('data-title-kind="fallback"');
    expect(other).toContain("Guerreiro 5");
    expect(other).toContain("contact-card__title--fallback");
  });

  it("REQ-CTT-023: the fallback modifier carries its own type in the stylesheet", () => {
    const css = styleBlock();
    const rule = css.slice(css.indexOf(".contact-card__title--fallback"));

    expect(rule).toContain("font-style: italic");
  });
});

describe("editing the title in the card (REQ-CTT-024)", () => {
  it("REQ-CTT-024: the owner gets the control and another player does not", () => {
    const asOwner = renderPanel();
    const asOther = renderPanel({ userId: TOBIAS });

    expect(cardOf(asOwner, "act-fofurinha01")).toContain("Editar o título de Fofurinha");
    expect(cardOf(asOther, "act-fofurinha01")).not.toContain("Editar o título de Fofurinha");
  });

  it("REQ-CTT-024: a privileged role gets it on every card", () => {
    const asGm = renderPanel({ isGm: true, userId: "user-gm-1" });

    expect(cardOf(asGm, "act-fofurinha01")).toContain("Editar o título de Fofurinha");
    expect(cardOf(asGm, "act-tobias00001")).toContain("Editar o título de Tobias");
  });

  it("REQ-CTT-024: Enter confirms and Esc cancels, in the card itself", () => {
    const handler = code().slice(code().indexOf("function onTitleKeydown"));

    expect(handler).toContain('event.key === "Enter"');
    expect(handler).toContain("commitTitle");
    expect(handler).toContain('event.key === "Escape"');
    expect(handler).toContain("cancelEditingTitle");
    // The edit happens in the card — no window, no dialog is opened for it.
    // The panel does open ONE window (the "Quem conhece quem" grid of
    // REQ-CTT-061, G065), so the assertion names the title path instead of the
    // whole file: no title function reaches for the window manager, and the one
    // `windowManager.open` in the panel is the knowledge grid's.
    for (const fn of ["startEditingTitle", "cancelEditingTitle", "commitTitle", "onTitleKeydown"]) {
      const body = code().slice(code().indexOf(`function ${fn}`));
      expect(body.slice(0, body.indexOf("\n  }"))).not.toContain("windowManager");
    }
    expect([...code().matchAll(/windowManager\.open/g)]).toHaveLength(1);
    expect(code()).toContain("KnowledgeGridWindow");
    expect(code()).not.toContain('role="dialog"');
  });

  it("REQ-CTT-085: the write is an ordinary doc:update on the actor's own document", () => {
    const commit = code().slice(code().indexOf("async function commitTitle"));

    expect(commit).toContain('type: "doc:update"');
    expect(commit).toContain('documentType: "Actor"');
    expect(commit).toContain("contactTitleDiff");
    // A refusal from the server is surfaced, never swallowed (REQ-CTT-080).
    expect(commit).toContain("titleError");
  });
});

// ---------------------------------------------------------------------------
// Sub-characters — REQ-CTT-025
// ---------------------------------------------------------------------------

describe("the sub-character is inside the owner's card (REQ-CTT-025)", () => {
  it("REQ-CTT-025: the familiar is drawn within its master's card and nowhere else", () => {
    const body = renderPanel();
    const mine = cardOf(body, "act-fofurinha01");

    expect(mine).toContain("Grão");
    expect(mine).toContain('data-sub-of="act-fofurinha01"');
    expect(mine).toContain("Familiar");
    // It is not a card of the list.
    expect(drawnOrder(body)).not.toContain("act-grao000001");
  });
});

// ---------------------------------------------------------------------------
// Opening the sheet and dragging — REQ-CTT-027 / REQ-CTT-028
// ---------------------------------------------------------------------------

describe("opening the sheet (REQ-CTT-027)", () => {
  it("REQ-CTT-027: every card has a real button for the sheet, reachable by keyboard", () => {
    const card = cardOf(renderPanel(), "act-tobias00001");

    expect(card).toMatch(/<button[^>]*aria-label="Abrir a ficha de Tobias"/);
    // A <button> is focusable by construction — no tabindex hack stands in for it.
    expect(card).not.toContain('tabindex="-1"');
  });

  it("REQ-CTT-027: double-click on the card opens the same sheet", () => {
    expect(code()).toContain("ondblclick={() => openSheet(card.id)}");
  });
});

describe("dragging a card to the map (REQ-CTT-028)", () => {
  it("REQ-CTT-028: the player's card is not draggable at all", () => {
    const body = renderPanel();

    expect(body).not.toContain('draggable="true"');
    expect(cardOf(body, "act-fofurinha01")).toContain('draggable="false"');
  });

  it("REQ-CTT-028: the GM's card is draggable, and carries the canvas' own payload", () => {
    const body = renderPanel({ isGm: true, userId: "user-gm-1" });

    expect(cardOf(body, "act-fofurinha01")).toContain('draggable="true"');
    expect(code()).toContain('setData("application/fusion-actor"');
  });
});
