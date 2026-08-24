/**
 * registerPf2eSheets.ts — PF2e client-side boot registration.
 *
 * Called once during client boot (after Svelte app mounts, from
 * `systems/pf2e/index.ts` — the ONE entry point the core imports) to plug the
 * PF2e system into every core extension point (F3, DEC-SEP-02):
 *
 *  - `sheetRegistry` — Actor sheet components, resolved by (documentType, subtype).
 *  - `chatCardExtensionRegistry` — the interactive ability card, resolved by
 *    recognizing `flags.pf2e.abilityCard` / legacy `flags.pf2e.spellCast`.
 *  - `skillNameRegistry` — the pt-BR skill-name table `combatSetup.ts` (core)
 *    uses to label the initiative-statistic picker (REQ-CBA-066).
 *
 * REQ-UIF-018..019: registerSheet by (documentType, subtype); engine provides
 * defaults.
 * REQ-PF2-110..112: character, npc, hazard, loot sheets.
 * Spec: 17-sistema-pf2e.md §Fichas, 11-ui-framework-e-fichas.md §Sistema de Sheets.
 *
 * Clean-room.
 */

import { sheetRegistry } from "$lib/sheets/sheetRegistry.js";
import {
  registerChatCardExtension,
  type ChatCardExtension,
} from "$lib/chat/chatCardExtensionRegistry.svelte.js";
import { registerSkillNameResolver } from "$lib/combat/skillNameRegistry.js";
import type { ChatMessage as ChatMessageType } from "@fusion/shared";
import {
  AbilityCardSchema,
  SpellCastCardSchema,
  adaptSpellCastToAbilityCard,
} from "@fusion/shared";
import { skillNamePt } from "./skillNames.js";

// Lazy import to avoid pulling Svelte heavy import graph until needed.
// In tests this file is never loaded (tests target the VMs, not the registry).

/**
 * Register all PF2e sheet components with the client sheet registry.
 *
 * Call this once during app boot (e.g., in App.svelte onMount, after the
 * Svelte runtime is ready).
 */
export async function registerPf2eSheets(): Promise<void> {
  // Dynamic imports keep the sheet code in separate bundles (code-split) and
  // avoid requiring Svelte at module-init time (which breaks Node tests).
  const [
    { default: CharacterSheet },
    { default: NpcSheet },
    { default: FamiliarSheet },
    { default: AbilityCard },
  ] = await Promise.all([
    import("../../../components/sheets/pf2e/CharacterSheet.svelte"),
    import("../../../components/sheets/pf2e/NpcSheet.svelte"),
    import("../../../components/sheets/pf2e/pets/FamiliarSheet.svelte"),
    import("../../../components/chat/pf2e/AbilityCard.svelte"),
  ]);

  // Character sheet — primary PC sheet (REQ-PF2-110)
  sheetRegistry.register("Actor", "character", CharacterSheet, {
    defaultSize: { width: 760, height: 600 },
    makeDefault: true,
  });

  // NPC sheet — compact GM statblock (REQ-PF2-111)
  sheetRegistry.register("Actor", "npc", NpcSheet, {
    defaultSize: { width: 480, height: 520 },
    makeDefault: true,
  });

  // Hazard sheet — reuse NPC sheet (compact statblock fits hazards too)
  // REQ-PF2-112: hazard sheet = statblock of trap: AC/saves/HP/Hardness + routine
  sheetRegistry.register("Actor", "hazard", NpcSheet, {
    defaultSize: { width: 460, height: 440 },
    makeDefault: true,
  });

  // Loot sheet — reuse NPC sheet (only inventory is relevant for loot)
  // REQ-PF2-112: loot sheet = inventory only
  sheetRegistry.register("Actor", "loot", NpcSheet, {
    defaultSize: { width: 440, height: 400 },
    makeDefault: true,
  });

  // Familiar / companion sheet — lean statblock with a link back to the master
  // (spec 29 REQ-PET-055). Creation + ability budget are driven from the
  // master's Pets tab; this window is the standalone view.
  sheetRegistry.register("Actor", "familiar", FamiliarSheet, {
    defaultSize: { width: 420, height: 460 },
    makeDefault: true,
  });

  // Interactive ability card — moved out of ChatMessage.svelte (core) in F3.
  // READ COMPAT: a message persisted before r20-X1 carries
  // `flags.pf2e.spellCast` (a SpellCastCard) instead of the unified
  // `flags.pf2e.abilityCard` — it is adapted here so old chat still renders
  // through the same <AbilityCard>.
  const abilityCardExtension: ChatCardExtension = {
    recognize(message: ChatMessageType): unknown {
      const flags = message.flags as Record<string, Record<string, unknown>> | undefined;
      const rawAbility = flags?.["pf2e"]?.["abilityCard"];
      if (rawAbility !== undefined) {
        const result = AbilityCardSchema.safeParse(rawAbility);
        if (result.success) return result.data;
      }
      const rawSpell = flags?.["pf2e"]?.["spellCast"];
      if (rawSpell !== undefined) {
        const legacy = SpellCastCardSchema.safeParse(rawSpell);
        if (legacy.success) return adaptSpellCastToAbilityCard(legacy.data);
      }
      return null;
    },
    component: AbilityCard,
  };
  registerChatCardExtension(abilityCardExtension);

  // Localized skill names — combatSetup.ts's initiative statistic picker
  // (REQ-CBA-066) reads this through the core skillNameRegistry, never a
  // direct import of this territory's skillNames.ts.
  registerSkillNameResolver(skillNamePt);
}
