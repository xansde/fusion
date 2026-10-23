/**
 * ContactsPanelEmpty.test.ts — empty states and accessibility of the Contatos tab
 * (spec 39 §5.10, G066).
 *
 * Covers REQ-CTT-090 (an empty state of its own for each role when no character is
 * visible), REQ-CTT-091 (the Conhecidos section says names show up as the story
 * introduces them), REQ-CTT-092 (no empty state offers to create an actor — and this
 * panel has no path that creates one at all, DEC-CTT-01), REQ-CTT-093 (every control
 * is keyboard-operable with visible focus, in the panel AND in the knowledge window)
 * and REQ-CTT-094 (state, presence and "my character" are never colour alone).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the assertions read the server-rendered markup (`svelte/server`), the components'
 * own stylesheets, and their source for what a rendered string cannot show.
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
const GM = "user-gm-000001";

const FOFURINHA = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
  system: { details: { class: "Druida", level: 5 } },
  items: [
    {
      _id: "it-1",
      type: "condition",
      name: "Amedrontado",
      system: { slug: "frightened", value: 2 },
    },
  ],
};

/** A contact at `conhecido`: it arrives whole. */
const FERREIRA = {
  _id: "act-ferreira001",
  name: "Dona Bruna",
  type: "npc",
  ownership: { default: 2 },
};

/** A contact at `entrevisto`: stripped by the server, only the marker left. */
const GLIMPSED = {
  _id: "act-vulto000001",
  type: "npc",
  flags: { fusion: { glimpsed: true } },
};

function seed(actors: readonly Record<string, unknown>[]): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [...actors] },
  } as never);
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

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for code. */
function codeOf(file: string): string {
  return sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function styleOf(file: string): string {
  const match = /<style>([\s\S]*)<\/style>/.exec(codeOf(file));
  if (!match?.[1]) throw new Error(`${file} has no <style> block`);
  return match[1];
}

/** The markup of one empty-state paragraph, by its `data-empty` value. */
function emptyBlock(body: string, kind: string): string {
  const at = body.indexOf(`data-empty="${kind}"`);
  if (at === -1) throw new Error(`no empty state "${kind}"`);
  const from = body.lastIndexOf("<p", at);
  return body.slice(from, body.indexOf("</p>", at) + 4);
}

beforeEach(() => {
  seed([]);
});

// ---------------------------------------------------------------------------
// The empty states — REQ-CTT-090 / REQ-CTT-091 / REQ-CTT-092
// ---------------------------------------------------------------------------

describe("the table's empty state is one per role (REQ-CTT-090)", () => {
  it("REQ-CTT-090: the player is told he has no character at this table", () => {
    const body = renderPanel();

    expect(body).toContain('data-empty-role="player"');
    expect(emptyBlock(body, "table")).toContain("Você ainda não tem personagem nesta mesa.");
    expect(body).not.toContain("Nenhum personagem de jogador ainda.");
  });

  it("REQ-CTT-090: the Mestre is told no player character exists yet", () => {
    const body = renderPanel({ isGm: true, userId: GM });

    expect(body).toContain('data-empty-role="gm"');
    expect(emptyBlock(body, "table")).toContain("Nenhum personagem de jogador ainda.");
    expect(body).not.toContain("Você ainda não tem personagem nesta mesa.");
  });

  it("REQ-CTT-090: a contact on its own is not a character — the table is still empty", () => {
    seed([FERREIRA, GLIMPSED]);

    expect(renderPanel()).toContain('data-empty="table"');
  });

  it("REQ-CTT-090: with a character on the table there is no empty state at all", () => {
    seed([FOFURINHA]);
    const body = renderPanel();

    expect(body).not.toContain('data-empty="table"');
    expect(body).toContain("Fofurinha");
  });
});

describe("the Conhecidos empty state (REQ-CTT-091)", () => {
  it("REQ-CTT-091: with characters and nobody introduced, the promise is spelled out", () => {
    seed([FOFURINHA]);
    const body = renderPanel();

    expect(emptyBlock(body, "known")).toContain(
      "Os nomes aparecem conforme a história os apresenta.",
    );
  });

  it("REQ-CTT-091: a single glimpsed contact is already someone — the empty state goes", () => {
    seed([FOFURINHA, GLIMPSED]);
    const body = renderPanel();

    expect(body).not.toContain('data-empty="known"');
    expect(body).toContain("Não identificado");
  });

  it("REQ-CTT-091: the same for a Mestre with contacts but no player character", () => {
    seed([FERREIRA]);
    const body = renderPanel({ isGm: true, userId: GM });

    expect(body).toContain('data-empty="table"');
    expect(body).not.toContain('data-empty="known"');
  });
});

describe("no empty state offers to create an actor (REQ-CTT-092)", () => {
  it("REQ-CTT-092: neither empty paragraph carries a control of any kind", () => {
    const player = renderPanel();
    seed([FOFURINHA]);
    const withTable = renderPanel();

    for (const block of [emptyBlock(player, "table"), emptyBlock(withTable, "known")]) {
      expect(block).not.toContain("<button");
      expect(block).not.toContain("<a ");
      expect(block).not.toMatch(/criar|novo|nova/i);
    }
  });

  it("REQ-CTT-092: the panel has no path that creates an actor at all (DEC-CTT-01)", () => {
    const code = codeOf("ContactsPanel.svelte");

    expect(code).not.toContain("doc:create");
    expect(code).not.toContain("doc:delete");
    // The only ops this tab sends are the title write (REQ-CTT-085) and, from the
    // knowledge window, `actor:setKnowledge` (REQ-CTT-062).
    expect([...code.matchAll(/type: "([a-zA-Z]+:[a-zA-Z]+)"/g)].map((m) => m[1])).toEqual([
      "doc:update",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Accessibility — REQ-CTT-093 / REQ-CTT-094
// ---------------------------------------------------------------------------

describe("every control is operable by keyboard with visible focus (REQ-CTT-093)", () => {
  it("REQ-CTT-093: the panel outlines whatever has focus, on the element itself", () => {
    const css = styleOf("ContactsPanel.svelte");
    const rule = css.slice(css.indexOf(".contacts-panel button:focus-visible"));

    expect(rule).toContain("input:focus-visible");
    expect(rule).toContain("select:focus-visible");
    expect(rule.slice(0, rule.indexOf("}"))).toContain("outline:");
  });

  it("REQ-CTT-093: the knowledge window outlines its cells too", () => {
    const css = styleOf("KnowledgeGridWindow.svelte");
    const rule = css.slice(css.indexOf(".knowledge-grid button:focus-visible"));

    expect(rule.slice(0, rule.indexOf("}"))).toContain("outline:");
  });

  it("REQ-CTT-093: every acting control is a real element, never a clickable div", () => {
    seed([FOFURINHA, FERREIRA, GLIMPSED]);
    const body = renderPanel({ isGm: true, userId: GM });

    // Nothing is dragged out of the tab order to be re-added by hand.
    expect(body).not.toContain('tabindex="-1"');
    expect(body).not.toContain('role="button"');
    // Title editing, categories and the sheet are buttons and inputs, and the
    // Mestre's footer is one as well.
    expect(body).toMatch(/<button[^>]*aria-label="Editar o título de Fofurinha"/);
    expect(body).toMatch(/<button[^>]*aria-label="Abrir a ficha de Dona Bruna"/);
    expect(body).toMatch(/<button[^>]*aria-label="Quem conhece quem"/);
    // Every category control names what it acts on, so a screen reader is not left
    // with four identical "button"s in a row.
    expect(body).toContain("Nova categoria");
  });

  it("REQ-CTT-093: the condition chip reaches the card whole, with nothing pulled out of the tab order", () => {
    seed([FOFURINHA]);
    const body = renderPanel();

    // The shared chip draws the label and its tone; its tooltip trigger takes a
    // tabindex exactly when the system declares help for the condition, which is
    // the chip's own contract (G063). Nothing here takes that reach away.
    expect(body).toMatch(/class="condition-chip[^"]*"/);
    expect(body).toContain("Amedrontado 2");
    expect(body).not.toMatch(/class="condition-chip[^"]*"[^>]*tabindex="-1"/);
  });
});

describe("nothing is said by colour alone (REQ-CTT-094)", () => {
  it("REQ-CTT-094: presence, 'you' and the unidentified contact are all words", () => {
    seed([FOFURINHA, FERREIRA, GLIMPSED]);
    const body = renderPanel();

    // Presence (REQ-CTT-015): a word beside the dot, and the dot is decoration.
    expect(body).toContain("conectado");
    expect(body).toMatch(/class="contact-card__presence-dot[^"]*"\s+aria-hidden="true"/);
    // "My character" (REQ-CTT-022): the word, plus a shape in the stylesheet.
    expect(body).toContain(">você<");
    expect(styleOf("ContactsPanel.svelte")).toContain("border-left");
    // A glimpsed contact (REQ-CTT-041): said in words, and drawn as a dashed card.
    expect(body).toContain("Não identificado");
    expect(styleOf("ContactsPanel.svelte")).toContain("border-style: dashed");
  });

  it("REQ-CTT-094: the knowledge state is written out in the window, not only shaded", () => {
    const code = codeOf("KnowledgeGridWindow.svelte");

    // Each cell's symbol is decoration (aria-hidden); the state — and, for an
    // exception, the word itself — reaches assistive tech through the
    // accessible name (aria-label), never through colour alone.
    expect(code).toContain('<span class="knowledge-grid__state-symbol" aria-hidden="true"');
    expect(code).toContain("FUSION.Contacts.Knowledge.CycleCellException");
    // The legend spells every state out in words next to its swatch.
    expect(code).toContain('class="knowledge-grid__swatch" data-state={state} aria-hidden="true"');
    expect(code).toContain("{stateLabel(state)}");
  });

  it("REQ-CTT-094: a condition carries its tone in words as well as in its hue", () => {
    seed([FOFURINHA]);

    expect(renderPanel()).toContain("condition-chip__meaning");
  });
});
