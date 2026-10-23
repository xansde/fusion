/**
 * barContext.test.ts — the `ActionBarContext` the shell hands a provider (BAR-F1-04; spec 53 §7.1,
 * REQ-BAR-003, REQ-BAR-040; tasks.md §2.3).
 *
 * The context is built ONLY from an actor the ownership gate let through (§2.4): the builder takes
 * the already-resolved actor and has no way to look up another one. What it adds to the document is
 * display data — the derived values the sheet reads, where the actor's token is, and the combat
 * facts the strip shows (is there an encounter, which round, is the participant on the clock the
 * viewer's, which targets are marked).
 */

import { describe, expect, it } from "vitest";
import { OwnershipLevel, type CombatDocument } from "@fusion/shared";

import { buildActionBarContext } from "../barContext.js";

const ACTOR = {
  _id: "actor-huo",
  type: "character",
  name: "Huo Jinwu",
  ownership: { default: OwnershipLevel.NONE, "user-huo": OwnershipLevel.OWNER },
  system: { derived: { hp: { value: 27, max: 33 } } },
};

function combat(overrides: Partial<CombatDocument> = {}): CombatDocument {
  return {
    _id: "combat-1",
    started: true,
    ended: false,
    round: 2,
    activeCombatantId: "c-huo",
    combatants: [
      { _id: "c-huo", actorId: "actor-huo", name: "Huo Jinwu", hidden: false },
      { _id: "c-capitao", actorId: "actor-capitao", name: "Capitão Bandido", hidden: false },
    ],
    ...overrides,
  } as unknown as CombatDocument;
}

const base = {
  active: { actorId: "actor-huo", tokenId: "tok-huo" },
  actor: ACTOR as Record<string, unknown>,
  viewer: { userId: "user-huo", isGm: false },
  combat: null as CombatDocument | null,
  ownedActorIds: new Set(["actor-huo"]) as ReadonlySet<string>,
  targets: [] as Array<{ tokenId: string; actorId: string | null; name: string }>,
};

describe("buildActionBarContext — o ator, o que ele deriva e quem olha", () => {
  it("leva o documento do ator ativo, o id e o token da cena", () => {
    const ctx = buildActionBarContext(base);

    expect(ctx.actorId).toBe("actor-huo");
    expect(ctx.actor).toBe(ACTOR);
    expect(ctx.tokenId).toBe("tok-huo");
    expect(ctx.viewer).toEqual({ userId: "user-huo", isGm: false });
  });

  it("personagem do jogador sem token na cena: tokenId nulo", () => {
    const ctx = buildActionBarContext({ ...base, active: { actorId: "actor-huo", tokenId: null } });

    expect(ctx.tokenId).toBeNull();
  });

  it("derived é o system.derived do ator, que o servidor recalcula", () => {
    const ctx = buildActionBarContext(base);

    expect(ctx.derived).toEqual({ hp: { value: 27, max: 33 } });
  });

  it("sem system.derived (ator recém-criado, ou system malformado) o derived é um objeto vazio", () => {
    expect(buildActionBarContext({ ...base, actor: { _id: "a", system: {} } }).derived).toEqual({});
    expect(buildActionBarContext({ ...base, actor: { _id: "a" } }).derived).toEqual({});
    expect(
      buildActionBarContext({ ...base, actor: { _id: "a", system: { derived: 3 } } }).derived,
    ).toEqual({});
    expect(buildActionBarContext({ ...base, actor: { _id: "a", system: null } }).derived).toEqual(
      {},
    );
  });
});

describe("buildActionBarContext — o encontro (REQ-BAR-040)", () => {
  it("sem encontro: nada em combate, sem rodada, não é a vez de ninguém", () => {
    const ctx = buildActionBarContext(base);

    expect(ctx.combat).toEqual({ inCombat: false, round: null, isMyTurn: false, targets: [] });
  });

  it("em montagem (ainda não começou) não é 'em combate' e não tem vez", () => {
    const ctx = buildActionBarContext({ ...base, combat: combat({ started: false }) });

    expect(ctx.combat.inCombat).toBe(false);
    expect(ctx.combat.round).toBeNull();
    expect(ctx.combat.isMyTurn).toBe(false);
  });

  it("encerrado também não", () => {
    const ctx = buildActionBarContext({ ...base, combat: combat({ ended: true }) });

    expect(ctx.combat.inCombat).toBe(false);
    expect(ctx.combat.round).toBeNull();
  });

  it("em andamento: a rodada, e a vez é do usuário quando o participante da vez é de um ator dele", () => {
    const mine = buildActionBarContext({ ...base, combat: combat() });
    const theirs = buildActionBarContext({
      ...base,
      combat: combat({ activeCombatantId: "c-capitao" }),
    });

    expect(mine.combat).toMatchObject({ inCombat: true, round: 2, isMyTurn: true });
    expect(theirs.combat).toMatchObject({ inCombat: true, round: 2, isMyTurn: false });
  });

  it("a vez é pela POSSE do usuário, não pelo ator da barra (o Mestre vendo um NPC não 'é' a vez dele)", () => {
    const ctx = buildActionBarContext({
      ...base,
      active: { actorId: "actor-capitao", tokenId: null },
      actor: { _id: "actor-capitao", type: "npc", system: {} },
      viewer: { userId: "user-gm", isGm: true },
      ownedActorIds: new Set<string>(),
      combat: combat({ activeCombatantId: "c-capitao" }),
    });

    expect(ctx.combat.isMyTurn).toBe(false);
  });

  it("participante da vez oculto (id mascarado pelo servidor): a vez não é de ninguém", () => {
    const ctx = buildActionBarContext({ ...base, combat: combat({ activeCombatantId: null }) });

    expect(ctx.combat.isMyTurn).toBe(false);
    expect(ctx.combat.inCombat).toBe(true);
  });
});

describe("buildActionBarContext — os alvos marcados (REQ-BAR-042)", () => {
  it("vêm de getMyTargets(), com o nome que o token já mostra a este usuário", () => {
    const ctx = buildActionBarContext({
      ...base,
      targets: [{ tokenId: "tok-capitao", actorId: "actor-capitao", name: "Capitão Bandido" }],
    });

    expect(ctx.combat.targets).toEqual([
      { tokenId: "tok-capitao", actorId: "actor-capitao", name: "Capitão Bandido" },
    ]);
  });

  it("alvo sem ator resolvido ganha actorId vazio, não nulo (o contrato pede string)", () => {
    const ctx = buildActionBarContext({
      ...base,
      targets: [{ tokenId: "tok-x", actorId: null, name: "" }],
    });

    expect(ctx.combat.targets).toEqual([{ tokenId: "tok-x", actorId: "", name: "" }]);
  });

  it("é uma cópia: o contexto não guarda o array vivo do repositório de alvos", () => {
    const targets = [{ tokenId: "tok-1", actorId: "a", name: "A" }];
    const ctx = buildActionBarContext({ ...base, targets });

    targets.push({ tokenId: "tok-2", actorId: "b", name: "B" });

    expect(ctx.combat.targets).toHaveLength(1);
  });
});
