/**
 * combatQueue.test.ts — the queue below the turn head (spec 40 §5.4, task G051).
 *
 * The order the panel draws is not the raw initiative order: it is that order **rotated
 * from the current turn** — first whoever still acts this round, then whoever already
 * acted, in a group that is kept and labelled rather than dropped. That rotation, the
 * split into the two groups, the hidden-participant filter and the two reorder gestures
 * are pure functions here so they can be proved without a DOM.
 *
 * Covers REQ-CBA-030 (rotated from the current turn), REQ-CBA-031 (the acted group is
 * distinct and never omitted), REQ-CBA-034 (hidden shows only to a privileged role),
 * REQ-CBA-035 (reorder by drag and by keyboard) and REQ-CBA-036 (twenty participants).
 * REQ-CBA-032 and REQ-CBA-033 are proved on the markup, in `CombatQueue.test.ts`.
 */

import { describe, expect, it } from "vitest";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

import {
  buildRotatedQueue,
  buildTrackerRows,
  moveCombatantBefore,
  moveCombatantInOrder,
} from "../combatTracker.js";
import type { TrackerRow } from "../combatTracker.js";

// ---------------------------------------------------------------------------
// Factories
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
    started: true,
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

/**
 * A combat with `count` participants whose initiative descends from `count` to 1, so the
 * sorted order is exactly `p0, p1, … p(count-1)` and any rotation is readable by name.
 */
function makeLadder(count: number, activeIndex: number): CombatDocument {
  const combatants = Array.from({ length: count }, (_, i) =>
    makeCombatant({
      _id: `p${String(i)}`,
      tokenId: `t${String(i)}`,
      actorId: `a${String(i)}`,
      name: `P${String(i)}`,
      initiative: count - i,
    }),
  );
  return makeCombat({ combatants, activeCombatantId: `p${String(activeIndex)}` });
}

function namesOf(entries: readonly { row: TrackerRow }[]): string[] {
  return entries.map((entry) => entry.row.name);
}

// ---------------------------------------------------------------------------
// REQ-CBA-030 / REQ-CBA-031 — the rotation and the two groups
// ---------------------------------------------------------------------------

describe("fila rotacionada a partir do turno atual (REQ-CBA-030)", () => {
  it("lista primeiro quem ainda age nesta rodada, depois quem já agiu", () => {
    const rows = buildTrackerRows(makeLadder(6, 2));

    const queue = buildRotatedQueue(rows, true);

    expect(namesOf(queue.upcoming)).toEqual(["P3", "P4", "P5"]);
    expect(namesOf(queue.acted)).toEqual(["P0", "P1"]);
    expect(namesOf(queue.entries)).toEqual(["P3", "P4", "P5", "P0", "P1"]);
    expect(queue.rotated).toBe(true);
  });

  it("não repete na fila o participante da vez — ele está na cabeça", () => {
    const rows = buildTrackerRows(makeLadder(6, 2));

    const queue = buildRotatedQueue(rows, true);

    expect(namesOf(queue.entries)).not.toContain("P2");
    expect(queue.entries).toHaveLength(rows.length - 1);
  });

  it("com o primeiro da ordem na vez, ninguém agiu ainda e nada é rotacionado", () => {
    const rows = buildTrackerRows(makeLadder(4, 0));

    const queue = buildRotatedQueue(rows, true);

    expect(namesOf(queue.upcoming)).toEqual(["P1", "P2", "P3"]);
    expect(queue.acted).toHaveLength(0);
  });

  it("com o último da ordem na vez, todos os demais já agiram", () => {
    const rows = buildTrackerRows(makeLadder(4, 3));

    const queue = buildRotatedQueue(rows, true);

    expect(queue.upcoming).toHaveLength(0);
    expect(namesOf(queue.acted)).toEqual(["P0", "P1", "P2"]);
  });

  it("sem turno ativo — montagem — a fila é a ordem crua, sem grupo de quem agiu", () => {
    const combat = makeCombat({
      started: false,
      activeCombatantId: null,
      combatants: [
        makeCombatant({ _id: "p0", name: "P0", initiative: 20 }),
        makeCombatant({ _id: "p1", name: "P1", initiative: 10 }),
      ],
    });

    const queue = buildRotatedQueue(buildTrackerRows(combat), true);

    expect(namesOf(queue.entries)).toEqual(["P0", "P1"]);
    expect(queue.acted).toHaveLength(0);
    expect(queue.rotated).toBe(false);
  });
});

describe("o grupo de quem já agiu (REQ-CBA-031)", () => {
  it("é marcado como grupo próprio, e não some da lista", () => {
    const rows = buildTrackerRows(makeLadder(5, 3));

    const queue = buildRotatedQueue(rows, true);

    expect(queue.acted.map((entry) => entry.group)).toEqual(["acted", "acted", "acted"]);
    expect(queue.upcoming.every((entry) => entry.group === "upcoming")).toBe(true);
    expect(queue.entries).toHaveLength(rows.length - 1);
  });

  it("numera a fila continuamente: quem já agiu vem depois de quem ainda age", () => {
    const queue = buildRotatedQueue(buildTrackerRows(makeLadder(5, 2)), true);

    expect(queue.entries.map((entry) => entry.queueIndex)).toEqual([0, 1, 2, 3]);
    expect(queue.acted[0]?.queueIndex).toBe(queue.upcoming.length);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-034 — hidden
// ---------------------------------------------------------------------------

describe("participante oculto (REQ-CBA-034)", () => {
  const combat = makeCombat({
    activeCombatantId: "p1",
    combatants: [
      makeCombatant({ _id: "p0", name: "P0", initiative: 30 }),
      makeCombatant({ _id: "p1", name: "P1", initiative: 20 }),
      makeCombatant({ _id: "p2", name: "Espião", initiative: 15, hidden: true }),
      makeCombatant({ _id: "p3", name: "P3", initiative: 10 }),
    ],
  });

  it("aparece para papel privilegiado, marcado como oculto", () => {
    const queue = buildRotatedQueue(buildTrackerRows(combat), true);

    expect(namesOf(queue.entries)).toEqual(["Espião", "P3", "P0"]);
    expect(queue.entries.find((entry) => entry.row.name === "Espião")?.row.isHidden).toBe(true);
  });

  it("não aparece para quem não tem papel privilegiado, nem ocupa lugar na fila", () => {
    const queue = buildRotatedQueue(buildTrackerRows(combat), false);

    expect(namesOf(queue.entries)).toEqual(["P3", "P0"]);
    expect(queue.entries.some((entry) => entry.row.isHidden)).toBe(false);
  });

  it("a rotação continua correta depois de tirar o oculto da fila", () => {
    const withHiddenBeforeActive = makeCombat({
      activeCombatantId: "p2",
      combatants: [
        makeCombatant({ _id: "p0", name: "P0", initiative: 30 }),
        makeCombatant({ _id: "p1", name: "Espião", initiative: 25, hidden: true }),
        makeCombatant({ _id: "p2", name: "P2", initiative: 20 }),
        makeCombatant({ _id: "p3", name: "P3", initiative: 10 }),
      ],
    });

    const queue = buildRotatedQueue(buildTrackerRows(withHiddenBeforeActive), false);

    expect(namesOf(queue.upcoming)).toEqual(["P3"]);
    expect(namesOf(queue.acted)).toEqual(["P0"]);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-036 — twenty participants
// ---------------------------------------------------------------------------

describe("vinte participantes (REQ-CBA-036)", () => {
  it("a ordem rotacionada de 20 participantes é exatamente a esperada", () => {
    const rows = buildTrackerRows(makeLadder(20, 7));

    const queue = buildRotatedQueue(rows, true);

    const expectedUpcoming = Array.from({ length: 12 }, (_, i) => `P${String(i + 8)}`);
    const expectedActed = Array.from({ length: 7 }, (_, i) => `P${String(i)}`);

    expect(namesOf(queue.upcoming)).toEqual(expectedUpcoming);
    expect(namesOf(queue.acted)).toEqual(expectedActed);
    expect(queue.entries).toHaveLength(19);
  });

  it("com 20 participantes e um derrotado, o derrotado permanece na fila (REQ-CBA-033)", () => {
    const combat = makeLadder(20, 0);
    const defeated = combat.combatants[13];
    if (defeated === undefined) throw new Error("fixture must have 20 participants");
    const withDefeated = makeCombat({
      ...combat,
      combatants: combat.combatants.map((c) =>
        c._id === defeated._id ? { ...c, defeated: true } : c,
      ),
    });

    const queue = buildRotatedQueue(buildTrackerRows(withDefeated), true);

    const entry = queue.entries.find((e) => e.row.id === defeated._id);
    expect(entry).toBeDefined();
    expect(entry?.row.isDefeated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-035 — reorder
// ---------------------------------------------------------------------------

describe("reordenar por teclado (REQ-CBA-035)", () => {
  const order = ["a", "b", "c", "d"];

  it("sobe um participante uma posição", () => {
    expect(moveCombatantInOrder(order, "c", -1)).toEqual(["a", "c", "b", "d"]);
  });

  it("desce um participante uma posição", () => {
    expect(moveCombatantInOrder(order, "b", 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("não faz nada no topo nem no fim — devolve null em vez de reenviar a mesma ordem", () => {
    expect(moveCombatantInOrder(order, "a", -1)).toBeNull();
    expect(moveCombatantInOrder(order, "d", 1)).toBeNull();
    expect(moveCombatantInOrder(order, "b", 0)).toBeNull();
  });

  it("ignora participante que não está na ordem", () => {
    expect(moveCombatantInOrder(order, "zz", -1)).toBeNull();
  });

  it("não muta a ordem recebida", () => {
    const source = [...order];
    moveCombatantInOrder(source, "c", -1);
    expect(source).toEqual(order);
  });
});

describe("reordenar por arraste (REQ-CBA-035)", () => {
  const order = ["a", "b", "c", "d"];

  it("solta o arrastado imediatamente antes do alvo, vindo de baixo", () => {
    expect(moveCombatantBefore(order, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("solta o arrastado imediatamente antes do alvo, vindo de cima", () => {
    expect(moveCombatantBefore(order, "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  it("soltar em cima de si mesmo ou fora da ordem não é um reordenamento", () => {
    expect(moveCombatantBefore(order, "b", "b")).toBeNull();
    expect(moveCombatantBefore(order, "zz", "b")).toBeNull();
    expect(moveCombatantBefore(order, "b", "zz")).toBeNull();
  });

  it("não muta a ordem recebida", () => {
    const source = [...order];
    moveCombatantBefore(source, "d", "b");
    expect(source).toEqual(order);
  });
});
