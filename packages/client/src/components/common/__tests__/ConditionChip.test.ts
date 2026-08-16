/**
 * ConditionChip.test.ts — the condition chip and its row (spec 39 §5.4, G063).
 *
 * Covers REQ-CTT-030 (text label, no icon), REQ-CTT-031 (color from the declared
 * tone), REQ-CTT-032 (critical is filled emphasis, not a fourth color),
 * REQ-CTT-033 (value glued to the label, tabular numerals), REQ-CTT-034 (drawn
 * tooltip, not the native `title`), REQ-CTT-035 (no help → no tooltip; an
 * incomplete declaration never hides the condition), REQ-CTT-036 (order on the
 * card) and REQ-CTT-037/038 (cap of two plus "+N", clipped label).
 *
 * The client project runs Vitest in a node environment — no jsdom, no
 * testing-library — so the assertions look at the two places these requirements
 * are observable without a browser: the server-rendered markup (`svelte/server`)
 * and the component's own stylesheet, which is where "this hue and no other" and
 * "clipped with an ellipsis" actually live.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ConditionChip from "../ConditionChip.svelte";
import ConditionChips from "../ConditionChips.svelte";
import {
  buildConditionViews,
  type ConditionDisplayContract,
} from "../../../lib/conditions/conditionView.js";
import "../../../lib/i18n/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DECLARED: ConditionDisplayContract[] = [
  {
    slug: "frightened",
    label: "Amedrontado",
    img: "systems/pf2e/icons/frightened.webp",
    tone: "harm",
    help: "Penalidade de condição em testes e CD.",
  },
  { slug: "dying", label: "Morrendo", img: "", tone: "harm", critical: true },
  { slug: "hasted", label: "Acelerado", img: "", tone: "benefit", help: "Uma ação extra." },
  { slug: "hidden", label: "Escondido", img: "", tone: "special" },
  // Declared with nothing but a name — the shape of an already-registered system.
  { slug: "clumsy", label: "Desajeitado", img: "" },
];

const REGISTRY: ReadonlyMap<string, ConditionDisplayContract> = new Map(
  DECLARED.map((d) => [d.slug ?? "", d]),
);

function viewsFor(...actives: { slug: string; value?: number }[]) {
  return buildConditionViews(actives, REGISTRY);
}

function renderChip(slug: string, value?: number): string {
  const [condition] = viewsFor(value === undefined ? { slug } : { slug, value });
  if (!condition) throw new Error(`no view for "${slug}"`);
  return render(ConditionChip, { props: { condition } }).body;
}

function renderRow(actives: { slug: string; value?: number }[]): string {
  return render(ConditionChips, { props: { conditions: viewsFor(...actives) } }).body;
}

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

/** Source with every comment removed, so prose is never mistaken for a declaration. */
function codeOf(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The `<style>` block of a component, comments stripped. */
function styleOf(file: string): string {
  const match = /<style>([\s\S]*)<\/style>/.exec(codeOf(file));
  if (!match?.[1]) throw new Error(`${file} has no <style> block`);
  return match[1];
}

/** Body of the first CSS rule whose selector list contains `selector`. */
function ruleBody(css: string, selector: string): string {
  const index = css.indexOf(selector);
  if (index === -1) throw new Error(`no rule for "${selector}"`);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

// ---------------------------------------------------------------------------
// Text, no icon — REQ-CTT-030
// ---------------------------------------------------------------------------

describe("the chip is text (REQ-CTT-030)", () => {
  it("REQ-CTT-030: draws the label and no image at all", () => {
    const body = renderChip("frightened", 2);

    expect(body).toContain("Amedrontado 2");
    expect(body).not.toContain("<img");
    expect(body).not.toContain("<svg");
    // The declared img points at Paizo artwork — it must not reach the markup.
    expect(body).not.toContain("frightened.webp");
    expect(body).not.toContain("background-image");
  });
});

// ---------------------------------------------------------------------------
// Tone — REQ-CTT-031 / REQ-CTT-032
// ---------------------------------------------------------------------------

describe("color comes from the declared tone (REQ-CTT-031)", () => {
  it("REQ-CTT-031: each tone gets its own class, and an undeclared tone gets the situation one", () => {
    expect(renderChip("hasted")).toContain("condition-chip--benefit");
    expect(renderChip("frightened", 1)).toContain("condition-chip--harm");
    expect(renderChip("hidden")).toContain("condition-chip--special");
    // REQ-CTT-035: no declared tone → situation, never dropped.
    expect(renderChip("clumsy", 1)).toContain("condition-chip--special");
  });

  it("REQ-CTT-031: the stylesheet paints exactly one hue per tone", () => {
    const css = styleOf("ConditionChip.svelte");

    expect(ruleBody(css, ".condition-chip--benefit")).toContain(
      "--chip-ink: var(--fusion-success)",
    );
    expect(ruleBody(css, ".condition-chip--harm")).toContain("--chip-ink: var(--fusion-danger)");
    expect(ruleBody(css, ".condition-chip--special")).toContain("--chip-ink: var(--fusion-accent)");
  });

  it("REQ-CTT-031: no severity anywhere — the chip never reads a level or a rank", () => {
    const code = codeOf("ConditionChip.svelte");
    expect(code).not.toMatch(/\bseverity\b/i);
  });
});

describe("critical is emphasis, not a fourth color (REQ-CTT-032)", () => {
  it("REQ-CTT-032: a critical condition is marked, keeping its tone class", () => {
    const body = renderChip("dying", 1);

    expect(body).toContain("condition-chip--critical");
    expect(body).toContain("condition-chip--harm");
    expect(body).toContain('data-critical="true"');
    expect(renderChip("frightened", 2)).toContain('data-critical="false"');
  });

  it("REQ-CTT-032: the critical rule fills with the tone's own ink", () => {
    const critical = ruleBody(styleOf("ConditionChip.svelte"), ".condition-chip--critical");

    expect(critical).toContain("background: var(--chip-ink)");
    // It must not redefine the ink — that is how a fourth color would sneak in.
    expect(critical).not.toContain("--chip-ink:");
  });

  it("REQ-CTT-032: the stylesheet knows exactly three hues", () => {
    const css = styleOf("ConditionChip.svelte");
    const hues = new Set(
      [...css.matchAll(/--fusion-(success|danger|accent|warning|prof-[a-z])\b/g)].map((m) => m[1]),
    );

    expect([...hues].sort()).toEqual(["accent", "danger", "success"]);
  });
});

// ---------------------------------------------------------------------------
// The value — REQ-CTT-033
// ---------------------------------------------------------------------------

describe("the value is part of the label (REQ-CTT-033)", () => {
  it("REQ-CTT-033: value glued to the name, with no parentheses and no second tag", () => {
    const body = renderChip("frightened", 2);
    const labels = [...body.matchAll(/class="[^"]*condition-chip__label[^"]*"[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );

    expect(labels).toEqual(["Amedrontado 2"]);
    expect(body).not.toContain("(2)");
    // The value never gets a tag of its own.
    expect(body).not.toMatch(/condition-chip__value/);
  });

  it("REQ-CTT-033: the label is rendered in tabular numerals", () => {
    const label = ruleBody(styleOf("ConditionChip.svelte"), ".condition-chip__label");
    expect(label).toContain("font-variant-numeric: tabular-nums");
  });
});

// ---------------------------------------------------------------------------
// Tooltip — REQ-CTT-034 / REQ-CTT-035 / REQ-CTT-038
// ---------------------------------------------------------------------------

describe("the tooltip is drawn, never native (REQ-CTT-034)", () => {
  it("REQ-CTT-034: declared help is rendered in a role=tooltip element", () => {
    const body = renderChip("frightened", 2);

    expect(body).toContain('role="tooltip"');
    expect(body).toContain("Penalidade de condição em testes e CD.");
    expect(body).toContain("aria-describedby=");
  });

  it("REQ-CTT-034: the chip carries no native title attribute", () => {
    expect(renderChip("frightened", 2)).not.toMatch(/\stitle=/);
    expect(renderChip("hidden")).not.toMatch(/\stitle=/);
    expect(codeOf("ConditionChip.svelte")).not.toMatch(/\stitle=/);
  });

  it("REQ-CTT-035: a condition with no declared help is drawn without a tooltip", () => {
    const body = renderChip("clumsy", 1);

    expect(body).toContain("Desajeitado 1");
    expect(body).not.toContain('role="tooltip"');
    expect(body).not.toContain("aria-describedby=");
  });

  it("REQ-CTT-038: the tooltip repeats the whole label, which the chip may clip", () => {
    const body = renderChip("frightened", 2);
    const tooltip = body.slice(body.indexOf('role="tooltip"'));

    expect(tooltip).toContain("Amedrontado 2");

    const label = ruleBody(styleOf("ConditionChip.svelte"), ".condition-chip__label");
    expect(label).toContain("text-overflow: ellipsis");
    expect(label).toContain("overflow: hidden");
  });
});

// ---------------------------------------------------------------------------
// Not by color alone
// ---------------------------------------------------------------------------

describe("the hue is never the only channel", () => {
  it("REQ-CTT-031: the tone is also carried in words, out of sight", () => {
    expect(renderChip("hasted")).toContain("benefício");
    expect(renderChip("frightened", 2)).toContain("penalidade");
    expect(renderChip("hidden")).toContain("situação");
  });

  it("REQ-CTT-032: the filled emphasis is spelled out too", () => {
    expect(renderChip("dying", 1)).toContain("penalidade, crítica");
  });
});

// ---------------------------------------------------------------------------
// The row — REQ-CTT-036 / REQ-CTT-037
// ---------------------------------------------------------------------------

describe("the row of chips on a card (REQ-CTT-036, REQ-CTT-037)", () => {
  const FIVE = [
    { slug: "hasted" },
    { slug: "hidden" },
    { slug: "frightened", value: 2 },
    { slug: "dying", value: 1 },
    { slug: "clumsy", value: 1 },
  ];

  function drawnOrder(body: string): string[] {
    return [...body.matchAll(/data-condition="([^"]+)"/g)].map((m) => m[1] ?? "");
  }

  it("REQ-CTT-037: draws two chips and folds the rest into a +N control", () => {
    const body = renderRow(FIVE);

    expect(drawnOrder(body)).toHaveLength(2);
    expect(body).toContain(">+3<");
    expect(body).toContain("Mostrar mais 3 condições");
    expect(body).toContain('aria-expanded="false"');
  });

  it("REQ-CTT-036: the two drawn are the critical one and then the penalty", () => {
    expect(drawnOrder(renderRow(FIVE))).toEqual(["dying", "frightened"]);
  });

  it("REQ-CTT-037: two conditions produce no indicator at all", () => {
    const body = renderRow([{ slug: "hidden" }, { slug: "hasted" }]);

    expect(drawnOrder(body)).toHaveLength(2);
    expect(body).not.toContain("condition-chips__more");
  });

  it("REQ-CTT-037: the +N control is a button in the card, not a window", () => {
    const code = codeOf("ConditionChips.svelte");

    expect(code).toContain("<button");
    expect(code).not.toContain("windowManager");
    expect(code).not.toContain('role="dialog"');
  });

  it("REQ-CTT-037: expanding adds a line — the row wraps and never sets a width", () => {
    const row = ruleBody(styleOf("ConditionChips.svelte"), ".condition-chips");

    expect(row).toContain("flex-wrap: wrap");

    // The row claims no width of its own — `min-width: 0` only lets it shrink.
    const widths = [...row.matchAll(/(?:^|[\s;])((?:min-|max-)?width:[^;]*)/g)].map((m) =>
      m[1]?.trim(),
    );
    expect(widths).toEqual(["min-width: 0"]);
  });

  it("REQ-CTT-030: an actor with no condition draws nothing", () => {
    const body = renderRow([]);

    expect(body).not.toContain("condition-chips");
    expect(body).not.toContain("data-condition=");
    expect(body).not.toContain("<button");
  });
});
