/**
 * turn.test.ts — whose turn the status strip says it is, and who may end it (BAR-F1-04; spec 53
 * REQ-BAR-035, REQ-BAR-040, Q-BAR-08; spec 40 REQ-CBA-072, REQ-CBA-081, REQ-CBA-082).
 *
 * The strip answers "de quem é a vez" outside the drawer: "Seu turno · Rodada N" when the
 * participant on the clock is the viewer's, the turn of another participant, "Fora de combate"
 * when there is no encounter in progress. A participant the viewer may not see is NEVER revealed
 * (REQ-CBA-082): the server masks `activeCombatantId` for a player when the active participant is
 * hidden, and the strip must not undo that.
 *
 * "Encerrar turno" is a convenience, not protection: the server decides who may advance the turn
 * (REQ-CBA-080/081). So these tests pin only WHEN the button is offered.
 */

import { describe, expect, it } from "vitest";

import { endTurnAvailable, inEncounter, turnView, type TurnCombat } from "../turn.js";

function combat(overrides: Partial<TurnCombat> = {}): TurnCombat {
  return {
    started: true,
    ended: false,
    round: 2,
    activeCombatantId: "c-capitao",
    combatants: [
      { _id: "c-huo", actorId: "actor-huo", name: "Huo Jinwu", hidden: false },
      { _id: "c-capitao", actorId: "actor-capitao", name: "Capitão Bandido", hidden: false },
    ],
    ...overrides,
  };
}

describe("inEncounter — há encontro em andamento", () => {
  it("só começado e não encerrado", () => {
    expect(inEncounter(combat())).toBe(true);
    expect(inEncounter(combat({ started: false }))).toBe(false);
    expect(inEncounter(combat({ ended: true }))).toBe(false);
    expect(inEncounter(null)).toBe(false);
  });
});

describe("turnView — de quem é a vez (REQ-BAR-040)", () => {
  it("sem encontro, ou em montagem, ou encerrado: Fora de combate", () => {
    const input = { isMyTurn: false, actorId: "actor-huo", viewerIsGm: false };

    expect(turnView({ ...input, combat: null })).toEqual({ kind: "out" });
    expect(turnView({ ...input, combat: combat({ started: false }) })).toEqual({ kind: "out" });
    expect(turnView({ ...input, combat: combat({ ended: true }) })).toEqual({ kind: "out" });
  });

  it("a vez do próprio usuário: Seu turno, com a rodada", () => {
    expect(
      turnView({
        combat: combat({ activeCombatantId: "c-huo" }),
        isMyTurn: true,
        actorId: "actor-huo",
        viewerIsGm: false,
      }),
    ).toEqual({ kind: "mine", round: 2 });
  });

  it("a vez de outro participante visível: o nome dele", () => {
    expect(
      turnView({ combat: combat(), isMyTurn: false, actorId: "actor-huo", viewerIsGm: false }),
    ).toEqual({ kind: "other", name: "Capitão Bandido" });
  });

  it("o Mestre com o NPC da vez selecionado: o turno é do ator da barra (T6)", () => {
    expect(
      turnView({ combat: combat(), isMyTurn: false, actorId: "actor-capitao", viewerIsGm: true }),
    ).toEqual({ kind: "actor", name: "Capitão Bandido", round: 2 });
  });

  it("REQ-CBA-082: o servidor mascarou o participante oculto — a faixa só diz que há combate, sem nome", () => {
    const masked = combat({
      activeCombatantId: null,
      combatants: [
        { _id: "c-huo", actorId: "actor-huo", name: "Huo Jinwu", hidden: false },
        // O servidor já tirou do jogador o combatente oculto; este está aqui só para provar que nada o lê.
        { _id: "c-secreto", actorId: "actor-secreto", name: "Assassino Oculto", hidden: true },
      ],
    });

    const view = turnView({
      combat: masked,
      isMyTurn: false,
      actorId: "actor-huo",
      viewerIsGm: false,
    });

    expect(view).toEqual({ kind: "running", round: 2 });
    expect(JSON.stringify(view)).not.toContain("Assassino");
  });

  it("defesa em profundidade: um oculto que vazou até a tela do jogador continua sem nome", () => {
    const leaked = combat({
      activeCombatantId: "c-secreto",
      combatants: [
        { _id: "c-huo", actorId: "actor-huo", name: "Huo Jinwu", hidden: false },
        { _id: "c-secreto", actorId: "actor-secreto", name: "Assassino Oculto", hidden: true },
      ],
    });

    const view = turnView({
      combat: leaked,
      isMyTurn: false,
      actorId: "actor-huo",
      viewerIsGm: false,
    });

    expect(view).toEqual({ kind: "running", round: 2 });
    expect(JSON.stringify(view)).not.toContain("Assassino");
  });

  it("o Mestre vê o participante oculto da vez, pelo nome", () => {
    const hiddenTurn = combat({
      activeCombatantId: "c-secreto",
      combatants: [
        { _id: "c-secreto", actorId: "actor-secreto", name: "Assassino Oculto", hidden: true },
      ],
    });

    expect(
      turnView({ combat: hiddenTurn, isMyTurn: false, actorId: "actor-huo", viewerIsGm: true }),
    ).toEqual({ kind: "other", name: "Assassino Oculto" });
  });

  it("id da vez que não está na lista (lista redigida): só há combate, sem nome", () => {
    expect(
      turnView({
        combat: combat({ activeCombatantId: "c-fantasma" }),
        isMyTurn: false,
        actorId: "actor-huo",
        viewerIsGm: false,
      }),
    ).toEqual({ kind: "running", round: 2 });
  });
});

describe("endTurnAvailable — Encerrar turno (REQ-BAR-035, Q-BAR-08)", () => {
  it("o jogador só no turno dele", () => {
    expect(endTurnAvailable({ combat: combat(), isMyTurn: true, viewerIsGm: false })).toBe(true);
    expect(endTurnAvailable({ combat: combat(), isMyTurn: false, viewerIsGm: false })).toBe(false);
  });

  it("o Mestre em qualquer turno de encontro em andamento (Q-BAR-08)", () => {
    expect(endTurnAvailable({ combat: combat(), isMyTurn: false, viewerIsGm: true })).toBe(true);
    expect(endTurnAvailable({ combat: combat(), isMyTurn: true, viewerIsGm: true })).toBe(true);
  });

  it("nunca fora de um encontro em andamento — nem para o Mestre", () => {
    expect(endTurnAvailable({ combat: null, isMyTurn: true, viewerIsGm: true })).toBe(false);
    expect(
      endTurnAvailable({ combat: combat({ started: false }), isMyTurn: false, viewerIsGm: true }),
    ).toBe(false);
    expect(
      endTurnAvailable({ combat: combat({ ended: true }), isMyTurn: true, viewerIsGm: false }),
    ).toBe(false);
  });
});
