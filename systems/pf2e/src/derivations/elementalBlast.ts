/**
 * @fusion/system-pf2e — Kineticist Elemental Blast derivation (r18-N2b).
 *
 * Elemental Blast is NOT a data-driven Strike rule in the pf2e pack — the
 * vendor implements it in TypeScript (the `elemental-blast.json` action only
 * carries the damage FlatModifiers, not the attack Strike). So this step
 * derives the blast from first principles, using the OFFICIAL Rage of Elements
 * rule (cited below), driven by the character's gate elements.
 *
 * ATTACK ROLL FORMULA (Rage of Elements p.14, Archives of Nethys — "Impulses"):
 *   "Your impulse attack roll uses the same proficiency and attribute modifier
 *    as your kineticist class DC."
 * The kineticist's key ability is CON, so:
 *   attack = level + proficiencyBonus(impulseRank, level) + CON mod
 *            + Σ item bonuses on the `impulse-attack-roll` selector
 * The impulse attack IS subject to the multiple attack penalty (impulses are
 * never agile → −5 / −10), same as a strike.
 *
 * DAMAGE (Rage of Elements, Elemental Blast action):
 *   - Number of dice scales:  max(1 + floor((level − 1) / 4), 1)
 *     (from the pack's DamageAlteration on `elemental-blast-damage`).
 *   - Die size + damage-type options + range come from the ELEMENT
 *     (ELEMENT_BLAST_TABLE below — AoN Elements pages, cited per entry).
 *   - A 2-action blast adds a STATUS bonus to damage equal to CON mod.
 *   - A melee blast adds STR to damage (documented, not baked into the base
 *     ranged roll).
 *
 * GATES (which elements the character has) are data-driven: read from an
 * embedded `type:"classFeature"` item carrying `system.kineticGates` — an
 * array of `{ element, damageType? }`. This keeps the builder in control of
 * gate choice (Dual Gate Air+Metal for Finn) without hard-coding a character.
 *
 * GATE ATTENUATOR (+1 item bonus to impulse attack rolls) and similar items
 * are picked up generically: any EQUIPPED item whose `system.rules[]` carries a
 * FlatModifier on the `impulse-attack-roll` selector contributes its (item-typed)
 * bonus, resolved with PF2e stacking (highest item bonus wins).
 *
 * Clean-room: ORC/OGL mechanics only (dice/type/range are facts of the rule
 * system). No Foundry code copied.
 * REQ-PF2-030, REQ-PF2-034.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import { resolveStacking, type Modifier } from "@fusion/engine-2e";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { ClassSystem } from "../schemas/item-equipment.js";
import type { DerivedElementalBlast, StrikeVariant } from "./types.js";
import { proficiencyBonus, mapPenalties } from "./helpers.js";
import { isEquippedFlag } from "./equipment.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getCharSystem(doc: Record<string, unknown>): CharacterSystem {
  return getSystem(doc) as unknown as CharacterSystem;
}

function getLevel(sys: CharacterSystem): number {
  const level = sys.level as { value?: number } | undefined;
  return level?.value ?? 1;
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  return sys["derived"] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Element blast table — facts of the rule system (Rage of Elements / AoN).
// Die size, damage-type options, and ranged range per element.
// ---------------------------------------------------------------------------

interface ElementBlast {
  readonly die: string;
  readonly damageTypeOptions: string[];
  /** Ranged range in feet (all base elemental blasts have a ranged option). */
  readonly range: number;
}

/**
 * Base Elemental Blast stats per element.
 *
 * Sources (Archives of Nethys, Elements pages — Rage of Elements):
 *   air:   1d6 electricity or slashing, 60 ft  (AoN Elements ID=1)
 *   metal: 1d8 piercing or slashing, 30 ft     (AoN Elements ID=5)
 *   earth: 1d6 bludgeoning or slashing, 30 ft
 *   fire:  1d6 fire, 30 ft
 *   water: 1d6 bludgeoning or cold, 30 ft
 *   wood:  1d6 bludgeoning or vitality, 30 ft
 *
 * Only air+metal are exercised by the Finn fixture; the rest are included so a
 * future single/dual gate of any element derives without a schema change.
 */
const ELEMENT_BLAST_TABLE: Record<string, ElementBlast> = {
  air: { die: "d6", damageTypeOptions: ["electricity", "slashing"], range: 60 },
  earth: { die: "d6", damageTypeOptions: ["bludgeoning", "slashing"], range: 30 },
  fire: { die: "d6", damageTypeOptions: ["fire"], range: 30 },
  metal: { die: "d8", damageTypeOptions: ["piercing", "slashing"], range: 30 },
  water: { die: "d6", damageTypeOptions: ["bludgeoning", "cold"], range: 30 },
  wood: { die: "d6", damageTypeOptions: ["bludgeoning", "vitality"], range: 30 },
};

/** Number of blast damage dice at a character level (pack DamageAlteration). */
function blastDiceCount(level: number): number {
  return Math.max(1 + Math.floor((level - 1) / 4), 1);
}

// ---------------------------------------------------------------------------
// Gate reading (data-driven) + kineticist detection
// ---------------------------------------------------------------------------

interface GateChoice {
  readonly element: string;
  readonly damageType?: string;
}

/**
 * Read the character's gate elements from an embedded `type:"classFeature"`
 * item carrying `system.kineticGates: [{ element, damageType? }]`. Returns []
 * when no such feature is present (non-kineticist, or gates not yet chosen).
 */
function readGates(doc: Record<string, unknown>): GateChoice[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];

  const gates: GateChoice[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item["type"] !== "classFeature") continue;
    const itemSys = item["system"] as Record<string, unknown> | undefined;
    const rawGates = itemSys?.["kineticGates"];
    if (!Array.isArray(rawGates)) continue;
    for (const g of rawGates) {
      if (!g || typeof g !== "object") continue;
      const element = (g as Record<string, unknown>)["element"];
      if (typeof element !== "string") continue;
      const damageType = (g as Record<string, unknown>)["damageType"];
      gates.push({
        element,
        ...(typeof damageType === "string" ? { damageType } : {}),
      });
    }
  }
  return gates;
}

/** Find the embedded class item (the kineticist class doc) if any. */
function findClassSystem(doc: Record<string, unknown>): ClassSystem | undefined {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return undefined;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item["type"] === "class") {
      return (item["system"] ?? {}) as unknown as ClassSystem;
    }
  }
  return undefined;
}

/**
 * Resolve the effective impulse-attack proficiency rank at `level`: the class
 * item's `impulse` rank plus any `proficiencyUpgrades` with `stat:"impulse"`
 * at or below the character's level (highest wins).
 */
function effectiveImpulseRank(classSystem: ClassSystem, level: number): number {
  let rank = classSystem.impulse ?? 0;
  for (const upgrade of classSystem.proficiencyUpgrades ?? []) {
    if (upgrade.stat === "impulse" && upgrade.level <= level && upgrade.rank > rank) {
      rank = upgrade.rank;
    }
  }
  return rank;
}

// ---------------------------------------------------------------------------
// Item bonus on impulse-attack-roll (Gate Attenuator, etc.)
// ---------------------------------------------------------------------------

interface RawRule {
  readonly kind?: unknown;
  readonly type?: unknown;
  readonly key?: unknown;
  readonly selector?: unknown;
  readonly value?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
}

function isFlatModifierRule(rule: RawRule): boolean {
  return (
    rule.kind === "flat-modifier" || rule.type === "flatModifier" || rule.key === "FlatModifier"
  );
}

/**
 * Collect FlatModifiers on the `impulse-attack-roll` selector from EQUIPPED
 * items (Gate Attenuator's +1 item bonus, and any future equivalents). Applies
 * PF2e stacking (item bonuses: highest wins). Guarded like every other
 * item-rule reader in this package (r11 malformed-input posture).
 */
function impulseAttackItemBonus(doc: Record<string, unknown>): {
  sum: number;
} {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return { sum: 0 };

  const modifiers: Modifier[] = [];
  let index = 0;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const itemSys = item["system"] as Record<string, unknown> | undefined;
    // Only equipped worn/held items grant their bonus (an unequipped Gate
    // Attenuator in a backpack does nothing).
    if (!isEquippedFlag(itemSys)) continue;
    const rawRules = itemSys?.["rules"];
    if (!Array.isArray(rawRules)) continue;
    for (const r of rawRules as RawRule[]) {
      index += 1;
      if (!r || typeof r !== "object") continue;
      if (!isFlatModifierRule(r)) continue;
      if (r.selector !== "impulse-attack-roll") continue;
      const value = typeof r.value === "number" ? r.value : 0;
      if (value === 0) continue;
      const slug =
        typeof r.slug === "string" && r.slug.length > 0 ? r.slug : `impulse-item-${String(index)}`;
      modifiers.push({ slug, type: "item", value });
    }
  }
  return { sum: resolveStacking(modifiers) };
}

// ---------------------------------------------------------------------------
// STEP (derived phase): Elemental Blasts
// ---------------------------------------------------------------------------

/**
 * Derive one `DerivedElementalBlast` per gate element and write them to
 * `system.derived.elementalBlasts`. No-op (empty array) for non-kineticists
 * (no gates, or no class item), leaving the field `[]`.
 *
 * Reads:  system.derived.abilityMods, system.level, doc.items
 * Writes: system.derived.elementalBlasts
 */
export const stepCharElementalBlasts: DeriveStep = {
  id: "pf2e.character.derived.elementalBlasts",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.level"],
  writes: ["system.derived.elementalBlasts"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);

    const gates = readGates(doc);
    const classSystem = findClassSystem(doc);
    if (gates.length === 0 || !classSystem) {
      derived["elementalBlasts"] = [];
      return;
    }

    const level = getLevel(sys);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;

    // Impulse attack uses the class's KEY ABILITY (CON for kineticist) — the
    // same attribute the class DC uses (Rage of Elements p.14). Read it from
    // the class item's keyAbility (the builder narrows it to the chosen slug),
    // falling back to CON (the only class with impulses in the MVP).
    const keyAbility = classSystem.keyAbility?.[0] ?? "con";
    const keyMod = abilityMods?.[keyAbility] ?? 0;
    const conMod = abilityMods?.["con"] ?? 0;

    const impulseRank = effectiveImpulseRank(classSystem, level);
    // proficiencyBonus already folds in the character level (rank*2 + level for
    // trained+), so the attack is keyMod + proficiencyBonus + item bonus — the
    // SAME shape saves/AC/class-DC use. (Do NOT add `level` again here.)
    const profBonus = proficiencyBonus(impulseRank, level);
    const { sum: itemBonus } = impulseAttackItemBonus(doc);

    const attackBonus = keyMod + profBonus + itemBonus;
    const [m0, m1, m2] = mapPenalties(false); // impulses are never agile
    const makeVariant = (mapPenalty: number): StrikeVariant => ({
      mapPenalty,
      total: attackBonus + mapPenalty,
      formula: `1d20 + ${String(attackBonus + mapPenalty)}`,
    });
    const variants: [StrikeVariant, StrikeVariant, StrikeVariant] = [
      makeVariant(m0),
      makeVariant(m1),
      makeVariant(m2),
    ];

    const dice = blastDiceCount(level);

    const blasts: DerivedElementalBlast[] = [];
    for (const gate of gates) {
      const table = ELEMENT_BLAST_TABLE[gate.element];
      if (!table) continue; // unknown element — skip rather than guess.

      const damageType =
        gate.damageType && table.damageTypeOptions.includes(gate.damageType)
          ? gate.damageType
          : (table.damageTypeOptions[0] ?? "untyped");

      const damageRoll = `${String(dice)}${table.die}`;
      const damageFormula = `${damageRoll} ${damageType}`;
      const elementLabel = gate.element.charAt(0).toUpperCase() + gate.element.slice(1);

      blasts.push({
        element: gate.element,
        label: `Elemental Blast (${elementLabel})`,
        damageType,
        damageTypeOptions: table.damageTypeOptions,
        isRanged: true,
        range: table.range,
        attackBonus,
        variants,
        damageDice: dice,
        damageDie: table.die,
        damageRoll,
        damageFormula,
        // 2-action blast adds CON status bonus to damage; melee adds STR.
        // Both documented for the sheet; not baked into the base ranged roll.
        twoActionDamageBonus: conMod,
        itemAttackBonus: itemBonus,
      });
    }

    derived["elementalBlasts"] = blasts;
  },
};
