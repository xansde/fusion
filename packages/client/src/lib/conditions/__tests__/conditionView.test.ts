/**
 * conditionView.test.ts — the condition chip view model (spec 39 §5.4, G063).
 *
 * The tab knows no condition: it paints what the system declared (DEC-CTT-11).
 * Everything that decides WHAT is painted — tone, label, order, how many fit —
 * lives in this pure module, so the component below it only has to draw.
 *
 * Covers REQ-CTT-030 (text label, no icon), REQ-CTT-031 (color from `tone`),
 * REQ-CTT-032 (critical is emphasis, carried as its own flag), REQ-CTT-033
 * (value glued to the label), REQ-CTT-035 (incomplete declaration degrades,
 * never hides), REQ-CTT-036 (order) and REQ-CTT-037 (cap of two plus "+N").
 */

import { describe, it, expect } from "vitest";

import {
  CONDITION_CHIP_LIMIT,
  buildConditionViews,
  formatConditionLabel,
  normalizeConditionTone,
  sortConditions,
  splitConditionsForDisplay,
  type ConditionDisplayContract,
  type ConditionView,
} from "../conditionView.js";

// ---------------------------------------------------------------------------
// Fixtures — a system's declared conditions, as they arrive from REQ-SYS-043.
// ---------------------------------------------------------------------------

function declarations(
  ...defs: ConditionDisplayContract[]
): ReadonlyMap<string, ConditionDisplayContract> {
  return new Map(defs.map((d) => [d.slug ?? "", d]));
}

const FRIGHTENED: ConditionDisplayContract = {
  slug: "frightened",
  label: "Amedrontado",
  img: "systems/pf2e/icons/frightened.webp",
  tone: "harm",
  help: "Penalidade de condição em testes e CD.",
};

const DYING: ConditionDisplayContract = {
  slug: "dying",
  label: "Morrendo",
  img: "systems/pf2e/icons/dying.webp",
  tone: "harm",
  critical: true,
};

const HASTED: ConditionDisplayContract = {
  slug: "hasted",
  label: "Acelerado",
  img: "",
  tone: "benefit",
  help: "Ganha uma ação extra por turno.",
};

const HIDDEN: ConditionDisplayContract = {
  slug: "hidden",
  label: "Escondido",
  img: "",
  tone: "special",
};

/** A system that declared the bare minimum — no tone, no help, no critical. */
const BARE: ConditionDisplayContract = { slug: "clumsy", label: "Desajeitado", img: "" };

function viewOf(views: readonly ConditionView[], slug: string): ConditionView {
  const found = views.find((v) => v.slug === slug);
  if (!found) throw new Error(`no view for "${slug}"`);
  return found;
}

// ---------------------------------------------------------------------------
// Tone — REQ-CTT-031 / REQ-CTT-035
// ---------------------------------------------------------------------------

describe("tone declared by the system (REQ-CTT-031)", () => {
  it("REQ-CTT-031: keeps the three declared tones — benefit, harm and situation", () => {
    const views = buildConditionViews(
      [{ slug: "hasted" }, { slug: "frightened" }, { slug: "hidden" }],
      declarations(HASTED, FRIGHTENED, HIDDEN),
    );

    expect(viewOf(views, "hasted").tone).toBe("benefit");
    expect(viewOf(views, "frightened").tone).toBe("harm");
    expect(viewOf(views, "hidden").tone).toBe("special");
  });

  it("REQ-CTT-035: a condition with no declared tone is shown as a situation", () => {
    const views = buildConditionViews([{ slug: "clumsy" }], declarations(BARE));
    expect(viewOf(views, "clumsy").tone).toBe("special");
  });

  it("REQ-CTT-035: an unknown tone degrades to situation instead of being dropped", () => {
    expect(normalizeConditionTone("severe")).toBe("special");
    expect(normalizeConditionTone(undefined)).toBe("special");
    expect(normalizeConditionTone("benefit")).toBe("benefit");
  });
});

// ---------------------------------------------------------------------------
// Fail open — REQ-CTT-035
// ---------------------------------------------------------------------------

describe("an incomplete declaration degrades, never hides (REQ-CTT-035)", () => {
  it("REQ-CTT-035: a condition the system never declared is still shown", () => {
    const views = buildConditionViews([{ slug: "off-guard" }], declarations());

    expect(views).toHaveLength(1);
    expect(views[0]?.slug).toBe("off-guard");
    expect(views[0]?.name).toBe("Off Guard");
    expect(views[0]?.tone).toBe("special");
    expect(views[0]?.help).toBeNull();
    expect(views[0]?.critical).toBe(false);
  });

  it("REQ-CTT-035: a condition with no declared help carries no help text", () => {
    const views = buildConditionViews([{ slug: "clumsy", value: 1 }], declarations(BARE));
    expect(viewOf(views, "clumsy").help).toBeNull();
    expect(viewOf(views, "clumsy").label).toBe("Desajeitado 1");
  });

  it("REQ-CTT-030: the view carries no icon — the declared img never reaches it", () => {
    const views = buildConditionViews([{ slug: "frightened" }], declarations(FRIGHTENED));
    expect(JSON.stringify(views)).not.toContain("frightened.webp");
    expect(Object.keys(views[0] ?? {})).not.toContain("img");
  });
});

// ---------------------------------------------------------------------------
// Value in the label — REQ-CTT-033
// ---------------------------------------------------------------------------

describe("the value is part of the label (REQ-CTT-033)", () => {
  it("REQ-CTT-033: the value is glued to the name, with no parentheses", () => {
    const views = buildConditionViews([{ slug: "frightened", value: 2 }], declarations(FRIGHTENED));
    const view = viewOf(views, "frightened");

    expect(view.label).toBe("Amedrontado 2");
    expect(view.label).not.toContain("(");
    expect(view.name).toBe("Amedrontado");
    expect(view.value).toBe(2);
  });

  it("REQ-CTT-033: a condition with no value keeps the bare name as its label", () => {
    const views = buildConditionViews([{ slug: "hidden" }], declarations(HIDDEN));
    expect(viewOf(views, "hidden").label).toBe("Escondido");
    expect(viewOf(views, "hidden").value).toBeNull();
  });

  it("REQ-CTT-033: formatConditionLabel never emits a separate tag for the value", () => {
    expect(formatConditionLabel("Amedrontado", 2)).toBe("Amedrontado 2");
    expect(formatConditionLabel("Amedrontado", null)).toBe("Amedrontado");
    expect(formatConditionLabel("Amedrontado", Number.NaN)).toBe("Amedrontado");
  });
});

// ---------------------------------------------------------------------------
// Critical — REQ-CTT-032
// ---------------------------------------------------------------------------

describe("critical is emphasis, not a fourth tone (REQ-CTT-032)", () => {
  it("REQ-CTT-032: a critical condition keeps its declared tone and flags critical", () => {
    const views = buildConditionViews([{ slug: "dying", value: 1 }], declarations(DYING));
    const view = viewOf(views, "dying");

    expect(view.critical).toBe(true);
    // Emphasis rides on the same tone — it never becomes a tone of its own.
    expect(view.tone).toBe("harm");
  });
});

// ---------------------------------------------------------------------------
// Order — REQ-CTT-036
// ---------------------------------------------------------------------------

describe("chip order (REQ-CTT-036)", () => {
  const views = buildConditionViews(
    [
      { slug: "hasted" },
      { slug: "hidden" },
      { slug: "frightened", value: 2 },
      { slug: "dying", value: 1 },
      { slug: "clumsy", value: 1 },
      { slug: "agil" },
      { slug: "abalado" },
    ],
    declarations(
      HASTED,
      HIDDEN,
      FRIGHTENED,
      DYING,
      BARE,
      { slug: "agil", label: "Ágil", img: "", tone: "harm" },
      { slug: "abalado", label: "Abalado", img: "", tone: "harm" },
    ),
  );

  it("REQ-CTT-036: criticals first, then penalties, then situations, then benefits", () => {
    const groups = sortConditions(views).map((v) => (v.critical ? "critical" : v.tone));
    expect(groups).toEqual(["critical", "harm", "harm", "harm", "special", "special", "benefit"]);
  });

  it("REQ-CTT-036: alphabetical inside each group, with pt-BR collation", () => {
    const penalties = sortConditions(views)
      .filter((v) => !v.critical && v.tone === "harm")
      .map((v) => v.name);

    // "Abalado" before "Ágil" — a code-point sort would put the accent last.
    expect(penalties).toEqual(["Abalado", "Ágil", "Amedrontado"]);
  });

  it("REQ-CTT-036: sortConditions is pure — it does not reorder its input", () => {
    const input = [...views];
    const before = input.map((v) => v.slug);
    sortConditions(input);
    expect(input.map((v) => v.slug)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Cap of two plus "+N" — REQ-CTT-037
// ---------------------------------------------------------------------------

describe("at most two chips plus a +N indicator (REQ-CTT-037)", () => {
  const many = buildConditionViews(
    [
      { slug: "dying", value: 1 },
      { slug: "frightened", value: 2 },
      { slug: "clumsy", value: 1 },
      { slug: "hidden" },
      { slug: "hasted" },
    ],
    declarations(DYING, FRIGHTENED, BARE, HIDDEN, HASTED),
  );

  it("REQ-CTT-037: collapsed shows two chips and counts the rest", () => {
    expect(CONDITION_CHIP_LIMIT).toBe(2);
    const split = splitConditionsForDisplay(sortConditions(many), { expanded: false });

    expect(split.shown).toHaveLength(2);
    expect(split.hidden).toBe(3);
    expect(split.shown.map((v) => v.slug)).toEqual(["dying", "frightened"]);
  });

  it("REQ-CTT-037: expanding shows every chip, in the same order", () => {
    const split = splitConditionsForDisplay(sortConditions(many), { expanded: true });

    expect(split.shown).toHaveLength(5);
    expect(split.hidden).toBe(0);
    expect(split.shown.map((v) => v.slug)).toEqual(sortConditions(many).map((v) => v.slug));
  });

  it("REQ-CTT-037: two or fewer conditions never produce an indicator", () => {
    const two = buildConditionViews(
      [{ slug: "hidden" }, { slug: "hasted" }],
      declarations(HIDDEN, HASTED),
    );
    const split = splitConditionsForDisplay(two, { expanded: false });

    expect(split.shown).toHaveLength(2);
    expect(split.hidden).toBe(0);
  });
});
