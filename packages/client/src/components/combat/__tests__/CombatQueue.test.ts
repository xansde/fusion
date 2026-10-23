/**
 * CombatQueue.test.ts — what the fila actually draws (spec 40 §5.4, task G051).
 *
 * Rendered with `render()` from `svelte/server`, like `TurnHead.test.ts`: the client
 * project runs Vitest in a node environment, with no jsdom and no testing-library, so the
 * two things a component test can look at are the markup the server renderer emits and the
 * component's own `<style>` block — which is where the requirements that are rules rather
 * than nodes live (the acted group being distinct, defeat not being only opacity, the head
 * staying out of what scrolls).
 *
 * Covers REQ-CBA-031 (the acted group is labelled and distinct), REQ-CBA-032 (portrait,
 * name and the row's contents), REQ-CBA-033 (defeat is marked explicitly, not only by
 * opacity, and the row stays), REQ-CBA-034 (hidden is marked for a privileged role and
 * absent for the rest), REQ-CBA-035 (drag handle plus a keyboard alternative, acting
 * on the underlying turn order the panel actually passes in — never on the rotated
 * reading), REQ-CBA-036 (twenty participants scroll, the head does not travel with them),
 * REQ-CBA-068 (a privileged role removes a participant, in both phases; nobody else does)
 * and REQ-CBA-076 (the panel offers no way to mark a target, to any role).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

import CombatQueue from "../CombatQueue.svelte";
import CombatPanelSourceMarker from "../CombatPanel.svelte";
import {
  buildRotatedQueue,
  buildTrackerRows,
  moveCombatantBefore,
  moveCombatantInOrder,
} from "../../../lib/combat/combatTracker.js";
import type { RotatedQueue } from "../../../lib/combat/combatTracker.js";
import { getSortedCombatants } from "../../../lib/combat/combatStore.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// Imported only so a rename of the panel breaks this file loudly; the panel needs a live
// socket, so the assertions about it read its source (same trick as TurnHead.test.ts).
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
  activeCombatantId: string | null,
): CombatDocument {
  return {
    _id: "combat1",
    sceneId: "scene1",
    round: 1,
    turnIndex: 0,
    started: activeCombatantId !== null,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants,
    activeCombatantId,
    flags: {},
    sort: 0,
  };
}

function ladder(
  count: number,
  activeIndex: number,
  tweak: (i: number) => Partial<CombatantDocument> = () => ({}),
): CombatDocument {
  const combatants = Array.from({ length: count }, (_, i) =>
    makeCombatant({
      _id: `p${String(i)}`,
      tokenId: `t${String(i)}`,
      actorId: `a${String(i)}`,
      name: `P${String(i)}`,
      initiative: count - i,
      ...tweak(i),
    }),
  );
  return makeCombat(combatants, `p${String(activeIndex)}`);
}

/** The same ladder, before anyone has a turn: the montagem phase (no active participant). */
function setup(count: number): CombatDocument {
  const combat = ladder(count, 0);
  return makeCombat(combat.combatants, null);
}

function queueOf(combat: CombatDocument, canSeeHidden: boolean): RotatedQueue {
  return buildRotatedQueue(buildTrackerRows(combat), canSeeHidden);
}

/**
 * The **underlying** turn order, the way the panel builds it (`CombatPanel.svelte`:
 * `getSortedCombatants(combat).map((c) => c._id)`): the whole ring, in initiative order,
 * including whoever is taking the turn. It is deliberately NOT `queue.entries`, which is
 * the rotated reading with the head removed — feeding that to the component would be
 * feeding a shape the panel never produces, and the reorder gestures rewrite this prop.
 */
function orderOf(combat: CombatDocument, canSeeHidden: boolean): string[] {
  // A non-privileged viewer's mirror never holds hidden combatants: the server strips them
  // before the payload leaves (REQ-CBA-034), so the order it can rewrite has them gone too.
  const combatants = canSeeHidden ? combat.combatants : combat.combatants.filter((c) => !c.hidden);
  return getSortedCombatants({ ...combat, combatants }).map((c) => c._id);
}

function renderQueue(
  combat: CombatDocument,
  gmControls: boolean,
  canSeeHidden: boolean = gmControls,
): string {
  const { body } = render(CombatQueue, {
    props: {
      queue: queueOf(combat, canSeeHidden),
      gmControls,
      busy: false,
      order: orderOf(combat, canSeeHidden),
      rollable: new Set<string>(),
    },
  });
  return body;
}

function styleOfQueue(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../CombatQueue.svelte", import.meta.url)),
    "utf8",
  );
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1];
  if (style === undefined) throw new Error("CombatQueue.svelte has no <style> block");
  return style;
}

function ruleOf(style: string, selector: string): string {
  const escaped = selector.replace(/[.\-]/g, (c) => `\\${c}`);
  return new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(style)?.[1] ?? "";
}

function combatPanelSource(): string {
  return readFileSync(fileURLToPath(new URL("../CombatPanel.svelte", import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// REQ-CBA-031 — the acted group
// ---------------------------------------------------------------------------

describe("o grupo de quem já agiu é rotulado e distinto (REQ-CBA-031)", () => {
  const body = renderQueue(ladder(6, 3), true);

  it("escreve o rótulo dos dois grupos, em palavras", () => {
    expect(body).toContain(t("FUSION.Combat.Queue.Acted"));
    expect(body).toContain(t("FUSION.Combat.Queue.Upcoming"));
  });

  it("marca o grupo no próprio nó, não só na ordem", () => {
    expect(body).toContain("combat-queue__group--acted");
    expect(body).toContain("combat-queue__group--upcoming");
  });

  it("não omite ninguém: os cinco participantes fora da cabeça estão desenhados", () => {
    for (const name of ["P0", "P1", "P2", "P4", "P5"]) {
      expect(body).toContain(`>${name}<`);
    }
    expect(body).not.toContain(">P3<");
  });

  it("sem ninguém que já agiu, não inventa um grupo vazio", () => {
    const first = renderQueue(ladder(4, 0), true);

    expect(first).not.toContain("combat-queue__group--acted");
    expect(first).not.toContain(t("FUSION.Combat.Queue.Acted"));
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-032 / REQ-CBA-033 — the row
// ---------------------------------------------------------------------------

describe("o que cada linha mostra (REQ-CBA-032)", () => {
  it("desenha retrato e nome de cada participante", () => {
    const body = renderQueue(ladder(3, 0), true);

    expect(body).toContain("combatant-row__portrait");
    expect(body).toContain(">P1<");
    expect(body).toContain('title="P1"');
  });
});

describe("derrotado (REQ-CBA-033)", () => {
  const combat = ladder(4, 0, (i) => (i === 2 ? { defeated: true } : {}));
  const body = renderQueue(combat, true);

  it("permanece na fila", () => {
    expect(body).toContain(">P2<");
  });

  it("é marcado em palavra e em forma, não só em opacidade", () => {
    expect(body).toContain(t("FUSION.Combat.Defeated"));
    expect(body).toContain("combatant-row__mark--defeated");
    expect(body).toContain("<svg");
  });

  it("a regra de estilo do derrotado não se resume a opacidade", () => {
    const rule = ruleOf(styleOfQueue(), ".combatant-row--defeated");

    expect(rule).not.toBe("");
    const declarations = rule
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d !== "");
    expect(declarations.every((d) => d.startsWith("opacity"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-034 — hidden
// ---------------------------------------------------------------------------

describe("participante oculto (REQ-CBA-034)", () => {
  const combat = ladder(4, 0, (i) => (i === 2 ? { name: "Espião", hidden: true } : {}));

  it("aparece para papel privilegiado com a palavra 'oculto'", () => {
    const body = renderQueue(combat, true);

    expect(body).toContain(">Espião<");
    expect(body).toContain(t("FUSION.Combat.Queue.Hidden"));
    expect(body).toContain("combatant-row--hidden");
  });

  it("não aparece de forma alguma para quem não tem papel privilegiado", () => {
    const body = renderQueue(combat, false);

    expect(body).not.toContain("Espião");
    expect(body).not.toContain("combatant-row--hidden");
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-035 / REQ-CBA-093 — reorder
// ---------------------------------------------------------------------------

describe("reordenar a fila (REQ-CBA-035)", () => {
  it("papel privilegiado recebe uma alça arrastável que também é botão de teclado", () => {
    const body = renderQueue(ladder(4, 0), true);

    expect(body).toContain("combatant-row__handle");
    expect(body).toContain('draggable="true"');
    expect(body).toContain(t("FUSION.Combat.Queue.Reorder", { name: "P1" }));
    // A real <button>, so Tab reaches it and Enter/arrows work (REQ-CBA-093).
    expect(/<button[^>]*combatant-row__handle/.test(body)).toBe(true);
  });

  it("a alça aparece ao apontar e ao focar, nunca só ao apontar", () => {
    const style = styleOfQueue();

    expect(ruleOf(style, ".combatant-row__handle")).toMatch(/opacity:\s*0/);
    expect(style).toContain(".combatant-row:hover .combatant-row__handle");
    expect(style).toContain(".combatant-row__handle:focus-visible");
  });

  it("quem não tem papel privilegiado não recebe alça nem linha arrastável", () => {
    const body = renderQueue(ladder(4, 0), false, true);

    expect(body).not.toContain("combatant-row__handle");
    expect(body).not.toContain('draggable="true"');
  });

  it("o painel alimenta a fila com a ordem SUBJACENTE, não com a leitura rotacionada", () => {
    // REQ-CBA-035: os dois gestos reescrevem a prop `order`, então a forma dela decide o
    // que sai em `combat:reorder`. Se o painel passasse `queue.entries`, a ordem enviada
    // ao servidor sairia rotacionada e sem o participante da vez — e nenhuma asserção
    // sobre markup perceberia.
    const source = combatPanelSource();

    expect(source).toContain("order={turnOrder}");
    expect(source).toContain("getSortedCombatants(combat).map((c) => c._id)");
    expect(source).not.toContain("order={queue.entries");
    // E o que a fila devolve vai para o servidor pela ação de reordenar, sem passar por
    // nenhuma outra transformação no caminho.
    expect(source).toContain(
      "onReorder={(order) => void combatActions.reorder(socket, combat._id, order)}",
    );
  });

  it("com o encontro em andamento, o gesto anda na ordem subjacente e não na rotacionada", () => {
    // REQ-CBA-035: com a vez no meio da escada, as duas leituras discordam — a rotacionada
    // começa em P4 e não tem P3. Um gesto que operasse sobre ela moveria o participante
    // errado (ou recusaria mover), e um array plano de quatro ids não distinguiria os dois.
    const combat = ladder(6, 3);
    const order = orderOf(combat, true);
    const rotated = queueOf(combat, true).entries.map((entry) => entry.row.id);

    expect(order).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(rotated).toEqual(["p4", "p5", "p0", "p1", "p2"]);

    // Subir P4 uma posição é trocá-lo com o participante da vez, que só existe na ordem
    // subjacente; na leitura rotacionada P4 é o primeiro e o gesto não teria para onde ir.
    expect(moveCombatantInOrder(order, "p4", -1)).toEqual(["p0", "p1", "p2", "p4", "p3", "p5"]);
    expect(moveCombatantInOrder(rotated, "p4", -1)).toBeNull();

    // O mesmo vale para o arraste: soltar P0 sobre P4 mantém o participante da vez no
    // lugar dele, coisa que a leitura rotacionada não sabe representar.
    expect(moveCombatantBefore(order, "p0", "p4")).toEqual(["p1", "p2", "p3", "p0", "p4", "p5"]);
    expect(moveCombatantBefore(rotated, "p0", "p4")).toEqual(["p0", "p4", "p5", "p1", "p2"]);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-036 — twenty participants
// ---------------------------------------------------------------------------

describe("vinte participantes (REQ-CBA-036)", () => {
  it("desenha os dezenove que não estão na cabeça, na ordem rotacionada", () => {
    const body = renderQueue(ladder(20, 7), true);
    const drawn = [...body.matchAll(/>(P\d+)</g)].map((m) => m[1]);

    const expected = [
      ...Array.from({ length: 12 }, (_, i) => `P${String(i + 8)}`),
      ...Array.from({ length: 7 }, (_, i) => `P${String(i)}`),
    ];
    expect(drawn).toEqual(expected);
  });

  it("quem rola é a lista do painel; a cabeça fica fora dela", () => {
    const source = combatPanelSource();
    const head = source.indexOf("<TurnHead");
    const list = source.indexOf('class="combat-panel__list"');

    expect(head).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(head);
    expect(/\.combat-panel__list\s*\{([\s\S]*?)\}/.exec(source)?.[1] ?? "").toMatch(
      /overflow-y:\s*auto/,
    );
    // The queue itself never scrolls: it is the content of the panel's scroller, so a
    // second scroller here would trap the wheel inside one of the two groups.
    expect(styleOfQueue()).not.toMatch(/overflow-y:\s*(auto|scroll)/);
  });

  it("o rótulo do grupo acompanha a rolagem em vez de sumir", () => {
    expect(ruleOf(styleOfQueue(), ".combat-queue__group-label")).toMatch(/position:\s*sticky/);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-068 — remover participante
// ---------------------------------------------------------------------------

describe("remover participante do encontro (REQ-CBA-068)", () => {
  const remove = t("FUSION.Combat.RemoveFromCombat");

  it("papel privilegiado tem o gesto na montagem", () => {
    const body = renderQueue(setup(4), true);

    expect(body).toContain(remove);
    expect(body).toContain("action-btn--danger");
  });

  it("papel privilegiado tem o gesto com o encontro em andamento", () => {
    const body = renderQueue(ladder(4, 1), true);

    expect(body).toContain(remove);
    expect(body).toContain("action-btn--danger");
  });

  it("o gesto existe uma vez por participante desenhado, não só na primeira linha", () => {
    const body = renderQueue(setup(4), true);
    const occurrences = body.split(remove).length - 1;

    // title + aria-label por linha, nas quatro linhas da montagem.
    expect(occurrences).toBe(8);
  });

  it("quem não tem papel privilegiado não recebe o gesto, em fase nenhuma", () => {
    for (const combat of [setup(4), ladder(4, 1)]) {
      const body = renderQueue(combat, false);

      expect(body).not.toContain(remove);
      expect(body).not.toContain("action-btn--danger");
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-076 — marcar alvo não existe nesta aba, para papel nenhum
// ---------------------------------------------------------------------------

describe("o painel não oferece marcar alvo (REQ-CBA-076)", () => {
  // DEC-CBA-05: mirar é gesto espacial e vive no canvas (REQ-CBT-053..055). O requisito é
  // negativo, então a prova é a ausência — nos dois papéis e nas duas fases.
  it("nenhuma linha desenha controle de alvo, em papel ou fase alguma", () => {
    for (const gmControls of [true, false]) {
      for (const combat of [setup(4), ladder(4, 1)]) {
        const body = renderQueue(combat, gmControls);

        expect(body).not.toMatch(/alvo/i);
        expect(body).not.toMatch(/target/i);
      }
    }
  });

  it("a fila não expõe callback de alvo e o painel não liga nenhum ao servidor", () => {
    const queueSource = readFileSync(
      fileURLToPath(new URL("../CombatQueue.svelte", import.meta.url)),
      "utf8",
    );

    expect(queueSource).not.toContain("onTarget");
    expect(combatPanelSource()).not.toContain("combatActions.target");
  });

  it("não sobrou texto de alvo em bundle nenhum: a chave não resolve", () => {
    // i18n devolve a própria chave quando nenhum bundle registrado a define.
    expect(t("FUSION.Combat.TargetToken")).toBe("FUSION.Combat.TargetToken");
  });
});
