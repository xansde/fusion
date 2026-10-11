/**
 * activeActorStore.test.ts — the reactive reader of the active actor and the publisher the
 * TokenInteractionManager feeds (BAR-F1-01).
 *
 * The rules themselves are pinned in `activeActor.test.ts` (the pure resolver). This file
 * covers what only the store can get wrong: the gate fed by the LIVE ownership of the mirror
 * (`ownedActorIdsOf`, REQ-TOK-032), a selection kept by ACTOR that survives a scene change
 * (REQ-BAR-007), "only the manager of the scene the canvas draws speaks for the selection" (the
 * agreed reading of §2.4: a `destroy()` of a scene that already left the canvas has no effect,
 * while the click on empty canvas of the current scene clears it), the last-used character
 * (Q-BAR-01) and the provider check BAR-F1-04 wires to the registry.
 *
 * Spec: 53-barra-de-acoes.md REQ-BAR-001..005, REQ-BAR-007..010; 41-token.md REQ-TOK-032.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import type { Envelope } from "@fusion/shared";

import {
  getActiveActor,
  noteActorUsed,
  publishTokenSelection,
  setActiveActorProviderCheck,
  setActiveActorViewer,
} from "../activeActorStore.svelte.js";
import type { ActiveActorResult } from "../activeActor.js";
import { worldMirror } from "../../docs/worldSync.js";
import { setActiveSceneId } from "../../docs/activeScene.svelte.js";
import { refreshSceneList } from "../../scenes/scenesState.svelte.js";
import { scenePrepareState } from "../../scenes/prepareState.svelte.js";

// ---------------------------------------------------------------------------
// Fixtures: one table, three scenes
// ---------------------------------------------------------------------------

const PLAYER = "user-player";
const OTHER_PLAYER = "user-other";
const GM = "user-gm";

const PC = "actor-pc";
const PC_2 = "actor-pc-2";
const OTHER_PC = "actor-pc-other";
const NPC = "actor-npc";
const PET = "actor-pet";
/** Everybody may OBSERVE it (`default: OBSERVER`) — observing is not owning. */
const OBSERVED = "actor-observed";
/** The player has LIMITED on it — still not owning. */
const LIMITED = "actor-limited";

const SCENE_A = "scene-a";
const SCENE_B = "scene-b";
/** A scene where none of the actors above has a token. */
const SCENE_C = "scene-c";

const TOK_PC_A = "tok-pc-a";
const TOK_PC_2_A = "tok-pc-2-a";
const TOK_OTHER_PC_A = "tok-pc-other-a";
const TOK_NPC_A = "tok-npc-a";
const TOK_PET_A = "tok-pet-a";
const TOK_OBSERVED_A = "tok-observed-a";
const TOK_LIMITED_A = "tok-limited-a";
const TOK_PC_B = "tok-pc-b";
const TOK_NPC_B = "tok-npc-b";
const TOK_PET_B = "tok-pet-b";

const PLAYER_SEAT = { userId: PLAYER, isGm: false } as const;
const GM_SEAT = { userId: GM, isGm: true } as const;

function actor(
  _id: string,
  type: string,
  ownership: Record<string, number>,
  system: Record<string, unknown> = {},
): Record<string, unknown> {
  return { _id, type, name: _id, img: null, ownership, system, items: [], flags: {} };
}

function npcOwnership(): Record<string, number> {
  return { default: OwnershipLevel.NONE };
}

function actorDocs(): Record<string, unknown>[] {
  return [
    actor(PC, "character", { default: OwnershipLevel.NONE, [PLAYER]: OwnershipLevel.OWNER }),
    actor(PC_2, "character", { default: OwnershipLevel.NONE, [PLAYER]: OwnershipLevel.OWNER }),
    actor(OTHER_PC, "character", {
      default: OwnershipLevel.NONE,
      [OTHER_PLAYER]: OwnershipLevel.OWNER,
    }),
    actor(NPC, "npc", npcOwnership()),
    // DEC-ATR-19: the companion is born with a copy of its owner's ownership.
    actor(
      PET,
      "familiar",
      { default: OwnershipLevel.NONE, [PLAYER]: OwnershipLevel.OWNER },
      { masterActorId: PC },
    ),
    actor(OBSERVED, "npc", { default: OwnershipLevel.OBSERVER }),
    actor(LIMITED, "npc", { default: OwnershipLevel.NONE, [PLAYER]: OwnershipLevel.LIMITED }),
  ];
}

function token(_id: string, actorId: string): Record<string, unknown> {
  return { _id, actorId, actorLink: true, actorDelta: null, x: 0, y: 0, hidden: false };
}

function sceneDocs(): Record<string, unknown>[] {
  return [
    {
      _id: SCENE_A,
      name: "A",
      tokens: [
        token(TOK_PC_A, PC),
        token(TOK_PC_2_A, PC_2),
        token(TOK_OTHER_PC_A, OTHER_PC),
        token(TOK_NPC_A, NPC),
        token(TOK_PET_A, PET),
        token(TOK_OBSERVED_A, OBSERVED),
        token(TOK_LIMITED_A, LIMITED),
      ],
    },
    {
      _id: SCENE_B,
      name: "B",
      tokens: [token(TOK_PC_B, PC), token(TOK_NPC_B, NPC), token(TOK_PET_B, PET)],
    },
    { _id: SCENE_C, name: "C", tokens: [] },
  ];
}

let seq = 1;

/** A canonical server op on the mirror, exactly as the socket would deliver it. */
function feed(type: "doc:update" | "doc:delete", payload: unknown): void {
  seq += 1;
  worldMirror.feedOp({ type, seq, ts: 0, payload } as Envelope);
}

function grantOwnership(actorId: string, ownership: Record<string, number>): void {
  const doc = actorDocs().find((candidate) => candidate["_id"] === actorId)!;
  feed("doc:update", { documentType: "Actor", documents: [{ ...doc, ownership }] });
}

/** The canvas switches scenes, as `TableScreen` sees it: the scene on air changes. */
function canvasShows(sceneId: string): void {
  setActiveSceneId(sceneId, worldMirror);
}

const ownCharacter = (tokenId: string | null): ActiveActorResult => ({
  kind: "actor",
  actorId: PC,
  tokenId,
  via: "own-character",
});
const selected = (actorId: string, tokenId: string | null): ActiveActorResult => ({
  kind: "actor",
  actorId,
  tokenId,
  via: "selection",
});
const GM_HIDDEN: ActiveActorResult = { kind: "none", reason: "gm-no-selection" };

/** Every string a result carries, at any depth (exact ids, never substrings). */
function valuesIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") into.add(value);
  else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) valuesIn(item, into);
  }
  return into;
}

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

beforeEach(() => {
  seq = 1;
  worldMirror.applySnapshot({
    seq,
    activeSceneId: SCENE_A,
    documents: { Actor: actorDocs(), Scene: sceneDocs() },
  } as Parameters<typeof worldMirror.applySnapshot>[0]);
  scenePrepareState.sceneId = null;
  canvasShows(SCENE_A);
  refreshSceneList();
  setActiveActorProviderCheck(() => true);
  // Back to "nobody is seated": a seat change drops the previous seat's selection and uses.
  setActiveActorViewer(null);
});

// ---------------------------------------------------------------------------
// D-BA01 — the gate, fed by the live mirror
// ---------------------------------------------------------------------------

describe("activeActorStore — o gate de posse (D-BA01)", () => {
  it("REQ-BAR-009: jogador sem seleção → o próprio personagem, com o token dele na cena do canvas", () => {
    setActiveActorViewer(PLAYER_SEAT);
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));
  });

  it("D-BA01, teste negativo: o jogador clica num NPC, a barra não muda e ninguém pergunta do NPC ao provedor", () => {
    const providerCheck = vi.fn((_actorId: string) => true);
    setActiveActorProviderCheck(providerCheck);
    setActiveActorViewer(PLAYER_SEAT);
    const before = getActiveActor();

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });

    const after = getActiveActor();
    expect(after).toStrictEqual(ownCharacter(TOK_PC_A));
    expect(after).toStrictEqual(before);
    expect(valuesIn(after).has(NPC)).toBe(false);
    expect(valuesIn(after).has(TOK_NPC_A)).toBe(false);
    expect(providerCheck.mock.calls.flat()).not.toContain(NPC);

    // Control: the very same click, from the Mestre's seat, does give the NPC — the publication
    // reached the store, and only the gate turned it down for the player.
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_A));
  });

  it("D-BA01, teste negativo: o token de OUTRO jogador também não muda a barra", () => {
    const providerCheck = vi.fn((_actorId: string) => true);
    setActiveActorProviderCheck(providerCheck);
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_OTHER_PC_A] });

    const after = getActiveActor();
    expect(after).toStrictEqual(ownCharacter(TOK_PC_A));
    expect(valuesIn(after).has(OTHER_PC)).toBe(false);
    expect(providerCheck.mock.calls.flat()).not.toContain(OTHER_PC);

    // Control: its owner, clicking the same token, gets it.
    setActiveActorViewer({ userId: OTHER_PLAYER, isGm: false });
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_OTHER_PC_A] });
    expect(getActiveActor()).toStrictEqual(selected(OTHER_PC, TOK_OTHER_PC_A));
  });

  it("REQ-BAR-001: ver (OBSERVER) ou conhecer de leve (LIMITED) não é ser dono — nenhum dos dois vira o ator ativo", () => {
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_OBSERVED_A] });
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_LIMITED_A] });
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));
  });

  it("(h) OWNER concedido no meio da sessão muda o resultado sem republicar nem recriar nada; revogado, volta", () => {
    setActiveActorViewer(PLAYER_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));

    grantOwnership(NPC, { default: OwnershipLevel.NONE, [PLAYER]: OwnershipLevel.OWNER });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_A));

    grantOwnership(NPC, { default: OwnershipLevel.NONE, [PLAYER]: OwnershipLevel.OBSERVER });
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));
  });

  it("REQ-BAR-008: o jogador seleciona o próprio companheiro (com provedor); clique no vazio volta ao personagem", () => {
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PET_A] });
    expect(getActiveActor()).toStrictEqual(selected(PET, TOK_PET_A));

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));
  });

  it("I6: ator sem provedor nunca é o ativo (a ligação que a BAR-F1-04 faz ao registry)", () => {
    setActiveActorProviderCheck((actorId) => actorId !== PET && actorId !== NPC);

    setActiveActorViewer(PLAYER_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PET_A] });
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));

    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);
  });

  it("um ator apagado do espelho deixa de ser o ativo", () => {
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_A));

    feed("doc:delete", { documentType: "Actor", ids: [NPC] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);
  });
});

// ---------------------------------------------------------------------------
// D-BA10 and the selection's lifetime
// ---------------------------------------------------------------------------

describe("activeActorStore — Mestre, cliques e troca de cena (D-BA10, REQ-BAR-007)", () => {
  it("D-BA10: Mestre sem seleção → barra oculta; seleciona um NPC → o NPC; clique no vazio → oculta de novo", () => {
    setActiveActorViewer(GM_SEAT);
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_A));

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);
  });

  it("um token que não está na cena não seleciona nada", () => {
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: ["tok-ghost"] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);
  });

  it("(i) REQ-BAR-007: trocar de cena mantém o ator, com o token re-resolvido na cena nova (ou null)", () => {
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });

    // The canvas moves to B; on the way, TableScreen destroys A's manager, whose last word is
    // the empty selection of a scene that is no longer on the canvas.
    canvasShows(SCENE_B);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_B));

    // A scene where the NPC has no token: still the NPC, with no token to point at.
    canvasShows(SCENE_C);
    publishTokenSelection({ sceneId: SCENE_B, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, null));

    canvasShows(SCENE_B);
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_B));

    // The click on empty canvas of the CURRENT scene is the one that clears it.
    publishTokenSelection({ sceneId: SCENE_B, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);
  });

  it("(i) para o jogador, o personagem e o companheiro selecionado também atravessam a troca de cena", () => {
    setActiveActorViewer(PLAYER_SEAT);
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));

    canvasShows(SCENE_B);
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_B));
    canvasShows(SCENE_C);
    expect(getActiveActor()).toStrictEqual(ownCharacter(null));

    canvasShows(SCENE_A);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PET_A] });
    canvasShows(SCENE_B);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(selected(PET, TOK_PET_B));
  });

  it("o destroy na MESMA cena (a mesa desmontou) limpa a seleção, como o clique no vazio", () => {
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });

    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);
  });

  it("Mestre preparando uma cena: só o manager da cena PREPARADA (a que o canvas desenha) mexe no ator", () => {
    setActiveActorViewer(GM_SEAT);
    scenePrepareState.sceneId = SCENE_B;

    // A manager of the scene on air would be stale: the canvas draws the prepared one.
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);

    publishTokenSelection({ sceneId: SCENE_B, tokenIds: [TOK_NPC_B] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_B));

    // The on-air scene's manager being torn down does not touch the prepared scene's selection.
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_B));
  });
});

// ---------------------------------------------------------------------------
// Q-BAR-01, the seat, and the reader
// ---------------------------------------------------------------------------

describe("activeActorStore — último usado, assento e leitura", () => {
  it("Q-BAR-01: com dois personagens vale o último ator ativo que o store publicou", () => {
    setActiveActorViewer(PLAYER_SEAT);
    // Never used: the order of the mirror.
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));

    // Selecting the second character makes it the active actor, which counts as a use...
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PC_2_A] });
    expect(getActiveActor()).toStrictEqual(selected(PC_2, TOK_PC_2_A));

    // ...so with the selection gone, the bar stays on it.
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [] });
    expect(getActiveActor()).toStrictEqual({
      kind: "actor",
      actorId: PC_2,
      tokenId: TOK_PC_2_A,
      via: "own-character",
    });

    // A successful execution through the bar (BAR-F1-04) notes its actor the same way.
    noteActorUsed(PC);
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));
  });

  it("trocar de usuário descarta a seleção do anterior; sem usuário não há barra", () => {
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_NPC_A] });
    expect(getActiveActor()).toStrictEqual(selected(NPC, TOK_NPC_A));

    setActiveActorViewer(PLAYER_SEAT);
    expect(getActiveActor()).toStrictEqual(ownCharacter(TOK_PC_A));

    // Coming back to the Mestre's seat does not resurrect the selection of before.
    setActiveActorViewer(GM_SEAT);
    expect(getActiveActor()).toStrictEqual(GM_HIDDEN);

    setActiveActorViewer(null);
    expect(getActiveActor()).toStrictEqual({ kind: "none", reason: "no-character" });
  });

  it("sem mudança, a leitura devolve a MESMA referência (o $derived da barra não reavalia à toa)", () => {
    setActiveActorViewer(PLAYER_SEAT);
    const first = getActiveActor();
    expect(getActiveActor()).toBe(first);

    // Re-publishing the same thing (a second click on the same token) changes nothing visible.
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PET_A] });
    const pet = getActiveActor();
    publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PET_A] });
    expect(getActiveActor()).toBe(pet);
  });

  it("sem ligação ao registry, todo ator conta como tendo provedor (a BAR-F1-04 liga)", async () => {
    vi.resetModules();
    const store = await import("../activeActorStore.svelte.js");
    const { worldMirror: freshMirror } = await import("../../docs/worldSync.js");
    const { setActiveSceneId: freshSetScene } = await import("../../docs/activeScene.svelte.js");
    freshMirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_A,
      documents: { Actor: actorDocs(), Scene: sceneDocs() },
    } as Parameters<typeof freshMirror.applySnapshot>[0]);
    freshSetScene(SCENE_A, freshMirror);

    store.setActiveActorViewer(PLAYER_SEAT);
    store.publishTokenSelection({ sceneId: SCENE_A, tokenIds: [TOK_PET_A] });
    expect(store.getActiveActor()).toStrictEqual(selected(PET, TOK_PET_A));
  });
});

// ---------------------------------------------------------------------------
// Wiring and the single ownership predicate
// ---------------------------------------------------------------------------

describe("activeActorStore — ligação na mesa e o predicado único", () => {
  it("REQ-BAR-004: o store usa ownedActorIdsOf e não lê ownership por conta própria", () => {
    const store = source("../activeActorStore.svelte.ts");
    expect(store).toContain("ownedActorIdsOf");
    expect(store).not.toMatch(/getUserLevel|OwnershipLevel|\["ownership"\]|\.ownership\b/);
  });

  it("a TableScreen alimenta o viewer pelo papel privilegiado e passa o publicador ao manager", () => {
    const table = source("../../../components/TableScreen.svelte");
    expect(table).toContain("setActiveActorViewer(");
    expect(table).toContain("onSelectionChange");
    expect(table).toContain("publishTokenSelection(");
    // The privileged role — the same threshold `canMoveToken` uses — not `role === 4`.
    expect(table).toMatch(/isGm:\s*[^,}\n]*>=\s*ROLE_ASSISTANT/);
  });
});
