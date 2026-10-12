/**
 * ActionBar.test.ts — the action bar on the table (BAR-F1-04; spec 53 REQ-BAR-010/011,
 * REQ-BAR-022..033, REQ-BAR-035..040, REQ-BAR-104, DEC-BAR-01/10/15, D-15; prototype T1, T2, T6, T7).
 *
 * The client's Vitest runs in `node`, with no DOM (tasks.md §2.10), so what a component test can
 * look at is the markup `svelte/server` renders and the component's own stylesheet and template.
 * The BEHAVIOUR — a click, the busy slot, a refusal, the keys, the fold, the strip's message — is
 * in `actionBarController.test.ts` and the pure modules next to it; this file proves the shell
 * DRAWS the right thing for the right actor, and nothing else:
 *
 *  - the strip, the seven tabs and the twelve favourite positions (T1), each slot with its short
 *    name under the icon (DEC-BAR-15);
 *  - **no bar** for a Mestre with nothing selected (D-BA10) and for an actor without a provider
 *    (REQ-BAR-012);
 *  - **the ownership gate, in the shell** (D-BA01, I3): a spy provider registered for the NPC is NEVER
 *    called with it when a player selects its token, and the bar stays on the player's character —
 *    with a control that proves the spy would have been called if the gate had let it through;
 *  - a faded entry says why and is NOT disabled (REQ-BAR-031, REQ-BAR-104);
 *  - whose turn it is, and "Encerrar turno" only where it belongs (REQ-BAR-035, REQ-BAR-040, Q-BAR-08);
 *  - a condition shows only its name until it is clicked (D-B23);
 *  - D-15: nothing in the markup counts, sums or shows "ações restantes".
 *
 * What only a browser can prove — the real focus after a click, the hover tooltip, the position over
 * the canvas — is in the Edge run of the task (the prints) and in the lote's roteiro (BAR-F2-07).
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import type { Envelope } from "@fusion/shared";

import "../../../lib/i18n/index.js";
import ActionBar from "../ActionBar.svelte";
import SlotGrid from "../SlotGrid.svelte";
import StatusStrip from "../StatusStrip.svelte";
import {
  publishTokenSelection,
  setActiveActorProviderCheck,
  setActiveActorViewer,
} from "../../../lib/actionbar/activeActorStore.svelte.js";
import { actionBarRegistry } from "../../../lib/actionbar/actionBarRegistry.js";
import { publishDrawerOpen } from "../../../lib/sidebar/drawerLayout.svelte.js";
import { combatStore } from "../../../lib/combat/combatStore.svelte.js";
import { setActiveSceneId } from "../../../lib/docs/activeScene.svelte.js";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { scenePrepareState } from "../../../lib/scenes/prepareState.svelte.js";
import { refreshSceneList } from "../../../lib/scenes/scenesState.svelte.js";
import type { ActionBarEntry, ActionBarStatus } from "../../../lib/actionbar/types.js";
import {
  createStubProvider,
  makeEntry,
  makeStubEntries,
  makeStubStatus,
} from "../../../lib/actionbar/__tests__/stubProvider.js";
import type { TurnView } from "../../../lib/actionbar/turn.js";
import { baseCss } from "../../common/__tests__/floatingTestUtils.js";

// ---------------------------------------------------------------------------
// One table: a player with a character, an NPC, another player's character
// ---------------------------------------------------------------------------

const PLAYER = "user-player";
const OTHER_PLAYER = "user-other";
const GM = "user-gm";

const PC = "actor-pc";
const OTHER_PC = "actor-pc-other";
const NPC = "actor-npc";
/** The player's companion: a familiar, owned by the player (DEC-ATR-19) — and with no provider of its own. */
const PET = "actor-pet";

const SCENE = "scene-a";
const TOK_PC = "tok-pc";
const TOK_NPC = "tok-npc";
const TOK_OTHER_PC = "tok-other-pc";
const TOK_PET = "tok-pet";

const PLAYER_SEAT = { userId: PLAYER, isGm: false } as const;
const GM_SEAT = { userId: GM, isGm: true } as const;

function actor(_id: string, type: string, name: string, ownership: Record<string, number>) {
  return { _id, type, name, img: null, ownership, system: {}, items: [], flags: {} };
}

function token(_id: string, actorId: string) {
  return { _id, actorId, actorLink: true, actorDelta: null, x: 0, y: 0, hidden: false };
}

let seq = 1;
function feed(type: "doc:update", payload: unknown): void {
  seq += 1;
  worldMirror.feedOp({ type, seq, ts: 0, payload } as Envelope);
}

function seedWorld(): void {
  seq = 1;
  worldMirror.applySnapshot({
    seq,
    activeSceneId: SCENE,
    documents: {
      Actor: [
        actor(PC, "character", "Huo Jinwu", {
          default: OwnershipLevel.NONE,
          [PLAYER]: OwnershipLevel.OWNER,
        }),
        actor(OTHER_PC, "character", "Bhrotto Raiz-funda", {
          default: OwnershipLevel.NONE,
          [OTHER_PLAYER]: OwnershipLevel.OWNER,
        }),
        actor(NPC, "npc", "Capitão Bandido Secreto", { default: OwnershipLevel.NONE }),
        actor(PET, "familiar", "Urso", {
          default: OwnershipLevel.NONE,
          [PLAYER]: OwnershipLevel.OWNER,
        }),
      ],
      Scene: [
        {
          _id: SCENE,
          name: "A",
          tokens: [
            token(TOK_PC, PC),
            token(TOK_OTHER_PC, OTHER_PC),
            token(TOK_NPC, NPC),
            token(TOK_PET, PET),
          ],
        },
      ],
    },
  } as Parameters<typeof worldMirror.applySnapshot>[0]);
  scenePrepareState.sceneId = null;
  setActiveSceneId(SCENE, worldMirror);
  refreshSceneList();
}

function bar(seat: { userId: string; isGm: boolean } = PLAYER_SEAT): string {
  return render(ActionBar, {
    props: { socket: {} as never, worldId: "world-1", userId: seat.userId, isGm: seat.isGm },
  }).body;
}

/** The slot buttons, by entry id. */
function slotIds(html: string): string[] {
  return [...html.matchAll(/<button[^>]*\sdata-entry-id="([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** The opening tag of the slot button of an entry. */
function slotTag(html: string, entryId: string): string {
  const match = new RegExp(`<button[^>]*\\sdata-entry-id="${entryId}"[^>]*>`).exec(html);
  if (!match) throw new Error(`no slot for ${entryId}`);
  return match[0];
}

/** The opening tag of the first element whose attributes include `marker` (an exact attribute text). */
function tagWith(html: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<[a-z]+[^>]*${escaped}[^>]*>`).exec(html);
  if (!match) throw new Error(`no element carries ${marker}`);
  return match[0];
}

/** Visible text of a body, tags and comments out, whitespace collapsed. */
function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function combatDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "combat-1",
    sceneId: SCENE,
    started: true,
    ended: false,
    round: 2,
    activeCombatantId: "c-pc",
    combatants: [
      { _id: "c-pc", actorId: PC, name: "Huo Jinwu", hidden: false },
      { _id: "c-npc", actorId: NPC, name: "Capitão Bandido", hidden: false },
    ],
    ...overrides,
  } as never;
}

beforeEach(() => {
  seedWorld();
  actionBarRegistry.reset();
  setActiveActorProviderCheck(() => true);
  setActiveActorViewer(null);
  publishDrawerOpen(false);
  combatStore.combat = null;
});

afterEach(() => {
  actionBarRegistry.reset();
  setActiveActorViewer(null);
  combatStore.combat = null;
});

// ---------------------------------------------------------------------------
// The bar: strip, tabs and twelve slots (T1)
// ---------------------------------------------------------------------------

describe("ActionBar — a faixa, as abas e os 12 slots (T1)", () => {
  beforeEach(() => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
  });

  it("monta a barra do personagem do jogador, com nome acessível e o ator no DOM", () => {
    const html = bar();

    expect(html).toContain('aria-label="Barra de ações"');
    expect(html).toContain(`data-actor-id="${PC}"`);
    expect(textOf(html)).toContain("Personagem Stub");
  });

  it("tem Favoritos e as seis abas — Golpes, Magias, Ações, Itens, Reações e Testes — e Favoritos é a atual", () => {
    const html = bar();

    for (const label of ["Favoritos", "Golpes", "Magias", "Ações", "Itens", "Reações", "Testes"]) {
      expect(html, label).toMatch(
        new RegExp(`<button[^>]*class="tab[^"]*"[^>]*>[\\s\\S]*?${label}[\\s\\S]*?</button>`),
      );
    }
    expect([...html.matchAll(/data-tab="/g)]).toHaveLength(7);
    const active = tagWith(html, 'data-tab="favorites"');
    expect(active).toMatch(/is-active/);
    expect(active).toContain('aria-pressed="true"');
    expect(tagWith(html, 'data-tab="strikes"')).toContain('aria-pressed="false"');
  });

  it("os 12 lugares da linha de Favoritos têm as teclas 1–9, 0, − e = no selo", () => {
    const html = bar();
    const seals = [
      ...html.matchAll(/<i class="(?:slot__k|slot-empty__k)[^"]*"[^>]*>([^<]*)<\/i>/g),
    ].map((m) => m[1]);

    expect(seals).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "−", "="]);
  });

  it("a semente do ator que ainda não tem favoritos: golpes, magias e ações do provedor, até quatro de cada, nos primeiros slots", () => {
    const html = bar();

    // Os alternáveis (`toggle:*`) moram na aba Ações mas não são ações: a semente é por TIPO, não por aba.
    expect(slotIds(html)).toEqual([
      "strike:stub-sword",
      "strike:stub-bow",
      "spell:stub-main:burst",
      "spell:stub-main:heal",
      "action:stub-seek",
      "action:stub-stride",
      "action:stub-command",
    ]);
  });

  it("DEC-BAR-15: cada slot mostra o nome curto embaixo do ícone; o nome completo fica para o leitor de tela e o tooltip", () => {
    const html = bar();

    // `shortLabel` do provedor ("Espada"); sem ele, o núcleo abrevia o rótulo ("Comandar").
    expect(html).toMatch(/<span class="slot__name[^"]*"[^>]*>Espada<\/span>/);
    expect(html).toMatch(/<span class="slot__name[^"]*"[^>]*>Comandar<\/span>/);
    expect(slotTag(html, "strike:stub-sword")).toContain('aria-label="Espada Longa, 1 ação, +9"');
  });

  it("o selo de teclado só existe nos favoritos e aponta para a tecla certa (aria-keyshortcuts)", () => {
    const html = bar();

    expect(slotTag(html, "strike:stub-sword")).toContain('aria-keyshortcuts="1"');
    expect(slotTag(html, "action:stub-command")).toContain('aria-keyshortcuts="7"');
  });

  it("custo no canto, selo de patamar e bônus", () => {
    const html = bar();

    expect(html).toMatch(/<i class="slot__c[^"]*"[^>]*>◆<\/i>/);
    expect(html).toMatch(/<i class="slot__seal slot__seal--rank[^"]*"[^>]*>1<\/i>/);
    expect(html).toMatch(/<i class="slot__v[^"]*"[^>]*>\+9<\/i>/);
  });

  it("alternável ligado: o botão diz que está pressionado (ele vive na aba Ações, não entra na semente)", () => {
    const html = render(SlotGrid, {
      props: {
        tab: "actions",
        entries: makeStubEntries(),
        favorites: [],
        isBusy: () => false,
        altHeld: false,
        menuEntryId: null,
        onrun: () => undefined,
        oncontext: () => undefined,
        onhover: () => undefined,
        onleave: () => undefined,
      },
    }).body;

    expect(slotTag(html, "toggle:stub-guard")).toContain('data-state="active"');
    expect(slotTag(html, "toggle:stub-guard")).toContain('aria-pressed="true"');
    expect(slotIds(bar())).not.toContain("toggle:stub-guard");
  });

  it("o botão de recolher existe e a barra não vem recolhida", () => {
    const html = bar();

    expect(html).toContain('data-action="collapse"');
    expect(html).not.toContain('data-action="expand"');
    expect(html).not.toContain("abar--collapsed");
  });

  it("D-BA16: nada de arrastar nem de modo mira — o slot não é draggable", () => {
    const html = bar();

    expect(html).not.toContain("draggable");
  });
});

// ---------------------------------------------------------------------------
// Whose bar: none, and the ownership gate (D-BA01, D-BA10)
// ---------------------------------------------------------------------------

describe("ActionBar — de quem é a barra", () => {
  it("D-BA10: o Mestre sem seleção não vê barra", () => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    actionBarRegistry.register("Actor", "npc", createStubProvider().provider);
    setActiveActorViewer(GM_SEAT);

    const html = bar(GM_SEAT);

    expect(html).not.toContain("abar");
    expect(textOf(html)).toBe("");
  });

  it("REQ-BAR-012: ator sem provedor não tem barra — nem o personagem do jogador", () => {
    setActiveActorViewer(PLAYER_SEAT);

    // Nenhum provedor registrado: o personagem não é ator ativo (REQ-BAR-009) e não há o que desenhar.
    expect(bar()).not.toContain("abar");
  });

  it("jogador sem personagem: sem barra", () => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer({ userId: "user-sem-personagem", isGm: false });

    expect(bar({ userId: "user-sem-personagem", isGm: false })).not.toContain("abar");
  });

  it("D-BA01 / I3, teste negativo: o jogador seleciona o NPC e a barra segue no personagem — o provedor nunca é chamado com o NPC", () => {
    const pcSpy = createStubProvider();
    const npcSpy = createStubProvider();
    actionBarRegistry.register("Actor", "character", pcSpy.provider);
    actionBarRegistry.register("Actor", "npc", npcSpy.provider);
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_NPC] });
    const html = bar();

    // A barra é a do personagem.
    expect(html).toContain(`data-actor-id="${PC}"`);
    expect(html).not.toContain(`data-actor-id="${NPC}"`);
    // O provedor do NPC não foi chamado — nem para entradas, nem para a faixa.
    expect(npcSpy.calls.entries).toEqual([]);
    expect(npcSpy.calls.status).toEqual([]);
    // O do personagem só viu o personagem, e nenhum contexto carrega o NPC.
    expect(pcSpy.calls.entries.length).toBeGreaterThan(0);
    for (const ctx of [...pcSpy.calls.entries, ...pcSpy.calls.status]) {
      expect(ctx.actorId).toBe(PC);
      expect(JSON.stringify(ctx)).not.toContain("Capitão Bandido Secreto");
      expect(JSON.stringify(ctx)).not.toContain(NPC);
    }
    // E o que o jogador lê não traz o NPC.
    expect(html).not.toContain("Capitão Bandido Secreto");
    expect(html).not.toContain(TOK_NPC);
  });

  it("controle do teste acima: o MESMO clique no NPC, do assento do Mestre, chama o provedor do NPC", () => {
    const npcSpy = createStubProvider();
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    actionBarRegistry.register("Actor", "npc", npcSpy.provider);
    setActiveActorViewer(GM_SEAT);

    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_NPC] });
    const html = bar(GM_SEAT);

    expect(html).toContain(`data-actor-id="${NPC}"`);
    expect(npcSpy.calls.entries.map((ctx) => ctx.actorId)).toContain(NPC);
  });

  it("o token de OUTRO jogador também não muda a barra (D-BA01)", () => {
    const pcSpy = createStubProvider();
    actionBarRegistry.register("Actor", "character", pcSpy.provider);
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_OTHER_PC] });
    const html = bar();

    expect(html).toContain(`data-actor-id="${PC}"`);
    expect(pcSpy.calls.entries.every((ctx) => ctx.actorId === PC)).toBe(true);
    expect(html).not.toContain("Bhrotto");
  });

  it("o Mestre seleciona o NPC e a barra é a dele, com o contexto do NPC (T6)", () => {
    const npcSpy = createStubProvider({
      status: makeStubStatus({ name: "Capitão Bandido", gmOnly: { ac: 31 } }),
    });
    actionBarRegistry.register("Actor", "npc", npcSpy.provider);
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_NPC] });

    const html = bar(GM_SEAT);

    expect(html).toContain(`data-actor-id="${NPC}"`);
    expect(npcSpy.calls.status[0]?.viewer).toEqual({ userId: GM, isGm: true });
  });

  it("REQ-BAR-009: o jogador seleciona o companheiro dele, que não tem provedor — a barra SEGUE no personagem, não some", () => {
    const pcSpy = createStubProvider();
    actionBarRegistry.register("Actor", "character", pcSpy.provider);
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_PET] });
    const html = bar();

    expect(html).toContain(`data-actor-id="${PC}"`);
    expect(html).not.toContain(`data-actor-id="${PET}"`);
    expect(pcSpy.calls.entries.every((ctx) => ctx.actorId === PC)).toBe(true);
  });

  it("controle do teste acima: quando o companheiro GANHA um provedor, a mesma seleção traz a barra dele", () => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    const petSpy = createStubProvider();
    actionBarRegistry.register("Actor", "familiar", petSpy.provider);
    setActiveActorViewer(PLAYER_SEAT);

    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_PET] });
    const html = bar();

    expect(html).toContain(`data-actor-id="${PET}"`);
    expect(petSpy.calls.entries.map((ctx) => ctx.actorId)).toContain(PET);
  });

  it("o Mestre seleciona um ator cujo tipo não tem provedor (hoje, o NPC): sem barra, e ninguém foi chamado", () => {
    const pcSpy = createStubProvider();
    actionBarRegistry.register("Actor", "character", pcSpy.provider);
    setActiveActorViewer(GM_SEAT);

    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_NPC] });
    const html = bar(GM_SEAT);

    expect(html).not.toContain("abar");
    expect(pcSpy.calls.entries).toEqual([]);
    expect(pcSpy.calls.status).toEqual([]);
  });

  it("uma barra que acaba de ficar sem provedor some inteira (o registro foi limpo)", () => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
    expect(bar()).toContain("abar");

    actionBarRegistry.reset();
    setActiveActorProviderCheck(() => false);

    expect(bar()).not.toContain("abar");
  });
});

// ---------------------------------------------------------------------------
// The status strip
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The favourites live in the ACTOR (BAR-F3-01, REQ-BAR-061..066)
// ---------------------------------------------------------------------------

describe("ActionBar — os favoritos gravados no ator (BAR-F3-01)", () => {
  /** The player's character with a bar already saved in it. */
  function saveBar(actionBar: Record<string, unknown>, version = 7): void {
    feed("doc:update", {
      documentType: "Actor",
      documents: [
        {
          ...actor(PC, "character", "Huo Jinwu", {
            default: OwnershipLevel.NONE,
            [PLAYER]: OwnershipLevel.OWNER,
          }),
          flags: { fusion: { actionBar } },
          _stats: { version },
        },
      ],
    });
  }

  const row = (...ids: Array<string | null>): Array<string | null> =>
    Array.from({ length: 12 }, (_, index) => ids[index] ?? null);

  beforeEach(() => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
  });

  it("as posições são as gravadas, com os buracos — a posição É a tecla", () => {
    saveBar({
      favorites: row("strike:stub-bow", null, "action:stub-seek"),
      seeded: true,
    });

    const html = bar();

    expect(slotIds(html)).toEqual(["strike:stub-bow", "action:stub-seek"]);
    expect(slotTag(html, "strike:stub-bow")).toContain('aria-keyshortcuts="1"');
    expect(slotTag(html, "action:stub-seek")).toContain('aria-keyshortcuts="3"');
    expect(html.match(/<div class="slot-empty /g)).toHaveLength(10);
  });

  it("D-BA08: depois da semente, o que o provedor tem de novo ou de outro tipo NÃO entra na linha — fica na aba", () => {
    saveBar({ favorites: row("strike:stub-bow"), seeded: true });

    const html = bar();

    // A espada, as magias e as ações existem no provedor, mas a linha é só o que o jogador fixou.
    expect(slotIds(html)).toEqual(["strike:stub-bow"]);
    expect(html).not.toContain("strike:stub-sword");
    expect(html).not.toContain("spell:stub-main:burst");
  });

  it("o jogador esvaziou a linha toda: ela fica vazia, a semente não volta (REQ-BAR-065)", () => {
    saveBar({ favorites: row(), seeded: true });

    const html = bar();

    expect(textOf(html)).toContain("Nenhum favorito fixado ainda.");
    expect(slotIds(html)).toEqual([]);
  });

  it("um favorito gravado cuja entrada não existe mais não aparece como órfão na primeira pintura: a carga do ator ainda não passou", () => {
    saveBar({ favorites: row("strike:stub-bow", "item:vendido"), seeded: true });

    const html = bar();

    expect(slotIds(html)).toEqual(["strike:stub-bow"]);
    expect(html).not.toContain("item:vendido");
  });

  it("o Mestre que seleciona o personagem vê a MESMA linha que o jogador (os favoritos estão no ator, REQ-BAR-061)", () => {
    saveBar({ favorites: row("action:stub-seek", "strike:stub-bow"), seeded: true });
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_PC] });

    const asGm = bar(GM_SEAT);
    setActiveActorViewer(PLAYER_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [] });
    const asPlayer = bar();

    expect(slotIds(asGm)).toEqual(["action:stub-seek", "strike:stub-bow"]);
    expect(slotIds(asPlayer)).toEqual(slotIds(asGm));
  });

  it("uma linha gravada com lixo (tamanho errado, id inválido) não derruba a barra: o que não é id é posição vazia", () => {
    saveBar({ favorites: ["strike:stub-bow", 7, "isto não é um id", null], seeded: true });

    const html = bar();

    expect(slotIds(html)).toEqual(["strike:stub-bow"]);
    expect(html.match(/<div class="slot-empty /g)).toHaveLength(11);
  });
});

describe("ActionBar — a faixa de estado (REQ-BAR-027, REQ-BAR-036..040)", () => {
  beforeEach(() => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
  });

  it("PV com o temporário, recursos, alvo e o MAP do próximo ataque", () => {
    const text = textOf(bar());

    expect(text).toContain("PV");
    expect(text).toMatch(/18\s*\/24/);
    expect(text).toContain("+3 temp");
    expect(text).toContain("Foco");
    expect(text).toContain("Herói");
    expect(text).toContain("Alvo: Alvo Stub");
    expect(text).toContain("Próximo ataque:");
    expect(text).toContain("MAP −5");
  });

  it("REQ-BAR-040: fora de combate, a faixa diz 'Fora de combate' e não há Encerrar turno", () => {
    const html = bar();

    expect(textOf(html)).toContain("Fora de combate");
    expect(html).not.toContain("Encerrar turno");
  });

  it("no turno do próprio usuário: 'Seu turno · Rodada 2' e Encerrar turno", () => {
    combatStore.combat = combatDoc({ activeCombatantId: "c-pc" });

    const html = bar();

    expect(textOf(html)).toContain("Seu turno · Rodada 2");
    expect(html).toContain('data-action="end-turn"');
    expect(textOf(html)).toContain("Encerrar turno");
  });

  it("na vez de outro participante: o nome dele, e o jogador NÃO tem Encerrar turno (REQ-BAR-035)", () => {
    combatStore.combat = combatDoc({ activeCombatantId: "c-npc" });

    const html = bar();

    expect(textOf(html)).toContain("Vez de: Capitão Bandido");
    expect(textOf(html)).not.toContain("Seu turno");
    expect(html).not.toContain("Encerrar turno");
  });

  it("REQ-CBA-082: o servidor mascarou a vez de um oculto (activeCombatantId nulo): 'Em combate · Rodada 2', sem nome", () => {
    combatStore.combat = combatDoc({
      activeCombatantId: null,
      combatants: [{ _id: "c-pc", actorId: PC, name: "Huo Jinwu", hidden: false }],
    });

    const text = textOf(bar());

    expect(text).toContain("Em combate · Rodada 2");
    expect(text).not.toContain("Vez de:");
    expect(text).not.toContain("Seu turno");
  });

  it("REQ-CBA-082, na barra montada: um oculto que vazou até a tela do jogador na vez dele não é nomeado — e o Mestre o vê", () => {
    // Defesa em profundidade: o servidor já não manda o oculto ao jogador (`redaction.ts`); se um
    // dia mandar, a barra do jogador continua sem o nome. O papel do assento chega ao turno pela casca.
    combatStore.combat = combatDoc({
      activeCombatantId: "c-ghost",
      combatants: [
        { _id: "c-pc", actorId: PC, name: "Huo Jinwu", hidden: false },
        { _id: "c-ghost", actorId: NPC, name: "Assassino Oculto", hidden: true },
      ],
    });

    const player = textOf(bar(PLAYER_SEAT));

    expect(player).toContain("Em combate · Rodada 2");
    expect(player).not.toContain("Assassino Oculto");
    expect(player).not.toContain("Vez de:");

    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_PC] });

    expect(textOf(bar(GM_SEAT))).toContain("Vez de: Assassino Oculto");
  });

  it("T6, na barra montada: a CA do Mestre só sai para o Mestre, mesmo que o provedor a entregue ao jogador", () => {
    actionBarRegistry.register(
      "Actor",
      "character",
      createStubProvider({ status: makeStubStatus({ gmOnly: { ac: 37 } }) }).provider,
    );

    const player = textOf(bar(PLAYER_SEAT));

    expect(player).not.toContain("CA 37");
    expect(player).not.toContain("37");
    expect(player).not.toContain("Mestre");

    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_PC] });
    const gm = textOf(bar(GM_SEAT));

    expect(gm).toContain("CA 37");
    expect(gm).toContain("Mestre");
  });

  it("encontro em montagem (ainda não começou) não é 'em combate'", () => {
    combatStore.combat = combatDoc({ started: false });

    const html = bar();

    expect(textOf(html)).toContain("Fora de combate");
    expect(html).not.toContain("Encerrar turno");
  });

  it("Q-BAR-08: o Mestre vê Encerrar turno em qualquer turno de um encontro em andamento", () => {
    actionBarRegistry.register("Actor", "npc", createStubProvider().provider);
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_NPC] });
    combatStore.combat = combatDoc({ activeCombatantId: "c-pc" });

    const html = bar(GM_SEAT);

    expect(textOf(html)).toContain("Vez de: Huo Jinwu");
    expect(textOf(html)).toContain("Encerrar turno");
  });

  it("e o turno do NPC selecionado é dito como o turno dele (T6)", () => {
    actionBarRegistry.register("Actor", "npc", createStubProvider().provider);
    setActiveActorViewer(GM_SEAT);
    publishTokenSelection({ sceneId: SCENE, tokenIds: [TOK_NPC] });
    combatStore.combat = combatDoc({ activeCombatantId: "c-npc" });

    expect(textOf(bar(GM_SEAT))).toContain("Turno de Capitão Bandido · Rodada 2");
  });
});

// ---------------------------------------------------------------------------
// Faded is a signal, not a lock (REQ-BAR-031, REQ-BAR-104)
// ---------------------------------------------------------------------------

describe("ActionBar — esmaecer é sinal, não trava", () => {
  beforeEach(() => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
  });

  it("a entrada esmaecida diz POR QUÊ e continua um botão que recebe o clique", () => {
    const tag = slotTag(bar(), "action:stub-command");

    expect(tag).toContain('data-state="unavailable"');
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain("Indisponível: Já usado neste turno");
    // `aria-disabled` é um sinal; o atributo `disabled` engoliria o clique (REQ-BAR-104).
    expect(tag).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("o CSS do slot não promete bloqueio: o cursor do esmaecido não é 'not-allowed'", () => {
    const source = readFileSync(fileURLToPath(new URL("../Slot.svelte", import.meta.url)), "utf8");

    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

    expect(code).not.toMatch(/not-allowed/);
    expect(code).not.toMatch(/pointer-events:\s*none/);
  });
});

// ---------------------------------------------------------------------------
// Conditions, the strip's content, GM-only (D-B23, T6)
// ---------------------------------------------------------------------------

describe("StatusStrip — condições, alvo, e o que é só do Mestre", () => {
  function strip(
    status: ActionBarStatus,
    overrides: {
      viewerIsGm?: boolean;
      openCondition?: string | null;
      turn?: TurnView;
      preview?: string | null;
      collapsed?: boolean;
      actorType?: string;
      actorId?: string;
    } = {},
  ): string {
    return render(StatusStrip, {
      props: {
        status,
        actorId: overrides.actorId ?? PC,
        viewerIsGm: overrides.viewerIsGm ?? false,
        actorType: overrides.actorType ?? "character",
        turn: overrides.turn ?? { kind: "out" },
        preview: overrides.preview ?? null,
        openCondition: overrides.openCondition ?? null,
        ontogglecondition: () => undefined,
        onclosecondition: () => undefined,
        collapsed: overrides.collapsed ?? false,
        onexpand: () => undefined,
      },
    }).body;
  }

  const frightened = {
    id: "frightened",
    name: "Assustado",
    value: 1,
    effect: "Penalidade de status nos testes.",
  };

  it("D-B23: o chip mostra SÓ O NOME; o efeito não está na tela até o clique", () => {
    const html = strip(makeStubStatus({ conditions: [frightened] }));

    expect(html).toMatch(/<button[^>]*data-condition="frightened"[^>]*>Assustado 1<\/button>/);
    expect(html).not.toContain("Penalidade de status nos testes.");
    expect(html).toContain('aria-expanded="false"');
  });

  it("depois do clique (efeito aberto) o efeito aparece, ligado ao chip por aria-controls", () => {
    const html = strip(makeStubStatus({ conditions: [frightened] }), {
      openCondition: "frightened",
    });

    expect(html).toContain("Penalidade de status nos testes.");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="ab-condition-frightened"');
    expect(html).toContain('id="ab-condition-frightened"');
  });

  it("condição sem efeito declarado é um chip simples, sem botão", () => {
    const html = strip(makeStubStatus({ conditions: [{ id: "hidden", name: "Escondido" }] }));

    expect(html).toMatch(
      /<span class="chip chip--special chip--static[^"]*"[^>]*>Escondido<\/span>/,
    );
    expect(html).not.toMatch(/<button[^>]*data-condition="hidden"/);
  });

  it("sem condições: 'Sem condições'", () => {
    expect(textOf(strip(makeStubStatus({ conditions: [] })))).toContain("Sem condições");
  });

  it("sem alvo marcado, ou com alvo sem nome resolvido", () => {
    expect(textOf(strip(makeStubStatus({ target: null })))).toContain("Sem alvo marcado");
    expect(textOf(strip(makeStubStatus({ target: { tokenId: "t", name: "" } })))).toContain(
      "Alvo marcado",
    );
  });

  it("T6: a CA e o selo 'Mestre · NPC' só aparecem para o Mestre", () => {
    const status = makeStubStatus({ gmOnly: { ac: 31 } });

    const gm = textOf(strip(status, { viewerIsGm: true, actorType: "npc" }));
    expect(gm).toContain("CA 31");
    expect(gm).toContain("Mestre · NPC");

    // O provedor deixa o campo vazio para o jogador; a faixa o ignora MESMO que ele venha preenchido.
    const player = textOf(strip(status, { viewerIsGm: false, actorType: "npc" }));
    expect(player).not.toContain("CA");
    expect(player).not.toContain("31");
    expect(player).not.toContain("Mestre");
  });

  it("o Mestre olhando um personagem vê 'Mestre' (sem o 'NPC')", () => {
    const text = textOf(
      strip(makeStubStatus({ gmOnly: { ac: 24 } }), { viewerIsGm: true, actorType: "character" }),
    );

    expect(text).toContain("CA 24");
    expect(text).toContain("Mestre");
    expect(text).not.toContain("Mestre · NPC");
  });

  it("REQ-BAR-039: com o mouse num golpe, a faixa mostra o que muda no ataque seguinte", () => {
    const html = strip(makeStubStatus(), { preview: "depois deste: MAP −10" });

    expect(html).toContain("depois deste: MAP −10");
    expect(html).toContain("is-preview");
    expect(textOf(html)).not.toContain("Próximo ataque:");
  });

  it("recolhida, a faixa traz o botão de expandir", () => {
    const html = strip(makeStubStatus(), { collapsed: true });

    expect(html).toContain('data-action="expand"');
    expect(html).toContain("ab-state--collapsed");
  });

  it("o retrato é o ActorPortrait do app: sem imagem, as iniciais do nome", () => {
    expect(strip(makeStubStatus({ name: "Huo Jinwu" }))).toMatch(
      /class="actor-portrait actor-portrait--fallback[^"]*"[^>]*>HJ<\/span>/,
    );
  });

  it("um retrato guardado (/assets/...) NUNCA vira src cru: a rota exige o grant curto que o <img> não manda, e o ActorPortrait o resolve no navegador", () => {
    const html = strip(makeStubStatus({ name: "Huo Jinwu", portrait: "/assets/huo.png" }));

    // No servidor (e enquanto o grant não chega) são as iniciais, nunca uma imagem quebrada com 401.
    expect(html).not.toContain("/assets/huo.png");
    expect(html).not.toMatch(/<img[^>]*\ssrc=/);
    expect(html).toMatch(/actor-portrait--fallback[^>]*>HJ<\/span>/);
  });

  it("um retrato que é um marcador do importador (arte própria cortada) também cai nas iniciais", () => {
    const html = strip(
      makeStubStatus({ name: "Huo Jinwu", portrait: "icons/placeholder/npc.svg" }),
    );

    expect(html).not.toContain("placeholder/npc.svg");
    expect(html).toMatch(/actor-portrait--fallback[^>]*>HJ<\/span>/);
  });

  it("recursos em pips e em contagem; os pips são de RECURSO, não de ação", () => {
    const html = strip(
      makeStubStatus({
        resources: [
          { id: "focus", label: "Foco", style: "pips", value: 1, max: 2 },
          { id: "class:rage", label: "Fúria", style: "count", value: 3, max: 5 },
        ],
      }),
    );

    expect(html).toContain('data-resource="focus"');
    expect(html.match(/class="pip[ "]/g)).toHaveLength(2);
    expect(html).toContain("pip--on");
    expect(textOf(html)).toContain("3/5");
  });
});

// ---------------------------------------------------------------------------
// SlotGrid: tabs, groups, empty state
// ---------------------------------------------------------------------------

describe("SlotGrid — abas, grupos e o estado vazio (REQ-BAR-026)", () => {
  function grid(
    tab: Parameters<typeof SlotGrid>[1] extends never ? never : "favorites" | ActionBarEntry["tab"],
    entries: ActionBarEntry[],
    extra: {
      favorites?: Array<string | null>;
      isBusy?: (id: string) => boolean;
      menuEntryId?: string | null;
      showOrphans?: boolean;
    } = {},
  ): string {
    return render(SlotGrid, {
      props: {
        tab,
        entries,
        favorites: extra.favorites ?? [],
        showOrphans: extra.showOrphans ?? true,
        isBusy: extra.isBusy ?? (() => false),
        altHeld: false,
        menuEntryId: extra.menuEntryId ?? null,
        onrun: () => undefined,
        onorphan: () => undefined,
        oncontext: () => undefined,
        onhover: () => undefined,
        onleave: () => undefined,
      },
    }).body;
  }

  it("aba sem entradas mostra o estado vazio e não quebra", () => {
    for (const tab of ["strikes", "spells", "actions", "items", "reactions", "checks"] as const) {
      const html = grid(tab, []);

      expect(textOf(html), tab).toBe("Nenhuma entrada nesta aba.");
    }
  });

  it("a aba mostra só as entradas dela, agrupadas, com o contador do cabeçalho", () => {
    const html = grid("spells", makeStubEntries());

    expect(slotIds(html)).toEqual(["spell:stub-main:burst", "spell:stub-main:heal"]);
    expect(html).toMatch(/<div class="grp__h[^"]*"[^>]*>[\s\S]*?Truques/);
    expect(html).toMatch(
      /<div class="grp__h[^"]*"[^>]*>[\s\S]*?1º patamar[\s\S]*?<em[^>]*>2\/3<\/em>/,
    );
  });

  it("o contador em pips (o Foco) desenha os pips e o x/y", () => {
    const html = grid("spells", [
      makeEntry("spell:focus:a", {
        tab: "spells",
        group: "Foco",
        groupUses: { value: 1, max: 2, style: "pips" },
      }),
    ]);

    expect(html).toContain('class="pips');
    expect(html.match(/class="pip[ "]/g)).toHaveLength(2);
    expect(html).toMatch(/<em[^>]*>1\/2<\/em>/);
  });

  it("muitos slots num grupo passam para a segunda linha", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      makeEntry(`action:n${String(i)}`, { tab: "actions", group: "Básicas" }),
    );

    expect(grid("actions", many)).toContain("--rows: 2");
    expect(grid("actions", many.slice(0, 7))).toContain("--rows: 1");
  });

  it("nada fixado: a linha some e dá lugar à mensagem", () => {
    expect(textOf(grid("favorites", makeStubEntries(), { favorites: [] }))).toBe(
      "Nenhum favorito fixado ainda.",
    );
    expect(
      textOf(grid("favorites", makeStubEntries(), { favorites: new Array(12).fill(null) })),
    ).toBe("Nenhum favorito fixado ainda.");
  });

  it("há favoritos fixados mas o provedor ainda não entregou nada: as 12 posições ficam, e a mensagem de vazio não mente", () => {
    const html = grid("favorites", [], { favorites: ["strike:ainda-nao-chegou", null] });

    expect(textOf(html)).not.toContain("Nenhum favorito fixado");
    expect(html.match(/<div class="slot-empty /g)).toHaveLength(12);
    expect(slotIds(html)).toEqual([]);
  });

  it("favoritos: o slot ocupa a posição da tecla, e o vazio entre dois fica visível", () => {
    const html = grid("favorites", makeStubEntries(), {
      favorites: ["strike:stub-sword", null, "action:stub-seek"],
    });

    expect(slotIds(html)).toEqual(["strike:stub-sword", "action:stub-seek"]);
    expect(html.match(/<div class="slot-empty /g)).toHaveLength(10);
    expect(slotTag(html, "action:stub-seek")).toContain('aria-keyshortcuts="3"');
  });

  describe("o favorito órfão — a entrada saiu da ficha (REQ-BAR-066, CA-BAR-06)", () => {
    const withOrphan = ["strike:stub-sword", "item:vendido", "action:stub-seek"];

    it("fica na posição da tecla dele, esmaecido, dizendo que não está mais na ficha", () => {
      const html = grid("favorites", makeStubEntries(), { favorites: withOrphan });

      expect(slotIds(html)).toEqual(["strike:stub-sword", "item:vendido", "action:stub-seek"]);
      const tag = slotTag(html, "item:vendido");
      expect(tag).toContain('data-state="unavailable"');
      expect(tag).toContain('aria-disabled="true"');
      expect(tag).toContain('aria-keyshortcuts="2"');
      expect(tag).toMatch(/aria-label="Não está mais na ficha\./);
      expect(tag).toContain("Desafixe");
      // As entradas que continuam na ficha seguem como eram.
      expect(slotTag(html, "strike:stub-sword")).not.toContain("aria-disabled");
      expect(slotTag(html, "action:stub-seek")).not.toContain("aria-disabled");
    });

    it("o nome embaixo do ícone é curto e legível, e o id cru não aparece em lugar nenhum", () => {
      const html = grid("favorites", makeStubEntries(), { favorites: ["item:a1b2c3d4e5"] });

      expect(html).toMatch(/<span class="slot__name[^"]*"[^>]*>Ausente<\/span>/);
      expect(textOf(html)).not.toContain("a1b2c3d4e5");
    });

    it("é um botão que recebe o clique (esmaecer é sinal, não trava) e usa o selo da tecla", () => {
      const html = grid("favorites", makeStubEntries(), { favorites: withOrphan });

      expect(slotTag(html, "item:vendido")).not.toMatch(/\sdisabled(\s|>|=)/);
      expect(html).toMatch(/<i class="slot__k[^"]*"[^>]*>2<\/i>/);
    });

    it("antes de a barra estar armada (a carga do ator) um favorito que falta é só uma caixa vazia", () => {
      const html = grid("favorites", makeStubEntries(), {
        favorites: withOrphan,
        showOrphans: false,
      });

      expect(slotIds(html)).toEqual(["strike:stub-sword", "action:stub-seek"]);
      expect(html.match(/<div class="slot-empty /g)).toHaveLength(10);
    });

    it("se o provedor não entregou nada, nenhum favorito vira órfão", () => {
      const html = grid("favorites", [], { favorites: withOrphan });

      expect(slotIds(html)).toEqual([]);
      expect(html.match(/<div class="slot-empty /g)).toHaveLength(12);
    });

    it("só pinos órfãos também desenham a linha (não é o 'nenhum favorito')", () => {
      const html = grid("favorites", makeStubEntries(), { favorites: ["item:vendido"] });

      expect(slotIds(html)).toEqual(["item:vendido"]);
      expect(textOf(html)).not.toContain("Nenhum favorito fixado");
    });

    it("o órfão com o menu aberto sai o mesmo slot (um só snippet atende a entrada e o órfão, e é ele que recebe o menuOpen)", () => {
      const closed = grid("favorites", makeStubEntries(), { favorites: withOrphan });
      const open = grid("favorites", makeStubEntries(), {
        favorites: withOrphan,
        menuEntryId: "item:vendido",
      });
      const source = readFileSync(
        fileURLToPath(new URL("../SlotGrid.svelte", import.meta.url)),
        "utf8",
      );

      // `menuOpen` only silences the tooltip, which the server render does not draw: the markup must not move.
      expect(slotTag(open, "item:vendido")).toBe(slotTag(closed, "item:vendido"));
      // …and the flag reaches the orphan because there is ONE place that hands it to a Slot.
      expect(source.match(/menuOpen=\{menuEntryId === entry\.id\}/g)).toHaveLength(1);
      expect(source).toMatch(/\{@render slotOf\(cell\.entry, index, cell\.kind === "orphan"/);
    });

    it("o órfão não tem arrastar nem nada que um clique rodasse: o slot é o de sempre e o clique vai para o aviso", () => {
      const source = readFileSync(
        fileURLToPath(new URL("../SlotGrid.svelte", import.meta.url)),
        "utf8",
      );

      expect(source).toMatch(
        /\{@render slotOf\(cell\.entry, index, cell\.kind === "orphan" \? onorphan : onrun\)\}/,
      );
      expect(source).not.toMatch(/draggable/);
    });
  });

  it("o slot ocupado diz que está ocupado (sem rolagem em dobro)", () => {
    const html = grid("strikes", makeStubEntries(), { isBusy: (id) => id === "strike:stub-sword" });

    expect(slotTag(html, "strike:stub-sword")).toContain('aria-busy="true"');
    expect(slotTag(html, "strike:stub-bow")).not.toContain("aria-busy");
  });

  it("alvo mínimo de toque: o slot tem pelo menos 44 px nos dois lados (spec 23 REQ-A11-044)", () => {
    const css = readFileSync(fileURLToPath(new URL("../Slot.svelte", import.meta.url)), "utf8");
    const rule = /\.slot\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(Number(/min-width:\s*(\d+)px/.exec(rule)?.[1])).toBeGreaterThanOrEqual(44);
    expect(Number(/(?:^|\s)height:\s*(\d+)px/.exec(rule)?.[1])).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// D-15
// ---------------------------------------------------------------------------

describe("D-15 — nada conta, soma ou mostra 'ações restantes' (REQ-BAR-036)", () => {
  it("o markup completo da barra, com golpes e magias na tela, não fala em ações restantes nem tem contador", () => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
    combatStore.combat = combatDoc();

    const html = bar();
    const text = textOf(html);

    expect(text).not.toMatch(/restante|remaining|ações? (que )?(sobra|resta)/i);
    expect(html).not.toMatch(/actions?-(left|remaining|counter|pips)/i);
    // Os únicos pips são os dos recursos que o provedor declara (Foco, Herói).
    expect(html.match(/class="pip[ "]/g)).toHaveLength(2 + 3);
    expect(html.match(/data-resource="/g)).toHaveLength(2);
  });

  it("nenhuma linha de código da casca lê custo como regra: sem contagem de ações no controlador, no modelo e nos componentes", () => {
    const files = [
      "../../../lib/actionbar/actionBarController.svelte.ts",
      "../../../lib/actionbar/slotModel.ts",
      "../../../lib/actionbar/statusModel.ts",
      "../../../lib/actionbar/turn.ts",
      "../ActionBar.svelte",
      "../Slot.svelte",
      "../SlotGrid.svelte",
      "../StatusStrip.svelte",
      "../TabBar.svelte",
    ].map((file) =>
      readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    );

    for (const code of files) {
      expect(code).not.toMatch(
        /actionsLeft|actionsRemaining|remainingActions|actionBudget|actionCount|spentActions/i,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Where it sits, and what it sits under (REQ-BAR-022)
// ---------------------------------------------------------------------------

describe("ActionBar — o lugar e a escala de z (REQ-BAR-022, REQ-UIF-008)", () => {
  beforeEach(() => {
    actionBarRegistry.register("Actor", "character", createStubProvider().provider);
    setActiveActorViewer(PLAYER_SEAT);
  });

  it("centralizada na área livre: com a gaveta fechada, no meio de (tela − 44 px)", () => {
    const html = bar();

    // Tela padrão de 1280 px no servidor: (1280 − 44) / 2 = 618; 780 px de largura.
    expect(html).toMatch(/style="[^"]*left:\s*618px/);
    expect(html).toMatch(/style="[^"]*width:\s*780px/);
  });

  it("com a gaveta aberta, o centro anda para a esquerda: (1280 − 344) / 2 = 468", () => {
    publishDrawerOpen(true);

    expect(bar()).toMatch(/style="[^"]*left:\s*468px/);
  });

  it("a barra está acima do canvas e do aviso de cena, e abaixo da gaveta, do cabeçalho, das janelas e dos tooltips", () => {
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const zOf = (css: string, name: string): number => {
      const match = new RegExp(`${name}:\\s*(\\d+)\\s*;`).exec(css);
      if (!match?.[1]) throw new Error(`${name} is not declared`);
      return Number(match[1]);
    };
    const literalZ = (source: string): number => {
      const match = /z-index:\s*(\d+)\s*;/.exec(source);
      if (!match?.[1]) throw new Error("no literal z-index");
      return Number(match[1]);
    };

    const tokens = baseCss();
    const actionbar = zOf(tokens, "--fusion-z-actionbar");
    const windows = zOf(tokens, "--fusion-z-windows");
    const tooltip = zOf(tokens, "--fusion-z-tooltip");
    const menu = zOf(tokens, "--fusion-z-menu");
    const notice = literalZ(read("../../scenes/ScenePrepareNotice.svelte"));
    const drawer = literalZ(read("../../sidebar/Sidebar.svelte"));
    const header = Number(
      /\.table-header\s*\{[^}]*z-index:\s*(\d+)/.exec(read("../../TableScreen.svelte"))?.[1],
    );

    expect(notice).toBe(60);
    expect(drawer).toBe(90);
    expect(header).toBe(100);
    expect(actionbar).toBe(70);
    // canvas < aviso (60) < barra (70) < gaveta (90) < cabeçalho (100) < janelas (101+, no host de 200) < tooltip < menu
    expect(notice).toBeLessThan(actionbar);
    expect(actionbar).toBeLessThan(drawer);
    expect(drawer).toBeLessThan(header);
    expect(header).toBeLessThan(windows);
    expect(windows).toBeLessThan(tooltip);
    expect(tooltip).toBeLessThan(menu);
  });

  it("a folha da barra usa o token, não um número avulso (REQ-BAR-022: 'sem z-index avulso')", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../ActionBar.svelte", import.meta.url)),
      "utf8",
    );
    const rule = /\.abar\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(rule).toContain("z-index: var(--fusion-z-actionbar)");
    expect(css.match(/z-index:\s*\d/g)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The Escape of a slot's tooltip does not reach the token (the finding of BAR-F1-03)
// ---------------------------------------------------------------------------

describe("tooltip e menu acima da barra, e o foco do menu (protótipo T1, Q-BAR-07)", () => {
  const read = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("a barra se declara (data-action-bar) e o slot passa ao Tooltip a distância medida até a borda dela", () => {
    const slot = read("../Slot.svelte");

    expect(read("../ActionBar.svelte")).toContain("data-action-bar");
    expect(slot).toContain('closest("[data-action-bar]")');
    expect(slot).toContain("tooltipOffsetAboveBar(");
    expect(slot).toMatch(/<Tooltip[\s\S]*?offset=\{tipOffset\}/);
  });

  it("o menu abre para cima de um ponto acima da barra, e só devolve o foco ao slot se foi aberto pelo teclado", () => {
    const source = read("../ActionBar.svelte");

    expect(source).toContain("menuOriginAboveBar(barTop)");
    expect(source).toContain('placement="top-start"');
    // Aberto com o mouse, o foco NÃO volta ao botão: um botão focado cala as teclas (Q-BAR-07).
    expect(source).toContain('restoreFocus={menu.open.via === "keyboard"}');
  });
});

describe("Slot — o Esc do tooltip não desmarca o token", () => {
  const slotSource = (): string =>
    readFileSync(fileURLToPath(new URL("../Slot.svelte", import.meta.url)), "utf8");

  it("o tooltip de cada slot toma o Esc (consumeEscape), e só deixa passar o que é de outro: campo de texto, diálogo, tratador que já consumiu", () => {
    const source = slotSource();

    // O componente genérico recebe a regra…
    expect(source).toMatch(/<Tooltip[\s\S]*?consumeEscape=\{takesEscape\}/);
    // …e a regra é "tomar, a menos que o Esc seja de outra coisa" — a mesma pergunta que o
    // TokenInteractionManager faz antes de desmarcar (`isEscapeForSomethingElse`, I6).
    expect(source).toMatch(
      /function takesEscape\(event: KeyboardEvent\): boolean \{\s*return !isEscapeForSomethingElse\(event, document\);/,
    );
    expect(source).toContain("lib/canvas/tokens/token-interaction.js");
  });

  it("a pergunta é a do canvas: um Esc para campo de texto, diálogo ou já consumido NÃO é tomado; um Esc solto, sim", async () => {
    const { isEscapeForSomethingElse } =
      await import("../../../lib/canvas/tokens/token-interaction.js");
    const doc = (activeElement: unknown = null, dialog = false) => ({
      activeElement,
      querySelector: () => (dialog ? {} : null),
    });

    // Solto (foco no corpo da página, nada aberto): é do canvas, e o tooltip o toma.
    expect(isEscapeForSomethingElse({ target: { tagName: "BODY" } }, doc())).toBe(false);
    // Campo de texto, diálogo aberto e Esc já consumido: é de outro, o tooltip só fecha.
    expect(isEscapeForSomethingElse({ target: { tagName: "TEXTAREA" } }, doc())).toBe(true);
    expect(isEscapeForSomethingElse({ target: { tagName: "BODY" } }, doc(null, true))).toBe(true);
    expect(isEscapeForSomethingElse({ target: null, defaultPrevented: true }, doc())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Where the shell mounts it
// ---------------------------------------------------------------------------

describe("TableScreen — monta a barra (REQ-BAR-010)", () => {
  const tableScreen = (): string =>
    readFileSync(fileURLToPath(new URL("../../TableScreen.svelte", import.meta.url)), "utf8");

  it("monta a barra do assento, com o papel PRIVILEGIADO (role ≥ ASSISTANT), o mesmo limiar do gate", () => {
    const source = tableScreen();

    expect(source).toContain("<ActionBar");
    expect(source).toContain("isGm={session.user.role >= ROLE_ASSISTANT}");
    // O mesmo `isGm` que alimenta o store de ator ativo.
    expect(source).toContain("isGm: user.role >= ROLE_ASSISTANT");
  });

  it("o aviso de cena sobe acima da barra, por quanto ela mede", () => {
    const source = tableScreen();

    expect(source).toContain("bottomOffset={clearanceAboveBar(actionBarHeight())}");
  });
});

// ---------------------------------------------------------------------------
// A provider that throws must not take the table down
// ---------------------------------------------------------------------------

describe("ActionBar — um provedor que quebra não derruba a mesa", () => {
  it("entries() que lança vira log e barra vazia, não uma tela quebrada", () => {
    const spy = createStubProvider();
    actionBarRegistry.register("Actor", "character", {
      ...spy.provider,
      entries: () => {
        throw new Error("provedor quebrado");
      },
    });
    setActiveActorViewer(PLAYER_SEAT);
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      expect(() => bar()).not.toThrow();
    } finally {
      console.error = original;
    }

    expect(logged.flat().some((item) => String(item).includes("provider.entries failed"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// The actor changes while the bar is open
// ---------------------------------------------------------------------------

describe("ActionBar — acompanha a ficha", () => {
  it("quando o documento do ator muda no espelho, a próxima leitura traz a versão nova", () => {
    const status = makeStubStatus({ name: "Antes" });
    actionBarRegistry.register("Actor", "character", createStubProvider({ status }).provider);
    setActiveActorViewer(PLAYER_SEAT);
    expect(textOf(bar())).toContain("Antes");

    // Uma atualização do servidor substitui o documento do ator: ctx.actor é o novo.
    const seen: unknown[] = [];
    const spy = createStubProvider();
    actionBarRegistry.register("Actor", "character", {
      ...spy.provider,
      status: (ctx) => {
        seen.push(ctx.actor["name"]);
        return spy.provider.status(ctx);
      },
    });
    feed("doc:update", {
      documentType: "Actor",
      documents: [
        {
          ...actor(PC, "character", "Huo Jinwu, ferido", {
            default: 0,
            [PLAYER]: OwnershipLevel.OWNER,
          }),
        },
      ],
    });
    bar();

    expect(seen).toContain("Huo Jinwu, ferido");
  });
});

// ---------------------------------------------------------------------------
// The wiring the server render cannot run: `$effect`, and the focus given back after a click
// ---------------------------------------------------------------------------

describe("ActionBar — a fiação que o SSR não roda (lida do fonte)", () => {
  const read = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  /** The source with its comments out (block, HTML and line), so a word in a comment is not a call. */
  const code = (path: string): string =>
    read(path)
      .replace(/<!--[\s\S]*?-->/g, "") // first: an HTML comment may carry a "/*" of its own ("/assets/*")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");

  it("as teclas da barra são registradas num $effect, e o desregistrar é o que o efeito devolve", () => {
    expect(code("../ActionBar.svelte")).toMatch(
      /\$effect\(\(\) => registerActionBarShortcuts\(controller\)\);/,
    );
  });

  it("trocar de ator fecha o que era do outro; o que saiu da barra fecha de vez (reconcile)", () => {
    const source = code("../ActionBar.svelte");

    expect(source).toMatch(
      /\$effect\(\(\) => \{\s*void actorId;\s*untrack\(\(\) => \{\s*controller\.resetForActor\(\);/,
    );
    expect(source).toMatch(
      /\$effect\(\(\) => \{\s*void resolved;\s*untrack\(\(\) => \{\s*controller\.reconcile\(\);/,
    );
  });

  it("BAR-F3-01: os favoritos são o store persistido no ator — lê o ator por readActorDoc e escreve por services.request, que devolve o ack", () => {
    const source = code("../ActionBar.svelte");

    expect(source).toContain("createFavoritesStore({");
    // `readActorDoc` goes in as it is and the store passes its own id: a closure over `actorId` would
    // follow the actor ON SCREEN, and a store that outlives a change of actor would read (and write
    // back) another character's row.
    expect(source).toContain("readActor: readActorDoc,");
    expect(source).not.toMatch(/readActor:\s*\(\)/);
    expect(source).toContain("seedIds: seedIdsFor,");
    expect(source).toContain('write: (payload) => services.request("doc:update", payload)');
    // A fonte em memória da primeira entrega saiu.
    expect(source).not.toContain("createFavoritesSource");
    // E o store NÃO escreve pelo `makeSendOpFn`: ele reenviaria o array velho depois de um STALE_WRITE
    // e levaria o fixar de outro aparelho junto (REQ-BAR-063).
    expect(code("../../../lib/actionbar/favoritesStore.svelte.ts")).not.toContain("makeSendOpFn");
  });

  it("BAR-F3-01: a semente é gravada por um $effect que só pergunta, e só depois de a ficha assentar; a da casca só vale quando o provedor não declara a dele", () => {
    const source = code("../ActionBar.svelte");

    expect(source).toMatch(
      /\$effect\(\(\) => \{\s*const store = favorites;\s*if \(store === null \|\| resolved === null \|\| !sheetSettled\) return;\s*void entries;\s*untrack\(\(\) => \{\s*store\.ensureSeeded\(\);/,
    );
    // What the seed IS (the provider's, else the shell's; `[]` stays `[]`) is `resolveSeedIds`, tested as
    // behaviour in favoritesSource.test.ts. Here only: the bar asks it once per change of the bar, and a store
    // gets the seed of its own actor only.
    expect(source).toContain("resolveSeedIds(bar.provider, bar.ctx, entries,");
    expect(source).toMatch(
      /function seedIdsFor\(forActorId: string\): readonly string\[\] \{\s*return bar !== null && bar\.ctx\.actorId === forActorId \? seedOfBar : \[\];/,
    );
  });

  it("BAR-F3-01: a ficha só assenta depois da janela de carga do ator — um efeito arma, a grade recebe (órfãos), e o clique vira aviso", () => {
    const source = code("../ActionBar.svelte");

    expect(source).toMatch(
      /\$effect\(\(\) => \{\s*void actorId;\s*sheetSettled = false;\s*const timer = setTimeout\(\(\) => \{\s*sheetSettled = true;\s*\}, SHEET_SETTLE_MS\);\s*return \(\) => \{\s*clearTimeout\(timer\);/,
    );
    expect(source).toContain("showOrphans={sheetSettled}");
    expect(source).toContain('controller.notify(t("FUSION.ActionBar.Favorites.Orphan.Click"))');
  });

  it("BAR-F3-01: o menu do slot conhece os favoritos — o órfão tem menu, e escolher um item age sobre a entrada do menu", () => {
    const source = code("../ActionBar.svelte");

    expect(source).toContain("orphanEntry(open.entryId)");
    // Another task's field (the icon) sits beside `favorites` in both calls, in no fixed order.
    expect(source).toMatch(
      /items=\{slotMenuItems\(menu\.entry, \{[^}]*favorites: favorites \?\? undefined[^}]*\}\)\}/,
    );
    expect(source).toMatch(
      /runSlotMenuItem\(itemId, \{[^}]*entry: menu\.entry,[^}]*favorites: favorites \?\? undefined,?[^}]*\}\)/,
    );
  });

  it("a área livre estreita recolhe a barra (syncNarrow); a altura dela é publicada e zerada ao sair", () => {
    const source = code("../ActionBar.svelte");

    expect(source).toMatch(
      /\$effect\(\(\) => \{\s*controller\.syncNarrow\(layout\.narrow\);\s*\}\);/,
    );
    expect(source).toContain("publishBarHeight(resolved === null ? 0 : barHeight)");
    expect(source).toMatch(/\$effect\(\(\) => \(\) => \{\s*publishBarHeight\(0\);\s*\}\);/);
  });

  it("Q-BAR-07: todo botão de clique da barra devolve o foco ao canvas depois de um clique de mouse", () => {
    // Um botão que não chame `releaseFocusAfterPointer` deixa o foco nele, e o guard das teclas
    // (REQ-BAR-049) as cala. Todo `.svelte` da pasta entra na conta: um botão novo, em qualquer
    // componente, é acusado se não devolver o foco.
    const calls = (path: string): number =>
      (code(path).match(/releaseFocusAfterPointer\(event, document\)/g) ?? []).length;
    const clicks = (path: string): number => (code(path).match(/\sonclick=/g) ?? []).length;

    const files = readdirSync(fileURLToPath(new URL("../", import.meta.url))).filter((name) =>
      name.endsWith(".svelte"),
    );
    const expected: Record<string, number> = {
      "ActionBar.svelte": 1, // Encerrar turno
      "Slot.svelte": 1,
      "StatusStrip.svelte": 2, // o chip da condição e o expandir
      "TabBar.svelte": 2, // a aba e o recolher
    };
    // A varredura enxerga os componentes que esperava (não é uma pasta vazia por engano).
    expect(files).toEqual(
      expect.arrayContaining([
        "ActionBar.svelte",
        "Slot.svelte",
        "SlotGrid.svelte",
        "StatusStrip.svelte",
        "TabBar.svelte",
        "ConditionEffect.svelte",
      ]),
    );
    for (const file of files) {
      const count = expected[file] ?? 0;
      expect(clicks(`../${file}`), `${file}: botões de clique`).toBe(count);
      expect(calls(`../${file}`), `${file}: devolvem o foco`).toBe(count);
    }
  });

  it("a casca liga o que o SSR não mostra: a altura e a largura medidas, o hover e a prévia do MAP, as condições que estão na faixa", () => {
    const source = code("../ActionBar.svelte");

    // O aviso de cena sobe pela altura medida; a barra acompanha a largura da tela.
    expect(source).toContain("bind:clientHeight={barHeight}");
    expect(source).toContain("bind:innerWidth={viewportWidth}");
    // A prévia do MAP na faixa vem da entrada sob o mouse, e o slot avisa quando o mouse entra e sai.
    expect(source).toContain("mapHint(controller.hovered)");
    expect(source).toMatch(/onhover=\{\(entry\) => \{\s*controller\.setHovered\(entry\);/);
    expect(source).toMatch(/onleave=\{\(entry\) => \{\s*controller\.clearHovered\(entry\);/);
    // O `reconcile` sabe quais condições estão na faixa.
    expect(source).toContain("conditionIds: conditionIdsOf(status)");
  });

  it("o tooltip: a linha de efeito que já diz o bônus ocupa o lugar da linha de números, com o número em negrito", () => {
    const source = code("../Slot.svelte");

    expect(source).toMatch(
      /\{#if tip\.numbers !== null\}[\s\S]*?\{:else if tip\.effect !== null && tip\.effectFigure !== null\}\s*<div class="tip__nm">/,
    );
    expect(source).toContain(
      "<b>{tip.effect.slice(tip.effectFigure.start, tip.effectFigure.end)}</b>",
    );
    // E o parágrafo de efeito só aparece quando a linha de números não o absorveu.
    expect(source).toMatch(
      /\{#if tip\.effect !== null && tip\.effectFigure === null\}\s*<p class="tip__fx">/,
    );
  });

  it("o retrato: o ActorPortrait recebe o documento do ator da barra, para o grant; nunca um src cru do retrato", () => {
    const strip = code("../StatusStrip.svelte");

    expect(strip).toContain(
      'import ActorPortrait from "$lib/components/common/ActorPortrait.svelte"',
    );
    expect(strip).toMatch(
      /<ActorPortrait\s+img=\{status\.portrait\}\s+docRef=\{\{ table: "actors", id: actorId \}\}/,
    );
    expect(strip).not.toMatch(/<img/);
    expect(strip).not.toContain("src={status.portrait}");
    // E quem o chama passa o ator ativo.
    expect(code("../ActionBar.svelte")).toContain("actorId={resolved.ctx.actorId}");
  });

  it("REQ-A11-044: o chip que abre o efeito tem pelo menos 24 px de alvo", () => {
    expect(read("../StatusStrip.svelte")).toMatch(/\.chip \{[^}]*min-height: 24px/);
  });
});

// ---------------------------------------------------------------------------
// Every string the shell shows is in both bundles
// ---------------------------------------------------------------------------

describe("os textos da barra estão nos dois idiomas", () => {
  const read = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("toda chave FUSION.ActionBar.* que o código usa existe em pt-BR e em en (sem erro de digitação)", () => {
    const sources = [
      "../ActionBar.svelte",
      "../Slot.svelte",
      "../SlotGrid.svelte",
      "../StatusStrip.svelte",
      "../TabBar.svelte",
      "../../../lib/actionbar/slotModel.ts",
      "../../../lib/actionbar/slotMenu.ts",
      "../../../lib/actionbar/favoritesStore.svelte.ts",
      "../../../lib/actionbar/orphan.ts",
      "../../../lib/actionbar/actionBarController.svelte.ts",
      "../../../lib/actionbar/actionBarServices.ts",
    ].map(read);
    const used = new Set(
      sources.flatMap((source) =>
        [...source.matchAll(/"(FUSION\.ActionBar\.[A-Za-z.]+)"/g)].map((m) => m[1] ?? ""),
      ),
    );
    const ptBR = JSON.parse(read("../../../lib/i18n/pt-BR.json")) as Record<string, string>;
    const en = JSON.parse(read("../../../lib/i18n/en.json")) as Record<string, string>;

    expect(used.size).toBeGreaterThan(30);
    for (const key of used) {
      expect(ptBR[key], `${key} falta em pt-BR`).toBeTypeOf("string");
      expect(en[key], `${key} falta em en`).toBeTypeOf("string");
    }
  });

  it("e nenhuma chave da barra fica sobrando nos arquivos de idioma sem uso", () => {
    const files = [
      "../ActionBar.svelte",
      "../Slot.svelte",
      "../SlotGrid.svelte",
      "../StatusStrip.svelte",
      "../TabBar.svelte",
      "../../../lib/actionbar/slotModel.ts",
      "../../../lib/actionbar/slotMenu.ts",
      "../../../lib/actionbar/favoritesStore.svelte.ts",
      "../../../lib/actionbar/orphan.ts",
      "../../../lib/actionbar/actionBarController.svelte.ts",
      "../../../lib/actionbar/actionBarServices.ts",
    ]
      .map(read)
      .join("\n");
    const ptBR = JSON.parse(read("../../../lib/i18n/pt-BR.json")) as Record<string, string>;

    for (const key of Object.keys(ptBR).filter((k) => k.startsWith("FUSION.ActionBar."))) {
      expect(files, `${key} não é usada`).toContain(`"${key}"`);
    }
  });
});
