/**
 * @fusion/system-sf2e — SF2e-exclusive condition definitions.
 *
 * REQ-SF2-006: SF2e inherits the full PF2e/engine-2e base condition set
 * without modification. This module defines ONLY the SF2e-exclusive
 * additions; the base set (blinded, frightened, off-guard, dying, etc.) is
 * expected to be sourced from `@fusion/engine-2e`'s shared condition
 * registry / `systems/pf2e`'s `PF2E_CONDITIONS` by the agent wiring
 * `index.ts` (registrar.condition() is additive and slugs must be unique
 * per system — see packages/system-api `defineSystem` duplicate-slug guard).
 *
 * SF2e-exclusive conditions confirmed in the real compendium data
 * (vendor/pf2e/packs/sf2e/conditions/*.json — only 3 files, all `type:
 * "effect"`):
 *
 *   - `untethered` (REQ-SF2-022): floating in zero-g without propulsion.
 *     No direct mechanical modifier of its own — movement restriction only
 *     (grants the "Push Off" action). Environmental Clumsy 1/Off-Guard come
 *     from the zero-g zone itself, not from this condition (D-SF2-06, [V2]).
 *   - `glitching` (delta beyond spec 18, found in real data): tech
 *     equipment/creature malfunction tracker with a numeric badge. Failing
 *     a flat check applies an item penalty equal to the badge value to all
 *     checks/DCs. Modeled here as a `valued` condition (badge = value).
 *   - `suppressed` (delta beyond spec 18, found in real data): pinned down
 *     by heavy fire — flat -1 circumstance to attack rolls and -10ft status
 *     to all Speeds.
 *
 * Clean-room: condition mechanics are ORC (Archives of Nethys SF2e,
 * Starfinder Player Core) cross-checked against
 * vendor/pf2e/packs/sf2e/conditions/{untethered,glitching,suppressed}.json.
 * No proprietary Paizo prose included — labels only, no flavor text.
 *
 * REQ-SF2-006, REQ-SF2-022.
 */

import type { ConditionDefinition } from "@fusion/system-api";

// Placeholder image path — Paizo art is not redistributed.
const img = (slug: string): string => `/icons/conditions/sf2e/${slug}.svg`;

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

/**
 * SF2e-exclusive conditions, additive to the inherited PF2e/engine-2e base
 * set (REQ-SF2-006). `index.ts` registers these alongside the inherited
 * base set.
 */
export const SF2E_CONDITIONS: ConditionDefinition[] = [
  /**
   * untethered → no automatic modifier of its own; movement restriction is
   * enforced by action economy (no move actions unless environment-aware),
   * not by a FlatModifier. REQ-SF2-022.
   */
  {
    slug: "untethered",
    label: "Untethered",
    img: img("untethered"),
    valued: false,
    effects: [rollOption("all", "condition:untethered")],
  },

  /**
   * glitching X → item penalty equal to X on failed flat check (engine/
   * derivation-layer concern, not expressed as an automatic FlatModifier
   * here — the badge/flat-check gate is stateful and belongs to a later
   * agent's derive step). Mechanical delta found in real compendium data.
   */
  {
    slug: "glitching",
    label: "Glitching",
    img: img("glitching"),
    valued: true,
    effects: [rollOption("all", "condition:glitching")],
  },

  /**
   * suppressed → -1 circumstance to attack rolls, -10ft status to all Speeds.
   * Mechanical delta found in real compendium data.
   */
  {
    slug: "suppressed",
    label: "Suppressed",
    img: img("suppressed"),
    valued: false,
    effects: [
      flatMod("attack-roll", -1, "circumstance", "suppressed-attack"),
      flatMod("speed", -10, "status", "suppressed-speed"),
      rollOption("all", "condition:suppressed"),
    ],
  },
];

/** Look up an SF2e-exclusive condition definition by slug. */
export function getSf2eConditionBySlug(slug: string): ConditionDefinition | undefined {
  return SF2E_CONDITIONS.find((c) => c.slug === slug);
}

/** SF2e-exclusive condition slugs (does not include the inherited base set). */
export const SF2E_CONDITION_SLUGS: ReadonlySet<string> = new Set(
  SF2E_CONDITIONS.map((c) => c.slug),
);
