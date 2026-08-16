/**
 * NpcsAttitude.test.ts — the attitude as the row DRAWS it (spec 42 §5.5, G073,
 * client half).
 *
 * Covers REQ-NPC-037 (a non-playable with no applicable attitude shows no
 * indication at all — an npc without one, and a hazard ever), REQ-NPC-038 (the
 * value is changed on the row itself, cycling one step per activation, and the
 * control is operable by keyboard — the same gesture as the cell of spec 39's
 * grid) and REQ-NPC-039 (there is one attitude for the whole party: no row, and
 * no window this tab opens, offers a per-character exception for it).
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library —
 * so the assertions read the server-rendered markup (`svelte/server`) and, where
 * a rendered string cannot show it, the component's own source.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import NpcsPanel from "../NpcsPanel.svelte";
import KnowledgeGridWindow from "../../contacts/KnowledgeGridWindow.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { nextAttitude } from "../../../lib/npcs/npcAttitude.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage stub — the panel reads its pins at construction.
// ---------------------------------------------------------------------------

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storage.set(key, value);
    },
    removeItem: (key: string): void => {
      storage.delete(key);
    },
    clear: (): void => {
      storage.clear();
    },
    key: (index: number): string | null => [...storage.keys()][index] ?? null,
    get length(): number {
      return storage.size;
    },
  },
});

// ---------------------------------------------------------------------------
// Fixtures — one npc per attitude, one npc without any, one hazard
// ---------------------------------------------------------------------------

const BRAM = {
  _id: "act-bram00000001",
  name: "Bram",
  type: "npc",
  folder: null,
  flags: { fusion: { attitude: "ally" } },
};

const ANA = {
  _id: "act-ana000000001",
  name: "Ana",
  type: "npc",
  folder: null,
  flags: { fusion: { attitude: "enemy" } },
};

/** An npc that never received one: it must show nothing, but stay changeable. */
const SEM = { _id: "act-sem00000001", name: "Sem Atitude", type: "npc", folder: null };

/** A hazard: no attitude, ever — and the document carries a stray flag on purpose. */
const FOSSO = {
  _id: "act-fosso0000001",
  name: "Fosso",
  type: "hazard",
  folder: null,
  flags: { fusion: { attitude: "enemy" } },
};

/** A character, so the panel's population is the real one. */
const TOBIAS = { _id: "act-tobias00001", name: "Tobias", type: "character" };

function renderPanel(isGm = true): string {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [BRAM, ANA, SEM, FOSSO, TOBIAS], Folder: [], Scene: [] },
  });
  return render(NpcsPanel, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-gm",
      isGm,
      activeSceneId: null,
    },
  }).body;
}

/** The `<li>` of one non-playable row, up to the start of the next one. */
function npcRow(body: string, actorId: string): string {
  const match = new RegExp(
    `<li[^>]*data-npc-id="${actorId}"[\\s\\S]*?(?=<li[^>]*data-npc-id=|</ul>)`,
  ).exec(body);
  if (match === null) throw new Error(`no row for ${actorId}`);
  return match[0];
}

/** The opening tag of the element that carries an attribute, wherever it is. */
function openingTagWith(markup: string, attribute: string): string {
  const index = markup.indexOf(attribute);
  if (index === -1) throw new Error(`no element carrying ${attribute}`);
  const start = markup.lastIndexOf("<", index);
  const end = markup.indexOf(">", index);
  return markup.slice(start, end + 1);
}

/** The row's markup with every control (and its label) removed. */
function withoutControls(markup: string): string {
  return markup.replace(/<button[\s\S]*?<\/button>/g, "").replace(/<select[\s\S]*?<\/select>/g, "");
}

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for code. */
function codeOf(file: string): string {
  return sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

beforeEach(() => {
  storage.clear();
});

// ---------------------------------------------------------------------------
// REQ-NPC-037 — shown only where there is one
// ---------------------------------------------------------------------------

describe("REQ-NPC-037: an attitude is shown only where one applies", () => {
  it("REQ-NPC-037: an npc that has one shows it as a word, not only as a colour", () => {
    const row = npcRow(renderPanel(), BRAM._id);

    expect(row).toContain('data-npc-attitude="ally"');
    // The word the row prints, in the viewer's language — a colour alone would
    // leave the value unreadable to whoever cannot tell the two hues apart.
    expect(row).toContain("Aliado");
  });

  it("REQ-NPC-037: an npc without one shows no indication at all", () => {
    const row = npcRow(renderPanel(), SEM._id);

    expect(row).not.toContain("data-npc-attitude");
    // Not a word of it is DISPLAYED either. What the row still carries is the
    // control's own label ("mudar para Aliado"), which is an offer, not an
    // indication — so the check is against the row minus its controls.
    for (const word of ["Aliado", "Neutro", "Inimigo"]) {
      expect(withoutControls(row)).not.toContain(word);
    }
  });

  it("REQ-NPC-037: a hazard shows none and offers none, even carrying a stray flag", () => {
    const row = npcRow(renderPanel(), FOSSO._id);

    // The fixture really does carry the flag, so this is not a fixture that forgot.
    expect(FOSSO.flags.fusion.attitude).toBe("enemy");
    expect(row).not.toContain("data-npc-attitude");
    expect(row).not.toContain('data-action="cycle-attitude"');
    expect(withoutControls(row)).not.toContain("Inimigo");
  });

  it("REQ-NPC-037: each npc's row shows its own value, not the first one's", () => {
    const body = renderPanel();

    expect(npcRow(body, BRAM._id)).toContain('data-npc-attitude="ally"');
    expect(npcRow(body, ANA._id)).toContain('data-npc-attitude="enemy"');
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-038 — cycled on the row, and by keyboard
// ---------------------------------------------------------------------------

describe("REQ-NPC-038: the attitude is cycled on the row itself, by keyboard too", () => {
  it("REQ-NPC-038: the control lives inside the row it changes", () => {
    const row = npcRow(renderPanel(), BRAM._id);

    expect(row).toContain('data-action="cycle-attitude"');
    // It names the row it acts on, so no control can act on a neighbour's actor.
    expect(row).toContain(`data-npc-cycle="${BRAM._id}"`);
  });

  it("REQ-NPC-038: one activation names the NEXT value, one step along the cycle", () => {
    const body = renderPanel();

    // Bram is `ally`, Ana is `enemy`: two different rows, two different nexts,
    // each one step from where that row is — the order itself is the shared
    // module's, and this test reads it through `nextAttitude`, never restating it.
    expect(npcRow(body, BRAM._id)).toContain(`data-attitude-next="${nextAttitude("ally")}"`);
    expect(npcRow(body, ANA._id)).toContain(`data-attitude-next="${nextAttitude("enemy")}"`);
    expect(nextAttitude("ally")).not.toBe(nextAttitude("enemy"));
  });

  it("REQ-NPC-038: an npc with no attitude still offers the control, entering the cycle", () => {
    const row = npcRow(renderPanel(), SEM._id);

    expect(row).toContain('data-action="cycle-attitude"');
    expect(row).toContain(`data-attitude-next="${nextAttitude(null)}"`);
  });

  it("REQ-NPC-038: the control is a real button — focusable, so Enter and Space reach it", () => {
    const row = npcRow(renderPanel(), BRAM._id);
    const tag = openingTagWith(row, 'data-action="cycle-attitude"');

    expect(tag.startsWith("<button")).toBe(true);
    expect(tag).toContain('type="button"');
    // Nothing takes it out of the tab order, and it is not disabled for the GM.
    expect(tag).not.toContain("tabindex");
    expect(tag).not.toContain("disabled");
  });

  it("REQ-NPC-038: it announces itself, so the keyboard user hears what one press does", () => {
    const row = npcRow(renderPanel(), BRAM._id);
    const tag = openingTagWith(row, 'data-action="cycle-attitude"');

    expect(tag).toContain("aria-label");
    expect(tag).toContain("Bram");
    // The label names the value the press moves TO, not the one already shown.
    expect(tag).toContain("Neutro");
  });

  it("REQ-NPC-038: it is the same gesture as the cell of spec 39's grid", () => {
    // The panel first: rendering it is what seeds the mirror both components read.
    const control = openingTagWith(npcRow(renderPanel(), BRAM._id), 'data-action="cycle-attitude"');
    const cell = openingTagWith(
      render(KnowledgeGridWindow, { props: { socket: {} as never } }).body,
      // Only the grid's CELL carries this attribute — the legend's swatches and
      // the two head controls do not.
      "data-exception=",
    );

    // Both are a native button with an aria-label: one hand learns one gesture.
    expect(cell.startsWith("<button")).toBe(true);
    expect(control.startsWith("<button")).toBe(true);
    expect(cell).toContain('type="button"');
    expect(control).toContain('type="button"');
  });

  it("REQ-NPC-038: the write is the ordinary doc:update, with no second op invented", () => {
    const code = codeOf("NpcsPanel.svelte");

    // The panel asks `attitudeCycleOp` for the edit; it does not build one.
    expect(code).toContain("attitudeCycleOp");
    expect(code).not.toContain("attitude:set");
    expect(code).not.toContain("actor:setAttitude");
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-039 — one value for the whole party
// ---------------------------------------------------------------------------

describe("REQ-NPC-039: one attitude for the party, never one per character", () => {
  it("REQ-NPC-039: the row carries a single value, and no per-character cell", () => {
    const row = npcRow(renderPanel(), BRAM._id);

    expect([...row.matchAll(/data-npc-attitude="/g)]).toHaveLength(1);
    // The characters at the table are not columns of the attitude: no control in
    // the row mentions one.
    expect(row).not.toContain(TOBIAS._id);
  });

  it("REQ-NPC-039: no row offers an exception, the way the knowledge grid's cells do", () => {
    const body = renderPanel();

    expect(body).not.toContain("attitude-exception");
    expect(body).not.toContain("data-attitude-character");
  });

  it("REQ-NPC-039: the panel never sends a character id along with an attitude", () => {
    const code = codeOf("NpcsPanel.svelte");
    const call = /attitudeCycleOp\(\{[\s\S]*?\}\)/.exec(code)?.[0] ?? "";

    expect(call).toContain("row.id");
    expect(call).not.toContain("character");
    expect(call).not.toContain("userId");
  });
});
