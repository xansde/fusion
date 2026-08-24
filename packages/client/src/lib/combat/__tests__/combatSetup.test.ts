/**
 * combatSetup.test.ts — assembling the encounter inside the drawer (spec 40 §5.7, task G053).
 *
 * The gestures of montagem — create, list the candidates the active scene offers, add,
 * roll everyone / roll only the creatures / clear, type a value in, begin — are widgets, but
 * what they are allowed to SAY is a decision, and the decision is what this file proves.
 *
 * Covers REQ-CBA-010 (exactly three states), REQ-CBA-011 (what the header counts),
 * REQ-CBA-013 (beginning is a privileged action), REQ-CBA-060 (the candidates the active
 * scene offers), REQ-CBA-063 (roll everyone / only the creatures / clear), REQ-CBA-064
 * (a value or an explicit "has not rolled"), REQ-CBA-066 (the choice of statistic travels in
 * the same gesture), REQ-CBA-067 (a player never reads a creature's initiative) and
 * REQ-CBA-070 (once running, nobody reads it).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CombatDocument, CombatantDocument, TokenDocument } from "@fusion/shared";
import { defaultTokenDocument } from "@fusion/shared";

import {
  assemblySummary,
  buildInitiativeCells,
  combatPhase,
  creatureCombatantIds,
  encounterCandidates,
  initiativeCellFor,
  initiativeRollOptions,
  initiativeStatisticOptions,
} from "../combatSetup.js";
import { controlsState } from "../combatTracker.js";
import { registerSkillNameResolver, resetSkillNameResolver } from "../skillNameRegistry.js";
// Test-only fixture: the core registry (skillNameRegistry.ts) is what
// combatSetup.ts actually depends on; PF2e's own table is registered into it
// here only to exercise the REQ-CBA-066 assertions with real pt-BR labels,
// the same way PF2e's registerPf2eSheets() would at boot.
import { skillNamePt } from "@fusion/sheets-pf2e";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "c1",
    tokenId: "t1",
    actorId: "a1",
    name: "Combatente",
    img: null,
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: false,
    flags: {},
    ...overrides,
  };
}

function makeCombat(overrides: Partial<CombatDocument> = {}): CombatDocument {
  return {
    _id: "combat1",
    sceneId: "scene1",
    round: 1,
    turnIndex: 0,
    started: false,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants: [],
    activeCombatantId: null,
    flags: {},
    sort: 0,
    ...overrides,
  };
}

function makeToken(id: string, name: string): TokenDocument {
  return {
    _id: id,
    name,
    actorId: `actor-${id}`,
    texture: null,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    elevation: 0,
    hidden: false,
    locked: false,
    disposition: 0,
    actorLink: false,
    sight: { enabled: false, range: 0, angle: 360, visionMode: "basic" },
    light: null,
    flags: {},
  } as unknown as TokenDocument;
}

// ---------------------------------------------------------------------------
// REQ-CBA-010 / REQ-CBA-011 / REQ-CBA-013 — states and header
// ---------------------------------------------------------------------------

describe("os três estados do painel (REQ-CBA-010)", () => {
  it("sem encontro, o painel está vazio", () => {
    expect(combatPhase(null)).toBe("empty");
  });

  it("encontro criado e não iniciado é montagem", () => {
    expect(combatPhase(makeCombat({ started: false }))).toBe("assembly");
  });

  it("encontro iniciado está em andamento", () => {
    expect(combatPhase(makeCombat({ started: true }))).toBe("running");
  });

  it("encontro encerrado volta ao vazio na hora, sem estado intermediário (DEC-CBA-09)", () => {
    expect(combatPhase(makeCombat({ started: true, ended: true }))).toBe("empty");
  });
});

describe("o que o cabeçalho conta na montagem (REQ-CBA-011)", () => {
  it("conta participantes e quantos ainda estão sem iniciativa", () => {
    const summary = assemblySummary([
      makeCombatant({ _id: "a", initiative: 18 }),
      makeCombatant({ _id: "b", initiative: null }),
      makeCombatant({ _id: "c", initiative: null }),
    ]);

    expect(summary).toEqual({ total: 3, withoutInitiative: 2 });
  });

  it("com todo mundo rolado, não sobra ninguém sem iniciativa", () => {
    const summary = assemblySummary([
      makeCombatant({ _id: "a", initiative: 18 }),
      makeCombatant({ _id: "b", initiative: 3 }),
    ]);

    expect(summary.withoutInitiative).toBe(0);
  });

  it("iniciativa zero é um valor rolado, não uma ausência", () => {
    expect(assemblySummary([makeCombatant({ initiative: 0 })]).withoutInitiative).toBe(0);
  });

  it("encontro sem participantes conta zero e zero", () => {
    expect(assemblySummary([])).toEqual({ total: 0, withoutInitiative: 0 });
  });
});

describe("começar o encontro (REQ-CBA-013)", () => {
  it("só é oferecido quando há participantes e o encontro ainda não começou", () => {
    const empty = controlsState(makeCombat({ combatants: [] }));
    const ready = controlsState(makeCombat({ combatants: [makeCombatant()] }));
    const running = controlsState(makeCombat({ started: true, combatants: [makeCombatant()] }));

    expect(empty.canStart).toBe(false);
    expect(ready.canStart).toBe(true);
    expect(running.canStart).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-060 — the candidates the active scene offers
// ---------------------------------------------------------------------------

describe("candidatos que a cena ativa oferece (REQ-CBA-060)", () => {
  const sceneTokens = [makeToken("t1", "Goblin"), makeToken("t2", "Ogro"), makeToken("t3", "Lobo")];

  it("oferece quem está na cena e ainda não é participante", () => {
    const combat = makeCombat({
      combatants: [makeCombatant({ _id: "c1", tokenId: "t2", name: "Ogro" })],
    });

    const candidates = encounterCandidates(sceneTokens, combat);

    expect(candidates.map((c) => c.name)).toEqual(["Goblin", "Lobo"]);
  });

  it("sem encontro criado ainda, todo mundo da cena é candidato", () => {
    expect(encounterCandidates(sceneTokens, null)).toHaveLength(3);
  });

  it("com todos já no encontro, a lista fica vazia em vez de repetir participante", () => {
    const combat = makeCombat({
      combatants: sceneTokens.map((token, i) =>
        makeCombatant({ _id: `c${String(i)}`, tokenId: token._id }),
      ),
    });

    expect(encounterCandidates(sceneTokens, combat)).toEqual([]);
  });

  it("carrega o ator de cada candidato, que é o que entra no encontro", () => {
    const [first] = encounterCandidates(sceneTokens, null);

    expect(first?.actorId).toBe("actor-t1");
  });

  it("resolve nome/arte pelo ator efetivo quando a peça não tem rótulo próprio (REQ-TOK-060, RNF-TOK-01)", () => {
    // Since TK020, `name: null` (defaultTokenDocument's default) means "inherit the
    // effective actor's name" — encounterCandidates must thread the resolver it receives
    // straight to addableTokens() rather than deriving the name itself a second time.
    const unnamedToken = {
      ...defaultTokenDocument("tokUnnamedAAAAAA", "actorLoboAAAAAA"),
      name: null,
    };
    const result = encounterCandidates([unnamedToken], null, (actorId) =>
      actorId === "actorLoboAAAAAA" ? { name: "Lobo", img: "lobo.webp", system: {} } : undefined,
    );

    expect(result[0]).toMatchObject({ name: "Lobo", img: "lobo.webp" });
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-063 — rolling in bulk
// ---------------------------------------------------------------------------

describe("rolar só das criaturas (REQ-CBA-063)", () => {
  const combatants = [
    makeCombatant({ _id: "pc1", name: "Fofurinha", hasPlayerOwner: true }),
    makeCombatant({ _id: "npc1", name: "Goblin", hasPlayerOwner: false }),
    makeCombatant({ _id: "npc2", name: "Ogro", hasPlayerOwner: false }),
  ];

  it("cobre as criaturas e deixa de fora os personagens de jogador", () => {
    expect(creatureCombatantIds(combatants)).toEqual(["npc1", "npc2"]);
  });

  it("não re-rola criatura cuja iniciativa o Mestre já definiu (REQ-CBA-064)", () => {
    const withManual = combatants.map((c) => (c._id === "npc1" ? { ...c, initiative: 22 } : c));

    expect(creatureCombatantIds(withManual)).toEqual(["npc2"]);
  });

  it("com só personagens de jogador, não há criatura para rolar", () => {
    expect(creatureCombatantIds([combatants[0]!])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-064 / REQ-CBA-067 / REQ-CBA-070 — the initiative cell
// ---------------------------------------------------------------------------

describe("a iniciativa na montagem (REQ-CBA-064)", () => {
  it("mostra o valor de quem rolou", () => {
    const cell = initiativeCellFor({
      phase: "assembly",
      role: "gm",
      hasPlayerOwner: false,
      initiative: 17,
    });

    expect(cell.kind).toBe("value");
    expect(cell.value).toBe(17);
  });

  it("diz explicitamente que ainda não rolou, em vez de deixar a célula vazia", () => {
    const cell = initiativeCellFor({
      phase: "assembly",
      role: "gm",
      hasPlayerOwner: false,
      initiative: null,
    });

    expect(cell.kind).toBe("unrolled");
    expect(cell.value).toBeNull();
  });

  it("papel privilegiado pode definir manualmente; o jogador não", () => {
    const gm = initiativeCellFor({
      phase: "assembly",
      role: "gm",
      hasPlayerOwner: true,
      initiative: null,
    });
    const player = initiativeCellFor({
      phase: "assembly",
      role: "player",
      hasPlayerOwner: true,
      initiative: null,
    });

    expect(gm.editable).toBe(true);
    expect(player.editable).toBe(false);
  });

  it("iniciativa zero é um valor, não um 'ainda não rolou'", () => {
    const cell = initiativeCellFor({
      phase: "assembly",
      role: "gm",
      hasPlayerOwner: false,
      initiative: 0,
    });

    expect(cell.kind).toBe("value");
    expect(cell.value).toBe(0);
  });
});

describe("o jogador e a iniciativa de criatura (REQ-CBA-067)", () => {
  it("nem na montagem o jogador lê a iniciativa de uma criatura", () => {
    const cell = initiativeCellFor({
      phase: "assembly",
      role: "player",
      hasPlayerOwner: false,
      initiative: 23,
    });

    expect(cell.kind).toBe("concealed");
    expect(cell.value).toBeNull();
  });

  it("a criatura que ainda não rolou também não vira dica para o jogador", () => {
    const cell = initiativeCellFor({
      phase: "assembly",
      role: "player",
      hasPlayerOwner: false,
      initiative: null,
    });

    expect(cell.kind).toBe("concealed");
  });

  it("a iniciativa dos personagens de jogador continua legível para o jogador", () => {
    const cell = initiativeCellFor({
      phase: "assembly",
      role: "player",
      hasPlayerOwner: true,
      initiative: 12,
    });

    expect(cell.kind).toBe("value");
    expect(cell.value).toBe(12);
  });
});

describe("em andamento o número some para todo mundo (REQ-CBA-070)", () => {
  it("some para o jogador", () => {
    const cell = initiativeCellFor({
      phase: "running",
      role: "player",
      hasPlayerOwner: true,
      initiative: 12,
    });

    expect(cell.kind).toBe("hidden-phase");
    expect(cell.value).toBeNull();
  });

  it("some também para papel privilegiado — DEC-CBA-04 não abre exceção", () => {
    const cell = initiativeCellFor({
      phase: "running",
      role: "gm",
      hasPlayerOwner: false,
      initiative: 30,
    });

    expect(cell.kind).toBe("hidden-phase");
    expect(cell.value).toBeNull();
    expect(cell.editable).toBe(false);
  });

  it("distingue 'não é seu' de 'ninguém lê agora' — as duas células vazias têm causas diferentes", () => {
    const byViewer = initiativeCellFor({
      phase: "assembly",
      role: "player",
      hasPlayerOwner: false,
      initiative: 9,
    });
    const byPhase = initiativeCellFor({
      phase: "running",
      role: "player",
      hasPlayerOwner: false,
      initiative: 9,
    });

    expect(byViewer.kind).not.toBe(byPhase.kind);
  });
});

describe("as células de um encontro inteiro (REQ-CBA-064, REQ-CBA-067, REQ-CBA-070)", () => {
  const combatants = [
    makeCombatant({ _id: "pc1", hasPlayerOwner: true, initiative: 15 }),
    makeCombatant({ _id: "npc1", hasPlayerOwner: false, initiative: 21 }),
    makeCombatant({ _id: "npc2", hasPlayerOwner: false, initiative: null }),
  ];

  it("na montagem, o Mestre lê todas", () => {
    const cells = buildInitiativeCells("assembly", "gm", combatants);

    expect(cells.get("pc1")?.kind).toBe("value");
    expect(cells.get("npc1")?.kind).toBe("value");
    expect(cells.get("npc2")?.kind).toBe("unrolled");
  });

  it("na montagem, o jogador lê a sua e nenhuma criatura", () => {
    const cells = buildInitiativeCells("assembly", "player", combatants);

    expect(cells.get("pc1")?.kind).toBe("value");
    expect(cells.get("npc1")?.kind).toBe("concealed");
    expect(cells.get("npc2")?.kind).toBe("concealed");
  });

  it("em andamento, ninguém lê nenhuma", () => {
    for (const role of ["gm", "player"] as const) {
      const cells = buildInitiativeCells("running", role, combatants);
      expect([...cells.values()].every((cell) => cell.kind === "hidden-phase")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-066 / Q-CBA-03 — the choice of statistic
// ---------------------------------------------------------------------------

describe("escolha da estatística de iniciativa (REQ-CBA-066)", () => {
  beforeAll(() => registerSkillNameResolver(skillNamePt));
  afterAll(() => resetSkillNameResolver());

  const actor = {
    _id: "a1",
    system: {
      derived: {
        skills: {
          stealth: { total: 9 },
          acrobatics: { total: 7 },
          deception: { total: 4 },
        },
      },
    },
  };

  it("oferece as estatísticas do próprio ator, em ordem legível", () => {
    const options = initiativeStatisticOptions(actor);

    // A ordem é a do RÓTULO, que é o que a pessoa lê: Acrobacia < Enganação < Furtividade.
    expect(options.map((o) => o.id)).toEqual(["acrobatics", "deception", "stealth"]);
    expect(options.map((o) => o.label)).toEqual(["Acrobacia", "Enganação", "Furtividade"]);
  });

  it("REQ-CBA-066: o rótulo do menu é texto de tela em pt-BR, nunca o slug em inglês", () => {
    const options = initiativeStatisticOptions({
      system: {
        derived: {
          skills: {
            thievery: { total: 8 },
            stealth: { total: 9 },
            athletics: { total: 5 },
            "lore-underworld": { total: 3 },
          },
        },
      },
    });

    // Nenhum rótulo pode ser o slug cru, nem o slug só com a inicial maiúscula.
    for (const option of options) {
      expect(option.label).not.toBe(option.id);
      expect(option.label).not.toBe(option.id.charAt(0).toUpperCase() + option.id.slice(1));
    }

    const byId = new Map(options.map((o) => [o.id, o.label]));
    expect(byId.get("thievery")).toBe("Ladinagem");
    expect(byId.get("stealth")).toBe("Furtividade");
    expect(byId.get("athletics")).toBe("Atletismo");
    expect(byId.get("lore-underworld")).toBe("Saber (Underworld)");
  });

  it("REQ-CBA-066: o id continua sendo o slug que a fórmula do sistema entende", () => {
    const options = initiativeStatisticOptions(actor);
    const stealth = options.find((o) => o.label === "Furtividade");

    expect(stealth?.id).toBe("stealth");
    expect(initiativeRollOptions(stealth?.id)).toEqual({ skill: "stealth" });
  });

  it("uma perícia que a tabela não conhece degrada para o próprio slug, sem sumir do menu", () => {
    const options = initiativeStatisticOptions({
      system: { derived: { skills: { "perícia-inventada": { total: 1 } } } },
    });

    expect(options).toEqual([{ id: "perícia-inventada", label: "perícia-inventada" }]);
  });

  it("sem ator, sem declaração de perícias, a escolha simplesmente não aparece", () => {
    expect(initiativeStatisticOptions(null)).toEqual([]);
    expect(initiativeStatisticOptions({ system: {} })).toEqual([]);
    expect(initiativeStatisticOptions({ system: { derived: { skills: [] } } })).toEqual([]);
  });

  it("a escolha viaja no mesmo gesto de rolar, e a ausência de escolha não vira opção", () => {
    expect(initiativeRollOptions("stealth")).toEqual({ skill: "stealth" });
    expect(initiativeRollOptions(null)).toBeUndefined();
    expect(initiativeRollOptions("")).toBeUndefined();
    expect(initiativeRollOptions(undefined)).toBeUndefined();
  });
});
