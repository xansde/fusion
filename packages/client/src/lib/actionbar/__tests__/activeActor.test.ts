/**
 * activeActor.test.ts — who the action bar belongs to, and the ownership gate (BAR-F1-01).
 *
 * D-BA01 (Alexandre, 11/10/2026): "não será aceitável que um player veja a barra de ações de
 * um NPC ao selecionar ele". D-BA10: the Mestre with nothing selected has no bar.
 *
 * Every rule of `docs/design/barra-de-acoes/tasks.md` §2.4 (plano §4.2, REQ-BAR-008..010) is
 * written into its case as a LITERAL expected value, never computed by the code under test, so
 * a wrong rule cannot pass by agreeing with itself. I3 is the one invariant whose statement is
 * "the same result as the empty selection": there the empty-selection result is pinned
 * literally too, and each negative case carries a control proving the very same selection IS
 * honoured once the gate allows it — so the refusal is the gate's doing, not a malformed input.
 *
 * Spec: 53-barra-de-acoes.md REQ-BAR-001..005, REQ-BAR-007..010; 41-token.md REQ-TOK-032.
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveActiveActor,
  type ActiveActorInput,
  type ActiveActorResult,
} from "../activeActor.js";

// ---------------------------------------------------------------------------
// Fixtures: three seats at the same table
// ---------------------------------------------------------------------------

const PLAYER = "user-player";
const OTHER_PLAYER = "user-other";
const GM = "user-gm";
const SPECTATOR = "user-spectator";

/** The player's character. */
const PC = "actor-pc";
/** A second character of the same player. */
const PC_2 = "actor-pc-2";
/** Another player's character. */
const OTHER_PC = "actor-pc-other";
/** A creature only the Mestre may see in full. */
const NPC = "actor-npc";
/** The player's companion: its ownership is born as a copy of its owner's (DEC-ATR-19). */
const PET = "actor-pet";
/** The other player's companion. */
const OTHER_PET = "actor-pet-other";

const TOK_PC = "tok-pc";
const TOK_PC_2 = "tok-pc-2";
const TOK_OTHER_PC = "tok-pc-other";
const TOK_NPC = "tok-npc";
const TOK_PET = "tok-pet";
const TOK_OTHER_PET = "tok-pet-other";

type Selection = ActiveActorInput["selection"];
type OwnedCharacters = ActiveActorInput["ownedCharacters"];

interface Seat {
  viewer: { userId: string; isGm: boolean };
  ownedActorIds: ReadonlySet<string>;
  ownedCharacters: OwnedCharacters;
}

/** A player who owns one character and its companion; the character has a token on the map. */
const playerSeat: Seat = {
  viewer: { userId: PLAYER, isGm: false },
  ownedActorIds: new Set([PC, PET]),
  ownedCharacters: [{ actorId: PC, lastUsedAt: null, tokenId: TOK_PC }],
};

/** Another player at the same table, with a character and a companion of their own. */
const otherSeat: Seat = {
  viewer: { userId: OTHER_PLAYER, isGm: false },
  ownedActorIds: new Set([OTHER_PC, OTHER_PET]),
  ownedCharacters: [{ actorId: OTHER_PC, lastUsedAt: null, tokenId: TOK_OTHER_PC }],
};

/**
 * The Mestre. `ownedActorIdsOf` is role-blind (only an ownership ENTRY counts), so a Mestre
 * owns nothing by entry here; seeing any actor comes from the privileged role (REQ-BAR-001).
 */
const gmSeat: Seat = {
  viewer: { userId: GM, isGm: true },
  ownedActorIds: new Set<string>(),
  ownedCharacters: [],
};

/** A player with no character at all. */
const spectatorSeat: Seat = {
  viewer: { userId: SPECTATOR, isGm: false },
  ownedActorIds: new Set<string>(),
  ownedCharacters: [],
};

const everyProvider = (_actorId: string): boolean => true;

function input(
  seat: Seat,
  selection: Selection,
  hasProvider: (actorId: string) => boolean = everyProvider,
): ActiveActorInput {
  return {
    viewer: seat.viewer,
    selection,
    ownedActorIds: seat.ownedActorIds,
    ownedCharacters: seat.ownedCharacters,
    hasProvider,
  };
}

function picked(tokenId: string | null, actorId: string): Selection[number] {
  return { tokenId, actorId };
}

// The literal answers the rules give, written once.
const PLAYER_OWN_CHARACTER: ActiveActorResult = {
  kind: "actor",
  actorId: PC,
  tokenId: TOK_PC,
  via: "own-character",
};
const OTHER_OWN_CHARACTER: ActiveActorResult = {
  kind: "actor",
  actorId: OTHER_PC,
  tokenId: TOK_OTHER_PC,
  via: "own-character",
};
const GM_HIDDEN: ActiveActorResult = { kind: "none", reason: "gm-no-selection" };
const NO_CHARACTER: ActiveActorResult = { kind: "none", reason: "no-character" };

/**
 * Every string a result carries, at any depth. Ids are compared EXACTLY: a substring search
 * would confuse `actor-pc` with `actor-pc-other`.
 */
function valuesIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const item of value) valuesIn(item, into);
  else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) valuesIn(item, into);
  }
  return into;
}

/** Ids a result must never carry when it refused the selection. */
function expectNoTraceOf(result: ActiveActorResult, ...ids: string[]): void {
  const carried = valuesIn(result);
  for (const id of ids) expect(carried.has(id), `result carries ${id}`).toBe(false);
}

// ---------------------------------------------------------------------------
// The rules, case by case (tasks.md, BAR-F1-01 "Teste (TDD)" (a)..(k))
// ---------------------------------------------------------------------------

describe("resolveActiveActor — as regras da §2.4, caso a caso", () => {
  it("(a) jogador seleciona o próprio token → actor/selection", () => {
    expect(resolveActiveActor(input(playerSeat, [picked(TOK_PC, PC)]))).toStrictEqual({
      kind: "actor",
      actorId: PC,
      tokenId: TOK_PC,
      via: "selection",
    });
  });

  it("(a) sem seleção, o jogador fica com o próprio personagem, com o token dele na cena", () => {
    expect(resolveActiveActor(input(playerSeat, []))).toStrictEqual(PLAYER_OWN_CHARACTER);
  });

  it("(b) D-BA01, teste negativo: jogador seleciona um NPC e o resultado é IDÊNTICO ao da seleção vazia", () => {
    const hasProvider = vi.fn(everyProvider);

    const empty = resolveActiveActor(input(playerSeat, [], hasProvider));
    const npc = resolveActiveActor(input(playerSeat, [picked(TOK_NPC, NPC)], hasProvider));

    expect(empty).toStrictEqual(PLAYER_OWN_CHARACTER);
    expect(npc).toStrictEqual(empty);
    expectNoTraceOf(npc, NPC, TOK_NPC);
    // The gate runs BEFORE anything else looks at the selected actor: not even the provider
    // check (what BAR-F1-04 wires to the registry) is ever asked about the NPC (I3, I5).
    expect(hasProvider.mock.calls.flat()).not.toContain(NPC);

    // Control: the SAME selection is honoured for the Mestre, and would be for a player who
    // owned the creature — so the refusal above is the ownership gate, not a broken input.
    expect(resolveActiveActor(input(gmSeat, [picked(TOK_NPC, NPC)]))).toStrictEqual({
      kind: "actor",
      actorId: NPC,
      tokenId: TOK_NPC,
      via: "selection",
    });
    const ownerOfTheCreature: Seat = { ...playerSeat, ownedActorIds: new Set([PC, PET, NPC]) };
    expect(resolveActiveActor(input(ownerOfTheCreature, [picked(TOK_NPC, NPC)]))).toStrictEqual({
      kind: "actor",
      actorId: NPC,
      tokenId: TOK_NPC,
      via: "selection",
    });
  });

  it("(c) D-BA01, teste negativo: jogador seleciona o token de OUTRO jogador e a barra não muda", () => {
    const hasProvider = vi.fn(everyProvider);

    const result = resolveActiveActor(
      input(playerSeat, [picked(TOK_OTHER_PC, OTHER_PC)], hasProvider),
    );

    expect(result).toStrictEqual(PLAYER_OWN_CHARACTER);
    expect(result).toStrictEqual(resolveActiveActor(input(playerSeat, [])));
    expectNoTraceOf(result, OTHER_PC, TOK_OTHER_PC);
    expect(hasProvider.mock.calls.flat()).not.toContain(OTHER_PC);

    // Control: its own owner selecting it gets it.
    expect(resolveActiveActor(input(otherSeat, [picked(TOK_OTHER_PC, OTHER_PC)]))).toStrictEqual({
      kind: "actor",
      actorId: OTHER_PC,
      tokenId: TOK_OTHER_PC,
      via: "selection",
    });
  });

  it("(d) jogador sem personagem e com seleção alheia → none/no-character, igual à seleção vazia", () => {
    expect(resolveActiveActor(input(spectatorSeat, []))).toStrictEqual(NO_CHARACTER);
    for (const selection of [[picked(TOK_NPC, NPC)], [picked(TOK_PC, PC)]]) {
      const result = resolveActiveActor(input(spectatorSeat, selection));
      expect(result).toStrictEqual(NO_CHARACTER);
      expectNoTraceOf(result, NPC, TOK_NPC, PC, TOK_PC);
    }
  });

  it("(e) dois personagens → vale o de maior lastUsedAt", () => {
    const seat = (first: number | null, second: number | null): Seat => ({
      ...playerSeat,
      ownedActorIds: new Set([PC, PC_2]),
      ownedCharacters: [
        { actorId: PC, lastUsedAt: first, tokenId: TOK_PC },
        { actorId: PC_2, lastUsedAt: second, tokenId: TOK_PC_2 },
      ],
    });
    const second: ActiveActorResult = {
      kind: "actor",
      actorId: PC_2,
      tokenId: TOK_PC_2,
      via: "own-character",
    };

    expect(resolveActiveActor(input(seat(100, 200), []))).toStrictEqual(second);
    expect(resolveActiveActor(input(seat(300, 200), []))).toStrictEqual(PLAYER_OWN_CHARACTER);
    // Never used loses to any use.
    expect(resolveActiveActor(input(seat(null, 1), []))).toStrictEqual(second);
    // Tie, or nothing used yet: the order of the mirror decides (the first one).
    expect(resolveActiveActor(input(seat(500, 500), []))).toStrictEqual(PLAYER_OWN_CHARACTER);
    expect(resolveActiveActor(input(seat(null, null), []))).toStrictEqual(PLAYER_OWN_CHARACTER);
  });

  it("(f) Mestre seleciona um NPC → actor/selection; sem seleção → none/gm-no-selection (D-BA10)", () => {
    expect(resolveActiveActor(input(gmSeat, [picked(TOK_NPC, NPC)]))).toStrictEqual({
      kind: "actor",
      actorId: NPC,
      tokenId: TOK_NPC,
      via: "selection",
    });
    expect(resolveActiveActor(input(gmSeat, []))).toStrictEqual(GM_HIDDEN);
  });

  it("(f) D-BA10 vale mesmo para o Mestre que tem personagem: sem seleção, barra oculta", () => {
    const gmWithCharacter: Seat = {
      viewer: { userId: GM, isGm: true },
      ownedActorIds: new Set([PC]),
      ownedCharacters: [{ actorId: PC, lastUsedAt: 1, tokenId: TOK_PC }],
    };
    expect(resolveActiveActor(input(gmWithCharacter, []))).toStrictEqual(GM_HIDDEN);
  });

  it("(g) companheiro do jogador, selecionado por ele e COM provedor → actor/selection", () => {
    expect(resolveActiveActor(input(playerSeat, [picked(TOK_PET, PET)]))).toStrictEqual({
      kind: "actor",
      actorId: PET,
      tokenId: TOK_PET,
      via: "selection",
    });
  });

  it("(g) companheiro SEM provedor (até a BAR-F6-01) → a barra segue no personagem", () => {
    const noCompanionProvider = (actorId: string): boolean => actorId !== PET;
    expect(
      resolveActiveActor(input(playerSeat, [picked(TOK_PET, PET)], noCompanionProvider)),
    ).toStrictEqual(PLAYER_OWN_CHARACTER);
  });

  it("(g) companheiro de outro jogador → igual à seleção vazia, para os dois lados", () => {
    const mine = resolveActiveActor(input(playerSeat, [picked(TOK_OTHER_PET, OTHER_PET)]));
    expect(mine).toStrictEqual(PLAYER_OWN_CHARACTER);
    expectNoTraceOf(mine, OTHER_PET, TOK_OTHER_PET);

    const theirs = resolveActiveActor(input(otherSeat, [picked(TOK_PET, PET)]));
    expect(theirs).toStrictEqual(OTHER_OWN_CHARACTER);
    expectNoTraceOf(theirs, PET, TOK_PET);
  });

  it("(h) OWNER concedido no meio da sessão: a MESMA seleção passa a valer, sem nada novo além da posse", () => {
    const selection = [picked(TOK_NPC, NPC)];
    expect(resolveActiveActor(input(playerSeat, selection))).toStrictEqual(PLAYER_OWN_CHARACTER);

    const afterGrant: Seat = { ...playerSeat, ownedActorIds: new Set([PC, PET, NPC]) };
    expect(resolveActiveActor(input(afterGrant, selection))).toStrictEqual({
      kind: "actor",
      actorId: NPC,
      tokenId: TOK_NPC,
      via: "selection",
    });
  });

  it("(i) troca de cena: o ator selecionado sem token na cena nova segue ativo, com tokenId null", () => {
    expect(resolveActiveActor(input(gmSeat, [picked(null, NPC)]))).toStrictEqual({
      kind: "actor",
      actorId: NPC,
      tokenId: null,
      via: "selection",
    });
    const noTokenHere: Seat = {
      ...playerSeat,
      ownedCharacters: [{ actorId: PC, lastUsedAt: null, tokenId: null }],
    };
    expect(resolveActiveActor(input(noTokenHere, []))).toStrictEqual({
      kind: "actor",
      actorId: PC,
      tokenId: null,
      via: "own-character",
    });
    // Without the optional `tokenId` (the §2.4 shape before the additive field), it is null too.
    const shapeWithoutToken: Seat = {
      ...playerSeat,
      ownedCharacters: [{ actorId: PC, lastUsedAt: null }],
    };
    expect(resolveActiveActor(input(shapeWithoutToken, []))).toStrictEqual({
      kind: "actor",
      actorId: PC,
      tokenId: null,
      via: "own-character",
    });
  });

  it("(j) I2: jogador nunca recebe group; seleção múltipla dele vale a seleção vazia", () => {
    const multi: Selection[] = [
      [picked(TOK_PC, PC), picked(TOK_PET, PET)],
      [picked(TOK_PC, PC), picked(TOK_NPC, NPC)],
      [picked(TOK_NPC, NPC), picked(TOK_OTHER_PC, OTHER_PC)],
      [picked(TOK_PET, PET), picked(TOK_PET, PET)],
    ];
    for (const selection of multi) {
      const result = resolveActiveActor(input(playerSeat, selection));
      expect(result.kind).not.toBe("group");
      expect(result).toStrictEqual(PLAYER_OWN_CHARACTER);
    }
  });

  it("(j) a F1-01 só reserva group: a seleção múltipla do Mestre fica oculta até a BAR-F4-03", () => {
    // BAR-F4-03 replaces this expectation with `kind: "group"` (rule 4).
    expect(
      resolveActiveActor(input(gmSeat, [picked(TOK_NPC, NPC), picked(TOK_PC, PC)])),
    ).toStrictEqual(GM_HIDDEN);
  });

  it("(k) I6: hasProvider falso para o ator selecionado → o resultado da seleção vazia", () => {
    const nothing = (): boolean => false;
    const allButNpc = (actorId: string): boolean => actorId !== NPC;

    // Player: their own token without a provider falls back to their character...
    const onlyTheCharacter = (actorId: string): boolean => actorId === PC;
    expect(
      resolveActiveActor(input(playerSeat, [picked(TOK_PET, PET)], onlyTheCharacter)),
    ).toStrictEqual(PLAYER_OWN_CHARACTER);
    // ...and a character without a provider is never the active actor either.
    expect(resolveActiveActor(input(playerSeat, [], nothing))).toStrictEqual(NO_CHARACTER);

    // Mestre: a selection without a provider hides the bar.
    expect(resolveActiveActor(input(gmSeat, [picked(TOK_NPC, NPC)], allButNpc))).toStrictEqual(
      GM_HIDDEN,
    );
  });
});

// ---------------------------------------------------------------------------
// The invariants I1..I6, over every combination of a small table
// ---------------------------------------------------------------------------

const SEATS: readonly Seat[] = [playerSeat, otherSeat, gmSeat, spectatorSeat];

const SELECTIONS: readonly Selection[] = [
  [],
  [picked(TOK_PC, PC)],
  [picked(TOK_PC_2, PC_2)],
  [picked(TOK_OTHER_PC, OTHER_PC)],
  [picked(TOK_NPC, NPC)],
  [picked(TOK_PET, PET)],
  [picked(TOK_OTHER_PET, OTHER_PET)],
  [picked(null, NPC)],
  [picked(TOK_PC, PC), picked(TOK_NPC, NPC)],
  [picked(TOK_NPC, NPC), picked(TOK_OTHER_PET, OTHER_PET)],
];

const PROVIDER_CHECKS: ReadonlyArray<(actorId: string) => boolean> = [
  everyProvider,
  () => false,
  (actorId) => actorId !== PET && actorId !== OTHER_PET,
  (actorId) => actorId === NPC,
];

function* everyCombination(): Generator<{
  seat: Seat;
  selection: Selection;
  hasProvider: (actorId: string) => boolean;
}> {
  for (const seat of SEATS) {
    for (const selection of SELECTIONS) {
      for (const hasProvider of PROVIDER_CHECKS) yield { seat, selection, hasProvider };
    }
  }
}

describe("resolveActiveActor — invariantes I1..I6", () => {
  it("I1: kind actor ⇒ Mestre, ou ator em ownedActorIds", () => {
    for (const { seat, selection, hasProvider } of everyCombination()) {
      const result = resolveActiveActor(input(seat, selection, hasProvider));
      if (result.kind !== "actor") continue;
      expect(seat.viewer.isGm || seat.ownedActorIds.has(result.actorId)).toBe(true);
    }
  });

  it("I2: kind group ⇒ Mestre", () => {
    for (const { seat, selection, hasProvider } of everyCombination()) {
      const result = resolveActiveActor(input(seat, selection, hasProvider));
      if (result.kind === "group") expect(seat.viewer.isGm).toBe(true);
    }
  });

  it("I3: para jogador, seleção com ator alheio = seleção vazia, e o ator alheio nunca é consultado", () => {
    let refusals = 0;
    for (const { seat, selection, hasProvider } of everyCombination()) {
      if (seat.viewer.isGm) continue;
      const foreign = selection
        .map((entry) => entry.actorId)
        .filter((actorId) => !seat.ownedActorIds.has(actorId));
      if (foreign.length === 0) continue;

      const spy = vi.fn(hasProvider);
      const result = resolveActiveActor(input(seat, selection, spy));
      expect(result).toStrictEqual(resolveActiveActor(input(seat, [], hasProvider)));
      for (const actorId of foreign) {
        expect(spy.mock.calls.flat()).not.toContain(actorId);
      }
      expectNoTraceOf(result, ...foreign);
      refusals += 1;
    }
    // The table really exercises the refusal (not a vacuous loop).
    expect(refusals).toBeGreaterThan(20);
  });

  it("I4: Mestre com seleção vazia ⇒ none (D-BA10)", () => {
    for (const hasProvider of PROVIDER_CHECKS) {
      expect(resolveActiveActor(input(gmSeat, [], hasProvider))).toStrictEqual(GM_HIDDEN);
    }
  });

  it("I5: função pura — mesma entrada, mesmo resultado, e a entrada sai intacta", () => {
    for (const { seat, selection, hasProvider } of everyCombination()) {
      const frozenSelection = Object.freeze(
        selection.map((entry) => Object.freeze({ ...entry })),
      ) as Selection;
      const frozenCharacters = Object.freeze(
        seat.ownedCharacters.map((entry) => Object.freeze({ ...entry })),
      ) as OwnedCharacters;
      const owned = new Set(seat.ownedActorIds);
      const frozenInput: ActiveActorInput = Object.freeze({
        viewer: Object.freeze({ ...seat.viewer }),
        selection: frozenSelection,
        ownedActorIds: owned,
        ownedCharacters: frozenCharacters,
        hasProvider,
      });

      const first = resolveActiveActor(frozenInput);
      const second = resolveActiveActor(frozenInput);
      expect(second).toStrictEqual(first);
      expect([...owned].sort()).toEqual([...seat.ownedActorIds].sort());
    }
  });

  it("I6: um ator sem provedor nunca é o ativo", () => {
    for (const { seat, selection, hasProvider } of everyCombination()) {
      const result = resolveActiveActor(input(seat, selection, hasProvider));
      if (result.kind === "actor") expect(hasProvider(result.actorId)).toBe(true);
    }
  });
});
