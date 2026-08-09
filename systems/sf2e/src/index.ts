/**
 * @fusion/system-sf2e — Starfinder Second Edition (SF2e) game system.
 *
 * SF2e is the sibling system to PF2e (systems/pf2e), sharing the same
 * engine-2e core (three-action economy, MAP, degrees of success, TEML
 * proficiency, dying/wounded, IWR, modifier stacking — D-SF2-01,
 * REQ-SF2-004..006). This package registers ONLY the SF2e-specific
 * additions and deltas on top of that shared engine:
 *
 * INHERITED FROM PF2e/engine-2e WITHOUT CHANGE (REQ-SF2-004..006):
 *   - Three-action economy, MAP, degrees of success, TEML proficiency.
 *   - Magic system (prepared/spontaneous/innate slots, focus points,
 *     heightening) — used by Mystic and Witchwarper.
 *   - Hero points, saving throws, bulk/encumbrance.
 *   - Modifier stacking table (stacking.ts — thin re-export).
 *   - Base condition set (blinded, frightened, off-guard, dying, etc.) —
 *     imported from `@fusion/system-pf2e`'s `PF2E_CONDITIONS` and merged
 *     with this package's SF2e-exclusive `SF2E_CONDITIONS` below (slugs do
 *     not overlap — verified: PF2e's 39 base slugs vs SF2e's untethered/
 *     glitching/suppressed).
 *   - Actor subtypes: character, npc, hazard, loot (schemas mirror PF2e's
 *     shape almost verbatim — see schemas/actor-*.ts docstrings for the
 *     few deltas: currency, augmentations, skills, classResources).
 *   - Item subtypes shared with PF2e: weapon, armor, shield, equipment,
 *     consumable, treasure, container, condition, effect, spell,
 *     spellcastingEntry, feat, action, melee, lore, ancestry (=Species,
 *     D-SF2-08), heritage, background, class.
 *
 * SF2e-EXCLUSIVE ADDITIONS (this package's actual contribution):
 *   - Item subtype `augmentation` (REQ-SF2-002, REQ-SF2-023) — new document
 *     type not present in PF2e.
 *   - Skills `computers` and `piloting` (REQ-SF2-007..008) — added to the
 *     18-skill SF2e set in types.ts / schema-primitives.ts.
 *   - Weapon/armor `grade` field replacing runes for Tech items (D-SF2-02,
 *     REQ-SF2-018) + `ammo`/`charges`/`expend` charge tracking
 *     (REQ-SF2-020).
 *   - Credits as the actor currency (`system.currency.credits`, D-SF2-05,
 *     REQ-SF2-027) instead of PF2e's gp/sp/cp wallet; credsticks modeled as
 *     `equipment` with `isCredstick`/`credits` (REQ-SF2-029).
 *   - Augmentation slot tracking on the character actor
 *     (`system.augmentations`, REQ-SF2-023..024).
 *   - SF2e-exclusive conditions: Untethered (REQ-SF2-022, spec-mandated),
 *     plus Glitching and Suppressed (delta beyond spec 18, confirmed in the
 *     real compendium data — see conditions.ts docstring).
 *   - Initiative formula `sf2e` (perception-based, same shape as PF2e's).
 *
 * NOT YET WIRED IN THIS PACKAGE:
 *   - Sheets, chat cards beyond the data-only descriptors below, importer
 *     extension (REQ-SF2-044..048 — see tools/importer-pf2e).
 *   - Starship Scene combat, zero-g automation ([V2], REQ-SF2-031..035).
 *
 * WIRED, BUT NOT VIA THE SYSTEM-API HOOK BUS (audit fix, M4 batch):
 *   - hooks/augmentation.ts (slot-limit validation, REQ-SF2-024, CA-SF2-05).
 *     The system-api `HookBus` (preCreate/preUpdate/preDelete) is dead code
 *     in production — `SystemModule` has no `hooks` field and
 *     `doc-handlers.ts` never consumes it (same gap as the derive pipeline).
 *     `validateAugmentationSlotLimit` is pure logic exported from this
 *     package; the server calls it directly from
 *     `packages/server/src/net/handlers/doc-handlers.ts`'s
 *     `handleEmbeddedCreate`, gated on the parent Actor's systemId — the
 *     actual code path a real doc:create (Item embedded in Actor) goes
 *     through. See hooks/augmentation.ts docstring for details.
 *
 * Clean-room implementation. Mechanics are ORC (Archives of Nethys SF2e,
 * Starfinder Player Core / Alien Core). Data shapes cross-checked against
 * vendor/pf2e/packs/sf2e/** (Apache-2.0). No Foundry or Paizo proprietary
 * code or prose included.
 *
 * Spec: 18-sistema-sf2e.md
 * REQ-SF2-001..007.
 */

import { defineSystem } from "@fusion/system-api";
import { PF2E_CONDITIONS } from "@fusion/system-pf2e";

// Schemas — actors
import { CharacterSystemSchema } from "./schemas/actor-character.js";
import { NpcSystemSchema } from "./schemas/actor-npc.js";
import { HazardSystemSchema } from "./schemas/actor-hazard.js";
import { LootSystemSchema } from "./schemas/actor-loot.js";

// Schemas — items
import { WeaponSystemSchema } from "./schemas/item-weapon.js";
import { ArmorSystemSchema } from "./schemas/item-armor.js";
import { AugmentationSystemSchema } from "./schemas/item-augmentation.js";
import { SpellSystemSchema } from "./schemas/item-spell.js";
import { FeatSystemSchema } from "./schemas/item-feat.js";
import { ConditionSystemSchema } from "./schemas/item-condition.js";
import { EffectSystemSchema } from "./schemas/item-effect.js";
import { SpellcastingEntrySystemSchema } from "./schemas/item-spellcasting-entry.js";
import {
  EquipmentSystemSchema,
  ConsumableSystemSchema,
  ShieldSystemSchema,
  TreasureSystemSchema,
  ContainerSystemSchema,
  ActionSystemSchema,
  MeleeSystemSchema,
  LoreSystemSchema,
  AncestrySystemSchema,
  BackgroundSystemSchema,
  ClassSystemSchema,
  HeritageSystemSchema,
} from "./schemas/item-equipment.js";

// Conditions, stacking, initiative
import { SF2E_CONDITIONS } from "./conditions.js";
import { SF2E_STACKING_TABLE } from "./stacking.js";
import { sf2eInitiativeFormula } from "./initiative.js";

// Derivations (character + NPC derive steps)
import { registerDerivations } from "./derivations/index.js";

// ---------------------------------------------------------------------------
// defineSystem
// ---------------------------------------------------------------------------

export const sf2eSystem = defineSystem(
  {
    id: "sf2e",
    title: "Starfinder 2e",
    version: "0.1.0",
    engineCompat: ">=0.1.0",
    authors: [{ name: "Fusion Engine Team" }],
    documentTypes: {
      Actor: ["character", "npc", "hazard", "loot"],
      Item: [
        "weapon",
        "armor",
        "shield",
        "equipment",
        "consumable",
        "treasure",
        "container",
        "condition",
        "effect",
        "spell",
        "spellcastingEntry",
        "feat",
        "action",
        "melee",
        "lore",
        "ancestry",
        "heritage",
        "background",
        "class",
        "augmentation",
      ],
    },
    languages: [
      { lang: "pt-BR", name: "Português (Brasil)", path: "lang/pt-BR.json" },
      { lang: "en", name: "English", path: "lang/en.json" },
    ],
  },

  (registrar) => {
    // -----------------------------------------------------------------------
    // Actor schemas
    // REQ-SF2-001..002
    // -----------------------------------------------------------------------

    registrar.defineModel({
      documentType: "Actor",
      subtype: "character",
      schema: CharacterSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "npc",
      schema: NpcSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "hazard",
      schema: HazardSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "loot",
      schema: LootSystemSchema,
    });

    // -----------------------------------------------------------------------
    // Item schemas
    // REQ-SF2-002..003, REQ-SF2-018..020, REQ-SF2-023 (augmentation)
    // -----------------------------------------------------------------------

    registrar.defineModel({
      documentType: "Item",
      subtype: "weapon",
      schema: WeaponSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "armor",
      schema: ArmorSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "shield",
      schema: ShieldSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "equipment",
      schema: EquipmentSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "consumable",
      schema: ConsumableSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "treasure",
      schema: TreasureSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "container",
      schema: ContainerSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "condition",
      schema: ConditionSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "effect",
      schema: EffectSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "spell",
      schema: SpellSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "spellcastingEntry",
      schema: SpellcastingEntrySystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "feat",
      schema: FeatSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "action",
      schema: ActionSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "melee",
      schema: MeleeSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "lore",
      schema: LoreSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "ancestry",
      schema: AncestrySystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "heritage",
      schema: HeritageSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "background",
      schema: BackgroundSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "class",
      schema: ClassSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "augmentation",
      schema: AugmentationSystemSchema,
    });

    // -----------------------------------------------------------------------
    // Conditions (REQ-SF2-006, REQ-SF2-022) — PF2e base set + SF2e deltas.
    // Slugs are disjoint (verified in module docstring above), so merging
    // both arrays into one system registration is safe under the
    // defineSystem duplicate-slug guard.
    // -----------------------------------------------------------------------

    for (const condDef of [...PF2E_CONDITIONS, ...SF2E_CONDITIONS]) {
      registrar.condition(condDef);
    }

    // -----------------------------------------------------------------------
    // Modifier stacking table (REQ-SF2-004, REQ-SYS-085)
    // -----------------------------------------------------------------------

    registrar.stackingRules(SF2E_STACKING_TABLE);

    // -----------------------------------------------------------------------
    // Initiative formula (see 10-combate-e-iniciativa.md; SF2e roles in 18-sistema-sf2e.md)
    // -----------------------------------------------------------------------

    registrar.registerInitiativeFormula("sf2e", sf2eInitiativeFormula);

    // -----------------------------------------------------------------------
    // Chat card renderers (REQ-SYS-046)
    // These are data-only descriptors — the client renders them from the
    // payload shape without arbitrary HTML (spec 09 §chat cards).
    // -----------------------------------------------------------------------

    registrar.chatCard({
      cardType: "sf2e.strike",
      render(payload: unknown) {
        return payload;
      },
    });

    registrar.chatCard({
      cardType: "sf2e.damage",
      render(payload: unknown) {
        return payload;
      },
    });

    registrar.chatCard({
      cardType: "sf2e.check",
      render(payload: unknown) {
        return payload;
      },
    });

    // -----------------------------------------------------------------------
    // Derivation steps — character + NPC.
    // Mirrors systems/pf2e/src/index.ts's pipeline phases:
    //   base → collectModifiers (effects engine) → derived
    //
    // REQ-SYS-020, REQ-SF2-010..017 (spec 18 equivalents).
    // -----------------------------------------------------------------------

    registerDerivations(registrar);
  },
);

// ---------------------------------------------------------------------------
// Public API re-exports
// ---------------------------------------------------------------------------

// Actor schemas
export { CharacterSystemSchema, parseCharacterSystem } from "./schemas/actor-character.js";
export type { CharacterSystem } from "./schemas/actor-character.js";
export {
  AugmentationSlotSchema,
  AugmentationTypeSchema as ActorAugmentationTypeSchema,
  BodySlotSchema as ActorBodySlotSchema,
} from "./schemas/actor-character.js";

export { NpcSystemSchema, parseNpcSystem } from "./schemas/actor-npc.js";
export type { NpcSystem } from "./schemas/actor-npc.js";

export { HazardSystemSchema, parseHazardSystem } from "./schemas/actor-hazard.js";
export type { HazardSystem } from "./schemas/actor-hazard.js";

export { LootSystemSchema, parseLootSystem } from "./schemas/actor-loot.js";
export type { LootSystem } from "./schemas/actor-loot.js";

// Item schemas
export { WeaponSystemSchema, parseWeaponSystem, isTechWeapon } from "./schemas/item-weapon.js";
export type { WeaponSystem } from "./schemas/item-weapon.js";

export { ArmorSystemSchema, parseArmorSystem } from "./schemas/item-armor.js";
export type { ArmorSystem } from "./schemas/item-armor.js";

export {
  AugmentationSystemSchema,
  parseAugmentationSystem,
  AugmentationTypeSchema,
  BodySlotSchema,
} from "./schemas/item-augmentation.js";
export type { AugmentationSystem } from "./schemas/item-augmentation.js";

export { SpellSystemSchema, parseSpellSystem } from "./schemas/item-spell.js";
export type { SpellSystem } from "./schemas/item-spell.js";

export { FeatSystemSchema, parseFeatSystem } from "./schemas/item-feat.js";
export type { FeatSystem } from "./schemas/item-feat.js";

export { ConditionSystemSchema, parseConditionSystem } from "./schemas/item-condition.js";
export type { ConditionSystem } from "./schemas/item-condition.js";

export { EffectSystemSchema, parseEffectSystem } from "./schemas/item-effect.js";
export type { EffectSystem } from "./schemas/item-effect.js";

export {
  SpellcastingEntrySystemSchema,
  parseSpellcastingEntrySystem,
} from "./schemas/item-spellcasting-entry.js";
export type { SpellcastingEntrySystem } from "./schemas/item-spellcasting-entry.js";

export {
  EquipmentSystemSchema,
  ConsumableSystemSchema,
  ShieldSystemSchema,
  TreasureSystemSchema,
  ContainerSystemSchema,
  ActionSystemSchema,
  MeleeSystemSchema,
  LoreSystemSchema,
  AncestrySystemSchema,
  BackgroundSystemSchema,
  ClassSystemSchema,
  HeritageSystemSchema,
  parseEquipmentSystem,
  parseConsumableSystem,
  parseShieldSystem,
  parseTreasureSystem,
  parseContainerSystem,
  parseActionSystem,
  parseMeleeSystem,
  parseLoreSystem,
  parseAncestrySystem,
  parseBackgroundSystem,
  parseClassSystem,
  parseHeritageSystem,
} from "./schemas/item-equipment.js";
export type {
  EquipmentSystem,
  ConsumableSystem,
  ShieldSystem,
  TreasureSystem,
  ContainerSystem,
  ActionSystem,
  MeleeSystem,
  LoreSystem,
  AncestrySystem,
  BackgroundSystem,
  ClassSystem,
  HeritageSystem,
} from "./schemas/item-equipment.js";

// Schema primitives (shared across schemas)
export * from "./schema-primitives.js";

// Types / constants
export * from "./types.js";

// Conditions (SF2e-exclusive additions — merge with PF2e's base set)
export { SF2E_CONDITIONS, SF2E_CONDITION_SLUGS, getSf2eConditionBySlug } from "./conditions.js";

// Stacking
export { SF2E_STACKING_TABLE } from "./stacking.js";

// Initiative
export { sf2eInitiativeFormula } from "./initiative.js";

// Actions (strikes, conditions manager, apply-damage pipeline)
export * from "./actions/index.js";

// Derivations (character + NPC prepareData pipeline)
export * from "./derivations/index.js";

// Hooks (augmentation slot-limit validation — REQ-SF2-024, CA-SF2-05)
export * from "./hooks/augmentation.js";
