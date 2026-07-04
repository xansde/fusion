/**
 * @fusion/system-pf2e — Equipment collector.
 *
 * Fixes the bug where `stepCharAc` (reads `doc._equippedArmor`) and
 * `stepCharStrikes` (reads `doc._equippedWeapons`) expect these fields to be
 * pre-populated, but nothing in production ever wrote them. This step scans
 * `doc.items` and populates both fields during the "base" phase, before AC
 * and strikes run in "derived".
 *
 * Clean-room: ORC/OGL mechanics only.
 * REQ-PF2-020, REQ-PF2-030..034.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// isEquippedFlag — shared "is this item equipped" predicate
// ---------------------------------------------------------------------------

/**
 * Determine whether an item's `system` block marks it as equipped.
 *
 * Tolerates three shapes the importer/UI may produce:
 *   - `equipped: true` (boolean flag)
 *   - `equipped: { value: true }`
 *   - `equipped: { inSlot: true }`
 *
 * Unarmed-strike weapons are NOT considered here — the caller (the weapon
 * collector below) always includes `category === "unarmed"` regardless of
 * this flag, since you cannot "unequip" your own fists/bite/claws.
 */
export function isEquippedFlag(sys: Record<string, unknown> | undefined | null): boolean {
  if (!sys) return false;
  const equipped = sys["equipped"];
  if (equipped === true) return true;
  if (equipped && typeof equipped === "object") {
    const obj = equipped as { value?: unknown; inSlot?: unknown };
    if (obj.value === true) return true;
    if (obj.inSlot === true) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Equipped-weapon input shape (consumed by stepCharStrikes)
// ---------------------------------------------------------------------------

interface EquippedWeaponInput {
  name: string;
  id: string;
  damage: { dice: number; die: string; damageType: string; modifier?: number };
  category: string;
  traits: string[];
  range: number | null;
  runes: { potency: number; striking: number };
}

interface EquippedArmorInput {
  category: string;
  acBonus: number;
  dexCap: number | null;
  potency: number;
}

function toEquippedWeapon(item: Record<string, unknown>): EquippedWeaponInput {
  const sys = (item["system"] as Record<string, unknown> | undefined) ?? {};
  const damage = (sys["damage"] as Record<string, unknown> | undefined) ?? {};
  const traitsBlock = sys["traits"] as { value?: unknown } | undefined;
  const runes = (sys["runes"] as Record<string, unknown> | undefined) ?? {};

  return {
    name: (item["name"] as string | undefined) ?? "Strike",
    id: (item["_id"] as string | undefined) ?? "",
    damage: {
      dice: typeof damage["dice"] === "number" ? damage["dice"] : 1,
      die: typeof damage["die"] === "string" ? damage["die"] : "d4",
      damageType: typeof damage["damageType"] === "string" ? damage["damageType"] : "bludgeoning",
      modifier: typeof damage["modifier"] === "number" ? damage["modifier"] : 0,
    },
    category: typeof sys["category"] === "string" ? sys["category"] : "unarmed",
    traits: Array.isArray(traitsBlock?.value) ? (traitsBlock.value as string[]) : [],
    range: typeof sys["range"] === "number" ? sys["range"] : null,
    runes: {
      potency: typeof runes["potency"] === "number" ? runes["potency"] : 0,
      striking: typeof runes["striking"] === "number" ? runes["striking"] : 0,
    },
  };
}

function toEquippedArmor(item: Record<string, unknown>): EquippedArmorInput {
  const sys = (item["system"] as Record<string, unknown> | undefined) ?? {};
  const runes = (sys["runes"] as Record<string, unknown> | undefined) ?? {};

  return {
    category: typeof sys["category"] === "string" ? sys["category"] : "unarmored",
    acBonus: typeof sys["acBonus"] === "number" ? sys["acBonus"] : 0,
    dexCap: typeof sys["dexCap"] === "number" ? sys["dexCap"] : null,
    potency: typeof runes["potency"] === "number" ? runes["potency"] : 0,
  };
}

// ---------------------------------------------------------------------------
// STEP: collect equipped weapons/armor from doc.items
// REQ-PF2-020, REQ-PF2-030
// ---------------------------------------------------------------------------

/**
 * Scan `doc.items` and populate `doc._equippedWeapons` / `doc._equippedArmor`.
 *
 * These two fields live OUTSIDE `system` (they are ephemeral working-copy
 * data, not part of the persisted document schema), so this step declares no
 * `writes` paths under `system.*` — instead it writes an inert marker under
 * `system.derived` so the topo-sort has a concrete edge to order against
 * (stepCharAc / stepCharStrikes declare no `reads` on this marker; the
 * "base" → "derived" phase split already guarantees this step runs first).
 *
 * Weapon inclusion rule: unarmed-category weapons ALWAYS count (you cannot
 * unequip your own fists/bite), all others require `isEquippedFlag`.
 * Armor inclusion rule: the FIRST equipped armor item found becomes
 * `doc._equippedArmor` (no support for stacking multiple armors).
 *
 * Reads:  doc.items (outside system; declared reads is empty)
 * Writes: doc._equippedWeapons, doc._equippedArmor (outside system);
 *         system.derived._equipmentCollected (inert marker for ordering)
 */
export const stepCharCollectEquipment: DeriveStep = {
  id: "pf2e.character.base.collectEquipment",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: [],
  writes: ["system.derived._equipmentCollected"],

  run(doc) {
    const sys = (doc["system"] as Record<string, unknown>) ?? {};
    if (!doc["system"] || typeof doc["system"] !== "object") {
      doc["system"] = sys;
    }
    if (!sys["derived"] || typeof sys["derived"] !== "object") {
      sys["derived"] = {};
    }
    (sys["derived"] as Record<string, unknown>)["_equipmentCollected"] = true;

    const rawItems = doc["items"];
    if (!Array.isArray(rawItems)) {
      doc["_equippedWeapons"] = [];
      return;
    }

    const weapons: EquippedWeaponInput[] = [];
    let armor: EquippedArmorInput | undefined;

    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const itemType = item["type"];
      const itemSys = item["system"] as Record<string, unknown> | undefined;

      if (itemType === "weapon") {
        const isUnarmed = itemSys?.["category"] === "unarmed";
        if (isUnarmed || isEquippedFlag(itemSys)) {
          weapons.push(toEquippedWeapon(item));
        }
        continue;
      }

      if (itemType === "armor" && armor === undefined && isEquippedFlag(itemSys)) {
        armor = toEquippedArmor(item);
      }
    }

    doc["_equippedWeapons"] = weapons;
    if (armor !== undefined) {
      doc["_equippedArmor"] = armor;
    }
  },
};
