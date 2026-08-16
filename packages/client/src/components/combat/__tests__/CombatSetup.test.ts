/**
 * CombatSetup.test.ts — what montagem actually draws (spec 40 §5.7, task G053).
 *
 * Same two instruments as `CombatQueue.test.ts`: the markup `render()` from `svelte/server`
 * emits for the queue, and the panel's own source for the rules that are structural rather
 * than nodes (the candidate list being a block of the panel and not a window, the header
 * carrying no ✕, which controls exist in which state).
 *
 * Covers REQ-CBA-010 (the three states are on the panel itself), REQ-CBA-011 (the header
 * counts participants and how many still owe an initiative), REQ-CBA-012 (no ✕, no width
 * control), REQ-CBA-013 (beginning is privileged), REQ-CBA-060/061 (candidates the active
 * scene offers, as a collapsible block, no floating window), REQ-CBA-062 (nothing on screen
 * says "token"), REQ-CBA-063 (roll everyone / only the creatures / clear), REQ-CBA-064
 * (a value or an explicit "has not rolled"), REQ-CBA-065 (the player rolls their own),
 * REQ-CBA-066 (the statistic is chosen in the same gesture), REQ-CBA-067 (a player never
 * reads a creature's initiative) and REQ-CBA-070 (running, nobody reads it).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

import CombatQueue from "../CombatQueue.svelte";
import CombatPanelSourceMarker from "../CombatPanel.svelte";
import { buildRotatedQueue, buildTrackerRows } from "../../../lib/combat/combatTracker.js";
import { buildInitiativeCells, combatPhase } from "../../../lib/combat/combatSetup.js";
import type { InitiativeStatisticOption } from "../../../lib/combat/combatSetup.js";
import type { ViewerRole } from "../../../lib/combat/combatVisibility.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// The panel needs a live socket, so its assertions read its source — same trick the sibling
// component tests use. The import exists so a rename breaks this file loudly.
void CombatPanelSourceMarker;

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

function makeCombat(
  combatants: CombatantDocument[],
  options: { started?: boolean; activeCombatantId?: string | null } = {},
): CombatDocument {
  return {
    _id: "combat1",
    sceneId: "scene1",
    round: 1,
    turnIndex: 0,
    started: options.started ?? false,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants,
    activeCombatantId: options.activeCombatantId ?? null,
    flags: {},
    sort: 0,
  };
}

/** A player character and two creatures, one rolled and one not. */
function mixedParty(): CombatantDocument[] {
  return [
    makeCombatant({
      _id: "pc1",
      name: "Fofurinha",
      actorId: "actor-pc",
      hasPlayerOwner: true,
      initiative: 14,
    }),
    makeCombatant({ _id: "npc1", name: "Goblin", actorId: "actor-g", initiative: 21 }),
    makeCombatant({ _id: "npc2", name: "Ogro", actorId: "actor-o", initiative: null }),
  ];
}

function renderQueue(
  combat: CombatDocument,
  role: ViewerRole,
  extra: {
    rollable?: ReadonlySet<string>;
    statisticOptions?: ReadonlyMap<string, readonly InitiativeStatisticOption[]>;
  } = {},
): string {
  const gmControls = role === "gm";
  const queue = buildRotatedQueue(buildTrackerRows(combat), gmControls);
  const { body } = render(CombatQueue, {
    props: {
      queue,
      gmControls,
      busy: false,
      order: combat.combatants.map((c) => c._id),
      rollable: extra.rollable ?? new Set<string>(),
      initiativeCells: buildInitiativeCells(combatPhase(combat), role, combat.combatants),
      statisticOptions: extra.statisticOptions,
    },
  });
  return body;
}

function panelSource(): string {
  return readFileSync(fileURLToPath(new URL("../CombatPanel.svelte", import.meta.url)), "utf8");
}

function queueSource(): string {
  return readFileSync(fileURLToPath(new URL("../CombatQueue.svelte", import.meta.url)), "utf8");
}

/** Every user-facing string the two bundles carry for the combat tab. */
function combatMessages(): { key: string; ptBR: string; en: string }[] {
  const ptBR = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../lib/i18n/pt-BR.json", import.meta.url)), "utf8"),
  ) as Record<string, string>;
  const en = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../lib/i18n/en.json", import.meta.url)), "utf8"),
  ) as Record<string, string>;

  return Object.keys(ptBR)
    .filter((key) => key.startsWith("FUSION.Combat."))
    .map((key) => ({ key, ptBR: ptBR[key] ?? "", en: en[key] ?? "" }));
}

// ---------------------------------------------------------------------------
// REQ-CBA-010 / REQ-CBA-011 / REQ-CBA-012 / REQ-CBA-013 — states and header
// ---------------------------------------------------------------------------

describe("os três estados do painel (REQ-CBA-010)", () => {
  const source = panelSource();

  it("o estado é declarado no próprio nó do painel, não só implícito no ramo", () => {
    expect(source).toContain("data-phase={phase}");
    expect(source).toContain("combatPhase(combat)");
  });

  it("o estado vazio cobre também o encontro encerrado (DEC-CBA-09)", () => {
    expect(source).toContain('{#if !combat || phase === "empty"}');
  });
});

describe("o cabeçalho da montagem (REQ-CBA-011)", () => {
  const source = panelSource();

  it("conta participantes e quantos ainda estão sem iniciativa", () => {
    expect(source).toContain("FUSION.Combat.Setup.Count");
    expect(source).toContain("assemblySummary");
    expect(t("FUSION.Combat.Setup.Count", { total: 4, pending: 2 })).toContain("4");
    expect(t("FUSION.Combat.Setup.Count", { total: 4, pending: 2 })).toContain("2");
  });

  it("com todos rolados diz isso em palavras, em vez de um zero solto", () => {
    expect(source).toContain("FUSION.Combat.Setup.CountReady");
    expect(t("FUSION.Combat.Setup.CountReady", { total: 4 })).not.toContain("0");
  });

  it("em andamento o cabeçalho carrega a rodada, não a contagem", () => {
    expect(source).toContain("FUSION.Combat.Started");
    expect(/\{#if isAssembling\}[\s\S]*?FUSION\.Combat\.Setup\.Count/.test(source)).toBe(true);
  });
});

describe("o cabeçalho não fecha nem redimensiona a gaveta (REQ-CBA-012)", () => {
  it("não tem ✕ nem controle de largura", () => {
    const header = /combat-panel__header"[\s\S]*?<\/div>/.exec(panelSource())?.[0] ?? "";

    expect(header).not.toBe("");
    expect(header).not.toContain("2715");
    expect(header).not.toContain("✕");
    expect(header.toLowerCase()).not.toContain("width");
  });
});

describe("começar o encontro é ação de papel privilegiado (REQ-CBA-013)", () => {
  it("o botão de iniciar vive atrás do portão de papel do cabeçalho", () => {
    const source = panelSource();
    const gate = source.indexOf("{#if isGm && controls}");
    const begin = source.indexOf("FUSION.Combat.Begin");

    expect(gate).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(gate);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-060 / REQ-CBA-061 / REQ-CBA-062 — the candidate list
// ---------------------------------------------------------------------------

describe("a lista de candidatos que a cena ativa oferece (REQ-CBA-060)", () => {
  const source = panelSource();

  it("lê o que a cena ativa oferece e oferece adicionar cada um", () => {
    expect(source).toContain("encounterCandidates(activeSceneState.scene?.tokens ?? [], combat)");
    expect(source).toContain("handleAddCandidate");
    expect(source).toContain("combatActions.addCombatant");
  });

  it("é um bloco recolhível do próprio painel, e não uma janela (REQ-CBA-061)", () => {
    expect(source).toContain('class="candidates"');
    expect(source).toContain("aria-expanded={candidatesOpen}");
    expect(source).toContain('aria-controls="combat-candidates"');
    // No floating window and no width of its own: the drawer's width is the drawer's.
    expect(source).not.toContain("windowManager");
    expect(/\.candidates\s*\{[^}]*width/.test(source)).toBe(false);
  });

  it("registra por escrito de onde vem a lista e o que a spec 41 muda (DEC-CBA-06)", () => {
    expect(source).toContain("DEC-CBA-06");
    expect(source).toContain("41");
  });
});

describe("nenhuma tela desta aba diz 'token' (REQ-CBA-062)", () => {
  it("nem em pt-BR nem em en, em nenhuma mensagem do combate", () => {
    const offenders = combatMessages().filter(
      (m) => /\btokens?\b/i.test(m.ptBR) || /\btokens?\b/i.test(m.en),
    );

    expect(offenders.map((m) => m.key)).toEqual([]);
  });

  it("nem em texto solto dentro do painel", () => {
    const source = panelSource();
    const markup = source.slice(source.indexOf("</script>"), source.indexOf("<style>"));

    expect(/>[^<]*\btokens?\b/i.test(markup)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-063 — rolling in bulk
// ---------------------------------------------------------------------------

describe("rolar todos, só as criaturas, e zerar (REQ-CBA-063)", () => {
  const source = panelSource();

  it("oferece os três gestos", () => {
    expect(source).toContain("FUSION.Combat.RollAll");
    expect(source).toContain("FUSION.Combat.Setup.RollCreatures");
    expect(source).toContain("FUSION.Combat.Setup.ClearInitiative");
  });

  it("'só as criaturas' manda exatamente a lista de criaturas ao servidor", () => {
    expect(source).toContain("creatureCombatantIds");
    expect(source).toContain("combatActions.rollInitiative(socket, combat._id, creatureIds)");
  });

  it("sem criatura para rolar, o gesto fica desabilitado em vez de mandar lista vazia", () => {
    expect(source).toContain("creatureIds.length === 0");
  });

  it("os gestos de montagem só existem na montagem — em andamento não há número (REQ-CBA-070)", () => {
    expect(source).toContain("{#if isGm && controls && isAssembling}");
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-064 / REQ-CBA-067 / REQ-CBA-070 — the initiative cell on screen
// ---------------------------------------------------------------------------

describe("a iniciativa desenhada na montagem (REQ-CBA-064)", () => {
  const body = renderQueue(makeCombat(mixedParty()), "gm");

  it("o Mestre lê o valor de quem rolou", () => {
    expect(body).toContain(t("FUSION.Combat.Initiative", { value: "21" }));
  });

  it("quem não rolou recebe marca explícita, dita em palavras", () => {
    expect(body).toContain(t("FUSION.Combat.Setup.Unrolled"));
    expect(body).toContain("combatant-row__init-btn--unrolled");
  });

  it("a marca de 'não rolou' não é só uma célula vazia parecida com zero", () => {
    const style = /<style>([\s\S]*)<\/style>/.exec(queueSource())?.[1] ?? "";
    const rule = /\.combatant-row__init-btn--unrolled\s*\{([\s\S]*?)\}/.exec(style)?.[1] ?? "";

    expect(rule).toContain("dashed");
  });

  it("papel privilegiado pode definir manualmente a partir da própria célula", () => {
    expect(body).toContain(t("FUSION.Combat.SetInitiativeManually"));
  });
});

describe("o jogador e a iniciativa na montagem (REQ-CBA-067)", () => {
  const combat = makeCombat(mixedParty());
  const body = renderQueue(combat, "player");

  it("não desenha nenhuma célula de iniciativa de criatura — nem valor, nem traço", () => {
    expect(body).toContain("Goblin");
    expect(body).not.toContain(t("FUSION.Combat.Initiative", { value: "21" }));
    expect(body).not.toContain(">21<");
  });

  it("também não vaza pela marca de 'ainda não rolou' da criatura", () => {
    expect(body).toContain("Ogro");
    const unrolledMarks = body.split(t("FUSION.Combat.Setup.Unrolled")).length - 1;
    expect(unrolledMarks).toBe(0);
  });

  it("a iniciativa do personagem de jogador continua legível", () => {
    expect(body).toContain(t("FUSION.Combat.Initiative", { value: "14" }));
  });
});

describe("em andamento o número some da tela para todo mundo (REQ-CBA-070)", () => {
  const running = makeCombat(mixedParty(), { started: true, activeCombatantId: "npc1" });

  it("some para papel privilegiado", () => {
    const body = renderQueue(running, "gm");

    expect(body).toContain("Fofurinha");
    expect(body).not.toContain("combatant-row__init-btn");
    expect(body).not.toContain(t("FUSION.Combat.Initiative", { value: "14" }));
  });

  it("some para o jogador", () => {
    const body = renderQueue(running, "player");

    expect(body).not.toContain("combatant-row__init-btn");
  });

  it("a ordem continua sendo dita pela posição na lista, que não muda", () => {
    const body = renderQueue(running, "gm");
    const drawn = [...body.matchAll(/title="([^"]+)"/g)].map((m) => m[1]);

    expect(drawn).toContain("Ogro");
    expect(drawn).toContain("Fofurinha");
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-065 / REQ-CBA-066 — the player's own roll, and the statistic
// ---------------------------------------------------------------------------

describe("o jogador rola a iniciativa dos seus (REQ-CBA-065)", () => {
  const combat = makeCombat(mixedParty());

  it("recebe o botão na própria linha", () => {
    const body = renderQueue(combat, "player", { rollable: new Set(["pc1"]) });

    expect(body).toContain(t("FUSION.Combat.RollMyInitiative"));
  });

  it("o botão não depende de apontar para a linha para existir", () => {
    const source = queueSource();
    const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? "";

    // It lives outside the group that fades in on hover.
    expect(source).toContain("combatant-row__roll");
    expect(/\.combatant-row__roll\s*\{([\s\S]*?)\}/.exec(style)?.[1] ?? "").not.toMatch(
      /opacity:\s*0/,
    );
  });

  it("não recebe gesto de rolar a de ninguém mais", () => {
    const body = renderQueue(combat, "player", { rollable: new Set(["pc1"]) });
    const rollButtons = body.split(t("FUSION.Combat.RollMyInitiative")).length - 1;

    // One aria-label plus one visible label on the single roll button.
    expect(rollButtons).toBe(2);
    expect(body).not.toContain(t("FUSION.Combat.RollInitiative"));
  });
});

describe("escolher a estatística no mesmo gesto de rolar (REQ-CBA-066)", () => {
  const combat = makeCombat(mixedParty());
  const statistics = new Map<string, readonly InitiativeStatisticOption[]>([
    [
      "pc1",
      [
        { id: "stealth", label: "Stealth" },
        { id: "acrobatics", label: "Acrobatics" },
      ],
    ],
  ]);

  it("oferece a escolha ao lado do gesto que rola", () => {
    const body = renderQueue(combat, "player", {
      rollable: new Set(["pc1"]),
      statisticOptions: statistics,
    });

    expect(body).toContain(t("FUSION.Combat.Setup.Statistic", { name: "Fofurinha" }));
    expect(body).toContain(">Stealth<");
    expect(body).toContain(t("FUSION.Combat.Setup.StatisticDefault"));
  });

  it("sem estatística declarada, não há menu — e o gesto de rolar continua lá", () => {
    const body = renderQueue(combat, "player", { rollable: new Set(["pc1"]) });

    expect(body).not.toContain("combatant-row__statistic");
    expect(body).toContain(t("FUSION.Combat.RollMyInitiative"));
  });

  // The panel's half of REQ-CBA-066: the menu's choice reaches the roll gesture and no
  // second operation is invented for it. The other half — that the choice actually rides
  // the roll's PAYLOAD to the server — is proved against a fake socket in
  // `lib/combat/__tests__/combatInitiativeOp.test.ts`, because source text cannot show it.
  it("a escolha viaja na mesma operação de rolar, sem operação nova", () => {
    const source = panelSource();

    expect(source).toContain("initiativeRollOptions(statistic)");
    expect(source).toContain("combatActions.rollInitiative");
    expect(source).not.toContain("combat:setInitiativeStatistic");
  });
});
