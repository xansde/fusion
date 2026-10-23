/**
 * PartyPanel.test.ts — the Mestre's table of player characters (drawer tab "party").
 *
 * Node environment, no DOM: the assertions read the server-rendered markup and the component source.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PartyPanel from "../PartyPanel.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import {
  registerActorSummary,
  resetActorSummaries,
} from "../../../lib/sheets/actorSummaryRegistry.svelte.js";
import "../../../lib/i18n/index.js";
import SummaryStub from "./SummaryStub.svelte";

const GM = "user-gm";
const ALEX = "user-alex";

const ZELDA = {
  _id: "act-zelda",
  name: "Zelda",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
  system: { derived: { hp: { value: 12, max: 30 } } },
};
const GOBLIN = { _id: "act-goblin", name: "Goblin", type: "npc", ownership: { default: 0 } };

function seed(actors: readonly Record<string, unknown>[]): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [...actors] },
  } as never);
}

function renderPanel(isGm = true): string {
  return render(PartyPanel, {
    props: { socket: {} as never, worldId: "w", userId: GM, isGm, activeSceneId: null },
  }).body;
}

beforeEach(() => {
  resetActorSummaries();
  seed([]);
});

describe("PartyPanel", () => {
  it("lists one card per player character and ignores NPCs", () => {
    seed([ZELDA, GOBLIN]);
    const body = renderPanel();
    expect(body).toContain('data-actor-id="act-zelda"');
    expect(body).not.toContain("act-goblin");
  });

  it("draws the registered summary component inside the card", () => {
    registerActorSummary("character", SummaryStub);
    seed([ZELDA]);
    expect(renderPanel()).toContain('data-testid="summary-stub"');
  });

  it("without a registered summary falls back to the name and the generic hit points", () => {
    seed([ZELDA]);
    const body = renderPanel();
    expect(body).toContain("Zelda");
    expect(body).toContain("12");
    expect(body).toContain("30");
  });

  it("draws nothing for a seat that is not the Mestre", () => {
    seed([ZELDA]);
    expect(renderPanel(false)).not.toContain("act-zelda");
  });

  it("says so when there is no player character yet", () => {
    seed([GOBLIN]);
    expect(renderPanel()).toContain('data-empty="party"');
  });

  it("the card opens the full sheet and the grid never scrolls sideways", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../PartyPanel.svelte", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("openActorSheet(");
    expect(source).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(/);
  });
});
