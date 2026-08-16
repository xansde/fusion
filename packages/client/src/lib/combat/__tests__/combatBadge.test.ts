/**
 * combatBadge.test.ts — the badge the Combate tab hands the rail (G055).
 *
 * Spec 40 (`specs/40-aba-combate.md`) §5.1 / DEC-CBA-07: one state dot, lit while
 * there is a live encounter on the active scene — montagem included — amber when the
 * participant of the turn is this user's, unmoved by opening or collapsing the drawer,
 * and with nothing behind it that blinks or makes a sound.
 *
 * Covers REQ-CBA-002, REQ-CBA-003, REQ-CBA-004 and REQ-CBA-005.
 *
 * The rail is rendered for real (`svelte/server`) rather than asserted through the
 * store alone, because "âmbar" is a claim about what is drawn: a tone that the store
 * reports and the rail forgets to paint would pass a store-only test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";

import type { CombatantDocument, CombatDocument } from "@fusion/shared";
import { OwnershipLevel } from "@fusion/shared";

import {
  activeCombatantIsOwnedBy,
  combatBadgeLit,
  combatBadgeTone,
  combatBadgeToneFor,
  encounterDotIsLit,
  ownedActorIdsOf,
  setCombatBadgeViewer,
} from "../combatBadge.svelte.js";
import { combatStore } from "../combatStore.svelte.js";
import { worldMirror } from "../../docs/worldSync.js";
import { combatActiveBadge, registerCoreSidebarTabs } from "../../sidebar/registerCoreTabs.js";
import { clearSidebarTabs, getSidebarTab } from "../../sidebar/registry.js";
import { formatSidebarBadge, readSidebarBadgeTone } from "../../sidebar/badges.svelte.js";
import SidebarRail from "../../../components/sidebar/SidebarRail.svelte";
import "../../i18n/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ME = "user-mine-0001";
const SOMEONE_ELSE = "user-other-002";

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "cb1",
    tokenId: "tk1",
    actorId: "actor-mine",
    name: "Fofurinha",
    img: null,
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: true,
    flags: {},
    ...overrides,
  };
}

function makeCombat(overrides: Partial<CombatDocument> = {}): CombatDocument {
  return {
    _id: "combat-1",
    sceneId: "scene-1",
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

/** Actor documents as the mirror holds them, with the ownership map the server sends. */
function mirrorActors(): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: "scene-1",
    documents: {
      Actor: [
        { _id: "actor-mine", name: "Fofurinha", ownership: { [ME]: OwnershipLevel.OWNER } },
        {
          _id: "actor-theirs",
          name: "Alheio",
          ownership: { [SOMEONE_ELSE]: OwnershipLevel.OWNER },
        },
        { _id: "actor-creature", name: "Criatura", ownership: { default: OwnershipLevel.NONE } },
      ],
    },
  });
}

/** The assembled encounter: created, nobody has rolled, nothing started yet. */
function assembling(): CombatDocument {
  return makeCombat({
    started: false,
    combatants: [
      makeCombatant({ _id: "cb-mine", actorId: "actor-mine" }),
      makeCombatant({ _id: "cb-theirs", actorId: "actor-theirs", name: "Alheio" }),
    ],
  });
}

/** The same encounter running, with `activeId` holding the turn. */
function running(activeId: string): CombatDocument {
  return makeCombat({
    started: true,
    round: 2,
    activeCombatantId: activeId,
    combatants: [
      makeCombatant({ _id: "cb-mine", actorId: "actor-mine", initiative: 18 }),
      makeCombatant({ _id: "cb-theirs", actorId: "actor-theirs", name: "Alheio", initiative: 12 }),
    ],
  });
}

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// Rail rendering helpers
// ---------------------------------------------------------------------------

function renderRail(open = false, activeTabId: string | null = null): string {
  return render(SidebarRail, {
    props: { isGm: false, open, activeTabId, onSelect: () => {} },
  }).body;
}

function combatButton(body: string): string | null {
  const match = /<button[^>]*data-tab-id="combat"[\s\S]*?<\/button>/.exec(body);
  return match ? match[0] : null;
}

/** `"amber"`, `"default"`, or `null` when no dot is drawn on the Combate button. */
function drawnDotTone(body: string): string | null {
  const button = combatButton(body);
  if (button === null) return null;
  const dot = /<span[^>]*data-badge-kind="dot"[^>]*>/.exec(button);
  if (dot === null) return null;
  const tone = /data-badge-tone="([^"]*)"/.exec(dot[0]);
  return tone ? tone[1]! : null;
}

/** Wording of the hidden textual equivalent on the Combate button, or null. */
function drawnDotDescription(body: string): string | null {
  const button = combatButton(body);
  if (button === null) return null;
  const description = /<span[^>]*data-badge-description[^>]*>([^<]*)<\/span>/.exec(button);
  return description ? description[1]! : null;
}

beforeEach(() => {
  clearSidebarTabs();
  registerCoreSidebarTabs();
  mirrorActors();
  setCombatBadgeViewer(ME);
  combatStore.combat = null;
});

afterEach(() => {
  clearSidebarTabs();
  setCombatBadgeViewer(null);
  combatStore.combat = null;
});

// ---------------------------------------------------------------------------
// REQ-CBA-002 — a state dot, never a counter
// ---------------------------------------------------------------------------

describe("REQ-CBA-002 — a aba entrega um ponto de estado, sem número", () => {
  it("REQ-CBA-002: o badge da aba combate é booleano, nunca um contador", () => {
    combatStore.combat = running("cb-mine");

    expect(typeof combatActiveBadge.value).toBe("boolean");
    expect(formatSidebarBadge(combatActiveBadge.value).kind).toBe("dot");
    expect(formatSidebarBadge(combatActiveBadge.value).text).toBeNull();
  });

  it("REQ-CBA-002: o trilho desenha ponto e nenhum número na aba combate", () => {
    combatStore.combat = running("cb-mine");
    const button = combatButton(renderRail());

    expect(button).not.toBeNull();
    expect(button!).toContain('data-badge-kind="dot"');
    expect(button!).not.toContain('data-badge-kind="counter"');
  });

  it("REQ-CBA-002: mesmo em âmbar o badge continua sem número", () => {
    combatStore.combat = running("cb-mine");

    expect(combatBadgeTone()).toBe("amber");
    expect(formatSidebarBadge(combatActiveBadge.value).text).toBeNull();
    expect(combatButton(renderRail())!).not.toContain('data-badge-kind="counter"');
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-003 — lit while there is an encounter, montagem included
// ---------------------------------------------------------------------------

describe("REQ-CBA-003 — aceso enquanto houver encontro, inclusive na montagem", () => {
  it("REQ-CBA-003: sem encontro, o ponto está apagado", () => {
    combatStore.combat = null;

    expect(combatBadgeLit()).toBe(false);
    expect(formatSidebarBadge(combatActiveBadge.value).kind).toBe("none");
    expect(drawnDotTone(renderRail())).toBeNull();
  });

  it("REQ-CBA-003: encontro criado e ainda não começado JÁ acende o ponto", () => {
    const combat = assembling();
    expect(combat.started).toBe(false);

    combatStore.combat = combat;

    expect(encounterDotIsLit(combat)).toBe(true);
    expect(combatBadgeLit()).toBe(true);
    expect(drawnDotTone(renderRail())).toBe("default");
  });

  it("REQ-CBA-003: encontro em andamento mantém o ponto aceso", () => {
    combatStore.combat = running("cb-theirs");

    expect(combatBadgeLit()).toBe(true);
    expect(drawnDotTone(renderRail())).toBe("default");
  });

  it("REQ-CBA-003: encontro encerrado apaga o ponto", () => {
    const ended = makeCombat({ started: true, ended: true, activeCombatantId: "cb-mine" });
    combatStore.combat = ended;

    expect(encounterDotIsLit(ended)).toBe(false);
    expect(combatBadgeLit()).toBe(false);
    expect(drawnDotTone(renderRail())).toBeNull();
  });

  it("REQ-CBA-003: encerrar durante a vez do usuário apaga o ponto em vez de deixá-lo âmbar", () => {
    combatStore.combat = running("cb-mine");
    expect(drawnDotTone(renderRail())).toBe("amber");

    combatStore.combat = { ...running("cb-mine"), ended: true };

    expect(combatBadgeLit()).toBe(false);
    expect(combatBadgeTone()).toBe("default");
    expect(drawnDotTone(renderRail())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-004 — amber on your turn, and the drawer never moves it
// ---------------------------------------------------------------------------

describe("REQ-CBA-004 — âmbar quando o participante da vez é do usuário", () => {
  it("REQ-CBA-004: a vez de um participante seu deixa o ponto âmbar", () => {
    combatStore.combat = running("cb-mine");

    expect(combatBadgeTone()).toBe("amber");
    expect(drawnDotTone(renderRail())).toBe("amber");
  });

  it("REQ-CBA-004: a vez do participante de outro jogador mantém o realce comum", () => {
    combatStore.combat = running("cb-theirs");

    expect(combatBadgeTone()).toBe("default");
    expect(drawnDotTone(renderRail())).toBe("default");
  });

  it("REQ-CBA-004: passar o turno devolve o ponto ao realce comum", () => {
    combatStore.combat = running("cb-mine");
    expect(drawnDotTone(renderRail())).toBe("amber");

    combatStore.combat = running("cb-theirs");

    expect(drawnDotTone(renderRail())).toBe("default");
  });

  it("REQ-CBA-004: na montagem não há vez, então o ponto fica aceso sem âmbar", () => {
    combatStore.combat = assembling();

    expect(combatBadgeLit()).toBe(true);
    expect(combatBadgeTone()).toBe("default");
  });

  it("REQ-CBA-004: participante da vez oculto (id redigido para null) não vira âmbar", () => {
    // REQ-CBA-082: the server masks activeCombatantId for a non-privileged viewer when
    // the participant of the turn is hidden. What arrives is a running encounter with
    // no id — which must read as "not yours", not as "unknown, so light it up".
    combatStore.combat = makeCombat({
      started: true,
      activeCombatantId: null,
      combatants: [makeCombatant({ _id: "cb-mine", actorId: "actor-mine", initiative: 18 })],
    });

    expect(combatBadgeLit()).toBe(true);
    expect(combatBadgeTone()).toBe("default");
  });

  it("REQ-CBA-004: quem é dono vem da posse do Ator, não de hasPlayerOwner", () => {
    // `hasPlayerOwner` only says "some player owns it" — using it as the amber rule
    // would light every player's rail on every player's turn.
    const owned = ownedActorIdsOf(worldMirror.getByType<Record<string, unknown>>("Actor"), ME);
    expect([...owned]).toEqual(["actor-mine"]);

    const theirTurn = running("cb-theirs");
    expect(theirTurn.combatants.every((c) => c.hasPlayerOwner)).toBe(true);
    expect(activeCombatantIsOwnedBy(theirTurn, owned)).toBe(false);
    expect(combatBadgeToneFor(theirTurn, owned)).toBe("default");
  });

  it("REQ-CBA-004: outra sessão, outro dono — o mesmo encontro fica âmbar para o outro", () => {
    combatStore.combat = running("cb-theirs");
    expect(combatBadgeTone()).toBe("default");

    setCombatBadgeViewer(SOMEONE_ELSE);

    expect(combatBadgeTone()).toBe("amber");
  });

  it("REQ-CBA-004: sem usuário conhecido nada é do usuário", () => {
    setCombatBadgeViewer(null);
    combatStore.combat = running("cb-mine");

    expect(combatBadgeLit()).toBe(true);
    expect(combatBadgeTone()).toBe("default");
  });

  it("REQ-CBA-004: abrir, trocar e recolher a gaveta não altera o ponto (REQ-GAV-022)", () => {
    combatStore.combat = running("cb-mine");

    const collapsed = {
      value: combatActiveBadge.value,
      tone: readSidebarBadgeTone(getSidebarTab("combat")?.badge),
      drawn: drawnDotTone(renderRail(false, null)),
    };
    expect(collapsed).toEqual({ value: true, tone: "amber", drawn: "amber" });

    // Open the tab itself, then another tab, then collapse again — the whole
    // vocabulary of the rail (REQ-GAV-011).
    for (const [open, activeTabId] of [
      [true, "combat"],
      [true, "chat"],
      [false, null],
    ] as const) {
      const drawn = drawnDotTone(renderRail(open, activeTabId));
      expect({
        value: combatActiveBadge.value,
        tone: readSidebarBadgeTone(getSidebarTab("combat")?.badge),
        drawn,
      }).toEqual(collapsed);
    }
  });

  it("REQ-CBA-004: o âmbar chega ao leitor de tela em palavras, não só em cor", () => {
    combatStore.combat = running("cb-theirs");
    const common = drawnDotDescription(renderRail());

    combatStore.combat = running("cb-mine");
    const amber = drawnDotDescription(renderRail());

    expect(common).toBeTruthy();
    expect(amber).toBeTruthy();
    expect(amber).not.toBe(common);
  });

  it("REQ-CBA-004: quem sabe de quem é o turno é a aba, não o trilho (REQ-GAV-023)", () => {
    const rail = source("../../../components/sidebar/SidebarRail.svelte");
    const badge = source("../../../components/sidebar/SidebarBadge.svelte");

    for (const file of [rail, badge]) {
      expect(file).not.toContain("combatStore");
      expect(file).not.toContain("combatBadge");
    }

    // ...and the table shell is what tells the badge whose seat this is, otherwise
    // `owned` is empty forever and the amber half is dead code.
    expect(source("../../../components/TableScreen.svelte")).toContain("setCombatBadgeViewer");
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-005 — no sound, no blinking
// ---------------------------------------------------------------------------

describe("REQ-CBA-005 — sem som e sem piscar", () => {
  it("REQ-CBA-005: nem o valor nem o tom mudam sozinhos com o tempo", () => {
    vi.useFakeTimers();
    try {
      combatStore.combat = running("cb-mine");
      expect(combatBadgeLit()).toBe(true);
      expect(combatBadgeTone()).toBe("amber");

      vi.advanceTimersByTime(120_000);

      expect(combatBadgeLit()).toBe(true);
      expect(combatBadgeTone()).toBe("amber");
      expect(drawnDotTone(renderRail())).toBe("amber");
    } finally {
      vi.useRealTimers();
    }
  });

  it("REQ-CBA-005: o módulo da aba não tem timer, áudio nem animação", () => {
    const module = source("../combatBadge.svelte.ts");

    expect(module).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(module).not.toMatch(/new Audio|Howl|\.play\(/);
  });

  it("REQ-CBA-005: o ponto desenhado não anima nem transiciona", () => {
    const styleBlock = /<style>([\s\S]*)<\/style>/.exec(
      source("../../../components/sidebar/SidebarBadge.svelte"),
    );
    expect(styleBlock).not.toBeNull();

    // Declaration form, not prose: the comments in the file explain *why* there is no
    // animation, and must not be what makes this pass.
    expect(styleBlock![1]!).not.toMatch(/@keyframes/);
    expect(styleBlock![1]!).not.toMatch(/^\s*animation\s*:/m);
    expect(styleBlock![1]!).not.toMatch(/^\s*transition\s*:/m);
  });
});
