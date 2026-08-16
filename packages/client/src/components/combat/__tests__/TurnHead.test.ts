/**
 * TurnHead.test.ts — what the head of the turn actually draws (spec 40 §5.3, task G050).
 *
 * Rendered with `render()` from `svelte/server`, like `SidebarDrawer.test.ts`: the client
 * project runs Vitest in a node environment, with no jsdom and no testing-library, so
 * markup is what a component test can look at. Two kinds of assertion follow from that:
 *
 *  - **markup** for everything the server renderer emits — the anchored footer, the
 *    height attribute, the two tags plus "+N", the words that carry a state;
 *  - **the component's own `<style>` block** for the rules the renderer never emits, and
 *    which are the requirement itself: the ellipsis of a long name, the fixed height and
 *    the footer's anchoring.
 *
 * Covers REQ-CBA-020 (head at the top with portrait, name, health and conditions),
 * REQ-CBA-021 (fixed height, advance control anchored to the footer), REQ-CBA-022 (no
 * data changes the height), REQ-CBA-024 (the participant is identified as yours without
 * relying on colour), REQ-CBA-025 (legible truncation) and RNF-CBA-03.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import TurnHead from "../TurnHead.svelte";
import CombatPanelSourceMarker from "../CombatPanel.svelte";
import { TURN_HEAD_HEIGHT_TOKEN, TurnHeadState } from "../../../lib/combat/turnHead.svelte.js";
import type { TurnHeadCondition } from "../../../lib/combat/turnHead.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// The import above is only here so a rename of the panel breaks this file loudly; the
// assertions about the panel read its source, since the panel needs a live socket.
void CombatPanelSourceMarker;

function conditions(count: number): TurnHeadCondition[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cond-${String(i)}`,
    label: `Condição ${String(i)}`,
  }));
}

interface HeadOptions {
  name?: string;
  conditionCount?: number;
  expanded?: boolean;
  isYours?: boolean;
  health?: { current: number; max: number } | null;
}

function renderHead(options: HeadOptions = {}): string {
  const state = new TurnHeadState();
  if (options.expanded === true) state.expand();

  const { body } = render(TurnHead, {
    props: {
      name: options.name ?? "Goblin Guerreiro",
      img: null,
      isYours: options.isYours ?? false,
      health: options.health ?? null,
      conditions: conditions(options.conditionCount ?? 0),
      canAdvance: true,
      canPrevious: true,
      busy: false,
      state,
    },
  });
  return body;
}

/** Everything from the anchored footer onwards — the advance control and its container. */
function footerOf(body: string): string {
  const index = body.indexOf("turn-head__footer");
  expect(index, "the head must render its anchored footer").toBeGreaterThan(-1);
  return body.slice(index);
}

function styleOfTurnHead(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../TurnHead.svelte", import.meta.url)),
    "utf8",
  );
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1];
  if (style === undefined) throw new Error("TurnHead.svelte has no <style> block");
  return style;
}

function combatPanelSource(): string {
  return readFileSync(fileURLToPath(new URL("../CombatPanel.svelte", import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// The control that does not move (REQ-CBA-021, REQ-CBA-022, RNF-CBA-03)
// ---------------------------------------------------------------------------

describe("o controle de avançar não sai do lugar (REQ-CBA-021, RNF-CBA-03)", () => {
  it("desenha o mesmo rodapé com 0, 2 e 7 condições", () => {
    const none = footerOf(renderHead({ conditionCount: 0 }));
    const two = footerOf(renderHead({ conditionCount: 2 }));
    const seven = footerOf(renderHead({ conditionCount: 7 }));

    expect(two).toBe(none);
    expect(seven).toBe(none);
    expect(none).toContain("data-turn-head-advance");
  });

  it("a altura desenhada é o token de tema, sem número, para os três (REQ-CBA-022)", () => {
    const expected = `height: var(${TURN_HEAD_HEIGHT_TOKEN})`;

    for (const conditionCount of [0, 2, 7]) {
      expect(renderHead({ conditionCount })).toContain(expected);
    }
  });

  it("um nome longo também não mexe na altura (REQ-CBA-022)", () => {
    const long = renderHead({ name: "Sacerdotisa Errante das Marés Silenciosas de Absalom" });

    expect(long).toContain(`height: var(${TURN_HEAD_HEIGHT_TOKEN})`);
    expect(footerOf(long)).toBe(footerOf(renderHead({ conditionCount: 0 })));
  });

  it("expandida, a cabeça assume a altura calculada e o rodapé continua sendo o dela", () => {
    const expanded = renderHead({ conditionCount: 7, expanded: true });

    expect(expanded).not.toContain(`height: var(${TURN_HEAD_HEIGHT_TOKEN})`);
    expect(expanded).toMatch(/height:\s*9\.5rem/);
    expect(footerOf(expanded)).toContain("data-turn-head-advance");
  });

  it("o rodapé é ancorado por CSS, não empurrado pelo conteúdo", () => {
    const style = styleOfTurnHead();
    const footer = /\.turn-head__footer\s*\{([\s\S]*?)\}/.exec(style)?.[1] ?? "";

    expect(footer).toMatch(/position:\s*absolute/);
    expect(footer).toMatch(/bottom:\s*0/);

    const head = /\.turn-head\s*\{([\s\S]*?)\}/.exec(style)?.[1] ?? "";
    expect(head).toContain(`var(${TURN_HEAD_HEIGHT_TOKEN})`);
    expect(head).toMatch(/overflow:\s*hidden/);
  });
});

// ---------------------------------------------------------------------------
// What the head shows (REQ-CBA-020, REQ-CBA-024, REQ-CBA-025)
// ---------------------------------------------------------------------------

describe("o que a cabeça mostra (REQ-CBA-020)", () => {
  it("nomeia o participante da vez e o bloco", () => {
    const body = renderHead({ name: "Goblin Guerreiro" });

    expect(body).toContain("Goblin Guerreiro");
    expect(body).toContain(t("FUSION.Combat.TurnHead.Label"));
  });

  it("omite a vida quando não há valor a exibir, sem barra vazia nem zero", () => {
    const body = renderHead({ health: null });

    expect(body).not.toContain("turn-head__health");
  });

  it("desenha barra e número quando a vida é exibível", () => {
    const body = renderHead({ health: { current: 12, max: 40 } });

    expect(body).toContain("turn-head__health");
    expect(body).toContain("12/40");
    expect(body).toContain("width: 30%");
  });
});

describe("identificar o participante como seu (REQ-CBA-024)", () => {
  it("diz em palavra, não só em cor", () => {
    const body = renderHead({ isYours: true });

    expect(body).toContain(t("FUSION.Combat.TurnHead.YourTurn"));
  });

  it("e não diz nada quando o participante da vez não é seu", () => {
    const body = renderHead({ isYours: false });

    expect(body).not.toContain(t("FUSION.Combat.TurnHead.YourTurn"));
  });
});

describe("truncar de forma legível (REQ-CBA-025)", () => {
  it("com sete condições desenha duas etiquetas e o indicador '+5'", () => {
    const body = renderHead({ conditionCount: 7 });
    const tags = body.match(/class="turn-head__condition[ "]/g) ?? [];

    expect(tags).toHaveLength(2);
    expect(body).toContain("+5");
    expect(body).toContain('aria-expanded="false"');
  });

  it("acionar o indicador abre a lista inteira no próprio painel", () => {
    const body = renderHead({ conditionCount: 7, expanded: true });
    const tags = body.match(/class="turn-head__condition[ "]/g) ?? [];

    expect(tags).toHaveLength(7);
    expect(body).toContain('aria-expanded="true"');
  });

  it("o nome ganha reticências e título, nunca uma segunda linha", () => {
    const style = styleOfTurnHead();
    const name = /\.turn-head__name\s*\{([\s\S]*?)\}/.exec(style)?.[1] ?? "";

    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(renderHead({ name: "Sacerdotisa Errante" })).toContain('title="Sacerdotisa Errante"');
  });

  it("nada é cortado no meio de um controle: os controles moram no rodapé", () => {
    const body = renderHead({ conditionCount: 7 });
    const bodyBlock = body.slice(0, body.indexOf("turn-head__footer"));

    expect(bodyBlock).not.toContain("data-turn-head-advance");
  });
});

// ---------------------------------------------------------------------------
// Where the panel puts it (REQ-CBA-020)
// ---------------------------------------------------------------------------

describe("a cabeça fica fora da área rolável (REQ-CBA-020)", () => {
  const source = combatPanelSource();

  it("o painel monta a cabeça antes da lista, não dentro dela", () => {
    const head = source.indexOf("<TurnHead");
    const list = source.indexOf('class="combat-panel__list"');

    expect(head).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(head);
  });

  it("quem rola é a lista; a cabeça não encolhe", () => {
    expect(/\.combat-panel__list\s*\{([\s\S]*?)\}/.exec(source)?.[1] ?? "").toMatch(
      /overflow-y:\s*auto/,
    );
    expect(/\.turn-head\s*\{([\s\S]*?)\}/.exec(styleOfTurnHead())?.[1] ?? "").toMatch(
      /flex-shrink:\s*0/,
    );
  });

  it("com a cabeça no ar, o cabeçalho não repete o botão de avançar (DEC-CBA-02)", () => {
    expect(source).toContain("controls.canNext && !showTurnHead");
    expect(source).toContain("controls.canPrevious && !showTurnHead");
  });
});
