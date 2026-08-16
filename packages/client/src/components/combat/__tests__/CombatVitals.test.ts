/**
 * CombatVitals.test.ts — health by role and conditions by contract, as drawn (task G052).
 *
 * Rendered with `render()` from `svelte/server`, like `TurnHead.test.ts` and
 * `CombatQueue.test.ts`: the client project runs Vitest in a node environment, with no
 * jsdom and no testing-library, so a component test looks at the markup the server
 * renderer emits and at the component's own `<style>` block for the rules the renderer
 * never emits (the drawn tooltip, the truncation, the tone colours).
 *
 * Covers REQ-CBA-040 (bar and number for a privileged role), REQ-CBA-041 (a player never
 * reads creature health), REQ-CBA-042 (the level is in text as well as in the bar),
 * REQ-CBA-043 (unresolvable health is omitted, never a full or zeroed bar), REQ-CBA-050
 * (conditions as text tags following the system's declaration), REQ-CBA-051 (two tags plus
 * "+N"), REQ-CBA-052 (only the head's "+N" grows it), REQ-CBA-053 (a condition survives the
 * health rule) and the chip contract of REQ-CTT-030..038.
 *
 * Q-CBA-02 / REQ-CBA-083: the player half of REQ-CBA-041 is a rule of this screen — the
 * same creature health reaches the client through the token's resource bars (REQ-CNV-090).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

import ConditionChip from "../../common/ConditionChip.svelte";
import TurnHead from "../TurnHead.svelte";
import CombatQueue from "../CombatQueue.svelte";
import CombatPanelSourceMarker from "../CombatPanel.svelte";
import { buildRotatedQueue, buildTrackerRows } from "../../../lib/combat/combatTracker.js";
import { buildCombatVitals } from "../../../lib/combat/combatVitals.js";
import { TurnHeadState } from "../../../lib/combat/turnHead.svelte.js";
import { buildConditionChip } from "../../../lib/conditions/conditionChip.js";
import type { ConditionChipModel } from "../../../lib/conditions/conditionChip.js";
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
    initiative: 15,
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

function makeActor(
  id: string,
  hp: { value: number; max: number } | null,
  conditions: { name: string; slug: string; value?: number }[] = [],
): Record<string, unknown> {
  return {
    _id: id,
    name: id,
    type: "npc",
    system: hp === null ? {} : { attributes: { hp: { ...hp } } },
    items: conditions.map((c, index) => ({
      _id: `${id}-cond-${String(index)}`,
      name: c.name,
      type: "condition",
      system: { slug: c.slug, ...(c.value === undefined ? {} : { value: c.value }) },
    })),
  };
}

function chip(overrides: Partial<ConditionChipModel> = {}): ConditionChipModel {
  return {
    ...buildConditionChip({ id: "x", slug: "x", name: "Amedrontado", value: 2 }, { tone: "harm" }),
    ...overrides,
  };
}

function renderHead(options: {
  health?: { current: number; max: number } | null;
  conditions?: ConditionChipModel[];
}): string {
  const { body } = render(TurnHead, {
    props: {
      name: "Goblin Guerreiro",
      img: null,
      health: options.health ?? null,
      conditions: options.conditions ?? [],
      canAdvance: true,
      canPrevious: true,
      busy: false,
      state: new TurnHeadState(),
    },
  });
  return body;
}

/** The whole panel pipeline, from documents to markup, for one viewer role. */
function renderQueueFor(role: "gm" | "player"): string {
  const combatants = [
    makeCombatant({ _id: "pc", actorId: "hero", name: "Fofurinha", hasPlayerOwner: true }),
    makeCombatant({ _id: "mob", actorId: "goblin", name: "Goblin", initiative: 12 }),
    makeCombatant({ _id: "active", actorId: "boss", name: "Chefe", initiative: 20 }),
  ];
  const combat = makeCombat(combatants, "active");
  const actors = new Map<string, Record<string, unknown>>([
    ["hero", makeActor("hero", { value: 21, max: 34 })],
    [
      "goblin",
      makeActor("goblin", { value: 7, max: 26 }, [
        { name: "Amedrontado", slug: "frightened", value: 2 },
      ]),
    ],
    ["boss", makeActor("boss", { value: 40, max: 90 })],
  ]);

  const rows = buildTrackerRows(combat);
  const queue = buildRotatedQueue(rows, role === "gm");
  const vitals = buildCombatVitals(role, combat.combatants, actors);

  const { body } = render(CombatQueue, {
    props: {
      queue,
      vitals,
      gmControls: role === "gm",
      busy: false,
      order: rows.map((row) => row.id),
      rollable: new Set<string>(),
    },
  });
  return body;
}

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

function styleOf(file: string): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(sourceOf(file))?.[1];
  if (style === undefined) throw new Error(`${file} has no <style> block`);
  return style;
}

// ---------------------------------------------------------------------------
// Health on the turn head
// ---------------------------------------------------------------------------

describe("the turn head draws the health it is given (REQ-CBA-040, REQ-CBA-042, REQ-CBA-043)", () => {
  it("REQ-CBA-040 / REQ-CBA-042: bar and number together, so the level is never colour alone", () => {
    const body = renderHead({ health: { current: 12, max: 40 } });

    expect(body).toContain("turn-head__health-track");
    expect(body).toContain("12/40");
    expect(body).toContain(t("FUSION.Combat.TurnHead.Health", { current: 12, max: 40 }));
  });

  it("REQ-CBA-043: no health means no bar at all — not an empty one, not a full one", () => {
    const body = renderHead({ health: null });

    expect(body).not.toContain("turn-head__health");
    expect(body).not.toContain("0/0");
  });
});

// ---------------------------------------------------------------------------
// The asymmetry, end to end
// ---------------------------------------------------------------------------

describe("the same encounter, two roles (REQ-CBA-040, REQ-CBA-041, REQ-CBA-053)", () => {
  it("REQ-CBA-040: a privileged role reads current/maximum of creature and player character alike", () => {
    const body = renderQueueFor("gm");

    expect(body).toContain("7/26"); // the goblin
    expect(body).toContain("21/34"); // the player character
  });

  it("REQ-CBA-041: the player reads the player character and NOTHING of the creature", () => {
    const body = renderQueueFor("player");

    expect(body).toContain("21/34");
    expect(body).not.toContain("7/26");
    // No fraction, no percentage, no qualitative step for the creature: its numbers are
    // simply absent from the markup.
    expect(body).not.toContain("26");
    expect(body).not.toContain("width:27%"); // 7/26 as a bar
  });

  it("REQ-CBA-053: the creature the player may not count still shows its condition", () => {
    const body = renderQueueFor("player");

    expect(body).toContain("Amedrontado 2");
    expect(body).toContain("condition-chip");
  });
});

// ---------------------------------------------------------------------------
// The chip contract (REQ-CBA-050..052, REQ-CTT-030..038)
// ---------------------------------------------------------------------------

describe("ConditionChip paints the declaration, never the condition (REQ-CBA-050, REQ-CTT-030..038)", () => {
  it("REQ-CTT-030 / REQ-CBA-050: text tag with no icon and no image", () => {
    const { body } = render(ConditionChip, { props: { label: "Amedrontado 2", tone: "harm" } });

    expect(body).toContain("Amedrontado 2");
    expect(body).not.toContain("<img");
    expect(body).not.toContain("<svg");
  });

  it("REQ-CTT-031: the tone is what selects the colour, and there are exactly three", () => {
    for (const tone of ["benefit", "harm", "special"] as const) {
      const { body } = render(ConditionChip, { props: { label: "X", tone } });
      expect(body).toContain(`condition-chip--${tone}`);
    }

    const style = styleOf("../../common/ConditionChip.svelte");
    expect(style).toContain("--fusion-condition-benefit");
    expect(style).toContain("--fusion-condition-harm");
    expect(style).toContain("--fusion-condition-special");
  });

  it("REQ-CTT-032: critical fills the chip in the tone it already has, and says the word", () => {
    const { body } = render(ConditionChip, {
      props: { label: "Inconsciente", tone: "harm", critical: true },
    });

    expect(body).toContain("condition-chip--critical");
    expect(body).toContain("condition-chip--harm");
    expect(body).toContain(t("FUSION.Condition.Critical"));

    // The fill is the tone's own dim variant — never a fourth colour.
    const style = styleOf("../../common/ConditionChip.svelte");
    const critical = /\.condition-chip--critical\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";
    expect(critical).toContain("var(--chip-fill)");
  });

  it("REQ-CTT-034: the help is a drawn tooltip, never the native `title`", () => {
    const { body } = render(ConditionChip, {
      props: { label: "Amedrontado 2", tone: "harm", help: "Penalidade em tudo." },
    });

    expect(body).toContain('role="tooltip"');
    expect(body).toContain("Penalidade em tudo.");
    expect(body).not.toContain("title=");
  });

  it("REQ-CTT-034 / REQ-CBA-093: the tipped chip stays a button, and the tip is wired to it", () => {
    const { body } = render(ConditionChip, {
      props: { label: "Amedrontado 2", tone: "harm", help: "Penalidade em tudo." },
    });

    // A tooltip trigger has to be reachable and announceable as a control (REQ-UIF-064).
    // `role="note"` on this branch would override the button's implicit role and turn the
    // tab stop into static prose.
    expect(body).toContain("<button");
    expect(body).not.toContain('role="note"');

    // The drawn tip is the only carrier of the help and of the whole label (REQ-CTT-038),
    // so it has to be pointed at by name, not merely displayed on hover.
    const describedBy = /aria-describedby="([^"]+)"/.exec(body)?.[1];
    expect(describedBy).toBeDefined();
    expect(body).toContain(`id="${String(describedBy)}"`);
    expect(body).toContain('role="tooltip"');
  });

  it("REQ-CTT-035: no help means no tooltip, and the chip is still drawn", () => {
    const { body } = render(ConditionChip, { props: { label: "Enfeitiçado" } });

    expect(body).toContain("Enfeitiçado");
    expect(body).not.toContain('role="tooltip"');
    // No declared tone degrades to a situation instead of hiding the condition.
    expect(body).toContain("condition-chip--special");
    // Inert text: no tab stop, nothing to describe — and `role="note"` is what lets the
    // bare <span> carry its accessible name at all, which a role-less element cannot.
    expect(body).not.toContain("<button");
    expect(body).toContain('role="note"');
    expect(body).not.toContain("aria-describedby");
  });

  it("REQ-CTT-033 / REQ-CTT-038: the value rides the label in tabular numerals, and truncation keeps it whole", () => {
    const style = styleOf("../../common/ConditionChip.svelte");
    expect(style).toContain("font-variant-numeric: tabular-nums");
    expect(style).toContain("text-overflow: ellipsis");

    const { body } = render(ConditionChip, {
      props: { label: "Amedrontado 2", tone: "harm", help: "ajuda" },
    });
    // The tip repeats the label in full, so an ellipsis never hides what the chip says.
    expect(body).toContain("condition-chip__tip-label");
  });
});

// ---------------------------------------------------------------------------
// The cap of two, and where the expansion lives
// ---------------------------------------------------------------------------

describe("two tags plus '+N' (REQ-CBA-051, REQ-CBA-052)", () => {
  it("REQ-CBA-051: the head draws two chips and folds the rest into '+N'", () => {
    const conditions = ["Atordoado", "Amedrontado", "Cego", "Surdo", "Lento"].map((name, i) =>
      chip({ id: `c${String(i)}`, label: name }),
    );
    const body = renderHead({ conditions });

    expect(body.match(/condition-chip condition-chip--/g)).toHaveLength(2);
    expect(body).toContain("+3");
  });

  it("REQ-CBA-051: the queue draws two chips and a '+N' that is a count, not a control", () => {
    const conditions = ["Atordoado", "Amedrontado", "Cego"].map((name, i) =>
      chip({ id: `c${String(i)}`, label: name }),
    );
    const combat = makeCombat(
      [
        makeCombatant({ _id: "active", name: "Chefe", initiative: 20 }),
        makeCombatant({ _id: "mob", name: "Goblin", initiative: 12 }),
      ],
      "active",
    );
    const queue = buildRotatedQueue(buildTrackerRows(combat), true);
    const { body } = render(CombatQueue, {
      props: {
        queue,
        vitals: new Map([["mob", { health: null, conditions }]]),
        gmControls: true,
        busy: false,
        order: ["active", "mob"],
        rollable: new Set<string>(),
      },
    });

    expect(body.match(/condition-chip condition-chip--/g)).toHaveLength(2);
    expect(body).toContain("+1");
    // REQ-CBA-052: growing the block is the head's gesture; the queue's indicator is text.
    expect(body).not.toContain('combatant-row__condition-more"><button');
  });
});

// ---------------------------------------------------------------------------
// The panel is what feeds both
// ---------------------------------------------------------------------------

describe("the panel resolves the vitals once and hands them down (REQ-CBA-054, REQ-CBA-083)", () => {
  const panel = sourceOf("../CombatPanel.svelte");

  it("REQ-CBA-040 / REQ-CBA-041: the head and the queue read the same role-resolved map", () => {
    expect(panel).toContain("buildCombatVitals(role,");
    expect(panel).toContain("health={vitals.get(row.id)?.health ?? null}");
    expect(panel).toContain("conditions={vitals.get(row.id)?.conditions ?? []}");
    expect(panel).toContain("{vitals}");
    // The placeholders G050 left behind are gone.
    expect(panel).not.toContain("health={null}");
    expect(panel).not.toContain("conditions={[]}");
  });

  it("REQ-CBA-054: a change to an actor redraws the panel, because it subscribes to the mirror", () => {
    expect(panel).toContain('worldMirror.subscribe<Record<string, unknown>>("Actor"');
  });

  it("REQ-CBA-083: the code says this is a rule of the screen, and never calls it security", () => {
    const rule = sourceOf("../../../lib/combat/combatVitals.ts");

    expect(rule).toContain("Q-CBA-02");
    expect(rule).toContain("REQ-CNV-090");
    expect(rule).toContain("REQ-CBA-083");
    for (const source of [rule, panel]) {
      expect(source.toLowerCase()).not.toContain("por segurança");
      expect(source.toLowerCase()).not.toContain("for security");
    }
  });
});
