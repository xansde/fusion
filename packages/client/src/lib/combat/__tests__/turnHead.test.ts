/**
 * turnHead.test.ts — the head of the turn keeps its height, and its button keeps its place.
 *
 * Spec 40 (`specs/40-aba-combate.md`) §5.3 / DEC-CBA-02, task G050. The assertions here
 * are about geometry and about one gesture, both of which live in
 * `lib/combat/turnHead.svelte.ts` precisely so that a test in a node environment (no DOM,
 * no layout engine) can measure them: the head's height and the offset of the advance
 * control are computed values, not something only the browser knows.
 *
 * Covers REQ-CBA-021 (fixed height from a theme token, advance control anchored to the
 * head's footer), REQ-CBA-022 (only an explicit gesture grows it), REQ-CBA-023 (advancing
 * or rewinding drops the expansion) and RNF-CBA-03 (two consecutive turns with different
 * participants keep the control on the same coordinate). REQ-CBA-025's tag ceiling is
 * here too, as the part of "truncated legibly" that is a number and not a CSS rule.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  TURN_HEAD_CONDITION_TAG_LIMIT,
  TURN_HEAD_FOOTER_HEIGHT_REM,
  TURN_HEAD_FOOTER_HEIGHT_TOKEN,
  TURN_HEAD_HEIGHT_REM,
  TURN_HEAD_HEIGHT_TOKEN,
  TurnHeadState,
  summarizeTurnHeadConditions,
  turnHeadMetrics,
  turnKeyOf,
} from "../turnHead.svelte.js";
import type { TurnHeadCondition } from "../turnHead.svelte.js";

function conditions(count: number): TurnHeadCondition[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cond-${String(i)}`,
    label: `Condição ${String(i)}`,
  }));
}

// ---------------------------------------------------------------------------
// The height does not depend on the data (REQ-CBA-021, REQ-CBA-022, RNF-CBA-03)
// ---------------------------------------------------------------------------

describe("altura fixa da cabeça de turno (REQ-CBA-021, RNF-CBA-03)", () => {
  it("mantém a mesma coordenada do controle de avançar com 0, 2 e 7 condições", () => {
    const none = turnHeadMetrics(0, false);
    const two = turnHeadMetrics(2, false);
    const seven = turnHeadMetrics(7, false);

    expect(two).toEqual(none);
    expect(seven).toEqual(none);
    expect(seven.advanceControlTopRem).toBe(none.advanceControlTopRem);
  });

  it("a altura padrão é a do token de tema, para qualquer participante (REQ-CBA-021)", () => {
    for (const count of [0, 1, 2, 3, 7, 20]) {
      expect(turnHeadMetrics(count, false).heightRem).toBe(TURN_HEAD_HEIGHT_REM);
    }
  });

  it("dois turnos seguidos com participantes diferentes não movem o botão (RNF-CBA-03)", () => {
    const state = new TurnHeadState();

    state.syncTurn(turnKeyOf({ round: 1, activeCombatantId: "sem-condicao" }));
    const first = state.metrics(0);

    state.syncTurn(turnKeyOf({ round: 1, activeCombatantId: "com-sete-condicoes" }));
    const second = state.metrics(7);

    expect(second.advanceControlTopRem).toBe(first.advanceControlTopRem);
    expect(second.heightRem).toBe(first.heightRem);
  });
});

describe("a cabeça só cresce por gesto explícito (REQ-CBA-022)", () => {
  it("expandir é o único caminho para uma altura diferente da padrão", () => {
    const state = new TurnHeadState();

    expect(state.metrics(7).heightRem).toBe(TURN_HEAD_HEIGHT_REM);

    state.expand();
    expect(state.metrics(7).heightRem).toBeGreaterThan(TURN_HEAD_HEIGHT_REM);

    state.collapse();
    expect(state.metrics(7).heightRem).toBe(TURN_HEAD_HEIGHT_REM);
  });

  it("mesmo expandida, o controle continua ancorado no rodapé da cabeça (REQ-CBA-021)", () => {
    const collapsed = turnHeadMetrics(7, false);
    const expanded = turnHeadMetrics(7, true);

    expect(expanded.heightRem).toBeGreaterThan(collapsed.heightRem);
    expect(expanded.heightRem - expanded.advanceControlTopRem).toBe(TURN_HEAD_FOOTER_HEIGHT_REM);
    expect(collapsed.heightRem - collapsed.advanceControlTopRem).toBe(TURN_HEAD_FOOTER_HEIGHT_REM);
  });

  it("expandir quem cabe na altura padrão não cresce nada", () => {
    expect(turnHeadMetrics(2, true)).toEqual(turnHeadMetrics(2, false));
  });
});

// ---------------------------------------------------------------------------
// The expansion belongs to the turn (REQ-CBA-023)
// ---------------------------------------------------------------------------

describe("a expansão é do turno, não do painel (REQ-CBA-023)", () => {
  it("avançar o turno descarta a expansão do turno anterior", () => {
    const state = new TurnHeadState();
    state.syncTurn(turnKeyOf({ round: 2, activeCombatantId: "goblin" }));
    state.expand();
    expect(state.expanded).toBe(true);

    state.syncTurn(turnKeyOf({ round: 2, activeCombatantId: "ladina" }));

    expect(state.expanded).toBe(false);
    expect(state.metrics(7).heightRem).toBe(TURN_HEAD_HEIGHT_REM);
  });

  it("recuar o turno descarta a expansão do mesmo jeito", () => {
    const state = new TurnHeadState();
    state.syncTurn(turnKeyOf({ round: 2, activeCombatantId: "goblin" }));
    state.syncTurn(turnKeyOf({ round: 2, activeCombatantId: "ladina" }));
    state.expand();

    state.syncTurn(turnKeyOf({ round: 2, activeCombatantId: "goblin" }));

    expect(state.expanded).toBe(false);
  });

  it("virar a rodada com o mesmo participante ainda é um turno novo", () => {
    const state = new TurnHeadState();
    state.syncTurn(turnKeyOf({ round: 1, activeCombatantId: "unico" }));
    state.expand();

    state.syncTurn(turnKeyOf({ round: 2, activeCombatantId: "unico" }));

    expect(state.expanded).toBe(false);
  });

  it("uma remontagem do mesmo turno preserva o que o usuário abriu", () => {
    const state = new TurnHeadState();
    const key = turnKeyOf({ round: 3, activeCombatantId: "goblin" });
    state.syncTurn(key);
    state.expand();

    state.syncTurn(key);

    expect(state.expanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Truncation ceiling (REQ-CBA-025, ceiling of REQ-CBA-051)
// ---------------------------------------------------------------------------

describe("teto de etiquetas de condição (REQ-CBA-025)", () => {
  it("mostra duas etiquetas e dobra o resto em '+N'", () => {
    const view = summarizeTurnHeadConditions(conditions(7), false);

    expect(view.visible).toHaveLength(TURN_HEAD_CONDITION_TAG_LIMIT);
    expect(view.overflow).toBe(5);
    expect(view.total).toBe(7);
  });

  it("não inventa indicador quando tudo cabe", () => {
    const view = summarizeTurnHeadConditions(conditions(2), false);

    expect(view.visible).toHaveLength(2);
    expect(view.overflow).toBe(0);
  });

  it("expandida, mostra a lista inteira e some com o indicador", () => {
    const view = summarizeTurnHeadConditions(conditions(7), true);

    expect(view.visible).toHaveLength(7);
    expect(view.overflow).toBe(0);
  });

  it("preserva a ordem que recebeu — agrupar é do contrato da condição, não da cabeça", () => {
    const list = conditions(5);
    const view = summarizeTurnHeadConditions(list, false);

    expect(view.visible.map((c) => c.id)).toEqual([list[0]?.id, list[1]?.id]);
  });
});

// ---------------------------------------------------------------------------
// The theme token is the source of the height (REQ-CBA-021)
// ---------------------------------------------------------------------------

describe("a altura vem de token de tema (REQ-CBA-021)", () => {
  const baseCss = readFileSync(
    fileURLToPath(new URL("../../../styles/base.css", import.meta.url)),
    "utf8",
  );

  it("base.css declara os dois tokens da cabeça com os valores espelhados no módulo", () => {
    expect(baseCss).toContain(`${TURN_HEAD_HEIGHT_TOKEN}: ${String(TURN_HEAD_HEIGHT_REM)}rem;`);
    expect(baseCss).toContain(
      `${TURN_HEAD_FOOTER_HEIGHT_TOKEN}: ${String(TURN_HEAD_FOOTER_HEIGHT_REM)}rem;`,
    );
  });
});

// ---------------------------------------------------------------------------
// Turn key
// ---------------------------------------------------------------------------

describe("chave do turno", () => {
  it("sem encontro não há turno", () => {
    expect(turnKeyOf(null)).toBe("");
  });

  it("participante da vez ausente ainda é uma chave estável", () => {
    expect(turnKeyOf({ round: 1, activeCombatantId: null })).toBe(
      turnKeyOf({ round: 1, activeCombatantId: null }),
    );
    expect(turnKeyOf({ round: 1, activeCombatantId: null })).not.toBe(
      turnKeyOf({ round: 2, activeCombatantId: null }),
    );
  });
});
