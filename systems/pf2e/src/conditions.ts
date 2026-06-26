/**
 * @fusion/system-pf2e — Canonical PF2e condition definitions.
 *
 * Lists all PF2e Remaster conditions with their slugs, labels, valued flag,
 * and the EffectRules that represent their mechanical effects.
 *
 * Effect rules are expressed in the MVP subset (FlatModifier, ToggleCondition,
 * RollOption) — REQ-PF2-051. Complex conditions whose full effect requires
 * V2 rule elements are marked with a comment.
 *
 * Clean-room: condition descriptions and mechanical rules are ORC/OGL
 * (Archives of Nethys, Pathfinder Player Core). No proprietary text included.
 *
 * REQ-PF2-050, REQ-PF2-051, REQ-PF2-052.
 */

import type { ConditionDefinition, EffectRule, FlatModifierRule } from "@fusion/system-api";
import type { EffectSource } from "@fusion/engine-2e";
import { resolveConditionModifierValue } from "./actions/conditions-manager.js";

// Placeholder image path — Paizo art is not redistributed (REQ-PF2-003).
const img = (slug: string): string => `/icons/conditions/${slug}.svg`;

/**
 * Helper: create a FlatModifier rule.
 *
 * We use `as const` casts to satisfy the narrow EffectRule discriminated union.
 */
function flatMod(
  selector: string | string[],
  value: number,
  modifierType: "circumstance" | "status" | "item" | "untyped",
  slug: string,
): {
  type: "flatModifier";
  selector: string | string[];
  value: number;
  modifierType: string;
  slug: string;
} {
  return { type: "flatModifier", selector, value, modifierType, slug };
}

function rollOption(
  domain: string,
  option: string,
): { type: "rollOption"; domain: string; option: string } {
  return { type: "rollOption", domain, option };
}

// ---------------------------------------------------------------------------
// MVP conditions (REQ-PF2-051) with mechanical effects
// ---------------------------------------------------------------------------

export const PF2E_CONDITIONS: ConditionDefinition[] = [
  // ------------------------------------------------------------------
  // Detectable (no automatic modifier — posture/visibility handled by canvas)
  // REQ-PF2-052
  // ------------------------------------------------------------------
  {
    slug: "blinded",
    label: "Blinded",
    img: img("blinded"),
    effects: [
      flatMod(["ac", "reflex"], -2, "status", "blinded-ac"),
      rollOption("all", "condition:blinded"),
    ],
  },
  {
    slug: "concealed",
    label: "Concealed",
    img: img("concealed"),
    effects: [rollOption("all", "condition:concealed")],
  },
  {
    slug: "dazzled",
    label: "Dazzled",
    img: img("dazzled"),
    effects: [rollOption("all", "condition:dazzled")],
  },
  {
    slug: "deafened",
    label: "Deafened",
    img: img("deafened"),
    effects: [rollOption("all", "condition:deafened")],
  },
  {
    slug: "hidden",
    label: "Hidden",
    img: img("hidden"),
    effects: [rollOption("all", "condition:hidden")],
  },
  {
    slug: "invisible",
    label: "Invisible",
    img: img("invisible"),
    effects: [rollOption("all", "condition:invisible")],
  },
  {
    slug: "observed",
    label: "Observed",
    img: img("observed"),
  },
  {
    slug: "undetected",
    label: "Undetected",
    img: img("undetected"),
    effects: [rollOption("all", "condition:undetected")],
  },
  {
    slug: "unnoticed",
    label: "Unnoticed",
    img: img("unnoticed"),
    effects: [rollOption("all", "condition:unnoticed")],
  },

  // ------------------------------------------------------------------
  // Mechanical conditions with automatic modifiers (REQ-PF2-051)
  // ------------------------------------------------------------------

  /**
   * off-guard → −2 circumstance to AC.
   * REQ-PF2-051.
   */
  {
    slug: "off-guard",
    label: "Off-Guard",
    img: img("off-guard"),
    effects: [
      flatMod("ac", -2, "circumstance", "off-guard-ac"),
      rollOption("all", "condition:off-guard"),
    ],
  },

  /**
   * frightened X → −X status to all checks and DCs.
   * Value-parametrized: the modifier value is set to -X at apply-time by the
   * engine (REQ-PF2-051). Decrements 1 at end of actor's turn (REQ-PF2-092).
   */
  {
    slug: "frightened",
    label: "Frightened",
    img: img("frightened"),
    valued: true,
    effects: [
      // The engine multiplies the value by -1 for valued conditions.
      // Here we express the template — actual value is injected at prepareData.
      flatMod(
        ["ac", "attack-roll", "skill-check", "perception", "saving-throw", "spell-dc", "class-dc"],
        -1, // placeholder; engine will apply -X where X = condition.value
        "status",
        "frightened-penalty",
      ),
      rollOption("all", "condition:frightened"),
    ],
  },

  /**
   * clumsy X → −X status to DEX-based checks and DCs.
   * REQ-PF2-051.
   */
  {
    slug: "clumsy",
    label: "Clumsy",
    img: img("clumsy"),
    valued: true,
    effects: [
      flatMod(
        [
          "ac",
          "reflex",
          "ranged-attack-roll",
          "skill:acrobatics",
          "skill:stealth",
          "skill:thievery",
        ],
        -1, // placeholder; engine applies -X
        "status",
        "clumsy-penalty",
      ),
      rollOption("all", "condition:clumsy"),
    ],
  },

  /**
   * enfeebled X → −X status to STR-based checks and DCs.
   * REQ-PF2-051.
   */
  {
    slug: "enfeebled",
    label: "Enfeebled",
    img: img("enfeebled"),
    valued: true,
    effects: [
      flatMod(
        ["melee-attack-roll", "melee-damage", "skill:athletics"],
        -1, // placeholder; engine applies -X
        "status",
        "enfeebled-penalty",
      ),
      rollOption("all", "condition:enfeebled"),
    ],
  },

  /**
   * drained X → −X status to CON checks; reduces max HP by level × X.
   * REQ-PF2-051 (HP reduction is handled by prepareData, not by a FlatModifier).
   */
  {
    slug: "drained",
    label: "Drained",
    img: img("drained"),
    valued: true,
    effects: [
      flatMod("fortitude", -1, "status", "drained-penalty"),
      rollOption("all", "condition:drained"),
    ],
    // HP max reduction: handled by derivation step, not by an EffectRule.
  },

  /**
   * stupefied X → −X status to INT/WIS/CHA checks and DCs.
   * REQ-PF2-051.
   */
  {
    slug: "stupefied",
    label: "Stupefied",
    img: img("stupefied"),
    valued: true,
    effects: [
      flatMod(
        [
          "spell-attack-roll",
          "spell-dc",
          "skill:arcana",
          "skill:occultism",
          "skill:religion",
          "skill:nature",
          "skill:medicine",
          "skill:society",
          "skill:performance",
          "skill:deception",
          "skill:diplomacy",
          "skill:intimidation",
        ],
        -1,
        "status",
        "stupefied-penalty",
      ),
      rollOption("all", "condition:stupefied"),
    ],
  },

  /**
   * sickened X → −X status to all checks and DCs.
   * REQ-PF2-051.
   */
  {
    slug: "sickened",
    label: "Sickened",
    img: img("sickened"),
    valued: true,
    effects: [
      flatMod(
        ["ac", "attack-roll", "skill-check", "perception", "saving-throw", "spell-dc", "class-dc"],
        -1,
        "status",
        "sickened-penalty",
      ),
      rollOption("all", "condition:sickened"),
    ],
  },

  /**
   * slowed X → reduces actions recovered at start of turn by X.
   * REQ-PF2-051, REQ-PF2-092. Handled by onTurnStart hook, not modifier.
   */
  {
    slug: "slowed",
    label: "Slowed",
    img: img("slowed"),
    valued: true,
    effects: [rollOption("all", "condition:slowed")],
    // Action reduction is applied in the onTurnStart combat hook.
  },

  /**
   * stunned X → consumes X actions at start of turn (overrides slowed).
   * REQ-PF2-051, REQ-PF2-092.
   */
  {
    slug: "stunned",
    label: "Stunned",
    img: img("stunned"),
    valued: true,
    effects: [rollOption("all", "condition:stunned")],
    // Action consumption is applied in the onTurnStart combat hook.
  },

  /**
   * quickened → +1 action per turn.
   * REQ-PF2-051.
   */
  {
    slug: "quickened",
    label: "Quickened",
    img: img("quickened"),
    effects: [rollOption("all", "condition:quickened")],
    // Extra action is applied in the onTurnStart combat hook.
  },

  /**
   * prone → off-guard + −2 circumstance to attack rolls.
   * REQ-PF2-051.
   */
  {
    slug: "prone",
    label: "Prone",
    img: img("prone"),
    effects: [
      flatMod("attack-roll", -2, "circumstance", "prone-attack"),
      { type: "toggleCondition", conditionSlug: "off-guard" } as const,
      rollOption("all", "condition:prone"),
    ],
  },

  /**
   * fatigued → −1 status to AC and all saves.
   * REQ-PF2-051.
   */
  {
    slug: "fatigued",
    label: "Fatigued",
    img: img("fatigued"),
    effects: [
      flatMod(["ac", "saving-throw"], -1, "status", "fatigued-penalty"),
      rollOption("all", "condition:fatigued"),
    ],
  },

  /**
   * unconscious → −4 status to AC/Perception/Reflex; off-guard; blinded.
   * REQ-PF2-051.
   */
  {
    slug: "unconscious",
    label: "Unconscious",
    img: img("unconscious"),
    effects: [
      flatMod(["ac", "perception", "reflex"], -4, "status", "unconscious-penalty"),
      { type: "toggleCondition", conditionSlug: "off-guard" } as const,
      { type: "toggleCondition", conditionSlug: "blinded" } as const,
      rollOption("all", "condition:unconscious"),
    ],
  },

  /**
   * doomed X → reduces maxDying by X. Mechanical effect in prepareData (dying.max).
   * REQ-PF2-051, REQ-PF2-074.
   */
  {
    slug: "doomed",
    label: "Doomed",
    img: img("doomed"),
    valued: true,
    effects: [rollOption("all", "condition:doomed")],
    // Dying max reduction: handled by the dying/wounded derivation step.
  },

  /**
   * wounded X → adds X to initial dying value when gaining Dying.
   * REQ-PF2-051, REQ-PF2-070..073.
   */
  {
    slug: "wounded",
    label: "Wounded",
    img: img("wounded"),
    valued: true,
    effects: [rollOption("all", "condition:wounded")],
    // Dying initial value adjustment handled by the HP/dying derivation step.
  },

  // ------------------------------------------------------------------
  // Dying (special: not a standard condition but tracked as one)
  // REQ-PF2-070..072
  // ------------------------------------------------------------------
  {
    slug: "dying",
    label: "Dying",
    img: img("dying"),
    valued: true,
    effects: [
      { type: "toggleCondition", conditionSlug: "unconscious" } as const,
      rollOption("all", "condition:dying"),
    ],
  },

  // ------------------------------------------------------------------
  // Persistent damage (tracked as a condition instance with formula)
  // REQ-PF2-061
  // ------------------------------------------------------------------
  {
    slug: "persistent-damage",
    label: "Persistent Damage",
    img: img("persistent-damage"),
    valued: false,
    effects: [rollOption("all", "condition:persistent-damage")],
    // Actual damage application happens in the onTurnEnd combat hook.
  },

  // ------------------------------------------------------------------
  // Other notable conditions (no automatic modifier MVP — manual)
  // ------------------------------------------------------------------
  {
    slug: "encumbered",
    label: "Encumbered",
    img: img("encumbered"),
    effects: [
      { type: "toggleCondition", conditionSlug: "clumsy", value: 1 } as const,
      flatMod("speed", -10, "status", "encumbered-speed"),
    ],
  },
  { slug: "grabbed", label: "Grabbed", img: img("grabbed") },
  { slug: "immobilized", label: "Immobilized", img: img("immobilized") },
  {
    slug: "paralyzed",
    label: "Paralyzed",
    img: img("paralyzed"),
    effects: [{ type: "toggleCondition", conditionSlug: "off-guard" } as const],
  },
  { slug: "petrified", label: "Petrified", img: img("petrified") },
  {
    slug: "restrained",
    label: "Restrained",
    img: img("restrained"),
    effects: [{ type: "toggleCondition", conditionSlug: "off-guard" } as const],
  },
  {
    slug: "confused",
    label: "Confused",
    img: img("confused"),
    effects: [{ type: "toggleCondition", conditionSlug: "off-guard" } as const],
  },
  { slug: "controlled", label: "Controlled", img: img("controlled") },
  { slug: "fleeing", label: "Fleeing", img: img("fleeing") },
  { slug: "friendly", label: "Friendly", img: img("friendly") },
  { slug: "helpful", label: "Helpful", img: img("helpful") },
  { slug: "hostile", label: "Hostile", img: img("hostile") },
  { slug: "indifferent", label: "Indifferent", img: img("indifferent") },
  { slug: "unfriendly", label: "Unfriendly", img: img("unfriendly") },
];

/** Look up a condition definition by slug. Returns undefined if not found. */
export function getConditionBySlug(slug: string): ConditionDefinition | undefined {
  return PF2E_CONDITIONS.find((c) => c.slug === slug);
}

// ---------------------------------------------------------------------------
// Materialize a stored ConditionItem into an EffectSource (REQ-PF2-051)
// ---------------------------------------------------------------------------

/**
 * The minimal stored-condition shape consumed by `conditionToEffectSource`.
 *
 * Matches `ConditionItem` from `actions/conditions-manager.ts` (and the
 * `ConditionSystemSchema` stored on actors): a `slug` plus an optional numeric
 * `value` for valued conditions.
 */
export interface StoredCondition {
  readonly system: {
    readonly slug: string;
    readonly value?: number | null;
  };
}

/**
 * Convert a stored ConditionItem (slug + value) into an EffectSource ready for
 * `collectEffects` / the effects engine.
 *
 * This is the bridge that makes valued conditions actually multiply: the
 * ConditionDefinition stores a placeholder FlatModifier `value: -1` (REQ-PF2-051
 * "engine applies −X where X = condition.value"). Here we replace that
 * placeholder with the resolved value (`-conditionValue`, via
 * `resolveConditionModifierValue`) BEFORE the engine sees it — so the system
 * package stays a thin layer that maps PF2e data to engine modifiers without
 * reimplementing math.
 *
 * For valued conditions we also emit a value-carrying roll option in the form
 * `"<slug>:<value>"` (e.g. `"drained:2"`) so derivation steps that need the raw
 * value (drained HP reduction, doomed dyingMax) can read it without re-parsing.
 *
 * Returns `null` when the condition slug is unknown or carries no effects.
 *
 * REQ-PF2-051, REQ-PF2-054.
 */
export function conditionToEffectSource(condition: StoredCondition): EffectSource | null {
  const slug = condition.system.slug;
  const condDef = getConditionBySlug(slug);
  if (!condDef) return null;

  const rawValue = condition.system.value;
  const value = typeof rawValue === "number" ? rawValue : null;
  const isValued = condDef.valued === true && value !== null;

  const baseEffects = condDef.effects ?? [];
  const rules: EffectRule[] = baseEffects.map((rule) => {
    // Substitute placeholder FlatModifier values for valued conditions.
    if (rule.type === "flatModifier" && isValued) {
      const fm = rule as FlatModifierRule;
      const templateValue = typeof fm.value === "number" ? fm.value : 0;
      const resolved = resolveConditionModifierValue(value, templateValue);
      return { ...fm, value: resolved };
    }
    return rule;
  });

  // Emit a value-carrying roll option for valued conditions (e.g. "drained:2").
  // Derivation steps that need the raw value (drained HP, doomed) read this.
  if (isValued) {
    rules.push({ type: "rollOption", domain: "all", option: `${slug}:${String(value)}` });
  }

  const label = value !== null ? `${condDef.label} ${String(value)}` : condDef.label;

  return {
    sourceId: `condition:${slug}`,
    label,
    active: true,
    rules,
  };
}

/**
 * Materialize every stored ConditionItem on an actor into EffectSources.
 *
 * Convenience wrapper around `conditionToEffectSource`; skips unknown or
 * effect-less conditions. Pass the result to `collectEffects` alongside item
 * EffectSources.
 *
 * REQ-PF2-051.
 */
export function conditionsToEffectSources(conditions: readonly StoredCondition[]): EffectSource[] {
  const sources: EffectSource[] = [];
  for (const cond of conditions) {
    const src = conditionToEffectSource(cond);
    if (src) sources.push(src);
  }
  return sources;
}

/** All condition slugs in the PF2e system. */
export const PF2E_CONDITION_SLUGS: ReadonlySet<string> = new Set(
  PF2E_CONDITIONS.map((c) => c.slug),
);
