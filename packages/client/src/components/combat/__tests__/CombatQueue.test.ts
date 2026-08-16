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
 * absent for the rest), REQ-CBA-035 (drag handle plus a keyboard alternative) and
 * REQ-CBA-036 (twenty participants scroll, the head does not travel with them).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

import CombatQueue from "../CombatQueue.svelte";
import CombatPanelSourceMarker from "../CombatPanel.svelte";
import { buildRotatedQueue, buildTrackerRows } from "../../../lib/combat/combatTracker.js";
import type { RotatedQueue } from "../../../lib/combat/combatTracker.js";
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

function queueOf(combat: CombatDocument, canSeeHidden: boolean): RotatedQueue {
  return buildRotatedQueue(buildTrackerRows(combat), canSeeHidden);
}

function renderQueue(queue: RotatedQueue, gmControls: boolean): string {
  const { body } = render(CombatQueue, {
    props: {
      queue,
      gmControls,
      busy: false,
      order: queue.entries.map((entry) => entry.row.id),
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
  const body = renderQueue(queueOf(ladder(6, 3), true), true);

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
    const first = renderQueue(queueOf(ladder(4, 0), true), true);

    expect(first).not.toContain("combat-queue__group--acted");
    expect(first).not.toContain(t("FUSION.Combat.Queue.Acted"));
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-032 / REQ-CBA-033 — the row
// ---------------------------------------------------------------------------

describe("o que cada linha mostra (REQ-CBA-032)", () => {
  it("desenha retrato e nome de cada participante", () => {
    const body = renderQueue(queueOf(ladder(3, 0), true), true);

    expect(body).toContain("combatant-row__portrait");
    expect(body).toContain(">P1<");
    expect(body).toContain('title="P1"');
  });
});

describe("derrotado (REQ-CBA-033)", () => {
  const combat = ladder(4, 0, (i) => (i === 2 ? { defeated: true } : {}));
  const body = renderQueue(queueOf(combat, true), true);

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
    const body = renderQueue(queueOf(combat, true), true);

    expect(body).toContain(">Espião<");
    expect(body).toContain(t("FUSION.Combat.Queue.Hidden"));
    expect(body).toContain("combatant-row--hidden");
  });

  it("não aparece de forma alguma para quem não tem papel privilegiado", () => {
    const body = renderQueue(queueOf(combat, false), false);

    expect(body).not.toContain("Espião");
    expect(body).not.toContain("combatant-row--hidden");
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-035 / REQ-CBA-093 — reorder
// ---------------------------------------------------------------------------

describe("reordenar a fila (REQ-CBA-035)", () => {
  it("papel privilegiado recebe uma alça arrastável que também é botão de teclado", () => {
    const body = renderQueue(queueOf(ladder(4, 0), true), true);

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
    const body = renderQueue(queueOf(ladder(4, 0), true), false);

    expect(body).not.toContain("combatant-row__handle");
    expect(body).not.toContain('draggable="true"');
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-036 — twenty participants
// ---------------------------------------------------------------------------

describe("vinte participantes (REQ-CBA-036)", () => {
  it("desenha os dezenove que não estão na cabeça, na ordem rotacionada", () => {
    const body = renderQueue(queueOf(ladder(20, 7), true), true);
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
