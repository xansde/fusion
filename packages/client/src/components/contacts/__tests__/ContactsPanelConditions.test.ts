/**
 * ContactsPanelConditions.test.ts — the condition chips the Contatos tab really
 * draws (spec 39 §5.4, G063).
 *
 * `ConditionChip.test.ts` proves the chip against declarations built by hand;
 * this file proves the PANEL is wired to the system's declarations at all —
 * that REQ-CTT-031 (colour from the declared `tone`), REQ-CTT-032 (the filled
 * emphasis of a critical condition) and REQ-CTT-034 (the system's help in a
 * drawn tooltip) have a live path from the registry to the markup, instead of
 * existing only in a fixture.
 *
 * The decisive shape of each assertion is a comparison against the SAME panel
 * rendered with an empty registry: if the declaration were being ignored, both
 * renders would be identical.
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library —
 * so the assertions read the server-rendered markup (`svelte/server`).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ContactsPanel from "../ContactsPanel.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import {
  resetConditionRegistry,
  seedConditionRegistry,
} from "../../../lib/conditions/conditionRegistry.svelte.js";
import "../../../lib/i18n/index.js";

const ALEX = "user-alex-000001";

/**
 * Two conditions on one character: one merely harmful, one harmful AND critical.
 * The card draws at most two chips (REQ-CTT-037), so both are on screen.
 */
const FOFURINHA = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  ownership: { default: 0, [ALEX]: 3 },
  system: { details: { class: "Druida", level: 5 } },
  items: [
    {
      _id: "it-1",
      type: "condition",
      name: "Amedrontado",
      system: { slug: "frightened", value: 2 },
    },
    { _id: "it-2", type: "condition", name: "Morrendo", system: { slug: "dying", value: 1 } },
  ],
};

/** What a system declares through `registrar.condition` (REQ-SYS-043). */
const DECLARED = [
  {
    slug: "frightened",
    label: "Amedrontado",
    tone: "harm",
    help: "Penalidade de status em testes e CD.",
  },
  {
    slug: "dying",
    label: "Morrendo",
    tone: "harm",
    help: "Inconsciente e a um passo da morte.",
    critical: true,
  },
];

function renderPanel(): string {
  return render(ContactsPanel, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: ALEX,
      isGm: false,
      activeSceneId: null,
    },
  }).body;
}

/** The markup of one chip, by condition slug. */
function chipOf(body: string, slug: string): string {
  const at = body.indexOf(`data-condition="${slug}"`);
  if (at === -1) throw new Error(`no chip for "${slug}"`);
  const from = body.lastIndexOf("<span", at);
  return body.slice(from, body.indexOf("</span>", body.indexOf("condition-chip__meaning", at)));
}

beforeEach(() => {
  resetConditionRegistry();
  worldMirror.applySnapshot({ seq: 1, activeSceneId: null, documents: { Actor: [FOFURINHA] } });
});

// ---------------------------------------------------------------------------
// The declared contract reaches the drawn chip
// ---------------------------------------------------------------------------

describe("the panel paints the chips from what the system declared (DEC-CTT-11)", () => {
  it("REQ-CTT-031: the chip's tone is the declared one, not the fallback", () => {
    seedConditionRegistry(DECLARED);
    const declared = chipOf(renderPanel(), "frightened");

    expect(declared).toContain('data-tone="harm"');
    expect(declared).toContain("condition-chip--harm");

    // Without the declaration the very same card draws a situation — which is
    // what proves the tone above came from the registry and not from a constant.
    resetConditionRegistry();
    expect(chipOf(renderPanel(), "frightened")).toContain('data-tone="special"');
  });

  it("REQ-CTT-032: a condition declared critical is drawn with the filled emphasis", () => {
    seedConditionRegistry(DECLARED);
    const body = renderPanel();

    expect(chipOf(body, "dying")).toContain('data-critical="true"');
    expect(chipOf(body, "frightened")).toContain('data-critical="false"');

    resetConditionRegistry();
    expect(chipOf(renderPanel(), "dying")).toContain('data-critical="false"');
  });

  it("REQ-CTT-034: the system's help text is drawn in the chip's own tooltip", () => {
    seedConditionRegistry(DECLARED);
    const body = renderPanel();

    expect(body).toContain('role="tooltip"');
    expect(body).toContain("Penalidade de status em testes e CD.");
    expect(body).toContain("Inconsciente e a um passo da morte.");
    // REQ-CTT-034: ours, drawn — never the native attribute.
    expect(body).not.toContain('title="Penalidade');

    resetConditionRegistry();
    expect(renderPanel()).not.toContain("Penalidade de status em testes e CD.");
  });

  it("REQ-CTT-036: the critical condition is ordered ahead of the merely harmful one", () => {
    seedConditionRegistry(DECLARED);
    const body = renderPanel();

    expect(body.indexOf('data-condition="dying"')).toBeLessThan(
      body.indexOf('data-condition="frightened"'),
    );
  });
});

// ---------------------------------------------------------------------------
// Degradation — REQ-CTT-035
// ---------------------------------------------------------------------------

describe("an undeclared condition is degraded, never hidden (REQ-CTT-035)", () => {
  it("REQ-CTT-035: with no declaration at all both conditions still reach the card", () => {
    const body = renderPanel();

    // Named after the actor's own condition item, since the system said nothing.
    expect(body).toContain("Amedrontado 2");
    expect(body).toContain("Morrendo 1");
  });

  it("REQ-CTT-033: the declared label carries the value glued to it, in one chip", () => {
    seedConditionRegistry(DECLARED);
    const body = renderPanel();

    expect(body).toContain("Amedrontado 2");
    expect(body).not.toContain("Amedrontado (2)");
  });
});
