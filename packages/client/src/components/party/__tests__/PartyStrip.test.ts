/**
 * PartyStrip.test.ts — the Mestre's strip of party chips, in the place of the action bar.
 *
 * Node environment, no DOM: the assertions read the server-rendered markup and the component source.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PartyStrip from "../PartyStrip.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { publishBarHeight } from "../../../lib/actionbar/barFootprint.svelte.js";
import {
  registerActorChip,
  resetActorSummaries,
} from "../../../lib/sheets/actorSummaryRegistry.svelte.js";
import "../../../lib/i18n/index.js";
import ChipStub from "./ChipStub.svelte";

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

function renderStrip(isGm = true): string {
  return render(PartyStrip, {
    props: { socket: {} as never, worldId: "w", userId: GM, isGm },
  }).body;
}

beforeEach(() => {
  resetActorSummaries();
  publishBarHeight(0);
  seed([]);
});

describe("PartyStrip", () => {
  it("draws one chip per player character and ignores NPCs", () => {
    seed([ZELDA, GOBLIN]);
    const body = renderStrip();
    expect(body).toContain('data-actor-id="act-zelda"');
    expect(body).not.toContain("act-goblin");
  });

  it("draws the registered chip component inside each chip", () => {
    registerActorChip("character", ChipStub);
    seed([ZELDA]);
    expect(renderStrip()).toContain('data-testid="chip-stub"');
  });

  it("without a registered chip falls back to the portrait, the name and the generic hit points", () => {
    seed([ZELDA]);
    const text = renderStrip();
    expect(text).toContain("Zelda");
    expect(text).toContain("12 / 30");
  });

  it("draws nothing for a seat that is not the Mestre", () => {
    seed([ZELDA]);
    expect(renderStrip(false)).not.toContain("act-zelda");
  });

  it("draws nothing while an action bar is drawn", () => {
    seed([ZELDA]);
    publishBarHeight(96);
    expect(renderStrip()).not.toContain("act-zelda");
  });

  it("draws nothing when there is no player character", () => {
    seed([GOBLIN]);
    expect(renderStrip()).not.toContain("party-strip__chip");
  });

  it("each chip is a button that opens the sheet, with the summary on hover and focus", () => {
    seed([ZELDA]);
    expect(renderStrip()).toMatch(/<button[^>]*party-strip__chip/);
    const source = readFileSync(
      fileURLToPath(new URL("../PartyStrip.svelte", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("openActorSheet(");
    expect(source).toContain("resolveActorSummary(");
    expect(source).toMatch(/onpointerenter/);
    expect(source).toMatch(/onfocus/);
    expect(source).toMatch(/onpointerleave/);
    expect(source).toMatch(/onblur/);
  });

  it("scrolls on its own and never lets the page scroll sideways", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../PartyStrip.svelte", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/overflow-x:\s*auto/);
    expect(source).toContain("z-index: var(--fusion-z-actionbar)");
  });
});

describe("table wiring", () => {
  const table = readFileSync(
    fileURLToPath(new URL("../../TableScreen.svelte", import.meta.url)),
    "utf8",
  );

  it("mounts the strip next to the action bar", () => {
    expect(table).toContain("import PartyStrip");
    expect(table).toContain("<PartyStrip");
  });
});
