/**
 * abilityCardVM.ts — pure view-model for the generalized interactive ability
 * chat card (r20-X1). The GENERALIZATION of spellCastCardVM: it drives the
 * unified <AbilityCard> component for spells, Kineticist impulses and weapon
 * strikes.
 *
 * 100% testable TypeScript — no Svelte, no PIXI, no socket. The component owns
 * the socket + worldMirror and delegates every decision here:
 *   - which actor(s) the CLICKER may roll a save with (owner→their character(s),
 *     GM→any character) — reused verbatim from the spell card VM;
 *   - the save-roll chat:send op (speaker = the chosen TARGET actor, mod from
 *     that actor's derived save total, checkContext so the server grades it);
 *   - the damage / crit-damage roll ops (speaker = the CASTER, already-resolved
 *     formula from the card, nested under the card via parentMessageId);
 *   - whether the current viewer may see/use the damage buttons (caster owner or
 *     GM only).
 *
 * The server is the authoritative gate: every roll runs on the server via
 * chat:send (RNG on server), the DC on the card was already coherence-checked
 * server-side by kind, and the damage buttons' speaker=caster ride re-checks
 * ownership (REQ-CHT-022). These helpers only decide what to SHOW/BUILD.
 */

import type { AbilityCard, ChatSendFlags } from "@fusion/shared";
import type { SpellDetailsResolver } from "./characterSheetVM.js";
import {
  actorId as readActorId,
  actorSaveMod,
  ownsActor,
  resolveClickerActors,
  type ActorDocLike,
  type ClickerActorOption,
} from "./spellCastCardVM.js";

// Re-export the shared actor/ownership helpers so the component imports them
// from ONE module (the spell card VM keeps them for backward-compat tests).
export {
  actorOwnershipLevel,
  actorSaveMod,
  ownsActor,
  resolveClickerActors,
  type ActorDocLike,
  type ClickerActorOption,
} from "./spellCastCardVM.js";

/** The chat:send op an ability-card button emits (flat shape for makeSendOpFn). */
export interface AbilityChatOp {
  type: "chat:send";
  content: string;
  worldId: string;
  rollMode: "public";
  speakerActorId: string;
  /**
   * Optional structured flags carried to the server (r17.1 / r18-N1). The save
   * button attaches `{ checkContext: { kind:"save", ... } }` so the server
   * grades the roll's degree of success AUTHORITATIVELY; every card button also
   * attaches `parentMessageId` = the card's own message id so the roll nests
   * INSIDE the card instead of appearing as a loose message.
   */
  flags?: ChatSendFlags;
}

// ---------------------------------------------------------------------------
// Button visibility
// ---------------------------------------------------------------------------

/** The save button shows when the card carries both a save type and a DC. */
export function showSaveButton(card: AbilityCard): boolean {
  return card.saveType !== undefined && card.dcValue !== undefined;
}

/** True when the card carries a (primary) damage formula. */
export function hasDamage(card: AbilityCard): boolean {
  return typeof card.damageFormula === "string" && card.damageFormula.length > 0;
}

/** True when the card carries a critical-damage formula (strikes). */
export function hasCritDamage(card: AbilityCard): boolean {
  return typeof card.critDamageFormula === "string" && card.critDamageFormula.length > 0;
}

/**
 * Whether the viewer may see/use the damage buttons ("Rolar dano" /
 * "Rolar dano crítico"): only the user's owner or a GM. `casterActor` may be
 * undefined when the actor isn't in the viewer's mirror (a player who can't see
 * the user) — then only a GM passes. Kind-agnostic (same gate as spells).
 */
export function canRollDamage(
  card: AbilityCard,
  casterActor: ActorDocLike | undefined,
  userId: string,
  isGm: boolean,
): boolean {
  if (isGm) return true;
  if (!casterActor) return false;
  return ownsActor(casterActor, userId, false);
}

// ---------------------------------------------------------------------------
// Roll op builders
// ---------------------------------------------------------------------------

/** Format a modifier with an explicit sign for a dice formula (+3, -1, +0). */
function fmtMod(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/**
 * Build the save-roll chat:send op for a chosen TARGET actor (r20-X1). The roll
 * runs on the server (RNG server-side); the flavor names the save type + DC.
 * Speaker = the target actor (the one who rolls), NOT the ability's user. The
 * structured save checkContext (r17.1) makes the SERVER grade the degree of
 * success against the DC (already coherence-checked when the card was created).
 * `parentMessageId` (r18-N1) nests this save under the card's own message.
 */
export function buildSaveRollOp(
  card: AbilityCard,
  targetActor: ActorDocLike,
  saveTypeLabel: string,
  worldId: string,
  parentMessageId?: string,
): AbilityChatOp | null {
  if (card.saveType === undefined || card.dcValue === undefined) return null;
  const targetId = readActorId(targetActor);
  if (!targetId) return null;
  const mod = actorSaveMod(targetActor, card.saveType);
  const flavor = `Salvaguarda de ${saveTypeLabel} (CD ${String(card.dcValue)})`;
  const flags: ChatSendFlags = {
    checkContext: {
      kind: "save",
      dcValue: card.dcValue,
      saveType: card.saveType,
      ...(card.basicSave !== undefined ? { basicSave: card.basicSave } : {}),
    },
    ...(parentMessageId ? { parentMessageId } : {}),
  };
  return {
    type: "chat:send",
    content: `/r 1d20${fmtMod(mod)} # ${flavor}`,
    worldId,
    rollMode: "public",
    speakerActorId: targetId,
    flags,
  };
}

/**
 * Build a damage-roll chat:send op (r20-X1). Speaker = the ability's user (the
 * card's caster); the formula is the already-resolved `formula` (base or crit)
 * the component picks, and `flavor` is the component's localized label (which
 * already includes the damage type when relevant). `parentMessageId` (r18-N1)
 * nests the damage roll under the card's own message. Returns null when the
 * formula is empty (button hidden).
 */
export function buildDamageRollOp(
  card: AbilityCard,
  formula: string | undefined,
  worldId: string,
  flavor: string,
  parentMessageId?: string,
): AbilityChatOp | null {
  if (!formula) return null;
  return {
    type: "chat:send",
    content: `/r ${formula} # ${flavor}`,
    worldId,
    rollMode: "public",
    speakerActorId: card.casterActorId,
    ...(parentMessageId ? { flags: { parentMessageId } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Details-popup resolution (clickable ability name — spell only, r17.2)
// ---------------------------------------------------------------------------

/**
 * Resolve the card's ability to a spells-core pack Compendium UUID for the
 * details popup, trying `nameEn` (the untranslated pack join key) first, then
 * `name` (display). Only meaningful for `kind:"spell"` today (the component
 * gates the popup to spells); impulses/strikes have no compendium details
 * popup wired. Returns null when neither name matches.
 */
export function resolveAbilityUuid(
  card: Pick<AbilityCard, "name" | "nameEn">,
  resolver: SpellDetailsResolver,
): string | null {
  if (card.nameEn) {
    const byEn = resolver(card.nameEn);
    if (byEn) return byEn;
  }
  return resolver(card.name);
}
