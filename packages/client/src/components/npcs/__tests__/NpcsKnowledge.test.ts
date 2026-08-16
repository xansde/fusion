/**
 * NpcsKnowledge.test.ts — knowledge as the drawn tab shows it (spec 42 §5.9, G077).
 *
 * Covers what only the rendered panel can show: REQ-NPC-070 (each line says, in
 * READING, how many characters know and how many glimpsed the actor), REQ-NPC-071
 * (no line carries a control that alters knowledge) and REQ-NPC-072 (the single door
 * to the "Quem conhece quem" window is the footer's, and it is the Contatos tab's
 * own window). REQ-NPC-073 is checked where it can be: nothing in this tab names the
 * op that changes knowledge, so an edit can only travel the window's one path.
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the assertions read the server-rendered markup (`svelte/server`) and, for what a
 * rendered string cannot show, the components' own source.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import NpcsPanel from "../NpcsPanel.svelte";
import NpcKnowledgeCount from "../NpcKnowledgeCount.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { KNOWLEDGE_OP_TYPE } from "../../../lib/contacts/knowledgeGrid.js";
import { KnowledgeState } from "@fusion/shared";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// localStorage stub (node environment) — the panel reads its pins from it.
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
// Fixtures — three characters, one ferreiro two of them know, one nobody counted
// ---------------------------------------------------------------------------

const WORLD = "world-1";
const GM = "user-gm-one";

const FERREIRO_ID = "act-ferreiro001";
const ERMITAO_ID = "act-ermitao0001";

const ACTORS = [
  { _id: "act-fofurinha01x", name: "Fofurinha", type: "character" },
  { _id: "act-tobias00001x", name: "Tobias", type: "character" },
  { _id: "act-elara000001x", name: "Elara", type: "character" },
  {
    _id: FERREIRO_ID,
    name: "Ferreiro",
    type: "npc",
    folder: null,
    flags: {
      fusion: {
        knowledge: {
          general: KnowledgeState.Glimpsed,
          exceptions: {
            "act-fofurinha01x": KnowledgeState.Known,
            "act-tobias00001x": KnowledgeState.Known,
          },
        },
      },
    },
  },
  // No knowledge map at all: the row must show no counts rather than zeros.
  { _id: ERMITAO_ID, name: "Ermitão", type: "npc", folder: null },
];

function seedMirror(): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: ACTORS, Folder: [], Scene: [] },
  });
}

function renderPanel(): string {
  return render(NpcsPanel, {
    props: { socket: {} as never, worldId: WORLD, userId: GM, isGm: true, activeSceneId: null },
  }).body;
}

/** The `<li>` of one actor row, up to the start of the next row. */
function npcRow(body: string, actorId: string): string {
  const match = new RegExp(
    `<li[^>]*data-npc-id="${actorId}"[\\s\\S]*?(?=<li[^>]*data-npc-id=|</ul>)`,
  ).exec(body);
  expect(match, `row of ${actorId} not found`).not.toBeNull();
  return match?.[0] ?? "";
}

const PANEL_SOURCE = readFileSync(
  fileURLToPath(new URL("../NpcsPanel.svelte", import.meta.url)),
  "utf8",
);

/** Source with every comment removed, so prose about an op is never read as one. */
const COUNT_SOURCE = readFileSync(
  fileURLToPath(new URL("../NpcKnowledgeCount.svelte", import.meta.url)),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  storage.clear();
  seedMirror();
});

describe("REQ-NPC-070: the line says who knows, in reading", () => {
  it("REQ-NPC-070: the row shows how many know and how many glimpsed", () => {
    const row = npcRow(renderPanel(), FERREIRO_ID);

    expect(row).toContain('data-npc-knowledge-known="2"');
    expect(row).toContain('data-npc-knowledge-glimpsed="1"');
    expect(row).toContain("2 conhecem");
    expect(row).toContain("1 entreviram");
  });

  it("REQ-NPC-070: a row with no knowledge map shows no counts at all", () => {
    const row = npcRow(renderPanel(), ERMITAO_ID);

    expect(row).not.toContain("data-npc-knowledge-known");
    expect(row).not.toContain("conhecem");
  });

  it("REQ-NPC-070: the counts are announced in words to assistive technology", () => {
    const body = render(NpcKnowledgeCount, {
      props: { knowledge: { known: 2, glimpsed: 1, characters: 3 } },
    }).body;

    expect(body).toContain("aria-label");
    expect(body).toContain("personagens conhecem");
  });
});

describe("REQ-NPC-071: no line offers a control that alters knowledge", () => {
  it("REQ-NPC-071: the counts are a span — no button, no select, no handler", () => {
    const row = npcRow(renderPanel(), FERREIRO_ID);
    const counts = /<span[^>]*data-npc-knowledge-known[\s\S]*?<\/span>/.exec(row);

    expect(counts).not.toBeNull();
    expect(counts?.[0]).not.toContain("<button");
    expect(COUNT_SOURCE).not.toContain("<button");
    expect(COUNT_SOURCE).not.toContain("onclick");
    expect(COUNT_SOURCE).not.toContain("socket");
  });

  it("REQ-NPC-071: no row carries a knowledge action of any kind", () => {
    const body = renderPanel();

    for (const actorId of [FERREIRO_ID, ERMITAO_ID]) {
      const row = npcRow(body, actorId);
      expect(row).not.toContain("knowledge-cycle");
      expect(row).not.toContain('data-action="open-knowledge"');
      expect(row).not.toContain('data-action="set-knowledge"');
    }
  });
});

describe("REQ-NPC-072 / REQ-NPC-073: one door, one window, one op", () => {
  it("REQ-NPC-072: the only knowledge door is the footer's, and it opens once", () => {
    const body = renderPanel();

    expect([...body.matchAll(/data-action="open-knowledge"/g)]).toHaveLength(1);
    // And it sits in the footer, outside the scrolling list (REQ-NPC-062).
    const footer = /<footer[\s\S]*?<\/footer>/.exec(body)?.[0] ?? "";
    expect(footer).toContain('data-action="open-knowledge"');
  });

  it("REQ-NPC-073: nothing in the tab sends the knowledge op — only the window does", () => {
    expect(PANEL_SOURCE).not.toContain(KNOWLEDGE_OP_TYPE);
    expect(COUNT_SOURCE).not.toContain(KNOWLEDGE_OP_TYPE);
    expect(PANEL_SOURCE).not.toContain("windowManager.open");
  });
});
