/**
 * CombatOwnTurn.test.ts — the player's own turn, in the panel (spec 40 §5.8).
 *
 * The server lane opened `combat:nextTurn` to the owner of the participant of the turn
 * (REQ-CBA-081, proved against a real player socket in
 * `packages/server/src/__tests__/combat-own-turn.test.ts`). This file is the other end of
 * that contract: the panel has to actually OFFER the gesture, and has to say whose turn
 * it is — a capability nobody can reach is a capability nobody has.
 *
 * Covers REQ-CBA-072 (the panel offers "end my turn" to the owner of the current
 * participant, through the same op that advances), REQ-CBA-073 (no advance control when
 * the turn is not theirs) and REQ-CBA-074 (your-turn notice, and otherwise how many turns
 * are left until it).
 *
 * The panel needs a live socket, so its own wiring is read off its source, the way
 * `TurnHead.test.ts` and `CombatVitals.test.ts` already do; the decision it delegates to
 * is proved directly, as a pure function, and the head's markup is rendered.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

import TurnHead from "../TurnHead.svelte";
import {
  buildRotatedQueue,
  buildTrackerRows,
  turnsUntilOwnTurn,
} from "../../../lib/combat/combatTracker.js";
import {
  activeCombatantIsOwnedBy,
  ownedActorIdsOf,
} from "../../../lib/combat/combatBadge.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// ---------------------------------------------------------------------------
// Factories — a four-participant encounter whose turn order reads by name
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

/** p0..p3, initiative descending, so the ring reads p0 → p1 → p2 → p3 → p0. */
function makeLadder(activeIndex: number): CombatDocument {
  const combatants = Array.from({ length: 4 }, (_, i) =>
    makeCombatant({
      _id: `p${String(i)}`,
      tokenId: `t${String(i)}`,
      actorId: `a${String(i)}`,
      name: `P${String(i)}`,
      initiative: 4 - i,
      hasPlayerOwner: true,
    }),
  );
  return makeCombat({ combatants, activeCombatantId: `p${String(activeIndex)}` });
}

function queueOf(combat: CombatDocument): ReturnType<typeof buildRotatedQueue> {
  return buildRotatedQueue(buildTrackerRows(combat), false);
}

/** Actor documents as the world mirror holds them, with real ownership entries. */
function actorsOwnedBy(userId: string, ...actorIds: string[]): Record<string, unknown>[] {
  return ["a0", "a1", "a2", "a3"].map((id) => ({
    _id: id,
    ownership: actorIds.includes(id) ? { default: 0, [userId]: 3 } : { default: 0 },
  }));
}

function panelSource(): string {
  return readFileSync(fileURLToPath(new URL("../CombatPanel.svelte", import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// REQ-CBA-072 / REQ-CBA-073 — who is offered the advance
// ---------------------------------------------------------------------------

describe("REQ-CBA-072/REQ-CBA-073 — encerrar o próprio turno", () => {
  it("REQ-CBA-072: a vez de um participante do usuário é reconhecida pela posse real do ator", () => {
    const combat = makeLadder(2);
    const owned = ownedActorIdsOf(actorsOwnedBy("user-1", "a2"), "user-1");

    expect(activeCombatantIsOwnedBy(combat, owned)).toBe(true);
  });

  it("REQ-CBA-073: a vez do personagem de OUTRO jogador não é a sua, mesmo sendo de jogador", () => {
    const combat = makeLadder(2);
    // Every participant has `hasPlayerOwner: true` here — the proxy that would say "yours"
    // for all four. Ownership is what separates them.
    expect(combat.combatants.every((c) => c.hasPlayerOwner)).toBe(true);

    const owned = ownedActorIdsOf(actorsOwnedBy("user-1", "a0"), "user-1");
    expect(activeCombatantIsOwnedBy(combat, owned)).toBe(false);
  });

  it("REQ-CBA-072: a cabeça desenha o gesto de encerrar o próprio turno com o rótulo do jogador", () => {
    const { body } = render(TurnHead, {
      props: {
        name: "Fofurinha",
        img: null,
        isYours: true,
        canAdvance: true,
        canPrevious: false,
        advanceLabel: t("FUSION.Combat.TurnHead.EndMyTurn"),
        busy: false,
      },
    });

    expect(body).toContain(t("FUSION.Combat.TurnHead.EndMyTurn"));
    expect(body).toContain(t("FUSION.Combat.TurnHead.YourTurn"));
  });

  it("REQ-CBA-073: sem a vez, a cabeça não desenha controle de avançar nenhum", () => {
    const { body } = render(TurnHead, {
      props: {
        name: "Goblin",
        img: null,
        isYours: false,
        canAdvance: false,
        canPrevious: false,
        busy: false,
      },
    });

    expect(body).not.toContain(t("FUSION.Combat.TurnHead.EndMyTurn"));
    expect(body).not.toContain(t("FUSION.Combat.TurnHead.Advance"));
  });

  it("REQ-CBA-072/REQ-CBA-080: o painel liga o gesto ao MESMO op que avança, sem op novo", () => {
    const source = panelSource();

    expect(source).toContain("canAdvance={gmControls || canEndOwnTurn}");
    expect(source).toContain('advanceLabel={canEndOwnTurn ? t("FUSION.Combat.TurnHead.EndMyTurn")');
    expect(source).toContain("onAdvance={() => void combatActions.nextTurn(socket, combat._id)}");
  });

  it("REQ-CBA-073: o painel decide 'é minha' por posse, nunca por hasPlayerOwner", () => {
    const source = panelSource();

    expect(source).toContain(
      "const isMyTurn = $derived(activeCombatantIsOwnedBy(combat, ownedActorIds))",
    );
    expect(source).toContain("isYours={isMyTurn}");
    // The placeholder the head lane left behind — "any player's character is yours".
    expect(source).not.toContain("isYours={!isGm && row.hasPlayerOwner}");
  });

  it("REQ-CBA-071/REQ-CBA-073: recuar continua só de papel privilegiado no painel", () => {
    expect(panelSource()).toContain("canPrevious={gmControls && (controls?.canPrevious ?? false)}");
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-074 — the notice
// ---------------------------------------------------------------------------

describe("REQ-CBA-074 — aviso de vez", () => {
  it("REQ-CBA-074: conta os turnos que faltam a partir do turno atual", () => {
    const combat = makeLadder(0);
    const owned = ownedActorIdsOf(actorsOwnedBy("user-1", "a2"), "user-1");

    // Ring p0(vez) → p1 → p2: two turns away.
    expect(turnsUntilOwnTurn(queueOf(combat), owned)).toBe(2);
  });

  it("REQ-CBA-074: quem já agiu nesta rodada é contado depois de quem ainda age", () => {
    const combat = makeLadder(2);
    const owned = ownedActorIdsOf(actorsOwnedBy("user-1", "a1"), "user-1");

    // From p2: p3 still acts, then the round turns and p0, p1 act — p1 is three away.
    expect(turnsUntilOwnTurn(queueOf(combat), owned)).toBe(3);
  });

  it("REQ-CBA-074: sem participante seu no encontro não há número a dizer", () => {
    const combat = makeLadder(0);
    const owned = ownedActorIdsOf(actorsOwnedBy("user-1"), "user-1");

    expect(turnsUntilOwnTurn(queueOf(combat), owned)).toBeNull();
  });

  it("REQ-CBA-074: na montagem, sem turno em andamento, não há contagem", () => {
    const combat = makeCombat({
      started: false,
      combatants: makeLadder(0).combatants,
      activeCombatantId: null,
    });
    const owned = ownedActorIdsOf(actorsOwnedBy("user-1", "a2"), "user-1");

    expect(turnsUntilOwnTurn(queueOf(combat), owned)).toBeNull();
  });

  it("REQ-CBA-074: o painel só mostra a contagem a quem não tem papel privilegiado, e nunca na própria vez", () => {
    const source = panelSource();

    expect(source).toContain(
      "const turnsUntilMine = $derived(isMyTurn ? null : turnsUntilOwnTurn(queue, ownedActorIds))",
    );
    expect(source).toContain("{#if showTurnHead && !gmControls && turnsUntilMine !== null}");
  });

  it("REQ-CBA-074: as duas formas do aviso existem nos dois idiomas", () => {
    for (const key of [
      "FUSION.Combat.TurnNotice.Next",
      "FUSION.Combat.TurnNotice.Waiting",
      "FUSION.Combat.TurnHead.EndMyTurn",
    ]) {
      expect(t(key), `${key} deve estar traduzida`).not.toBe(key);
    }

    expect(t("FUSION.Combat.TurnNotice.Waiting", { count: 3 })).toContain("3");
  });
});
