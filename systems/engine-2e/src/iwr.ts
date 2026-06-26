/**
 * Immunity / Weakness / Resistance (IWR) pipeline — PF2e Remaster.
 *
 * Clean-room implementation based on:
 *   docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §6.4 — Immunities, Weaknesses, Resistances
 *   specs/17-sistema-pf2e.md REQ-PF2-060/062/063
 *   Archives of Nethys (ORC license).
 *
 * Pipeline order (§6.4): Immunity → Weakness → Resistance
 *
 * Rules:
 *   - Immunity: damage of immune type is reduced to 0.
 *   - Weakness X: adds X to total damage after immunity check.
 *   - Resistance X: subtracts X from total damage (minimum 0).
 *   - Weaknesses and resistances apply AFTER critical hit multiplication.
 *   - 'physical' as a target covers bludgeoning/piercing/slashing (umbrella type).
 *
 * This module implements the pipeline for a single damage instance.
 * Multiple damage types should each be resolved independently.
 */

/** Physical damage subtypes covered by the 'physical' umbrella IWR target. */
const PHYSICAL_SUBTYPES = new Set(["bludgeoning", "piercing", "slashing"]);

/** An IWR entry (compact form for the pipeline, same shape as IwrEntry from system-api). */
export interface IwrPipelineEntry {
  readonly target: string;
  readonly value?: number;
}

export interface IwrSet {
  readonly immunities: readonly IwrPipelineEntry[];
  readonly weaknesses: readonly IwrPipelineEntry[];
  readonly resistances: readonly IwrPipelineEntry[];
}

export interface DamageInstance {
  readonly amount: number;
  readonly type: string;
  /** Additional traits on this damage (e.g., "magical"). */
  readonly traits?: readonly string[];
}

export interface DamageResult {
  readonly type: string;
  /** Damage amount after IWR pipeline. */
  readonly finalDamage: number;
  readonly note?: string;
}

/**
 * Determine whether an IWR entry matches a damage type.
 *
 * Matches when:
 *   - entry.target === damageType, OR
 *   - entry.target === "physical" AND damageType is a physical subtype, OR
 *   - damageType matches one of the damage traits.
 */
function iwrEntryMatches(
  entry: IwrPipelineEntry,
  damageType: string,
  traits?: readonly string[],
): boolean {
  if (entry.target === damageType) return true;
  if (entry.target === "physical" && PHYSICAL_SUBTYPES.has(damageType)) return true;
  if (traits && traits.includes(entry.target)) return true;
  return false;
}

/**
 * Apply the IWR pipeline to a single damage instance.
 *
 * §6.4: Order — Immunity → Weakness → Resistance
 *
 * @param damage  - The damage instance (type + amount + optional traits).
 * @param iwr     - The IWR set for the target creature.
 * @returns       - The resolved damage result.
 */
export function applyIwr(damage: DamageInstance, iwr: IwrSet): DamageResult {
  const { type, traits } = damage;
  let amount = damage.amount;

  // Step 1: Immunity — if immune, damage is 0, skip weakness/resistance
  for (const immunity of iwr.immunities) {
    if (iwrEntryMatches(immunity, type, traits)) {
      return { type, finalDamage: 0, note: "immunity" };
    }
  }

  // Step 2: Weakness — add weakness value
  for (const weakness of iwr.weaknesses) {
    if (iwrEntryMatches(weakness, type, traits)) {
      amount += weakness.value ?? 0;
    }
  }

  // Step 3: Resistance — subtract resistance value (minimum 0)
  for (const resistance of iwr.resistances) {
    if (iwrEntryMatches(resistance, type, traits)) {
      amount = Math.max(amount - (resistance.value ?? 0), 0);
    }
  }

  return { type, finalDamage: Math.max(amount, 0) };
}

/**
 * Apply the IWR pipeline to multiple damage instances.
 *
 * Each damage type is resolved independently. The total is the sum of all final damages.
 */
export function applyIwrMultiple(
  damages: readonly DamageInstance[],
  iwr: IwrSet,
): { total: number; breakdown: DamageResult[] } {
  const breakdown = damages.map((d) => applyIwr(d, iwr));
  const total = breakdown.reduce((sum, r) => sum + r.finalDamage, 0);
  return { total, breakdown };
}
